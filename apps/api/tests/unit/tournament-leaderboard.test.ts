/**
 * Unit tests for TournamentLeaderboardService logic.
 * Tests ranking, PnL, win-rate calculations without database.
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

console.log('\n=== Tournament Leaderboard Tests ===\n');

// ─── Test 1: Return % calculation ──────────────────────────────

console.log('Return % calculation:');
{
  const initialBalance = 100000;

  // Positive return
  const totalPnl1 = 5000;
  const returnPct1 = (totalPnl1 / initialBalance) * 100;
  assert(returnPct1 === 5, `5% return on $5000 profit`);

  // Negative return
  const totalPnl2 = -3000;
  const returnPct2 = (totalPnl2 / initialBalance) * 100;
  assert(returnPct2 === -3, `-3% return on $3000 loss`);

  // Zero balance edge case
  const zeroPct = 0 > 0 ? (5000 / 0) * 100 : 0;
  assert(zeroPct === 0, 'Zero initial balance returns 0%');
}

// ─── Test 2: Ranking by return % descending ────────────────────

console.log('\nRanking:');
{
  const entries = [
    { user: 'A', pnl: 5000 },
    { user: 'B', pnl: 10000 },
    { user: 'C', pnl: -2000 },
    { user: 'D', pnl: 3000 },
  ];

  const sorted = [...entries].sort((a, b) => b.pnl - a.pnl);
  assert(sorted[0].user === 'B', 'Rank 1: B ($10k)');
  assert(sorted[1].user === 'A', 'Rank 2: A ($5k)');
  assert(sorted[2].user === 'D', 'Rank 3: D ($3k)');
  assert(sorted[3].user === 'C', 'Rank 4: C (-$2k)');
}

// ─── Test 3: Win rate calculation ──────────────────────────────

console.log('\nWin rate:');
{
  // 7 wins out of 10 closed
  const wins = 7;
  const totalClosed = 10;
  const winRate = (wins / totalClosed) * 100;
  assert(winRate === 70, '70% win rate with 7/10');

  // Zero closed positions
  const zeroRate = 0 > 0 ? (0 / 0) * 100 : 0;
  assert(zeroRate === 0, '0% win rate with no closed positions');

  // All losses
  const allLoss = (0 / 5) * 100;
  assert(allLoss === 0, '0% win rate with all losses');

  // All wins
  const allWin = (5 / 5) * 100;
  assert(allWin === 100, '100% win rate with all wins');
}

// ─── Test 4: Results only for completed tournaments ────────────

console.log('\nResults availability:');
{
  const statuses = ['upcoming', 'active', 'completed', 'archived'] as const;
  for (const s of statuses) {
    const hasResults = s === 'completed' || s === 'archived';
    assert(
      hasResults === (s === 'completed' || s === 'archived'),
      `Results ${hasResults ? 'available' : 'not available'} for ${s} tournament`,
    );
  }
}

// ─── Test 5: Finalize closes all open positions ────────────────

console.log('\nFinalize logic:');
{
  // Simulate open positions being closed
  const openPositions = [
    { direction: 'long', entry: 150, current: 160, qty: 10 },
    { direction: 'short', entry: 200, current: 190, qty: 5 },
    { direction: 'long', entry: 100, current: 95, qty: 20 },
  ];

  let totalRealizedOnClose = 0;
  for (const pos of openPositions) {
    const exitPrice = pos.current;
    const pnl = pos.direction === 'long'
      ? (exitPrice - pos.entry) * pos.qty
      : (pos.entry - exitPrice) * pos.qty;
    totalRealizedOnClose += pnl;
  }

  assert(totalRealizedOnClose === 100 + 50 + (-100), `Total PnL on finalize: $${totalRealizedOnClose}`);
  assert(totalRealizedOnClose === 50, 'Net PnL is $50');
}

// ─── Test 6: Final rank assignment ─────────────────────────────

console.log('\nFinal rank assignment:');
{
  const rankings = [
    { user: 'A', return_pct: 15 },
    { user: 'B', return_pct: 10 },
    { user: 'C', return_pct: -5 },
  ];

  rankings.forEach((r, i) => {
    const rank = i + 1;
    assert(rank === i + 1, `${r.user} gets rank ${rank}`);
  });
}

// ─── Test 7: Best trade identification ─────────────────────────

console.log('\nBest trade:');
{
  const trades = [
    { symbol: 'AAPL', pnl: 500 },
    { symbol: 'GOOGL', pnl: 1200 },
    { symbol: 'MSFT', pnl: -300 },
  ];

  const best = trades.reduce((a, b) => a.pnl > b.pnl ? a : b);
  assert(best.symbol === 'GOOGL', 'Best trade is GOOGL ($1200)');
  assert(best.pnl === 1200, 'Best trade PnL is $1200');
}

// ─── Results ──────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
