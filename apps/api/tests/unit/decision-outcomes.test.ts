/**
 * Unit tests for decision outcome calculation.
 * Tests PnL for buy/sell/skip decisions and good/bad classification.
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

console.log('\n=== Decision Outcome Tests ===\n');

// ── PnL Calculation ─────────────────────────────────────────────

console.log('PnL calculation for buy decisions (long):');
{
  function calcPnl(direction: 'long' | 'short', entryPrice: number, exitPrice: number, shares: number): number {
    if (direction === 'long') return (exitPrice - entryPrice) * shares;
    return (entryPrice - exitPrice) * shares;
  }

  assert(calcPnl('long', 100, 104, 100) === 400, 'Long 100@$100 → $104 = +$400');
  assert(calcPnl('long', 100, 96, 100) === -400, 'Long 100@$100 → $96 = -$400');
  assert(calcPnl('short', 100, 96, 100) === 400, 'Short 100@$100 → $96 = +$400');
  assert(calcPnl('short', 100, 104, 100) === -400, 'Short 100@$100 → $104 = -$400');
}

console.log('\nCounterfactual PnL for skip decisions:');
{
  // When user skips, pnl_if_taken shows what they would have made
  function counterfactualPnl(predictedDirection: string, confidence: number, entryPrice: number, exitPrice: number): number {
    const positionPercent = confidence >= 80 ? 0.15 : confidence >= 70 ? 0.10 : confidence >= 60 ? 0.05 : 0;
    const balance = 1000000;
    const shares = positionPercent > 0 ? Math.floor((balance * positionPercent) / entryPrice) : 0;
    const direction = predictedDirection === 'down' ? 'short' : 'long';
    const change = exitPrice - entryPrice;
    const pnlPerShare = direction === 'long' ? change : -change;
    return shares * pnlPerShare;
  }

  const pnl1 = counterfactualPnl('up', 75, 175, 182);
  assert(pnl1 > 0, `Skipped bullish at $175, went to $182 → missed +$${pnl1.toLocaleString()}`);

  const pnl2 = counterfactualPnl('up', 75, 175, 170);
  assert(pnl2 < 0, `Skipped bullish at $175, went to $170 → good skip (would have lost $${Math.abs(pnl2).toLocaleString()})`);

  const pnl3 = counterfactualPnl('down', 80, 175, 170);
  assert(pnl3 > 0, `Skipped bearish at $175, went to $170 → missed short gain`);

  const pnl4 = counterfactualPnl('up', 50, 175, 200);
  assert(pnl4 === 0, 'Skipped at 50% confidence → no position (below minimum)');
}

// ── Good vs Bad Decision Classification ──────────────────────────

console.log('\nGood vs bad decision classification:');
{
  function isGoodDecision(decision: 'buy' | 'sell' | 'skip', pnlIfTaken: number): boolean {
    if (decision === 'skip') {
      // Good skip = would have lost money
      return pnlIfTaken <= 0;
    }
    // Good buy/sell = actually made money
    return pnlIfTaken > 0;
  }

  assert(isGoodDecision('buy', 500) === true, 'Bought, made $500 → good');
  assert(isGoodDecision('buy', -500) === false, 'Bought, lost $500 → bad');
  assert(isGoodDecision('sell', 300) === true, 'Sold (short), made $300 → good');
  assert(isGoodDecision('sell', -300) === false, 'Sold (short), lost $300 → bad');
  assert(isGoodDecision('skip', -1000) === true, 'Skipped, would have lost $1000 → good skip');
  assert(isGoodDecision('skip', 1000) === false, 'Skipped, would have made $1000 → bad skip (missed)');
  assert(isGoodDecision('skip', 0) === true, 'Skipped, flat → neutral (counted as good)');
}

// ── Actual Direction Classification ──────────────────────────────

console.log('\nActual direction from price change:');
{
  function classifyDirection(entryPrice: number, exitPrice: number): 'up' | 'down' | 'flat' {
    const change = exitPrice - entryPrice;
    if (change > 0) return 'up';
    if (change < 0) return 'down';
    return 'flat';
  }

  assert(classifyDirection(100, 105) === 'up', '$100 → $105 = up');
  assert(classifyDirection(100, 95) === 'down', '$100 → $95 = down');
  assert(classifyDirection(100, 100) === 'flat', '$100 → $100 = flat');
}

// ── Results ────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
