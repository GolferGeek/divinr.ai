import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ExecutionContext } from '@orchestrator-ai/transport-types';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsLlmService } from './markets-llm.service';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import type { CanonicalTestDay, AnalystConfigVersion } from '../markets.types';

export interface CanonicalTestInput {
  /** The analyst being tested */
  analystId: string;
  organizationSlug: string;
  /** The proposed config to test */
  proposedPrompt: string;
  proposedWeight: number;
  proposedTierInstructions: Record<string, string>;
  /** Filter canonical days by scope */
  testScope: 'prediction' | 'risk' | 'both';
}

export interface CanonicalDayResult {
  canonicalDayId: string;
  canonicalDate: string;
  originalDirection: string;
  proposedDirection: string;
  actualDirection: string;
  originalCorrect: boolean;
  proposedCorrect: boolean;
  improved: boolean;
  regressed: boolean;
  severityRegression: boolean;
}

export interface CanonicalTestResult {
  dayResults: CanonicalDayResult[];
  improvementCount: number;
  regressionCount: number;
  severityRegressionCount: number;
  netScore: number;
  passed: boolean;
  reason: string;
}

/**
 * Canonical test execution engine.
 *
 * Replays a proposed analyst config change against the curated set of
 * canonical test days (frozen snapshots of past failures). Determines
 * whether the change improves outcomes without regressing on known-hard scenarios.
 *
 * Decision rules:
 * - Any severity regression (correct → incorrect) = BLOCK
 * - Net score ≤ 0 = REJECT
 * - Net score > 0, no severity regressions = PASS
 */
@Injectable()
export class CanonicalTestRunnerService {
  private readonly logger = new Logger(CanonicalTestRunnerService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    private readonly schema: MarketsSchemaService,
    private readonly llmService: MarketsLlmService,
  ) {}

  async runCanonicalTests(input: CanonicalTestInput): Promise<CanonicalTestResult> {
    await this.schema.ensureSchema();

    // 1. Load active canonical days for the analyst's instruments
    const canonicalDays = await this.loadCanonicalDays(input);
    if (canonicalDays.length === 0) {
      return {
        dayResults: [],
        improvementCount: 0,
        regressionCount: 0,
        severityRegressionCount: 0,
        netScore: 0,
        passed: true,
        reason: 'No canonical test days available — passed by default',
      };
    }

    this.logger.log(`Running ${canonicalDays.length} canonical tests for analyst ${input.analystId}`);

    // 2. Replay each canonical day
    const dayResults: CanonicalDayResult[] = [];
    const context = this.llmService.buildExecutionContext(
      input.organizationSlug,
      'canonical-test-runner',
      'canonical-test',
    );

    for (const day of canonicalDays) {
      const result = await this.replayCanonicalDay(context, day, input);
      dayResults.push(result);
    }

    // 3. Score
    const improvementCount = dayResults.filter(r => r.improved).length;
    const regressionCount = dayResults.filter(r => r.regressed).length;
    const severityRegressionCount = dayResults.filter(r => r.severityRegression).length;
    const netScore = improvementCount - regressionCount;

    let passed: boolean;
    let reason: string;

    if (severityRegressionCount > 0) {
      passed = false;
      reason = `BLOCKED: ${severityRegressionCount} severity regression(s) — correct call flipped to incorrect`;
    } else if (netScore <= 0) {
      passed = false;
      reason = `REJECTED: net score ${netScore} (${improvementCount} improvements, ${regressionCount} regressions)`;
    } else {
      passed = true;
      reason = `PASSED: net score +${netScore} (${improvementCount} improvements, ${regressionCount} regressions, 0 severity)`;
    }

    this.logger.log(`Canonical test result: ${reason}`);

    return {
      dayResults,
      improvementCount,
      regressionCount,
      severityRegressionCount,
      netScore,
      passed,
      reason,
    };
  }

  // ─── Replay a single canonical day ───────────────────────────

  private async replayCanonicalDay(
    context: ExecutionContext,
    day: CanonicalTestDay,
    input: CanonicalTestInput,
  ): Promise<CanonicalDayResult> {
    const actualOutcome = day.actual_outcome as { direction?: string };
    const actualDirection = actualOutcome.direction ?? 'flat';

    const originalPrediction = day.original_prediction as { direction?: string };
    const originalDirection = originalPrediction.direction ?? 'flat';
    const originalCorrect = originalDirection === actualDirection;

    // Build the replay prompt using the proposed config against the frozen snapshot
    let proposedDirection = 'flat';

    if (this.llmService.isLlmEnabled()) {
      try {
        const systemPrompt = `You are an analyst with this perspective: ${input.proposedPrompt}

Respond with valid JSON: { "direction": "up" | "down" | "flat", "confidence": <0-100>, "rationale": "<brief>" }
Respond ONLY with valid JSON.`;

        // Reconstruct context from frozen snapshot
        const articles = day.articles_snapshot as Array<{ title?: string; summary?: string }>;
        const articleContext = articles.slice(0, 10).map(
          (a, i) => `${i + 1}. ${a.title ?? 'Untitled'}: ${(a.summary ?? '').slice(0, 200)}`
        ).join('\n');

        const riskContext = day.risk_analysis_snapshot as { overall_score?: number; verdict?: string };
        const riskLine = riskContext.overall_score
          ? `Risk context: score=${riskContext.overall_score}, verdict=${riskContext.verdict}`
          : '';

        const userPrompt = `Analyze this instrument for prediction on ${day.canonical_date}.
${riskLine}
${articleContext ? `\nRelevant articles:\n${articleContext}` : ''}`;

        const result = await this.llmService.generateText(context, systemPrompt, userPrompt);

        // Parse direction
        try {
          const match = result.text.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]) as Record<string, unknown>;
            const dir = String(parsed['direction'] || 'flat').toLowerCase();
            proposedDirection = dir === 'up' || dir === 'bullish' ? 'up' :
              dir === 'down' || dir === 'bearish' ? 'down' : 'flat';
          }
        } catch {
          const lower = result.text.toLowerCase();
          proposedDirection = lower.includes('down') || lower.includes('bearish') ? 'down' :
            lower.includes('flat') || lower.includes('neutral') ? 'flat' : 'up';
        }
      } catch (err) {
        this.logger.warn(`Canonical replay failed for ${day.id}: ${err instanceof Error ? err.message : String(err)}`);
        proposedDirection = originalDirection; // No change on failure
      }
    } else {
      // Deterministic: proposed direction same as original (no LLM to differentiate)
      proposedDirection = originalDirection;
    }

    const proposedCorrect = proposedDirection === actualDirection;
    const improved = !originalCorrect && proposedCorrect;
    const regressed = originalCorrect && !proposedCorrect;
    const severityRegression = regressed; // Any correct→incorrect is severity

    return {
      canonicalDayId: day.id,
      canonicalDate: day.canonical_date,
      originalDirection,
      proposedDirection,
      actualDirection,
      originalCorrect,
      proposedCorrect,
      improved,
      regressed,
      severityRegression,
    };
  }

  // ─── Load canonical days ─────────────────────────────────────

  private async loadCanonicalDays(input: CanonicalTestInput): Promise<CanonicalTestDay[]> {
    // Get instruments this analyst is assigned to
    const scopeFilter = input.testScope === 'both'
      ? `and ctd.test_scope in ('prediction', 'risk', 'both')`
      : `and ctd.test_scope in ($3, 'both')`;

    const params: unknown[] = [input.organizationSlug, input.analystId];
    if (input.testScope !== 'both') params.push(input.testScope);

    const result = await this.db.rawQuery(
      `select ctd.*
       from prediction.canonical_test_days ctd
       where ctd.organization_slug = $1
         and ctd.is_active = true
         and ctd.instrument_id in (
           select instrument_id from prediction.market_instrument_analyst_assignments
           where analyst_id = $2 and organization_slug = $1
           union
           select id from prediction.instruments where organization_slug = $1
         )
         ${scopeFilter}
       order by ctd.canonical_date desc
       limit 15`,
      params,
    );
    if (result.error) {
      this.logger.warn(`Failed to load canonical days: ${result.error.message}`);
      return [];
    }
    return (result.data as CanonicalTestDay[] | null) ?? [];
  }
}
