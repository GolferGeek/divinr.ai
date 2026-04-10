/**
 * Unit tests for contrarian alert generation logic.
 * Tests alert threshold conditions, alert cap, and weighted consensus calculation.
 */
import { DEFAULT_AFFINITY } from '../../src/markets/services/affinity.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function assertClose(actual: number, expected: number, tolerance: number, label: string) {
  assert(Math.abs(actual - expected) <= tolerance, `${label} (got ${actual.toFixed(4)}, expected ~${expected})`);
}

console.log('\n=== Contrarian Alert Tests ===\n');

// ─── Weighted Consensus Calculation ────────────────────────────

type Prediction = { analyst_id: string; direction: 'up' | 'down' | 'flat'; confidence: number };
type AffinityMap = Map<string, number>;

function computeWeightedConsensus(
  preds: Prediction[],
  affinities: AffinityMap,
): { direction: 'up' | 'down' | 'flat'; score: number } {
  if (preds.length === 0) return { direction: 'flat', score: 0 };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const p of preds) {
    const affinity = affinities.get(p.analyst_id) ?? DEFAULT_AFFINITY;
    const dirValue = p.direction === 'up' ? 1 : p.direction === 'down' ? -1 : 0;
    weightedSum += dirValue * affinity * p.confidence;
    totalWeight += affinity * p.confidence;
  }

  const score = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const direction: 'up' | 'down' | 'flat' =
    score > 0.1 ? 'up' : score < -0.1 ? 'down' : 'flat';

  return { direction, score };
}

console.log('Weighted consensus:');
{
  const affinities = new Map<string, number>([
    ['a1', 0.9],  // high affinity, bullish
    ['a2', 0.8],  // high affinity, bullish
    ['a3', 0.3],  // low affinity, bearish
  ]);

  const preds: Prediction[] = [
    { analyst_id: 'a1', direction: 'up', confidence: 80 },
    { analyst_id: 'a2', direction: 'up', confidence: 75 },
    { analyst_id: 'a3', direction: 'down', confidence: 85 },
  ];

  const consensus = computeWeightedConsensus(preds, affinities);
  assert(consensus.direction === 'up', `Consensus is 'up' (high-affinity bulls outweigh low-affinity bear)`);
  assert(consensus.score > 0, `Positive score (${consensus.score.toFixed(3)})`);
}

console.log('\nConsensus with equal affinities:');
{
  const affinities = new Map<string, number>();  // all default 0.5

  const preds: Prediction[] = [
    { analyst_id: 'a1', direction: 'up', confidence: 80 },
    { analyst_id: 'a2', direction: 'down', confidence: 80 },
  ];

  const consensus = computeWeightedConsensus(preds, affinities);
  assert(consensus.direction === 'flat', `Equal and opposite → flat (score: ${consensus.score.toFixed(3)})`);
}

// ─── Alert Generation Thresholds ───────────────────────────────

interface AlertCandidate {
  analyst_id: string;
  direction: 'up' | 'down' | 'flat';
  confidence: number;
  affinity: number;
}

function shouldGenerateAlert(
  candidate: AlertCandidate,
  consensusDirection: 'up' | 'down' | 'flat',
): boolean {
  if (candidate.affinity >= 0.5) return false;       // not low enough affinity
  if (candidate.confidence < 80) return false;        // not confident enough
  if (candidate.direction === consensusDirection) return false; // agrees
  if (candidate.direction === 'flat') return false;   // no strong opinion
  return true;
}

console.log('\nAlert thresholds:');
{
  // Low affinity, high confidence, disagrees → alert
  assert(
    shouldGenerateAlert(
      { analyst_id: 'a1', direction: 'down', confidence: 85, affinity: 0.3 },
      'up',
    ),
    'Low affinity (0.3) + high confidence (85) + disagrees → ALERT',
  );

  // Low affinity, low confidence, disagrees → NO alert
  assert(
    !shouldGenerateAlert(
      { analyst_id: 'a1', direction: 'down', confidence: 70, affinity: 0.3 },
      'up',
    ),
    'Low affinity (0.3) + low confidence (70) + disagrees → NO ALERT (confidence < 80)',
  );

  // High affinity, high confidence, disagrees → NO alert
  assert(
    !shouldGenerateAlert(
      { analyst_id: 'a1', direction: 'down', confidence: 85, affinity: 0.8 },
      'up',
    ),
    'High affinity (0.8) + high confidence (85) + disagrees → NO ALERT (affinity >= 0.5)',
  );

  // Low affinity, high confidence, agrees → NO alert
  assert(
    !shouldGenerateAlert(
      { analyst_id: 'a1', direction: 'up', confidence: 85, affinity: 0.3 },
      'up',
    ),
    'Low affinity (0.3) + high confidence (85) + agrees → NO ALERT (same direction)',
  );

  // Edge case: affinity exactly 0.5 → NO alert
  assert(
    !shouldGenerateAlert(
      { analyst_id: 'a1', direction: 'down', confidence: 85, affinity: 0.5 },
      'up',
    ),
    'Affinity exactly 0.5 → NO ALERT (threshold is < 0.5)',
  );

  // Edge case: confidence exactly 80 → alert
  assert(
    shouldGenerateAlert(
      { analyst_id: 'a1', direction: 'down', confidence: 80, affinity: 0.3 },
      'up',
    ),
    'Confidence exactly 80 → ALERT (threshold is >= 80)',
  );

  // Flat direction → NO alert
  assert(
    !shouldGenerateAlert(
      { analyst_id: 'a1', direction: 'flat', confidence: 90, affinity: 0.1 },
      'up',
    ),
    'Flat direction → NO ALERT even with low affinity and high confidence',
  );
}

// ─── Alert Cap ─────────────────────────────────────────────────
console.log('\nAlert cap (max 3 unread):');
{
  function alertsToGenerate(existingUnread: number, candidates: AlertCandidate[], consensusDir: 'up' | 'down' | 'flat'): number {
    if (existingUnread >= 3) return 0;
    const maxNew = 3 - existingUnread;
    let count = 0;
    for (const c of candidates) {
      if (count >= maxNew) break;
      if (shouldGenerateAlert(c, consensusDir)) count++;
    }
    return count;
  }

  // 0 existing, 4 qualifying → 3 created
  const result1 = alertsToGenerate(0, [
    { analyst_id: 'a1', direction: 'down', confidence: 85, affinity: 0.2 },
    { analyst_id: 'a2', direction: 'down', confidence: 90, affinity: 0.3 },
    { analyst_id: 'a3', direction: 'down', confidence: 80, affinity: 0.1 },
    { analyst_id: 'a4', direction: 'down', confidence: 82, affinity: 0.4 },
  ], 'up');
  assert(result1 === 3, `0 existing + 4 qualifying → 3 created (got ${result1})`);

  // 2 existing, 3 qualifying → 1 created
  const result2 = alertsToGenerate(2, [
    { analyst_id: 'a1', direction: 'down', confidence: 85, affinity: 0.2 },
    { analyst_id: 'a2', direction: 'down', confidence: 90, affinity: 0.3 },
    { analyst_id: 'a3', direction: 'down', confidence: 80, affinity: 0.1 },
  ], 'up');
  assert(result2 === 1, `2 existing + 3 qualifying → 1 created (got ${result2})`);

  // 3 existing → 0 created
  const result3 = alertsToGenerate(3, [
    { analyst_id: 'a1', direction: 'down', confidence: 85, affinity: 0.2 },
  ], 'up');
  assert(result3 === 0, `3 existing → 0 created (got ${result3})`);
}

// ─── Summary ───────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
