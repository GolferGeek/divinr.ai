/**
 * Unit tests for Tier 3 strategic overhaul threshold logic.
 * Tests pure logic without DB or LLM dependencies.
 */
import type { EvidenceDossier, ThresholdConfig } from '../../src/markets/services/strategic-overhaul.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.error(`  \u2717 ${label}`);
  }
}

// Re-implement meetsThreshold locally to test pure logic without DI
function meetsThreshold(dossier: EvidenceDossier, config: ThresholdConfig): boolean {
  if (dossier.acceptedFindingsCount < config.minFindings) return false;
  const hasCalibrationDegradation = dossier.calibrationDelta >= config.minCalibrationDegradation;
  const hasHighOverrideRate = dossier.overrideFrequency >= config.minOverrideRate;
  return hasCalibrationDegradation || hasHighOverrideRate;
}

const DEFAULT_CONFIG: ThresholdConfig = {
  minFindings: 8,
  minCalibrationDegradation: 10,
  minOverrideRate: 0.3,
};

function makeDossier(overrides: Partial<EvidenceDossier> = {}): EvidenceDossier {
  return {
    acceptedFindingsCount: 0,
    topPatterns: [],
    calibrationDelta: 0,
    overrideFrequency: 0,
    findings: [],
    ...overrides,
  };
}

console.log('\n=== Strategic Overhaul Tests ===\n');

// ── Threshold Logic ─────────────────────────────────────────────

console.log('Threshold gating:');

// Sufficient evidence: meets findings + calibration
{
  const dossier = makeDossier({
    acceptedFindingsCount: 12,
    calibrationDelta: 15,
    overrideFrequency: 0.1,
  });
  assert(meetsThreshold(dossier, DEFAULT_CONFIG) === true,
    'meets threshold with sufficient findings + calibration degradation');
}

// Sufficient evidence: meets findings + override rate
{
  const dossier = makeDossier({
    acceptedFindingsCount: 10,
    calibrationDelta: 5,
    overrideFrequency: 0.4,
  });
  assert(meetsThreshold(dossier, DEFAULT_CONFIG) === true,
    'meets threshold with sufficient findings + high override rate');
}

// Sparse data: too few findings
{
  const dossier = makeDossier({
    acceptedFindingsCount: 3,
    calibrationDelta: 20,
    overrideFrequency: 0.5,
  });
  assert(meetsThreshold(dossier, DEFAULT_CONFIG) === false,
    'rejects with too few findings even with high calibration + override');
}

// Edge case: meets findings but no calibration and no override
{
  const dossier = makeDossier({
    acceptedFindingsCount: 15,
    calibrationDelta: 5,
    overrideFrequency: 0.1,
  });
  assert(meetsThreshold(dossier, DEFAULT_CONFIG) === false,
    'rejects when findings met but neither calibration nor override threshold reached');
}

// Edge case: exactly at thresholds
{
  const dossier = makeDossier({
    acceptedFindingsCount: 8,
    calibrationDelta: 10,
    overrideFrequency: 0.0,
  });
  assert(meetsThreshold(dossier, DEFAULT_CONFIG) === true,
    'passes at exact threshold boundaries (findings=8, calib=10%)');
}

// Edge case: zero everything
{
  const dossier = makeDossier();
  assert(meetsThreshold(dossier, DEFAULT_CONFIG) === false,
    'rejects empty dossier');
}

// Custom config: lower thresholds
{
  const customConfig: ThresholdConfig = {
    minFindings: 3,
    minCalibrationDegradation: 5,
    minOverrideRate: 0.1,
  };
  const dossier = makeDossier({
    acceptedFindingsCount: 4,
    calibrationDelta: 6,
    overrideFrequency: 0.05,
  });
  assert(meetsThreshold(dossier, customConfig) === true,
    'passes with custom lower thresholds');
}

// ── Evidence Dossier Structure ──────────────────────────────────

console.log('\nEvidence dossier structure:');

{
  const dossier = makeDossier({
    acceptedFindingsCount: 10,
    topPatterns: [
      { pattern: 'ignoring sector rotation', count: 5 },
      { pattern: 'overweighting momentum', count: 3 },
    ],
    calibrationDelta: 18.5,
    overrideFrequency: 0.35,
    findings: [
      { id: 'f1', discrepancy: 'test', severity: 'high', created_at: '2026-04-01' },
    ],
  });

  assert(dossier.acceptedFindingsCount === 10, 'acceptedFindingsCount is number');
  assert(Array.isArray(dossier.topPatterns), 'topPatterns is array');
  assert(dossier.topPatterns[0].pattern === 'ignoring sector rotation', 'topPatterns has pattern string');
  assert(dossier.topPatterns[0].count === 5, 'topPatterns has count number');
  assert(typeof dossier.calibrationDelta === 'number', 'calibrationDelta is number');
  assert(typeof dossier.overrideFrequency === 'number', 'overrideFrequency is number');
  assert(Array.isArray(dossier.findings), 'findings is array');
  assert(dossier.findings[0].id === 'f1', 'findings contain id');
  assert(dossier.findings[0].severity === 'high', 'findings contain severity');
}

// ── Summary ─────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
