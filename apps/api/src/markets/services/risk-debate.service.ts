import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@orchestrator-ai/transport-types';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsLlmService } from './markets-llm.service';
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

const DEFAULT_ARBITER_PROMPT = `You are the Arbiter in a risk assessment debate.
You have seen the Blue Agent's defense and the Red Agent's challenges.
Synthesize both perspectives and propose a score adjustment between -30 and +30.

Respond with valid JSON:
{
  "final_assessment": "<your synthesis>",
  "accepted_challenges": ["<accepted challenge>", ...],
  "rejected_challenges": ["<rejected challenge>", ...],
  "adjustment_reasoning": "<why you propose this adjustment>",
  "recommended_adjustment": <integer between -30 and +30>
}`;

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

    // Load org-specific debate prompts from DB, fall back to built-in defaults
    const bluePrompt = await this.loadDebatePrompt('blue', DEFAULT_BLUE_PROMPT);
    const redPrompt = await this.loadDebatePrompt('red', DEFAULT_RED_PROMPT);
    const arbiterPrompt = await this.loadDebatePrompt('arbiter', DEFAULT_ARBITER_PROMPT);

    let blueAssessment: BlueAssessment;
    let redChallenges: RedChallenges;
    let arbiterSynthesis: ArbiterSynthesis;
    let arbiterLlmUsageId: string | null = null;
    const transcript: unknown[] = [];

    try {
      // 1. Blue Agent: Defend
      const blueResult = await this.llmService.generateText(
        input.context,
        bluePrompt,
        `Defend this risk assessment for ${input.instrumentSymbol}:\n\n${assessmentSummary}`,
      );
      blueAssessment = this.parseBlue(blueResult.text);
      transcript.push({ role: 'blue', content: blueResult.text, llm_usage_id: blueResult.llmUsageId ?? null });

      // 2. Red Agent: Challenge
      const redResult = await this.llmService.generateText(
        input.context,
        redPrompt,
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
        arbiterPrompt,
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
