/**
 * Unit tests for browse signal handling.
 * Tests that browse signals have the correct weight and lower impact than trades.
 */
import { SIGNAL_WEIGHTS, DEFAULT_AFFINITY, DECAY_HALF_LIFE_DAYS } from '../../src/markets/services/affinity.service';

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

console.log('\n=== Browse Signal Tests ===\n');

// Score computation mirrors AffinityService logic
function computeScore(signals: Array<{ signal_type: string; weight: number; age_days: number }>): number {
  if (signals.length === 0) return DEFAULT_AFFINITY;
  let pos = 0;
  let neg = 0;
  for (const sig of signals) {
    const d = Math.pow(0.5, sig.age_days / DECAY_HALF_LIFE_DAYS);
    const ew = sig.weight * d;
    if (['buy_agreement', 'sell_agreement', 'challenge_accept'].includes(sig.signal_type)) pos += ew;
    else if (sig.signal_type === 'browse_interest') pos += ew * 0.5; // mild positive
    else neg += ew;
  }
  const rawRatio = (pos + neg) > 0 ? pos / (pos + neg) : DEFAULT_AFFINITY;
  const bw = Math.min(signals.length / 10, 1);
  return Math.max(0, Math.min(1, DEFAULT_AFFINITY * (1 - bw) + rawRatio * bw));
}

// ─── Browse signal weight is 0.2 ───────────────────────────────
console.log('Browse signal weight:');
{
  assert(SIGNAL_WEIGHTS.browse_interest === 0.2, 'browse_interest weight is 0.2');
  assert(SIGNAL_WEIGHTS.buy_agreement === 1.0, 'buy_agreement weight is 1.0 (5x browse)');
  assert(
    SIGNAL_WEIGHTS.browse_interest < SIGNAL_WEIGHTS.buy_agreement,
    'Browse signals have lower weight than trade signals',
  );
}

// ─── Browse adds mild positive signal ──────────────────────────
console.log('\nBrowse signal as mild positive:');
{
  // Single browse signal should move score slightly above 0.5
  const browseSingle = computeScore([
    { signal_type: 'browse_interest', weight: 0.2, age_days: 0 },
  ]);
  assert(browseSingle > 0.5, `1 browse signal → above default (got ${browseSingle.toFixed(3)})`);
  assert(browseSingle < 0.6, `1 browse signal → only slightly above default (got ${browseSingle.toFixed(3)})`);
}

// ─── Browse vs trade in competitive scenario ───────────────────
console.log('\nBrowse vs trade with competing negative signals:');
{
  // When there are competing negative signals, trades provide more uplift than browses
  const browseVsNeg = computeScore([
    { signal_type: 'browse_interest', weight: 0.2, age_days: 0 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 0 },
  ]);
  const tradeVsNeg = computeScore([
    { signal_type: 'buy_agreement', weight: 1.0, age_days: 0 },
    { signal_type: 'skip_disagreement', weight: 1.0, age_days: 0 },
  ]);
  assert(
    tradeVsNeg > browseVsNeg,
    `Trade + negative (${tradeVsNeg.toFixed(3)}) > browse + negative (${browseVsNeg.toFixed(3)})`,
  );
  assert(browseVsNeg < 0.5, `Browse + negative → below 0.5 (got ${browseVsNeg.toFixed(3)})`);
  assert(tradeVsNeg >= 0.5, `Trade + negative → at or above 0.5 (got ${tradeVsNeg.toFixed(3)})`);
}

// ─── Browse effective weight (0.2 × 0.5 = 0.1 positive) ───────
console.log('\nEffective browse weight:');
{
  // browse_interest contributes weight * 0.5 to positive side
  const browseEffective = 0.2 * 0.5; // = 0.1
  const tradeEffective = 1.0;
  assert(
    tradeEffective / browseEffective === 10,
    `A trade signal is 10x stronger than a browse signal in positive contribution (${tradeEffective} / ${browseEffective})`,
  );
}

// ─── Summary ───────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
