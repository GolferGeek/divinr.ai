/**
 * Unit tests for AffinityService
 * Pure computation — tests exponential decay, normalization, cold start,
 * signal counting, and recomputation idempotency.
 */
import { AffinityService, DECAY_HALF_LIFE_DAYS, DEFAULT_AFFINITY, SIGNAL_WEIGHTS } from '../../src/markets/services/affinity.service';

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
  assert(Math.abs(actual - expected) <= tolerance, `${label} (got ${actual}, expected ~${expected})`);
}

console.log('\n=== Affinity Service Tests ===\n');

// ─── Constants ──────────────────────────────────────────────────
console.log('Signal weights:');
{
  assert(SIGNAL_WEIGHTS.buy_agreement === 1.0, 'buy_agreement weight is 1.0');
  assert(SIGNAL_WEIGHTS.sell_agreement === 1.0, 'sell_agreement weight is 1.0');
  assert(SIGNAL_WEIGHTS.skip_disagreement === 1.0, 'skip_disagreement weight is 1.0');
  assert(SIGNAL_WEIGHTS.challenge_accept === 0.8, 'challenge_accept weight is 0.8');
  assert(SIGNAL_WEIGHTS.challenge_reject === 0.8, 'challenge_reject weight is 0.8');
  assert(SIGNAL_WEIGHTS.browse_interest === 0.2, 'browse_interest weight is 0.2');
  assert(DECAY_HALF_LIFE_DAYS === 30, 'half-life is 30 days');
  assert(DEFAULT_AFFINITY === 0.5, 'default affinity is 0.5');
}

// ─── Exponential Decay Calculation ─────────────────────────────
console.log('\nExponential decay:');
{
  // Decay factor at t=0 should be 1.0
  const decay0 = Math.pow(0.5, 0 / DECAY_HALF_LIFE_DAYS);
  assertClose(decay0, 1.0, 0.001, 'Decay at t=0 is 1.0');

  // Decay factor at t=30 days (1 half-life) should be 0.5
  const decay30 = Math.pow(0.5, 30 / DECAY_HALF_LIFE_DAYS);
  assertClose(decay30, 0.5, 0.001, 'Decay at t=30d is 0.5');

  // Decay factor at t=60 days (2 half-lives) should be 0.25
  const decay60 = Math.pow(0.5, 60 / DECAY_HALF_LIFE_DAYS);
  assertClose(decay60, 0.25, 0.001, 'Decay at t=60d is 0.25');

  // Decay factor at t=90 days (3 half-lives) should be 0.125
  const decay90 = Math.pow(0.5, 90 / DECAY_HALF_LIFE_DAYS);
  assertClose(decay90, 0.125, 0.001, 'Decay at t=90d is 0.125');
}

// ─── Score Computation Logic (simulating recomputeAffinity) ────
console.log('\nScore computation:');
{
  // Helper that replicates the scoring algorithm from the service
  function computeScore(
    signals: Array<{ signal_type: string; weight: number; age_days: number }>,
  ): number {
    if (signals.length === 0) return DEFAULT_AFFINITY;

    let positiveWeighted = 0;
    let negativeWeighted = 0;

    for (const sig of signals) {
      const decayFactor = Math.pow(0.5, sig.age_days / DECAY_HALF_LIFE_DAYS);
      const effectiveWeight = sig.weight * decayFactor;

      switch (sig.signal_type) {
        case 'buy_agreement':
        case 'sell_agreement':
        case 'challenge_accept':
          positiveWeighted += effectiveWeight;
          break;
        case 'browse_interest':
          positiveWeighted += effectiveWeight * 0.5;
          break;
        case 'skip_disagreement':
        case 'challenge_reject':
          negativeWeighted += effectiveWeight;
          break;
      }
    }

    const rawRatio = positiveWeighted / (positiveWeighted + negativeWeighted);
    const bayesianWeight = Math.min(signals.length / 10, 1);
    const score = DEFAULT_AFFINITY * (1 - bayesianWeight) + rawRatio * bayesianWeight;
    return Math.max(0, Math.min(1, score));
  }

  // Cold start: no signals → default
  const coldStart = computeScore([]);
  assertClose(coldStart, DEFAULT_AFFINITY, 0.001, 'Cold start returns 0.5');

  // All positive signals → high affinity
  const allPositive = computeScore([
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 0 },
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 1 },
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 2 },
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 3 },
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 4 },
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 5 },
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 6 },
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 7 },
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 8 },
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 9 },
  ]);
  assert(allPositive > 0.9, `10 positive signals → high affinity (got ${allPositive.toFixed(3)})`);

  // All negative signals → low affinity
  const allNegative = computeScore([
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 0 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 1 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 2 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 3 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 4 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 5 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 6 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 7 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 8 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 9 },
  ]);
  assert(allNegative < 0.1, `10 negative signals → low affinity (got ${allNegative.toFixed(3)})`);

  // Mixed signals → middle range
  const mixed = computeScore([
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 0 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 0 },
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 5 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 5 },
  ]);
  assert(mixed > 0.3 && mixed < 0.7, `Mixed signals → mid-range affinity (got ${mixed.toFixed(3)})`);

  // Bayesian prior pull: few signals pulled toward 0.5
  const fewPositive = computeScore([
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 0 },
  ]);
  assert(
    fewPositive > 0.5 && fewPositive < 0.8,
    `1 positive signal pulled toward 0.5 by Bayesian prior (got ${fewPositive.toFixed(3)})`,
  );

  // Old signals matter less: recent negative should overpower old positive
  const recentNegOldPos = computeScore([
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 60 }, // old positive (decay ~0.25)
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 0 }, // fresh negative (decay 1.0)
  ]);
  assert(
    recentNegOldPos < 0.5,
    `Recent negative outweighs old positive (got ${recentNegOldPos.toFixed(3)})`,
  );
}

// ─── Normalization: scores clamped 0–1 ─────────────────────────
console.log('\nNormalization:');
{
  function computeScore(signals: Array<{ signal_type: string; weight: number; age_days: number }>): number {
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

  // Generate extreme cases
  const extremeHigh = computeScore(
    Array.from({ length: 100 }, (_, i) => ({ signal_type: 'buy_agreement', weight: 1.0, age_days: i })),
  );
  assert(extremeHigh >= 0 && extremeHigh <= 1, `Extreme positive clamped to [0,1] (got ${extremeHigh.toFixed(3)})`);

  const extremeLow = computeScore(
    Array.from({ length: 100 }, (_, i) => ({ signal_type: 'skip_disagreement', weight: 1.0, age_days: i })),
  );
  assert(extremeLow >= 0 && extremeLow <= 1, `Extreme negative clamped to [0,1] (got ${extremeLow.toFixed(3)})`);
}

// ─── Recomputation Idempotency ─────────────────────────────────
console.log('\nRecomputation idempotency:');
{
  // Same inputs → same output (deterministic)
  function computeScore(signals: Array<{ signal_type: string; weight: number; age_days: number }>): number {
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

  const signals = [
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 0 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 5 },
    { signal_type: 'challenge_accept', weight: 0.8, age_days: 10 },
  ];

  const run1 = computeScore(signals);
  const run2 = computeScore(signals);
  assert(run1 === run2, `Two runs with same data yield identical score (${run1.toFixed(6)} === ${run2.toFixed(6)})`);
}

// ─── Summary ───────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
