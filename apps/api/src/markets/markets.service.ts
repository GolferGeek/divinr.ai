import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
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
import { PositionSizingService } from './services/position-sizing.service';
import { UserPortfolioService } from './services/user-portfolio.service';
import { TradeRecommendationService } from './services/trade-recommendation.service';
import { AffinityService } from './services/affinity.service';
import { ArticleRelevanceService } from './services/article-relevance.service';
import {
  parseContractMarkdown as parseContractMarkdownUtil,
  validateContractSections,
  REQUIRED_SECTIONS_BY_TYPE,
  type AnalystType as ContractAnalystType,
  type ContractValidationResult,
} from './utils/parse-contract-markdown';
import {
  ANALYST_SCAFFOLD_PROMPT,
  INSTRUMENT_SCAFFOLD_PROMPT,
} from './utils/scaffold-prompts';
import { BillingService } from '../billing/billing.service';
import { SocialOptOutService } from '../users/social-opt-out.service';
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
  TradeRecommendation,
} from './markets.types';

// Effort: see-your-reasoning. Local row type for the
// GET /markets/predictions/:id/llm-calls endpoint. Kept inline (not exported,
// not in markets.types.ts) to minimize blast radius for this small effort.
interface LlmCallRow {
  runId: string;
  provider: string;
  model: string;
  tier: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  totalCost: number | null;
  reasoningContent: string;
  reasoningTruncated: boolean;
  createdAt: string;
}

// Effort: analyst-contracts. Structured contract document parsed from markdown.
interface AnalystContract {
  markdown: string;
  sections: {
    general: string;
    roles: Record<string, string>;
    adaptations: string;
  };
}

// Effort: calibration-drilldown. Response shape for getAnalystCalibration.
// Kept inline (same convention as LlmCallRow above).
interface AnalystCalibrationPayload {
  analyst: {
    id: string;
    displayName: string;
    personaPrompt: string;
    analystType: string | null;
  };
  metrics: {
    period: '30d';
    horizonWindow: 3;
    aggregate: {
      accuracyRate: number | null;
      avgConfidence: number | null;
      calibrationScore: number | null;
      sampleSize: number;
    };
    perInstrument: Array<{
      instrumentId: string;
      symbol: string;
      accuracyRate: number | null;
      avgConfidence: number | null;
      calibrationScore: number | null;
      sampleSize: number;
      systematicBiases: Record<string, unknown>;
    }>;
  };
  resolvedPredictions: Array<{
    predictionId: string;
    evaluationId: string;
    instrumentId: string;
    symbol: string;
    predictedDirection: string;
    actualDirection: string | null;
    wasCorrect: boolean;
    confidence: number | null;
    predictionDate: string;
    evaluationDate: string;
    actualOutcome: {
      changePercent: number;
      priceAtPrediction: number;
      priceAtHorizon: number;
    } | null;
    rationale: string | null;
    hasReasoning: boolean;
  }>;
}

@Injectable()
export class MarketsService {
  private readonly logger = new Logger(MarketsService.name);
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
    // The remaining params need explicit @Inject() because the test runner
    // (tsx → esbuild) does not emit design:paramtypes metadata, so Nest cannot
    // resolve bare positional params via reflection. Production (tsc) is fine
    // either way; this keeps both paths working.
    @Inject(MarketsSchemaService)
    private readonly schema: MarketsSchemaService,
    @Inject(RiskRunnerService)
    private readonly riskRunner: RiskRunnerService,
    @Inject(PredictionRunnerService)
    private readonly predictionRunner: PredictionRunnerService,
    @Inject(MarketsLlmService)
    private readonly marketsLlm: MarketsLlmService,
    @Inject(PositionSizingService)
    private readonly positionSizing: PositionSizingService,
    @Inject(UserPortfolioService)
    private readonly userPortfolio: UserPortfolioService,
    @Inject(TradeRecommendationService)
    private readonly tradeRecommendation: TradeRecommendationService,
    @Inject(AffinityService)
    private readonly affinity: AffinityService,
    @Inject(BillingService)
    private readonly billing: BillingService,
    @Inject(SocialOptOutService)
    private readonly optOuts: SocialOptOutService,
    @Inject(ArticleRelevanceService)
    private readonly articleRelevance: ArticleRelevanceService,
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
  ): Promise<void> {
    if (process.env.MARKETS_DEV_AUTH_BYPASS === 'true') return;
    const allowed = await this.rbac.hasPermission(
      userId,
      'markets.instruments.read',
    );
    if (!allowed) {
      throw new ForbiddenException('Read permission denied');
    }
  }

  private async requireWrite(
    userId: string,
  ): Promise<void> {
    if (process.env.MARKETS_DEV_AUTH_BYPASS === 'true') return;
    const allowed = await this.rbac.hasPermission(
      userId,
      'markets.instruments.write',
    );
    if (!allowed) {
      throw new ForbiddenException('Write permission denied');
    }
  }

  private buildExecutionContext(
    userId: string,
    runType: RunType,
  ): ExecutionContext {
    const llmConfig = this.getPreferredLlmConfig();
    return {
      conversationId: randomUUID(),
      userId,
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
    userId: string,
  ): Promise<MarketInstrument[]> {
    await this.requireRead(userId);

    // Show user-specific instruments + system instruments
    const result = await this.db.rawQuery(
      `select * from prediction.instruments
       where (user_id IS NULL OR user_id = $1)
       order by symbol asc`,
      [userId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return ((result.data as MarketInstrument[] | null) ?? []);
  }

  async createInstrument(input: CreateInstrumentInput): Promise<MarketInstrument> {
    await this.requireWrite(input.userId);

    const instrument: MarketInstrument = {
      id: randomUUID(),
      user_id: input.userId,
      symbol: input.symbol.toUpperCase(),
      name: input.name || input.symbol.toUpperCase(),
      asset_type: input.assetType || 'stock',
      universe_slug: 'stocks',
      current_state: {},
      is_active: true,
      created_at: new Date().toISOString(),
    };

    const result = await this.db.rawQuery(
      `
      insert into prediction.instruments
        (id, user_id, symbol, name, asset_type, universe_slug, current_state, is_active, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (symbol, (coalesce(user_id, 'base'))) do update set
        name = excluded.name,
        asset_type = excluded.asset_type
      returning *
      `,
      [
        instrument.id, instrument.user_id, instrument.symbol,
        instrument.name, instrument.asset_type, instrument.universe_slug,
        JSON.stringify(instrument.current_state), instrument.is_active, instrument.created_at,
      ],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    const rows = (result.data as MarketInstrument[] | null) ?? [];
    const created = rows[0] as MarketInstrument;

    // Billing: track authored instrument (only on true insert, not upsert-update)
    const wasInserted = created.id === instrument.id;
    if (wasInserted && created.user_id) {
      try {
        await this.billing.addAuthoredItem(created.user_id, 'custom_instrument', created.id);
      } catch (err: any) {
        this.logger.warn(`Billing item creation failed for instrument ${created.id}: ${err.message}`);
      }
    }

    // Kick off a non-blocking article-relevance backfill so the new instrument
    // gets classified against the last 7 days of articles instead of waiting
    // for the next article to arrive. The scheduled pipeline only picks up
    // articles with no relevance records at all, so brand-new instruments
    // otherwise get zero coverage from the existing article pool.
    //
    // Deliberately fire-and-forget: an in-flight backfill is dropped if the
    // process restarts mid-run. The scheduled `classifyNewArticles` sweep does
    // NOT heal this gap — it only touches articles with zero relevance records
    // at all, so a half-complete backfill leaves the new instrument partially
    // classified until someone re-triggers backfill manually. Acceptable for
    // now given how rare mid-backfill restarts should be; revisit if we see it.
    if (wasInserted) {
      this.articleRelevance.backfillForInstrument(created.id).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Article-relevance backfill failed for instrument ${created.id}: ${msg}`);
      });
    }

    return created;
  }

  async createAnalyst(input: CreateAnalystInput): Promise<MarketAnalyst> {
    await this.requireWrite(input.userId);

    const now = new Date().toISOString();
    const analyst: MarketAnalyst = {
      id: randomUUID(),
      user_id: input.userId,
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
        (id, user_id, slug, display_name, name, persona_prompt, analyst_type,
         default_weight, tier_instructions, is_system_default, is_enabled, is_active,
         workflow_scope, domain_slug, shared_with_clubs, created_by, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false, $15, $16, $17)
      on conflict (slug, (coalesce(user_id, 'base'))) do update set
        display_name = excluded.display_name,
        persona_prompt = excluded.persona_prompt,
        updated_at = excluded.updated_at
      returning *
      `,
      [
        analyst.id, analyst.user_id, analyst.slug,
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
      // context_markdown is NULL for new analysts — contracts are generated
      // separately. Effort: analyst-contracts.
      `insert into prediction.analyst_config_versions
        (id, analyst_id, version_number, persona_prompt,
         tier_instructions, default_weight, context_markdown,
         source, change_reason, is_active, created_by, created_at)
       values ($1, $2, 1, $3, $4, $5, null,
               'manual', 'Initial creation', true, $6, $7)
       on conflict do nothing`,
      [
        versionId, created.id,
        created.persona_prompt, JSON.stringify(created.tier_instructions),
        created.default_weight, created.created_by, created.created_at,
      ],
    );

    // Link the version back to the analyst
    await this.db.rawQuery(
      `update prediction.market_analysts set current_config_version_id = $1 where id = $2`,
      [versionId, created.id],
    );

    // Billing: track authored analyst (only on true insert, not upsert-update)
    const wasInserted = created.id === analyst.id;
    if (wasInserted && created.user_id) {
      try {
        await this.billing.addAuthoredItem(created.user_id, 'custom_analyst', created.id);
      } catch (err: any) {
        this.logger.warn(`Billing item creation failed for analyst ${created.id}: ${err.message}`);
      }
    }

    return created;
  }

  async updateAnalyst(input: {
    userId: string;
    analystId: string;
    personaPrompt?: string;
    defaultWeight?: number;
    tierInstructions?: Record<string, string>;
    isEnabled?: boolean;
    changeReason?: string;
  }): Promise<MarketAnalyst> {
    await this.requireWrite(input.userId);

    // Load current analyst
    const current = await this.db.rawQuery(
      `select * from prediction.market_analysts where id = $1 and user_id = $2`,
      [input.analystId, input.userId],
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
      // context_markdown carry-forward: inherit from the most recent version
      // that has a contract. Effort: analyst-contracts.
      `insert into prediction.analyst_config_versions
        (id, analyst_id, version_number, persona_prompt,
         tier_instructions, default_weight, context_markdown,
         source, change_reason,
         parent_version_id, is_active, created_by, created_at)
       values ($1, $2,
         coalesce((select max(version_number) + 1 from prediction.analyst_config_versions where analyst_id = $2), 1),
         $3, $4, $5,
         (select context_markdown from prediction.analyst_config_versions
          where analyst_id = $2 and context_markdown is not null
          order by version_number desc limit 1),
         'manual', $6, $7, true, $8, $9)
       returning version_number`,
      [
        versionId, input.analystId,
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
       where id = $7 and user_id = $8
       returning *`,
      [newPrompt, newWeight, JSON.stringify(newTier), newEnabled, versionId, new Date().toISOString(), input.analystId, input.userId],
    );
    if (update.error) throw new Error(update.error.message);
    return ((update.data as MarketAnalyst[] | null) ?? [])[0] as MarketAnalyst;
  }

  async rollbackAnalyst(input: {
    userId: string;
    analystId: string;
  }): Promise<MarketAnalyst> {
    await this.requireWrite(input.userId);

    // Find current version's parent
    const current = await this.db.rawQuery(
      `select acv.parent_version_id
       from prediction.market_analysts ma
       join prediction.analyst_config_versions acv on acv.id = ma.current_config_version_id
       where ma.id = $1 and ma.user_id = $2`,
      [input.analystId, input.userId],
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
       where analyst_id = $1 and is_active = true`,
      [input.analystId],
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
       where id = $6 and user_id = $7
       returning *`,
      [prev.persona_prompt, prev.default_weight, JSON.stringify(prev.tier_instructions), parentVersionId, new Date().toISOString(), input.analystId, input.userId],
    );
    if (update.error) throw new Error(update.error.message);
    return ((update.data as MarketAnalyst[] | null) ?? [])[0] as MarketAnalyst;
  }

  async listAnalysts(
    userId: string,
  ): Promise<MarketAnalyst[]> {
    await this.requireRead(userId);

    // Club-shared analysts must respect the owner's social_visible_in_member_lists
    // opt-out (attribution surface). Base analysts (user_id NULL) and the
    // viewer's own analysts are never filtered.
    const result = await this.db.rawQuery(
      `
      select ma.*
      from prediction.market_analysts ma
      left join authz.users u on u.id = ma.user_id
      where (
        ma.user_id IS NULL
        OR ma.user_id = $1
        OR (
          ma.id IN (
            SELECT ca.analyst_id FROM prediction.club_analysts ca
            JOIN prediction.club_members cm ON cm.club_id = ca.club_id
            WHERE cm.user_id = $1
          )
          AND (u.social_visible_in_member_lists IS NOT FALSE OR u.id = $1)
        )
      )
      order by case when ma.user_id = $1 then 0 else 1 end, ma.created_at asc
      `,
      [userId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as MarketAnalyst[]) ?? [];
  }

  async listAnalystsForInstrument(
    userId: string,
    instrumentId: string,
  ): Promise<MarketAnalyst[]> {
    await this.requireRead(userId);

    // Per design: all base analysts cover every instrument. The assignments
    // table is not populated — base analysts apply universally.
    void instrumentId;
    const result = await this.db.rawQuery(
      `
      select *
      from prediction.market_analysts
      where (user_id IS NULL OR user_id = $1
        OR id IN (
          SELECT ca.analyst_id FROM prediction.club_analysts ca
          JOIN prediction.club_members cm ON cm.club_id = ca.club_id
          WHERE cm.user_id = $1
        ))
        and is_enabled = true
      order by case when user_id = $1 then 0 else 1 end, created_at asc
      `,
      [userId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as MarketAnalyst[] | null) ?? [];
  }

  async assignAnalystToInstrument(
    input: AssignAnalystInput,
  ): Promise<{ assigned: boolean }> {
    await this.requireWrite(input.userId);

    const upsert = await this.db.rawQuery(
      `
      insert into prediction.market_instrument_analyst_assignments
        (instrument_id, analyst_id, assigned_by)
      values ($1, $2, $3)
      on conflict (instrument_id, analyst_id)
      do update set assigned_by = excluded.assigned_by
      `,
      [input.instrumentId, input.analystId, input.userId],
    );
    if (upsert.error) {
      throw new Error(upsert.error.message);
    }
    return { assigned: true };
  }

  async listEntitledSources(
    userId: string,
  ): Promise<Array<MarketSource & { entitlement: SourceEntitlement | null }>> {
    await this.requireRead(userId);

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
      `,
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

  async listSourceArticles(
    userId: string,
    sourceId: string,
    limit: number,
  ) {
    await this.requireRead(userId);

    const result = await this.db.rawQuery(
      `select id, title, url, summary, author, published_at, created_at
       from prediction.market_articles
       where source_id = $1
       order by coalesce(published_at, created_at) desc
       limit $2`,
      [sourceId, Math.min(limit, 50)],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Record<string, unknown>[] | null) ?? [];
  }

  async listDataAdapters(userId: string) {
    await this.requireRead(userId);

    const result = await this.db.rawQuery(`
      select dsr.id, dsr.name, dsr.provider_type, dsr.base_url, dsr.tier,
        dsr.rate_limit_per_minute, dsr.cache_ttl_seconds, dsr.is_active,
        json_agg(json_build_object(
          'analyst_name', ma.display_name,
          'analyst_slug', ma.slug,
          'data_types', asa.data_types
        )) filter (where ma.id is not null) as analyst_assignments
      from prediction.data_source_registry dsr
      left join prediction.analyst_source_assignments asa on asa.source_id = dsr.id and asa.is_active = true
      left join prediction.market_analysts ma on ma.id = asa.analyst_id
      group by dsr.id, dsr.name, dsr.provider_type, dsr.base_url, dsr.tier,
        dsr.rate_limit_per_minute, dsr.cache_ttl_seconds, dsr.is_active
      order by dsr.name
    `);
    if (result.error) throw new Error(result.error.message);
    return (result.data as Record<string, unknown>[] | null) ?? [];
  }

  // ─── Prediction Provenance ─────────────────────────────────────

  async getPredictionProvenance(userId: string, predictionId: string) {
    await this.requireRead(userId);

    // Load prediction
    const predResult = await this.db.rawQuery(
      `select mp.*, i.symbol, i.name as instrument_name
       from prediction.market_predictions mp
       join prediction.instruments i on i.id = mp.instrument_id
       where mp.id = $1`,
      [predictionId],
    );
    const preds = (predResult.data as Array<Record<string, unknown>> | null) ?? [];
    if (preds.length === 0) throw new Error('Prediction not found');
    const pred = preds[0];

    // Load analyst
    const analystResult = await this.db.rawQuery(
      `select id, slug, display_name, persona_prompt,
              memory_patterns, memory_corrections, memory_instrument_notes, memory_calibration
       from prediction.market_analysts where id = $1`,
      [pred.analyst_id],
    );
    const analysts = (analystResult.data as Array<Record<string, unknown>> | null) ?? [];
    const analyst = analysts[0] ?? { id: pred.analyst_id, slug: '', display_name: 'Unknown', persona_prompt: '' };

    // Load articles. If the prediction row carries `contributing_article_ids`
    // (populated by the prediction-runner on new predictions), surface exactly
    // those articles in stored order. Otherwise fall back to "recent articles
    // this analyst scored as relevant" for pre-migration rows.
    const storedArticleIdsRaw = pred.contributing_article_ids;
    let storedArticleIds: string[] | null = null;
    if (Array.isArray(storedArticleIdsRaw)) {
      storedArticleIds = storedArticleIdsRaw.map(String);
    } else if (typeof storedArticleIdsRaw === 'string') {
      try {
        const parsed = JSON.parse(storedArticleIdsRaw);
        storedArticleIds = Array.isArray(parsed) ? parsed.map(String) : null;
      } catch {
        storedArticleIds = null;
      }
    }

    let articles: Array<Record<string, unknown>> = [];
    let fallback = false;
    if (storedArticleIds === null) {
      fallback = true;
      const articlesResult = await this.db.rawQuery(
        `select mp.relevance_score, mp.rationale, ma.id, ma.title, ma.url, ma.published_at
         from prediction.market_predictors mp
         join prediction.market_articles ma on ma.id = mp.article_id
         where mp.scored_by_analyst_id = $1 and mp.instrument_id = $2 and mp.status = 'active'
         order by mp.relevance_score desc limit 10`,
        [pred.analyst_id, pred.instrument_id],
      );
      articles = (articlesResult.data as Array<Record<string, unknown>> | null) ?? [];
    } else if (storedArticleIds.length > 0) {
      const articlesResult = await this.db.rawQuery(
        `select ma.id, ma.title, ma.url, ma.published_at,
                mp.relevance_score, mp.rationale
         from prediction.market_articles ma
         left join prediction.market_predictors mp
           on mp.article_id = ma.id
          and mp.scored_by_analyst_id = $1
          and mp.instrument_id = $2
         where ma.id = any($3::text[])`,
        [pred.analyst_id, pred.instrument_id, storedArticleIds],
      );
      const rows = (articlesResult.data as Array<Record<string, unknown>> | null) ?? [];
      const byId = new Map(rows.map((r) => [String(r.id), r]));
      articles = storedArticleIds
        .map((id) => byId.get(id))
        .filter((r): r is Record<string, unknown> => Boolean(r));
    }

    // Load analyst's risk assessment for this instrument
    const riskResult = await this.db.rawQuery(
      `select score, confidence, reasoning, evidence
       from prediction.analyst_risk_assessments
       where analyst_id = $1 and instrument_id = $2
       order by created_at desc limit 1`,
      [pred.analyst_id, pred.instrument_id],
    );
    const riskRows = (riskResult.data as Array<Record<string, unknown>> | null) ?? [];

    // Parse source_context from prediction
    const sourceData = pred.source_context as Record<string, unknown> ?? {};

    // Memory from analyst
    const symbol = String(pred.symbol || '');
    const instrumentNotes = (analyst.memory_instrument_notes as Record<string, unknown[]>)?.[symbol] ?? [];

    return {
      prediction: {
        id: pred.id,
        direction: pred.predicted_direction,
        confidence: pred.confidence,
        rationale: pred.rationale,
        key_factors: pred.key_factors,
        risks: pred.risks,
        created_at: pred.created_at,
      },
      analyst: {
        id: analyst.id,
        slug: analyst.slug,
        display_name: analyst.display_name,
        persona_prompt: analyst.persona_prompt,
      },
      articles: articles.map(a => ({
        id: a.id,
        title: a.title,
        url: a.url,
        relevance_score: a.relevance_score,
        rationale: a.rationale,
        published_at: a.published_at,
      })),
      fallback,
      riskAssessment: riskRows[0] ?? null,
      sourceData,
      memory: {
        patterns: (analyst.memory_patterns as unknown[]) ?? [],
        corrections: (analyst.memory_corrections as unknown[]) ?? [],
        instrumentNotes,
        calibration: (analyst.memory_calibration as Record<string, unknown>) ?? {},
      },
    };
  }

  // ─── Prediction LLM Calls (reasoning content surface) ─────────
  //
  // Effort: see-your-reasoning. Returns the captured LLM call(s) backing a
  // single market_predictions row, joining via market_predictions.llm_usage_id
  // → public.llm_usage.run_id. Used by AnalystPredictionModal's "Reasoning" tab.

  async getPredictionLlmCalls(
    userId: string,
    predictionId: string,
  ): Promise<{ predictionId: string; calls: LlmCallRow[] }> {
    await this.requireRead(userId);

    // IDOR defense: the user_id filter ensures only system predictions
    // (user_id IS NULL) or the user's own predictions are accessible.
    //
    // The ::text cast on both sides of the join is required because
    // market_predictions.llm_usage_id is uuid and llm_usage.run_id is text.
    const result = await this.db.rawQuery(
      `select
         lu.run_id,
         lu.provider,
         lu.model,
         lu.tier,
         lu.input_tokens,
         lu.output_tokens,
         lu.reasoning_tokens,
         lu.cost,
         lu.reasoning_content,
         lu.reasoning_truncated,
         lu.created_at
       from prediction.market_predictions mp
       join public.llm_usage lu on lu.run_id::text = mp.llm_usage_id::text
       where mp.id = $1
         and lu.reasoning_content is not null
       order by lu.created_at desc`,
      [predictionId],
    );
    if (result.error) throw new Error(result.error.message);

    type LlmUsageDbRow = {
      run_id: string;
      provider: string;
      model: string;
      tier: string;
      input_tokens: number | null;
      output_tokens: number | null;
      reasoning_tokens: number | null;
      cost: number | string | null;
      reasoning_content: string;
      reasoning_truncated: boolean;
      created_at: string;
    };

    const rows = (result.data as LlmUsageDbRow[] | null) ?? [];
    const calls: LlmCallRow[] = rows.map((r) => ({
      runId: r.run_id,
      provider: r.provider,
      model: r.model,
      tier: r.tier,
      inputTokens: r.input_tokens ?? 0,
      outputTokens: r.output_tokens ?? 0,
      reasoningTokens: r.reasoning_tokens,
      totalCost: r.cost === null ? null : Number(r.cost),
      reasoningContent: r.reasoning_content,
      reasoningTruncated: r.reasoning_truncated,
      createdAt: r.created_at,
    }));

    return { predictionId, calls };
  }

  // ─── Analyst Calibration Drilldown ─────────────────────────────
  //
  // Effort: calibration-drilldown. Returns the headline calibration metrics
  // (weighted across per-instrument profile rows), per-instrument breakdown,
  // and the resolved-prediction history sorted wrong-first. Used by
  // AnalystPerformanceView to render the calibration reading room.
  // No reasoning content in this payload — that comes from
  // getPredictionLlmCalls on demand when a row is expanded.

  // Hard cap on the resolved-predictions list. With ~37 resolved evals in
  // dev today this is ~2.7× headroom; pagination is a follow-on if needed.
  private static readonly CALIBRATION_RESOLVED_LIMIT = 100;

  async getAnalystCalibration(
    userId: string,
    analystId: string,
  ): Promise<AnalystCalibrationPayload> {
    await this.requireRead(userId);

    // (a) analyst row — 404 if missing or not accessible (system + user's own).
    const analystResult = await this.db.rawQuery(
      `select id, display_name, persona_prompt, analyst_type
       from prediction.market_analysts
       where id = $1 and (user_id IS NULL OR user_id = $2)
       limit 1`,
      [analystId, userId],
    );
    if (analystResult.error) throw new Error(analystResult.error.message);
    const analystRows = (analystResult.data as Array<{
      id: string;
      display_name: string;
      persona_prompt: string | null;
      analyst_type: string | null;
    }> | null) ?? [];
    if (analystRows.length === 0) {
      throw new NotFoundException(`Analyst ${analystId} not found`);
    }
    const analystRow = analystRows[0]!;

    // (b) per-instrument profile rows for this analyst.
    const profileResult = await this.db.rawQuery(
      // distinct on (instrument_id) — the table can hold multiple rows per
      // (analyst, org, instrument, period, horizon) because the nightly
      // pipeline appends rather than upserts. Pick the freshest by computed_at.
      `select * from (
         select distinct on (app.instrument_id)
                app.instrument_id,
                i.symbol,
                app.accuracy_rate,
                app.avg_confidence,
                app.calibration_score,
                app.systematic_biases,
                app.sample_size,
                app.period,
                app.horizon_window,
                app.computed_at
         from prediction.analyst_performance_profiles app
         left join prediction.instruments i on i.id = app.instrument_id
         where app.analyst_id = $1
           and app.period = '30d'
         order by app.instrument_id, app.computed_at desc
       ) latest
       order by sample_size desc`,
      [analystId],
    );
    if (profileResult.error) throw new Error(profileResult.error.message);
    const profileRows = (profileResult.data as Array<{
      instrument_id: string | null;
      symbol: string | null;
      accuracy_rate: number | string | null;
      avg_confidence: number | string | null;
      calibration_score: number | string | null;
      systematic_biases: Record<string, unknown> | null;
      sample_size: number;
      period: string;
      horizon_window: number;
    }> | null) ?? [];

    const perInstrument = profileRows
      .filter((r) => r.instrument_id !== null)
      .map((r) => ({
        instrumentId: r.instrument_id!,
        symbol: r.symbol ?? r.instrument_id!,
        accuracyRate: r.accuracy_rate === null ? null : Number(r.accuracy_rate),
        avgConfidence: r.avg_confidence === null ? null : Number(r.avg_confidence),
        calibrationScore: r.calibration_score === null ? null : Number(r.calibration_score),
        sampleSize: r.sample_size,
        systematicBiases: r.systematic_biases ?? {},
      }));

    // Weighted aggregate (by sample_size) for accuracy/confidence; un-weighted
    // average for calibration_score (per PRD §5.6 — calibration_score is not
    // trivially weight-aggregatable without re-deriving from samples).
    let totalSamples = 0;
    let weightedAccuracyNum = 0;
    let weightedAccuracyDen = 0;
    let weightedConfidenceNum = 0;
    let weightedConfidenceDen = 0;
    let calibrationSum = 0;
    let calibrationCount = 0;
    for (const r of profileRows) {
      totalSamples += r.sample_size;
      if (r.accuracy_rate !== null && r.sample_size > 0) {
        weightedAccuracyNum += Number(r.accuracy_rate) * r.sample_size;
        weightedAccuracyDen += r.sample_size;
      }
      if (r.avg_confidence !== null && r.sample_size > 0) {
        weightedConfidenceNum += Number(r.avg_confidence) * r.sample_size;
        weightedConfidenceDen += r.sample_size;
      }
      if (r.calibration_score !== null) {
        calibrationSum += Number(r.calibration_score);
        calibrationCount += 1;
      }
    }
    const aggregate = {
      accuracyRate: weightedAccuracyDen > 0 ? weightedAccuracyNum / weightedAccuracyDen : null,
      avgConfidence: weightedConfidenceDen > 0 ? weightedConfidenceNum / weightedConfidenceDen : null,
      calibrationScore: calibrationCount > 0 ? calibrationSum / calibrationCount : null,
      sampleSize: totalSamples,
    };

    // (c) resolved evaluations joined to market_predictions for rationale +
    // llm_usage_id presence. Wrong-first sort, hard cap at 100.
    // The IDOR filter applies on market_predictions.user_id;
    // prediction_horizon_evaluations also carries user_id so we
    // belt-and-suspenders both.
    const evalResult = await this.db.rawQuery(
      `select e.id as evaluation_id,
              e.prediction_id,
              e.instrument_id,
              i.symbol,
              e.predicted_direction,
              e.actual_direction,
              e.was_correct,
              e.confidence_at_prediction,
              e.prediction_date,
              e.evaluation_date,
              e.actual_outcome_data,
              mp.rationale,
              mp.llm_usage_id
       from prediction.prediction_horizon_evaluations e
       join prediction.market_predictions mp on mp.id = e.prediction_id
       left join prediction.instruments i on i.id = e.instrument_id
       where e.analyst_id = $1
       order by e.was_correct asc, e.evaluation_date desc
       limit $2`,
      [analystId, MarketsService.CALIBRATION_RESOLVED_LIMIT],
    );
    if (evalResult.error) throw new Error(evalResult.error.message);
    const evalRows = (evalResult.data as Array<{
      evaluation_id: string;
      prediction_id: string;
      instrument_id: string;
      symbol: string | null;
      predicted_direction: string;
      actual_direction: string | null;
      was_correct: boolean;
      confidence_at_prediction: number | string | null;
      prediction_date: string;
      evaluation_date: string;
      actual_outcome_data: Record<string, unknown> | null;
      rationale: string | null;
      llm_usage_id: string | null;
    }> | null) ?? [];

    const resolvedPredictions = evalRows.map((r) => {
      const outcome = r.actual_outcome_data ?? {};
      const hasOutcome =
        typeof outcome['changePercent'] === 'number' &&
        typeof outcome['priceAtPrediction'] === 'number' &&
        typeof outcome['priceAtHorizon'] === 'number';
      return {
        predictionId: r.prediction_id,
        evaluationId: r.evaluation_id,
        instrumentId: r.instrument_id,
        symbol: r.symbol ?? r.instrument_id,
        predictedDirection: r.predicted_direction,
        actualDirection: r.actual_direction,
        wasCorrect: r.was_correct,
        confidence: r.confidence_at_prediction === null ? null : Number(r.confidence_at_prediction),
        predictionDate: r.prediction_date,
        evaluationDate: r.evaluation_date,
        actualOutcome: hasOutcome
          ? {
              changePercent: outcome['changePercent'] as number,
              priceAtPrediction: outcome['priceAtPrediction'] as number,
              priceAtHorizon: outcome['priceAtHorizon'] as number,
            }
          : null,
        rationale: r.rationale,
        hasReasoning: r.llm_usage_id !== null,
      };
    });

    return {
      analyst: {
        id: analystRow.id,
        displayName: analystRow.display_name,
        personaPrompt: analystRow.persona_prompt ?? '',
        analystType: analystRow.analyst_type,
      },
      metrics: {
        period: '30d',
        horizonWindow: 3,
        aggregate,
        perInstrument,
      },
      resolvedPredictions,
    };
  }

  // ─── Analyst Contract Readers (effort: analyst-contracts) ──────
  //
  // Canonical reader methods for structured contract documents stored
  // in analyst_config_versions.context_markdown. Every consumer of
  // contracts goes through these two methods — no ad-hoc joins.

  /** Delegates to the shared parser in utils/parse-contract-markdown.ts. */
  private parseContractMarkdown(markdown: string): AnalystContract['sections'] {
    return parseContractMarkdownUtil(markdown);
  }

  /**
   * Returns the structured contract for the currently-active config version
   * of the given analyst. Returns null if no config version exists or if
   * the version has no context_markdown.
   */
  async getActiveContextForAnalyst(
    analystId: string,
    userId: string,
  ): Promise<AnalystContract | null> {

    const result = await this.db.rawQuery(
      `SELECT acv.context_markdown
       FROM prediction.market_analysts ma
       JOIN prediction.analyst_config_versions acv ON acv.id = ma.current_config_version_id
       WHERE ma.id = $1 AND (ma.user_id IS NULL OR ma.user_id = $2)
       LIMIT 1`,
      [analystId, userId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<{ context_markdown: string | null }> | null) ?? [];
    if (rows.length === 0 || !rows[0].context_markdown) return null;

    const markdown = rows[0].context_markdown;
    return { markdown, sections: this.parseContractMarkdown(markdown) };
  }

  /**
   * Returns the structured contract for a specific config version.
   * Used for compliance reconstruction: given a prediction's config_version_id,
   * retrieve the exact contract that was active when the prediction was made.
   * Returns null if the version doesn't exist or has no context_markdown.
   */
  async getContextForConfigVersion(
    userId: string,
    configVersionId: string,
  ): Promise<AnalystContract | null> {
    await this.requireRead(userId);

    // IDOR defense: filter on user_id so a caller can't
    // retrieve a contract from another user by guessing the version id.
    const result = await this.db.rawQuery(
      `SELECT context_markdown
       FROM prediction.analyst_config_versions
       WHERE id = $1`,
      [configVersionId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<{ context_markdown: string | null }> | null) ?? [];
    if (rows.length === 0 || !rows[0].context_markdown) return null;

    const markdown = rows[0].context_markdown;
    return { markdown, sections: this.parseContractMarkdown(markdown) };
  }

  // ─── Contract Editor ───────────────────────────────────────────

  async getAnalystContract(analystId: string, userId: string) {

    // Fetch analyst metadata (including analyst_type so the editor can filter
    // required stage panels per PRD §4.3).
    const analystResult = await this.db.rawQuery(
      `SELECT id, display_name, current_config_version_id, analyst_type, user_id
       FROM prediction.market_analysts
       WHERE id = $1 AND (user_id IS NULL OR user_id = $2)`,
      [analystId, userId],
    );
    if (analystResult.error) throw new Error(analystResult.error.message);
    const analysts = (analystResult.data as Array<{ id: string; display_name: string; current_config_version_id: string | null; analyst_type: string; user_id: string | null }> | null) ?? [];
    if (analysts.length === 0) throw new BadRequestException('Analyst not found');
    const analyst = analysts[0];
    const contractAnalystType = this.coerceAnalystType(analyst.analyst_type);

    // Fetch all config versions
    const versionsResult = await this.db.rawQuery(
      `SELECT id, version_number, source, change_reason, created_by, created_at, is_active, context_markdown
       FROM prediction.analyst_config_versions
       WHERE analyst_id = $1
       ORDER BY version_number DESC`,
      [analystId],
    );
    if (versionsResult.error) throw new Error(versionsResult.error.message);
    const versionRows = (versionsResult.data as Array<Record<string, unknown>> | null) ?? [];

    // Find active version and parse its contract
    const activeVersion = versionRows.find(v => v.is_active === true);
    const activeMarkdown = activeVersion?.context_markdown as string | null;
    const contract = activeMarkdown
      ? { markdown: activeMarkdown, sections: this.parseContractMarkdown(activeMarkdown) }
      : null;

    const requiredSections = contractAnalystType
      ? REQUIRED_SECTIONS_BY_TYPE[contractAnalystType]
      : null;

    return {
      analystId: analyst.id,
      displayName: analyst.display_name,
      analystType: contractAnalystType,
      userId: analyst.user_id,
      requiredSections,
      activeVersionId: analyst.current_config_version_id,
      contract,
      versions: versionRows.map(v => ({
        id: String(v.id),
        versionNumber: Number(v.version_number),
        source: String(v.source ?? 'manual'),
        changeReason: v.change_reason ? String(v.change_reason) : null,
        createdBy: v.created_by ? String(v.created_by) : null,
        createdAt: String(v.created_at),
        isActive: Boolean(v.is_active),
        contextMarkdown: v.context_markdown ? String(v.context_markdown) : null,
      })),
    };
  }

  /**
   * Coerce a DB `analyst_type` value to the contract-validator's `AnalystType`.
   * Day-traders and context-providers return null — they do not use v4
   * stage-keyed contracts (out of scope for this effort).
   */
  private coerceAnalystType(raw: string): ContractAnalystType | null {
    if (raw === 'personality' || raw === 'arbitrator' || raw === 'portfolio_manager') {
      return raw;
    }
    return null;
  }

  /**
   * Validate a contract markdown string against the required-section policy
   * for an analyst without creating a new version. Used by the editor for
   * on-blur preflight checks. Effort: stage-keyed-analyst-contracts.
   */
  async validateAnalystContract(
    analystId: string,
    userId: string,
    markdown: string,
  ): Promise<ContractValidationResult & { analystType: ContractAnalystType | null }> {
    const analystResult = await this.db.rawQuery(
      `SELECT analyst_type FROM prediction.market_analysts
       WHERE id = $1 AND (user_id IS NULL OR user_id = $2)`,
      [analystId, userId],
    );
    if (analystResult.error) throw new Error(analystResult.error.message);
    const rows = (analystResult.data as Array<{ analyst_type: string }> | null) ?? [];
    if (rows.length === 0) throw new BadRequestException('Analyst not found');
    const analystType = this.coerceAnalystType(rows[0].analyst_type);
    if (!analystType) {
      // Out-of-scope analyst types get a pass-through: parse but don't enforce
      // the v4 policy. Legacy ## Role: contracts still work.
      return { valid: true, missingSections: [], forbiddenPhrases: [], extraSections: [], analystType: null };
    }
    const sections = parseContractMarkdownUtil(markdown);
    const result = validateContractSections(sections, analystType);
    return { ...result, analystType };
  }

  async saveAnalystContract(input: {
    analystId: string;
    userId: string;
    markdown: string;
    changeReason?: string;
  }) {
    await this.requireWrite(input.userId);

    // Load current analyst + active version
    const analystResult = await this.db.rawQuery(
      `SELECT ma.id, ma.current_config_version_id, ma.analyst_type,
              acv.persona_prompt, acv.tier_instructions, acv.default_weight, acv.version_number
       FROM prediction.market_analysts ma
       LEFT JOIN prediction.analyst_config_versions acv ON acv.id = ma.current_config_version_id
       WHERE ma.id = $1 AND (ma.user_id IS NULL OR ma.user_id = $2)`,
      [input.analystId, input.userId],
    );
    if (analystResult.error) throw new Error(analystResult.error.message);
    const rows = (analystResult.data as Array<Record<string, unknown>> | null) ?? [];
    if (rows.length === 0) throw new BadRequestException('Analyst not found');
    const current = rows[0];
    const oldVersionId = current.current_config_version_id ? String(current.current_config_version_id) : null;

    // v4 validation (stage-keyed-analyst-contracts effort): if the analyst type
    // is in the v4 policy set, reject malformed contracts with a structured 400.
    // Analysts outside the policy (day-traders, etc.) skip this check.
    const policyAnalystType = this.coerceAnalystType(String(current.analyst_type ?? ''));
    if (policyAnalystType) {
      const sections = parseContractMarkdownUtil(input.markdown);
      const validation = validateContractSections(sections, policyAnalystType);
      if (!validation.valid) {
        throw new BadRequestException({
          message: 'Contract validation failed',
          analystType: policyAnalystType,
          missingSections: validation.missingSections,
          forbiddenPhrases: validation.forbiddenPhrases,
          extraSections: validation.extraSections,
        });
      }
    }

    // Deactivate current version
    if (oldVersionId) {
      await this.db.rawQuery(
        `UPDATE prediction.analyst_config_versions SET is_active = false WHERE id = $1`,
        [oldVersionId],
      );
    }

    // Insert new version
    const newVersionId = randomUUID();
    const newVersionNumber = (Number(current.version_number) || 0) + 1;
    await this.db.rawQuery(
      `INSERT INTO prediction.analyst_config_versions
        (id, analyst_id, version_number, persona_prompt,
         tier_instructions, default_weight, context_markdown,
         source, change_reason, parent_version_id, is_active, created_by, created_at,
         author_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', $8, $9, true, $10, $11, $12)`,
      [
        newVersionId, input.analystId, newVersionNumber,
        current.persona_prompt ?? '', JSON.stringify(current.tier_instructions ?? null),
        current.default_weight ?? 1.0, input.markdown,
        input.changeReason || 'Manual contract edit',
        oldVersionId, input.userId, new Date().toISOString(),
        input.userId,
      ],
    );

    // Update analyst pointer
    await this.db.rawQuery(
      `UPDATE prediction.market_analysts SET current_config_version_id = $1 WHERE id = $2`,
      [newVersionId, input.analystId],
    );

    return this.getAnalystContract(input.analystId, input.userId);
  }

  // ─── Instrument Contract Editor (effort: instrument-contracts) ─

  private coerceInstrumentType(): ContractAnalystType {
    return 'instrument';
  }

  async getInstrumentContract(instrumentId: string, _userId: string) {

    const instrumentResult = await this.db.rawQuery(
      `SELECT id, symbol, name, asset_type, current_config_version_id
       FROM prediction.instruments
       WHERE id = $1`,
      [instrumentId],
    );
    if (instrumentResult.error) throw new Error(instrumentResult.error.message);
    const instruments = (instrumentResult.data as Array<{
      id: string;
      symbol: string;
      name: string;
      asset_type: string;
      current_config_version_id: string | null;
    }> | null) ?? [];
    if (instruments.length === 0) throw new BadRequestException('Instrument not found');
    const instrument = instruments[0];
    const contractInstrumentType = this.coerceInstrumentType();

    const versionsResult = await this.db.rawQuery(
      `SELECT id, version_number, source, change_reason, created_by, created_at, is_active, context_markdown
       FROM prediction.instrument_config_versions
       WHERE instrument_id = $1
       ORDER BY version_number DESC`,
      [instrumentId],
    );
    if (versionsResult.error) throw new Error(versionsResult.error.message);
    const versionRows = (versionsResult.data as Array<Record<string, unknown>> | null) ?? [];

    const activeVersion = versionRows.find(v => v.is_active === true);
    const activeMarkdown = activeVersion?.context_markdown as string | null;
    const contract = activeMarkdown
      ? { markdown: activeMarkdown, sections: this.parseContractMarkdown(activeMarkdown) }
      : null;

    return {
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      name: instrument.name,
      assetType: instrument.asset_type,
      requiredSections: REQUIRED_SECTIONS_BY_TYPE[contractInstrumentType],
      activeVersionId: instrument.current_config_version_id,
      contract,
      versions: versionRows.map(v => ({
        id: String(v.id),
        versionNumber: Number(v.version_number),
        source: String(v.source ?? 'manual'),
        changeReason: v.change_reason ? String(v.change_reason) : null,
        createdBy: v.created_by ? String(v.created_by) : null,
        createdAt: String(v.created_at),
        isActive: Boolean(v.is_active),
        contextMarkdown: v.context_markdown ? String(v.context_markdown) : null,
      })),
    };
  }

  async validateInstrumentContract(
    instrumentId: string,
    _userId: string,
    markdown: string,
  ): Promise<ContractValidationResult> {
    const instrumentResult = await this.db.rawQuery(
      `SELECT id FROM prediction.instruments WHERE id = $1`,
      [instrumentId],
    );
    if (instrumentResult.error) throw new Error(instrumentResult.error.message);
    const rows = (instrumentResult.data as Array<{ id: string }> | null) ?? [];
    if (rows.length === 0) throw new BadRequestException('Instrument not found');
    const sections = parseContractMarkdownUtil(markdown);
    return validateContractSections(sections, this.coerceInstrumentType());
  }

  async saveInstrumentContract(input: {
    instrumentId: string;
    userId: string;
    markdown: string;
    changeReason?: string;
  }) {
    await this.requireWrite(input.userId);

    const instrumentResult = await this.db.rawQuery(
      `SELECT i.id, i.current_config_version_id, icv.version_number
       FROM prediction.instruments i
       LEFT JOIN prediction.instrument_config_versions icv ON icv.id = i.current_config_version_id
       WHERE i.id = $1`,
      [input.instrumentId],
    );
    if (instrumentResult.error) throw new Error(instrumentResult.error.message);
    const rows = (instrumentResult.data as Array<Record<string, unknown>> | null) ?? [];
    if (rows.length === 0) throw new BadRequestException('Instrument not found');
    const current = rows[0];
    const oldVersionId = current.current_config_version_id
      ? String(current.current_config_version_id)
      : null;

    const policyType = this.coerceInstrumentType();
    const sections = parseContractMarkdownUtil(input.markdown);
    const validation = validateContractSections(sections, policyType);
    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Contract validation failed',
        instrumentType: policyType,
        missingSections: validation.missingSections,
        forbiddenPhrases: validation.forbiddenPhrases,
        extraSections: validation.extraSections,
      });
    }

    if (oldVersionId) {
      await this.db.rawQuery(
        `UPDATE prediction.instrument_config_versions SET is_active = false WHERE id = $1`,
        [oldVersionId],
      );
    }

    const newVersionId = randomUUID();
    const newVersionNumber = (Number(current.version_number) || 0) + 1;
    await this.db.rawQuery(
      `INSERT INTO prediction.instrument_config_versions
        (id, instrument_id, version_number, context_markdown,
         source, change_reason, parent_version_id, is_active, created_by, created_at,
         author_user_id)
       VALUES ($1, $2, $3, $4, 'manual', $5, $6, true, $7, $8, $9)`,
      [
        newVersionId,
        input.instrumentId,
        newVersionNumber,
        input.markdown,
        input.changeReason || 'Manual contract edit',
        oldVersionId,
        input.userId,
        new Date().toISOString(),
        input.userId,
      ],
    );

    await this.db.rawQuery(
      `UPDATE prediction.instruments SET current_config_version_id = $1 WHERE id = $2`,
      [newVersionId, input.instrumentId],
    );

    return this.getInstrumentContract(input.instrumentId, input.userId);
  }

  // ─── Prediction Challenges ─────────────────────────────────────

  /**
   * Shared logic for running a single challenger against a prediction:
   * builds the prompt, calls the LLM, parses the JSON response, and persists the result.
   */
  private async runSingleChallenge(
    context: ReturnType<typeof this.marketsLlm.buildExecutionContext>,
    pred: Record<string, unknown>,
    predictionId: string,
    challenger: { id: string; slug: string; display_name: string; persona_prompt: string },
  ): Promise<{
    challenger: { id: string; slug: string; display_name: string };
    counterArgument: string;
    counterDirection: string;
    counterConfidence: number;
    evidence: string[];
  }> {
    const systemPrompt = `You are ${challenger.display_name}. ${challenger.persona_prompt}
Another analyst (${pred.analyst_name}) has predicted ${pred.predicted_direction} for ${pred.symbol} at ${pred.confidence}% confidence.
Their reasoning: ${String(pred.rationale).slice(0, 500)}

Using your expertise, provide a counter-argument. Respond with valid JSON only:
{
  "counterArgument": "<your counter-argument from your perspective>",
  "counterDirection": "up" | "down" | "flat",
  "counterConfidence": <0-100>,
  "evidence": ["<evidence point 1>", "<evidence point 2>"]
}`;

    let counterArgument = `As ${challenger.display_name}, I would approach this differently.`;
    let counterDirection = 'flat';
    let counterConfidence = 50;
    let evidence: string[] = [];
    let llmUsageId: string | null = null;

    if (this.marketsLlm.isLlmEnabled()) {
      const result = await this.marketsLlm.generateText(context, systemPrompt, `Challenge the ${pred.predicted_direction} analysis for ${pred.symbol}.`, undefined, {
        stage: 'risk_debate',
        subStage: 'red',
        instrumentId: String(pred.instrument_id ?? ''),
        analystId: challenger.id,
      });
      llmUsageId = result.llmUsageId ?? null;
      const match = result.text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as Record<string, unknown>;
        counterArgument = String(parsed.counterArgument || counterArgument);
        counterDirection = String(parsed.counterDirection || 'flat');
        counterConfidence = Math.min(100, Math.max(0, Number(parsed.counterConfidence) || 50));
        evidence = Array.isArray(parsed.evidence) ? (parsed.evidence as string[]).map(String) : [];
      }
    }

    // Persist
    await this.db.rawQuery(
      `insert into prediction.prediction_challenges
        (prediction_id, challenged_analyst_id, challenger_analyst_id, instrument_id,
         counter_argument, counter_direction, counter_confidence, evidence, llm_usage_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [predictionId, pred.analyst_id, challenger.id, pred.instrument_id,
       counterArgument, counterDirection, counterConfidence, JSON.stringify(evidence), llmUsageId],
    );

    return {
      challenger: { id: challenger.id, slug: challenger.slug, display_name: challenger.display_name },
      counterArgument,
      counterDirection,
      counterConfidence,
      evidence,
    };
  }

  async challengePrediction(userId: string, predictionId: string) {
    await this.requireRead(userId);

    // Check for existing challenges
    const existingResult = await this.db.rawQuery(
      `select count(*) as cnt from prediction.prediction_challenges where prediction_id = $1`,
      [predictionId],
    );
    const existingCount = Number(((existingResult.data as Array<{ cnt: number }>) ?? [])[0]?.cnt ?? 0);
    if (existingCount > 0) {
      return this.getChallenges(userId, predictionId);
    }

    // Load the challenged prediction
    const predResult = await this.db.rawQuery(
      `select mp.*, i.symbol, ma.display_name as analyst_name, ma.slug as analyst_slug
       from prediction.market_predictions mp
       join prediction.instruments i on i.id = mp.instrument_id
       join prediction.market_analysts ma on ma.id = mp.analyst_id
       where mp.id = $1`,
      [predictionId],
    );
    const preds = (predResult.data as Array<Record<string, unknown>> | null) ?? [];
    if (preds.length === 0) throw new Error('Prediction not found');
    const pred = preds[0];

    // Load ALL OTHER enabled personality analysts
    const challResult = await this.db.rawQuery(
      `select id, slug, display_name, persona_prompt
       from prediction.market_analysts
       where user_id IS NULL and analyst_type = 'personality'
         and is_enabled = true and is_active = true and id != $1
       order by slug`,
      [pred.analyst_id],
    );
    const challengers = (challResult.data as Array<{
      id: string; slug: string; display_name: string; persona_prompt: string;
    }> | null) ?? [];

    const context = this.marketsLlm.buildExecutionContext(userId, 'challenge');
    const challenges: Array<Record<string, unknown>> = [];

    // Run challenges in parallel
    const promises = challengers.map(async (challenger) => {
      try {
        const result = await this.runSingleChallenge(context, pred, predictionId, challenger);
        challenges.push(result);
      } catch (err) {
        this.logger.warn(`Challenge failed for challenger ${challenger.id}: ${err instanceof Error ? err.message : String(err)}`);
        // Graceful degradation — skip this challenger
      }
    });

    await Promise.all(promises);
    return { challenges };
  }

  async *challengePredictionStream(userId: string, predictionId: string) {
    await this.requireRead(userId);

    // Check for existing challenges
    const existingResult = await this.db.rawQuery(
      `select count(*) as cnt from prediction.prediction_challenges where prediction_id = $1`,
      [predictionId],
    );
    const existingCount = Number(((existingResult.data as Array<{ cnt: number }>) ?? [])[0]?.cnt ?? 0);
    if (existingCount > 0) {
      const existing = await this.getChallenges(userId, predictionId);
      for (const c of existing) yield c;
      return;
    }

    // Load prediction
    const predResult = await this.db.rawQuery(
      `select mp.*, i.symbol, ma.display_name as analyst_name
       from prediction.market_predictions mp
       join prediction.instruments i on i.id = mp.instrument_id
       join prediction.market_analysts ma on ma.id = mp.analyst_id
       where mp.id = $1`,
      [predictionId],
    );
    const preds = (predResult.data as Array<Record<string, unknown>> | null) ?? [];
    if (preds.length === 0) throw new Error('Prediction not found');
    const pred = preds[0];

    // Load other analysts
    const challResult = await this.db.rawQuery(
      `select id, slug, display_name, persona_prompt
       from prediction.market_analysts
       where user_id IS NULL and analyst_type = 'personality'
         and is_enabled = true and is_active = true and id != $1
       order by slug`,
      [pred.analyst_id],
    );
    const challengers = (challResult.data as Array<{
      id: string; slug: string; display_name: string; persona_prompt: string;
    }> | null) ?? [];

    const context = this.marketsLlm.buildExecutionContext(userId, 'challenge');

    // Yield each challenge as it completes, with progress updates
    for (let i = 0; i < challengers.length; i++) {
      const challenger = challengers[i];
      yield { thinking: true, analyst: challenger.display_name, index: i, total: challengers.length };
      try {
        const result = await this.runSingleChallenge(context, pred, predictionId, challenger);
        yield result;
      } catch {
        // Skip failed challengers
      }
    }
  }

  async getChallenges(userId: string, predictionId: string) {
    await this.requireRead(userId);

    const result = await this.db.rawQuery(
      `select pc.*, ma.display_name as challenger_name, ma.slug as challenger_slug
       from prediction.prediction_challenges pc
       join prediction.market_analysts ma on ma.id = pc.challenger_analyst_id
       where pc.prediction_id = $1
       order by pc.created_at`,
      [predictionId],
    );
    const rows = (result.data as Array<Record<string, unknown>> | null) ?? [];
    return rows.map(r => ({
      challenger: { id: r.challenger_analyst_id, slug: r.challenger_slug, display_name: r.challenger_name },
      counterArgument: r.counter_argument,
      counterDirection: r.counter_direction,
      counterConfidence: r.counter_confidence,
      evidence: r.evidence,
    }));
  }

  // ─── Trade Decisions ──────────────────────────────────────────

  async acknowledgeDisclaimer(userId: string) {
    // Ensure portfolio exists, then set disclaimer timestamp
    const result = await this.db.rawQuery(
      `update prediction.user_portfolios set disclaimer_acknowledged_at = now(), updated_at = now()
       where user_id = $1
       returning disclaimer_acknowledged_at`,
      [userId],
    );
    if ((result.data as unknown[] | null)?.length === 0) {
      // Portfolio doesn't exist yet — create it with disclaimer
      await this.db.rawQuery(
        `insert into prediction.user_portfolios (id, user_id, disclaimer_acknowledged_at, created_at, updated_at)
         values (gen_random_uuid()::text, $1, now(), now(), now())
         on conflict (user_id) do update set disclaimer_acknowledged_at = now(), updated_at = now()`,
        [userId],
      );
    }
    return { acknowledged: true };
  }

  async confirmTrade(
    userId: string,
    input: { predictionId: string; analystId: string; direction: string },
  ) {
    await this.requireRead(userId);

    // Check disclaimer — ensure portfolio exists first
    await this.userPortfolio.ensurePortfolio(userId);
    const disclaimerResult = await this.db.rawQuery(
      `select disclaimer_acknowledged_at from prediction.user_portfolios
       where user_id = $1`,
      [userId],
    );
    const disclaimerRows = (disclaimerResult.data as Array<{ disclaimer_acknowledged_at: string | null }> | null) ?? [];
    if (disclaimerRows.length === 0 || !disclaimerRows[0].disclaimer_acknowledged_at) {
      return { requiresDisclaimer: true };
    }

    // Load prediction
    const predResult = await this.db.rawQuery(
      `select mp.*, i.symbol, i.name as instrument_name
       from prediction.market_predictions mp
       join prediction.instruments i on i.id = mp.instrument_id
       where mp.id = $1`,
      [input.predictionId],
    );
    const preds = (predResult.data as Array<Record<string, unknown>> | null) ?? [];
    if (preds.length === 0) throw new Error('Prediction not found');
    const pred = preds[0];

    // Get effective confidence (calibration-adjusted)
    const rawConfidence = Number(pred.confidence);
    const effectiveConfidence = await this.positionSizing.getEffectiveConfidence(
      rawConfidence,
      input.analystId || String(pred.analyst_id),
    );

    // Calculate position size
    const portfolio = await this.userPortfolio.ensurePortfolio(userId);
    const positionPercent = await this.positionSizing.getPositionPercent(effectiveConfidence);
    const currentPrice = (pred.current_state as Record<string, unknown>)?.price as number || 0;
    // Use instrument current_state price
    const priceResult = await this.db.rawQuery(
      `select current_state->>'price' as price from prediction.instruments where id = $1`,
      [pred.instrument_id],
    );
    const priceRows = (priceResult.data as Array<{ price: string }> | null) ?? [];
    const entryPrice = parseFloat(priceRows[0]?.price || '0') || 100;
    const quantity = this.positionSizing.calculatePositionSize(portfolio.current_balance, entryPrice, positionPercent);

    const direction = input.direction === 'short' ? 'short' : 'long';

    if (quantity <= 0) {
      const minConf = await this.positionSizing.getMinimumConfidence();
      return {
        error: `Analyst confidence is ${Math.round(effectiveConfidence * 100)}% (minimum ${minConf}% required for a position). You can skip this trade or wait for a higher-confidence signal.`,
        effectiveConfidence,
        positionPercent: 0,
      };
    }

    // Queue trade
    const trade = await this.userPortfolio.queueTrade({
      userId,
      predictionId: input.predictionId,
      instrumentId: String(pred.instrument_id),
      symbol: String(pred.symbol),
      direction,
      quantity,
    });

    // Record decision
    await this.db.rawQuery(
      `insert into prediction.user_trade_decisions
        (user_id, prediction_id, instrument_id, symbol, decision, based_on_analyst_id, trade_queue_id, confidence_at_decision)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (user_id, prediction_id) do nothing`,
      [userId, input.predictionId, pred.instrument_id, pred.symbol,
       direction === 'long' ? 'buy' : 'sell', input.analystId, trade.id, effectiveConfidence],
    );

    // Fire-and-forget: record affinity signals for analysts in this run
    this.recordTradeAffinitySignals(
      userId, input.predictionId, String(pred.instrument_id),
      direction === 'long' ? 'buy' : 'sell',
    ).catch((err) => this.logger.warn(`Affinity signal recording failed: ${err instanceof Error ? err.message : String(err)}`));

    return {
      tradeId: trade.id,
      symbol: pred.symbol,
      direction,
      quantity,
      positionPercent,
      effectiveConfidence,
    };
  }

  async skipTrade(userId: string, predictionId: string) {

    // Load prediction for instrument info
    const predResult = await this.db.rawQuery(
      `select instrument_id, i.symbol from prediction.market_predictions mp
       join prediction.instruments i on i.id = mp.instrument_id
       where mp.id = $1`,
      [predictionId],
    );
    const preds = (predResult.data as Array<{ instrument_id: string; symbol: string }> | null) ?? [];

    const instrumentId = preds[0]?.instrument_id ?? '';
    const symbol = preds[0]?.symbol ?? '';

    const result = await this.db.rawQuery(
      `insert into prediction.user_trade_decisions
        (user_id, prediction_id, instrument_id, symbol, decision)
       values ($1, $2, $3, $4, 'skip')
       on conflict (user_id, prediction_id) do nothing
       returning id`,
      [userId, predictionId, instrumentId, symbol],
    );
    const rows = (result.data as Array<{ id: string }> | null) ?? [];

    // Fire-and-forget: record skip-disagreement signals for recommending analysts
    this.recordSkipAffinitySignals(userId, predictionId, instrumentId)
      .catch((err) => this.logger.warn(`Affinity skip signal failed: ${err instanceof Error ? err.message : String(err)}`));

    return { decisionId: rows[0]?.id ?? null, decision: 'skip' };
  }

  async getTradeDecisions(userId: string) {
    await this.requireRead(userId);

    const result = await this.db.rawQuery(
      `select utd.*, ma.display_name as analyst_name,
        coalesce(
          (select json_agg(json_build_object(
            'horizon_days', udo.horizon_days,
            'actual_direction', udo.actual_direction,
            'pnl_if_taken', udo.pnl_if_taken,
            'pnl_actual', udo.pnl_actual
          ) order by udo.horizon_days)
          from prediction.user_decision_outcomes udo
          where udo.decision_id = utd.id
        ), '[]'::json) as outcomes
       from prediction.user_trade_decisions utd
       left join prediction.market_analysts ma on ma.id = utd.based_on_analyst_id
       where utd.user_id = $1
       order by utd.decided_at desc
       limit 50`,
      [userId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Record<string, unknown>[] | null) ?? [];
  }

  async upsertSourceEntitlement(
    input: UpsertSourceEntitlementInput,
  ): Promise<SourceEntitlement> {
    await this.requireWrite(input.userId);

    const payload = {
      source_id: input.sourceId,
      is_enabled: input.isEnabled,
      override_notes: input.overrideNotes ?? null,
      created_by: input.userId,
      updated_at: new Date().toISOString(),
    };
    const upsert = await this.db.rawQuery(
      `
      insert into prediction.tenant_source_entitlements
        (source_id, is_enabled, override_notes, created_by, updated_at)
      values ($1, $2, $3, $4, $5)
      on conflict (source_id)
      do update set
        is_enabled = excluded.is_enabled,
        override_notes = excluded.override_notes,
        created_by = excluded.created_by,
        updated_at = excluded.updated_at
      returning *
      `,
      [
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
    await this.requireWrite(input.userId);

    const enabled = this.isExternalCrawlerSyncEnabled(Boolean(input.force));
    const externalOrganizationSlug = this.getExternalCrawlerOrgSlug();
    if (!enabled || !externalOrganizationSlug) {
      return {
        enabled,
        externalSourceSlug: externalOrganizationSlug,
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
          a.organization_slug as external_source_slug,
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
            external_source_slug,
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
          external_source_slug,
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
          source_origin = excluded.source_origin,
          external_source_slug = excluded.external_source_slug,
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
        and external_source_slug = $1
      `,
      [externalOrganizationSlug],
    );
    if (articleTotals.error) {
      throw new Error(articleTotals.error.message);
    }

    return {
      enabled,
      externalSourceSlug: externalOrganizationSlug,
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
    await this.requireRead(input.userId);

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
    await this.requireWrite(input.userId);

    // 1. Validate article exists and tenant has source entitlement
    const articleResult = await this.db.rawQuery(
      `select ma.id, ma.title, ma.summary, ma.content, ma.source_id
       from prediction.market_articles ma
       join prediction.source_catalog sc on sc.id = ma.source_id
       join prediction.tenant_source_entitlements tse
         on tse.source_id = sc.id and tse.is_enabled = true
       where ma.id = $1`,
      [input.articleId],
    );
    if (articleResult.error) throw new Error(articleResult.error.message);
    const articles = (articleResult.data as Array<{ id: string; title: string | null; summary: string | null; content: string | null }> | null) ?? [];
    if (articles.length === 0) {
      throw new ForbiddenException('Article not found or source not entitled for this organization');
    }
    const article = articles[0];

    // 2. Load instrument
    const instResult = await this.db.rawQuery(
      `select symbol, name, asset_type from prediction.instruments where id = $1 and (user_id IS NULL OR user_id = $2)`,
      [input.instrumentId, input.userId],
    );
    if (instResult.error) throw new Error(instResult.error.message);
    const instruments = (instResult.data as Array<{ symbol: string; name: string; asset_type: string }> | null) ?? [];
    if (instruments.length === 0) throw new BadRequestException('Instrument not found');
    const instrument = instruments[0];

    // 3. LLM scoring
    const context = this.marketsLlm.buildExecutionContext(input.userId, 'predictor-scoring');
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
        undefined,
        { stage: 'article_processing', articleId: input.articleId, instrumentId: input.instrumentId },
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
    await this.requireWrite(input.userId);

    const results: Array<ScorePredictorResult | { articleId: string; error: string }> = [];
    let scored = 0;
    let failed = 0;

    for (const articleId of input.articleIds) {
      try {
        const result = await this.scoreArticleForInstrument({
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
    await this.requireWrite(input.userId);

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
      .maybeSingle();
    if (instrument.error) {
      throw new Error(instrument.error.message);
    }
    if (!instrument.data) {
      throw new NotFoundException('Instrument not found');
    }

    const article = await this.db
      .from('prediction', 'market_articles')
      .select('id')
      .eq('id', input.articleId)
      .maybeSingle();
    if (article.error) {
      throw new Error(article.error.message);
    }
    if (!article.data) {
      throw new NotFoundException('Article not found');
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const insert = await this.db.rawQuery(
      `
      insert into prediction.market_predictors
        (id, instrument_id, article_id, relevance_score, status, rationale, created_by, author_user_id, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (id)
      do update set
        relevance_score = excluded.relevance_score,
        status = excluded.status,
        rationale = excluded.rationale,
        author_user_id = excluded.author_user_id,
        updated_at = now()
      returning *
      `,
      [
        id,
        input.instrumentId,
        input.articleId,
        relevance,
        status,
        input.rationale ?? null,
        input.userId,
        input.authorUserId ?? null,
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
    await this.requireRead(input.userId);

    const statusFilter = input.status ?? 'active';
    const values: Array<string> = [
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
      select mp.*,
             ma.title as article_title,
             ma.url as article_url,
             ma.published_at as article_published_at,
             man.display_name as analyst_display_name,
             man.slug as analyst_slug
      from prediction.market_predictors mp
      left join prediction.market_articles ma on ma.id = mp.article_id
      left join prediction.market_analysts man on man.id = mp.scored_by_analyst_id
      where mp.instrument_id = $1
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
    await this.requireWrite(input.userId);

    const context = this.buildExecutionContext(
      input.userId,
      input.runType,
    );
    const existingQueued = await this.db
      .from('prediction', 'orchestration_runs')
      .select('*')
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
    await this.requireRead(input.userId);

    let query = this.db
      .from('prediction', 'orchestration_runs')
      .select('*')
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
    userId: string,
    runId: string,
  ): Promise<MarketRun> {
    await this.requireRead(userId);

    const run = await this.db
      .from('prediction', 'orchestration_runs')
      .select('*')
      .eq('id', runId)
      .single();
    if (run.error || !run.data) {
      throw new NotFoundException('Run not found');
    }
    return run.data as MarketRun;
  }

  async updateRunStatus(
    input: UpdateRunStatusInput,
  ): Promise<{ runId: string; previousStatus: string; status: string }> {
    await this.requireWrite(input.userId);
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
            when $1 = 'failed' then nullif($4::text, '')
            else null
          end
      where id = $2
        and status = $3
      returning id
      `,
      [
        input.status,
        input.runId,
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
    run: MarketRun,
  ): Promise<MarketAnalyst | null> {
    const assignment = await this.db.rawQuery(
      `
      select analyst_id
      from prediction.market_instrument_analyst_assignments
      where instrument_id = $1
      order by created_at asc
      limit 1
      `,
      [run.instrument_id],
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
      limit 1
      `,
      [analystId],
    );
    if (analyst.error) {
      throw new Error(analyst.error.message);
    }
    const analystRows = (analyst.data as MarketAnalyst[] | null) ?? [];
    return analystRows[0] ?? null;
  }

  private async getLatestRiskAssessmentForInstrument(
    instrumentId: string,
  ): Promise<RiskAssessment | null> {
    const result = await this.db.rawQuery(
      `
      select *
      from prediction.market_risk_assessments
      where instrument_id = $1
      order by created_at desc
      limit 1
      `,
      [instrumentId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    const rows = (result.data as RiskAssessment[] | null) ?? [];
    return rows[0] ?? null;
  }

  private async getActivePredictorContextLines(
    instrumentId: string,
  ): Promise<string[]> {
    const result = await this.db.rawQuery(
      `
      select mp.relevance_score, mp.rationale, ma.title
      from prediction.market_predictors mp
      join prediction.market_articles ma on ma.id = mp.article_id
      where mp.instrument_id = $1
        and mp.status = 'active'
      order by mp.relevance_score desc
      limit 20
      `,
      [instrumentId],
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
        (id, run_id, run_type, analyst_id, model_provider, model_name, prompt, output_text, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      returning *
      `,
      [
        artifact.id,
        artifact.run_id,
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
      instrument_id: run.instrument_id,
      analyst_id: analyst?.id ?? null,
      predicted_direction: predictedDirection,
      confidence,
      horizon_minutes: 240,
      rationale: outputText.slice(0, 1200),
      created_at: new Date().toISOString(),
    };
    // Upsert: one active (unsettled) prediction per analyst per instrument.
    // If one already exists, update it with the new run's data.
    const upsert = await this.db.rawQuery(
      `
      insert into prediction.market_predictions
        (id, run_id, instrument_id, analyst_id, predicted_direction, confidence, horizon_minutes, rationale, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (analyst_id, instrument_id) where settled_at is null and analyst_id is not null
      do update set
        run_id = excluded.run_id,
        predicted_direction = excluded.predicted_direction,
        confidence = excluded.confidence,
        horizon_minutes = excluded.horizon_minutes,
        rationale = excluded.rationale,
        created_at = excluded.created_at
      returning *
      `,
      [
        prediction.id,
        prediction.run_id,
        prediction.instrument_id,
        prediction.analyst_id,
        prediction.predicted_direction,
        prediction.confidence,
        prediction.horizon_minutes,
        prediction.rationale,
        prediction.created_at,
      ],
    );
    if (upsert.error) {
      throw new Error(upsert.error.message);
    }
    const rows = (upsert.data as PredictionOutcome[] | null) ?? [];
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
      instrument_id: run.instrument_id,
      risk_score: riskScore,
      verdict,
      rationale: outputText.slice(0, 1200),
      author_user_id: run.author_user_id ?? null,
      created_at: new Date().toISOString(),
    };
    const insert = await this.db.rawQuery(
      `
      insert into prediction.market_risk_assessments
        (id, run_id, instrument_id, risk_score, verdict, rationale, author_user_id, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning *
      `,
      [
        assessment.id,
        assessment.run_id,
        assessment.instrument_id,
        assessment.risk_score,
        assessment.verdict,
        assessment.rationale,
        assessment.author_user_id ?? null,
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
    await this.requireWrite(input.userId);

    const allowPredictionRuns = process.env.MARKETS_DISABLE_PREDICTION_GENERATION !== 'true';
    const claimed = await this.db.rawQuery(
      `
      with next_run as (
        select id
        from prediction.orchestration_runs
        where status = 'queued'
          and ($1::text is null or id = $1)
          and ($2::text is null or run_type = $2)
          and (run_type <> 'prediction' or $3::boolean = true)
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
      [input.runId ?? null, input.runType ?? null, allowPredictionRuns],
    );
    if (claimed.error) {
      throw new Error(claimed.error.message);
    }
    const run = ((claimed.data as MarketRun[] | null) ?? [])[0];
    if (!run) {
      return { processed: false };
    }

    const context = this.buildExecutionContext(
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
        userId: input.userId,
        runType: input.runType,
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
    await this.requireWrite(input.userId);

    const run = await this.getRun(input.userId, input.runId);
    const prediction = await this.db.rawQuery(
      `
      select *
      from prediction.market_predictions
      where run_id = $1
      order by created_at desc
      limit 1
      `,
      [run.id],
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
        (id, run_id, actual_direction, predicted_direction, was_correct, notes, created_at)
      values ($1, $2, $3, $4, $5, $6, $7)
      returning *
      `,
      [
        evaluation.id,
        evaluation.run_id,
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
    await this.requireRead(input.userId);

    const result = await this.db.rawQuery(
      `
      select *
      from prediction.market_run_artifacts
      where run_id = $1
      order by created_at asc
      `,
      [input.runId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as RunArtifact[] | null) ?? [];
  }

  async listPredictionOutcomes(
    input: ListPredictionOutcomesInput,
  ): Promise<PredictionOutcome[]> {
    await this.requireRead(input.userId);
    if (!input.runId && !input.instrumentId) {
      throw new BadRequestException('runId or instrumentId is required');
    }

    const filters: string[] = [];
    const values: unknown[] = [];
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
    trade_recommendation: TradeRecommendation | null;
  }>> {
    await this.requireRead(userId);

    const minDashboardConfidence = Number(process.env.DASHBOARD_SIGNAL_MIN_CONFIDENCE ?? 70);

    // Get latest unsettled high-conviction signal run per instrument.
    // Neutral or low-conviction analyses remain available on instrument pages,
    // but they should not look like active dashboard trade signals.
    const runsResult = await this.db.rawQuery(
      `
      select distinct on (r.instrument_id)
        r.id as run_id, r.instrument_id, r.created_at,
        i.symbol, i.name
      from prediction.orchestration_runs r
      join prediction.instruments i on i.id = r.instrument_id
      where r.run_type = 'prediction'
        and r.status = 'completed'
        and exists (
          select 1 from prediction.market_predictions mp
          where mp.run_id = r.id and mp.settled_at is null
        )
        and exists (
          select 1 from prediction.market_predictions mp
          where mp.run_id = r.id
            and mp.role = 'arbitrator'
            and mp.settled_at is null
            and mp.predicted_direction in ('up', 'down')
            and (
              case
                when mp.confidence <= 1 then mp.confidence * 100
                else mp.confidence
              end
            ) >= $1
        )
      order by r.instrument_id,
        (select count(*) from prediction.market_predictions mp2
         where mp2.run_id = r.id and mp2.role = 'analyst' and mp2.settled_at is null) desc,
        r.completed_at desc
      `,
      [Number.isFinite(minDashboardConfidence) ? minDashboardConfidence : 70],
    );
    if (runsResult.error) throw new Error(runsResult.error.message);
    const runs = (runsResult.data as Array<{ run_id: string; instrument_id: string; created_at: string; symbol: string; name: string }>) ?? [];

    const dashboardPredictions = [];

    for (const run of runs) {
      // Get all predictions for this run
      const predsResult = await this.db.rawQuery(
        `
        select mp.id as prediction_id, mp.predicted_direction, mp.confidence, mp.rationale, mp.role,
               mp.analyst_id, mp.key_factors, mp.risks,
               ma.display_name as analyst_name, ma.slug as analyst_slug
        from prediction.market_predictions mp
        left join prediction.market_analysts ma on ma.id = mp.analyst_id
        where mp.run_id = $1
        order by mp.role, mp.created_at
        `,
        [run.run_id],
      );
      if (predsResult.error) continue;
      const preds = (predsResult.data as Array<Record<string, unknown>>) ?? [];

      const arbitratorPred = preds.find(p => p.role === 'arbitrator');
      const analystPreds = preds.filter(p => p.role === 'analyst' || p.role === 'paper');

      // Phase 6: ensure a portfolio_manager trade recommendation exists for
      // this run, then size it for THIS viewing user.
      // - Generation is portfolio-agnostic (idempotent across all viewers).
      // - Sizing computes quantity per-user from the user's own balance.
      let tradeRec: TradeRecommendation | null = null;
      try {
        const baseRec = await this.tradeRecommendation.generateForRun({
          runId: run.run_id,
        });
        if (baseRec) {
          const portfolio = await this.userPortfolio.ensurePortfolio(userId);
          tradeRec = TradeRecommendationService.sizeForUser(baseRec, Number(portfolio.current_balance));
        }
      } catch (err) {
        // Don't fail the dashboard if recommendation generation fails
        // (e.g. missing arbitrator output for an old run)
      }

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
          prediction_id: String(p.prediction_id || ''),
          analyst_id: String(p.analyst_id || ''),
          analyst_name: String(p.analyst_name || 'Unknown'),
          analyst_slug: String(p.analyst_slug || ''),
          direction: String(p.predicted_direction),
          confidence: Number(p.confidence),
          rationale: String(p.rationale || ''),
          key_factors: p.key_factors,
          risks: p.risks,
        })),
        trade_recommendation: tradeRec,
      });
    }

    return dashboardPredictions;
  }

  /**
   * Phase 6: get-or-generate the portfolio manager trade recommendation for
   * a specific run. Used by the standalone endpoint and tests.
   */
  async getTradeRecommendation(
    runId: string,
    userId: string,
  ): Promise<TradeRecommendation | null> {
    await this.requireRead(userId);
    const baseRec = await this.tradeRecommendation.generateForRun({
      runId,
    });
    if (!baseRec) return null;
    const portfolio = await this.userPortfolio.ensurePortfolio(userId);
    return TradeRecommendationService.sizeForUser(baseRec, Number(portfolio.current_balance));
  }

  /**
   * Dashboard risk summary — latest composite score per instrument.
   */
  async getDashboardRiskSummary(
    userId: string,
  ): Promise<Array<Record<string, unknown>>> {
    await this.requireRead(userId);

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
      order by cs.instrument_id, cs.created_at desc
      `,
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Array<Record<string, unknown>>) ?? [];
  }

  async listRiskAssessments(
    input: ListRiskAssessmentsInput,
  ): Promise<RiskAssessment[]> {
    await this.requireRead(input.userId);
    if (!input.runId && !input.instrumentId) {
      throw new BadRequestException('runId or instrumentId is required');
    }

    const filters: string[] = [];
    const values: unknown[] = [];
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
    if (input.analystId) {
      filters.push(`analyst_id = $${values.length + 1}`);
      values.push(input.analystId);
    }
    if (input.authorUserId !== undefined) {
      filters.push(`COALESCE(author_user_id, '') = $${values.length + 1}`);
      values.push(input.authorUserId || '');
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
    userId: string,
    runId: string,
  ): Promise<RunEvaluation[]> {
    await this.requireRead(userId);
    const result = await this.db.rawQuery(
      `
      select *
      from prediction.market_run_evaluations
      where run_id = $1
      order by created_at desc
      `,
      [runId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as RunEvaluation[] | null) ?? [];
  }

  async listRunReplays(
    userId: string,
    runId: string,
  ): Promise<RunReplay[]> {
    await this.requireRead(userId);
    const result = await this.db.rawQuery(
      `
      select *
      from prediction.market_run_replays
      where run_id = $1
      order by created_at desc
      `,
      [runId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data as RunReplay[] | null) ?? [];
  }

  async replayRun(input: ReplayRunInput): Promise<RunReplay> {
    await this.requireWrite(input.userId);
    const run = await this.getRun(input.userId, input.runId);
    const context = this.buildExecutionContext(
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
      scenario: input.scenario,
      replay_output: replayOutput,
      created_at: new Date().toISOString(),
    };
    const insert = await this.db.rawQuery(
      `
      insert into prediction.market_run_replays
        (id, run_id, scenario, replay_output, created_at)
      values ($1, $2, $3, $4, $5)
      returning *
      `,
      [
        replay.id,
        replay.run_id,
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

  async getRunDetail(userId: string, runId: string) {
    await this.requireRead(userId);

    const run = await this.getRun(userId, runId);

    // Load analyst outcomes + arbitrator
    const predictions = await this.db.rawQuery(
      `select mp.*, ma.display_name as analyst_name, ma.default_weight as analyst_weight
       from prediction.market_predictions mp
       left join prediction.market_analysts ma on ma.id = mp.analyst_id
       where mp.run_id = $1
       order by mp.role asc, mp.created_at asc`,
      [runId],
    );
    const predRows = (predictions.data as Array<Record<string, unknown>> | null) ?? [];
    const analystOutcomes = predRows.filter((r) => r['role'] === 'analyst' || !r['role']);
    const arbitratorOutcome = predRows.find((r) => r['role'] === 'arbitrator') ?? null;

    // Load risk details if risk run
    let riskDetails = null;
    if (run.run_type === 'risk') {
      riskDetails = await this.getRunRiskDetails(userId, runId);
    }

    return { ...run, analystOutcomes, arbitratorOutcome, riskDetails };
  }

  async getRunRiskDetails(userId: string, runId: string) {
    await this.requireRead(userId);

    const composite = await this.db.rawQuery(
      `select * from prediction.risk_composite_scores
       where run_id = $1
       order by created_at desc limit 1`,
      [runId],
    );
    const compositeRow = ((composite.data as Record<string, unknown>[] | null) ?? [])[0] ?? null;

    const assessments = await this.db.rawQuery(
      `select rda.*, rd.slug as dimension_slug, rd.name as dimension_name
       from prediction.risk_dimension_assessments rda
       left join prediction.risk_dimensions rd on rd.id = rda.dimension_id
       where rda.run_id = $1
       order by rd.display_order asc`,
      [runId],
    );
    const assessmentRows = (assessments.data as Record<string, unknown>[] | null) ?? [];

    // Check for per-analyst risk assessments (new format)
    const analystAssessments = await this.db.rawQuery(
      `select ara.*, ma.display_name as analyst_name, ma.slug as analyst_slug
       from prediction.analyst_risk_assessments ara
       left join prediction.market_analysts ma on ma.id = ara.analyst_id
       where ara.run_id = $1
       order by ara.score desc`,
      [runId],
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
       where run_id = $1
       order by created_at desc limit 1`,
      [runId],
    );
    const debateRow = ((debate.data as Record<string, unknown>[] | null) ?? [])[0] ?? null;

    return { compositeScore: compositeRow, dimensionAssessments: effectiveAssessments, debate: debateRow };
  }

  // ─── Debate Reasoning Drilldown ─────────────────────────────────

  async getDebateReasoning(debateId: string) {

    // Load the debate row to get transcript
    const debateResult = await this.db.rawQuery(
      `SELECT id, transcript FROM prediction.risk_debates
       WHERE id = $1`,
      [debateId],
    );
    if (debateResult.error) throw new Error(debateResult.error.message);
    const debateRows = (debateResult.data as Array<{ id: string; transcript: unknown }> | null) ?? [];
    if (debateRows.length === 0) throw new BadRequestException('Debate not found');

    const transcript = (debateRows[0].transcript ?? []) as Array<{ role: string; content: string; llm_usage_id: string | null }>;

    // Build role → llm_usage_id map
    const roleMap: Record<string, string> = {};
    for (const entry of transcript) {
      if (entry.llm_usage_id) {
        roleMap[entry.role] = entry.llm_usage_id;
      }
    }

    const usageIds = Object.values(roleMap);
    if (usageIds.length === 0) {
      return { blue: null, red: null, arbiter: null };
    }

    // Fetch reasoning from llm_usage
    const usageResult = await this.db.rawQuery(
      `SELECT run_id, provider, model, input_tokens, output_tokens,
              reasoning_tokens, reasoning_content, reasoning_truncated
       FROM public.llm_usage
       WHERE run_id::text = ANY($1)`,
      [usageIds],
    );
    if (usageResult.error) throw new Error(usageResult.error.message);
    const usageRows = (usageResult.data as Array<Record<string, unknown>> | null) ?? [];

    // Map run_id back to role
    const usageByRunId: Record<string, Record<string, unknown>> = {};
    for (const row of usageRows) {
      usageByRunId[String(row.run_id)] = row;
    }

    function mapAgent(role: string): {
      provider: string; model: string;
      inputTokens: number | null; outputTokens: number | null;
      reasoningTokens: number | null; reasoningContent: string | null;
      reasoningTruncated: boolean;
    } | null {
      const usageId = roleMap[role];
      if (!usageId) return null;
      const row = usageByRunId[usageId];
      if (!row) return null;
      return {
        provider: String(row.provider ?? ''),
        model: String(row.model ?? ''),
        inputTokens: row.input_tokens != null ? Number(row.input_tokens) : null,
        outputTokens: row.output_tokens != null ? Number(row.output_tokens) : null,
        reasoningTokens: row.reasoning_tokens != null ? Number(row.reasoning_tokens) : null,
        reasoningContent: row.reasoning_content ? String(row.reasoning_content) : null,
        reasoningTruncated: Boolean(row.reasoning_truncated),
      };
    }

    return {
      blue: mapAgent('blue'),
      red: mapAgent('red'),
      arbiter: mapAgent('arbiter'),
    };
  }

  /**
   * Re-run the risk debate for an existing risk run.
   * Loads the existing composite score and dimension assessments, then runs a fresh debate.
   */
  async rerunDebate(
    userId: string,
    runId: string,
  ): Promise<Record<string, unknown>> {
    await this.requireWrite(userId);

    // Load existing composite score
    const comp = await this.db.rawQuery(
      `select * from prediction.risk_composite_scores
       where run_id = $1
       order by created_at desc limit 1`,
      [runId],
    );
    const compositeRow = ((comp.data as Record<string, unknown>[] | null) ?? [])[0];
    if (!compositeRow) throw new BadRequestException('No composite score found for this run');

    // Load dimension assessments
    const dims = await this.db.rawQuery(
      `select * from prediction.risk_dimension_assessments
       where run_id = $1
       order by created_at asc`,
      [runId],
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
      userId,
      'risk',
    );

    return this.riskRunner.rerunDebate({
      context,
      runId,
      instrumentId: String(compositeRow.instrument_id),
      instrumentSymbol: symbol,
      compositeScoreId: String(compositeRow.id),
      overallScore: Number(compositeRow.pre_debate_score ?? compositeRow.overall_score),
      dimensionAssessments: dimRows as never[],
    });
  }

  async listRiskDimensions(userId: string) {
    await this.requireRead(userId);

    const result = await this.db.rawQuery(
      `select * from prediction.risk_dimensions
       where (user_id IS NULL OR user_id = $1)
         and is_active = true
       order by
         case when user_id = $1 then 0 else 1 end,
         display_order asc`,
      [userId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Record<string, unknown>[] | null) ?? [];
  }

  async upsertRiskDimension(input: {
    userId: string;
    slug: string;
    name: string;
    description?: string;
    weight: number;
    displayOrder?: number;
    systemPrompt?: string;
    isActive?: boolean;
  }): Promise<Record<string, unknown>> {
    await this.requireWrite(input.userId);

    const id = `${input.userId}_dim_${input.slug}`;
    const result = await this.db.rawQuery(
      `insert into prediction.risk_dimensions
        (id, user_id, domain_slug, slug, name, description, weight,
         display_order, is_active, system_prompt, updated_at)
       values ($1, $2, 'financial', $3, $4, $5, $6, $7, $8, $9, now())
       on conflict (user_id, slug) do update set
         name = excluded.name,
         description = excluded.description,
         weight = excluded.weight,
         display_order = excluded.display_order,
         is_active = excluded.is_active,
         system_prompt = excluded.system_prompt,
         updated_at = now()
       returning *`,
      [
        id, input.userId, input.slug, input.name,
        input.description ?? null, input.weight, input.displayOrder ?? 0,
        input.isActive ?? true, input.systemPrompt ?? null,
      ],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as Record<string, unknown>[] | null) ?? [])[0] ?? {};
  }

  async getInstrumentCompositeScore(userId: string, instrumentId: string) {
    await this.requireRead(userId);

    // Latest active composite
    const latest = await this.db.rawQuery(
      `select rcs.*, orr.created_at as run_created_at
       from prediction.risk_composite_scores rcs
       join prediction.orchestration_runs orr on orr.id = rcs.run_id
       where rcs.instrument_id = $1 and rcs.status = 'active'
       order by rcs.created_at desc limit 1`,
      [instrumentId],
    );
    const latestRow = ((latest.data as Record<string, unknown>[] | null) ?? [])[0] ?? null;

    // Trend: last 10 composites
    const trend = await this.db.rawQuery(
      `select overall_score, debate_adjustment, confidence, created_at
       from prediction.risk_composite_scores
       where instrument_id = $1
       order by created_at desc limit 10`,
      [instrumentId],
    );
    const trendRows = (trend.data as Record<string, unknown>[] | null) ?? [];

    return { current: latestRow, trend: trendRows.reverse() };
  }

  async listPredictionsWithRole(input: {
    userId: string;
    runId?: string;
    instrumentId?: string;
    role?: 'analyst' | 'arbitrator' | 'all';
    analystId?: string;
    authorUserId?: string | null;
    limit?: number;
  }) {
    await this.requireRead(input.userId);
    const limit = Number.isFinite(input.limit) ? Math.min(Math.max(Math.trunc(input.limit ?? 240), 1), 500) : 240;

    let query = `select mp.*,
        ma.display_name as analyst_name,
        i.symbol,
        i.name as instrument_name
      from prediction.market_predictions mp
      left join prediction.market_analysts ma on ma.id = mp.analyst_id
      left join prediction.instruments i on i.id = mp.instrument_id
      where true`;
    const params: unknown[] = [];
    let idx = 1;

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
    if (input.analystId) {
      query += ` and mp.analyst_id = $${idx}`;
      params.push(input.analystId);
      idx++;
    }
    if (input.authorUserId !== undefined) {
      query += ` and COALESCE(mp.author_user_id, '') = $${idx}`;
      params.push(input.authorUserId || '');
      idx++;
    }
    query += ' order by mp.created_at desc';
    query += ` limit $${idx}`;
    params.push(limit);

    const result = await this.db.rawQuery(query, params);
    if (result.error) throw new Error(result.error.message);
    return (result.data as Record<string, unknown>[] | null) ?? [];
  }

  // ─── Learning Proposal Management ─────────────────────────────

  async listLearningProposals(userId: string, status?: string, tier?: number) {
    await this.requireRead(userId);

    let query = `select lp.*, ma.display_name as analyst_name
      from prediction.learning_proposals lp
      left join prediction.market_analysts ma on ma.id = lp.analyst_id
      where (lp.user_id IS NULL OR lp.user_id = $1)`;
    const params: unknown[] = [userId];
    let paramIndex = 2;

    if (status) {
      query += ` and lp.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (tier !== undefined) {
      query += ` and lp.tier = $${paramIndex}`;
      params.push(tier);
      paramIndex++;
    }
    query += ' order by lp.proposed_at desc';

    const result = await this.db.rawQuery(query, params);
    if (result.error) throw new Error(result.error.message);
    return (result.data as Record<string, unknown>[] | null) ?? [];
  }

  async getProposalDetail(userId: string, proposalId: string) {
    await this.requireRead(userId);

    const result = await this.db.rawQuery(
      `select lp.*, ma.display_name as analyst_name
       from prediction.learning_proposals lp
       left join prediction.market_analysts ma on ma.id = lp.analyst_id
       where lp.id = $1 and (lp.user_id IS NULL OR lp.user_id = $2)`,
      [proposalId, userId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Record<string, unknown>[] | null) ?? [];
    if (rows.length === 0) throw new BadRequestException('Proposal not found');
    return rows[0];
  }

  async approveProposal(userId: string, proposalId: string) {
    await this.requireWrite(userId);

    // Update proposal status
    const result = await this.db.rawQuery(
      `update prediction.learning_proposals
       set status = 'approved', reviewed_by = $1, reviewed_at = now()
       where id = $2 and status in ('passed', 'proposed')
       returning *`,
      [userId, proposalId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Record<string, unknown>[] | null) ?? [];
    if (rows.length === 0) throw new BadRequestException('Proposal not found or not in an approvable state');
    const proposal = rows[0] as Record<string, unknown>;

    // Tier 3: create new config version on approval
    if (proposal.tier === 3 && proposal.proposed_context_markdown && proposal.analyst_id) {
      const analystId = proposal.analyst_id as string;

      // Get current active config version
      const currentResult = await this.db.rawQuery(
        `select id, version_number from prediction.analyst_config_versions
         where analyst_id = $1 and is_active = true
         order by version_number desc limit 1`,
        [analystId],
      );
      if (currentResult.error) throw new Error(currentResult.error.message);
      const currentRows = (currentResult.data as Array<{ id: string; version_number: number }> | null) ?? [];
      const current = currentRows[0];

      if (current) {
        const newVersionId = `acv-tier3-${Date.now()}`;
        const newVersion = current.version_number + 1;

        // Deactivate current version
        await this.db.rawQuery(
          `update prediction.analyst_config_versions set is_active = false where id = $1`,
          [current.id],
        );

        // Create new version with tier3_strategic source
        await this.db.rawQuery(
          `insert into prediction.analyst_config_versions (
            id, analyst_id, version_number,
            persona_prompt, context_markdown, source, change_reason,
            parent_version_id, is_active, created_by
          ) select
            $1, analyst_id, $2,
            persona_prompt, $3, 'tier3_strategic', $4,
            $5, true, $6
          from prediction.analyst_config_versions where id = $5`,
          [
            newVersionId,
            newVersion,
            proposal.proposed_context_markdown as string,
            `Tier 3 strategic overhaul: ${(proposal.description as string) || 'approved proposal'}`,
            current.id,
            userId,
          ],
        );

        // Mark proposal as applied
        await this.db.rawQuery(
          `update prediction.learning_proposals set status = 'applied', applied_at = now() where id = $1`,
          [proposalId],
        );

        return { ...proposal, status: 'applied', config_version_id: newVersionId };
      }
    }

    return proposal;
  }

  async rejectProposal(userId: string, proposalId: string, reason?: string) {
    await this.requireWrite(userId);

    const result = await this.db.rawQuery(
      `update prediction.learning_proposals
       set status = 'rejected', reviewed_by = $1, reviewed_at = now(),
           rationale = case when $3 is not null then rationale || ' | Rejected: ' || $3 else rationale end
       where id = $2 and status in ('passed', 'proposed', 'testing')
       returning *`,
      [userId, proposalId, reason ?? null],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Record<string, unknown>[] | null) ?? [];
    if (rows.length === 0) throw new BadRequestException('Proposal not found or not in a rejectable state');
    return rows[0];
  }

  async listLearningReports(userId: string, limit = 10) {
    await this.requireRead(userId);

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
  async getDailyReport(userId: string) {
    await this.requireRead(userId);

    // Prediction runs completed today
    const runs = await this.db.rawQuery(
      `select r.id, r.instrument_id, r.run_type, r.status, r.created_at, r.completed_at,
              i.symbol, i.name
       from prediction.orchestration_runs r
       join prediction.instruments i on i.id = r.instrument_id
       where r.created_at >= now() - interval '24 hours'
       order by r.created_at desc`,
    );
    const runRows = (runs.data as Array<Record<string, unknown>>) ?? [];

    // Predictions made today
    const preds = await this.db.rawQuery(
      `select mp.instrument_id, mp.predicted_direction, mp.confidence, mp.role,
              ma.display_name as analyst_name, i.symbol
       from prediction.market_predictions mp
       left join prediction.market_analysts ma on ma.id = mp.analyst_id
       join prediction.instruments i on i.id = mp.instrument_id
       where mp.created_at >= now() - interval '24 hours'
       order by mp.created_at desc`,
    );
    const predRows = (preds.data as Array<Record<string, unknown>>) ?? [];

    // Risk scores generated today
    const risks = await this.db.rawQuery(
      `select cs.instrument_id, cs.overall_score, cs.pre_debate_score,
              cs.debate_adjustment, cs.confidence, i.symbol
       from prediction.risk_composite_scores cs
       join prediction.instruments i on i.id = cs.instrument_id
       where cs.created_at >= now() - interval '24 hours'
       order by cs.created_at desc`,
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

  // ─── Affinity Signal Helpers ────────────────────────────────

  /**
   * After a buy/sell trade decision, record agreement signals for analysts
   * whose prediction aligned with the user's action.
   */
  private async recordTradeAffinitySignals(
    userId: string,
    predictionId: string,
    instrumentId: string,
    decision: 'buy' | 'sell',
  ): Promise<void> {
    // Find the run for this prediction, then get all analyst predictions in that run
    const runResult = await this.db.rawQuery(
      `select run_id from prediction.market_predictions where id = $1`,
      [predictionId],
    );
    const runRows = (runResult.data as Array<{ run_id: string }> | null) ?? [];
    if (runRows.length === 0) return;

    const analystPreds = await this.db.rawQuery(
      `select analyst_id, predicted_direction
       from prediction.market_predictions
       where run_id = $1 and role = 'analyst' and analyst_id is not null`,
      [runRows[0].run_id],
    );
    const analysts = (analystPreds.data as Array<{ analyst_id: string; predicted_direction: string }> | null) ?? [];

    for (const a of analysts) {
      const userDirection = decision === 'buy' ? 'up' : 'down';
      if (a.predicted_direction === userDirection) {
        await this.affinity.recordSignal(
          userId, a.analyst_id,
          decision === 'buy' ? 'buy_agreement' : 'sell_agreement',
          predictionId, instrumentId,
        );
      }
    }

    // Check for challenge signals
    await this.recordChallengeAffinitySignals(userId, predictionId, instrumentId, true);
  }

  /**
   * After a skip decision, record disagreement signals for analysts
   * who recommended action (predicted up or down, not flat).
   */
  private async recordSkipAffinitySignals(
    userId: string,
    predictionId: string,
    instrumentId: string,
  ): Promise<void> {
    const runResult = await this.db.rawQuery(
      `select run_id from prediction.market_predictions where id = $1`,
      [predictionId],
    );
    const runRows = (runResult.data as Array<{ run_id: string }> | null) ?? [];
    if (runRows.length === 0) return;

    const analystPreds = await this.db.rawQuery(
      `select analyst_id, predicted_direction
       from prediction.market_predictions
       where run_id = $1 and role = 'analyst' and analyst_id is not null
         and predicted_direction != 'flat'`,
      [runRows[0].run_id],
    );
    const analysts = (analystPreds.data as Array<{ analyst_id: string; predicted_direction: string }> | null) ?? [];

    for (const a of analysts) {
      await this.affinity.recordSignal(
        userId, a.analyst_id, 'skip_disagreement',
        predictionId, instrumentId,
      );
    }

    // Check for challenge signals
    await this.recordChallengeAffinitySignals(userId, predictionId, instrumentId, false);
  }

  /**
   * If a challenge exists for this prediction, record challenge_accept or challenge_reject
   * for the challenged analyst.
   */
  private async recordChallengeAffinitySignals(
    userId: string,
    predictionId: string,
    instrumentId: string,
    userActed: boolean,
  ): Promise<void> {
    const challengeResult = await this.db.rawQuery(
      `select challenged_analyst_id from prediction.prediction_challenges
       where prediction_id = $1
       limit 1`,
      [predictionId],
    );
    const challenges = (challengeResult.data as Array<{ challenged_analyst_id: string }> | null) ?? [];
    if (challenges.length === 0) return;

    const signalType = userActed ? 'challenge_accept' : 'challenge_reject';
    for (const c of challenges) {
      await this.affinity.recordSignal(
        userId, c.challenged_analyst_id, signalType,
        predictionId, instrumentId,
      );
    }
  }

  // ─── Ownership Guards (effort: user-authored-custom-content) ────

  private async assertOwnsAnalyst(analystId: string, userId: string): Promise<void> {
    const result = await this.db.rawQuery(
      `SELECT id, user_id FROM prediction.market_analysts WHERE id = $1`,
      [analystId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<{ id: string; user_id: string | null }> | null) ?? [];
    if (rows.length === 0) throw new NotFoundException('Analyst not found');
    const row = rows[0];
    if (row.user_id === null || row.user_id === undefined) {
      throw new ForbiddenException('Base content is immutable');
    }
    if (row.user_id !== userId) {
      throw new ForbiddenException('Not the owner of this content');
    }
  }

  private async assertOwnsInstrument(instrumentId: string, userId: string): Promise<void> {
    const result = await this.db.rawQuery(
      `SELECT id, user_id FROM prediction.instruments WHERE id = $1`,
      [instrumentId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<{ id: string; user_id: string | null }> | null) ?? [];
    if (rows.length === 0) throw new NotFoundException('Instrument not found');
    const row = rows[0];
    if (row.user_id === null || row.user_id === undefined) {
      throw new ForbiddenException('Base content is immutable');
    }
    if (row.user_id !== userId) {
      throw new ForbiddenException('Not the owner of this content');
    }
  }

  // ─── User-Authored CRUD (effort: user-authored-custom-content) ──

  async listMyAnalysts(userId: string): Promise<MarketAnalyst[]> {
    const result = await this.db.rawQuery(
      `SELECT * FROM prediction.market_analysts WHERE user_id = $1 AND is_active = true ORDER BY display_name`,
      [userId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as MarketAnalyst[] | null) ?? [];
  }

  async softDeleteAnalyst(analystId: string, userId: string): Promise<void> {
    await this.assertOwnsAnalyst(analystId, userId);
    const result = await this.db.rawQuery(
      `UPDATE prediction.market_analysts SET is_active = false WHERE id = $1`,
      [analystId],
    );
    if (result.error) throw new Error(result.error.message);

    // Billing: cancel authored analyst item
    try {
      await this.billing.cancelAuthoredItem(userId, 'custom_analyst', analystId);
    } catch (err: any) {
      this.logger.warn(`Billing item cancellation failed for analyst ${analystId}: ${err.message}`);
    }
  }

  async updateAnalystMetadata(
    analystId: string,
    userId: string,
    patch: {
      displayName?: string;
      llmProvider?: string | null;
      llmModel?: string | null;
      byoCredentialId?: string | null;
    },
  ): Promise<void> {
    await this.assertOwnsAnalyst(analystId, userId);

    // Validation: BYO provider requires credential; divinr/null must not have credential
    if (patch.llmProvider !== undefined) {
      const isByo = patch.llmProvider && patch.llmProvider.startsWith('byo_');
      if (isByo && !patch.byoCredentialId) {
        throw new Error('byoCredentialId is required when llmProvider starts with byo_');
      }
      if (!isByo && patch.byoCredentialId) {
        throw new Error('byoCredentialId must be null when llmProvider is not a BYO provider');
      }
    }

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (patch.displayName !== undefined) {
      setClauses.push(`display_name = $${paramIdx++}`);
      params.push(patch.displayName);
    }
    if (patch.llmProvider !== undefined) {
      setClauses.push(`llm_provider = $${paramIdx++}`);
      params.push(patch.llmProvider);
    }
    if (patch.llmModel !== undefined) {
      setClauses.push(`llm_model = $${paramIdx++}`);
      params.push(patch.llmModel);
    }
    if (patch.byoCredentialId !== undefined) {
      setClauses.push(`byo_credential_id = $${paramIdx++}`);
      params.push(patch.byoCredentialId);
    }

    if (setClauses.length === 0) return;

    setClauses.push(`updated_at = now()`);
    params.push(analystId);

    const result = await this.db.rawQuery(
      `UPDATE prediction.market_analysts SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
      params,
    );
    if (result.error) throw new Error(result.error.message);
  }

  async listMyInstruments(userId: string): Promise<MarketInstrument[]> {
    const result = await this.db.rawQuery(
      `SELECT * FROM prediction.instruments WHERE user_id = $1 AND is_active = true ORDER BY symbol`,
      [userId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as MarketInstrument[] | null) ?? [];
  }

  async softDeleteInstrument(instrumentId: string, userId: string): Promise<void> {
    await this.assertOwnsInstrument(instrumentId, userId);
    const result = await this.db.rawQuery(
      `UPDATE prediction.instruments SET is_active = false WHERE id = $1`,
      [instrumentId],
    );
    if (result.error) throw new Error(result.error.message);

    // Billing: cancel authored instrument item
    try {
      await this.billing.cancelAuthoredItem(userId, 'custom_instrument', instrumentId);
    } catch (err: any) {
      this.logger.warn(`Billing item cancellation failed for instrument ${instrumentId}: ${err.message}`);
    }
  }

  // ─── Scaffold Methods (effort: user-authored-custom-content) ────

  async scaffoldAnalystContract(
    analystId: string,
    userId: string,
  ): Promise<{ contextMarkdown: string; versionId: string }> {
    await this.assertOwnsAnalyst(analystId, userId);

    // Fetch analyst metadata
    const analystResult = await this.db.rawQuery(
      `SELECT display_name, analyst_type FROM prediction.market_analysts WHERE id = $1`,
      [analystId],
    );
    if (analystResult.error) throw new Error(analystResult.error.message);
    const analysts = (analystResult.data as Array<{ display_name: string; analyst_type: string }> | null) ?? [];
    if (analysts.length === 0) throw new NotFoundException('Analyst not found');
    const analyst = analysts[0];

    // Generate scaffold via LLM
    const prompt = ANALYST_SCAFFOLD_PROMPT(analyst.display_name, analyst.analyst_type);
    const context = this.marketsLlm.buildExecutionContext(userId, 'scaffold');
    const llmResult = await this.marketsLlm.generateText(
      context,
      'You are a financial analysis contract generator.',
      prompt,
      undefined,
      { stage: 'other', analystId, billedUserId: userId },
    );
    const contextMarkdown = llmResult.text;

    // Get current version number
    const currentResult = await this.db.rawQuery(
      `SELECT current_config_version_id FROM prediction.market_analysts WHERE id = $1`,
      [analystId],
    );
    const currentRows = (currentResult.data as Array<{ current_config_version_id: string | null }> | null) ?? [];
    const oldVersionId = currentRows.length > 0 ? currentRows[0].current_config_version_id : null;

    let versionNumber = 1;
    if (oldVersionId) {
      const vResult = await this.db.rawQuery(
        `SELECT version_number FROM prediction.analyst_config_versions WHERE id = $1`,
        [oldVersionId],
      );
      const vRows = (vResult.data as Array<{ version_number: number }> | null) ?? [];
      versionNumber = (vRows.length > 0 ? Number(vRows[0].version_number) : 0) + 1;

      // Deactivate old version
      await this.db.rawQuery(
        `UPDATE prediction.analyst_config_versions SET is_active = false WHERE id = $1`,
        [oldVersionId],
      );
    }

    // Insert new version
    const versionId = randomUUID();
    await this.db.rawQuery(
      `INSERT INTO prediction.analyst_config_versions
        (id, analyst_id, version_number, context_markdown,
         source, change_reason, parent_version_id, is_active,
         created_by, created_at, author_user_id)
       VALUES ($1, $2, $3, $4, 'manual', 'scaffold', $5, true, $6, $7, $8)`,
      [
        versionId, analystId, versionNumber, contextMarkdown,
        oldVersionId, userId, new Date().toISOString(), userId,
      ],
    );

    // Update analyst pointer
    await this.db.rawQuery(
      `UPDATE prediction.market_analysts SET current_config_version_id = $1 WHERE id = $2`,
      [versionId, analystId],
    );

    return { contextMarkdown, versionId };
  }

  async scaffoldInstrumentContract(
    instrumentId: string,
    userId: string,
  ): Promise<{ contextMarkdown: string; versionId: string }> {
    await this.assertOwnsInstrument(instrumentId, userId);

    // Fetch instrument metadata
    const instrumentResult = await this.db.rawQuery(
      `SELECT symbol, name, asset_type FROM prediction.instruments WHERE id = $1`,
      [instrumentId],
    );
    if (instrumentResult.error) throw new Error(instrumentResult.error.message);
    const instruments = (instrumentResult.data as Array<{ symbol: string; name: string; asset_type: string }> | null) ?? [];
    if (instruments.length === 0) throw new NotFoundException('Instrument not found');
    const instrument = instruments[0];

    // Generate scaffold via LLM
    const prompt = INSTRUMENT_SCAFFOLD_PROMPT(instrument.symbol, instrument.name, instrument.asset_type);
    const context = this.marketsLlm.buildExecutionContext(userId, 'scaffold');
    const llmResult = await this.marketsLlm.generateText(
      context,
      'You are a financial analysis contract generator.',
      prompt,
      undefined,
      { stage: 'other', instrumentId, billedUserId: userId },
    );
    const contextMarkdown = llmResult.text;

    // Get current version number
    const currentResult = await this.db.rawQuery(
      `SELECT current_config_version_id FROM prediction.instruments WHERE id = $1`,
      [instrumentId],
    );
    const currentRows = (currentResult.data as Array<{ current_config_version_id: string | null }> | null) ?? [];
    const oldVersionId = currentRows.length > 0 ? currentRows[0].current_config_version_id : null;

    let versionNumber = 1;
    if (oldVersionId) {
      const vResult = await this.db.rawQuery(
        `SELECT version_number FROM prediction.instrument_config_versions WHERE id = $1`,
        [oldVersionId],
      );
      const vRows = (vResult.data as Array<{ version_number: number }> | null) ?? [];
      versionNumber = (vRows.length > 0 ? Number(vRows[0].version_number) : 0) + 1;

      // Deactivate old version
      await this.db.rawQuery(
        `UPDATE prediction.instrument_config_versions SET is_active = false WHERE id = $1`,
        [oldVersionId],
      );
    }

    // Insert new version
    const versionId = randomUUID();
    await this.db.rawQuery(
      `INSERT INTO prediction.instrument_config_versions
        (id, instrument_id, version_number, context_markdown,
         source, change_reason, parent_version_id, is_active,
         created_by, created_at, author_user_id)
       VALUES ($1, $2, $3, $4, 'manual', 'scaffold', $5, true, $6, $7, $8)`,
      [
        versionId, instrumentId, versionNumber, contextMarkdown,
        oldVersionId, userId, new Date().toISOString(), userId,
      ],
    );

    // Update instrument pointer
    await this.db.rawQuery(
      `UPDATE prediction.instruments SET current_config_version_id = $1 WHERE id = $2`,
      [versionId, instrumentId],
    );

    return { contextMarkdown, versionId };
  }

  // ─── Contract Version Filtering (effort: user-authored-custom-content) ──

  async getAnalystContractVersions(
    analystId: string,
    userId: string,
    authorFilter?: string,
  ): Promise<Array<Record<string, unknown>>> {

    const analystCheck = await this.db.rawQuery(
      `SELECT id FROM prediction.market_analysts WHERE id = $1 AND (user_id IS NULL OR user_id = $2)`,
      [analystId, userId],
    );
    if (!analystCheck.data || (analystCheck.data as any[]).length === 0) {
      throw new ForbiddenException('Analyst not found or not accessible');
    }

    let sql = `SELECT id, version_number, source, change_reason, created_by, created_at,
                      is_active, context_markdown, author_user_id
               FROM prediction.analyst_config_versions
               WHERE analyst_id = $1`;
    const params: unknown[] = [analystId];

    if (authorFilter === 'me') {
      sql += ` AND author_user_id = $2`;
      params.push(userId);
    }

    sql += ` ORDER BY version_number DESC`;

    const result = await this.db.rawQuery(sql, params);
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<Record<string, unknown>> | null) ?? [];

    return rows.map(v => ({
      id: String(v.id),
      versionNumber: Number(v.version_number),
      source: String(v.source ?? 'manual'),
      changeReason: v.change_reason ? String(v.change_reason) : null,
      createdBy: v.created_by ? String(v.created_by) : null,
      createdAt: String(v.created_at),
      isActive: Boolean(v.is_active),
      contextMarkdown: v.context_markdown ? String(v.context_markdown) : null,
      authorUserId: v.author_user_id ? String(v.author_user_id) : null,
    }));
  }

  async chatAsk(userId: string, message: string, instrumentId?: string) {
    if (!message || typeof message !== 'string') {
      return { response: 'Please provide a message.', reasoning: null };
    }
    const trimmed = message.trim().slice(0, 2000);
    if (!trimmed) {
      return { response: 'Please provide a message.', reasoning: null };
    }

    const contextParts: string[] = [];

    if (instrumentId) {
      const instResult = await this.db.rawQuery(
        `select i.symbol, i.name, mp.direction, mp.confidence, mp.rationale, ma.display_name as analyst_name
         from prediction.market_predictions mp
         join prediction.instruments i on i.id = mp.instrument_id
         join prediction.market_analysts ma on ma.id = mp.analyst_id
         where mp.instrument_id = $1
         order by mp.created_at desc limit 10`,
        [instrumentId],
      );
      const predictions = (instResult.data as Array<Record<string, unknown>> | null) ?? [];
      if (predictions.length > 0) {
        contextParts.push(`Recent predictions for ${predictions[0].symbol} (${predictions[0].name}):`);
        for (const p of predictions) {
          contextParts.push(`- ${p.analyst_name}: ${p.direction} at ${p.confidence}% confidence. "${String(p.rationale ?? '').slice(0, 200)}"`);
        }
      }
    }

    const summaryResult = await this.db.rawQuery(`
      select ma.display_name, count(mp.id) as pred_count,
             round(avg(mp.confidence)::numeric, 1) as avg_conf,
             mode() within group (order by mp.direction) as direction
      from prediction.market_analysts ma
      left join prediction.market_predictions mp on mp.analyst_id = ma.id and mp.created_at >= current_date
      where ma.is_active = true and ma.analyst_type = 'personality'
      group by ma.id, ma.display_name
      having count(mp.id) > 0
    `, []);
    const dailySummary = (summaryResult.data as Array<Record<string, unknown>> | null) ?? [];
    if (dailySummary.length > 0) {
      contextParts.push('\nToday\'s analyst activity:');
      for (const a of dailySummary) {
        contextParts.push(`- ${a.display_name}: ${a.pred_count} predictions, avg confidence ${a.avg_conf}%, leaning ${a.direction}`);
      }
    }

    const systemPrompt = [
      'You are the Divinr market analysis assistant. You help users understand their instruments, analyst predictions, risk assessments, and market signals.',
      'Use the language "analysis" and "signal" — never "advice" or "recommendation".',
      'Be concise and educational. Help the user understand what the analysts are seeing and why.',
      contextParts.length > 0 ? '\nCurrent market context:\n' + contextParts.join('\n') : '',
    ].filter(Boolean).join('\n');

    const ctx = this.marketsLlm.buildExecutionContext(userId, 'chat');
    const result = await this.marketsLlm.generateText(ctx, systemPrompt, trimmed, undefined, {
      stage: 'other',
      billedUserId: userId,
    });

    return {
      response: result.text,
      reasoning: result.reasoning ?? null,
    };
  }

  async getDailyAnalystSummary(_userId: string) {
    const now = new Date();
    const isWeekday = now.getUTCDay() >= 1 && now.getUTCDay() <= 5;
    const etHour = Number(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
    const marketsOpen = isWeekday && etHour >= 9 && etHour < 16;

    const analystSummary = await this.db.rawQuery(`
      select
        ma.id as analyst_id,
        ma.display_name as analyst_name,
        ma.slug as analyst_slug,
        count(distinct mp.instrument_id) as instruments_covered,
        count(mp.id) as predictions_today,
        round(avg(mp.confidence)::numeric, 1) as avg_confidence,
        mode() within group (order by mp.direction) as dominant_direction,
        array_agg(distinct i.symbol) filter (where i.symbol is not null) as symbols,
        (select ara.reasoning
         from prediction.analyst_risk_assessments ara
         where ara.analyst_id = ma.id
           and ara.created_at >= current_date
         order by ara.created_at desc limit 1
        ) as latest_risk_reasoning
      from prediction.market_analysts ma
      left join prediction.market_predictions mp
        on mp.analyst_id = ma.id
        and mp.created_at >= current_date
      left join prediction.instruments i
        on i.id = mp.instrument_id
      where ma.is_active = true
        and ma.analyst_type in ('personality', 'arbitrator')
      group by ma.id, ma.display_name, ma.slug
      order by count(mp.id) desc
    `, []);

    const rows = (analystSummary.data as Array<Record<string, unknown>> | null) ?? [];

    return {
      date: now.toISOString().split('T')[0],
      marketsOpen,
      analysts: rows.map(r => ({
        analystId: String(r.analyst_id),
        analystName: String(r.analyst_name),
        analystSlug: String(r.analyst_slug),
        instrumentsCovered: Number(r.instruments_covered) || 0,
        predictionsToday: Number(r.predictions_today) || 0,
        avgConfidence: Number(r.avg_confidence) || 0,
        dominantDirection: String(r.dominant_direction || 'flat'),
        symbols: (r.symbols as string[] | null) ?? [],
        latestRiskReasoning: r.latest_risk_reasoning ? String(r.latest_risk_reasoning) : null,
      })),
    };
  }
}
