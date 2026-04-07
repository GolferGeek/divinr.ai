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

export interface RiskRunResult {
  compositeScore: RiskCompositeScore;
  dimensionAssessments: RiskDimensionAssessment[];
  legacyAssessment: RiskAssessment;
  debateId: string | null;
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
      run.organization_slug,
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
    const dimensions = await this.loadDimensions(run.organization_slug);
    if (dimensions.length === 0) {
      throw new Error('No active risk dimensions configured for this organization');
    }
    this.scoreAggregation.validateDimensionWeights(dimensions);

    // 3. Load context providers
    const providers = await this.contextProviders.loadContextProviders(
      run.organization_slug,
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
      run.organization_slug,
      run.instrument_id,
    );

    // 4b. Load personality analysts with risk workflow scope
    const analystPerspectives = await this.loadRiskAnalystPerspectives(
      run.organization_slug,
    );

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
        organizationSlug: run.organization_slug,
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
      organizationSlug: run.organization_slug,
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
          organizationSlug: run.organization_slug,
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
    organizationSlug: string;
    instrumentId: string;
    instrumentSymbol: string;
    compositeScoreId: string;
    overallScore: number;
    dimensionAssessments: unknown[];
  }): Promise<Record<string, unknown>> {
    const debateResult = await this.debateService.runDebate({
      context: input.context as never,
      runId: input.runId,
      organizationSlug: input.organizationSlug,
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
      `select id, slug, display_name, persona_prompt, default_weight
       from prediction.market_analysts
       where (organization_slug = $1 or organization_slug = '__base__')
         and analyst_type = 'personality' and is_enabled = true and is_active = true
         and workflow_scope in ('risk', 'both')
       order by default_weight desc`,
      [run.organization_slug],
    );
    const analysts = (result.data as Array<{
      id: string; slug: string; display_name: string; persona_prompt: string; default_weight: number;
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

        const systemPrompt = `You are the ${analyst.display_name}. ${analyst.persona_prompt}
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

        if (this.llmService.isLlmEnabled()) {
          const llmResult = await this.llmService.generateText(context, systemPrompt, userPrompt);
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
            (id, run_id, organization_slug, instrument_id, analyst_id, score, confidence, reasoning, evidence, source_data, model_provider, model_name, created_at)
           values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, '{}', null, null, now())`,
          [run.id, run.organization_slug, run.instrument_id, analyst.id, score, confidence, reasoning, JSON.stringify(evidence)],
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

  private async loadDimensions(organizationSlug: string): Promise<RiskDimension[]> {
    // First try org-specific dimensions, then fall back to base templates.
    // Convention across the rest of the markets services is '__base__';
    // this loader was the lone outlier using '__template__', which matched
    // no rows in any environment seeded the standard way.
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

    const rows = (result.data as RiskDimension[] | null) ?? [];

    // Deduplicate: org-specific overrides template dimensions with same slug
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
    organizationSlug: string,
    instrumentId: string,
  ): Promise<string[]> {
    const result = await this.db.rawQuery(
      `select mp.relevance_score, mp.rationale, ma.title
       from prediction.market_predictors mp
       join prediction.market_articles ma on ma.id = mp.article_id
       where (mp.organization_slug = $1 or mp.organization_slug = '__base__')
         and mp.instrument_id = $2
         and mp.status = 'active'
       order by mp.relevance_score desc
       limit 20`,
      [organizationSlug, instrumentId],
    );
    const rows = (result.data as Array<{ relevance_score: number; rationale: string | null; title: string | null }> | null) ?? [];
    return rows.map((r, i) => {
      const title = r.title ?? '(untitled)';
      const note = r.rationale ? ` — ${r.rationale.slice(0, 200)}` : '';
      return `${i + 1}. relevance=${Number(r.relevance_score).toFixed(2)} ${title}${note}`;
    });
  }

  private async loadRiskAnalystPerspectives(
    organizationSlug: string,
  ): Promise<AnalystPerspective[]> {
    const result = await this.db.rawQuery(
      `select display_name, default_weight, persona_prompt
       from prediction.market_analysts
       where (organization_slug = $1 or organization_slug = '__base__')
         and analyst_type = 'personality'
         and is_enabled = true
         and is_active = true
         and workflow_scope in ('risk', 'both')
       order by default_weight desc, created_at asc`,
      [organizationSlug],
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
        (id, run_id, organization_slug, instrument_id, dimension_id, score, confidence, reasoning, evidence, signals, model_provider, model_name, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        assessment.id, assessment.run_id, assessment.organization_slug,
        assessment.instrument_id, assessment.dimension_id,
        assessment.score, assessment.confidence, assessment.reasoning,
        JSON.stringify(assessment.evidence), JSON.stringify(assessment.signals),
        assessment.model_provider, assessment.model_name, assessment.created_at,
      ],
    );
    if (result.error) throw new Error(result.error.message);
  }

  private async persistCompositeScore(input: {
    id: string;
    runId: string;
    organizationSlug: string;
    instrumentId: string;
    overallScore: number;
    dimensionScores: Record<string, number>;
    confidence: number;
  }): Promise<RiskCompositeScore> {
    const now = new Date().toISOString();
    const result = await this.db.rawQuery(
      `insert into prediction.risk_composite_scores
        (id, run_id, organization_slug, instrument_id, overall_score, dimension_scores, confidence, pre_debate_score, status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
       returning *`,
      [
        input.id, input.runId, input.organizationSlug, input.instrumentId,
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
      organization_slug: run.organization_slug,
      instrument_id: run.instrument_id,
      risk_score: compositeScore,
      verdict,
      rationale: rationale.slice(0, 1200),
      created_at: new Date().toISOString(),
    };

    const result = await this.db.rawQuery(
      `insert into prediction.market_risk_assessments
        (id, run_id, organization_slug, instrument_id, risk_score, verdict, rationale, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [assessment.id, assessment.run_id, assessment.organization_slug, assessment.instrument_id, assessment.risk_score, assessment.verdict, assessment.rationale, assessment.created_at],
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
      } as never);
    } catch {
      // Non-critical
    }
  }
}
