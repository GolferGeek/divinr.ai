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
import { TradeRecommendationService } from './trade-recommendation.service';
import type {
  MarketRun,
  MarketInstrument,
  MarketAnalyst,
  PredictionOutcome,
  RiskAssessment,
  RunArtifact,
  MultiAnalystRunResult,
} from '../markets.types';

interface ParsedAnalystOutput {
  direction: 'up' | 'down' | 'flat';
  confidence: number;
  rationale: string;
  key_factors: string[];
  risks: string[];
}

/**
 * Multi-analyst prediction pipeline:
 *
 * 1. Resolve instrument → prediction plane for domain context
 * 2. Load shared context (latest risk + active predictors)
 * 3. Get ALL enabled personality analysts for this instrument
 * 4. Load + execute context providers
 * 5. For each analyst: build prompt → LLM call → persist per-analyst outcome
 * 6. Arbitrator: synthesize all analyst outputs → final outcome
 * 7. Persist arbitrator outcome with lineage
 */
@Injectable()
export class PredictionRunnerService {
  private readonly logger = new Logger(PredictionRunnerService.name);
  private readonly planeState: PredictionPlaneState;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ObservabilityEventsService) private readonly observability: ObservabilityEventsService,
    private readonly schema: MarketsSchemaService,
    private readonly llmService: MarketsLlmService,
    private readonly contextProviders: ContextProviderService,
    private readonly dataSources: DataSourceService,
    private readonly tradeRecommendation: TradeRecommendationService,
  ) {
    this.planeState = new StocksPredictionPlane().state;
  }

  async executePredictionRun(
    run: MarketRun,
    instrument: MarketInstrument,
    userId: string,
  ): Promise<MultiAnalystRunResult> {
    await this.schema.ensureSchema();

    const context = this.llmService.buildExecutionContext(
      run.organization_slug,
      userId,
      'prediction',
    );

    // 1. Plane context
    const instrumentState = { data: instrument.current_state, asOf: new Date().toISOString() };
    const planeContext = this.planeState.getPromptContext(instrument.symbol, instrument.name, instrumentState);

    // 2. Shared context: latest risk + active predictors
    const latestRisk = await this.getLatestRiskComposite(run.organization_slug, run.instrument_id);
    const predictorLines = await this.loadPredictorLines(run.organization_slug, run.instrument_id);
    const sharedContext = this.buildSharedContext(planeContext, latestRisk, predictorLines);

    // 3. Get all enabled personality analysts
    const analysts = await this.getAnalystsForRun(run.organization_slug, run.instrument_id);
    if (analysts.length === 0) {
      throw new Error('No enabled personality analysts available for this prediction run');
    }

    // 4. Load and execute context providers
    const providers = await this.contextProviders.loadContextProviders(run.organization_slug, run.instrument_id);
    const providerOutputs = await this.contextProviders.executeContextProviders(
      context, providers, instrument.symbol, instrument.name, planeContext,
    );
    const contextProviderText = this.contextProviders.formatContextForPrompt(providerOutputs);

    // 5. Per-analyst execution
    this.logger.log(`Running ${analysts.length} analysts for ${instrument.symbol} prediction`);
    const analystOutcomes: PredictionOutcome[] = [];
    const artifactIds: string[] = [];
    const partialFailures: Array<{ analystId: string; error: string }> = [];

    for (let i = 0; i < analysts.length; i++) {
      const analyst = analysts[i];
      await this.emitProgress(context, run.id, `Analyst: ${analyst.display_name}`, i, analysts.length);

      try {
        const { outcome, artifactId } = await this.runSingleAnalyst(
          context, run, instrument, analyst, sharedContext, contextProviderText, false,
        );
        analystOutcomes.push(outcome);
        artifactIds.push(artifactId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Analyst ${analyst.slug} failed: ${msg}`);
        partialFailures.push({ analystId: analyst.id, error: msg });
      }

      // Paper mode: if analyst has a paper config, run a second pass with it
      if (analyst.paper_config_version_id) {
        try {
          const paperConfig = await this.loadConfigVersion(analyst.paper_config_version_id);
          if (paperConfig) {
            const paperAnalyst = {
              ...analyst,
              persona_prompt: paperConfig.persona_prompt,
              default_weight: paperConfig.default_weight,
              tier_instructions: paperConfig.tier_instructions as Record<string, string>,
              current_config_version_id: analyst.paper_config_version_id,
            };
            await this.runSingleAnalyst(
              context, run, instrument, paperAnalyst, sharedContext, contextProviderText, true,
            );
          }
        } catch (err) {
          this.logger.warn(`Paper mode for ${analyst.slug} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (analystOutcomes.length === 0) {
      throw new Error(`All ${analysts.length} analysts failed. Partial failures: ${partialFailures.map(f => f.error).join('; ')}`);
    }

    // 6. Arbitrator step
    let arbitratorOutcome: PredictionOutcome | null = null;
    try {
      const arbResult = await this.runArbitrator(context, run, instrument, analystOutcomes, sharedContext);
      arbitratorOutcome = arbResult.outcome;
      artifactIds.push(arbResult.artifactId);
    } catch (err) {
      this.logger.warn(`Arbitrator failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 7. Phase 6: Portfolio Manager — eagerly generate the portfolio-agnostic
    // trade recommendation now that the arbitrator has produced its output.
    // Persistence is idempotent and portfolio-agnostic; per-user quantity is
    // computed at read time. Failure here is non-fatal — the dashboard will
    // lazily generate on first read if this fails.
    if (arbitratorOutcome) {
      try {
        await this.tradeRecommendation.generateForRun({
          runId: run.id,
          organizationSlug: run.organization_slug,
        });
      } catch (err) {
        this.logger.warn(`Trade recommendation generation failed for run ${run.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await this.emitProgress(context, run.id, 'Prediction pipeline complete', analysts.length, analysts.length);

    return {
      processed: true,
      runId: run.id,
      status: 'completed',
      runType: 'prediction',
      analystOutcomes,
      arbitratorOutcome,
      artifactIds,
      partialFailures,
    };
  }

  // ─── Per-Analyst Execution ───────────────────────────────────

  private async runSingleAnalyst(
    context: ExecutionContext,
    run: MarketRun,
    instrument: MarketInstrument,
    analyst: MarketAnalyst,
    sharedContext: string,
    contextProviderText: string,
    isPaper: boolean,
  ): Promise<{ outcome: PredictionOutcome; artifactId: string }> {
    // Fetch specialized data for this analyst
    let dataSourceText = '';
    let sourceContext: Record<string, unknown> = {};
    try {
      const dsResult = await this.dataSources.fetchForAnalyst(analyst.id, instrument.symbol);
      dataSourceText = dsResult.context;
      sourceContext = dsResult.sourceContext;
    } catch (err) {
      this.logger.warn(`Data source fetch failed for ${analyst.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Load per-analyst predictor lines (articles this analyst scored as relevant)
    const analystPredictorLines = await this.loadPredictorLines(run.organization_slug, run.instrument_id, analyst.id);
    const analystPredictorContext = analystPredictorLines.length > 0
      ? `\nArticles you scored as relevant:\n${analystPredictorLines.join('\n')}`
      : '';

    // Load this analyst's own risk assessment for this instrument (if available)
    let analystRiskContext = '';
    try {
      const riskResult = await this.db.rawQuery(
        `select score, confidence, reasoning from prediction.analyst_risk_assessments
         where analyst_id = $1 and instrument_id = $2
         order by created_at desc limit 1`,
        [analyst.id, run.instrument_id],
      );
      const riskRows = (riskResult.data as Array<{ score: number; confidence: number; reasoning: string | null }> | null) ?? [];
      if (riskRows.length > 0) {
        const r = riskRows[0];
        analystRiskContext = `\nYour latest risk assessment for this instrument: score=${r.score}/100, confidence=${(r.confidence * 100).toFixed(0)}%${r.reasoning ? `. ${r.reasoning.slice(0, 300)}` : ''}`;
      }
    } catch { /* no risk data available */ }

    const systemPrompt = this.buildAnalystSystemPrompt(analyst);
    const userPrompt = this.buildAnalystUserPrompt(
      instrument, analyst, sharedContext, contextProviderText, dataSourceText + analystPredictorContext + analystRiskContext,
    );

    let outputText: string;
    let modelProvider = 'deterministic_local';
    let modelName = 'rules-v1';

    if (this.llmService.isLlmEnabled()) {
      const result = await this.llmService.generateText(context, systemPrompt, userPrompt);
      outputText = result.text;
      modelProvider = result.provider;
      modelName = result.model;
    } else {
      outputText = JSON.stringify({
        direction: 'up',
        confidence: 65,
        rationale: `Deterministic prediction for ${instrument.symbol} by ${analyst.display_name}.`,
        key_factors: ['Deterministic mode — no LLM analysis'],
        risks: ['LLM disabled — results are placeholder'],
      });
    }

    // Persist artifact
    const artifactId = randomUUID();
    await this.db.rawQuery(
      `insert into prediction.market_run_artifacts
        (id, run_id, organization_slug, run_type, analyst_id, role, model_provider, model_name, prompt, output_text, created_at)
       values ($1, $2, $3, 'prediction', $4, 'analyst', $5, $6, $7, $8, $9)`,
      [artifactId, run.id, run.organization_slug, analyst.id, modelProvider, modelName, userPrompt, outputText, new Date().toISOString()],
    );

    // Parse output
    const parsed = this.parseStructuredOutput(outputText);

    // Get current config version
    const configVersionId = analyst.current_config_version_id ?? null;

    // Persist per-analyst prediction
    const predictionId = randomUUID();
    await this.db.rawQuery(
      `insert into prediction.market_predictions
        (id, run_id, organization_slug, instrument_id, analyst_id, role,
         predicted_direction, confidence, horizon_minutes, rationale,
         key_factors, risks, config_version_id, is_paper, source_context, created_at)
       values ($1, $2, $3, $4, $5, 'analyst', $6, $7, 240, $8, $9, $10, $11, $12, $13, $14)`,
      [
        predictionId, run.id, run.organization_slug, run.instrument_id,
        analyst.id, parsed.direction, parsed.confidence, parsed.rationale,
        JSON.stringify(parsed.key_factors), JSON.stringify(parsed.risks),
        configVersionId, isPaper, JSON.stringify(sourceContext), new Date().toISOString(),
      ],
    );

    const outcome: PredictionOutcome = {
      id: predictionId,
      run_id: run.id,
      organization_slug: run.organization_slug,
      instrument_id: run.instrument_id,
      analyst_id: analyst.id,
      predicted_direction: parsed.direction,
      confidence: parsed.confidence,
      horizon_minutes: 240,
      rationale: parsed.rationale,
      created_at: new Date().toISOString(),
    };

    return { outcome, artifactId };
  }

  // ─── Arbitrator ──────────────────────────────────────────────

  private async runArbitrator(
    context: ExecutionContext,
    run: MarketRun,
    instrument: MarketInstrument,
    analystOutcomes: PredictionOutcome[],
    sharedContext: string,
  ): Promise<{ outcome: PredictionOutcome; artifactId: string }> {
    const systemPrompt = `You are the chief arbitrator synthesizing multiple analyst assessments for ${instrument.symbol}.
Weigh each analyst's confidence and reasoning quality. Identify areas of agreement and disagreement.

Respond with valid JSON:
{
  "direction": "up" | "down" | "flat",
  "confidence": <0-100>,
  "rationale": "<your synthesis>",
  "key_factors": ["<factor 1>", ...],
  "risks": ["<risk 1>", ...],
  "consensus_notes": "<areas of agreement and disagreement>"
}

Respond ONLY with valid JSON.`;

    // Build analyst summary for arbitrator
    const analystSummary = await this.buildArbitratorContext(run.organization_slug, analystOutcomes);
    const userPrompt = `Synthesize these analyst assessments for ${instrument.symbol} (${instrument.name}):\n\n${analystSummary}\n\nShared context:\n${sharedContext}`;

    let outputText: string;
    let modelProvider = 'deterministic_local';
    let modelName = 'rules-v1';

    if (this.llmService.isLlmEnabled()) {
      const result = await this.llmService.generateText(context, systemPrompt, userPrompt);
      outputText = result.text;
      modelProvider = result.provider;
      modelName = result.model;
    } else {
      // Deterministic: majority vote
      const ups = analystOutcomes.filter(o => o.predicted_direction === 'up').length;
      const downs = analystOutcomes.filter(o => o.predicted_direction === 'down').length;
      const direction = ups > downs ? 'up' : downs > ups ? 'down' : 'flat';
      const avgConf = Math.round(analystOutcomes.reduce((s, o) => s + o.confidence, 0) / analystOutcomes.length);
      outputText = JSON.stringify({
        direction,
        confidence: avgConf,
        rationale: `Deterministic arbitration: ${ups} up, ${downs} down, ${analystOutcomes.length - ups - downs} flat.`,
        key_factors: ['Majority vote aggregation'],
        risks: ['Deterministic mode — no LLM synthesis'],
        consensus_notes: `${ups}/${analystOutcomes.length} analysts bullish`,
      });
    }

    // Persist artifact
    const artifactId = randomUUID();
    await this.db.rawQuery(
      `insert into prediction.market_run_artifacts
        (id, run_id, organization_slug, run_type, analyst_id, role, model_provider, model_name, prompt, output_text, created_at)
       values ($1, $2, $3, 'prediction', null, 'arbitrator', $4, $5, $6, $7, $8)`,
      [artifactId, run.id, run.organization_slug, modelProvider, modelName, userPrompt, outputText, new Date().toISOString()],
    );

    // Parse output
    const parsed = this.parseStructuredOutput(outputText);

    // Build lineage
    const lineage = analystOutcomes.map(o => ({
      analyst_id: o.analyst_id,
      direction: o.predicted_direction,
      confidence: o.confidence,
      rationale_excerpt: o.rationale.slice(0, 200),
    }));

    // Persist arbitrator prediction
    const predictionId = randomUUID();
    await this.db.rawQuery(
      `insert into prediction.market_predictions
        (id, run_id, organization_slug, instrument_id, analyst_id, role,
         predicted_direction, confidence, horizon_minutes, rationale,
         key_factors, risks, lineage_json, created_at)
       values ($1, $2, $3, $4, null, 'arbitrator', $5, $6, 240, $7, $8, $9, $10, $11)`,
      [
        predictionId, run.id, run.organization_slug, run.instrument_id,
        parsed.direction, parsed.confidence, parsed.rationale,
        JSON.stringify(parsed.key_factors), JSON.stringify(parsed.risks),
        JSON.stringify(lineage), new Date().toISOString(),
      ],
    );

    const outcome: PredictionOutcome = {
      id: predictionId,
      run_id: run.id,
      organization_slug: run.organization_slug,
      instrument_id: run.instrument_id,
      analyst_id: null,
      predicted_direction: parsed.direction,
      confidence: parsed.confidence,
      horizon_minutes: 240,
      rationale: parsed.rationale,
      created_at: new Date().toISOString(),
    };

    return { outcome, artifactId };
  }

  // ─── Prompt Building ─────────────────────────────────────────

  private buildAnalystSystemPrompt(analyst: MarketAnalyst): string {
    const tierKey = 'silver'; // Default tier — can be made configurable
    const tierInstruction = analyst.tier_instructions?.[tierKey] || '';

    return `You are ${analyst.display_name}. ${analyst.persona_prompt}

${tierInstruction ? `Analysis approach:\n${tierInstruction}\n` : ''}
Respond with valid JSON:
{
  "direction": "up" | "down" | "flat",
  "confidence": <0-100>,
  "rationale": "<your analysis>",
  "key_factors": ["<factor 1>", ...],
  "risks": ["<risk 1>", ...]
}

Respond ONLY with valid JSON.`;
  }

  private buildAnalystUserPrompt(
    instrument: MarketInstrument,
    analyst: MarketAnalyst,
    sharedContext: string,
    contextProviderText: string,
    dataSourceText?: string,
  ): string {
    const parts = [
      `Assess ${instrument.symbol} (${instrument.name}) for prediction.`,
      `Your weight in the ensemble: ${Number(analyst.default_weight).toFixed(1)}`,
    ];
    if (sharedContext) parts.push(`\n${sharedContext}`);
    if (contextProviderText) parts.push(contextProviderText);

    // Inject specialized data source context
    if (dataSourceText) parts.push(`\n--- Your Specialized Data ---\n${dataSourceText}`);

    // Inject analyst memory
    const memoryText = this.buildMemoryContext(analyst, instrument.symbol);
    if (memoryText) parts.push(memoryText);

    return parts.join('\n');
  }

  private buildMemoryContext(analyst: MarketAnalyst, symbol: string): string {
    const sections: string[] = [];

    // Patterns
    const patterns = analyst.memory_patterns ?? [];
    if (patterns.length > 0) {
      const relevant = patterns
        .filter(p => !p.instruments || p.instruments.length === 0 || p.instruments.includes(symbol))
        .slice(0, 5);
      if (relevant.length > 0) {
        sections.push('Patterns you have learned:\n' + relevant.map(p => `- ${p.pattern} (confidence: ${p.confidence})`).join('\n'));
      }
    }

    // Self-corrections
    const corrections = analyst.memory_corrections ?? [];
    if (corrections.length > 0) {
      const recent = corrections.slice(-3);
      sections.push('Self-corrections from past analyses:\n' + recent.map(c => `- ${c.correction}`).join('\n'));
    }

    // Instrument-specific notes
    const notes = analyst.memory_instrument_notes?.[symbol] ?? [];
    if (notes.length > 0) {
      const recent = notes.slice(-5);
      sections.push(`Your notes on ${symbol}:\n` + recent.map(n => `- ${n.note}`).join('\n'));
    }

    // Calibration
    const cal = analyst.memory_calibration ?? {};
    if (cal.predictions_made && cal.predictions_made > 0) {
      const accuracy = cal.correct ? ((cal.correct / cal.predictions_made) * 100).toFixed(0) : '0';
      sections.push(`Your track record: ${cal.predictions_made} predictions, ${accuracy}% accuracy. Calibrate your confidence accordingly.`);
    }

    if (sections.length === 0) return '';
    return '\n--- Your Memory ---\n' + sections.join('\n\n');
  }

  private async buildArbitratorContext(
    organizationSlug: string,
    outcomes: PredictionOutcome[],
  ): Promise<string> {
    // Load analyst names for display
    const analystIds = outcomes.map(o => o.analyst_id).filter(Boolean);
    let analystNames: Record<string, { name: string; weight: number }> = {};

    if (analystIds.length > 0) {
      const result = await this.db.rawQuery(
        `select id, display_name, default_weight from prediction.market_analysts
         where (organization_slug = $1 or organization_slug = '__base__')
           and id = any($2::text[])`,
        [organizationSlug, analystIds],
      );
      const rows = (result.data as Array<{ id: string; display_name: string; default_weight: number }> | null) ?? [];
      analystNames = Object.fromEntries(rows.map(r => [r.id, { name: r.display_name, weight: r.default_weight }]));
    }

    return outcomes.map((o, i) => {
      const info = analystNames[o.analyst_id ?? ''];
      const name = info?.name ?? `Analyst ${i + 1}`;
      const weight = Number(info?.weight ?? 1.0);
      return `### ${name} (weight: ${weight.toFixed(1)})
- Direction: ${o.predicted_direction}
- Confidence: ${o.confidence}%
- Rationale: ${o.rationale.slice(0, 500)}`;
    }).join('\n\n');
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private async loadConfigVersion(
    versionId: string,
  ): Promise<{ persona_prompt: string; default_weight: number; tier_instructions: Record<string, unknown> } | null> {
    const result = await this.db.rawQuery(
      `select persona_prompt, default_weight, tier_instructions
       from prediction.analyst_config_versions where id = $1`,
      [versionId],
    );
    const rows = (result.data as Array<{ persona_prompt: string; default_weight: number; tier_instructions: Record<string, unknown> }> | null) ?? [];
    return rows[0] ?? null;
  }

  private async getAnalystsForRun(
    organizationSlug: string,
    instrumentId: string,
  ): Promise<MarketAnalyst[]> {
    // Check for explicit assignments first
    const assigned = await this.db.rawQuery(
      `select ma.* from prediction.market_analysts ma
       join prediction.market_instrument_analyst_assignments a
         on a.analyst_id = ma.id and a.organization_slug = ma.organization_slug
       where (a.organization_slug = $1 or a.organization_slug = '__base__')
         and a.instrument_id = $2
         and ma.analyst_type = 'personality'
         and ma.is_enabled = true
         and ma.is_active = true
         and ma.workflow_scope in ('prediction', 'both')
       order by ma.default_weight desc, ma.created_at asc`,
      [organizationSlug, instrumentId],
    );
    const assignedRows = (assigned.data as MarketAnalyst[] | null) ?? [];
    if (assignedRows.length > 0) return assignedRows;

    // Fallback: all enabled personality analysts for the org
    const all = await this.db.rawQuery(
      `select * from prediction.market_analysts
       where (organization_slug = $1 or organization_slug = '__base__')
         and analyst_type = 'personality'
         and is_enabled = true
         and is_active = true
         and workflow_scope in ('prediction', 'both')
       order by case when organization_slug = $1 then 0 else 1 end, default_weight desc, created_at asc`,
      [organizationSlug],
    );
    return (all.data as MarketAnalyst[] | null) ?? [];
  }

  private async getLatestRiskComposite(
    organizationSlug: string,
    instrumentId: string,
  ): Promise<{ overall_score: number; verdict: string; rationale: string } | null> {
    // Try composite score first (new system)
    const composite = await this.db.rawQuery(
      `select overall_score, confidence, dimension_scores
       from prediction.risk_composite_scores
       where (organization_slug = $1 or organization_slug = '__base__') and instrument_id = $2 and status = 'active'
       order by created_at desc limit 1`,
      [organizationSlug, instrumentId],
    );
    const compRows = (composite.data as Array<{ overall_score: number; confidence: number }> | null) ?? [];
    if (compRows.length > 0) {
      const c = compRows[0];
      const verdict = c.overall_score <= 33 ? 'low' : c.overall_score <= 66 ? 'medium' : 'high';
      return { overall_score: c.overall_score, verdict, rationale: `Composite risk: ${c.overall_score}/100` };
    }

    // Fallback to legacy risk assessment
    const legacy = await this.db.rawQuery(
      `select * from prediction.market_risk_assessments
       where (organization_slug = $1 or organization_slug = '__base__') and instrument_id = $2
       order by created_at desc limit 1`,
      [organizationSlug, instrumentId],
    );
    const rows = (legacy.data as Array<{ risk_score: number; verdict: string; rationale: string }> | null) ?? [];
    if (rows.length > 0) {
      return { overall_score: rows[0].risk_score, verdict: rows[0].verdict, rationale: rows[0].rationale };
    }
    return null;
  }

  private async loadPredictorLines(organizationSlug: string, instrumentId: string, analystId?: string): Promise<string[]> {
    const query = analystId
      ? `select mp.relevance_score, mp.rationale, ma.title
         from prediction.market_predictors mp
         join prediction.market_articles ma on ma.id = mp.article_id
         where (mp.organization_slug = $1 or mp.organization_slug = '__base__') and mp.instrument_id = $2 and mp.status = 'active'
           and mp.scored_by_analyst_id = $3
         order by mp.relevance_score desc limit 20`
      : `select mp.relevance_score, mp.rationale, ma.title
         from prediction.market_predictors mp
         join prediction.market_articles ma on ma.id = mp.article_id
         where (mp.organization_slug = $1 or mp.organization_slug = '__base__') and mp.instrument_id = $2 and mp.status = 'active'
         order by mp.relevance_score desc limit 20`;
    const params = analystId
      ? [organizationSlug, instrumentId, analystId]
      : [organizationSlug, instrumentId];
    const result = await this.db.rawQuery(query, params);
    const rows = (result.data as Array<{ relevance_score: number; rationale: string | null; title: string | null }> | null) ?? [];
    return rows.map((r, i) => {
      const title = r.title ?? '(untitled)';
      const note = r.rationale ? ` — ${r.rationale.slice(0, 200)}` : '';
      return `${i + 1}. relevance=${Number(r.relevance_score).toFixed(2)} ${title}${note}`;
    });
  }

  private buildSharedContext(
    planeContext: string,
    risk: { overall_score: number; verdict: string; rationale: string } | null,
    predictorLines: string[],
  ): string {
    const parts: string[] = [];
    if (planeContext) parts.push(planeContext);
    if (risk) {
      parts.push(`Latest risk context: verdict=${risk.verdict}, score=${risk.overall_score}. ${risk.rationale.slice(0, 800)}`);
    }
    if (predictorLines.length > 0) {
      parts.push(`Active article predictors:\n${predictorLines.join('\n')}`);
    }
    return parts.length > 0 ? `Context:\n${parts.join('\n\n')}` : '';
  }

  private parseStructuredOutput(text: string): ParsedAnalystOutput {
    // Try JSON parse first
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        const rawDir = String(parsed['direction'] || 'flat').toLowerCase();
        const direction: 'up' | 'down' | 'flat' =
          rawDir === 'up' || rawDir === 'bullish' ? 'up' :
          rawDir === 'down' || rawDir === 'bearish' ? 'down' : 'flat';

        return {
          direction,
          confidence: Math.min(100, Math.max(0, Math.round(Number(parsed['confidence']) || 65))),
          rationale: String(parsed['rationale'] || text.slice(0, 1200)),
          key_factors: Array.isArray(parsed['key_factors']) ? parsed['key_factors'].map(String) : [],
          risks: Array.isArray(parsed['risks']) ? parsed['risks'].map(String) : [],
        };
      }
    } catch {
      // Fall through to keyword heuristic
    }

    // Keyword fallback
    this.logger.warn('Falling back to keyword heuristic for output parsing');
    const lower = text.toLowerCase();
    const direction: 'up' | 'down' | 'flat' =
      lower.includes('down') || lower.includes('bearish') ? 'down' :
      lower.includes('flat') || lower.includes('neutral') ? 'flat' : 'up';
    const confidence = direction === 'flat' ? 55 : 67;

    return {
      direction,
      confidence,
      rationale: text.slice(0, 1200),
      key_factors: [],
      risks: [],
    };
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
        hook_event_type: 'markets.orchestration.prediction.progress',
        status: 'running',
        message,
        progress: Math.round((current / total) * 100),
        step: `analyst_${current + 1}_of_${total}`,
        payload: { runId, current, total },
      } as never);
    } catch {
      // Non-critical
    }
  }
}
