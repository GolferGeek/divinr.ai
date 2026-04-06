/**
 * Unit tests for trade confirmation logic.
 * Tests calibration-adjusted confidence, position sizing, disclaimer gate, and decision recording.
 */

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

console.log('\n=== Trade Confirmation Tests ===\n');

// ── Calibration-Adjusted Confidence ─────────────────────────────

console.log('Calibration-adjusted confidence:');
{
  function getEffectiveConfidence(confidence: number, calibrationScore: number | null): number {
    if (calibrationScore != null && calibrationScore > 0) {
      return Math.min(100, Math.max(0, confidence * calibrationScore));
    }
    return confidence;
  }

  assert(getEffectiveConfidence(100, 0.7) === 70, '100% conf * 0.7 calibration = 70%');
  assert(getEffectiveConfidence(80, 0.9) === 72, '80% conf * 0.9 calibration = 72%');
  assert(getEffectiveConfidence(80, 1.0) === 80, '80% conf * 1.0 calibration = 80% (perfect calibration)');
  assert(getEffectiveConfidence(80, null) === 80, '80% conf * null calibration = 80% (no data)');
  assert(getEffectiveConfidence(80, 0) === 80, '80% conf * 0 calibration = 80% (fallback)');
  assert(getEffectiveConfidence(50, 0.5) === 25, '50% conf * 0.5 calibration = 25%');
  assert(getEffectiveConfidence(100, 1.5) === 100, 'Capped at 100%');
}

// ── Position Sizing from Effective Confidence ────────────────────

console.log('\nPosition sizing from effective confidence:');
{
  function getPositionPercent(confidence: number): number {
    if (confidence >= 80) return 0.15;
    if (confidence >= 70) return 0.10;
    if (confidence >= 60) return 0.05;
    return 0;
  }

  function calculatePositionSize(balance: number, price: number, percent: number): number {
    if (percent <= 0 || price <= 0) return 0;
    return Math.floor((balance * percent) / price);
  }

  // Effective confidence determines tier
  assert(getPositionPercent(85) === 0.15, '85% effective → 15% position');
  assert(getPositionPercent(75) === 0.10, '75% effective → 10% position');
  assert(getPositionPercent(65) === 0.05, '65% effective → 5% position');
  assert(getPositionPercent(50) === 0, '50% effective → no position');

  // Calibration reduces effective confidence → changes tier
  const rawConf = 80;
  const calibration = 0.8;
  const effective = rawConf * calibration; // 64%
  assert(getPositionPercent(effective) === 0.05, '80% raw * 0.8 calibration = 64% effective → 5% (reduced from 15%)');

  // Position size calculation
  assert(calculatePositionSize(1000000, 175, 0.15) === 857, '$1M portfolio, $175 stock, 15% → 857 shares');
  assert(calculatePositionSize(1000000, 175, 0) === 0, 'No position percent → 0 shares');
}

// ── Disclaimer Gate ──────────────────────────────────────────────

console.log('\nDisclaimer gate:');
{
  function checkDisclaimer(acknowledgedAt: string | null): { requiresDisclaimer: boolean } | null {
    if (!acknowledgedAt) return { requiresDisclaimer: true };
    return null; // Proceed with trade
  }

  assert(checkDisclaimer(null)?.requiresDisclaimer === true, 'No acknowledgment → requires disclaimer');
  assert(checkDisclaimer('2026-04-06T00:00:00Z') === null, 'Acknowledged → proceed');
}

// ── Decision Recording ────────────────────────────────────────────

console.log('\nDecision recording:');
{
  function classifyDecision(direction: string): 'buy' | 'sell' | 'skip' {
    if (direction === 'long') return 'buy';
    if (direction === 'short') return 'sell';
    return 'skip';
  }

  assert(classifyDecision('long') === 'buy', 'Long direction → buy decision');
  assert(classifyDecision('short') === 'sell', 'Short direction → sell decision');
  assert(classifyDecision('') === 'skip', 'Empty direction → skip');
}

// ── Paper Trading Gate ────────────────────────────────────────────

console.log('\nPaper trading gate:');
{
  function isInPaperPeriod(daysSinceCreation: number, drawdown: number): boolean {
    if (daysSinceCreation < 3) return true;
    if (drawdown >= 0.2) return true;
    return false;
  }

  assert(isInPaperPeriod(0, 0) === true, 'Day 0 → paper mode');
  assert(isInPaperPeriod(2, 0) === true, 'Day 2 → paper mode');
  assert(isInPaperPeriod(3, 0) === false, 'Day 3, no drawdown → live');
  assert(isInPaperPeriod(3, 0.15) === false, 'Day 3, 15% drawdown → live');
  assert(isInPaperPeriod(3, 0.2) === true, 'Day 3, 20% drawdown → stay paper');
  assert(isInPaperPeriod(10, 0.25) === true, 'Day 10, 25% drawdown → stay paper');
  assert(isInPaperPeriod(10, 0.1) === false, 'Day 10, 10% drawdown → live');
}

// ── Results ────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
