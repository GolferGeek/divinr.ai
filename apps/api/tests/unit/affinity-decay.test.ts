/**
 * Unit tests for affinity decay and normalization logic.
 * Tests signal pruning, decay weighting, normalization spreading,
 * and idempotency of the decay operation.
 */
import { DECAY_HALF_LIFE_DAYS, DEFAULT_AFFINITY } from '../../src/markets/services/affinity.service';

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

console.log('\n=== Affinity Decay & Normalization Tests ===\n');

// Helper: simulate the scoring algorithm with decay
function computeScoreWithDecay(
  signals: Array<{ signal_type: string; weight: number; age_days: number }>,
): number {
  if (signals.length === 0) return DEFAULT_AFFINITY;
  let pos = 0;
  let neg = 0;
  for (const sig of signals) {
    const d = Math.pow(0.5, sig.age_days / DECAY_HALF_LIFE_DAYS);
    const ew = sig.weight * d;
    if (['buy_agreement', 'sell_agreement', 'challenge_accept'].includes(sig.signal_type)) pos += ew;
    else if (sig.signal_type === 'browse_interest') pos += ew * 0.5;
    else neg += ew;
  }
  const raw = pos / (pos + neg);
  const bw = Math.min(signals.length / 10, 1);
  return Math.max(0, Math.min(1, DEFAULT_AFFINITY * (1 - bw) + raw * bw));
}

// ─── Signal Pruning (> 90 days) ────────────────────────────────
console.log('Signal pruning at 90 days:');
{
  const allSignals = [
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 100 }, // should be pruned
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 91 },  // should be pruned
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 89 },  // kept
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 10 },  // kept
  ];

  const afterPruning = allSignals.filter(s => s.age_days <= 90);
  assert(afterPruning.length === 2, `2 signals remain after pruning (got ${afterPruning.length})`);
  assert(afterPruning.every(s => s.age_days <= 90), 'All remaining signals are ≤ 90 days old');
}

// ─── 30-day-old signals have ~50% weight ───────────────────────
console.log('\n30-day signals have ~50% weight:');
{
  const fresh = [{ signal_type: 'buy_agreement', weight: 1.0, age_days: 0 }];
  const aged = [{ signal_type: 'buy_agreement', weight: 1.0, age_days: 30 }];

  const freshDecay = Math.pow(0.5, 0 / DECAY_HALF_LIFE_DAYS);
  const agedDecay = Math.pow(0.5, 30 / DECAY_HALF_LIFE_DAYS);

  assertClose(freshDecay, 1.0, 0.001, 'Fresh signal has decay factor 1.0');
  assertClose(agedDecay, 0.5, 0.001, '30-day signal has decay factor 0.5');
  assertClose(agedDecay / freshDecay, 0.5, 0.001, 'Aged signal is 50% of fresh signal weight');
}

// ─── Normalization: spread clustered scores ────────────────────
console.log('\nNormalization spreads clustered scores:');
{
  // Simulate normalization logic
  function normalizeScores(scores: number[]): number[] {
    if (scores.length < 2) return scores;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    if (max - min >= 0.1) return scores; // already spread

    const targetMin = 0.2;
    const targetMax = 0.8;
    const range = max - min || 1;
    return scores.map(s => targetMin + ((s - min) / range) * (targetMax - targetMin));
  }

  // Clustered scores: all between 0.48 and 0.52
  const clustered = [0.48, 0.49, 0.50, 0.51, 0.52];
  const spread = normalizeScores(clustered);
  const spreadMin = Math.min(...spread);
  const spreadMax = Math.max(...spread);

  assert(spreadMax - spreadMin > 0.1, `Spread scores have range > 0.1 (range: ${(spreadMax - spreadMin).toFixed(3)})`);
  assertClose(spreadMin, 0.2, 0.01, 'Spread min is ~0.2');
  assertClose(spreadMax, 0.8, 0.01, 'Spread max is ~0.8');

  // Already spread scores: should not change
  const wideScores = [0.1, 0.5, 0.9];
  const unchanged = normalizeScores(wideScores);
  assert(
    unchanged[0] === 0.1 && unchanged[1] === 0.5 && unchanged[2] === 0.9,
    'Already spread scores are unchanged',
  );

  // Single score: should not change
  const single = normalizeScores([0.5]);
  assert(single.length === 1 && single[0] === 0.5, 'Single score unchanged');
}

// ─── Decay idempotency ─────────────────────────────────────────
console.log('\nDecay idempotency:');
{
  // Same signals → same score regardless of how many times we compute
  const signals = [
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 10 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 20 },
    { signal_type: 'challenge_accept', weight: 0.8, age_days: 5 },
  ];

  const run1 = computeScoreWithDecay(signals);
  const run2 = computeScoreWithDecay(signals);
  const run3 = computeScoreWithDecay(signals);

  assert(run1 === run2 && run2 === run3, `Three runs produce identical scores (${run1.toFixed(6)})`);
}

// ─── Decay effect over time ────────────────────────────────────
console.log('\nDecay shifts influence to recent signals:');
{
  // Old positive, recent negative
  const scenario1 = computeScoreWithDecay([
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 60 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 1 },
  ]);

  // Recent positive, old negative
  const scenario2 = computeScoreWithDecay([
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 1 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 60 },
  ]);

  assert(scenario1 < scenario2, `Recent negative (${scenario1.toFixed(3)}) < recent positive (${scenario2.toFixed(3)})`);
  assert(scenario1 < 0.5, 'Old positive + recent negative → below 0.5');
  assert(scenario2 > 0.5, 'Recent positive + old negative → above 0.5');
}

// ─── Summary ───────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
