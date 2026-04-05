import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@orchestrator-ai/transport-types';
import {
  DATABASE_SERVICE,
  type DatabaseService,
} from '@orchestratorai/planes/database';
import { LLM_SERVICE, type LLMServiceProvider } from '@orchestratorai/planes/llm';
import { RbacService } from '@orchestratorai/planes/rbac';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { MarketsSchemaService } from './schema/markets-schema.service';
import { RiskRunnerService } from './services/risk-runner.service';
import { PredictionRunnerService } from './services/prediction-runner.service';
import { MarketsLlmService } from './services/markets-llm.service';
import type {
  AssignAnalystInput,
  CreateAnalystInput,
  ExternalCrawlerSyncInput,
  ExternalCrawlerSyncResult,
  CreateInstrumentInput,
  CreateRunInput,
  EvaluateRunInput,
  ListMarketArticlesInput,
  ListPredictionOutcomesInput,
  ListRiskAssessmentsInput,
  ListRunArtifactsInput,
  ListRunsInput,
  ListPredictorsInput,
  MarketArticle,
  MarketAnalyst,
  MarketInstrument,
  MarketPredictor,
  MarketRun,
  MarketSource,
  PredictionOutcome,
  ProcessNextRunInput,
  ProcessNextRunResult,
  ProcessRunsInput,
  ProcessRunsResult,
  ReplayRunInput,
  RiskAssessment,
  RunArtifact,
  RunEvaluation,
  RunReplay,
  RunType,
  RunStatus,
  SourceEntitlement,
  UpsertSourceEntitlementInput,
  UpdateRunStatusInput,
  UpsertPredictorInput,
  ScorePredictorInput,
  ScorePredictorResult,
  ScorePredictorBatchInput,
  ScorePredictorBatchResult,
} from './markets.types';

@Injectable()
export class MarketsService {
  private readonly allowedTransitions: Record<RunStatus, RunStatus[]> = {
    queued: ['running', 'failed'],
    running: ['completed', 'failed'],
    completed: [],
    failed: [],
  };

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(LLM_SERVICE) private readonly llm: LLMServiceProvider,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(ObservabilityEventsService)
    private readonly observability: ObservabilityEventsService,
    private readonly schema: MarketsSchemaService,
    private readonly riskRunner: RiskRunnerService,
    private readonly predictionRunner: PredictionRunnerService,
    private readonly marketsLlm: MarketsLlmService,
  ) {}

  private isExternalCrawlerSyncEnabled(force = false): boolean {
    if (force) {
      return true;
    }
    return process.env.MARKETS_EXTERNAL_SYNC_ENABLED === 'true';
  }

  /** Prefer `MARKETS_ENABLE_LLM`; `PHASE1_ENABLE_LLM` remains as a temporary alias. */
  private isMarketsLlmEnabled(): boolean {
    return (
      process.env.MARKETS_ENABLE_LLM === 'true' ||
      process.env.PHASE1_ENABLE_LLM === 'true'
    );
  }

  private getExternalCrawlerOrgSlug(): string | null {
    const configured = process.env.MARKETS_EXTERNAL_SYNC_ORG_SLUG?.trim();
    return configured && configured.length > 0 ? configured : null;
  }

  private getExternalCrawlerLimit(
    envVar: string,
    fallback: number,
    maxValue: number,
  ): number {
    const raw = process.env[envVar];
    if (!raw) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return fallback;
    }
    return Math.min(Math.floor(parsed), maxValue);
  }

  private getExternalCrawlerLookbackDays(): number {
    return this.getExternalCrawlerLimit(
      'MARKETS_EXTERNAL_ARTICLE_LOOKBACK_DAYS',
      14,
      365,
    );
  }

  private async requireRead(
    userId: string,
    organizationSlug: string,
  ): Promise<void> {
    if (process.env.MARKETS_DEV_AUTH_BYPASS === 'true') return;
    const allowed = await this.rbac.hasPermission(
      userId,
      organizationSlug,
      'markets.instruments.read',
    );
    if (!allowed) {
      throw new ForbiddenException('Read permission denied for organization');
    }
  }

  private async requireWrite(
    userId: string,
    organizationSlug: string,
  ): Promise<void> {
    if (process.env.MARKETS_DEV_AUTH_BYPASS === 'true') return;
    const allowed = await this.rbac.hasPermission(
      userId,
      organizationSlug,
      'markets.instruments.write',
    );
    if (!allowed) {
      throw new ForbiddenException('Write permission denied for organization');
    }
  }

  private buildExecutionContext(
    organizationSlug: string,
    userId: string,
    runType: RunType,
  ): ExecutionContext {
    const llmConfig = this.getPreferredLlmConfig();
    return {
      conversationId: randomUUID(),
      userId,
      orgSlug: organizationSlug,
      agentSlug: `markets-${runType}-orchestrator`,
      agentType: 'system',
      provider: llmConfig.provider,
      model: llmConfig.model,
      sovereignMode: false,
    };
  }

  private getPreferredLlmConfig(): {
    provider: string;
    model: string;
    commercialFallbackProvider: string;
    commercialFallbackModel: string;
    allowCommercialFallback: boolean;
  } {
    const provider = process.env.OPENSOURCE_LLM_PROVIDER || 'ollama_local';
    const model =
      process.env.DEFAULT_OPENSOURCE_MODEL ||
      process.env.OLLAMA_DEFAULT_MODEL ||
      'qwen3:8b';
    const commercialFallbackProvider =
      process.env.COMMERCIAL_LLM_PROVIDER || 'openrouter';
    const commercialFallbackModel =
      process.env.DEFAULT_COMMERCIAL_MODEL || 'gpt-4o-mini';
    const allowCommercialFallback =
      process.env.MARKETS_ALLOW_COMMERCIAL_FALLBACK === 'true';
    return {
      provider,
      model,
      commercialFallbackProvider,
      commercialFallbackModel,
      allowCommercialFallback,
    };
  }

  private async generateLlmText(
    context: ExecutionContext,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{ text: string; provider: string; model: string }> {
    const preferred = this.getPreferredLlmConfig();

    try {
      const llmResponse = await this.llm.generateResponse(systemPrompt, userPrompt, {
        provider: preferred.provider,
        executionContext: context,
      });
      const text =
        typeof llmResponse === 'string'
          ? llmResponse
          : llmResponse?.content || JSON.stringify(llmResponse);
      return {
        text,
        provider: preferred.provider,
        model: preferred.model,
      };
    } catch (error) {
      if (!preferred.allowCommercialFallback) {
        throw error;
      }
      const llmResponse = await this.llm.generateResponse(systemPrompt, userPrompt, {
        provider: preferred.commercialFallbackProvider,
        executionContext: context,
      });
      const text =
        typeof llmResponse === 'string'
          ? llmResponse
          : llmResponse?.content || JSON.stringify(llmResponse);
      return {
        text,
        provider: preferred.commercialFallbackProvider,
        model: preferred.commercialFallbackModel,
      };
    }
  }

  private async emitDeduplicatedQueueEvent(
    context: ExecutionContext,
    runId: string,
    instrumentId: string,
    runType: RunType,
  ): Promise<void> {
    await this.observability.push({
      context,
      source_app: 'divinr-api',
      hook_event_type: 'markets.orchestration.deduplicated',
      status: 'queued',
      message: `${runType} run already queued`,
      progress: 0,
      step: 'deduplicated',
      payload: {
        runId,
        instrumentId,
        runType,
      },
      timestamp: Date.now(),
    });
  }

  async listInstruments(
    organizationSlug: string,
    userId: string,
  ): Promise<MarketInstrument[]> {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    // Show org-specific instruments; fall back to __base__ only for symbols the org doesn't have
    const result = await this.db.rawQuery(
      `select * from prediction.instruments
       where organization_slug = $1
       union all
       select b.* from prediction.instruments b
       where b.organization_slug = '__base__'
         and not exists (
           select 1 from prediction.instruments o
           where o.organization_slug = $1 and o.symbol = b.symbol
         )
       order by symbol asc`,
      [organizationSlug],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return ((result.data as MarketInstrument[] | null) ?? []);
  }

  async createInstrument(input: CreateInstrumentInput): Promise<MarketInstrument> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    const instrument: MarketInstrument = {
      id: randomUUID(),
      organization_slug: input.organizationSlug,
      symbol: input.symbol.toUpperCase(),
      name: input.name || input.symbol.toUpperCase(),
      asset_type: input.assetType || 'stock',
      universe_slug: 'stocks',
      current_state: {},
      is_active: true,
      created_at: new Date().toISOString(),
    };

    const result = await this.db
      .from('prediction', 'instruments')
      .insert(instrument)
      .select('*')
      .single();
    if (result.error) {
      throw new Error(result.error.message);
    }
    return result.data as MarketInstrument;
  }

  async createAnalyst(input: CreateAnalystInput): Promise<MarketAnalyst> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    const now = new Date().toISOString();
    const analyst: MarketAnalyst = {
      id: randomUUID(),
      organization_slug: input.organizationSlug,
      slug: input.slug.trim().toLowerCase(),
      display_name: input.displayName.trim(),
      analyst_type: 'personality',
      persona_prompt: input.personaPrompt.trim(),
      tier_instructions: {},
      default_weight: 1.0,
      is_system_default: false,
      is_enabled: true,
      is_active: true,
      workflow_scope: 'both',
      domain_slug: 'financial',
      universe_slug: null,
      current_config_version_id: null,
      paper_config_version_id: null,
      learning_enabled: true,
      memory_patterns: [],
      memory_corrections: [],
      memory_instrument_notes: {},
      memory_calibration: {},
      created_by: input.userId,
      created_at: now,
      updated_at: now,
    };
    const insert = await this.db.rawQuery(
      `
      insert into prediction.market_analysts
        (id, organization_slug, slug, display_name, name, persona_prompt, analyst_type,
         default_weight, tier_instructions, is_system_default, is_enabled, is_active,
         workflow_scope, domain_slug, created_by, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      returning *
      `,
      [
        analyst.id, analyst.organization_slug, analyst.slug,
        analyst.display_name, analyst.display_name, analyst.persona_prompt,
        analyst.analyst_type, analyst.default_weight,
        JSON.stringify(analyst.tier_instructions), analyst.is_system_default,
        analyst.is_enabled, analyst.is_active, analyst.workflow_scope,
        analyst.domain_slug, analyst.created_by, analyst.created_at, analyst.updated_at,
      ],
    );
    if (insert.error) {
      throw new Error(insert.error.message);
    }
    const rows = (insert.data as MarketAnalyst[] | null) ?? [];
    const created = rows[0] as MarketAnalyst;

    // Create initial config version for lineage tracking
    const versionId = randomUUID();
    await this.db.rawQuery(
      `insert into prediction.analyst_config_versions
        (id, analyst_id, organization_slug, version_number, persona_prompt,
         tier_instructions, default_weight, source, change_reason, is_active, created_by, created_at)
       values ($1, $2, $3, 1, $4, $5, $6, 'manual', 'Initial creation', true, $7, $8)
       on conflict do nothing`,
      [
        versionId, created.id, created.organization_slug,
        created.persona_prompt, JSON.stringify(created.tier_instructions),
        created.default_weight, created.created_by, created.created_at,
      ],
    );

    // Link the version back to the analyst
    await this.db.rawQuery(
      `update prediction.market_analysts set current_config_version_id = $1 where id = $2`,
      [versionId, created.id],
    );

    return created;
  }

  async updateAnalyst(input: {
    organizationSlug: string;
    userId: string;
    analystId: string;
    personaPrompt?: string;
    defaultWeight?: number;
    tierInstructions?: Record<string, string>;
    isEnabled?: boolean;
    changeReason?: string;
  }): Promise<MarketAnalyst> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    // Load current analyst
    const current = await this.db.rawQuery(
      `select * from prediction.market_analysts where id = $1 and organization_slug = $2`,
      [input.analystId, input.organizationSlug],
    );
    if (current.error) throw new Error(current.error.message);
    const analyst = ((current.data as MarketAnalyst[] | null) ?? [])[0];
    if (!analyst) throw new BadRequestException('Analyst not found');

    // Build updates
    const newPrompt = input.personaPrompt ?? analyst.persona_prompt;
    const newWeight = input.defaultWeight ?? analyst.default_weight;
    const newTier = input.tierInstructions ?? analyst.tier_instructions;
    const newEnabled = input.isEnabled ?? analyst.is_enabled;

    // Create new config version
    const versionId = randomUUID();
    const versionResult = await this.db.rawQuery(
      `insert into prediction.analyst_config_versions
        (id, analyst_id, organization_slug, version_number, persona_prompt,
         tier_instructions, default_weight, source, change_reason,
         parent_version_id, is_active, created_by, created_at)
       values ($1, $2, $3,
         coalesce((select max(version_number) + 1 from prediction.analyst_config_versions where analyst_id = $2), 1),
         $4, $5, $6, 'manual', $7, $8, true, $9, $10)
       returning version_number`,
      [
        versionId, input.analystId, input.organizationSlug,
        newPrompt, JSON.stringify(newTier), newWeight,
        input.changeReason || 'Manual update',
        analyst.current_config_version_id, input.userId, new Date().toISOString(),
      ],
    );
    if (versionResult.error) throw new Error(versionResult.error.message);

    // Deactivate previous version
    if (analyst.current_config_version_id) {
      await this.db.rawQuery(
        `update prediction.analyst_config_versions set is_active = false where id = $1`,
        [analyst.current_config_version_id],
      );
    }

    // Update analyst with new values
    const update = await this.db.rawQuery(
      `update prediction.market_analysts
       set persona_prompt = $1, default_weight = $2, tier_instructions = $3,
           is_enabled = $4, current_config_version_id = $5, updated_at = $6
       where id = $7 and organization_slug = $8
       returning *`,
      [newPrompt, newWeight, JSON.stringify(newTier), newEnabled, versionId, new Date().toISOString(), input.analystId, input.organizationSlug],
    );
    if (update.error) throw new Error(update.error.message);
    return ((update.data as MarketAnalyst[] | null) ?? [])[0] as MarketAnalyst;
  }

  async rollbackAnalyst(input: {
    organizationSlug: string;
    userId: string;
    analystId: string;
  }): Promise<MarketAnalyst> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    // Find current version's parent
    const current = await this.db.rawQuery(
      `select acv.parent_version_id
       from prediction.market_analysts ma
       join prediction.analyst_config_versions acv on acv.id = ma.current_config_version_id
       where ma.id = $1 and ma.organization_slug = $2`,
      [input.analystId, input.organizationSlug],
    );
    const rows = (current.data as Array<{ parent_version_id: string | null }> | null) ?? [];
    if (rows.length === 0 || !rows[0].parent_version_id) {
      throw new BadRequestException('No previous version to rollback to');
    }
    const parentVersionId = rows[0].parent_version_id;

    // Load parent version
    const parent = await this.db.rawQuery(
      `select * from prediction.analyst_config_versions where id = $1`,
      [parentVersionId],
    );
    const parentRows = (parent.data as Array<{ persona_prompt: string; tier_instructions: unknown; default_weight: number }> | null) ?? [];
    if (parentRows.length === 0) throw new BadRequestException('Parent version not found');
    const prev = parentRows[0];

    // Deactivate current, activate parent
    await this.db.rawQuery(
      `update prediction.analyst_config_versions set is_active = false
       where analyst_id = $1 and organization_slug = $2 and is_active = true`,
      [input.analystId, input.organizationSlug],
    );
    await this.db.rawQuery(
      `update prediction.analyst_config_versions set is_active = true where id = $1`,
      [parentVersionId],
    );

    // Update analyst to parent values
    const update = await this.db.rawQuery(
      `update prediction.market_analysts
       set persona_prompt = $1, default_weight = $2, tier_instructions = $3,
           current_config_version_id = $4, updated_at = $5
       where id = $6 and organization_slug = $7
       returning *`,
      [prev.persona_prompt, prev.default_weight, JSON.stringify(prev.tier_instructions), parentVersionId, new Date().toISOString(), input.analystId, input.organizationSlug],
    );
    if (update.error) throw new Error(update.error.message);
    return ((update.data as MarketAnalyst[] | null) ?? [])[0] as MarketAnalyst;
  }

  async listAnalysts(
    organizationSlug: string,
    userId: string,
  ): Promise<MarketAnalyst[]> {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    const result = await this.db.rawQuery(
      `
      select *
      from prediction.market_analysts
      where (organization_slug = $1 or organization_slug = '__base__')
      order by case when organization_slug = $1 then 0 else 1 end, created_at asc
      `,
      [organizationSlug],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as MarketAnalyst[]) ?? [];
  }

  async listAnalystsForInstrument(
    organizationSlug: string,
    userId: string,
    instrumentId: string,
  ): Promise<MarketAnalyst[]> {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    const result = await this.db.rawQuery(
      `
      select a.*
      from prediction.market_instrument_analyst_assignments ia
      join prediction.market_analysts a on a.id = ia.analyst_id
      where (ia.organization_slug = $1 or ia.organization_slug = '__base__')
        and ia.instrument_id = $2
      order by case when ia.organization_slug = $1 then 0 else 1 end, ia.created_at asc
      `,
      [organizationSlug, instrumentId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as MarketAnalyst[] | null) ?? [];
  }

  async assignAnalystToInstrument(
    input: AssignAnalystInput,
  ): Promise<{ assigned: boolean }> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    const upsert = await this.db.rawQuery(
      `
      insert into prediction.market_instrument_analyst_assignments
        (organization_slug, instrument_id, analyst_id, assigned_by)
      values ($1, $2, $3, $4)
      on conflict (organization_slug, instrument_id, analyst_id)
      do update set assigned_by = excluded.assigned_by
      `,
      [input.organizationSlug, input.instrumentId, input.analystId, input.userId],
    );
    if (upsert.error) {
      throw new Error(upsert.error.message);
    }
    return { assigned: true };
  }

  async listEntitledSources(
    organizationSlug: string,
    userId: string,
  ): Promise<Array<MarketSource & { entitlement: SourceEntitlement | null }>> {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    const sources = await this.db.rawQuery(
      `
      select *
      from prediction.source_catalog
      order by display_name asc
      `,
    );
    if (sources.error) {
      throw new Error(sources.error.message);
    }

    const entitlements = await this.db.rawQuery(
      `
      select *
      from prediction.tenant_source_entitlements
      where (organization_slug = $1 or organization_slug = '__base__')
      `,
      [organizationSlug],
    );
    if (entitlements.error) {
      throw new Error(entitlements.error.message);
    }

    const entitlementBySourceId = new Map<string, SourceEntitlement>();
    for (const row of (entitlements.data as SourceEntitlement[] | null) ?? []) {
      entitlementBySourceId.set(row.source_id, row);
    }

    return ((sources.data as MarketSource[] | null) ?? []).map((source) => ({
      ...source,
      entitlement: entitlementBySourceId.get(source.id) ?? null,
    }));
  }

  async upsertSourceEntitlement(
    input: UpsertSourceEntitlementInput,
  ): Promise<SourceEntitlement> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    const payload = {
      organization_slug: input.organizationSlug,
      source_id: input.sourceId,
      is_enabled: input.isEnabled,
      override_notes: input.overrideNotes ?? null,
      created_by: input.userId,
      updated_at: new Date().toISOString(),
    };
    const upsert = await this.db.rawQuery(
      `
      insert into prediction.tenant_source_entitlements
        (organization_slug, source_id, is_enabled, override_notes, created_by, updated_at)
      values ($1, $2, $3, $4, $5, $6)
      on conflict (organization_slug, source_id)
      do update set
        is_enabled = excluded.is_enabled,
        override_notes = excluded.override_notes,
        created_by = excluded.created_by,
        updated_at = excluded.updated_at
      returning *
      `,
      [
        payload.organization_slug,
        payload.source_id,
        payload.is_enabled,
        payload.override_notes,
        payload.created_by,
        payload.updated_at,
      ],
    );
    if (upsert.error) {
      throw new Error(upsert.error.message);
    }
    const rows = (upsert.data as SourceEntitlement[] | null) ?? [];
    return rows[0] as SourceEntitlement;
  }

  async syncExternalCrawlerData(
    input: ExternalCrawlerSyncInput,
  ): Promise<ExternalCrawlerSyncResult> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    const enabled = this.isExternalCrawlerSyncEnabled(Boolean(input.force));
    const externalOrganizationSlug = this.getExternalCrawlerOrgSlug();
    if (!enabled || !externalOrganizationSlug) {
      return {
        enabled,
        externalOrganizationSlug,
        sourceRowsProcessed: 0,
        articleRowsProcessed: 0,
        totalSyncedSources: 0,
        totalSyncedArticles: 0,
        syncedAt: new Date().toISOString(),
        message:
          'External crawler sync skipped. Enable MARKETS_EXTERNAL_SYNC_ENABLED and set MARKETS_EXTERNAL_SYNC_ORG_SLUG.',
      };
    }

    const sourceLimit = this.getExternalCrawlerLimit(
      'MARKETS_EXTERNAL_SOURCE_LIMIT',
      500,
      5000,
    );
    const articleLimit = this.getExternalCrawlerLimit(
      'MARKETS_EXTERNAL_ARTICLE_LIMIT',
      5000,
      50000,
    );
    const lookbackDays = this.getExternalCrawlerLookbackDays();

    const sourceUpsert = await this.db.rawQuery(
      `
      with staged_sources as (
        select
          s.id::text as external_source_id,
          lower(regexp_replace(coalesce(s.name, s.id::text), '[^a-zA-Z0-9]+', '_', 'g')) || '_' || left(s.id::text, 8) as source_key,
          coalesce(nullif(trim(s.name), ''), 'External source ' || left(s.id::text, 8)) as display_name,
          s.url as base_url,
          case
            when s.source_type in ('api', 'twitter_search') then 'premium'
            else 'standard'
          end as tier,
          coalesce(s.created_at, now()) as created_at
        from crawler.sources s
        where s.organization_slug = $1
          and coalesce(s.is_test, false) = false
        order by coalesce(s.updated_at, s.created_at, now()) desc
        limit $2
      ),
      upserted as (
        insert into prediction.source_catalog
          (id, source_key, display_name, base_url, tier, is_global_default, created_at, source_origin, external_source_id)
        select
          'orchestrator_source_' || external_source_id,
          source_key,
          display_name,
          base_url,
          tier,
          true,
          created_at,
          'orchestrator_crawler',
          external_source_id
        from staged_sources
        on conflict (id)
        do update set
          source_key = excluded.source_key,
          display_name = excluded.display_name,
          base_url = excluded.base_url,
          tier = excluded.tier,
          is_global_default = excluded.is_global_default,
          source_origin = excluded.source_origin,
          external_source_id = excluded.external_source_id
        returning id
      )
      select count(*)::int as processed_count
      from upserted
      `,
      [externalOrganizationSlug, sourceLimit],
    );
    if (sourceUpsert.error) {
      throw new Error(sourceUpsert.error.message);
    }
    const sourceRowsProcessed =
      ((sourceUpsert.data as Array<{ processed_count: number }> | null) ?? [])[0]
        ?.processed_count ?? 0;

    const articleUpsert = await this.db.rawQuery(
      `
      with staged_articles as (
        select
          a.id::text as external_article_id,
          a.source_id::text as external_source_id,
          a.organization_slug as external_organization_slug,
          a.title,
          a.url,
          a.summary,
          a.author,
          a.content,
          a.content_hash,
          a.published_at,
          coalesce(a.first_seen_at, now()) as first_seen_at,
          coalesce(a.metadata, '{}'::jsonb) as metadata
        from crawler.articles a
        where a.organization_slug = $1
          and coalesce(a.is_test, false) = false
          and coalesce(a.published_at, a.first_seen_at, now()) >= now() - ($3::text || ' days')::interval
        order by coalesce(a.published_at, a.first_seen_at, now()) desc
        limit $2
      ),
      joined as (
        select
          sa.*,
          sc.id as source_id
        from staged_articles sa
        join prediction.source_catalog sc
          on sc.source_origin = 'orchestrator_crawler'
         and sc.external_source_id = sa.external_source_id
      ),
      upserted as (
        insert into prediction.market_articles
          (
            id,
            external_article_id,
            external_source_id,
            source_id,
            source_origin,
            external_organization_slug,
            title,
            url,
            summary,
            author,
            content,
            content_hash,
            published_at,
            first_seen_at,
            metadata,
            updated_at
          )
        select
          'orchestrator_article_' || external_article_id,
          external_article_id,
          external_source_id,
          source_id,
          'orchestrator_crawler',
          external_organization_slug,
          title,
          url,
          summary,
          author,
          content,
          content_hash,
          published_at,
          first_seen_at,
          metadata,
          now()
        from joined
        on conflict (external_article_id)
        do update set
          external_source_id = excluded.external_source_id,
          source_id = excluded.source_id,
          title = excluded.title,
          url = excluded.url,
          summary = excluded.summary,
          author = excluded.author,
          content = excluded.content,
          content_hash = excluded.content_hash,
          published_at = excluded.published_at,
          first_seen_at = excluded.first_seen_at,
          metadata = excluded.metadata,
          updated_at = now()
        returning id
      )
      select count(*)::int as processed_count
      from upserted
      `,
      [externalOrganizationSlug, articleLimit, lookbackDays],
    );
    if (articleUpsert.error) {
      throw new Error(articleUpsert.error.message);
    }
    const articleRowsProcessed =
      ((articleUpsert.data as Array<{ processed_count: number }> | null) ?? [])[0]
        ?.processed_count ?? 0;

    const sourceTotals = await this.db.rawQuery(
      `
      select count(*)::int as total
      from prediction.source_catalog
      where source_origin = 'orchestrator_crawler'
      `,
    );
    if (sourceTotals.error) {
      throw new Error(sourceTotals.error.message);
    }

    const articleTotals = await this.db.rawQuery(
      `
      select count(*)::int as total
      from prediction.market_articles
      where source_origin = 'orchestrator_crawler'
        and external_organization_slug = $1
      `,
      [externalOrganizationSlug],
    );
    if (articleTotals.error) {
      throw new Error(articleTotals.error.message);
    }

    return {
      enabled,
      externalOrganizationSlug,
      sourceRowsProcessed,
      articleRowsProcessed,
      totalSyncedSources:
        ((sourceTotals.data as Array<{ total: number }> | null) ?? [])[0]?.total ?? 0,
      totalSyncedArticles:
        ((articleTotals.data as Array<{ total: number }> | null) ?? [])[0]?.total ?? 0,
      syncedAt: new Date().toISOString(),
      message:
        'External crawler source/article sync completed from orchestrator schema.',
    };
  }

  async listMarketArticles(input: ListMarketArticlesInput): Promise<MarketArticle[]> {
    await this.schema.ensureSchema();
    await this.requireRead(input.userId, input.organizationSlug);

    const limit =
      input.limit && Number.isFinite(input.limit)
        ? Math.min(Math.max(Math.floor(input.limit), 1), 200)
        : 50;
    const values: Array<string | number> = [limit];
    const filters = ['1=1'];
    if (input.sourceId) {
      values.push(input.sourceId);
      filters.push(`source_id = $${values.length}`);
    }

    const result = await this.db.rawQuery(
      `
      select *
      from prediction.market_articles
      where ${filters.join(' and ')}
      order by coalesce(published_at, first_seen_at) desc
      limit $1
      `,
      values,
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as MarketArticle[] | null) ?? [];
  }

  async scoreArticleForInstrument(input: ScorePredictorInput): Promise<ScorePredictorResult> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    // 1. Validate article exists and tenant has source entitlement
    const articleResult = await this.db.rawQuery(
      `select ma.id, ma.title, ma.summary, ma.content, ma.source_id
       from prediction.market_articles ma
       join prediction.source_catalog sc on sc.id = ma.source_id
       join prediction.tenant_source_entitlements tse
         on tse.source_id = sc.id and tse.organization_slug = $1 and tse.is_enabled = true
       where ma.id = $2`,
      [input.organizationSlug, input.articleId],
    );
    if (articleResult.error) throw new Error(articleResult.error.message);
    const articles = (articleResult.data as Array<{ id: string; title: string | null; summary: string | null; content: string | null }> | null) ?? [];
    if (articles.length === 0) {
      throw new ForbiddenException('Article not found or source not entitled for this organization');
    }
    const article = articles[0];

    // 2. Load instrument
    const instResult = await this.db.rawQuery(
      `select symbol, name, asset_type from prediction.instruments where id = $1 and organization_slug = $2`,
      [input.instrumentId, input.organizationSlug],
    );
    if (instResult.error) throw new Error(instResult.error.message);
    const instruments = (instResult.data as Array<{ symbol: string; name: string; asset_type: string }> | null) ?? [];
    if (instruments.length === 0) throw new BadRequestException('Instrument not found');
    const instrument = instruments[0];

    // 3. LLM scoring
    const context = this.marketsLlm.buildExecutionContext(input.organizationSlug, input.userId, 'predictor-scoring');
    const articleText = [article.title, article.summary, article.content?.slice(0, 1000)].filter(Boolean).join('\n');

    let relevanceScore = 0.5;
    let rationale = 'Deterministic default score';
    let dismissed = false;

    if (this.marketsLlm.isLlmEnabled()) {
      const llmResult = await this.marketsLlm.generateText(
        context,
        `You are scoring the relevance of a news article to a specific financial instrument.
Respond with valid JSON:
{
  "relevance": <number 0.0-1.0, where 0=irrelevant, 1=highly relevant>,
  "rationale": "<brief explanation>",
  "dismiss": <boolean, true if article is clearly irrelevant>
}
Respond ONLY with valid JSON.`,
        `Score this article's relevance to ${instrument.symbol} (${instrument.name}, ${instrument.asset_type}):\n\n${articleText}`,
      );

      try {
        const match = llmResult.text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as Record<string, unknown>;
          relevanceScore = Math.min(1, Math.max(0, Number(parsed['relevance']) || 0.5));
          rationale = String(parsed['rationale'] || llmResult.text.slice(0, 500));
          dismissed = Boolean(parsed['dismiss']);
        }
      } catch {
        rationale = llmResult.text.slice(0, 500);
      }
    }

    // 4. Upsert predictor
    const predictor = await this.upsertPredictor({
      organizationSlug: input.organizationSlug,
      userId: input.userId,
      instrumentId: input.instrumentId,
      articleId: input.articleId,
      relevanceScore,
      rationale,
      status: dismissed ? 'dismissed' : 'active',
    });

    return { predictor, relevanceScore, rationale, dismissed };
  }

  async scoreArticleBatch(input: ScorePredictorBatchInput): Promise<ScorePredictorBatchResult> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    const results: Array<ScorePredictorResult | { articleId: string; error: string }> = [];
    let scored = 0;
    let failed = 0;

    for (const articleId of input.articleIds) {
      try {
        const result = await this.scoreArticleForInstrument({
          organizationSlug: input.organizationSlug,
          userId: input.userId,
          instrumentId: input.instrumentId,
          articleId,
        });
        results.push(result);
        scored++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ articleId, error: msg });
        failed++;
      }
    }

    return { results, scored, failed };
  }

  async upsertPredictor(input: UpsertPredictorInput): Promise<MarketPredictor> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    const relevance = Math.min(
      1,
      Math.max(0, Number(input.relevanceScore)),
    );
    if (!Number.isFinite(relevance)) {
      throw new BadRequestException('relevanceScore must be a number between 0 and 1');
    }
    const status = input.status ?? 'active';
    if (status !== 'active' && status !== 'dismissed') {
      throw new BadRequestException('status must be active or dismissed');
    }

    const instrument = await this.db
      .from('prediction', 'instruments')
      .select('id')
      .eq('id', input.instrumentId)
      .eq('organization_slug', input.organizationSlug)
      .maybeSingle();
    if (instrument.error) {
      throw new Error(instrument.error.message);
    }
    if (!instrument.data) {
      throw new NotFoundException('Instrument not found for organization');
    }

    const article = await this.db
      .from('prediction', 'market_articles')
      .select('id, external_organization_slug')
      .eq('id', input.articleId)
      .maybeSingle();
    if (article.error) {
      throw new Error(article.error.message);
    }
    const articleRow = article.data as
      | { id: string; external_organization_slug: string }
      | null;
    if (!articleRow) {
      throw new NotFoundException('Article not found');
    }
    if (articleRow.external_organization_slug !== input.organizationSlug) {
      throw new BadRequestException(
        'Article tenant does not match organization (external_organization_slug)',
      );
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const insert = await this.db.rawQuery(
      `
      insert into prediction.market_predictors
        (id, organization_slug, instrument_id, article_id, relevance_score, status, rationale, created_by, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (organization_slug, instrument_id, article_id)
      do update set
        relevance_score = excluded.relevance_score,
        status = excluded.status,
        rationale = excluded.rationale,
        updated_at = now()
      returning *
      `,
      [
        id,
        input.organizationSlug,
        input.instrumentId,
        input.articleId,
        relevance,
        status,
        input.rationale ?? null,
        input.userId,
        now,
        now,
      ],
    );
    if (insert.error) {
      throw new Error(insert.error.message);
    }
    const rows = (insert.data as MarketPredictor[] | null) ?? [];
    const row = rows[0];
    if (!row) {
      throw new Error('Predictor upsert returned no row');
    }
    return row;
  }

  async listPredictors(input: ListPredictorsInput): Promise<MarketPredictor[]> {
    await this.schema.ensureSchema();
    await this.requireRead(input.userId, input.organizationSlug);

    const statusFilter = input.status ?? 'active';
    const values: Array<string> = [
      input.organizationSlug,
      input.instrumentId,
    ];
    let statusClause = "and mp.status = 'active'";
    if (statusFilter === 'dismissed') {
      statusClause = "and mp.status = 'dismissed'";
    } else if (statusFilter === 'all') {
      statusClause = '';
    }

    const result = await this.db.rawQuery(
      `
      select mp.*
      from prediction.market_predictors mp
      where (mp.organization_slug = $1 or mp.organization_slug = '__base__')
        and mp.instrument_id = $2
        ${statusClause}
      order by mp.relevance_score desc, mp.updated_at desc
      `,
      values,
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as MarketPredictor[] | null) ?? [];
  }

  async enqueueRun(input: CreateRunInput): Promise<{ runId: string; status: string }> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    const context = this.buildExecutionContext(
      input.organizationSlug,
      input.userId,
      input.runType,
    );
    const existingQueued = await this.db
      .from('prediction', 'orchestration_runs')
      .select('*')
      .eq('organization_slug', input.organizationSlug)
      .eq('instrument_id', input.instrumentId)
      .eq('run_type', input.runType)
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existingQueued.error) {
      throw new Error(existingQueued.error.message);
    }
    if (existingQueued.data) {
      const existingRun = existingQueued.data as MarketRun;
      await this.emitDeduplicatedQueueEvent(
        context,
        existingRun.id,
        input.instrumentId,
        input.runType,
      );
      return { runId: existingRun.id, status: 'queued' };
    }

    const runId = randomUUID();
    const insert = await this.db.from('prediction', 'orchestration_runs').insert({
      id: runId,
      organization_slug: input.organizationSlug,
      instrument_id: input.instrumentId,
      run_type: input.runType,
      status: 'queued',
      requested_by: input.userId,
      updated_at: new Date().toISOString(),
    });
    if (insert.error) {
      if (insert.error.message.includes('duplicate key value violates unique constraint')) {
        const duplicate = await this.db
          .from('prediction', 'orchestration_runs')
          .select('*')
          .eq('organization_slug', input.organizationSlug)
          .eq('instrument_id', input.instrumentId)
          .eq('run_type', input.runType)
          .eq('status', 'queued')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (duplicate.error) {
          throw new Error(duplicate.error.message);
        }
        if (duplicate.data) {
          const existingRun = duplicate.data as MarketRun;
          await this.emitDeduplicatedQueueEvent(
            context,
            existingRun.id,
            input.instrumentId,
            input.runType,
          );
          return { runId: existingRun.id, status: 'queued' };
        }
      }
      throw new Error(insert.error.message);
    }

    await this.observability.push({
      context,
      source_app: 'divinr-api',
      hook_event_type: 'markets.orchestration.queued',
      status: 'queued',
      message: `${input.runType} run queued`,
      progress: 0,
      step: 'queued',
      payload: {
        runId,
        instrumentId: input.instrumentId,
        runType: input.runType,
      },
      timestamp: Date.now(),
    });

    return { runId, status: 'queued' };
  }

  async listRuns(input: ListRunsInput): Promise<MarketRun[]> {
    await this.schema.ensureSchema();
    await this.requireRead(input.userId, input.organizationSlug);

    let query = this.db
      .from('prediction', 'orchestration_runs')
      .select('*')
      .eq('organization_slug', input.organizationSlug)
      .order('created_at', { ascending: false });
    if (input.status) {
      query = query.eq('status', input.status);
    }

    const runs = await query;
    if (runs.error) {
      throw new Error(runs.error.message);
    }
    return (runs.data as MarketRun[]) ?? [];
  }

  async getRun(
    organizationSlug: string,
    userId: string,
    runId: string,
  ): Promise<MarketRun> {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    const run = await this.db
      .from('prediction', 'orchestration_runs')
      .select('*')
      .eq('id', runId)
      .eq('organization_slug', organizationSlug)
      .single();
    if (run.error || !run.data) {
      throw new NotFoundException('Run not found');
    }
    return run.data as MarketRun;
  }

  async updateRunStatus(
    input: UpdateRunStatusInput,
  ): Promise<{ runId: string; previousStatus: string; status: string }> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);
    if (
      input.status === 'failed' &&
      (!input.errorMessage || input.errorMessage.trim().length === 0)
    ) {
      throw new BadRequestException(
        'errorMessage is required when status is failed',
      );
    }

    const existing = await this.db
      .from('prediction', 'orchestration_runs')
      .select('*')
      .eq('id', input.runId)
      .eq('organization_slug', input.organizationSlug)
      .single();
    if (existing.error || !existing.data) {
      throw new NotFoundException('Run not found');
    }
    const run = existing.data as MarketRun;
    const allowedNextStatuses = this.allowedTransitions[run.status];
    if (!allowedNextStatuses.includes(input.status)) {
      throw new BadRequestException(
        `Invalid status transition from ${run.status} to ${input.status}`,
      );
    }

    const transition = await this.db.rawQuery(
      `
      update prediction.orchestration_runs
      set status = $1,
          updated_at = now(),
          started_at = case
            when $1 = 'running' and started_at is null then now()
            else started_at
          end,
          completed_at = case
            when $1 in ('completed', 'failed') then now()
            else completed_at
          end,
          last_error = case
            when $1 = 'failed' then nullif($5::text, '')
            else null
          end
      where id = $2
        and organization_slug = $3
        and status = $4
      returning id
      `,
      [
        input.status,
        input.runId,
        input.organizationSlug,
        run.status,
        input.errorMessage ?? null,
      ],
    );
    if (transition.error) {
      throw new Error(transition.error.message);
    }
    const transitionedRows =
      (transition.data as Array<{ id: string }> | null) ?? [];
    if (transitionedRows.length === 0) {
      const latest = await this.db
        .from('prediction', 'orchestration_runs')
        .select('status')
        .eq('id', input.runId)
        .eq('organization_slug', input.organizationSlug)
        .single();
      if (latest.error || !latest.data) {
        throw new NotFoundException('Run not found');
      }
      const latestStatus = (latest.data as { status: RunStatus }).status;
      throw new BadRequestException(
        `Invalid status transition from ${latestStatus} to ${input.status}`,
      );
    }

    const context = this.buildExecutionContext(
      input.organizationSlug,
      input.userId,
      run.run_type,
    );
    await this.observability.push({
      context,
      source_app: 'divinr-api',
      hook_event_type: 'markets.orchestration.status_changed',
      status: input.status,
      message: `${run.run_type} run status changed to ${input.status}`,
      progress: null,
      step: 'status_update',
      payload: {
        runId: input.runId,
        previousStatus: run.status,
        status: input.status,
        runType: run.run_type,
      },
      timestamp: Date.now(),
    });

    return {
      runId: input.runId,
      previousStatus: run.status,
      status: input.status,
    };
  }

  private async getPrimaryAnalystForRun(
    organizationSlug: string,
    run: MarketRun,
  ): Promise<MarketAnalyst | null> {
    const assignment = await this.db.rawQuery(
      `
      select analyst_id
      from prediction.market_instrument_analyst_assignments
      where organization_slug = $1
        and instrument_id = $2
      order by created_at asc
      limit 1
      `,
      [organizationSlug, run.instrument_id],
    );
    if (assignment.error) {
      throw new Error(assignment.error.message);
    }
    const assignmentRows =
      (assignment.data as Array<{ analyst_id?: string }> | null) ?? [];
    const analystId = assignmentRows[0]?.analyst_id;
    if (!analystId) {
      return null;
    }
    const analyst = await this.db.rawQuery(
      `
      select *
      from prediction.market_analysts
      where id = $1
        and organization_slug = $2
      limit 1
      `,
      [analystId, organizationSlug],
    );
    if (analyst.error) {
      throw new Error(analyst.error.message);
    }
    const analystRows = (analyst.data as MarketAnalyst[] | null) ?? [];
    return analystRows[0] ?? null;
  }

  private async getLatestRiskAssessmentForInstrument(
    organizationSlug: string,
    instrumentId: string,
  ): Promise<RiskAssessment | null> {
    const result = await this.db.rawQuery(
      `
      select *
      from prediction.market_risk_assessments
      where organization_slug = $1
        and instrument_id = $2
      order by created_at desc
      limit 1
      `,
      [organizationSlug, instrumentId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    const rows = (result.data as RiskAssessment[] | null) ?? [];
    return rows[0] ?? null;
  }

  private async getActivePredictorContextLines(
    organizationSlug: string,
    instrumentId: string,
  ): Promise<string[]> {
    const result = await this.db.rawQuery(
      `
      select mp.relevance_score, mp.rationale, ma.title
      from prediction.market_predictors mp
      join prediction.market_articles ma on ma.id = mp.article_id
      where mp.organization_slug = $1
        and mp.instrument_id = $2
        and mp.status = 'active'
      order by mp.relevance_score desc
      limit 20
      `,
      [organizationSlug, instrumentId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    const rows =
      (result.data as Array<{
        relevance_score: number;
        rationale: string | null;
        title: string | null;
      }> | null) ?? [];
    return rows.map((r, i) => {
      const title = r.title ?? '(untitled)';
      const note = r.rationale ? ` — ${r.rationale.slice(0, 200)}` : '';
      return `${i + 1}. relevance=${Number(r.relevance_score).toFixed(2)} ${title}${note}`;
    });
  }

  private buildPredictionPromptPrefix(opts: {
    risk: RiskAssessment | null;
    predictorLines: string[];
  }): string {
    const parts: string[] = [];
    if (opts.risk) {
      parts.push(
        `Latest risk context (from prior assessment): verdict=${opts.risk.verdict}, risk_score=${opts.risk.risk_score}. Summary: ${opts.risk.rationale.slice(0, 800)}`,
      );
    }
    if (opts.predictorLines.length > 0) {
      parts.push(
        `Active article predictors for this instrument:\n${opts.predictorLines.join('\n')}`,
      );
    }
    if (parts.length === 0) {
      return '';
    }
    return `Context:\n${parts.join('\n\n')}\n\n`;
  }

  private async createRunArtifact(input: {
    run: MarketRun;
    analyst: MarketAnalyst | null;
    prompt: string;
    outputText: string;
    modelProvider: string;
    modelName: string;
  }): Promise<RunArtifact> {
    const artifact: RunArtifact = {
      id: randomUUID(),
      run_id: input.run.id,
      organization_slug: input.run.organization_slug,
      run_type: input.run.run_type,
      analyst_id: input.analyst?.id ?? null,
      model_provider: input.modelProvider,
      model_name: input.modelName,
      prompt: input.prompt,
      output_text: input.outputText,
      created_at: new Date().toISOString(),
    };
    const insert = await this.db.rawQuery(
      `
      insert into prediction.market_run_artifacts
        (id, run_id, organization_slug, run_type, analyst_id, model_provider, model_name, prompt, output_text, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning *
      `,
      [
        artifact.id,
        artifact.run_id,
        artifact.organization_slug,
        artifact.run_type,
        artifact.analyst_id,
        artifact.model_provider,
        artifact.model_name,
        artifact.prompt,
        artifact.output_text,
        artifact.created_at,
      ],
    );
    if (insert.error) {
      throw new Error(insert.error.message);
    }
    const rows = (insert.data as RunArtifact[] | null) ?? [];
    return rows[0] as RunArtifact;
  }

  private async persistPredictionFromArtifact(
    run: MarketRun,
    outputText: string,
    analyst: MarketAnalyst | null,
  ): Promise<PredictionOutcome> {
    const lower = outputText.toLowerCase();
    const predictedDirection: 'up' | 'down' | 'flat' = lower.includes('down')
      ? 'down'
      : lower.includes('flat')
        ? 'flat'
        : 'up';
    const confidence = predictedDirection === 'flat' ? 55 : 67;
    const prediction: PredictionOutcome = {
      id: randomUUID(),
      run_id: run.id,
      organization_slug: run.organization_slug,
      instrument_id: run.instrument_id,
      analyst_id: analyst?.id ?? null,
      predicted_direction: predictedDirection,
      confidence,
      horizon_minutes: 240,
      rationale: outputText.slice(0, 1200),
      created_at: new Date().toISOString(),
    };
    const insert = await this.db.rawQuery(
      `
      insert into prediction.market_predictions
        (id, run_id, organization_slug, instrument_id, analyst_id, predicted_direction, confidence, horizon_minutes, rationale, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning *
      `,
      [
        prediction.id,
        prediction.run_id,
        prediction.organization_slug,
        prediction.instrument_id,
        prediction.analyst_id,
        prediction.predicted_direction,
        prediction.confidence,
        prediction.horizon_minutes,
        prediction.rationale,
        prediction.created_at,
      ],
    );
    if (insert.error) {
      throw new Error(insert.error.message);
    }
    const rows = (insert.data as PredictionOutcome[] | null) ?? [];
    return rows[0] as PredictionOutcome;
  }

  private async persistRiskFromArtifact(
    run: MarketRun,
    outputText: string,
  ): Promise<RiskAssessment> {
    const lower = outputText.toLowerCase();
    const verdict: 'low' | 'medium' | 'high' = lower.includes('high')
      ? 'high'
      : lower.includes('low')
        ? 'low'
        : 'medium';
    const riskScore = verdict === 'high' ? 78 : verdict === 'low' ? 24 : 52;
    const assessment: RiskAssessment = {
      id: randomUUID(),
      run_id: run.id,
      organization_slug: run.organization_slug,
      instrument_id: run.instrument_id,
      risk_score: riskScore,
      verdict,
      rationale: outputText.slice(0, 1200),
      created_at: new Date().toISOString(),
    };
    const insert = await this.db.rawQuery(
      `
      insert into prediction.market_risk_assessments
        (id, run_id, organization_slug, instrument_id, risk_score, verdict, rationale, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning *
      `,
      [
        assessment.id,
        assessment.run_id,
        assessment.organization_slug,
        assessment.instrument_id,
        assessment.risk_score,
        assessment.verdict,
        assessment.rationale,
        assessment.created_at,
      ],
    );
    if (insert.error) {
      throw new Error(insert.error.message);
    }
    const rows = (insert.data as RiskAssessment[] | null) ?? [];
    return rows[0] as RiskAssessment;
  }

  async processNextQueuedRun(
    input: ProcessNextRunInput,
  ): Promise<ProcessNextRunResult> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    const claimed = await this.db.rawQuery(
      `
      with next_run as (
        select id
        from prediction.orchestration_runs
        where organization_slug = $1
          and status = 'queued'
        order by created_at asc
        for update skip locked
        limit 1
      )
      update prediction.orchestration_runs r
      set status = 'running',
          updated_at = now(),
          started_at = coalesce(started_at, now()),
          last_error = null
      from next_run
      where r.id = next_run.id
      returning r.*
      `,
      [input.organizationSlug],
    );
    if (claimed.error) {
      throw new Error(claimed.error.message);
    }
    const run = ((claimed.data as MarketRun[] | null) ?? [])[0];
    if (!run) {
      return { processed: false };
    }

    const context = this.buildExecutionContext(
      input.organizationSlug,
      input.userId,
      run.run_type,
    );
    try {
      await this.observability.push({
        context,
        source_app: 'divinr-api',
        hook_event_type: 'markets.orchestration.status_changed',
        status: 'running',
        message: `${run.run_type} run status changed to running`,
        progress: null,
        step: 'status_update',
        payload: {
          runId: run.id,
          previousStatus: 'queued',
          status: 'running',
          runType: run.run_type,
        },
        timestamp: Date.now(),
      });

      const instrument = await this.db
        .from('prediction', 'instruments')
        .select('*')
        .eq('id', run.instrument_id)
        .eq('organization_slug', run.organization_slug)
        .single();
      if (instrument.error || !instrument.data) {
        throw new Error('Run instrument not found');
      }

      const instrumentData = instrument.data as MarketInstrument;

      let artifactId: string | undefined;

      if (run.run_type === 'risk') {
        // Delegate to risk runner — full dimension-based pipeline
        const riskResult = await this.riskRunner.executeRiskRun(run, instrumentData, input.userId);
        artifactId = riskResult.compositeScore.id;
      } else {
        // Delegate to prediction runner — multi-analyst pipeline + arbitrator
        const predResult = await this.predictionRunner.executePredictionRun(run, instrumentData, input.userId);
        artifactId = predResult.artifactIds[0];
      }

      await this.updateRunStatus({
        organizationSlug: input.organizationSlug,
        userId: input.userId,
        runId: run.id,
        status: 'completed',
      });

      await this.observability.push({
        context,
        source_app: 'divinr-api',
        hook_event_type: 'markets.orchestration.processed',
        status: 'completed',
        message: `${run.run_type} run processed`,
        progress: 100,
        step: 'processed',
        payload: {
          runId: run.id,
          runType: run.run_type,
          artifactId,
        },
        timestamp: Date.now(),
      });

      return {
        processed: true,
        runId: run.id,
        status: 'completed',
        runType: run.run_type,
        artifactId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.updateRunStatus({
        organizationSlug: input.organizationSlug,
        userId: input.userId,
        runId: run.id,
        status: 'failed',
        errorMessage: message,
      });
      throw error;
    }
  }

  async processQueuedRuns(input: ProcessRunsInput): Promise<ProcessRunsResult> {
    const requested = Math.max(1, Math.min(100, input.maxRuns ?? 1));
    const results: ProcessNextRunResult[] = [];

    for (let i = 0; i < requested; i += 1) {
      const result = await this.processNextQueuedRun({
        organizationSlug: input.organizationSlug,
        userId: input.userId,
      });
      results.push(result);
      if (!result.processed) {
        break;
      }
    }

    return {
      requested,
      processedCount: results.filter((r) => r.processed).length,
      results,
    };
  }

  async evaluateRun(input: EvaluateRunInput): Promise<RunEvaluation> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    const run = await this.getRun(input.organizationSlug, input.userId, input.runId);
    const prediction = await this.db.rawQuery(
      `
      select *
      from prediction.market_predictions
      where run_id = $1
        and organization_slug = $2
      order by created_at desc
      limit 1
      `,
      [run.id, input.organizationSlug],
    );
    if (prediction.error) {
      throw new Error(prediction.error.message);
    }
    const predictionRows =
      (prediction.data as Array<{ predicted_direction?: 'up' | 'down' | 'flat' }> | null) ?? [];
    const predictedDirection = predictionRows[0]?.predicted_direction;
    const evaluation: RunEvaluation = {
      id: randomUUID(),
      run_id: run.id,
      organization_slug: input.organizationSlug,
      actual_direction: input.actualDirection,
      predicted_direction: predictedDirection ?? null,
      was_correct:
        predictedDirection !== undefined ? predictedDirection === input.actualDirection : null,
      notes:
        predictedDirection !== undefined
          ? null
          : 'No prediction artifact exists for this run',
      created_at: new Date().toISOString(),
    };
    const insert = await this.db.rawQuery(
      `
      insert into prediction.market_run_evaluations
        (id, run_id, organization_slug, actual_direction, predicted_direction, was_correct, notes, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning *
      `,
      [
        evaluation.id,
        evaluation.run_id,
        evaluation.organization_slug,
        evaluation.actual_direction,
        evaluation.predicted_direction,
        evaluation.was_correct,
        evaluation.notes,
        evaluation.created_at,
      ],
    );
    if (insert.error) {
      throw new Error(insert.error.message);
    }
    const rows = (insert.data as RunEvaluation[] | null) ?? [];
    return rows[0] as RunEvaluation;
  }

  async listRunArtifacts(input: ListRunArtifactsInput): Promise<RunArtifact[]> {
    await this.schema.ensureSchema();
    await this.requireRead(input.userId, input.organizationSlug);

    const result = await this.db.rawQuery(
      `
      select *
      from prediction.market_run_artifacts
      where organization_slug = $1
        and run_id = $2
      order by created_at asc
      `,
      [input.organizationSlug, input.runId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as RunArtifact[] | null) ?? [];
  }

  async listPredictionOutcomes(
    input: ListPredictionOutcomesInput,
  ): Promise<PredictionOutcome[]> {
    await this.schema.ensureSchema();
    await this.requireRead(input.userId, input.organizationSlug);
    if (!input.runId && !input.instrumentId) {
      throw new BadRequestException('runId or instrumentId is required');
    }

    const filters: string[] = ['organization_slug = $1'];
    const values: unknown[] = [input.organizationSlug];
    if (input.runId) {
      filters.push(`run_id = $${values.length + 1}`);
      values.push(input.runId);
    }
    if (input.instrumentId) {
      filters.push(`instrument_id = $${values.length + 1}`);
      values.push(input.instrumentId);
    }
    const result = await this.db.rawQuery(
      `
      select *
      from prediction.market_predictions
      where ${filters.join(' and ')}
      order by created_at desc
      `,
      values,
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as PredictionOutcome[] | null) ?? [];
  }

  /**
   * Get the latest predictions grouped by instrument, with all analyst stances.
   * Used by the dashboard to show prediction cards.
   */
  async getDashboardPredictions(
    organizationSlug: string,
    userId: string,
  ): Promise<Array<{
    instrument_id: string;
    symbol: string;
    name: string;
    run_id: string;
    created_at: string;
    arbitrator: { direction: string; confidence: number; rationale: string } | null;
    analysts: Array<{
      analyst_id: string;
      analyst_name: string;
      analyst_slug: string;
      direction: string;
      confidence: number;
      rationale: string;
      key_factors: unknown;
      risks: unknown;
    }>;
  }>> {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    // Get latest prediction run per instrument
    const runsResult = await this.db.rawQuery(
      `
      select distinct on (instrument_id)
        r.id as run_id, r.instrument_id, r.created_at,
        i.symbol, i.name
      from prediction.orchestration_runs r
      join prediction.instruments i on i.id = r.instrument_id
      where (r.organization_slug = $1 or r.organization_slug = '__base__')
        and r.run_type = 'prediction'
        and r.status = 'completed'
      order by r.instrument_id, r.completed_at desc
      `,
      [organizationSlug],
    );
    if (runsResult.error) throw new Error(runsResult.error.message);
    const runs = (runsResult.data as Array<{ run_id: string; instrument_id: string; created_at: string; symbol: string; name: string }>) ?? [];

    const dashboardPredictions = [];

    for (const run of runs) {
      // Get all predictions for this run
      const predsResult = await this.db.rawQuery(
        `
        select mp.predicted_direction, mp.confidence, mp.rationale, mp.role,
               mp.analyst_id, mp.key_factors, mp.risks,
               ma.display_name as analyst_name, ma.slug as analyst_slug
        from prediction.market_predictions mp
        left join prediction.market_analysts ma on ma.id = mp.analyst_id
        where mp.run_id = $1
          and (mp.organization_slug = $2 or mp.organization_slug = '__base__')
        order by mp.role, mp.created_at
        `,
        [run.run_id, organizationSlug],
      );
      if (predsResult.error) continue;
      const preds = (predsResult.data as Array<Record<string, unknown>>) ?? [];

      const arbitratorPred = preds.find(p => p.role === 'arbitrator');
      const analystPreds = preds.filter(p => p.role === 'analyst' || p.role === 'paper');

      dashboardPredictions.push({
        instrument_id: run.instrument_id,
        symbol: run.symbol,
        name: run.name,
        run_id: run.run_id,
        created_at: run.created_at,
        arbitrator: arbitratorPred ? {
          direction: String(arbitratorPred.predicted_direction),
          confidence: Number(arbitratorPred.confidence),
          rationale: String(arbitratorPred.rationale || ''),
        } : null,
        analysts: analystPreds.map(p => ({
          analyst_id: String(p.analyst_id || ''),
          analyst_name: String(p.analyst_name || 'Unknown'),
          analyst_slug: String(p.analyst_slug || ''),
          direction: String(p.predicted_direction),
          confidence: Number(p.confidence),
          rationale: String(p.rationale || ''),
          key_factors: p.key_factors,
          risks: p.risks,
        })),
      });
    }

    return dashboardPredictions;
  }

  /**
   * Dashboard risk summary — latest composite score per instrument.
   */
  async getDashboardRiskSummary(
    organizationSlug: string,
    userId: string,
  ): Promise<Array<Record<string, unknown>>> {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    const result = await this.db.rawQuery(
      `
      select distinct on (cs.instrument_id)
        cs.id, cs.instrument_id, cs.run_id, cs.overall_score as risk_score,
        cs.confidence, cs.debate_adjustment,
        i.symbol, i.name,
        case
          when cs.overall_score <= 33 then 'low'
          when cs.overall_score <= 66 then 'medium'
          else 'high'
        end as verdict,
        cs.created_at
      from prediction.risk_composite_scores cs
      join prediction.instruments i on i.id = cs.instrument_id
      where (cs.organization_slug = $1 or cs.organization_slug = '__base__')
      order by cs.instrument_id, cs.created_at desc
      `,
      [organizationSlug],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Array<Record<string, unknown>>) ?? [];
  }

  async listRiskAssessments(
    input: ListRiskAssessmentsInput,
  ): Promise<RiskAssessment[]> {
    await this.schema.ensureSchema();
    await this.requireRead(input.userId, input.organizationSlug);
    if (!input.runId && !input.instrumentId) {
      throw new BadRequestException('runId or instrumentId is required');
    }

    const filters: string[] = ['organization_slug = $1'];
    const values: unknown[] = [input.organizationSlug];
    if (input.runId) {
      filters.push(`run_id = $${values.length + 1}`);
      values.push(input.runId);
    }
    if (input.instrumentId) {
      filters.push(`instrument_id = $${values.length + 1}`);
      values.push(input.instrumentId);
    }
    if (input.role && input.role !== 'all') {
      filters.push(`role = $${values.length + 1}`);
      values.push(input.role);
    }
    const result = await this.db.rawQuery(
      `
      select *
      from prediction.market_risk_assessments
      where ${filters.join(' and ')}
      order by created_at desc
      `,
      values,
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as RiskAssessment[] | null) ?? [];
  }

  async listRunEvaluations(
    organizationSlug: string,
    userId: string,
    runId: string,
  ): Promise<RunEvaluation[]> {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);
    const result = await this.db.rawQuery(
      `
      select *
      from prediction.market_run_evaluations
      where organization_slug = $1
        and run_id = $2
      order by created_at desc
      `,
      [organizationSlug, runId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as RunEvaluation[] | null) ?? [];
  }

  async listRunReplays(
    organizationSlug: string,
    userId: string,
    runId: string,
  ): Promise<RunReplay[]> {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);
    const result = await this.db.rawQuery(
      `
      select *
      from prediction.market_run_replays
      where organization_slug = $1
        and run_id = $2
      order by created_at desc
      `,
      [organizationSlug, runId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as RunReplay[] | null) ?? [];
  }

  async replayRun(input: ReplayRunInput): Promise<RunReplay> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);
    const run = await this.getRun(input.organizationSlug, input.userId, input.runId);
    const context = this.buildExecutionContext(
      input.organizationSlug,
      input.userId,
      run.run_type,
    );
    let replayOutput: string;
    if (this.isMarketsLlmEnabled()) {
      const replay = await this.generateLlmText(
        context,
        'You are replaying a market scenario for model validation.',
        `Replay run ${run.id} under scenario: ${input.scenario}`,
      );
      replayOutput = replay.text;
    } else {
      replayOutput = `Replay for scenario "${input.scenario}" indicates adjusted outcome confidence.`;
    }

    const replay: RunReplay = {
      id: randomUUID(),
      run_id: run.id,
      organization_slug: input.organizationSlug,
      scenario: input.scenario,
      replay_output: replayOutput,
      created_at: new Date().toISOString(),
    };
    const insert = await this.db.rawQuery(
      `
      insert into prediction.market_run_replays
        (id, run_id, organization_slug, scenario, replay_output, created_at)
      values ($1, $2, $3, $4, $5, $6)
      returning *
      `,
      [
        replay.id,
        replay.run_id,
        replay.organization_slug,
        replay.scenario,
        replay.replay_output,
        replay.created_at,
      ],
    );
    if (insert.error) {
      throw new Error(insert.error.message);
    }
    const rows = (insert.data as RunReplay[] | null) ?? [];
    return rows[0] as RunReplay;
  }

  // ─── Enhanced API Methods (Sprint 4) ─────────────────────────

  async getRunDetail(organizationSlug: string, userId: string, runId: string) {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    const run = await this.getRun(organizationSlug, userId, runId);

    // Load analyst outcomes + arbitrator
    const predictions = await this.db.rawQuery(
      `select mp.*, ma.display_name as analyst_name, ma.default_weight as analyst_weight
       from prediction.market_predictions mp
       left join prediction.market_analysts ma on ma.id = mp.analyst_id
       where mp.run_id = $1 and mp.organization_slug = $2
       order by mp.role asc, mp.created_at asc`,
      [runId, organizationSlug],
    );
    const predRows = (predictions.data as Array<Record<string, unknown>> | null) ?? [];
    const analystOutcomes = predRows.filter((r) => r['role'] === 'analyst' || !r['role']);
    const arbitratorOutcome = predRows.find((r) => r['role'] === 'arbitrator') ?? null;

    // Load risk details if risk run
    let riskDetails = null;
    if (run.run_type === 'risk') {
      riskDetails = await this.getRunRiskDetails(organizationSlug, userId, runId);
    }

    return { ...run, analystOutcomes, arbitratorOutcome, riskDetails };
  }

  async getRunRiskDetails(organizationSlug: string, userId: string, runId: string) {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    const composite = await this.db.rawQuery(
      `select * from prediction.risk_composite_scores
       where run_id = $1 and (organization_slug = $2 or organization_slug = '__base__')
       order by created_at desc limit 1`,
      [runId, organizationSlug],
    );
    const compositeRow = ((composite.data as Record<string, unknown>[] | null) ?? [])[0] ?? null;

    const assessments = await this.db.rawQuery(
      `select rda.*, rd.slug as dimension_slug, rd.name as dimension_name
       from prediction.risk_dimension_assessments rda
       left join prediction.risk_dimensions rd on rd.id = rda.dimension_id
       where rda.run_id = $1 and (rda.organization_slug = $2 or rda.organization_slug = '__base__')
       order by rd.display_order asc`,
      [runId, organizationSlug],
    );
    const assessmentRows = (assessments.data as Record<string, unknown>[] | null) ?? [];

    // Check for per-analyst risk assessments (new format)
    const analystAssessments = await this.db.rawQuery(
      `select ara.*, ma.display_name as analyst_name, ma.slug as analyst_slug
       from prediction.analyst_risk_assessments ara
       left join prediction.market_analysts ma on ma.id = ara.analyst_id
       where ara.run_id = $1 and (ara.organization_slug = $2 or ara.organization_slug = '__base__')
       order by ara.score desc`,
      [runId, organizationSlug],
    );
    const analystRows = (analystAssessments.data as Record<string, unknown>[] | null) ?? [];

    // If per-analyst assessments exist, use those as dimensionAssessments (same data shape: score, confidence, reasoning, evidence)
    const effectiveAssessments = analystRows.length > 0
      ? analystRows.map(a => ({
          ...a,
          dimension_name: a.analyst_name,
          dimension_slug: a.analyst_slug,
          dimension_id: a.analyst_id,
        }))
      : assessmentRows;

    const debate = await this.db.rawQuery(
      `select * from prediction.risk_debates
       where run_id = $1 and (organization_slug = $2 or organization_slug = '__base__')
       order by created_at desc limit 1`,
      [runId, organizationSlug],
    );
    const debateRow = ((debate.data as Record<string, unknown>[] | null) ?? [])[0] ?? null;

    return { compositeScore: compositeRow, dimensionAssessments: effectiveAssessments, debate: debateRow };
  }

  /**
   * Re-run the risk debate for an existing risk run.
   * Loads the existing composite score and dimension assessments, then runs a fresh debate.
   */
  async rerunDebate(
    organizationSlug: string,
    userId: string,
    runId: string,
  ): Promise<Record<string, unknown>> {
    await this.schema.ensureSchema();
    await this.requireWrite(userId, organizationSlug);

    // Load existing composite score
    const comp = await this.db.rawQuery(
      `select * from prediction.risk_composite_scores
       where run_id = $1 and (organization_slug = $2 or organization_slug = '__base__')
       order by created_at desc limit 1`,
      [runId, organizationSlug],
    );
    const compositeRow = ((comp.data as Record<string, unknown>[] | null) ?? [])[0];
    if (!compositeRow) throw new BadRequestException('No composite score found for this run');

    // Load dimension assessments
    const dims = await this.db.rawQuery(
      `select * from prediction.risk_dimension_assessments
       where run_id = $1 and (organization_slug = $2 or organization_slug = '__base__')
       order by created_at asc`,
      [runId, organizationSlug],
    );
    const dimRows = (dims.data as Record<string, unknown>[] | null) ?? [];

    // Look up instrument symbol
    const inst = await this.db.rawQuery(
      `select symbol from prediction.instruments where id = $1 limit 1`,
      [compositeRow.instrument_id],
    );
    const symbol = ((inst.data as Array<{ symbol: string }> | null) ?? [])[0]?.symbol ?? 'UNKNOWN';

    // Run the debate via the risk runner's debate service
    const context = this.buildExecutionContext(
      String(compositeRow.organization_slug),
      userId,
      'risk',
    );

    return this.riskRunner.rerunDebate({
      context,
      runId,
      organizationSlug: String(compositeRow.organization_slug),
      instrumentId: String(compositeRow.instrument_id),
      instrumentSymbol: symbol,
      compositeScoreId: String(compositeRow.id),
      overallScore: Number(compositeRow.pre_debate_score ?? compositeRow.overall_score),
      dimensionAssessments: dimRows as never[],
    });
  }

  async listRiskDimensions(organizationSlug: string, userId: string) {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    const result = await this.db.rawQuery(
      `select * from prediction.risk_dimensions
       where (organization_slug = $1 or organization_slug = '__base__')
         and is_active = true
       order by
         case when organization_slug = $1 then 0 else 1 end,
         display_order asc`,
      [organizationSlug],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Record<string, unknown>[] | null) ?? [];
  }

  async upsertRiskDimension(input: {
    organizationSlug: string;
    userId: string;
    slug: string;
    name: string;
    description?: string;
    weight: number;
    displayOrder?: number;
    systemPrompt?: string;
    isActive?: boolean;
  }): Promise<Record<string, unknown>> {
    await this.schema.ensureSchema();
    await this.requireWrite(input.userId, input.organizationSlug);

    const id = `${input.organizationSlug}_dim_${input.slug}`;
    const result = await this.db.rawQuery(
      `insert into prediction.risk_dimensions
        (id, organization_slug, domain_slug, slug, name, description, weight,
         display_order, is_active, system_prompt, updated_at)
       values ($1, $2, 'financial', $3, $4, $5, $6, $7, $8, $9, now())
       on conflict (organization_slug, slug) do update set
         name = excluded.name,
         description = excluded.description,
         weight = excluded.weight,
         display_order = excluded.display_order,
         is_active = excluded.is_active,
         system_prompt = excluded.system_prompt,
         updated_at = now()
       returning *`,
      [
        id, input.organizationSlug, input.slug, input.name,
        input.description ?? null, input.weight, input.displayOrder ?? 0,
        input.isActive ?? true, input.systemPrompt ?? null,
      ],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as Record<string, unknown>[] | null) ?? [])[0] ?? {};
  }

  async getInstrumentCompositeScore(organizationSlug: string, userId: string, instrumentId: string) {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    // Latest active composite
    const latest = await this.db.rawQuery(
      `select rcs.*, orr.created_at as run_created_at
       from prediction.risk_composite_scores rcs
       join prediction.orchestration_runs orr on orr.id = rcs.run_id
       where (rcs.organization_slug = $1 or rcs.organization_slug = '__base__') and rcs.instrument_id = $2 and rcs.status = 'active'
       order by rcs.created_at desc limit 1`,
      [organizationSlug, instrumentId],
    );
    const latestRow = ((latest.data as Record<string, unknown>[] | null) ?? [])[0] ?? null;

    // Trend: last 10 composites
    const trend = await this.db.rawQuery(
      `select overall_score, debate_adjustment, confidence, created_at
       from prediction.risk_composite_scores
       where (organization_slug = $1 or organization_slug = '__base__') and instrument_id = $2
       order by created_at desc limit 10`,
      [organizationSlug, instrumentId],
    );
    const trendRows = (trend.data as Record<string, unknown>[] | null) ?? [];

    return { current: latestRow, trend: trendRows.reverse() };
  }

  async listPredictionsWithRole(input: {
    organizationSlug: string;
    userId: string;
    runId?: string;
    instrumentId?: string;
    role?: 'analyst' | 'arbitrator' | 'all';
  }) {
    await this.schema.ensureSchema();
    await this.requireRead(input.userId, input.organizationSlug);

    let query = `select mp.*, ma.display_name as analyst_name
      from prediction.market_predictions mp
      left join prediction.market_analysts ma on ma.id = mp.analyst_id
      where mp.organization_slug = $1`;
    const params: unknown[] = [input.organizationSlug];
    let idx = 2;

    if (input.runId) {
      query += ` and mp.run_id = $${idx}`;
      params.push(input.runId);
      idx++;
    }
    if (input.instrumentId) {
      query += ` and mp.instrument_id = $${idx}`;
      params.push(input.instrumentId);
      idx++;
    }
    if (input.role && input.role !== 'all') {
      query += ` and mp.role = $${idx}`;
      params.push(input.role);
      idx++;
    }
    query += ' order by mp.created_at desc';

    const result = await this.db.rawQuery(query, params);
    if (result.error) throw new Error(result.error.message);
    return (result.data as Record<string, unknown>[] | null) ?? [];
  }

  // ─── Learning Proposal Management ─────────────────────────────

  async listLearningProposals(organizationSlug: string, userId: string, status?: string) {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    let query = `select lp.*, ma.display_name as analyst_name
      from prediction.learning_proposals lp
      left join prediction.market_analysts ma on ma.id = lp.analyst_id
      where lp.organization_slug = $1`;
    const params: unknown[] = [organizationSlug];

    if (status) {
      query += ` and lp.status = $2`;
      params.push(status);
    }
    query += ' order by lp.proposed_at desc';

    const result = await this.db.rawQuery(query, params);
    if (result.error) throw new Error(result.error.message);
    return (result.data as Record<string, unknown>[] | null) ?? [];
  }

  async approveProposal(organizationSlug: string, userId: string, proposalId: string) {
    await this.schema.ensureSchema();
    await this.requireWrite(userId, organizationSlug);

    const result = await this.db.rawQuery(
      `update prediction.learning_proposals
       set status = 'approved', reviewed_by = $1, reviewed_at = now()
       where id = $2 and organization_slug = $3 and status in ('passed', 'proposed')
       returning *`,
      [userId, proposalId, organizationSlug],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Record<string, unknown>[] | null) ?? [];
    if (rows.length === 0) throw new BadRequestException('Proposal not found or not in an approvable state');
    return rows[0];
  }

  async rejectProposal(organizationSlug: string, userId: string, proposalId: string, reason?: string) {
    await this.schema.ensureSchema();
    await this.requireWrite(userId, organizationSlug);

    const result = await this.db.rawQuery(
      `update prediction.learning_proposals
       set status = 'rejected', reviewed_by = $1, reviewed_at = now(),
           rationale = case when $4 is not null then rationale || ' | Rejected: ' || $4 else rationale end
       where id = $2 and organization_slug = $3 and status in ('passed', 'proposed', 'testing')
       returning *`,
      [userId, proposalId, organizationSlug, reason ?? null],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Record<string, unknown>[] | null) ?? [];
    if (rows.length === 0) throw new BadRequestException('Proposal not found or not in a rejectable state');
    return rows[0];
  }

  async listLearningReports(organizationSlug: string, userId: string, limit = 10) {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    const result = await this.db.rawQuery(
      `select * from prediction.learning_reports
       order by report_date desc, created_at desc
       limit $1`,
      [limit],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Record<string, unknown>[] | null) ?? [];
  }

  /**
   * Daily report — aggregates predictions, risk scores, and outcomes for the last 24h.
   */
  async getDailyReport(organizationSlug: string, userId: string) {
    await this.schema.ensureSchema();
    await this.requireRead(userId, organizationSlug);

    // Prediction runs completed today
    const runs = await this.db.rawQuery(
      `select r.id, r.instrument_id, r.run_type, r.status, r.created_at, r.completed_at,
              i.symbol, i.name
       from prediction.orchestration_runs r
       join prediction.instruments i on i.id = r.instrument_id
       where (r.organization_slug = $1 or r.organization_slug = '__base__')
         and r.created_at >= now() - interval '24 hours'
       order by r.created_at desc`,
      [organizationSlug],
    );
    const runRows = (runs.data as Array<Record<string, unknown>>) ?? [];

    // Predictions made today
    const preds = await this.db.rawQuery(
      `select mp.instrument_id, mp.predicted_direction, mp.confidence, mp.role,
              ma.display_name as analyst_name, i.symbol
       from prediction.market_predictions mp
       left join prediction.market_analysts ma on ma.id = mp.analyst_id
       join prediction.instruments i on i.id = mp.instrument_id
       where (mp.organization_slug = $1 or mp.organization_slug = '__base__')
         and mp.created_at >= now() - interval '24 hours'
       order by mp.created_at desc`,
      [organizationSlug],
    );
    const predRows = (preds.data as Array<Record<string, unknown>>) ?? [];

    // Risk scores generated today
    const risks = await this.db.rawQuery(
      `select cs.instrument_id, cs.overall_score, cs.pre_debate_score,
              cs.debate_adjustment, cs.confidence, i.symbol
       from prediction.risk_composite_scores cs
       join prediction.instruments i on i.id = cs.instrument_id
       where (cs.organization_slug = $1 or cs.organization_slug = '__base__')
         and cs.created_at >= now() - interval '24 hours'
       order by cs.created_at desc`,
      [organizationSlug],
    );
    const riskRows = (risks.data as Array<Record<string, unknown>>) ?? [];

    // Learning reports
    const reports = await this.db.rawQuery(
      `select * from prediction.learning_reports
       where report_date >= (now() - interval '24 hours')::date
       order by created_at desc limit 5`,
    );
    const reportRows = (reports.data as Array<Record<string, unknown>>) ?? [];

    return {
      period: '24h',
      generatedAt: new Date().toISOString(),
      summary: {
        runsCompleted: runRows.filter(r => r.status === 'completed').length,
        runsFailed: runRows.filter(r => r.status === 'failed').length,
        predictionsMade: predRows.length,
        analystPredictions: predRows.filter(r => r.role === 'analyst').length,
        arbitratorPredictions: predRows.filter(r => r.role === 'arbitrator').length,
        riskAssessments: riskRows.length,
        instrumentsCovered: new Set(predRows.map(r => r.symbol)).size,
      },
      runs: runRows,
      predictions: predRows,
      riskScores: riskRows,
      learningReports: reportRows,
    };
  }
}
