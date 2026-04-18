/**
 * Regression test for walkthrough finding S3:
 * The DISCOVER list showed clubs the viewer was already a member of. The fix
 * adds a NOT EXISTS club_members filter keyed on the viewer's user id.
 */
import { ClubService } from '../../src/clubs/club.service';

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
class StubMessaging { /* unused by discoverClubs */ }

async function main(): Promise<void> {
  console.log('\n=== Clubs Discover Hides Joined Tests ===\n');

  const responder = (sql: string): { data: unknown; error: null } => {
    if (sql.includes('FROM prediction.clubs c')) {
      return { data: [
        { id: 'club-a', name: 'Public A', is_public: true, member_count: 4, tournament_count: 1 },
      ], error: null };
    }
    return { data: [], error: null };
  };

  const db = new MockDb(responder);
  const svc = new ClubService(db as any, new StubSchema() as any, new StubMessaging() as any);
  const rows = await svc.discoverClubs('user-42');

  const discoverCall = db.calls.find(c => c.sql.includes('FROM prediction.clubs c'));
  assert(!!discoverCall, 'discoverClubs issued the public-clubs query');
  assert(discoverCall!.sql.includes('c.is_public = true'), 'discoverClubs still filters to public clubs');
  assert(discoverCall!.sql.includes('NOT EXISTS'), 'discoverClubs SQL contains NOT EXISTS subquery');
  assert(
    discoverCall!.sql.includes('FROM prediction.club_members m') && discoverCall!.sql.includes('m.user_id = $1'),
    'NOT EXISTS subquery checks membership against $1 (viewer user id)',
  );
  assert(
    Array.isArray(discoverCall!.params) && discoverCall!.params[0] === 'user-42',
    'discoverClubs binds the viewer user id as $1',
  );
  assert(rows.length === 1, 'discoverClubs returns the responder payload');

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
