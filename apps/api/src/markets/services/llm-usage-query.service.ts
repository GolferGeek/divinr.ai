import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

interface UsageRow {
  total_calls: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_cents: number;
}

@Injectable()
export class LlmUsageQueryService {
  private readonly logger = new Logger(LlmUsageQueryService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async getSummary(filters: {
    userId?: string;
    startDate?: string;
    endDate?: string;
    stage?: string;
    model?: string;
  }): Promise<UsageRow> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.userId) { conditions.push(`billed_user_id = $${idx++}`); params.push(filters.userId); }
    if (filters.startDate) { conditions.push(`"timestamp" >= $${idx++}::timestamptz`); params.push(filters.startDate); }
    if (filters.endDate) { conditions.push(`"timestamp" <= $${idx++}::timestamptz`); params.push(filters.endDate); }
    if (filters.stage) { conditions.push(`stage = $${idx++}`); params.push(filters.stage); }
    if (filters.model) { conditions.push(`model = $${idx++}`); params.push(filters.model); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.db.rawQuery(
      `SELECT count(*)::integer as total_calls,
              coalesce(sum(tokens_in), 0)::integer as total_tokens_in,
              coalesce(sum(tokens_out), 0)::integer as total_tokens_out,
              coalesce(sum(cost_cents), 0)::integer as total_cost_cents
       FROM prediction.llm_usage_log ${where}`,
      params,
    );
    const rows = (result.data as UsageRow[] | null) ?? [];
    return rows[0] ?? { total_calls: 0, total_tokens_in: 0, total_tokens_out: 0, total_cost_cents: 0 };
  }

  async getByUser(startDate: string, endDate: string) {
    const result = await this.db.rawQuery(
      `SELECT billed_user_id, year_month, total_calls, total_tokens_in, total_tokens_out, total_cost_cents
       FROM prediction.llm_usage_per_user_monthly
       WHERE year_month >= $1 AND year_month <= $2
       ORDER BY total_cost_cents DESC NULLS LAST`,
      [startDate.slice(0, 7), endDate.slice(0, 7)],
    );
    return (result.data as unknown[]) ?? [];
  }

  async getByStage(startDate: string, endDate: string) {
    const result = await this.db.rawQuery(
      `SELECT stage, sub_stage, date, total_calls, total_tokens_in, total_tokens_out, total_cost_cents
       FROM prediction.llm_usage_per_stage_daily
       WHERE date >= $1::date AND date <= $2::date
       ORDER BY date DESC, total_calls DESC`,
      [startDate, endDate],
    );
    return (result.data as unknown[]) ?? [];
  }

  async getByModel(startDate: string, endDate: string) {
    const result = await this.db.rawQuery(
      `SELECT model, provider, date, total_calls, total_tokens_in, total_tokens_out, total_cost_cents
       FROM prediction.llm_usage_per_model_daily
       WHERE date >= $1::date AND date <= $2::date
       ORDER BY date DESC, total_calls DESC`,
      [startDate, endDate],
    );
    return (result.data as unknown[]) ?? [];
  }

  async getByTriple(userId: string, startDate: string, endDate: string) {
    const result = await this.db.rawQuery(
      `SELECT billed_user_id, analyst_id, instrument_id, date, total_calls, total_tokens_in, total_tokens_out, total_cost_cents
       FROM prediction.llm_usage_per_triple_daily
       WHERE billed_user_id = $1 AND date >= $2::date AND date <= $3::date
       ORDER BY date DESC, total_calls DESC`,
      [userId, startDate, endDate],
    );
    return (result.data as unknown[]) ?? [];
  }

  async getBaseVsExtension(startDate: string, endDate: string) {
    const result = await this.db.rawQuery(
      `SELECT date, is_base, total_calls, total_tokens_in, total_tokens_out, total_cost_cents
       FROM prediction.llm_usage_base_vs_extension_daily
       WHERE date >= $1::date AND date <= $2::date
       ORDER BY date DESC`,
      [startDate, endDate],
    );
    return (result.data as unknown[]) ?? [];
  }

  async getMyUsage(userId: string) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const result = await this.db.rawQuery(
      `SELECT billed_user_id, year_month, total_calls, total_tokens_in, total_tokens_out, total_cost_cents
       FROM prediction.llm_usage_per_user_monthly
       WHERE billed_user_id = $1 AND year_month = $2`,
      [userId, currentMonth],
    );
    const rows = (result.data as UsageRow[] | null) ?? [];
    return rows[0] ?? { total_calls: 0, total_tokens_in: 0, total_tokens_out: 0, total_cost_cents: 0 };
  }

  async refreshViews(): Promise<void> {
    const views = [
      'prediction.llm_usage_per_user_monthly',
      'prediction.llm_usage_per_triple_daily',
      'prediction.llm_usage_per_stage_daily',
      'prediction.llm_usage_per_model_daily',
      'prediction.llm_usage_per_source_monthly',
      'prediction.llm_usage_per_analyst_authorship_monthly',
      'prediction.llm_usage_per_instrument_authorship_monthly',
      'prediction.llm_usage_base_vs_extension_daily',
    ];

    for (const view of views) {
      try {
        await this.db.rawQuery(`REFRESH MATERIALIZED VIEW ${view}`);
      } catch (err) {
        this.logger.warn(`Failed to refresh ${view}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.logger.log('LLM usage materialized views refreshed');
  }

  async cleanupRetention(): Promise<void> {
    const retentionDays = parseInt(process.env.LLM_USAGE_RETENTION_DAYS ?? '90', 10);
    const result = await this.db.rawQuery(
      `DELETE FROM prediction.llm_usage_log WHERE "timestamp" < now() - interval '1 day' * $1`,
      [retentionDays],
    );
    this.logger.log(`LLM usage retention cleanup: removed rows older than ${retentionDays} days`);
    return;
  }
}
