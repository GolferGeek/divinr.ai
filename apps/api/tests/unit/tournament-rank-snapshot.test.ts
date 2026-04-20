/**
 * Unit tests for TournamentLeaderboardService.snapshotDaily() and the
 * daily cron gate. Stubs DatabaseService.rawQuery so no real DB is needed.
 */
import { TournamentLeaderboardService } from '../../src/tournaments/tournament-leaderboard.service';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall { sql: string; params: unknown[] }

class StubSchema { async ensureSchema(): Promise<void> { /* no-op */ } }

class MockDb {
  public calls: MockCall[] = [];
  constructor(private readonly responder: (sql: string, params: unknown[]) => { data: unknown; error: null }) {}
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    return this.responder(sql, params);
  }
}

async function testTiebreakerOrderBy(): Promise<void> {
  console.log('\nTiebreaker determinism:');

  const leaderboardRows = [
    { user_id: 'user-a', display_name: 'A', initial_balance: 1000, current_balance: 1100,
      total_realized_pnl: 100, total_unrealized_pnl: 0, wins: 1, total_closed: 1 },
    { user_id: 'user-b', display_name: 'B', initial_balance: 1000, current_balance: 1100,
      total_realized_pnl: 100, total_unrealized_pnl: 0, wins: 1, total_closed: 1 },
  ];

  const responder = (sql: string): { data: unknown; error: null } => {
    if (sql.includes('FROM prediction.tournament_entries te')) {
      return { data: leaderboardRows, error: null };
    }
    return { data: [], error: null };
  };

  const db = new MockDb(responder);
  const svc = new TournamentLeaderboardService(db as any, new StubSchema() as any, { applyVisibilityFilter: (sql: string, params: unknown[]) => ({ sql, params }) } as any);

  const first = await svc.getLeaderboard('t1');
  const second = await svc.getLeaderboard('t1');

  assert(first[0].rank === 1 && first[0].user_id === 'user-a',
    'Tied entries: user-a (alphabetical first) gets rank 1');
  assert(first[1].rank === 2 && first[1].user_id === 'user-b',
    'Tied entries: user-b gets rank 2');
  assert(
    first[0].user_id === second[0].user_id && first[1].user_id === second[1].user_id,
    'Rank order is identical across repeated calls',
  );

  const sqlCall = db.calls[0];
  assert(sqlCall.sql.includes('te.user_id ASC'),
    'ORDER BY includes te.user_id ASC tiebreaker');
}

async function testSnapshotFilterAndInsert(): Promise<void> {
  console.log('\nSnapshot writes one row per active-tournament entry:');

  const leaderboardRows = [
    { user_id: 'u1', display_name: 'One', initial_balance: 1000, current_balance: 1100,
      total_realized_pnl: 100, total_unrealized_pnl: 0, wins: 1, total_closed: 1 },
    { user_id: 'u2', display_name: 'Two', initial_balance: 1000, current_balance: 900,
      total_realized_pnl: -100, total_unrealized_pnl: 0, wins: 0, total_closed: 1 },
  ];

  const responder = (sql: string): { data: unknown; error: null } => {
    if (sql.includes('SELECT id FROM prediction.tournaments')) {
      // Service filters to active + starts_at <= now in SQL; stub returns only the rows
      // a correctly-scoped query would receive.
      return { data: [{ id: 't-active' }], error: null };
    }
    if (sql.includes('FROM prediction.tournament_entries te')) {
      return { data: leaderboardRows, error: null };
    }
    if (sql.includes('INSERT INTO prediction.tournament_rank_snapshots')) {
      return { data: [], error: null };
    }
    return { data: [], error: null };
  };

  const db = new MockDb(responder);
  const svc = new TournamentLeaderboardService(db as any, new StubSchema() as any, { applyVisibilityFilter: (sql: string, params: unknown[]) => ({ sql, params }) } as any);

  const result = await svc.snapshotDaily();

  assert(result.snapshots === 2, 'Two entries snapshotted for one active tournament');

  const tournamentQuery = db.calls.find(c => c.sql.includes('SELECT id FROM prediction.tournaments'));
  assert(!!tournamentQuery, 'Fetches tournament list');
  assert(
    !!tournamentQuery && tournamentQuery.sql.includes("status = 'active'")
      && tournamentQuery.sql.includes('starts_at <= now()'),
    'Filters to status=active AND starts_at<=now (upcoming/completed/archived skipped)',
  );

  const inserts = db.calls.filter(c => c.sql.includes('INSERT INTO prediction.tournament_rank_snapshots'));
  assert(inserts.length === 2, 'Exactly two INSERTs issued');
  assert(
    inserts[0].sql.includes('ON CONFLICT (tournament_id, user_id, snapshot_date)'),
    'Re-snapshotting same day upserts instead of duplicating',
  );
  assert(
    inserts[0].sql.includes('DO UPDATE SET rank = EXCLUDED.rank'),
    'Conflict branch updates rank',
  );
  assert(
    inserts[0].sql.includes('CURRENT_DATE'),
    'Uses CURRENT_DATE (UTC) for snapshot_date',
  );

  const params1 = inserts[0].params;
  assert(params1[0] === 't-active' && params1[1] === 'u1' && params1[2] === 1,
    'First insert params: tournament, u1, rank 1');
  const params2 = inserts[1].params;
  assert(params2[0] === 't-active' && params2[1] === 'u2' && params2[2] === 2,
    'Second insert params: tournament, u2, rank 2');
}

async function testEnvGate(): Promise<void> {
  console.log('\nEnv gate short-circuits cron:');

  const prev = process.env.MARKETS_DISABLE_RANK_SNAPSHOTS;
  process.env.MARKETS_DISABLE_RANK_SNAPSHOTS = 'true';

  const db = new MockDb(() => ({ data: [], error: null }));
  const svc = new TournamentLeaderboardService(db as any, new StubSchema() as any, { applyVisibilityFilter: (sql: string, params: unknown[]) => ({ sql, params }) } as any);

  await svc.handleDailyRankSnapshotCron();
  assert(db.calls.length === 0, 'No DB calls issued when gate is true');

  if (prev === undefined) delete process.env.MARKETS_DISABLE_RANK_SNAPSHOTS;
  else process.env.MARKETS_DISABLE_RANK_SNAPSHOTS = prev;
}

async function testSkipsNonActive(): Promise<void> {
  console.log('\nUpcoming/completed/archived tournaments are skipped:');

  const responder = (sql: string): { data: unknown; error: null } => {
    if (sql.includes('SELECT id FROM prediction.tournaments')) {
      return { data: [], error: null };
    }
    return { data: [], error: null };
  };

  const db = new MockDb(responder);
  const svc = new TournamentLeaderboardService(db as any, new StubSchema() as any, { applyVisibilityFilter: (sql: string, params: unknown[]) => ({ sql, params }) } as any);

  const result = await svc.snapshotDaily();
  assert(result.snapshots === 0, 'No snapshots when there are no active tournaments');

  const inserts = db.calls.filter(c => c.sql.includes('INSERT INTO prediction.tournament_rank_snapshots'));
  assert(inserts.length === 0, 'No INSERTs issued');
}

async function main(): Promise<void> {
  console.log('\n=== Tournament Rank Snapshot Tests ===');
  await testTiebreakerOrderBy();
  await testSnapshotFilterAndInsert();
  await testEnvGate();
  await testSkipsNonActive();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
