import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import { CanonicalTestRunnerService } from './canonical-test-runner.service';
import type { LearningProposal, AnalystPerformanceProfile } from '../markets.types';

interface LearningBoundaries {
  maxConfidenceShift: number;
  maxWeightShift: number;
  paperModeDurationDays: number;
}

const DEFAULT_BOUNDARIES: LearningBoundaries = {
  maxConfidenceShift: 15,
  maxWeightShift: 0.2,
  paperModeDurationDays: 3,
};

interface LearningCycleResult {
  analystsEvaluated: number;
  proposalsCreated: number;
  proposalsPassed: number;
  proposalsFailed: number;
  paperModeActivated: number;
  paperModePromoted: number;
  paperModeDemoted: number;
}

/**
 * Tier 1 Autonomous Learning Engine.
 *
 * Reads nightly evaluation results and performance profiles, identifies
 * systematic patterns (not one-off misses), proposes bounded micro-adjustments,
 * validates against canonical test days, and applies passing changes to paper mode.
 *
 * Also checks existing paper-mode configs for promotion/demotion.
 */
@Injectable()
export class LearningEngineService {
  private readonly logger = new Logger(LearningEngineService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
    @Inject(CanonicalTestRunnerService) private readonly canonicalRunner: CanonicalTestRunnerService,
  ) {}

  async runLearningCycle(): Promise<LearningCycleResult> {
    await this.schema.ensureSchema();
    this.logger.log('Starting Tier 1 learning cycle');

    let analystsEvaluated = 0;
    let proposalsCreated = 0;
    let proposalsPassed = 0;
    let proposalsFailed = 0;
    let paperModeActivated = 0;

    // 1. Get all learning-enabled analysts with recent performance data
    const analysts = await this.getLearningEnabledAnalysts();
    this.logger.log(`${analysts.length} learning-enabled analysts found`);

    for (const analyst of analysts) {
      analystsEvaluated++;

      // 2. Get performance profiles for this analyst
      const profiles = await this.getAnalystProfiles(analyst.id, analyst.organization_slug);
      if (profiles.length === 0) continue;

      // 3. Identify systematic patterns
      const patterns = this.identifyPatterns(profiles);
      if (patterns.length === 0) continue;

      // 4. For each pattern, propose a micro-adjustment
      const boundaries = await this.getBoundaries(analyst.organization_slug);

      for (const pattern of patterns) {
        const proposal = this.createProposal(analyst, pattern, boundaries);
        if (!proposal) continue;

        proposalsCreated++;

        // 5. Validate against canonical tests
        const testResult = await this.canonicalRunner.runCanonicalTests({
          analystId: analyst.id,
          organizationSlug: analyst.organization_slug,
          proposedPrompt: proposal.proposedPrompt,
          proposedWeight: proposal.proposedWeight,
          proposedTierInstructions: {},
          testScope: 'prediction',
        });

        // 6. Persist proposal with test results
        const status = testResult.passed ? 'passed' : 'failed';
        await this.persistProposal({
          organizationSlug: analyst.organization_slug,
          analystId: analyst.id,
          instrumentId: null,
          proposalType: pattern.type,
          description: proposal.description,
          rationale: pattern.rationale,
          proposedChange: {
            prompt_adjustment: proposal.promptAdjustment,
            weight_adjustment: proposal.weightAdjustment,
            proposed_prompt: proposal.proposedPrompt,
            proposed_weight: proposal.proposedWeight,
          },
          canonicalTestResults: testResult as unknown as Record<string, unknown>,
          netScore: testResult.netScore,
          hasSeverityRegression: testResult.severityRegressionCount > 0,
          status,
        });

        if (testResult.passed) {
          proposalsPassed++;
          // 7. Apply to paper mode
          await this.activatePaperMode(analyst.id, analyst.organization_slug, proposal);
          paperModeActivated++;
        } else {
          proposalsFailed++;
        }
      }
    }

    // 8. Check existing paper modes for promotion/demotion
    const { promoted, demoted } = await this.checkPaperModePromotions();

    const result: LearningCycleResult = {
      analystsEvaluated,
      proposalsCreated,
      proposalsPassed,
      proposalsFailed,
      paperModeActivated,
      paperModePromoted: promoted,
      paperModeDemoted: demoted,
    };

    // Persist report for dashboard
    await this.persistLearningReport(result);

    this.logger.log(
      `Learning cycle complete: ${analystsEvaluated} analysts, ${proposalsCreated} proposals (${proposalsPassed} passed), ${paperModeActivated} paper mode, ${promoted} promoted, ${demoted} demoted`,
    );

    return result;
  }

  // ─── Pattern Identification ──────────────────────────────────

  private identifyPatterns(profiles: AnalystPerformanceProfile[]): Array<{
    type: string;
    rationale: string;
    confidenceAdjustment: number;
    weightAdjustment: number;
    promptSuffix: string;
  }> {
    const patterns: Array<{
      type: string;
      rationale: string;
      confidenceAdjustment: number;
      weightAdjustment: number;
      promptSuffix: string;
    }> = [];

    for (const profile of profiles) {
      if (profile.sample_size < 5) continue; // Need enough data

      // Pattern: Overconfident — high avg confidence but low accuracy
      if (
        profile.avg_confidence !== null &&
        profile.accuracy_rate !== null &&
        profile.avg_confidence > 70 &&
        profile.accuracy_rate < 0.5
      ) {
        const shift = Math.min(15, Math.round((profile.avg_confidence - profile.accuracy_rate * 100) * 0.3));
        patterns.push({
          type: 'confidence_calibration',
          rationale: `Analyst averages ${profile.avg_confidence?.toFixed(0)}% confidence but only ${(profile.accuracy_rate * 100).toFixed(0)}% accuracy at ${profile.horizon_window}d horizon. Reducing confidence emphasis.`,
          confidenceAdjustment: -shift,
          weightAdjustment: 0,
          promptSuffix: `\n\nIMPORTANT: Recent analysis shows your confidence levels tend to be too high. Be more conservative with confidence scores — only rate above 70% when evidence is very strong.`,
        });
      }

      // Pattern: Underconfident — low confidence but high accuracy
      if (
        profile.avg_confidence !== null &&
        profile.accuracy_rate !== null &&
        profile.avg_confidence < 50 &&
        profile.accuracy_rate > 0.7
      ) {
        patterns.push({
          type: 'confidence_calibration',
          rationale: `Analyst averages ${profile.avg_confidence?.toFixed(0)}% confidence but ${(profile.accuracy_rate * 100).toFixed(0)}% accuracy. Increasing confidence levels.`,
          confidenceAdjustment: 10,
          weightAdjustment: 0,
          promptSuffix: `\n\nNote: Your recent track record shows strong accuracy. Trust your analysis more — your directional calls have been reliable.`,
        });
      }

      // Pattern: Directional bias
      const biases = profile.systematic_biases as { bullish_accuracy?: number; bearish_accuracy?: number } | null;
      if (biases) {
        const bullAcc = biases.bullish_accuracy;
        const bearAcc = biases.bearish_accuracy;
        if (bullAcc !== null && bullAcc !== undefined && bearAcc !== null && bearAcc !== undefined) {
          if (bullAcc < 0.35 && bearAcc > 0.6) {
            patterns.push({
              type: 'directional_bias',
              rationale: `Bullish calls only ${(bullAcc * 100).toFixed(0)}% accurate vs bearish at ${(bearAcc * 100).toFixed(0)}%. Analyst may be over-optimistic.`,
              confidenceAdjustment: 0,
              weightAdjustment: 0,
              promptSuffix: `\n\nCAUTION: Your recent bullish calls have been significantly less accurate than your bearish calls. Double-check your reasoning when leaning bullish — look for disconfirming evidence.`,
            });
          }
          if (bearAcc < 0.35 && bullAcc > 0.6) {
            patterns.push({
              type: 'directional_bias',
              rationale: `Bearish calls only ${(bearAcc * 100).toFixed(0)}% accurate vs bullish at ${(bullAcc * 100).toFixed(0)}%. Analyst may be over-pessimistic.`,
              confidenceAdjustment: 0,
              weightAdjustment: 0,
              promptSuffix: `\n\nCAUTION: Your recent bearish calls have been less accurate. When leaning bearish, verify the downside catalyst is concrete rather than speculative.`,
            });
          }
        }
      }
    }

    return patterns;
  }

  // ─── Proposal Creation ───────────────────────────────────────

  private createProposal(
    analyst: { id: string; persona_prompt: string; default_weight: number },
    pattern: { type: string; confidenceAdjustment: number; weightAdjustment: number; promptSuffix: string; rationale: string },
    boundaries: LearningBoundaries,
  ): { description: string; proposedPrompt: string; proposedWeight: number; promptAdjustment: string; weightAdjustment: number } | null {
    const clampedWeight = Math.min(
      boundaries.maxWeightShift,
      Math.max(-boundaries.maxWeightShift, pattern.weightAdjustment),
    );
    const proposedWeight = Math.min(2.0, Math.max(0.1, analyst.default_weight + clampedWeight));
    const proposedPrompt = analyst.persona_prompt + pattern.promptSuffix;

    return {
      description: `${pattern.type}: ${pattern.rationale.slice(0, 200)}`,
      proposedPrompt,
      proposedWeight,
      promptAdjustment: pattern.promptSuffix,
      weightAdjustment: clampedWeight,
    };
  }

  // ─── Paper Mode ──────────────────────────────────────────────

  private async activatePaperMode(
    analystId: string,
    organizationSlug: string,
    proposal: { proposedPrompt: string; proposedWeight: number },
  ): Promise<void> {
    // Create a new config version marked as paper
    const versionId = randomUUID();
    await this.db.rawQuery(
      // context_markdown carry-forward: inherit from the most recent version
      // that has a contract, so Tier 1 cycles never drop the structured document.
      // Effort: analyst-contracts.
      `insert into prediction.analyst_config_versions
        (id, analyst_id, organization_slug, version_number, persona_prompt,
         default_weight, context_markdown,
         source, change_reason, is_active, created_by, created_at)
       values ($1, $2, $3,
         coalesce((select max(version_number) + 1 from prediction.analyst_config_versions where analyst_id = $2), 1),
         $4, $5,
         (select context_markdown from prediction.analyst_config_versions
          where analyst_id = $2 and context_markdown is not null
          order by version_number desc limit 1),
         'tier1_auto', 'Tier 1 autonomous learning', false, 'learning-engine', $6)`,
      [versionId, analystId, organizationSlug, proposal.proposedPrompt, proposal.proposedWeight, new Date().toISOString()],
    );

    // Set as paper config version (not active — runs alongside production)
    await this.db.rawQuery(
      `update prediction.market_analysts set paper_config_version_id = $1 where id = $2 and organization_slug = $3`,
      [versionId, analystId, organizationSlug],
    );
  }

  private async checkPaperModePromotions(): Promise<{ promoted: number; demoted: number }> {
    let promoted = 0;
    let demoted = 0;

    // Find analysts with active paper mode configs older than the paper mode duration
    const result = await this.db.rawQuery(`
      select ma.id, ma.organization_slug, ma.paper_config_version_id, ma.current_config_version_id,
             acv.created_at as paper_started_at, acv.persona_prompt, acv.default_weight
      from prediction.market_analysts ma
      join prediction.analyst_config_versions acv on acv.id = ma.paper_config_version_id
      where ma.paper_config_version_id is not null
        and acv.created_at <= now() - interval '3 days'
    `);
    const candidates = (result.data as Array<{
      id: string; organization_slug: string;
      paper_config_version_id: string; current_config_version_id: string | null;
      persona_prompt: string; default_weight: number;
    }> | null) ?? [];

    for (const c of candidates) {
      // Compare paper vs production accuracy over the paper period
      const comparison = await this.db.rawQuery(`
        select
          avg(case when phe.config_version_id = $1 and phe.was_correct then 1.0 else 0.0 end) as paper_accuracy,
          avg(case when phe.config_version_id = $2 and phe.was_correct then 1.0 else 0.0 end) as prod_accuracy,
          count(*) as sample_size
        from prediction.prediction_horizon_evaluations phe
        where phe.analyst_id = $3 and phe.organization_slug = $4
          and phe.created_at >= now() - interval '3 days'
      `, [c.paper_config_version_id, c.current_config_version_id, c.id, c.organization_slug]);

      const rows = (comparison.data as Array<{ paper_accuracy: number | null; prod_accuracy: number | null; sample_size: number }> | null) ?? [];
      if (rows.length === 0 || rows[0].sample_size < 3) {
        // Not enough data yet — skip
        continue;
      }

      const paperAcc = rows[0].paper_accuracy ?? 0;
      const prodAcc = rows[0].prod_accuracy ?? 0;

      if (paperAcc > prodAcc) {
        // Promote: swap paper to production
        await this.db.rawQuery(`
          update prediction.market_analysts
          set current_config_version_id = paper_config_version_id,
              paper_config_version_id = null,
              persona_prompt = $1,
              default_weight = $2,
              updated_at = now()
          where id = $3 and organization_slug = $4
        `, [c.persona_prompt, c.default_weight, c.id, c.organization_slug]);

        // Mark the version as active
        await this.db.rawQuery(
          `update prediction.analyst_config_versions set is_active = true where id = $1`,
          [c.paper_config_version_id],
        );
        if (c.current_config_version_id) {
          await this.db.rawQuery(
            `update prediction.analyst_config_versions set is_active = false where id = $1`,
            [c.current_config_version_id],
          );
        }

        promoted++;
        this.logger.log(`Promoted paper config for analyst ${c.id}: paper=${(paperAcc * 100).toFixed(0)}% > prod=${(prodAcc * 100).toFixed(0)}%`);
      } else {
        // Demote: discard paper config
        await this.db.rawQuery(
          `update prediction.market_analysts set paper_config_version_id = null where id = $1 and organization_slug = $2`,
          [c.id, c.organization_slug],
        );
        demoted++;
        this.logger.log(`Demoted paper config for analyst ${c.id}: paper=${(paperAcc * 100).toFixed(0)}% <= prod=${(prodAcc * 100).toFixed(0)}%`);
      }
    }

    return { promoted, demoted };
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private async getLearningEnabledAnalysts(): Promise<Array<{
    id: string; organization_slug: string; persona_prompt: string; default_weight: number;
  }>> {
    const result = await this.db.rawQuery(`
      select id, organization_slug, persona_prompt, default_weight
      from prediction.market_analysts
      where is_active = true and is_enabled = true and learning_enabled = true
        and analyst_type = 'personality'
      order by organization_slug, created_at
    `);
    return (result.data as Array<{ id: string; organization_slug: string; persona_prompt: string; default_weight: number }> | null) ?? [];
  }

  private async getAnalystProfiles(
    analystId: string,
    organizationSlug: string,
  ): Promise<AnalystPerformanceProfile[]> {
    const result = await this.db.rawQuery(
      `select * from prediction.analyst_performance_profiles
       where analyst_id = $1 and organization_slug = $2
       order by computed_at desc`,
      [analystId, organizationSlug],
    );
    return (result.data as AnalystPerformanceProfile[] | null) ?? [];
  }

  private async getBoundaries(organizationSlug: string): Promise<LearningBoundaries> {
    try {
      const result = await this.db.rawQuery(
        `select max_confidence_shift, max_weight_shift, paper_mode_duration_days
         from prediction.org_learning_config where organization_slug = $1`,
        [organizationSlug],
      );
      const rows = (result.data as Array<{
        max_confidence_shift: number; max_weight_shift: number; paper_mode_duration_days: number;
      }> | null) ?? [];
      if (rows.length > 0) {
        return {
          maxConfidenceShift: rows[0].max_confidence_shift,
          maxWeightShift: rows[0].max_weight_shift,
          paperModeDurationDays: rows[0].paper_mode_duration_days,
        };
      }
    } catch {
      // Fall through to defaults
    }
    return DEFAULT_BOUNDARIES;
  }

  private async persistLearningReport(result: LearningCycleResult): Promise<void> {
    try {
      await this.db.rawQuery(
        `insert into prediction.learning_reports (id, report_type, report_date, summary, created_at)
         values ($1, 'learning_cycle', current_date, $2, now())
         on conflict (report_type, report_date)
         do update set summary = excluded.summary, created_at = excluded.created_at`,
        [randomUUID(), JSON.stringify(result)],
      );
    } catch (err) {
      this.logger.warn(`Failed to persist learning report: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async persistProposal(input: {
    organizationSlug: string;
    analystId: string;
    instrumentId: string | null;
    proposalType: string;
    description: string;
    rationale: string;
    proposedChange: Record<string, unknown>;
    canonicalTestResults: Record<string, unknown>;
    netScore: number;
    hasSeverityRegression: boolean;
    status: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db.rawQuery(
      `insert into prediction.learning_proposals
        (id, organization_slug, tier, analyst_id, instrument_id, proposal_type,
         description, rationale, proposed_change, canonical_test_results,
         net_score, has_severity_regression, status, proposed_at, tested_at)
       values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        randomUUID(), input.organizationSlug, input.analystId, input.instrumentId,
        input.proposalType, input.description, input.rationale,
        JSON.stringify(input.proposedChange), JSON.stringify(input.canonicalTestResults),
        input.netScore, input.hasSeverityRegression, input.status, now, now,
      ],
    );
  }
}
