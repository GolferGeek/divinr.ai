/**
 * Integration-style unit test: stubs DatabaseService to return fake leaderboard
 * rows (with or without `prev_rank` from the LATERAL join) and asserts the
 * service maps them to `prev_rank` / `rank_delta` on every returned entry.
 */
import { TournamentLeaderboardService } from '../../src/tournaments/tournament-leaderboard.service';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

class StubSchema { async ensureSchema(): Promise<void> { /* no-op */ } }
class MockDb {
  public lastSql = '';
  constructor(private readonly rows: unknown[]) {}
  async rawQuery(sql: string, _params: unknown[] = []) {
    this.lastSql = sql;
    return { data: this.rows, error: null };
  }
}

async function testLateralJoinShape(): Promise<void> {
  console.log('\nSQL shape (LEFT JOIN LATERAL prior-day snapshot):');

  const db = new MockDb([]);
  const svc = new TournamentLeaderboardService(db as any, new StubSchema() as any, { applyVisibilityFilter: (sql: string, params: unknown[]) => ({ sql, params }) } as any);
  await svc.getLeaderboard('t1');

  assert(db.lastSql.includes('LEFT JOIN LATERAL'),
    'Uses LEFT JOIN LATERAL (correlated subquery)');
  assert(db.lastSql.includes('prediction.tournament_rank_snapshots'),
    'Joins against tournament_rank_snapshots');
  assert(db.lastSql.includes('snapshot_date < CURRENT_DATE'),
    'Restricts to strictly-prior-day snapshots (no today)');
  assert(db.lastSql.includes('ORDER BY snapshot_date DESC') && db.lastSql.includes('LIMIT 1'),
    'Picks the MOST RECENT prior day (not the latest overall or oldest)');
  assert(db.lastSql.includes('te.user_id ASC'),
    'Tiebreaker still on the outer ORDER BY');
}

async function testNullPriorProducesNullDelta(): Promise<void> {
  console.log('\nNo prior snapshot → prev_rank:null, rank_delta:null:');

  const rows = [
    { user_id: 'u1', display_name: 'One', initial_balance: 1000, current_balance: 1100,
      total_realized_pnl: 100, total_unrealized_pnl: 0, wins: 1, total_closed: 1,
      prev_rank: null },
  ];
  const db = new MockDb(rows);
  const svc = new TournamentLeaderboardService(db as any, new StubSchema() as any, { applyVisibilityFilter: (sql: string, params: unknown[]) => ({ sql, params }) } as any);
  const result = await svc.getLeaderboard('t1');

  assert(result.length === 1, 'one entry returned');
  assert('prev_rank' in result[0] && 'rank_delta' in result[0],
    'both fields present on every entry (not missing / not undefined)');
  assert(result[0].prev_rank === null, 'prev_rank is null when LATERAL returned no row');
  assert(result[0].rank_delta === null, 'rank_delta is null when prev_rank is null');
}

async function testPositiveAndNegativeDelta(): Promise<void> {
  console.log('\nLATERAL returns a prior rank → delta = prev_rank - current_rank:');

  const rows = [
    // Sorted by PnL DESC: u-moved-up is rank 2, u-moved-down is rank 5
    { user_id: 'u-moved-up',   display_name: null, initial_balance: 1000, current_balance: 1200,
      total_realized_pnl: 200, total_unrealized_pnl: 0, wins: 2, total_closed: 2,
      prev_rank: 5 }, // delta: 5 - 2 = 3 (up)
    { user_id: 'u-unchanged',  display_name: null, initial_balance: 1000, current_balance: 1100,
      total_realized_pnl: 100, total_unrealized_pnl: 0, wins: 1, total_closed: 1,
      prev_rank: 2 }, // delta: 2 - 2 = 0 — wait, this will be rank 2 too
    // ordering here just reflects the stub; service maps by array index
  ];
  const db = new MockDb(rows);
  const svc = new TournamentLeaderboardService(db as any, new StubSchema() as any, { applyVisibilityFilter: (sql: string, params: unknown[]) => ({ sql, params }) } as any);
  const result = await svc.getLeaderboard('t1');

  assert(result[0].rank === 1, 'first row gets rank 1');
  assert(result[0].prev_rank === 5, 'prev_rank = 5 carried through from LATERAL');
  assert(result[0].rank_delta === 4, `rank_delta = prev_rank - rank = 5 - 1 = 4 (got ${result[0].rank_delta})`);

  assert(result[1].rank === 2, 'second row gets rank 2');
  assert(result[1].prev_rank === 2, 'prev_rank carried through');
  assert(result[1].rank_delta === 0, 'rank_delta = 2 - 2 = 0 (unchanged)');
}

async function testDownwardMover(): Promise<void> {
  console.log('\nNegative delta (moved down):');

  const rows = [
    { user_id: 'u-leader', display_name: null, initial_balance: 1000, current_balance: 1500,
      total_realized_pnl: 500, total_unrealized_pnl: 0, wins: 5, total_closed: 5,
      prev_rank: 1 }, // delta: 1 - 1 = 0
    { user_id: 'u-slipped', display_name: null, initial_balance: 1000, current_balance: 900,
      total_realized_pnl: -100, total_unrealized_pnl: 0, wins: 0, total_closed: 2,
      prev_rank: 1 }, // delta: 1 - 2 = -1  (they were #1 yesterday, now #2)
  ];
  const db = new MockDb(rows);
  const svc = new TournamentLeaderboardService(db as any, new StubSchema() as any, { applyVisibilityFilter: (sql: string, params: unknown[]) => ({ sql, params }) } as any);
  const result = await svc.getLeaderboard('t1');

  assert(result[1].rank === 2 && result[1].prev_rank === 1, 'slipped user: rank 2, prev 1');
  assert(result[1].rank_delta === -1, `rank_delta = 1 - 2 = -1 (got ${result[1].rank_delta})`);
}

async function main(): Promise<void> {
  console.log('\n=== Tournament Leaderboard Delta (Integration) ===');
  await testLateralJoinShape();
  await testNullPriorProducesNullDelta();
  await testPositiveAndNegativeDelta();
  await testDownwardMover();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
