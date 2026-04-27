/**
 * Tier 2 Audit Service.
 *
 * Spot-checks resolved predictions against analyst contracts, identifies
 * discrepancies, and writes structured findings to prediction.audit_findings.
 * Invoked by @Cron schedule and by POST /admin/run-tier2-audit.
 *
 * Effort: tier-2-audit.
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import { parseContractMarkdown } from '../utils/parse-contract-markdown';

interface AuditFindingRow {
  id: string;
  analystId: string;
  analystName: string;
  analystSlug: string;
  predictionId: string;
  symbol: string;
  predictedDirection: string;
  actualDirection: string;
  wasCorrect: boolean;
  confidence: number | null;
  changePercent: number | null;
  predictionDate: string;
  evaluationDate: string;
  contractExcerpt: string;
  outputExcerpt: string;
  discrepancy: string;
  hypothesis: string;
  severity: string;
  status: string;
  createdAt: string;
}

interface RawFindingRow {
  id: string;
  analyst_id: string;
  analyst_name: string;
  analyst_slug: string;
  prediction_id: string;
  symbol: string | null;
  predicted_direction: string;
  actual_direction: string;
  was_correct: boolean;
  confidence: number | string | null;
  change_percent: number | string | null;
  prediction_date: string;
  evaluation_date: string;
  contract_excerpt: string;
  output_excerpt: string;
  discrepancy: string;
  hypothesis: string;
  severity: string;
  status: string;
  created_at: string;
}

function mapFindingRow(r: RawFindingRow): AuditFindingRow {
  return {
    id: r.id,
    analystId: r.analyst_id,
    analystName: r.analyst_name,
    analystSlug: r.analyst_slug,
    predictionId: r.prediction_id,
    symbol: r.symbol ?? '',
    predictedDirection: r.predicted_direction,
    actualDirection: r.actual_direction,
    wasCorrect: r.was_correct,
    confidence: r.confidence === null ? null : Number(r.confidence),
    changePercent: r.change_percent === null ? null : Number(r.change_percent),
    predictionDate: r.prediction_date,
    evaluationDate: r.evaluation_date,
    contractExcerpt: r.contract_excerpt,
    outputExcerpt: r.output_excerpt,
    discrepancy: r.discrepancy,
    hypothesis: r.hypothesis,
    severity: r.severity,
    status: r.status,
    createdAt: r.created_at,
  };
}

interface AuditCycleResult {
  predictionsChecked: number;
  findingsCreated: number;
}

interface CandidateRow {
  prediction_id: string;
  analyst_id: string;
  was_correct: boolean;
  rationale: string;
  predicted_direction: string;
  confidence: number | null;
  config_version_id: string | null;
  source_context: Record<string, unknown> | null;
  actual_direction: string;
  actual_outcome_data: Record<string, unknown> | null;
  evaluation_date: string;
  symbol: string;
  display_name: string;
  slug: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
  ) {}

  // ─── Audit Policy (meta-loop) ───────────────────────────────────

  async updateAuditPolicy(): Promise<{ generated: boolean; reason?: string }> {
    const minReviews = Number(process.env.AUDIT_POLICY_MIN_REVIEWS) || 5;

    // Read all reviewed findings
    const reviewResult = await this.db.rawQuery(
      `SELECT af.status, af.discrepancy, af.hypothesis, af.severity,
              af.review_text, ma.slug as analyst_slug, ma.analyst_type
       FROM prediction.audit_findings af
       JOIN prediction.market_analysts ma ON ma.id = af.analyst_id
       WHERE af.status IN ('accepted', 'rejected', 'noted')
       ORDER BY af.reviewed_at DESC`,
    );
    if (reviewResult.error) throw new Error(reviewResult.error.message);
    const reviews = (reviewResult.data as Array<{
      status: string; discrepancy: string; hypothesis: string; severity: string;
      review_text: string | null; analyst_slug: string; analyst_type: string;
    }> | null) ?? [];

    if (reviews.length < minReviews) {
      this.logger.log(`Not enough reviewed findings (${reviews.length} < ${minReviews}), skipping policy generation`);
      return { generated: false, reason: `Not enough reviewed findings (${reviews.length} < ${minReviews})` };
    }

    const accepted = reviews.filter(r => r.status === 'accepted');
    const rejected = reviews.filter(r => r.status === 'rejected');
    const noted = reviews.filter(r => r.status === 'noted');
    const confidenceLevel = reviews.length >= 15 ? 'confident' : 'tentative';

    const formatFindings = (arr: typeof reviews) =>
      arr.map(r => `- [${r.analyst_slug}/${r.severity}] ${r.discrepancy} — Hypothesis: ${r.hypothesis}${r.review_text ? ` — User note: ${r.review_text}` : ''}`).join('\n');

    const prompt = `You are analyzing a user's feedback on AI-generated audit findings to learn their preferences.

FEEDBACK SUMMARY:
- Total reviewed: ${reviews.length}
- Accepted: ${accepted.length} (${(accepted.length / reviews.length * 100).toFixed(0)}%)
- Rejected: ${rejected.length} (${(rejected.length / reviews.length * 100).toFixed(0)}%)
- Noted: ${noted.length} (${(noted.length / reviews.length * 100).toFixed(0)}%)

ACCEPTED FINDINGS (the user agreed these were real problems):
${accepted.length > 0 ? formatFindings(accepted) : '(none yet)'}

REJECTED FINDINGS (the user said these were NOT problems):
${rejected.length > 0 ? formatFindings(rejected) : '(none yet)'}

NOTED FINDINGS (interesting but no action):
${noted.length > 0 ? formatFindings(noted) : '(none yet)'}

TASK:
Based on this feedback, write a selection policy (200-400 words) that tells the audit system:
1. What kinds of discrepancies to PRIORITIZE (patterns the user consistently accepts)
2. What kinds of discrepancies to SKIP or de-prioritize (patterns the user consistently rejects)
3. Any analyst-specific preferences (e.g., "the user cares more about Fundamentals Analyst findings")
4. Severity preferences (does the user engage more with high, medium, or low severity?)

Write the policy as direct instructions to the audit system, in second person ("You should prioritize...", "Skip findings about...").

${confidenceLevel === 'tentative' ? 'NOTE: The sample size is small (< 15 reviews). Keep the policy tentative — use "slightly prioritize" rather than "always surface" or "never show".' : ''}

Output ONLY the policy text. No preamble.`;

    let policyText: string;
    try {
      const res = await fetch(`${AuditService.OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: AuditService.AUDIT_MODEL, prompt, stream: false }),
      });
      if (!res.ok) {
        this.logger.warn(`Ollama returned ${res.status} during policy generation`);
        return { generated: false, reason: 'LLM unavailable' };
      }
      const data = await res.json() as { response: string };
      policyText = data.response.trim();
    } catch (err) {
      this.logger.warn(`Ollama unreachable during policy generation: ${err instanceof Error ? err.message : String(err)}`);
      return { generated: false, reason: 'LLM unavailable' };
    }

    // Store in learning_reports
    const summary = JSON.stringify({
      policyText,
      reviewedCount: reviews.length,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      notedCount: noted.length,
      confidenceLevel,
      generatedAt: new Date().toISOString(),
    });
    await this.db.rawQuery(
      `INSERT INTO prediction.learning_reports (id, report_type, report_date, summary, created_at)
       VALUES ($1, 'audit_policy', CURRENT_DATE, $2, now())
       ON CONFLICT (report_type, report_date)
       DO UPDATE SET summary = EXCLUDED.summary, created_at = EXCLUDED.created_at`,
      [randomUUID(), summary],
    );

    this.logger.log(`Audit policy generated (${confidenceLevel}, ${reviews.length} reviews)`);
    return { generated: true };
  }

  async getAuditPolicy(): Promise<{
    policyText: string;
    reviewedCount: number;
    acceptedCount: number;
    rejectedCount: number;
    notedCount: number;
    confidenceLevel: string;
    generatedAt: string;
  } | null> {
    const result = await this.db.rawQuery(
      `SELECT summary FROM prediction.learning_reports
       WHERE report_type = 'audit_policy'
       ORDER BY report_date DESC LIMIT 1`,
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<{ summary: Record<string, unknown> }> | null) ?? [];
    if (rows.length === 0) return null;
    const s = rows[0].summary as {
      policyText?: string; reviewedCount?: number; acceptedCount?: number;
      rejectedCount?: number; notedCount?: number; confidenceLevel?: string; generatedAt?: string;
    };
    if (!s.policyText) return null;
    return {
      policyText: s.policyText,
      reviewedCount: s.reviewedCount ?? 0,
      acceptedCount: s.acceptedCount ?? 0,
      rejectedCount: s.rejectedCount ?? 0,
      notedCount: s.notedCount ?? 0,
      confidenceLevel: s.confidenceLevel ?? 'tentative',
      generatedAt: s.generatedAt ?? '',
    };
  }

  // ─── Read + Review ──────────────────────────────────────────────

  async getFindings(userId: string): Promise<AuditFindingRow[]> {

    const result = await this.db.rawQuery(
      `SELECT af.id, af.analyst_id, af.prediction_id, af.config_version_id,
              af.contract_excerpt, af.output_excerpt, af.discrepancy, af.hypothesis,
              af.severity, af.status, af.created_at,
              ma.display_name as analyst_name, ma.slug as analyst_slug,
              i.symbol,
              phe.predicted_direction, phe.confidence_at_prediction as confidence,
              phe.actual_direction, phe.was_correct, phe.evaluation_date,
              (phe.actual_outcome_data->>'changePercent')::numeric as change_percent,
              phe.prediction_date as prediction_date
       FROM prediction.audit_findings af
       JOIN prediction.market_analysts ma ON ma.id = af.analyst_id
       LEFT JOIN prediction.prediction_horizon_evaluations phe ON phe.prediction_id = af.prediction_id
       LEFT JOIN prediction.instruments i ON i.id = phe.instrument_id
       WHERE af.status = 'pending_review'
       ORDER BY af.created_at DESC`,
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as RawFindingRow[] | null) ?? []).map(mapFindingRow);
  }

  async reviewFinding(
    userId: string,
    findingId: string,
    action: string,
    reviewText?: string,
  ): Promise<{ updated: boolean }> {

    const validActions = ['accepted', 'rejected', 'noted'];
    if (!validActions.includes(action)) {
      throw new Error(`Invalid action: ${action}. Must be one of: ${validActions.join(', ')}`);
    }

    const result = await this.db.rawQuery(
      `UPDATE prediction.audit_findings
       SET status = $1, review_text = $2, reviewed_by = $3, reviewed_at = now()
       WHERE id = $4
         AND status = 'pending_review'`,
      [action, reviewText ?? null, userId, findingId],
    );
    if (result.error) throw new Error(result.error.message);
    return { updated: true };
  }

  // ─── Audit Cycle ──────────────────────────────────────────────

  // Run every 2 hours. Skips if LLM is not enabled.
  @Cron('0 */2 * * *')
  async scheduledAuditCycle(): Promise<void> {
    if (process.env.MARKETS_ENABLE_LLM !== 'true') return;
    try {
      await this.runAuditCycle();
    } catch (err) {
      this.logger.warn(`Scheduled audit cycle failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Daily at 01:00 UTC — update the selection policy from accumulated feedback.
  @Cron('0 1 * * *')
  async scheduledPolicyUpdate(): Promise<void> {
    if (process.env.MARKETS_ENABLE_LLM !== 'true') return;
    try {
      await this.updateAuditPolicy();
    } catch (err) {
      this.logger.warn(`Scheduled policy update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async runAuditCycle(options?: { count?: number }): Promise<AuditCycleResult> {

    const envCount = Number(process.env.AUDIT_PREDICTIONS_PER_CYCLE);
    const count = options?.count ?? (envCount > 0 ? envCount : 5);

    // 1. Select candidates — wrong-first weighted random, skip recently audited
    const candidateResult = await this.db.rawQuery(
      `SELECT e.prediction_id, e.analyst_id, e.was_correct,
              mp.rationale, mp.predicted_direction, mp.confidence,
              mp.config_version_id, mp.source_context,
              e.actual_direction, e.actual_outcome_data, e.evaluation_date,
              i.symbol, ma.display_name, ma.slug
       FROM prediction.prediction_horizon_evaluations e
       JOIN prediction.market_predictions mp ON mp.id = e.prediction_id
       JOIN prediction.instruments i ON i.id = e.instrument_id
       JOIN prediction.market_analysts ma ON ma.id = e.analyst_id
       WHERE e.prediction_id NOT IN (
           SELECT prediction_id FROM prediction.audit_findings
           WHERE created_at > now() - interval '7 days'
         )
       ORDER BY
         CASE WHEN e.was_correct THEN 1 ELSE 0 END ASC,
         random()
       LIMIT $1`,
      [count],
    );
    if (candidateResult.error) throw new Error(candidateResult.error.message);
    const candidates = (candidateResult.data as CandidateRow[] | null) ?? [];

    // Load the current selection policy (meta-loop)
    const policy = await this.getAuditPolicy();
    const policyText = policy?.policyText ?? null;

    let findingsCreated = 0;

    for (const candidate of candidates) {
      try {
        const finding = await this.auditPrediction(candidate, policyText);
        if (finding) {
          findingsCreated++;
        }
      } catch (err) {
        this.logger.warn(`Audit check failed for prediction ${candidate.prediction_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(`Audit cycle complete: ${candidates.length} checked, ${findingsCreated} findings`);
    return { predictionsChecked: candidates.length, findingsCreated };
  }

  private async auditPrediction(candidate: CandidateRow, policyText: string | null): Promise<boolean> {
    // Load the contract
    const configVersionId = candidate.config_version_id;
    let contextMarkdown: string | null = null;

    if (configVersionId) {
      const cvResult = await this.db.rawQuery(
        `SELECT context_markdown FROM prediction.analyst_config_versions WHERE id = $1`,
        [configVersionId],
      );
      const cvRows = (cvResult.data as Array<{ context_markdown: string | null }> | null) ?? [];
      contextMarkdown = cvRows[0]?.context_markdown ?? null;
    }

    // Fallback: use current active contract
    if (!contextMarkdown) {
      const activeResult = await this.db.rawQuery(
        `SELECT acv.context_markdown
         FROM prediction.market_analysts ma
         JOIN prediction.analyst_config_versions acv ON acv.id = ma.current_config_version_id
         WHERE ma.id = $1`,
        [candidate.analyst_id],
      );
      const activeRows = (activeResult.data as Array<{ context_markdown: string | null }> | null) ?? [];
      contextMarkdown = activeRows[0]?.context_markdown ?? null;
    }

    if (!contextMarkdown) {
      this.logger.debug(`No contract for analyst ${candidate.slug}, skipping`);
      return false;
    }

    const sections = parseContractMarkdown(contextMarkdown);

    // v4 stage-keyed path: prefer the Prediction Generation stage section for
    // the audit (this audit targets prediction outputs). Fall back to the
    // legacy `## Role:` section on pre-v4 contracts. Effort: stage-keyed-analyst-contracts.
    const v4StageBody = sections.stages?.predictionGeneration ?? '';
    let scopedSection: string;
    let contractSection: string | null;
    let violationStage: string | null;
    if (v4StageBody.trim()) {
      scopedSection = v4StageBody;
      contractSection = 'Stage: Prediction Generation';
      violationStage = 'prediction_generation';
    } else {
      const roleNames = Object.keys(sections.roles);
      scopedSection = roleNames.length > 0 ? sections.roles[roleNames[0]] : '';
      contractSection = roleNames.length > 0 ? `Role: ${roleNames[0]}` : null;
      violationStage = null; // Legacy contract — no stage attribution.
    }

    const llmResult = await this.callAuditLlm(candidate, sections.general, scopedSection, policyText, sections.adaptations);

    if (!llmResult || !llmResult.finding) return false;

    // Insert finding with stage attribution (stage-keyed-analyst-contracts effort).
    const findingId = randomUUID();
    await this.db.rawQuery(
      `INSERT INTO prediction.audit_findings
        (id, analyst_id, prediction_id, config_version_id,
         contract_excerpt, output_excerpt, discrepancy, hypothesis, severity,
         violation_stage, contract_section,
         status, audit_model, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               'pending_review', $12, now())`,
      [
        findingId, candidate.analyst_id, candidate.prediction_id,
        candidate.config_version_id,
        llmResult.contractExcerpt, llmResult.outputExcerpt,
        llmResult.discrepancy, llmResult.hypothesis, llmResult.severity,
        violationStage, contractSection,
        llmResult.model ?? 'stub',
      ],
    );

    return true;
  }

  private static readonly OLLAMA_URL = process.env.OLLAMA_LOCAL_URL || 'http://localhost:11434';
  private static readonly AUDIT_MODEL = process.env.AUDIT_LLM_MODEL || 'gemma4:26b';

  private static readonly LEGAL_REPLACEMENTS: Array<[RegExp, string]> = [
    [/\bfinancial advice\b/gi, 'financial analysis'],
    [/\binvestment advice\b/gi, 'investment analysis'],
    [/\btrading advice\b/gi, 'trading analysis'],
    [/\badvice\b/gi, 'analysis'],
    [/\brecommendations?\b/gi, 'assessments'],
    [/\brecommends?\b/gi, 'assesses'],
    [/\brecommending\b/gi, 'assessing'],
  ];

  private buildAuditPrompt(
    candidate: CandidateRow,
    generalSection: string,
    roleSection: string,
    policyText?: string | null,
    adaptationsSection?: string,
  ): string {
    const outcome = candidate.actual_outcome_data ?? {};
    const changePercent = typeof outcome['changePercent'] === 'number'
      ? `${Number(outcome['changePercent']).toFixed(2)}%` : 'N/A';
    const priceAt = typeof outcome['priceAtPrediction'] === 'number'
      ? `${outcome['priceAtPrediction']} → ${outcome['priceAtHorizon']}` : '';
    const sourceCtx = candidate.source_context && Object.keys(candidate.source_context).length > 0
      ? JSON.stringify(candidate.source_context).slice(0, 300) : 'None available';

    const policyPreamble = policyText
      ? `SELECTION GUIDANCE (learned from user feedback):
"""
${policyText}
"""

Apply this guidance when evaluating the following prediction. If the guidance says to skip a certain type of finding, respond with {"finding": false} even if you notice a minor discrepancy of that type.

---

`
      : '';

    return `${policyPreamble}You are auditing a financial market analyst's prediction against its operating contract.

ANALYST CONTRACT (Role Section):
"""
${roleSection}
"""

ANALYST CONTRACT (General Section):
"""
${generalSection}
"""
${adaptationsSection ? `
ANALYST CONTRACT (Adaptations — Tier 1 learning-engine adjustments active at prediction time):
"""
${adaptationsSection}
"""
` : ''}
PREDICTION INPUT:
- Instrument: ${candidate.symbol}
- Predicted direction: ${candidate.predicted_direction}
- Confidence: ${candidate.confidence ?? 'N/A'}%
- Source context: ${sourceCtx}

PREDICTION OUTPUT (Analyst's Rationale):
"""
${candidate.rationale}
"""

ACTUAL OUTCOME:
- Actual direction: ${candidate.actual_direction}
- Was correct: ${candidate.was_correct}
- Price change: ${changePercent} (${priceAt})

TASK:
Compare the analyst's rationale against its contract. Is there a discrepancy where the output violates or ignores the contract's stated purpose, decision criteria, or failure modes?

If YES, respond in EXACTLY this JSON format:
{"finding":true,"contractExcerpt":"<quote the specific part of the contract that was violated>","outputExcerpt":"<quote the specific part of the rationale that violates it>","discrepancy":"<one sentence describing the discrepancy>","hypothesis":"<one sentence explaining why the model may have drifted>","severity":"<low|medium|high>"}

If NO discrepancy, respond with exactly:
{"finding":false}

Respond ONLY with the JSON. No preamble, no explanation.`;
  }

  private async callAuditLlm(
    candidate: CandidateRow,
    generalSection: string,
    roleSection: string,
    policyText?: string | null,
    adaptationsSection?: string,
  ): Promise<{
    finding: boolean;
    contractExcerpt?: string;
    outputExcerpt?: string;
    discrepancy?: string;
    hypothesis?: string;
    severity?: string;
    model?: string;
  } | null> {
    const prompt = this.buildAuditPrompt(candidate, generalSection, roleSection, policyText, adaptationsSection);

    let response: string;
    try {
      const res = await fetch(`${AuditService.OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: AuditService.AUDIT_MODEL, prompt, stream: false }),
      });
      if (!res.ok) {
        this.logger.warn(`Ollama returned ${res.status}`);
        return null;
      }
      const data = await res.json() as { response: string };
      response = data.response;
    } catch (err) {
      this.logger.warn(`Ollama unreachable: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }

    // Parse JSON — the model may include preamble text before the JSON
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.debug(`No JSON found in LLM response for prediction ${candidate.prediction_id}`);
        return null;
      }
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      if (typeof parsed['finding'] !== 'boolean') return null;

      if (!parsed['finding']) return { finding: false };

      // Validate all required fields
      const fields = ['contractExcerpt', 'outputExcerpt', 'discrepancy', 'hypothesis', 'severity'];
      for (const f of fields) {
        if (typeof parsed[f] !== 'string' || (parsed[f] as string).length === 0) {
          this.logger.debug(`Missing field ${f} in audit response for ${candidate.prediction_id}`);
          return null;
        }
      }

      const severity = parsed['severity'] as string;
      if (!['low', 'medium', 'high'].includes(severity)) {
        this.logger.debug(`Invalid severity "${severity}" for ${candidate.prediction_id}`);
        return null;
      }

      // Legal-language post-processing
      let discrepancy = parsed['discrepancy'] as string;
      let hypothesis = parsed['hypothesis'] as string;
      for (const [regex, replacement] of AuditService.LEGAL_REPLACEMENTS) {
        discrepancy = discrepancy.replace(regex, replacement);
        hypothesis = hypothesis.replace(regex, replacement);
      }

      return {
        finding: true,
        contractExcerpt: parsed['contractExcerpt'] as string,
        outputExcerpt: parsed['outputExcerpt'] as string,
        discrepancy,
        hypothesis,
        severity,
        model: AuditService.AUDIT_MODEL,
      };
    } catch {
      this.logger.debug(`JSON parse failed for prediction ${candidate.prediction_id}`);
      return null;
    }
  }
}
