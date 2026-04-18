/**
 * Regression test for tournament-avatar-stack:
 * `GET /tournaments` (listTournaments) must include `entrants_preview` (via a
 * LATERAL subquery on tournament_entries + authz.users, ORDER BY joined_at ASC
 * LIMIT 3) and a derived `entrants_overflow = max(0, player_count - preview.length)`.
 * The frontend relies on these fields to render the avatar stack on list cards.
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
  console.log('\n=== Tournaments List entrants_preview Tests ===\n');

  // Row 1: 7 players, 3-entry preview → overflow = 4
  // Row 2: 0 players, null preview from DB → service coerces to [] and overflow = 0
  // Row 3: 2 players, 2-entry preview → overflow = 0
  const fixedRows = [
    {
      id: 't1', name: 'Weekly Sprint #1', scope: 'club', scope_id: 'c1', status: 'upcoming',
      player_count: 7,
      entrants_preview: [
        { user_id: 'u1', display_name: 'Alice', avatar_url: null },
        { user_id: 'u2', display_name: 'Bob',   avatar_url: null },
        { user_id: 'u3', display_name: null,    avatar_url: null },
      ],
    },
    {
      id: 't2', name: 'System Challenge', scope: 'system', scope_id: null, status: 'active',
      player_count: 0,
      entrants_preview: null,
    },
    {
      id: 't3', name: 'Two-Player', scope: 'club', scope_id: 'c2', status: 'upcoming',
      player_count: 2,
      entrants_preview: [
        { user_id: 'u4', display_name: 'Carol', avatar_url: null },
        { user_id: 'u5', display_name: 'Dan',   avatar_url: null },
      ],
    },
  ];

  const responder = (sql: string): { data: unknown; error: null } => {
    if (sql.includes('FROM prediction.tournaments') && sql.includes('LEFT JOIN LATERAL')) {
      return { data: fixedRows, error: null };
    }
    return { data: [], error: null };
  };

  const db = new MockDb(responder);
  const svc = new TournamentService(db as any, new StubSchema() as any);

  const result = await svc.listTournaments('user-1');

  // Single-SQL-call invariant (no N+1)
  assert(db.calls.length === 1, 'listTournaments issued exactly one SQL call (no N+1)');

  const listCall = db.calls[0]!;
  // SQL shape — LATERAL join on tournament_entries + authz.users, ordered by joined_at, limited to 3
  assert(listCall.sql.includes('LEFT JOIN LATERAL'), 'SQL uses LEFT JOIN LATERAL for entrants preview');
  assert(listCall.sql.includes('prediction.tournament_entries'), 'LATERAL references prediction.tournament_entries');
  assert(listCall.sql.includes('authz.users'), 'LATERAL joins authz.users for display_name');
  assert(/ORDER BY\s+\w+\.joined_at\s+ASC/i.test(listCall.sql), 'LATERAL orders entries by joined_at ASC');
  assert(/LIMIT\s+3/.test(listCall.sql), 'LATERAL caps at LIMIT 3');
  // Still emits player_count (preserving the prior contract)
  assert(listCall.sql.includes('player_count'), 'SQL still emits player_count alongside the preview');

  // Response-shape assertions
  assert(Array.isArray(result), 'listTournaments returns an array');
  assert(result.length === 3, 'listTournaments returns all stubbed rows');

  // Row 1: overflow = 7 - 3 = 4
  assert(result[0]!.entrants_preview!.length === 3, 'row 1 preview length is 3 (capped)');
  assert(result[0]!.entrants_overflow === 4, 'row 1 entrants_overflow = player_count - preview.length = 4');

  // Row 2: empty tournament — preview coerced from null to [], overflow = 0
  assert(Array.isArray(result[1]!.entrants_preview), 'row 2 preview is an array (coerced from null)');
  assert(result[1]!.entrants_preview!.length === 0, 'row 2 preview length is 0');
  assert(result[1]!.entrants_overflow === 0, 'row 2 entrants_overflow = 0 for empty tournament');

  // Row 3: exact-fit, overflow = 0
  assert(result[2]!.entrants_preview!.length === 2, 'row 3 preview length is 2');
  assert(result[2]!.entrants_overflow === 0, 'row 3 entrants_overflow = 0 (preview fits player_count)');

  // Shape of each preview entry
  const sample = result[0]!.entrants_preview![0]!;
  const keys = Object.keys(sample).sort();
  assert(
    keys.length === 3 && keys[0] === 'avatar_url' && keys[1] === 'display_name' && keys[2] === 'user_id',
    'each preview entry has exactly {user_id, display_name, avatar_url}',
  );
  assert(sample.avatar_url === null, 'avatar_url is null (no avatar column exists yet)');
}

async function main(): Promise<void> {
  await run();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
