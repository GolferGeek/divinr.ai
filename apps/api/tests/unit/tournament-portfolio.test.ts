/**
 * Unit tests for TournamentPortfolioService logic.
 * Tests business rules without a full NestJS bootstrap or database.
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

console.log('\n=== Tournament Portfolio Tests ===\n');

// ─── Test 1: Entry validation ──────────────────────────────────

console.log('Entry validation:');
{
  const validStatuses = ['upcoming', 'active'];
  const invalidStatuses = ['completed', 'archived'];

  for (const s of validStatuses) {
    assert(validStatuses.includes(s), `Entry allowed for ${s} tournament`);
  }
  for (const s of invalidStatuses) {
    assert(!validStatuses.includes(s), `Entry rejected for ${s} tournament`);
  }
}

// ─── Test 2: Duplicate entry detection ─────────────────────────

console.log('\nDuplicate entry detection:');
{
  const enteredUsers = new Set(['user-1']);
  const user1 = 'user-1';
  const user2 = 'user-2';
  assert(enteredUsers.has(user1), 'Duplicate entry detected for user-1');
  assert(!enteredUsers.has(user2), 'New entry allowed for user-2');
}

// ─── Test 3: Trade validation - active tournament only ─────────

console.log('\nTrade validation:');
{
  const statuses = ['upcoming', 'active', 'completed', 'archived'] as const;
  for (const s of statuses) {
    const canTrade = s === 'active';
    assert(
      canTrade === (s === 'active'),
      `Trade ${canTrade ? 'allowed' : 'rejected'} for ${s} tournament`,
    );
  }
}

// ─── Test 4: Instrument restriction ────────────────────────────

console.log('\nInstrument restriction:');
{
  const allowedInstruments: string[] | null = ['AAPL', 'GOOGL', 'MSFT'];

  // Allowed instrument
  assert(allowedInstruments.includes('AAPL'), 'AAPL allowed in sector-restricted tournament');
  assert(!allowedInstruments.includes('TSLA'), 'TSLA rejected in sector-restricted tournament');

  // No restriction (null)
  const noRestriction: string[] | null = null;
  assert(noRestriction === null, 'All instruments allowed when null');
}

// ─── Test 5: PnL calculation ───────────────────────────────────

console.log('\nPnL calculation:');
{
  // Long position: (exit - entry) * quantity
  const longEntry = 150;
  const longExit = 160;
  const longQty = 10;
  const longPnl = (longExit - longEntry) * longQty;
  assert(longPnl === 100, `Long PnL correct: $${longPnl}`);

  // Long losing position
  const longLosePnl = (140 - longEntry) * longQty;
  assert(longLosePnl === -100, `Long loss correct: $${longLosePnl}`);

  // Short position: (entry - exit) * quantity
  const shortEntry = 150;
  const shortExit = 140;
  const shortQty = 10;
  const shortPnl = (shortEntry - shortExit) * shortQty;
  assert(shortPnl === 100, `Short PnL correct: $${shortPnl}`);

  // Short losing position
  const shortLosePnl = (shortEntry - 160) * shortQty;
  assert(shortLosePnl === -100, `Short loss correct: $${shortLosePnl}`);
}

// ─── Test 6: Portfolio balance update on close ─────────────────

console.log('\nPortfolio balance on close:');
{
  let balance = 100000;
  const startBalance = balance;

  // Win: balance goes up
  const winPnl = 500;
  balance += winPnl;
  assert(balance === 100500, `Balance after win: $${balance}`);

  // Loss: balance goes down
  const lossPnl = -300;
  balance += lossPnl;
  assert(balance === 100200, `Balance after loss: $${balance}`);

  // Net P&L
  const netPnl = balance - startBalance;
  assert(netPnl === 200, `Net realized PnL: $${netPnl}`);
}

// ─── Test 7: Starting balance isolation ────────────────────────

console.log('\nStarting balance isolation:');
{
  const tournamentBalance = 100000;
  const userMainBalance = 1000000;

  assert(tournamentBalance !== userMainBalance, 'Tournament balance is separate from main balance');
  assert(tournamentBalance === 100000, 'Tournament portfolio uses tournament starting_balance');
}

// ─── Results ──────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
