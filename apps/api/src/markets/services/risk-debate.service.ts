import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@orchestrator-ai/transport-types';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { MarketsLlmService } from './markets-llm.service';
import { loadContractFragment } from '../utils/contract-loader';
import { loadInstrumentContractFragment } from '../utils/instrument-contract-loader';
import { buildMergedSystemPrompt, emitPromptTokenEstimate } from '../utils/merge-prompts';
import { WorkflowStage } from '../workflow-stages/workflow-stage';
import type {
  BlueAssessment,
  RedChallenges,
  ArbiterSynthesis,
  RiskDebate,
  RiskDimensionAssessment,
} from '../markets.types';

interface DebateInput {
  context: ExecutionContext;
  runId: string;
  instrumentId: string;
  instrumentSymbol: string;
  compositeScoreId: string;
  overallScore: number;
  dimensionAssessments: RiskDimensionAssessment[];
  viewerUserId?: string | null;
}

interface DebateResult {
  debate: RiskDebate;
  adjustedScore: number;
  adjustment: number;
}

const DEFAULT_BLUE_PROMPT = `You are the Blue Agent (Defender) in a risk assessment debate.
Your role is to defend the risk assessment with evidence and clear reasoning.

Respond with valid JSON:
{
  "summary": "<your defense of the assessment>",
  "key_findings": ["<finding 1>", ...],
  "evidence_cited": ["<evidence 1>", ...],
  "confidence_explanation": "<why the assessment confidence level is appropriate>"
}`;

const DEFAULT_RED_PROMPT = `You are the Red Agent (Challenger) in a risk assessment debate.
Your role is to challenge blind spots, identify overstated or understated risks, and propose alternative scenarios.

Respond with valid JSON:
{
  "challenges": ["<challenge 1>", ...],
  "blind_spots": ["<blind spot 1>", ...],
  "overstated_risks": ["<overstated risk>", ...],
  "understated_risks": ["<understated risk>", ...]
}`;

const DEFAULT_ARBITER_PROMPT_JSON_SCHEMA = `You have seen the Blue Agent's defense and the Red Agent's challenges. Synthesize both perspectives and propose a score adjustment between -30 and +30.

Respond with valid JSON:
{
  "final_assessment": "<your synthesis>",
  "accepted_challenges": ["<accepted challenge>", ...],
  "rejected_challenges": ["<rejected challenge>", ...],
  "adjustment_reasoning": "<why you propose this adjustment>",
  "recommended_adjustment": <integer between -30 and +30>
}`;

const DEFAULT_ARBITER_PROMPT = `You are the Arbiter in a risk assessment debate.
${DEFAULT_ARBITER_PROMPT_JSON_SCHEMA}`;

/**
 * Three-agent adversarial debate: Blue (defend) → Red (challenge) → Arbiter (synthesize).
 * Produces a score adjustment clamped to [-30, +30].
 */
@Injectable()
export class RiskDebateService {
  private readonly logger = new Logger(RiskDebateService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsLlmService) private readonly llmService: MarketsLlmService,
    @Inject(ObservabilityEventsService) private readonly observability: ObservabilityEventsService,
  ) {}

  async runDebate(input: DebateInput): Promise<DebateResult> {
    const debateId = randomUUID();
    const now = new Date().toISOString();

    // Create pending debate record
    await this.db.rawQuery(
      `insert into prediction.risk_debates
        (id, run_id, instrument_id, composite_score_id, original_score, status, viewer_user_id, created_at)
       values ($1, $2, $3, $4, $5, 'in_progress', $6, $7)`,
      [debateId, input.runId, input.instrumentId, input.compositeScoreId, input.overallScore, input.viewerUserId ?? null, now],
    );

    const assessmentSummary = this.formatAssessmentsForDebate(input.dimensionAssessments, input.overallScore);

    // Load org-specific debate prompts from DB, fall back to built-in defaults.
    // In parallel, load the instrument contract's Risk Debate fragment — it is
    // merged into each participant's system prompt so Blue/Red/Arbiter share the
    // instrument-specific framing (per instrument-contracts effort Phase 4).
    const [bluePrompt, redPrompt, arbiterPrompt, instrumentLoad] = await Promise.all([
      this.loadDebatePrompt('blue', DEFAULT_BLUE_PROMPT),
      this.loadDebatePrompt('red', DEFAULT_RED_PROMPT),
      this.loadArbiterPrompt(),
      loadInstrumentContractFragment(
        { db: this.db, logger: this.logger, observability: this.observability },
        { id: input.instrumentId, symbol: input.instrumentSymbol },
        WorkflowStage.RiskAssessment,
        'debate',
      ),
    ]);
    const { stageFragment: instrumentFragment } = instrumentLoad;
    const mergeInstr = (analystSlug: string, analystFragment: string): string =>
      instrumentFragment
        ? buildMergedSystemPrompt({
            instrumentSymbol: input.instrumentSymbol,
            instrumentFragment,
            analystSlug,
            analystFragment,
          })
        : analystFragment;
    const blueSystemPrompt = mergeInstr('blue', bluePrompt);
    const redSystemPrompt = mergeInstr('red', redPrompt);
    const arbiterSystemPrompt = mergeInstr('arbiter', arbiterPrompt);
    for (const [slug, prompt] of [['blue', blueSystemPrompt], ['red', redSystemPrompt], ['arbiter', arbiterSystemPrompt]] as const) {
      emitPromptTokenEstimate(this.observability, this.logger, {
        prompt,
        stage: WorkflowStage.RiskAssessment,
        subStage: 'debate',
        analystSlug: slug,
        instrumentSymbol: input.instrumentSymbol,
      });
    }

    let blueAssessment: BlueAssessment;
    let redChallenges: RedChallenges;
    let arbiterSynthesis: ArbiterSynthesis;
    let arbiterLlmUsageId: string | null = null;
    const transcript: unknown[] = [];

    try {
      // 1. Blue Agent: Defend
      const blueResult = await this.llmService.generateText(
        input.context,
        blueSystemPrompt,
        `Defend this risk assessment for ${input.instrumentSymbol}:\n\n${assessmentSummary}`,
      );
      blueAssessment = this.parseBlue(blueResult.text);
      transcript.push({ role: 'blue', content: blueResult.text, llm_usage_id: blueResult.llmUsageId ?? null });

      // 2. Red Agent: Challenge
      const redResult = await this.llmService.generateText(
        input.context,
        redSystemPrompt,
        `Challenge this risk assessment for ${input.instrumentSymbol}:\n\nAssessment:\n${assessmentSummary}\n\nBlue Agent's defense:\n${JSON.stringify(blueAssessment)}`,
      );
      redChallenges = this.parseRed(redResult.text);
      transcript.push({ role: 'red', content: redResult.text, llm_usage_id: redResult.llmUsageId ?? null });

      // 3. Arbiter: Synthesize. The arbiter's llm_usage_id is what gets stamped
      // on the risk_debates row because the arbiter call is most directly
      // responsible for the row's conclusion (recommended_adjustment).
      // Blue/red are still findable via the transcript and via run_id in llm_usage.
      const arbiterResult = await this.llmService.generateText(
        input.context,
        arbiterSystemPrompt,
        `Synthesize the debate for ${input.instrumentSymbol}:\n\nOriginal score: ${input.overallScore}/100\n\nBlue defense:\n${JSON.stringify(blueAssessment)}\n\nRed challenges:\n${JSON.stringify(redChallenges)}`,
      );
      arbiterSynthesis = this.parseArbiter(arbiterResult.text);
      arbiterLlmUsageId = arbiterResult.llmUsageId ?? null;
      transcript.push({ role: 'arbiter', content: arbiterResult.text, llm_usage_id: arbiterLlmUsageId });
    } catch (err) {
      // Debate failed — mark and return no adjustment
      await this.db.rawQuery(
        `update prediction.risk_debates set status = 'failed', score_adjustment = 0 where id = $1`,
        [debateId],
      );
      const debate: RiskDebate = {
        id: debateId,
        run_id: input.runId,
        instrument_id: input.instrumentId,
        composite_score_id: input.compositeScoreId,
        blue_assessment: { summary: '', key_findings: [], evidence_cited: [], confidence_explanation: '' },
        red_challenges: { challenges: [], blind_spots: [], overstated_risks: [], understated_risks: [] },
        arbiter_synthesis: { final_assessment: '', accepted_challenges: [], rejected_challenges: [], adjustment_reasoning: '', recommended_adjustment: 0 },
        original_score: input.overallScore,
        final_score: input.overallScore,
        score_adjustment: 0,
        transcript: [],
        status: 'failed',
        created_at: now,
        completed_at: new Date().toISOString(),
      };
      return { debate, adjustedScore: input.overallScore, adjustment: 0 };
    }

    // Clamp adjustment
    const adjustment = Math.min(30, Math.max(-30, arbiterSynthesis.recommended_adjustment));
    const finalScore = Math.min(100, Math.max(0, Math.round(input.overallScore + adjustment)));

    // Update debate record
    await this.db.rawQuery(
      `update prediction.risk_debates
       set blue_assessment = $1, red_challenges = $2, arbiter_synthesis = $3,
           final_score = $4, score_adjustment = $5, transcript = $6,
           llm_usage_id = $7,
           status = 'completed', completed_at = $8
       where id = $9`,
      [
        JSON.stringify(blueAssessment),
        JSON.stringify(redChallenges),
        JSON.stringify(arbiterSynthesis),
        finalScore,
        adjustment,
        JSON.stringify(transcript),
        arbiterLlmUsageId,
        new Date().toISOString(),
        debateId,
      ],
    );

    const debate: RiskDebate = {
      id: debateId,
      run_id: input.runId,
      instrument_id: input.instrumentId,
      composite_score_id: input.compositeScoreId,
      blue_assessment: blueAssessment,
      red_challenges: redChallenges,
      arbiter_synthesis: arbiterSynthesis,
      original_score: input.overallScore,
      final_score: finalScore,
      score_adjustment: adjustment,
      transcript,
      status: 'completed',
      created_at: now,
      completed_at: new Date().toISOString(),
    };

    return { debate, adjustedScore: finalScore, adjustment };
  }

  private async loadDebatePrompt(
    role: 'blue' | 'red' | 'arbiter',
    fallback: string,
  ): Promise<string> {
    try {
      const result = await this.db.rawQuery(
        `select system_prompt from prediction.risk_debate_contexts
         where role = $1 and is_active = true
         order by version desc limit 1`,
        [role],
      );
      const rows = (result.data as Array<{ system_prompt: string }> | null) ?? [];
      if (rows.length > 0 && rows[0].system_prompt) {
        return rows[0].system_prompt;
      }
    } catch {
      // Fall through to default
    }
    return fallback;
  }

  /**
   * Arbiter prompt resolution order (stage-keyed-analyst-contracts effort):
   *   1. Arbitrator analyst's v4 `## Stage: Risk Assessment — Debate (3b)` section
   *      (+ General + Adaptations) if the analyst exists and has a stage-keyed contract.
   *   2. Override from `prediction.risk_debate_contexts` table (legacy mechanism).
   *   3. Built-in `DEFAULT_ARBITER_PROMPT` constant.
   * Blue/Red prompts stay on the legacy loader — per-analyst Blue/Red assignment
   * is a future architectural refactor outside this effort's scope.
   */
  private async loadArbiterPrompt(): Promise<string> {
    try {
      const result = await this.db.rawQuery(
        `select id, slug, current_config_version_id
         from prediction.market_analysts
         where slug = 'arbitrator' and user_id is null
         limit 1`,
      );
      const rows = (result.data as Array<{ id: string; slug: string; current_config_version_id: string | null }> | null) ?? [];
      if (rows.length > 0 && rows[0].current_config_version_id) {
        const { stageFragment, fallback } = await loadContractFragment(
          { db: this.db, logger: this.logger, observability: this.observability },
          { id: rows[0].id, slug: rows[0].slug },
          rows[0].current_config_version_id,
          WorkflowStage.RiskAssessment,
          'debate',
        );
        if (!fallback && stageFragment) {
          return `${stageFragment}\n\n${DEFAULT_ARBITER_PROMPT_JSON_SCHEMA}`;
        }
      }
    } catch (err) {
      this.logger.warn(`loadArbiterPrompt: contract lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return this.loadDebatePrompt('arbiter', DEFAULT_ARBITER_PROMPT);
  }

  /**
   * Resolve debate participants: base analysts always participate;
   * authored analysts participate only when a viewer owns them and
   * they are wired to the instrument.
   */
  async resolveParticipants(
    viewerUserId: string | null,
    instrumentId: string,
  ): Promise<{ baseAnalysts: any[]; authoredAnalysts: any[] }> {
    // Base analysts: always included
    const baseResult = await this.db.rawQuery(
      `SELECT id, slug, display_name FROM prediction.market_analysts
       WHERE user_id IS NULL AND is_active = true AND is_enabled = true
         AND analyst_type = 'personality' AND workflow_scope IN ('risk', 'both')`,
    );
    const baseAnalysts = (baseResult.data as any[] | null) ?? [];

    if (!viewerUserId) {
      return { baseAnalysts, authoredAnalysts: [] };
    }

    // Viewer's authored analysts wired to this instrument
    const authoredResult = await this.db.rawQuery(
      `SELECT DISTINCT ma.id, ma.slug, ma.display_name
       FROM prediction.viewer_instrument_analyst_assignments viaa
       JOIN prediction.market_analysts ma ON ma.id = viaa.analyst_id
       WHERE viaa.viewer_user_id = $1
         AND viaa.instrument_id = $2
         AND ma.is_active = true
         AND ma.user_id IS NOT NULL`,
      [viewerUserId, instrumentId],
    );
    const authoredAnalysts = (authoredResult.data as any[] | null) ?? [];

    return { baseAnalysts, authoredAnalysts };
  }

  private formatAssessmentsForDebate(
    assessments: RiskDimensionAssessment[],
    overallScore: number,
  ): string {
    const lines = assessments.map(
      (a) => `- ${a.dimension_id}: score=${a.score}/100, confidence=${a.confidence}, reasoning: ${a.reasoning.slice(0, 300)}`,
    );
    return `Overall composite score: ${overallScore}/100\n\nDimension breakdown:\n${lines.join('\n')}`;
  }

  private parseBlue(text: string): BlueAssessment {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as Record<string, unknown>;
        return {
          summary: String(parsed['summary'] || ''),
          key_findings: Array.isArray(parsed['key_findings']) ? parsed['key_findings'].map(String) : [],
          evidence_cited: Array.isArray(parsed['evidence_cited']) ? parsed['evidence_cited'].map(String) : [],
          confidence_explanation: String(parsed['confidence_explanation'] || ''),
        };
      }
    } catch { /* fall through */ }
    return { summary: text.slice(0, 1000), key_findings: [], evidence_cited: [], confidence_explanation: '' };
  }

  private parseRed(text: string): RedChallenges {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as Record<string, unknown>;
        return {
          challenges: Array.isArray(parsed['challenges']) ? parsed['challenges'].map(String) : [],
          blind_spots: Array.isArray(parsed['blind_spots']) ? parsed['blind_spots'].map(String) : [],
          overstated_risks: Array.isArray(parsed['overstated_risks']) ? parsed['overstated_risks'].map(String) : [],
          understated_risks: Array.isArray(parsed['understated_risks']) ? parsed['understated_risks'].map(String) : [],
        };
      }
    } catch { /* fall through */ }
    return { challenges: [text.slice(0, 500)], blind_spots: [], overstated_risks: [], understated_risks: [] };
  }

  private parseArbiter(text: string): ArbiterSynthesis {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as Record<string, unknown>;
        return {
          final_assessment: String(parsed['final_assessment'] || ''),
          accepted_challenges: Array.isArray(parsed['accepted_challenges']) ? parsed['accepted_challenges'].map(String) : [],
          rejected_challenges: Array.isArray(parsed['rejected_challenges']) ? parsed['rejected_challenges'].map(String) : [],
          adjustment_reasoning: String(parsed['adjustment_reasoning'] || ''),
          recommended_adjustment: Math.min(30, Math.max(-30, Math.round(Number(parsed['recommended_adjustment']) || 0))),
        };
      }
    } catch { /* fall through */ }
    return { final_assessment: text.slice(0, 1000), accepted_challenges: [], rejected_challenges: [], adjustment_reasoning: '', recommended_adjustment: 0 };
  }
}
