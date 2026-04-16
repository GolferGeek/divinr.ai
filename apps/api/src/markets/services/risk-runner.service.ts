import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@orchestrator-ai/transport-types';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { StocksPredictionPlane } from '@divinr/prediction-planes';
import type { PredictionPlaneState } from '@divinr/prediction-planes';
import { MarketsLlmService } from './markets-llm.service';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import { ContextProviderService } from './context-provider.service';
import { DataSourceService } from './data-source.service';
import { RiskDimensionAnalyzerService, type AnalystPerspective } from './risk-dimension-analyzer.service';
import { RiskScoreAggregationService } from './risk-score-aggregation.service';
import { RiskDebateService } from './risk-debate.service';
import type {
  MarketRun,
  MarketInstrument,
  RiskDimension,
  RiskDimensionAssessment,
  RiskCompositeScore,
  RiskAssessment,
} from '../markets.types';
import { WorkflowStage } from '../workflow-stages/workflow-stage';
import { loadContractFragment } from '../utils/contract-loader';

export interface RiskRunResult {
  compositeScore: RiskCompositeScore;
  dimensionAssessments: RiskDimensionAssessment[];
  legacyAssessment: RiskAssessment;
  debateId: string | null;
}

interface AnalystRef {
  id: string;
  slug: string;
  display_name: string;
  persona_prompt: string;
  default_weight: number;
  user_id?: string | null;
  current_config_version_id?: string | null;
}

interface InstrumentScope {
  instrument: MarketInstrument;
  analysts: AnalystRef[];
  baseAnalystIds: Set<string>;
  viewerCustoms: Map<string, string[]>;
  ownerUserId: string | null;
}

/**
 * Orchestrates the full risk analysis pipeline for a single run:
 *
 * 1. Resolve instrument → prediction plane
 * 2. Load active dimensions (domain-scoped)
 * 3. Load context providers + active predictors
 * 4. For each dimension → LLM analysis
 * 5. Aggregate into composite score
 * 6. Trigger debate
 * 7. Apply debate adjustment
 * 8. Persist legacy risk assessment row for backward compat
 */
@Injectable()
export class RiskRunnerService {
  private readonly logger = new Logger(RiskRunnerService.name);
  private readonly plane: StocksPredictionPlane;
  private readonly planeState: PredictionPlaneState;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ObservabilityEventsService) private readonly observability: ObservabilityEventsService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
    @Inject(MarketsLlmService) private readonly llmService: MarketsLlmService,
    @Inject(ContextProviderService) private readonly contextProviders: ContextProviderService,
    @Inject(RiskDimensionAnalyzerService) private readonly dimensionAnalyzer: RiskDimensionAnalyzerService,
    @Inject(RiskScoreAggregationService) private readonly scoreAggregation: RiskScoreAggregationService,
    @Inject(RiskDebateService) private readonly debateService: RiskDebateService,
    @Inject(DataSourceService) private readonly dataSources: DataSourceService,
  ) {
    this.plane = new StocksPredictionPlane();
    this.planeState = this.plane.state;
  }

  async executeRiskRun(
    run: MarketRun,
    instrument: MarketInstrument,
    userId: string,
  ): Promise<RiskRunResult> {
    await this.schema.ensureSchema();

    const context = this.llmService.buildExecutionContext(
      userId,
      'risk',
    );

    // 1. Get domain-formatted instrument context via prediction plane
    const instrumentState = {
      data: instrument.current_state,
      asOf: new Date().toISOString(),
    };
    const planeContext = this.planeState.getPromptContext(
      instrument.symbol,
      instrument.name,
      instrumentState,
    );

    // 2. Load active dimensions for this org's domain
    const dimensions = await this.loadDimensions();
    if (dimensions.length === 0) {
      throw new Error('No active risk dimensions configured for this organization');
    }
    this.scoreAggregation.validateDimensionWeights(dimensions);

    // 3. Load context providers
    const providers = await this.contextProviders.loadContextProviders(
      run.instrument_id,
    );
    const providerOutputs = await this.contextProviders.executeContextProviders(
      context,
      providers,
      instrument.symbol,
      instrument.name,
      planeContext,
    );
    const contextProviderText = this.contextProviders.formatContextForPrompt(providerOutputs);

    // 4. Load active predictors
    const predictorLines = await this.loadPredictorLines(
      run.instrument_id,
    );

    // 4b. Load personality analysts with risk workflow scope
    const analystPerspectives = await this.loadRiskAnalystPerspectives();

    // 5. Analyze each dimension
    this.logger.log(`Analyzing ${dimensions.length} risk dimensions for ${instrument.symbol}`);
    const assessments: RiskDimensionAssessment[] = [];

    for (const dimension of dimensions) {
      await this.emitProgress(context, run.id, `Analyzing ${dimension.name}`, assessments.length, dimensions.length);

      const assessment = await this.dimensionAnalyzer.analyzeDimension({
        context,
        dimension,
        instrumentSymbol: instrument.symbol,
        instrumentName: instrument.name,
        instrumentId: run.instrument_id,
        runId: run.id,
        planeContext,
        predictorLines,
        contextProviderText,
        analystPerspectives,
      });
      assessments.push(assessment);

      // Persist assessment
      await this.persistDimensionAssessment(assessment);
    }

    // 5b. Per-analyst risk assessment
    const analystRiskAssessments = await this.runAnalystRiskAssessments(
      context, run, instrument, planeContext, contextProviderText, predictorLines,
    );

    // 6. Aggregate into composite score
    // If we have analyst risk assessments, use those for aggregation; otherwise fall back to dimension assessments
    let aggregation;
    if (analystRiskAssessments.length > 0) {
      // Weighted average of analyst risk scores, using analyst default_weight
      const totalWeight = analystRiskAssessments.reduce((sum, a) => sum + a.weight, 0);
      const weightedSum = analystRiskAssessments.reduce((sum, a) => sum + a.score * a.weight, 0);
      const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
      const confidences = analystRiskAssessments.map(a => a.confidence);
      const confidence = confidences.length > 0
        ? Math.pow(confidences.reduce((prod, c) => prod * Math.max(c, 0.01), 1), 1 / confidences.length)
        : 0.5;
      const dimensionScores: Record<string, number> = {};
      for (const a of analystRiskAssessments) {
        dimensionScores[a.analystSlug] = a.score;
      }
      aggregation = { overallScore, dimensionScores, confidence };
    } else {
      aggregation = this.scoreAggregation.aggregateAssessments(assessments, dimensions);
    }

    // 7. Persist pre-debate composite
    const compositeId = randomUUID();
    let compositeScore = await this.persistCompositeScore({
      id: compositeId,
      runId: run.id,
      instrumentId: run.instrument_id,
      overallScore: aggregation.overallScore,
      dimensionScores: aggregation.dimensionScores,
      confidence: aggregation.confidence,
    });

    // 8. Debate — draw Blue (most bullish/lowest risk) and Red (most bearish/highest risk) from analyst pool
    let debateId: string | null = null;
    if (this.llmService.isLlmEnabled()) {
      try {
        // Use analyst risk assessments for debate context if available
        const debateAssessments = analystRiskAssessments.length > 0
          ? analystRiskAssessments.map(a => ({
              ...assessments[0],  // base structure
              dimension_id: a.analystId,
              score: a.score,
              confidence: a.confidence,
              reasoning: a.reasoning ?? '',
              evidence: a.evidence ?? [],
            }))
          : assessments;

        const debateResult = await this.debateService.runDebate({
          context,
          runId: run.id,
          instrumentId: run.instrument_id,
          instrumentSymbol: instrument.symbol,
          compositeScoreId: compositeId,
          overallScore: aggregation.overallScore,
          dimensionAssessments: debateAssessments,
        });

        debateId = debateResult.debate.id;

        // Update composite with debate adjustment
        if (debateResult.adjustment !== 0) {
          compositeScore = await this.updateCompositeWithDebate(
            compositeId,
            debateResult.debate.id,
            debateResult.adjustment,
            debateResult.adjustedScore,
            aggregation.overallScore,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Debate failed for run ${run.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 9. Legacy backward-compat row
    const legacyAssessment = await this.persistLegacyRiskAssessment(
      run,
      compositeScore.overall_score,
      `Composite risk score: ${compositeScore.overall_score}/100 across ${dimensions.length} dimensions. ${debateId ? `Debate adjustment: ${compositeScore.debate_adjustment}` : 'No debate.'}`,
    );

    this.logger.log(
      `Risk run complete for ${instrument.symbol}: score=${compositeScore.overall_score}, dimensions=${assessments.length}, debate=${debateId ? 'yes' : 'no'}`,
    );

    return { compositeScore, dimensionAssessments: assessments, legacyAssessment, debateId };
  }

  /**
   * Re-run just the debate for an existing risk run.
   * Uses existing dimension assessments, runs a fresh Blue/Red/Arbiter debate.
   */
  async rerunDebate(input: {
    context: unknown;
    runId: string;
    instrumentId: string;
    instrumentSymbol: string;
    compositeScoreId: string;
    overallScore: number;
    dimensionAssessments: unknown[];
  }): Promise<Record<string, unknown>> {
    const debateResult = await this.debateService.runDebate({
      context: input.context as never,
      runId: input.runId,
      instrumentId: input.instrumentId,
      instrumentSymbol: input.instrumentSymbol,
      compositeScoreId: input.compositeScoreId,
      overallScore: input.overallScore,
      dimensionAssessments: input.dimensionAssessments as never[],
    });

    // Update composite score with new debate adjustment
    if (debateResult.adjustment !== 0) {
      await this.updateCompositeWithDebate(
        input.compositeScoreId,
        debateResult.debate.id,
        debateResult.adjustment,
        debateResult.adjustedScore,
        input.overallScore,
      );
    }

    this.logger.log(
      `Debate re-run for ${input.instrumentSymbol}: adjustment=${debateResult.adjustment}, new score=${debateResult.adjustedScore}`,
    );

    return {
      debate: debateResult.debate,
      adjustment: debateResult.adjustment,
      adjustedScore: debateResult.adjustedScore,
      originalScore: input.overallScore,
    };
  }

  /**
   * Stage 3 per-analyst risk reflection pass + Stage 3b Blue/Red/Arbiter
   * debate fanout.
   *
   * For each instrument whose predictors moved this cycle:
   *  1. Determine the analyst set that will participate in any debate scope:
   *     - Custom instrument (instrument.user_id IS NOT NULL) → analysts in
   *       `market_instrument_analyst_assignments` for that instrument.
   *     - Base instrument → all enabled base (user_id IS NULL) personality
   *       analysts in risk scope, plus any custom analyst any viewer has
   *       associated with this instrument via
   *       `viewer_instrument_analyst_assignments`.
   *  2. Run one reflection per (instrument × analyst) in the union — writes
   *     `analyst_risk_assessments` + `market_run_artifacts` with
   *     workflow_stage=risk_assessment.
   *  3. Fan out Stage 3b debates (writes `risk_debates` with viewer_user_id):
   *     - Custom instrument → one debate, viewer_user_id = instrument.user_id,
   *       participants = all assigned analysts.
   *     - Base instrument → one shared debate (viewer_user_id=null,
   *       participants = base analysts only), plus one additional debate per
   *       distinct viewer with custom-analyst assignments for this instrument
   *       (viewer_user_id = viewer, participants = base + that viewer's
   *       custom analysts).
   *
   * Reflection workload is capped by MARKETS_RISK_BATCH_LIMIT (default 50)
   * to respect the Ollama-serial constraint on Spark. Debates run once per
   * scope regardless of the cap.
   */
  async executePerAnalystRiskPass(
    instrumentIds: string[],
  ): Promise<{ assessmentsWritten: number; debatesRun: number; errors: string[] }> {
    await this.schema.ensureSchema();

    const errors: string[] = [];
    let assessmentsWritten = 0;
    let debatesRun = 0;

    if (instrumentIds.length === 0) {
      return { assessmentsWritten, debatesRun, errors };
    }

    // Load per-instrument analyst sets + viewer-scope metadata in one pass.
    const instrumentScopes = await this.resolveInstrumentScopes(instrumentIds);
    if (instrumentScopes.length === 0) {
      return { assessmentsWritten, debatesRun, errors };
    }

    const batchLimit = parseInt(process.env.MARKETS_RISK_BATCH_LIMIT ?? '50', 10);
    const workload: Array<{ instrumentId: string; analyst: AnalystRef }> = [];
    for (const scope of instrumentScopes) {
      for (const analyst of scope.analysts) {
        workload.push({ instrumentId: scope.instrument.id, analyst });
      }
    }
    const truncated = workload.length > batchLimit;
    const batch = truncated ? workload.slice(0, batchLimit) : workload;
    if (truncated) {
      this.logger.warn(`Risk pass workload truncated from ${workload.length} to ${batchLimit} (MARKETS_RISK_BATCH_LIMIT)`);
    }

    const runIdByInstrument = new Map<string, string>();
    const assessmentsByInstrumentAnalyst = new Map<string, { analystId: string; analystSlug: string; score: number; confidence: number; reasoning: string }>();

    for (const item of batch) {
      try {
        let runId = runIdByInstrument.get(item.instrumentId);
        if (!runId) {
          runId = await this.createRiskOrchestrationRun(item.instrumentId);
          runIdByInstrument.set(item.instrumentId, runId);
        }

        const scope = instrumentScopes.find(s => s.instrument.id === item.instrumentId)!;
        const parsed = await this.runPerAnalystReflection(
          runId,
          {
            instrumentId: item.instrumentId,
            analystId: item.analyst.id,
            analystSlug: item.analyst.slug,
            analystDisplayName: item.analyst.display_name,
            analystPersona: item.analyst.persona_prompt,
            configVersionId: item.analyst.current_config_version_id ?? null,
          },
          scope.instrument,
        );
        assessmentsWritten++;
        assessmentsByInstrumentAnalyst.set(`${item.instrumentId}:${item.analyst.id}`, {
          analystId: item.analyst.id,
          analystSlug: item.analyst.slug,
          score: parsed.score,
          confidence: parsed.confidence,
          reasoning: parsed.reasoning,
        });
      } catch (err) {
        const msg = `Per-analyst reflection failed for instrument=${item.instrumentId} analyst=${item.analyst.slug}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        this.logger.warn(msg);
      }
    }

    // Stage 3b: fan out debates per scope.
    for (const scope of instrumentScopes) {
      const runId = runIdByInstrument.get(scope.instrument.id);
      if (!runId) continue;

      const debates = this.planDebates(scope);
      for (const debate of debates) {
        try {
          const participants: Array<{ analystId: string; analystSlug: string; score: number; confidence: number; reasoning: string }> = [];
          for (const analystId of debate.analystIds) {
            const row = assessmentsByInstrumentAnalyst.get(`${scope.instrument.id}:${analystId}`);
            if (row) participants.push(row);
          }
          if (participants.length === 0) continue;

          await this.runStage3bDebate(runId, scope.instrument, participants, debate.viewerUserId);
          debatesRun++;
        } catch (err) {
          const viewerTag = debate.viewerUserId ? ` viewer=${debate.viewerUserId}` : ' (shared)';
          const msg = `Stage 3b debate failed for instrument=${scope.instrument.id}${viewerTag}: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(msg);
          this.logger.warn(msg);
        }
      }
    }

    this.logger.log(`Per-analyst risk pass: ${assessmentsWritten} assessments, ${debatesRun} debates, ${errors.length} errors`);
    return { assessmentsWritten, debatesRun, errors };
  }

  /**
   * For each input instrument, resolve:
   *   - the instrument row (including user_id for custom-ownership)
   *   - the analyst set that may participate in any debate scope
   *   - the per-viewer custom-analyst map for base instruments
   */
  private async resolveInstrumentScopes(instrumentIds: string[]): Promise<InstrumentScope[]> {
    const scopes: InstrumentScope[] = [];
    for (const instrumentId of instrumentIds) {
      const instrument = await this.loadInstrument(instrumentId);
      if (!instrument) continue;

      const instrumentUserId = (instrument as MarketInstrument & { user_id?: string | null }).user_id ?? null;

      if (instrumentUserId !== null) {
        // Case 3: custom instrument — participants are explicitly assigned.
        const assigned = await this.loadAssignedAnalystsForInstrument(instrumentId);
        scopes.push({
          instrument,
          analysts: assigned,
          baseAnalystIds: new Set(assigned.filter(a => !a.user_id).map(a => a.id)),
          viewerCustoms: new Map(),
          ownerUserId: instrumentUserId,
        });
        continue;
      }

      // Case 1 + 2: base instrument. Base analysts = all enabled base (user_id IS NULL)
      // personality analysts in risk scope. Viewer customs come from the bridge table.
      const baseAnalysts = await this.loadBasePersonalityAnalysts();
      const viewerCustoms = await this.loadViewerCustomsForInstrument(instrumentId);

      // Union: base + every custom referenced by any viewer for this instrument.
      const customAnalystIds = new Set<string>();
      for (const analystIds of viewerCustoms.values()) {
        for (const id of analystIds) customAnalystIds.add(id);
      }
      const customAnalysts = customAnalystIds.size > 0
        ? await this.loadAnalystsByIds(Array.from(customAnalystIds))
        : [];

      const analystUnion = [...baseAnalysts, ...customAnalysts];
      const baseAnalystIds = new Set(baseAnalysts.map(a => a.id));

      scopes.push({
        instrument,
        analysts: analystUnion,
        baseAnalystIds,
        viewerCustoms,
        ownerUserId: null,
      });
    }
    return scopes;
  }

  /**
   * Given a resolved scope, return the list of debates to run:
   *   - Custom instrument → one debate, participants = all scope analysts,
   *     viewerUserId = instrument.user_id
   *   - Base instrument → shared debate (base analysts, viewerUserId=null)
   *     plus one additional debate per viewer with viewer-customs (base +
   *     that viewer's customs, viewerUserId = viewer)
   */
  private planDebates(scope: InstrumentScope): Array<{ analystIds: string[]; viewerUserId: string | null }> {
    const debates: Array<{ analystIds: string[]; viewerUserId: string | null }> = [];

    if (scope.ownerUserId !== null) {
      debates.push({
        analystIds: scope.analysts.map(a => a.id),
        viewerUserId: scope.ownerUserId,
      });
      return debates;
    }

    // Base instrument.
    const baseAnalystIds = Array.from(scope.baseAnalystIds);
    if (baseAnalystIds.length > 0) {
      debates.push({ analystIds: baseAnalystIds, viewerUserId: null });
    }

    for (const [viewerId, customAnalystIds] of scope.viewerCustoms) {
      const participants = [...baseAnalystIds, ...customAnalystIds];
      debates.push({ analystIds: participants, viewerUserId: viewerId });
    }

    return debates;
  }

  private async loadBasePersonalityAnalysts(): Promise<AnalystRef[]> {
    const result = await this.db.rawQuery(
      `select id, slug, display_name, persona_prompt, default_weight, user_id, current_config_version_id
       from prediction.market_analysts
       where analyst_type = 'personality' and is_enabled = true and is_active = true
         and workflow_scope in ('risk', 'both')
         and user_id is null
       order by default_weight desc`,
    );
    return (result.data as AnalystRef[] | null) ?? [];
  }

  private async loadAssignedAnalystsForInstrument(instrumentId: string): Promise<AnalystRef[]> {
    const result = await this.db.rawQuery(
      `select ma.id, ma.slug, ma.display_name, ma.persona_prompt, ma.default_weight, ma.user_id, ma.current_config_version_id
       from prediction.market_instrument_analyst_assignments mia
       join prediction.market_analysts ma on ma.id = mia.analyst_id
       where mia.instrument_id = $1
         and ma.is_enabled = true and ma.is_active = true
         and ma.workflow_scope in ('risk', 'both')
       order by ma.default_weight desc`,
      [instrumentId],
    );
    return (result.data as AnalystRef[] | null) ?? [];
  }

  private async loadAnalystsByIds(ids: string[]): Promise<AnalystRef[]> {
    if (ids.length === 0) return [];
    const result = await this.db.rawQuery(
      `select id, slug, display_name, persona_prompt, default_weight, user_id, current_config_version_id
       from prediction.market_analysts
       where id = any($1::text[])
         and is_enabled = true and is_active = true
         and workflow_scope in ('risk', 'both')`,
      [ids],
    );
    return (result.data as AnalystRef[] | null) ?? [];
  }

  private async loadViewerCustomsForInstrument(instrumentId: string): Promise<Map<string, string[]>> {
    const result = await this.db.rawQuery(
      `select viewer_user_id, analyst_id
       from prediction.viewer_instrument_analyst_assignments
       where instrument_id = $1`,
      [instrumentId],
    );
    const rows = (result.data as Array<{ viewer_user_id: string; analyst_id: string }> | null) ?? [];
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const existing = map.get(row.viewer_user_id) ?? [];
      existing.push(row.analyst_id);
      map.set(row.viewer_user_id, existing);
    }
    return map;
  }

  private async createRiskOrchestrationRun(instrumentId: string): Promise<string> {
    const runId = randomUUID();
    await this.db.rawQuery(
      `insert into prediction.orchestration_runs
        (id, instrument_id, run_type, status, requested_by, created_at, started_at)
       values ($1, $2, 'risk', 'running', 'stages-v2-pipeline', now(), now())
       on conflict do nothing`,
      [runId, instrumentId],
    );
    return runId;
  }

  private async loadInstrument(instrumentId: string): Promise<MarketInstrument | null> {
    const result = await this.db.rawQuery(
      `select * from prediction.instruments where id = $1 limit 1`,
      [instrumentId],
    );
    const rows = (result.data as MarketInstrument[] | null) ?? [];
    return rows[0] ?? null;
  }

  private async runPerAnalystReflection(
    runId: string,
    item: { instrumentId: string; analystId: string; analystSlug: string; analystDisplayName: string; analystPersona: string; configVersionId: string | null },
    instrument: MarketInstrument,
  ): Promise<{ score: number; confidence: number; reasoning: string }> {
    const priorResult = await this.db.rawQuery(
      `select score, confidence, reasoning from prediction.analyst_risk_assessments
       where instrument_id = $1 and analyst_id = $2
       order by created_at desc limit 1`,
      [item.instrumentId, item.analystId],
    );
    const priorRows = (priorResult.data as Array<{ score: number; confidence: number; reasoning: string | null }> | null) ?? [];
    const prior = priorRows[0];

    const predictorLines = await this.loadPerAnalystPredictorLines(item.instrumentId, item.analystId);

    const { stageFragment, fallback } = await loadContractFragment(
      { db: this.db, logger: this.logger, observability: this.observability },
      { id: item.analystId, slug: item.analystSlug },
      item.configVersionId,
      WorkflowStage.RiskAssessment,
      'reflection',
    );

    const personaBlock = fallback
      ? `You are ${item.analystDisplayName}. ${item.analystPersona}`
      : `You are ${item.analystDisplayName}.\n\n${stageFragment}`;

    const systemPrompt = `${personaBlock}
Produce your holistic risk assessment for ${instrument.symbol} (${instrument.name}) as a first-person analysis of how the latest signals shift your prior risk view. Use the language "analysis" and "signal" — never "advice" or "recommendation".
Respond with valid JSON only:
{
  "score": <integer 0-100, where 0 = no risk from your perspective, 100 = extreme risk>,
  "confidence": <number 0.0-1.0>,
  "reasoning": "<your reasoning>",
  "evidence": ["<evidence 1>", "<evidence 2>"]
}`;

    const priorText = prior
      ? `Your previous risk view: score=${prior.score}, confidence=${Number(prior.confidence).toFixed(2)}. Reasoning: ${prior.reasoning ?? '(none)'}`
      : 'You have no prior risk view for this instrument.';

    const userPrompt = [
      `Reflect on the risk for ${instrument.symbol} (${instrument.name}).`,
      priorText,
      predictorLines.length > 0 ? `New predictor signals:\n${predictorLines.slice(0, 10).join('\n')}` : 'No new predictor signals this cycle.',
    ].join('\n\n');

    let score = prior?.score ?? 50;
    let confidence = prior?.confidence ?? 0.5;
    let reasoning = prior?.reasoning ?? '';
    let evidence: string[] = [];
    let llmUsageId: string | null = null;
    let modelProvider = 'deterministic_local';
    let modelName = 'rules-v1';
    let outputText = '';

    if (this.llmService.isLlmEnabled()) {
      const context = this.llmService.buildExecutionContext('stages-v2-pipeline', 'risk');
      const llmResult = await this.llmService.generateText(context, systemPrompt, userPrompt);
      outputText = llmResult.text;
      modelProvider = llmResult.provider;
      modelName = llmResult.model;
      llmUsageId = llmResult.llmUsageId ?? null;
      const match = llmResult.text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]) as Record<string, unknown>;
          score = Math.min(100, Math.max(0, Math.round(Number(parsed['score']) || score)));
          confidence = Math.min(1, Math.max(0, Number(parsed['confidence']) || confidence));
          reasoning = String(parsed['reasoning'] ?? reasoning);
          evidence = Array.isArray(parsed['evidence']) ? (parsed['evidence'] as string[]).map(String) : [];
        } catch {
          // Parse failure — keep prior values as fallback.
          reasoning = `(parse failure; keeping prior) ${reasoning}`;
        }
      }
    } else {
      outputText = JSON.stringify({ score, confidence, reasoning: 'LLM disabled — carried forward from prior', evidence: [] });
    }

    await this.db.rawQuery(
      `insert into prediction.analyst_risk_assessments
        (id, run_id, instrument_id, analyst_id, score, confidence, reasoning, evidence, source_data, model_provider, model_name, llm_usage_id, created_at)
       values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, '{}', $8, $9, $10, now())`,
      [runId, item.instrumentId, item.analystId, score, confidence, reasoning, JSON.stringify(evidence), modelProvider, modelName, llmUsageId],
    );

    await this.db.rawQuery(
      `insert into prediction.market_run_artifacts
        (id, run_id, run_type, analyst_id, role, model_provider, model_name, prompt, output_text, workflow_stage, created_at)
       values ($1, $2, 'risk', $3, 'analyst', $4, $5, $6, $7, $8, now())`,
      [randomUUID(), runId, item.analystId, modelProvider, modelName, userPrompt, outputText, WorkflowStage.RiskAssessment],
    );

    return { score, confidence, reasoning };
  }

  private async loadPerAnalystPredictorLines(instrumentId: string, analystId: string): Promise<string[]> {
    const result = await this.db.rawQuery(
      `select mp.relevance_score, mp.rationale, ma.title
       from prediction.market_predictors mp
       join prediction.market_articles ma on ma.id = mp.article_id
       where mp.instrument_id = $1 and mp.status = 'active' and mp.scored_by_analyst_id = $2
       order by mp.updated_at desc limit 20`,
      [instrumentId, analystId],
    );
    const rows = (result.data as Array<{ relevance_score: number; rationale: string | null; title: string | null }> | null) ?? [];
    return rows.map((r, i) => {
      const title = r.title ?? '(untitled)';
      const note = r.rationale ? ` — ${r.rationale.slice(0, 200)}` : '';
      return `${i + 1}. relevance=${Number(r.relevance_score).toFixed(2)} ${title}${note}`;
    });
  }

  private async runStage3bDebate(
    runId: string,
    instrument: MarketInstrument,
    assessments: Array<{ analystSlug: string; score: number; confidence: number; reasoning: string }>,
    viewerUserId: string | null = null,
  ): Promise<void> {
    if (!this.llmService.isLlmEnabled()) {
      this.logger.log(`Stage 3b debate skipped for ${instrument.symbol}${viewerUserId ? ` viewer=${viewerUserId}` : ''} — LLM disabled`);
      return;
    }

    const totalWeight = assessments.length;
    const overallScore = totalWeight > 0
      ? Math.round(assessments.reduce((sum, a) => sum + a.score, 0) / totalWeight)
      : 50;
    const avgConfidence = totalWeight > 0
      ? assessments.reduce((sum, a) => sum + a.confidence, 0) / totalWeight
      : 0.5;

    // Persist pre-debate composite for this Stage 3 run.
    const compositeId = randomUUID();
    const dimensionScores: Record<string, number> = {};
    for (const a of assessments) dimensionScores[a.analystSlug] = a.score;
    await this.persistCompositeScore({
      id: compositeId,
      runId,
      instrumentId: instrument.id,
      overallScore,
      dimensionScores,
      confidence: avgConfidence,
    });

    // Adapt analyst reflections into RiskDimensionAssessment shape for the debate.
    const debateAssessments: RiskDimensionAssessment[] = assessments.map(a => ({
      id: randomUUID(),
      run_id: runId,
      instrument_id: instrument.id,
      dimension_id: a.analystSlug,
      score: a.score,
      confidence: a.confidence,
      reasoning: a.reasoning || '',
      evidence: [],
      signals: [],
      model_provider: 'stage3a',
      model_name: 'per-analyst-reflection',
      llm_usage_id: null,
      created_at: new Date().toISOString(),
    } as RiskDimensionAssessment));

    const context = this.llmService.buildExecutionContext('stages-v2-pipeline', 'risk');
    const debateResult = await this.debateService.runDebate({
      context,
      runId,
      instrumentId: instrument.id,
      instrumentSymbol: instrument.symbol,
      compositeScoreId: compositeId,
      overallScore,
      dimensionAssessments: debateAssessments,
      viewerUserId,
    });

    // Persist a Stage 3b artifact for traceability.
    await this.db.rawQuery(
      `insert into prediction.market_run_artifacts
        (id, run_id, run_type, analyst_id, role, model_provider, model_name, prompt, output_text, workflow_stage, created_at)
       values ($1, $2, 'risk', null, 'arbitrator', 'debate', 'blue-red-arbiter', $3, $4, $5, now())`,
      [
        randomUUID(), runId,
        `Stage 3b debate for ${instrument.symbol}${viewerUserId ? ` (viewer=${viewerUserId})` : ' (shared)'}`,
        JSON.stringify({
          debateId: debateResult.debate.id,
          adjustment: debateResult.adjustment,
          adjustedScore: debateResult.adjustedScore,
          preDebateScore: overallScore,
          viewerUserId,
        }),
        WorkflowStage.RiskAssessment,
      ],
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────

  // ─── Per-Analyst Risk Assessment ─────────────────────────────

  private async runAnalystRiskAssessments(
    context: ExecutionContext,
    run: MarketRun,
    instrument: MarketInstrument,
    planeContext: string,
    contextProviderText: string,
    predictorLines: string[],
  ): Promise<Array<{ analystId: string; analystSlug: string; score: number; confidence: number; weight: number; reasoning: string | null; evidence: string[]; }>> {
    // Load personality analysts
    const result = await this.db.rawQuery(
      `select id, slug, display_name, persona_prompt, default_weight, current_config_version_id
       from prediction.market_analysts
       where analyst_type = 'personality' and is_enabled = true and is_active = true
         and workflow_scope in ('risk', 'both')
       order by default_weight desc`,
    );
    const analysts = (result.data as Array<{
      id: string; slug: string; display_name: string; persona_prompt: string; default_weight: number;
      current_config_version_id: string | null;
    }> | null) ?? [];

    if (analysts.length === 0) return [];

    const assessments: Array<{ analystId: string; analystSlug: string; score: number; confidence: number; weight: number; reasoning: string | null; evidence: string[]; }> = [];

    for (const analyst of analysts) {
      try {
        // Fetch specialized data for this analyst
        let dataSourceText = '';
        try {
          const dsResult = await this.dataSources.fetchForAnalyst(analyst.id, instrument.symbol);
          dataSourceText = dsResult.context;
        } catch { /* graceful degradation */ }

        const { stageFragment, fallback: contractFallback } = await loadContractFragment(
          { db: this.db, logger: this.logger, observability: this.observability },
          { id: analyst.id, slug: analyst.slug },
          analyst.current_config_version_id ?? null,
          WorkflowStage.RiskAssessment,
          'reflection',
        );
        const legacyPersonaBlock = `You are the ${analyst.display_name}. ${analyst.persona_prompt}`;
        const v4PersonaBlock = `You are the ${analyst.display_name}.\n\n${stageFragment}`;
        const systemPrompt = `${contractFallback ? legacyPersonaBlock : v4PersonaBlock}
You are assessing the risk for a specific financial instrument from YOUR perspective and expertise.
Respond with valid JSON only:
{
  "score": <integer 0-100, where 0=no risk from your perspective, 100=extreme risk>,
  "confidence": <number 0.0-1.0>,
  "reasoning": "<your risk assessment from your perspective>",
  "evidence": ["<evidence point 1>", "<evidence point 2>"]
}`;

        const userPrompt = [
          `Assess the risk for ${instrument.symbol} (${instrument.name}) from your perspective as ${analyst.display_name}.`,
          planeContext,
          contextProviderText,
          dataSourceText ? `\nYour specialized data:\n${dataSourceText}` : '',
          predictorLines.length > 0 ? `\nActive article signals:\n${predictorLines.slice(0, 10).join('\n')}` : '',
        ].filter(Boolean).join('\n');

        let score = 50;
        let confidence = 0.5;
        let reasoning: string | null = null;
        let evidence: string[] = [];
        let llmUsageId: string | null = null;

        if (this.llmService.isLlmEnabled()) {
          const llmResult = await this.llmService.generateText(context, systemPrompt, userPrompt);
          llmUsageId = llmResult.llmUsageId ?? null;
          const match = llmResult.text.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]) as Record<string, unknown>;
            score = Math.min(100, Math.max(0, Math.round(Number(parsed['score']) || 50)));
            confidence = Math.min(1, Math.max(0, Number(parsed['confidence']) || 0.5));
            reasoning = String(parsed['reasoning'] || '');
            evidence = Array.isArray(parsed['evidence']) ? (parsed['evidence'] as string[]).map(String) : [];
          }
        }

        // Persist to analyst_risk_assessments table
        await this.db.rawQuery(
          `insert into prediction.analyst_risk_assessments
            (id, run_id, instrument_id, analyst_id, score, confidence, reasoning, evidence, source_data, model_provider, model_name, llm_usage_id, created_at)
           values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, '{}', null, null, $8, now())`,
          [run.id, run.instrument_id, analyst.id, score, confidence, reasoning, JSON.stringify(evidence), llmUsageId],
        );

        assessments.push({
          analystId: analyst.id,
          analystSlug: analyst.slug,
          score,
          confidence,
          weight: analyst.default_weight,
          reasoning,
          evidence,
        });

        this.logger.log(`${analyst.display_name} risk for ${instrument.symbol}: score=${score}, confidence=${confidence.toFixed(2)}`);
      } catch (err) {
        this.logger.warn(`Analyst risk assessment failed for ${analyst.slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return assessments;
  }

  private async loadDimensions(): Promise<RiskDimension[]> {
    const result = await this.db.rawQuery(
      `select * from prediction.risk_dimensions
       where is_active = true
       order by display_order asc`,
    );
    if (result.error) throw new Error(result.error.message);

    const rows = (result.data as RiskDimension[] | null) ?? [];

    // Deduplicate by slug
    const seen = new Set<string>();
    const unique: RiskDimension[] = [];
    for (const row of rows) {
      if (!seen.has(row.slug)) {
        seen.add(row.slug);
        unique.push(row);
      }
    }
    return unique;
  }

  private async loadPredictorLines(
    instrumentId: string,
  ): Promise<string[]> {
    const result = await this.db.rawQuery(
      `select mp.relevance_score, mp.rationale, ma.title
       from prediction.market_predictors mp
       join prediction.market_articles ma on ma.id = mp.article_id
       where mp.instrument_id = $1
         and mp.status = 'active'
       order by mp.relevance_score desc
       limit 20`,
      [instrumentId],
    );
    const rows = (result.data as Array<{ relevance_score: number; rationale: string | null; title: string | null }> | null) ?? [];
    return rows.map((r, i) => {
      const title = r.title ?? '(untitled)';
      const note = r.rationale ? ` — ${r.rationale.slice(0, 200)}` : '';
      return `${i + 1}. relevance=${Number(r.relevance_score).toFixed(2)} ${title}${note}`;
    });
  }

  private async loadRiskAnalystPerspectives(): Promise<AnalystPerspective[]> {
    const result = await this.db.rawQuery(
      `select display_name, default_weight, persona_prompt
       from prediction.market_analysts
       where analyst_type = 'personality'
         and is_enabled = true
         and is_active = true
         and workflow_scope in ('risk', 'both')
       order by default_weight desc, created_at asc`,
    );
    const rows = (result.data as Array<{ display_name: string; default_weight: number; persona_prompt: string }> | null) ?? [];
    return rows.map((r) => ({
      name: r.display_name,
      weight: r.default_weight,
      perspective: r.persona_prompt,
    }));
  }

  private async persistDimensionAssessment(assessment: RiskDimensionAssessment): Promise<void> {
    const result = await this.db.rawQuery(
      `insert into prediction.risk_dimension_assessments
        (id, run_id, instrument_id, dimension_id, score, confidence, reasoning, evidence, signals, model_provider, model_name, llm_usage_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        assessment.id, assessment.run_id,
        assessment.instrument_id, assessment.dimension_id,
        assessment.score, assessment.confidence, assessment.reasoning,
        JSON.stringify(assessment.evidence), JSON.stringify(assessment.signals),
        assessment.model_provider, assessment.model_name, assessment.llm_usage_id, assessment.created_at,
      ],
    );
    if (result.error) throw new Error(result.error.message);
  }

  private async persistCompositeScore(input: {
    id: string;
    runId: string;
    instrumentId: string;
    overallScore: number;
    dimensionScores: Record<string, number>;
    confidence: number;
  }): Promise<RiskCompositeScore> {
    const now = new Date().toISOString();
    const result = await this.db.rawQuery(
      `insert into prediction.risk_composite_scores
        (id, run_id, instrument_id, overall_score, dimension_scores, confidence, pre_debate_score, status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
       returning *`,
      [
        input.id, input.runId, input.instrumentId,
        input.overallScore, JSON.stringify(input.dimensionScores),
        input.confidence, input.overallScore, now,
      ],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as RiskCompositeScore[] | null) ?? [])[0]!;
  }

  private async updateCompositeWithDebate(
    compositeId: string,
    debateId: string,
    adjustment: number,
    adjustedScore: number,
    preDebateScore: number,
  ): Promise<RiskCompositeScore> {
    const result = await this.db.rawQuery(
      `update prediction.risk_composite_scores
       set debate_id = $1, debate_adjustment = $2, overall_score = $3, pre_debate_score = $4
       where id = $5
       returning *`,
      [debateId, adjustment, adjustedScore, preDebateScore, compositeId],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as RiskCompositeScore[] | null) ?? [])[0]!;
  }

  private async persistLegacyRiskAssessment(
    run: MarketRun,
    compositeScore: number,
    rationale: string,
  ): Promise<RiskAssessment> {
    const verdict = this.scoreAggregation.verdictFromScore(compositeScore);
    const assessment: RiskAssessment = {
      id: randomUUID(),
      run_id: run.id,
      instrument_id: run.instrument_id,
      risk_score: compositeScore,
      verdict,
      rationale: rationale.slice(0, 1200),
      created_at: new Date().toISOString(),
    };

    const result = await this.db.rawQuery(
      `insert into prediction.market_risk_assessments
        (id, run_id, instrument_id, risk_score, verdict, rationale, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [assessment.id, assessment.run_id, assessment.instrument_id, assessment.risk_score, assessment.verdict, assessment.rationale, assessment.created_at],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as RiskAssessment[] | null) ?? [])[0] ?? assessment;
  }

  private async emitProgress(
    context: ExecutionContext,
    runId: string,
    message: string,
    current: number,
    total: number,
  ): Promise<void> {
    try {
      await this.observability.push({
        context,
        source_app: 'divinr-api',
        hook_event_type: 'markets.orchestration.risk.dimension_progress',
        status: 'running',
        message,
        progress: Math.round((current / total) * 100),
        step: `dimension_${current + 1}_of_${total}`,
        payload: { runId, current, total },
        timestamp: Date.now(),
      } as never);
    } catch {
      // Non-critical
    }
  }
}
