/**
 * Unit tests for TradeRecommendationService
 * Pure computation — no DB or LLM dependencies.
 *
 * Phase 6: Portfolio Manager. Tests cover:
 *   - Direction → action mapping
 *   - Calibration-adjusted probability
 *   - Kelly fraction math
 *   - Risk + consensus adjustment
 *   - Sane bounds clamping
 *   - End-to-end recommendation: BUY, SELL, HOLD scenarios
 *   - Stop-loss / take-profit calculations
 *   - Quantity calculation
 */
import { TradeRecommendationService } from '../../src/markets/services/trade-recommendation.service';

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

// Build a service instance with stubbed deps — none of the pure methods touch them
const stubDb = { rawQuery: async () => ({ data: null, error: null }) } as any;
const stubSchema = { ensureSchema: async () => undefined } as any;
const service = new TradeRecommendationService(stubDb, stubSchema);

console.log('\n=== Trade Recommendation Tests ===\n');

// ─── directionToAction ──────────────────────────────────────────
console.log('directionToAction:');
{
  assert(TradeRecommendationService.directionToAction('up') === 'buy', 'up → buy');
  assert(TradeRecommendationService.directionToAction('down') === 'sell', 'down → sell');
  assert(TradeRecommendationService.directionToAction('flat') === 'hold', 'flat → hold');
}

// ─── calibrationAdjustedProbability ─────────────────────────────
console.log('\ncalibrationAdjustedProbability:');
{
  assertClose(
    TradeRecommendationService.calibrationAdjustedProbability(75, 0.85),
    0.6375,
    0.0001,
    '75% conf × 0.85 calibration = 0.6375',
  );
  assertClose(
    TradeRecommendationService.calibrationAdjustedProbability(100, 1.0),
    1.0,
    0.0001,
    '100% × 1.0 = 1.0',
  );
  assertClose(
    TradeRecommendationService.calibrationAdjustedProbability(50, 0.5),
    0.25,
    0.0001,
    '50% × 0.5 = 0.25',
  );
  // Out-of-bounds inputs are clamped
  assertClose(
    TradeRecommendationService.calibrationAdjustedProbability(150, 1.0),
    1.0,
    0.0001,
    '150% conf clamped to 1.0',
  );
  assertClose(
    TradeRecommendationService.calibrationAdjustedProbability(75, 1.5),
    0.75,
    0.0001,
    '1.5 calibration clamped to 1.0',
  );
}

// ─── kellyFraction ──────────────────────────────────────────────
console.log('\nkellyFraction (b=2 default):');
{
  // f* = (2p - (1-p)) / 2 = (3p - 1) / 2
  // p=0.5 → 0.25; p=0.6 → 0.4; p=0.7 → 0.55; p=0.33 → 0; p=0.25 → negative (clamped to 0)
  assertClose(TradeRecommendationService.kellyFraction(0.5), 0.25, 0.001, 'p=0.5 → 0.25');
  assertClose(TradeRecommendationService.kellyFraction(0.6), 0.4, 0.001, 'p=0.6 → 0.4');
  assertClose(TradeRecommendationService.kellyFraction(0.7), 0.55, 0.001, 'p=0.7 → 0.55');
  assertClose(TradeRecommendationService.kellyFraction(0.333334), 0, 0.001, 'p=0.333 → ~0');
  assertClose(TradeRecommendationService.kellyFraction(0.25), 0, 0.001, 'p=0.25 → 0 (clamped, would be negative)');
  assertClose(TradeRecommendationService.kellyFraction(0), 0, 0.001, 'p=0 → 0');
}
console.log('\nkellyFraction with custom b:');
{
  // b=3, p=0.5 → (3*0.5 - 0.5) / 3 = 1.0/3 ≈ 0.333
  assertClose(TradeRecommendationService.kellyFraction(0.5, 3), 0.333, 0.005, 'b=3, p=0.5 → 0.333');
}

// ─── adjustKellyForRiskAndConsensus ─────────────────────────────
console.log('\nadjustKellyForRiskAndConsensus:');
{
  // raw 0.10, no risk, full consensus → unchanged
  assertClose(
    TradeRecommendationService.adjustKellyForRiskAndConsensus(0.10, null, 1.0),
    0.10,
    0.001,
    'no risk + full consensus → 0.10',
  );
  // raw 0.10, risk=100 → 0.05 (halved)
  assertClose(
    TradeRecommendationService.adjustKellyForRiskAndConsensus(0.10, 100, 1.0),
    0.05,
    0.001,
    'risk=100 → halved to 0.05',
  );
  // raw 0.10, risk=50 → 0.075 (×0.75)
  assertClose(
    TradeRecommendationService.adjustKellyForRiskAndConsensus(0.10, 50, 1.0),
    0.075,
    0.001,
    'risk=50 → ×0.75 → 0.075',
  );
  // raw 0.10, weak consensus (0.4) → 0.05 (halved)
  assertClose(
    TradeRecommendationService.adjustKellyForRiskAndConsensus(0.10, null, 0.4),
    0.05,
    0.001,
    'consensus 0.4 < 0.6 → halved',
  );
  // strong consensus (0.6) → unchanged
  assertClose(
    TradeRecommendationService.adjustKellyForRiskAndConsensus(0.10, null, 0.6),
    0.10,
    0.001,
    'consensus 0.6 → unchanged',
  );
  // both penalties stack: risk=100 + weak consensus → 0.10 × 0.5 × 0.5 = 0.025
  assertClose(
    TradeRecommendationService.adjustKellyForRiskAndConsensus(0.10, 100, 0.3),
    0.025,
    0.001,
    'risk=100 + consensus 0.3 → 0.025 (both penalties)',
  );
}

// ─── clampPositionPercent ───────────────────────────────────────
console.log('\nclampPositionPercent (max 0.10):');
{
  assert(TradeRecommendationService.clampPositionPercent(0.05) === 0.05, '0.05 → 0.05');
  assert(TradeRecommendationService.clampPositionPercent(0.50) === 0.10, '0.50 capped to 0.10');
  assert(TradeRecommendationService.clampPositionPercent(-0.05) === 0, 'negative → 0');
  assert(TradeRecommendationService.clampPositionPercent(0) === 0, '0 → 0');
  assert(TradeRecommendationService.clampPositionPercent(0.10) === 0.10, '0.10 → 0.10 (boundary)');
}

// ─── computeStopLoss / computeTakeProfit ────────────────────────
console.log('\ncomputeStopLoss / computeTakeProfit:');
{
  // BUY @ $100 → stop $99, take $102
  assertClose(TradeRecommendationService.computeStopLoss(100, 'buy')!, 99, 0.01, 'buy stop = entry - 1%');
  assertClose(TradeRecommendationService.computeTakeProfit(100, 'buy')!, 102, 0.01, 'buy take = entry + 2%');
  // SELL @ $100 → stop $101, take $98
  assertClose(TradeRecommendationService.computeStopLoss(100, 'sell')!, 101, 0.01, 'sell stop = entry + 1%');
  assertClose(TradeRecommendationService.computeTakeProfit(100, 'sell')!, 98, 0.01, 'sell take = entry - 2%');
  // HOLD → null
  assert(TradeRecommendationService.computeStopLoss(100, 'hold') === null, 'hold → null stop');
  assert(TradeRecommendationService.computeTakeProfit(100, 'hold') === null, 'hold → null take');
  // Invalid entry → null
  assert(TradeRecommendationService.computeStopLoss(0, 'buy') === null, '0 entry → null');
  assert(TradeRecommendationService.computeStopLoss(-5, 'buy') === null, 'negative entry → null');
}

// ─── End-to-end: strong BUY recommendation ──────────────────────
console.log('\nEnd-to-end: strong BUY scenario:');
{
  const rec = service.computeRecommendation({
    arbitratorDirection: 'up',
    arbitratorConfidence: 80,           // 80% confidence
    compositeRiskScore: 30,             // low risk
    consensusBullishCount: 4,
    consensusBearishCount: 1,
    consensusTotal: 5,                  // 80% bullish — strong consensus
    portfolioBalance: 100000,
    entryPrice: 100,
    calibrationAccuracy: 0.85,
  });
  // adjP = 0.80 * 0.85 = 0.68
  // rawKelly = (3*0.68 - 1)/2 = 1.04/2 = 0.52
  // riskAdj = 0.52 * (1 - 30/200) = 0.52 * 0.85 = 0.442
  // alignment = 4/5 = 0.8 → no consensus penalty
  // clamped = min(0.10, 0.442) = 0.10
  assert(rec.action === 'buy', 'action = buy');
  assertClose(rec.calibrationAdjustedConfidence, 68, 0.5, 'cal-adj conf ≈ 68');
  assertClose(rec.kellyFractionRaw, 0.52, 0.01, 'raw Kelly ≈ 0.52');
  assertClose(rec.positionPercent, 0.10, 0.001, 'clamped to 0.10');
  // quantity = floor(100000 * 0.10 / 100) = 100
  assert(rec.quantity === 100, 'quantity = 100 shares');
  assertClose(rec.stopLoss!, 99, 0.01, 'stop = $99');
  assertClose(rec.takeProfit!, 102, 0.01, 'take = $102');
  assert(rec.rationale.length > 0, 'rationale non-empty');
}

// ─── End-to-end: SELL with high risk → reduced size ────────────
console.log('\nEnd-to-end: SELL with high risk:');
{
  const rec = service.computeRecommendation({
    arbitratorDirection: 'down',
    arbitratorConfidence: 70,
    compositeRiskScore: 80,             // high risk
    consensusBullishCount: 1,
    consensusBearishCount: 4,
    consensusTotal: 5,                  // 80% bearish — aligned with sell
    portfolioBalance: 100000,
    entryPrice: 50,
    calibrationAccuracy: 0.85,
  });
  // adjP = 0.7 * 0.85 = 0.595
  // rawKelly = (3*0.595 - 1)/2 = 0.7855/2 = 0.39275
  // riskAdj = 0.39275 * (1 - 80/200) = 0.39275 * 0.6 = 0.23565
  // alignment = 4/5 = 0.8 → no consensus penalty
  // clamped = min(0.10, 0.23565) = 0.10
  assert(rec.action === 'sell', 'action = sell');
  assertClose(rec.kellyFractionApplied, 0.236, 0.005, 'risk-adjusted Kelly ≈ 0.236');
  assertClose(rec.positionPercent, 0.10, 0.001, 'still capped at 0.10');
  // quantity = floor(100000 * 0.10 / 50) = 200
  assert(rec.quantity === 200, 'quantity = 200 shares');
  assertClose(rec.stopLoss!, 50.5, 0.01, 'sell stop = $50.50');
}

// ─── End-to-end: HOLD because Kelly below threshold ─────────────
console.log('\nEnd-to-end: HOLD (Kelly too low):');
{
  const rec = service.computeRecommendation({
    arbitratorDirection: 'up',
    arbitratorConfidence: 40,           // low confidence — Kelly negative
    compositeRiskScore: 50,
    consensusBullishCount: 2,
    consensusBearishCount: 3,
    consensusTotal: 5,
    portfolioBalance: 100000,
    entryPrice: 100,
    calibrationAccuracy: 0.85,
  });
  // adjP = 0.4 * 0.85 = 0.34, raw Kelly = (3*0.34 - 1)/2 = 0.02/2 = 0.01 (right at threshold)
  // After risk adj: 0.01 * 0.75 = 0.0075 → below MIN_KELLY_THRESHOLD
  // Plus alignment 2/5 = 0.4 < 0.6 → another halving
  assert(rec.action === 'hold', 'action = hold (Kelly below threshold)');
  assert(rec.positionPercent === 0, 'position = 0');
  assert(rec.quantity === 0, 'quantity = 0');
  assert(rec.stopLoss === null, 'no stop on hold');
}

// ─── End-to-end: HOLD because arbitrator flat ───────────────────
console.log('\nEnd-to-end: HOLD (arbitrator flat):');
{
  const rec = service.computeRecommendation({
    arbitratorDirection: 'flat',
    arbitratorConfidence: 90,           // even with high confidence, flat = hold
    compositeRiskScore: 20,
    consensusBullishCount: 2,
    consensusBearishCount: 2,
    consensusTotal: 5,
    portfolioBalance: 100000,
    entryPrice: 100,
    calibrationAccuracy: 0.95,
  });
  assert(rec.action === 'hold', 'flat direction → hold action');
  assert(rec.quantity === 0, 'quantity = 0');
}

// ─── End-to-end: BUY with weak consensus halves position ────────
console.log('\nEnd-to-end: BUY with weak consensus:');
{
  const rec = service.computeRecommendation({
    arbitratorDirection: 'up',
    arbitratorConfidence: 90,           // high arbitrator confidence
    compositeRiskScore: 20,             // low risk
    consensusBullishCount: 2,
    consensusBearishCount: 3,
    consensusTotal: 5,                  // ONLY 40% bullish — disagrees with arbitrator
    portfolioBalance: 100000,
    entryPrice: 100,
    calibrationAccuracy: 0.85,
  });
  // adjP = 0.9 * 0.85 = 0.765
  // rawKelly = (3*0.765 - 1)/2 = 1.295/2 = 0.6475
  // riskAdj first = 0.6475 * (1 - 20/200) = 0.6475 * 0.9 = 0.58275
  // Then consensus penalty: alignment = 2/5 = 0.4 < 0.6 → ×0.5 = 0.291
  // Clamped to 0.10
  assert(rec.action === 'buy', 'still buy despite weak consensus');
  assertClose(rec.kellyFractionApplied, 0.291, 0.01, 'consensus penalty applied');
  assertClose(rec.positionPercent, 0.10, 0.001, 'still hits cap');
}

// ─── Sane bounds: portfolio balance 0 ───────────────────────────
console.log('\nSane bounds:');
{
  const rec = service.computeRecommendation({
    arbitratorDirection: 'up',
    arbitratorConfidence: 90,
    compositeRiskScore: 0,
    consensusBullishCount: 5,
    consensusBearishCount: 0,
    consensusTotal: 5,
    portfolioBalance: 0,                // empty portfolio
    entryPrice: 100,
    calibrationAccuracy: 0.95,
  });
  assert(rec.quantity === 0, 'empty portfolio → 0 shares');
  // Action might still be BUY but quantity is 0 — that's a valid edge case
}
{
  const rec = service.computeRecommendation({
    arbitratorDirection: 'up',
    arbitratorConfidence: 90,
    compositeRiskScore: 0,
    consensusBullishCount: 5,
    consensusBearishCount: 0,
    consensusTotal: 5,
    portfolioBalance: 100000,
    entryPrice: 0,                      // missing price
    calibrationAccuracy: 0.95,
  });
  assert(rec.quantity === 0, 'zero entry price → 0 shares');
  assert(rec.stopLoss === null, 'zero entry → null stop');
}

// ─── Calibration drag: low calibration shrinks size ─────────────
console.log('\nLow calibration:');
{
  const recHigh = service.computeRecommendation({
    arbitratorDirection: 'up',
    arbitratorConfidence: 70,
    compositeRiskScore: 20,
    consensusBullishCount: 4,
    consensusBearishCount: 1,
    consensusTotal: 5,
    portfolioBalance: 100000,
    entryPrice: 100,
    calibrationAccuracy: 0.90,
  });
  const recLow = service.computeRecommendation({
    arbitratorDirection: 'up',
    arbitratorConfidence: 70,
    compositeRiskScore: 20,
    consensusBullishCount: 4,
    consensusBearishCount: 1,
    consensusTotal: 5,
    portfolioBalance: 100000,
    entryPrice: 100,
    calibrationAccuracy: 0.50,          // half the accuracy
  });
  assert(recLow.kellyFractionRaw < recHigh.kellyFractionRaw, 'lower calibration → smaller raw Kelly');
}

// ─── sizeForUser (per-user quantity computation) ────────────────
console.log('\nsizeForUser:');
{
  const baseRec = {
    id: 'pm_run1',
    run_id: 'run1',
    organization_slug: '__base__',
    instrument_id: 'inst1',
    symbol: 'MSFT',
    action: 'buy' as const,
    position_percent: 0.10,
    kelly_fraction_raw: 0.5,
    kelly_fraction_applied: 0.10,
    quantity: 0,                       // persisted as 0
    entry_price: 100,
    stop_loss: 99,
    take_profit: 102,
    arbitrator_direction: 'up' as const,
    arbitrator_confidence: 80,
    calibration_adjusted_confidence: 68,
    composite_risk_score: 30,
    consensus_bullish_count: 4,
    consensus_bearish_count: 1,
    consensus_total: 5,
    is_calibrating: true,
    rationale: 'test',
    created_at: '',
  };

  // User A with $100k → 100 shares
  const sizedA = TradeRecommendationService.sizeForUser(baseRec, 100000);
  assert(sizedA.quantity === 100, '$100k portfolio → 100 shares');
  assert(sizedA.position_percent === 0.10, 'position_percent unchanged');

  // User B with $50k → 50 shares (same recommendation, smaller portfolio)
  const sizedB = TradeRecommendationService.sizeForUser(baseRec, 50000);
  assert(sizedB.quantity === 50, '$50k portfolio → 50 shares');

  // Empty portfolio → 0 shares
  const sizedEmpty = TradeRecommendationService.sizeForUser(baseRec, 0);
  assert(sizedEmpty.quantity === 0, '$0 portfolio → 0 shares');

  // Negative balance → 0 shares (defensive)
  const sizedNeg = TradeRecommendationService.sizeForUser(baseRec, -1000);
  assert(sizedNeg.quantity === 0, 'negative balance → 0 shares');

  // HOLD action → quantity 0 regardless of balance
  const holdRec = { ...baseRec, action: 'hold' as const, position_percent: 0 };
  const sizedHold = TradeRecommendationService.sizeForUser(holdRec, 100000);
  assert(sizedHold.quantity === 0, 'HOLD → 0 shares regardless of balance');

  // Does not mutate the input
  const before = baseRec.quantity;
  TradeRecommendationService.sizeForUser(baseRec, 100000);
  assert(baseRec.quantity === before, 'sizeForUser does not mutate input');
}

console.log(`\n=== Trade Recommendation Tests: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
