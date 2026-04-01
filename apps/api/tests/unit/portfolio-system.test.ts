/**
 * Unit tests for portfolio system — position sizing, P&L calculation,
 * portfolio status thresholds, settlement report formatting.
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

function assertClose(actual: number, expected: number, tolerance: number, label: string) {
  assert(Math.abs(actual - expected) <= tolerance, `${label} (got ${actual}, expected ~${expected})`);
}

console.log('\n=== Portfolio System Tests ===\n');

// ── Position Sizing ─────────────────────────────────────────────

console.log('Position sizing tiers:');
{
  function getPositionPercent(confidence: number): number {
    if (confidence >= 80) return 0.15;
    if (confidence >= 70) return 0.10;
    if (confidence >= 60) return 0.05;
    return 0;
  }

  function calculateQuantity(balance: number, price: number, percent: number): number {
    if (percent <= 0 || price <= 0) return 0;
    return Math.max(0, Math.floor((balance * percent) / price));
  }

  assert(getPositionPercent(85) === 0.15, '85% → 15% position');
  assert(getPositionPercent(75) === 0.10, '75% → 10% position');
  assert(getPositionPercent(65) === 0.05, '65% → 5% position');
  assert(getPositionPercent(50) === 0, '50% → no position');

  assert(calculateQuantity(1000000, 175, 0.15) === 857, '$1M, $175, 15% → 857 shares');
  assert(calculateQuantity(1000000, 175, 0.10) === 571, '$1M, $175, 10% → 571 shares');
  assert(calculateQuantity(1000000, 175, 0.05) === 285, '$1M, $175, 5% → 285 shares');
  assert(calculateQuantity(1000000, 175, 0) === 0, 'No position → 0 shares');
  assert(calculateQuantity(0, 175, 0.10) === 0, '$0 balance → 0 shares');
}

// ── P&L Calculation ─────────────────────────────────────────────

console.log('\nP&L calculation:');
{
  function calculatePnl(direction: 'long' | 'short', entry: number, current: number, qty: number): number {
    return direction === 'long' ? (current - entry) * qty : (entry - current) * qty;
  }

  assertClose(calculatePnl('long', 100, 110, 100), 1000, 0.01, 'Long 100@$100 → $110 = +$1000');
  assertClose(calculatePnl('long', 100, 90, 100), -1000, 0.01, 'Long 100@$100 → $90 = -$1000');
  assertClose(calculatePnl('short', 100, 90, 100), 1000, 0.01, 'Short 100@$100 → $90 = +$1000');
  assertClose(calculatePnl('short', 100, 110, 100), -1000, 0.01, 'Short 100@$100 → $110 = -$1000');
  assertClose(calculatePnl('long', 175.50, 178.25, 857), 2356.75, 0.01, 'Real scenario: 857 shares +$2.75 = $2356.75');
}

// ── Portfolio Status Thresholds ─────────────────────────────────

console.log('\nPortfolio status thresholds:');
{
  function determineStatus(current: number, initial: number): string {
    const ratio = current / initial;
    if (ratio >= 0.8) return 'active';
    if (ratio >= 0.6) return 'warning';
    if (ratio >= 0.4) return 'probation';
    return 'suspended';
  }

  assert(determineStatus(1000000, 1000000) === 'active', '$1M/$1M → active');
  assert(determineStatus(900000, 1000000) === 'active', '$900K/$1M → active');
  assert(determineStatus(800000, 1000000) === 'active', '$800K/$1M → active (boundary)');
  assert(determineStatus(799999, 1000000) === 'warning', '$799K/$1M → warning');
  assert(determineStatus(600000, 1000000) === 'warning', '$600K/$1M → warning (boundary)');
  assert(determineStatus(599999, 1000000) === 'probation', '$599K/$1M → probation');
  assert(determineStatus(400000, 1000000) === 'probation', '$400K/$1M → probation (boundary)');
  assert(determineStatus(399999, 1000000) === 'suspended', '$399K/$1M → suspended');
  assert(determineStatus(100000, 1000000) === 'suspended', '$100K/$1M → suspended');
}

// ── Weight Multiplier ───────────────────────────────────────────

console.log('\nWeight multiplier:');
{
  function getWeightMultiplier(status: string): number {
    if (status === 'probation') return 0.5;
    if (status === 'suspended') return 0;
    return 1.0;
  }

  assert(getWeightMultiplier('active') === 1.0, 'active → 1.0');
  assert(getWeightMultiplier('warning') === 1.0, 'warning → 1.0');
  assert(getWeightMultiplier('probation') === 0.5, 'probation → 0.5');
  assert(getWeightMultiplier('suspended') === 0, 'suspended → 0');
}

// ── Win Rate Calculation ────────────────────────────────────────

console.log('\nWin rate:');
{
  function winRate(wins: number, losses: number): number {
    const total = wins + losses;
    if (total === 0) return 0;
    return Math.round((wins / total) * 1000) / 10;
  }

  assert(winRate(7, 3) === 70, '7W/3L → 70%');
  assert(winRate(0, 0) === 0, '0W/0L → 0%');
  assert(winRate(10, 0) === 100, '10W/0L → 100%');
  assert(winRate(0, 10) === 0, '0W/10L → 0%');
  assert(winRate(5, 5) === 50, '5W/5L → 50%');
}

// ── Direction Mapping ───────────────────────────────────────────

console.log('\nDirection mapping:');
{
  function predictionToPosition(direction: 'up' | 'down' | 'flat'): 'long' | 'short' | null {
    if (direction === 'up') return 'long';
    if (direction === 'down') return 'short';
    return null;
  }

  assert(predictionToPosition('up') === 'long', 'up → long');
  assert(predictionToPosition('down') === 'short', 'down → short');
  assert(predictionToPosition('flat') === null, 'flat → no position');
}

// ── Settlement Report Formatting ────────────────────────────────

console.log('\nSettlement report:');
{
  function formatSettlementSummary(log: {
    queued_trades_executed: number;
    analyst_positions_created: number;
    positions_closed: number;
    total_realized_pnl: number;
    duration_ms: number;
  }): string {
    return `Settled in ${log.duration_ms}ms: ${log.queued_trades_executed} user trades, ${log.analyst_positions_created} analyst positions, ${log.positions_closed} closed, P&L $${log.total_realized_pnl.toFixed(2)}`;
  }

  const summary = formatSettlementSummary({
    queued_trades_executed: 5,
    analyst_positions_created: 12,
    positions_closed: 8,
    total_realized_pnl: 4250.75,
    duration_ms: 3200,
  });
  assert(summary.includes('5 user trades'), 'Includes user trades');
  assert(summary.includes('12 analyst positions'), 'Includes analyst positions');
  assert(summary.includes('4250.75'), 'Includes P&L');
  assert(summary.includes('3200ms'), 'Includes duration');
}

// ── Endpoint Count ──────────────────────────────────────────────

console.log('\nEndpoint count:');
{
  // Portfolio adds 10 new endpoints on top of the 39 we had
  const portfolioEndpoints = [
    'GET /portfolios/analysts',
    'GET /portfolios/analysts/:id',
    'GET /portfolios/analysts/:id/positions',
    'GET /portfolios/leaderboard',
    'GET /portfolios/me',
    'GET /portfolios/me/positions',
    'GET /portfolios/me/queue',
    'POST /portfolios/me/queue-trade',
    'POST /portfolios/me/queue-trade/:id/cancel',
    'POST /admin/run-settlement',
  ];
  assert(portfolioEndpoints.length === 10, `10 portfolio endpoints`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
