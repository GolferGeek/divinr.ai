import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line no-restricted-imports -- Direct pg needed for optional orchestrator cross-DB connection
import { Pool } from 'pg';

/**
 * Reads directly from the orchestrator-ai-enterprise database (separate connection).
 * These are the "base set" — shared foundation data that all tenants can access.
 *
 * Uses ORCHESTRATOR_DATABASE_URL to connect to the orchestrator's Postgres,
 * which is separate from Divinr's own DATABASE_URL.
 *
 * Tables read:
 *   crawler.sources      — news feeds, web scrapers, RSS, APIs
 *   crawler.articles      — crawled articles with content
 *   prediction.targets    — instruments (stocks, crypto)
 *   prediction.analysts   — base analyst personas + context providers
 *   prediction.predictors — article→instrument relevance signals
 *   prediction.predictions — historical predictions
 */
@Injectable()
export class OrchestratorBaseDataService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorBaseDataService.name);
  private pool: Pool | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('ORCHESTRATOR_DATABASE_URL');
    if (url) {
      this.pool = new Pool({ connectionString: url, max: 5 });
      this.logger.log('Connected to orchestrator database for base data access');
    } else {
      this.logger.warn('ORCHESTRATOR_DATABASE_URL not set — base data endpoints will return empty results');
    }
  }

  private async query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    if (!this.pool) return [];
    try {
      const result = await this.pool.query(sql, params ?? []);
      return result.rows;
    } catch (err) {
      this.logger.warn(`Base data query failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  // ─── Sources ─────────────────────────────────────────────────

  async getBaseSources(limit = 100): Promise<Record<string, unknown>[]> {
    return this.query(
      `select id, name, source_type, url, organization_slug, created_at
       from crawler.sources
       where coalesce(is_test, false) = false
       order by name asc limit $1`,
      [limit],
    );
  }

  // ─── Articles ────────────────────────────────────────────────

  async getBaseArticles(opts?: {
    sourceId?: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    const limit = opts?.limit ?? 500;
    let query = `select id, title, url, summary, author, content, content_hash,
                        source_id, organization_slug, published_at, first_seen_at, metadata
                 from crawler.articles
                 where true`;
    const params: unknown[] = [];

    if (opts?.sourceId) {
      query += ` and source_id = $${params.length + 1}::uuid`;
      params.push(opts.sourceId);
    }

    query += ` order by coalesce(published_at, first_seen_at) desc nulls last limit $${params.length + 1}`;
    params.push(limit);

    return this.query(query, params);
  }

  // ─── Instruments (Targets) ───────────────────────────────────

  async getBaseInstruments(): Promise<Record<string, unknown>[]> {
    return this.query(
      `select id, symbol, name, target_type, current_price, context, created_at
       from prediction.targets
       where symbol not like 'T\\_%'
       order by symbol asc`,
    );
  }

  // ─── Analysts (Base personas) ────────────────────────────────

  async getBaseAnalysts(): Promise<Record<string, unknown>[]> {
    return this.query(
      `select id, slug, name, perspective, tier_instructions, default_weight,
              scope_level, analyst_type, domain, is_enabled, created_at
       from prediction.analysts
       where is_enabled = true
       order by scope_level, name asc`,
    );
  }

  // ─── Predictors (Signals) ────────────────────────────────────

  async getBasePredictors(opts?: {
    targetId?: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    const limit = opts?.limit ?? 1000;
    let query = `select id, target_id, signal_id, direction, strength, confidence,
                        analyst_slug, reasoning, created_at, status
                 from prediction.predictors
                 where status = 'active'`;
    const params: unknown[] = [];

    if (opts?.targetId) {
      query += ` and target_id = $${params.length + 1}::uuid`;
      params.push(opts.targetId);
    }

    query += ` order by created_at desc limit $${params.length + 1}`;
    params.push(limit);

    return this.query(query, params);
  }

  // ─── Predictions (Historical) ────────────────────────────────

  async getBasePredictions(opts?: {
    targetId?: string;
    analystSlug?: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    const limit = opts?.limit ?? 500;
    let query = `select id, target_id, direction, confidence, magnitude,
                        reasoning, timeframe_hours, predicted_at, expires_at,
                        analyst_slug, status, outcome_value
                 from prediction.predictions`;
    const params: unknown[] = [];
    const filters: string[] = [];

    if (opts?.targetId) {
      filters.push(`target_id = $${params.length + 1}::uuid`);
      params.push(opts.targetId);
    }
    if (opts?.analystSlug) {
      filters.push(`analyst_slug = $${params.length + 1}`);
      params.push(opts.analystSlug);
    }

    if (filters.length > 0) query += ` where ${filters.join(' and ')}`;
    query += ` order by predicted_at desc limit $${params.length + 1}`;
    params.push(limit);

    return this.query(query, params);
  }

  // ─── Risk Assessments (Base) ─────────────────────────────────

  async getBaseRiskAssessments(opts?: {
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    const limit = opts?.limit ?? 100;
    return this.query(
      `select rs.id, rs.subject_id, rs.dimension_id, rs.score, rs.confidence,
              rs.reasoning, rs.created_at,
              rd.slug as dimension_slug, rd.name as dimension_name
       from risk.assessments rs
       join risk.dimensions rd on rd.id = rs.dimension_id
       order by rs.created_at desc limit $1`,
      [limit],
    );
  }

  // ─── Summary ─────────────────────────────────────────────────

  async getBaseDataSummary(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const [label, sql] of [
      ['sources', 'select count(*)::int as c from crawler.sources where coalesce(is_test, false) = false'],
      ['articles', 'select count(*)::int as c from crawler.articles where coalesce(is_test, false) = false'],
      ['instruments', "select count(*)::int as c from prediction.targets where symbol not like 'T\\_%'"],
      ['analysts', 'select count(*)::int as c from prediction.analysts where is_enabled = true'],
      ['predictors', "select count(*)::int as c from prediction.predictors where status = 'active'"],
      ['predictions', 'select count(*)::int as c from prediction.predictions'],
    ] as const) {
      const rows = await this.query(sql);
      counts[label] = (rows[0]?.['c'] as number) ?? 0;
    }
    return counts;
  }
}
