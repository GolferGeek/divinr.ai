/**
 * Regression test for Phase 3 step 3.6/3.7:
 * `GET /tournaments` (listTournaments) must include a `player_count` subquery
 * that counts `tournament_entries` per tournament. The frontend relies on this
 * field to render roster-preview text on the tournaments list cards.
 */
import { TournamentService } from '../../src/tournaments/tournament.service';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall { sql: string; params: unknown[] }

class MockDb {
  public calls: MockCall[] = [];
  constructor(private readonly responder: (sql: string) => { data: unknown; error: null }) {}
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    return this.responder(sql);
  }
}

class StubSchema { async ensureSchema(): Promise<void> { /* no-op */ } }

async function run(): Promise<void> {
  console.log('\n=== Tournaments List player_count Tests ===\n');

  const fixedRows = [
    { id: 't1', name: 'Weekly Sprint #1', scope: 'club', scope_id: 'c1', status: 'upcoming', player_count: 7 },
    { id: 't2', name: 'System Challenge',  scope: 'system', scope_id: null, status: 'active',  player_count: 0 },
  ];

  const responder = (sql: string): { data: unknown; error: null } => {
    if (sql.includes('FROM prediction.tournaments') && sql.includes('player_count')) {
      return { data: fixedRows, error: null };
    }
    return { data: [], error: null };
  };

  const db = new MockDb(responder);
  const svc = new TournamentService(db as any, new StubSchema() as any);

  const result = await svc.listTournaments('user-1');

  // SQL shape assertions (the real engine is Postgres — we verify the service emits
  // the right SQL so we don't silently regress back to `SELECT t.*`).
  const listCall = db.calls[0];
  assert(!!listCall, 'listTournaments issued at least one SQL call');
  assert(listCall.sql.includes('player_count'), 'SQL references a player_count column');
  assert(
    listCall.sql.includes('FROM prediction.tournament_entries'),
    'SQL computes the count via a subquery on prediction.tournament_entries',
  );
  assert(
    listCall.sql.includes('te2.tournament_id = t.id') || listCall.sql.includes('tournament_id = t.id'),
    'subquery correlates on tournament id',
  );

  // Response shape assertions (what controllers/frontend see).
  assert(Array.isArray(result), 'listTournaments returns an array');
  assert(result.length === 2, 'listTournaments returns the stubbed rows');
  assert(result[0].player_count === 7, 'first tournament surfaces player_count = 7');
  assert(result[1].player_count === 0, 'second tournament surfaces player_count = 0 (empty tournament)');
}

async function main(): Promise<void> {
  await run();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
