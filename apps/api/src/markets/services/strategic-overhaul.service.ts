/**
 * Tier 3 Strategic Overhaul Service.
 *
 * Aggregates Tier 2 audit evidence and performance data, generates strategic
 * contract rewrite proposals via LLM, validates them against canonical tests,
 * and persists them for admin review.
 *
 * Effort: tier3-strategic-overhauls.
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import { CanonicalTestRunnerService } from './canonical-test-runner.service';
import { MarketsLlmService } from './markets-llm.service';

// ─── Types ───────────────────────────────────────────────────────

export interface EvidenceDossier {
  acceptedFindingsCount: number;
  topPatterns: Array<{ pattern: string; count: number }>;
  calibrationDelta: number;
  overrideFrequency: number;
  findings: Array<{
    id: string;
    discrepancy: string;
    severity: string;
    created_at: string;
  }>;
}

export interface ThresholdConfig {
  minFindings: number;
  minCalibrationDegradation: number;
  minOverrideRate: number;
}

const DEFAULT_THRESHOLD: ThresholdConfig = {
  minFindings: 8,
  minCalibrationDegradation: 10,
  minOverrideRate: 0.3,
};

interface OverhaulCycleResult {
  analystsEvaluated: number;
  proposalsCreated: number;
  proposalsPassed: number;
  proposalsFailed: number;
  skippedBelowThreshold: number;
  skippedDuplicate: number;
}

// ─── Service ─────────────────────────────────────────────────────

@Injectable()
export class StrategicOverhaulService {
  private readonly logger = new Logger(StrategicOverhaulService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
    @Inject(CanonicalTestRunnerService) private readonly canonicalRunner: CanonicalTestRunnerService,
    @Inject(MarketsLlmService) private readonly llmService: MarketsLlmService,
  ) {}

  // ─── Evidence Aggregation ──────────────────────────────────────

  async aggregateEvidence(analystId: string, organizationSlug: string): Promise<EvidenceDossier> {
    await this.schema.ensureSchema();

    // 1. Accepted audit findings grouped by discrepancy pattern
    const findingsResult = await this.db.rawQuery(
      `SELECT id, discrepancy, severity, created_at
       FROM prediction.audit_findings
       WHERE analyst_id = $1
         AND organization_slug = $2
         AND status = 'accepted'
       ORDER BY created_at DESC`,
      [analystId, organizationSlug],
    );
    if (findingsResult.error) throw new Error(findingsResult.error.message);
    const findings = (findingsResult.data as Array<{
      id: string; discrepancy: string; severity: string; created_at: string;
    }> | null) ?? [];

    // Extract top patterns by grouping similar discrepancies
    const patternCounts = new Map<string, number>();
    for (const f of findings) {
      // Use first 80 chars of discrepancy as pattern key
      const key = f.discrepancy.slice(0, 80).trim();
      patternCounts.set(key, (patternCounts.get(key) ?? 0) + 1);
    }
    const topPatterns = [...patternCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pattern, count]) => ({ pattern, count }));

    // 2. Calibration trend: compare 30d vs all-time calibration score
    const calibResult = await this.db.rawQuery(
      `SELECT period, calibration_score
       FROM prediction.analyst_performance_profiles
       WHERE analyst_id = $1
         AND organization_slug = $2
         AND period IN ('30d', 'all')
       ORDER BY computed_at DESC`,
      [analystId, organizationSlug],
    );
    if (calibResult.error) throw new Error(calibResult.error.message);
    const calibRows = (calibResult.data as Array<{
      period: string; calibration_score: number | null;
    }> | null) ?? [];

    const thirtyDayCalib = calibRows.find(r => r.period === '30d')?.calibration_score ?? null;
    const allTimeCalib = calibRows.find(r => r.period === 'all')?.calibration_score ?? null;

    // Degradation = all-time minus 30d (positive means degraded)
    let calibrationDelta = 0;
    if (thirtyDayCalib !== null && allTimeCalib !== null && allTimeCalib > 0) {
      calibrationDelta = ((allTimeCalib - thirtyDayCalib) / allTimeCalib) * 100;
    }

    // 3. Arbitrator override frequency from risk debates
    const debateResult = await this.db.rawQuery(
      `SELECT count(*) as total,
              count(*) filter (where abs(score_adjustment) >= 10) as overrides
       FROM prediction.risk_debates
       WHERE organization_slug = $1
         AND status = 'completed'
         AND created_at >= now() - interval '30 days'`,
      [organizationSlug],
    );
    if (debateResult.error) throw new Error(debateResult.error.message);
    const debateRow = ((debateResult.data as Array<{ total: string; overrides: string }> | null) ?? [])[0];
    const totalDebates = Number(debateRow?.total ?? 0);
    const overrideCount = Number(debateRow?.overrides ?? 0);
    const overrideFrequency = totalDebates > 0 ? overrideCount / totalDebates : 0;

    return {
      acceptedFindingsCount: findings.length,
      topPatterns,
      calibrationDelta,
      overrideFrequency,
      findings: findings.slice(0, 20), // Cap at 20 for prompt size
    };
  }

  // ─── Threshold Gating ─────────────────────────────────────────

  meetsThreshold(dossier: EvidenceDossier, config: ThresholdConfig = DEFAULT_THRESHOLD): boolean {
    if (dossier.acceptedFindingsCount < config.minFindings) return false;
    const hasCalibrationDegradation = dossier.calibrationDelta >= config.minCalibrationDegradation;
    const hasHighOverrideRate = dossier.overrideFrequency >= config.minOverrideRate;
    return hasCalibrationDegradation || hasHighOverrideRate;
  }

  // ─── Proposal Generation ──────────────────────────────────────

  async generateProposal(
    analystId: string,
    organizationSlug: string,
    evidence: EvidenceDossier,
  ): Promise<{ proposedContextMarkdown: string; rationale: string }> {
    // Load current active config
    const configResult = await this.db.rawQuery(
      `SELECT id, context_markdown, version_number
       FROM prediction.analyst_config_versions
       WHERE analyst_id = $1
         AND organization_slug = $2
         AND is_active = true
       ORDER BY version_number DESC
       LIMIT 1`,
      [analystId, organizationSlug],
    );
    if (configResult.error) throw new Error(configResult.error.message);
    const configRows = (configResult.data as Array<{
      id: string; context_markdown: string; version_number: number;
    }> | null) ?? [];
    if (configRows.length === 0) throw new Error(`No active config for analyst ${analystId}`);
    const currentConfig = configRows[0];

    const findingsSummary = evidence.findings
      .map(f => `- [${f.severity}] ${f.discrepancy}`)
      .join('\n');

    const patternsSummary = evidence.topPatterns
      .map(p => `- "${p.pattern}" (${p.count} occurrences)`)
      .join('\n');

    const systemPrompt = `You are a senior analyst contract designer. Your task is to propose a strategic rewrite of an analyst's contract based on accumulated audit evidence.

INSTRUCTIONS:
1. Analyze the evidence to identify the root causes of the analyst's issues.
2. Propose specific changes to the contract that address these root causes.
3. Preserve the analyst's core identity and strengths — modify, don't replace.
4. Be concrete: rewrite the specific sections that need to change.

OUTPUT FORMAT — respond with exactly two sections separated by "---RATIONALE---":

[The complete proposed context_markdown with your changes applied]

---RATIONALE---

[A clear, human-readable explanation of what you changed and why, referencing specific evidence]`;

    const userPrompt = `CURRENT CONTRACT:
${currentConfig.context_markdown}

EVIDENCE DOSSIER:
- Total accepted audit findings: ${evidence.acceptedFindingsCount}
- Calibration degradation (30d vs all-time): ${evidence.calibrationDelta.toFixed(1)}%
- Arbitrator override frequency (30d): ${(evidence.overrideFrequency * 100).toFixed(1)}%

TOP RECURRING PATTERNS:
${patternsSummary}

RECENT FINDINGS:
${findingsSummary}`;

    const context = this.llmService.buildExecutionContext(organizationSlug, 'system', 'prediction');
    const result = await this.llmService.generateText(context, systemPrompt, userPrompt);

    const parts = result.text.split('---RATIONALE---');
    const proposedContextMarkdown = (parts[0] ?? '').trim();
    const rationale = (parts[1] ?? 'No rationale provided').trim();

    return { proposedContextMarkdown, rationale };
  }

  // ─── Canonical Testing & Persistence ──────────────────────────

  async testAndPersistProposal(
    analystId: string,
    organizationSlug: string,
    evidence: EvidenceDossier,
    proposedMarkdown: string,
    currentMarkdown: string,
    rationale: string,
  ): Promise<{ proposalId: string; status: string; passed: boolean }> {
    // Run canonical tests
    const testResult = await this.canonicalRunner.runCanonicalTests({
      analystId,
      organizationSlug,
      proposedPrompt: proposedMarkdown,
      proposedWeight: 1.0,
      proposedTierInstructions: {},
      testScope: 'prediction',
    });

    const status = testResult.passed ? 'passed' : 'failed';
    const proposalId = randomUUID();

    await this.db.rawQuery(
      `INSERT INTO prediction.learning_proposals (
        id, organization_slug, tier, analyst_id, proposal_type,
        description, rationale, proposed_change,
        canonical_test_results, net_score, has_severity_regression,
        status, proposed_at,
        evidence_summary, proposed_context_markdown, current_context_markdown
      ) VALUES (
        $1, $2, 3, $3, 'strategic_rewrite',
        $4, $5, $6,
        $7, $8, $9,
        $10, now(),
        $11, $12, $13
      )`,
      [
        proposalId,
        organizationSlug,
        analystId,
        `Tier 3 strategic rewrite based on ${evidence.acceptedFindingsCount} accepted findings`,
        rationale,
        JSON.stringify({ type: 'context_markdown_rewrite' }),
        JSON.stringify(testResult),
        testResult.netScore,
        testResult.severityRegressionCount > 0,
        status,
        JSON.stringify(evidence),
        proposedMarkdown,
        currentMarkdown,
      ],
    );

    return { proposalId, status, passed: testResult.passed };
  }

  // ─── Full Cycle ───────────────────────────────────────────────

  @Cron(process.env.TIER3_CRON || '0 2 * * 0')
  async runStrategicOverhaulCycle(): Promise<OverhaulCycleResult> {
    if (process.env.MARKETS_ENABLE_LLM !== 'true') {
      this.logger.log('Tier 3 skipped — MARKETS_ENABLE_LLM is not true');
      return { analystsEvaluated: 0, proposalsCreated: 0, proposalsPassed: 0, proposalsFailed: 0, skippedBelowThreshold: 0, skippedDuplicate: 0 };
    }

    await this.schema.ensureSchema();
    this.logger.log('Starting Tier 3 strategic overhaul cycle');

    const result: OverhaulCycleResult = {
      analystsEvaluated: 0,
      proposalsCreated: 0,
      proposalsPassed: 0,
      proposalsFailed: 0,
      skippedBelowThreshold: 0,
      skippedDuplicate: 0,
    };

    // Get all analysts
    const analystResult = await this.db.rawQuery(
      `SELECT id, display_name, organization_slug
       FROM prediction.market_analysts
       WHERE is_active = true AND learning_enabled = true`,
    );
    if (analystResult.error) throw new Error(analystResult.error.message);
    const analysts = (analystResult.data as Array<{
      id: string; display_name: string; organization_slug: string;
    }> | null) ?? [];

    for (const analyst of analysts) {
      result.analystsEvaluated++;

      try {
        // Check for existing pending proposal (deduplication)
        const dupCheck = await this.db.rawQuery(
          `SELECT id FROM prediction.learning_proposals
           WHERE tier = 3 AND analyst_id = $1 AND organization_slug = $2
             AND status IN ('proposed', 'passed', 'testing')
           LIMIT 1`,
          [analyst.id, analyst.organization_slug],
        );
        if (dupCheck.error) throw new Error(dupCheck.error.message);
        if (((dupCheck.data as unknown[] | null) ?? []).length > 0) {
          this.logger.log(`Skipping ${analyst.display_name} — pending Tier 3 proposal exists`);
          result.skippedDuplicate++;
          continue;
        }

        // Aggregate evidence
        const evidence = await this.aggregateEvidence(analyst.id, analyst.organization_slug);

        // Check threshold
        if (!this.meetsThreshold(evidence)) {
          this.logger.log(`Skipping ${analyst.display_name} — below evidence threshold (findings: ${evidence.acceptedFindingsCount}, calibDelta: ${evidence.calibrationDelta.toFixed(1)}%, override: ${(evidence.overrideFrequency * 100).toFixed(1)}%)`);
          result.skippedBelowThreshold++;
          continue;
        }

        this.logger.log(`Generating Tier 3 proposal for ${analyst.display_name}`);

        // Generate proposal via LLM
        const { proposedContextMarkdown, rationale } = await this.generateProposal(
          analyst.id,
          analyst.organization_slug,
          evidence,
        );

        // Get current markdown for snapshot
        const currentConfigResult = await this.db.rawQuery(
          `SELECT context_markdown FROM prediction.analyst_config_versions
           WHERE analyst_id = $1 AND organization_slug = $2 AND is_active = true
           ORDER BY version_number DESC LIMIT 1`,
          [analyst.id, analyst.organization_slug],
        );
        const currentMarkdown = ((currentConfigResult.data as Array<{ context_markdown: string }> | null) ?? [])[0]?.context_markdown ?? '';

        // Test and persist
        const proposalResult = await this.testAndPersistProposal(
          analyst.id,
          analyst.organization_slug,
          evidence,
          proposedContextMarkdown,
          currentMarkdown,
          rationale,
        );

        result.proposalsCreated++;
        if (proposalResult.passed) {
          result.proposalsPassed++;
        } else {
          result.proposalsFailed++;
        }

        this.logger.log(`Tier 3 proposal for ${analyst.display_name}: ${proposalResult.status} (id: ${proposalResult.proposalId})`);
      } catch (err) {
        this.logger.error(`Tier 3 failed for ${analyst.display_name}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`Tier 3 cycle complete: ${JSON.stringify(result)}`);
    return result;
  }
}
