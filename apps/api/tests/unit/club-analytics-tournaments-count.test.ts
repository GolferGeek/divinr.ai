/**
 * Regression test for walkthrough finding S6:
 * Club Analytics showed "Tournaments: 0" even though the club had an upcoming
 * Weekly Sprint attached. The fix drops the `status IN ('completed','archived')`
 * filter so all tournaments attached to the club are counted.
 */
import { ClubAnalyticsService } from '../../src/clubs/club-analytics.service';

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
class StubClubs { async requireMembership(_cid: string, _uid: string): Promise<void> { /* no-op */ } }

async function main(): Promise<void> {
  console.log('\n=== Club Analytics Tournaments Count Tests ===\n');

  // Responder returns realistic shapes for each query the service issues.
  const responder = (sql: string): { data: unknown; error: null } => {
    if (sql.includes('club_members') && sql.includes('COUNT(*)')) return { data: [{ count: 3 }], error: null };
    if (sql.includes('FROM prediction.tournaments')) return { data: [{ count: 1 }], error: null };
    if (sql.includes('AVG(')) return { data: [{ avg_return: 0 }], error: null };
    if (sql.includes('tournament_positions')) return { data: [{ wins: 0, total: 0 }], error: null };
    if (sql.includes('user_analyst_affinity')) return { data: [], error: null };
    if (sql.includes('club_consensus_votes')) return { data: [], error: null };
    return { data: [], error: null };
  };

  const db = new MockDb(responder);
  const svc = new ClubAnalyticsService(db as any, new StubSchema() as any, new StubClubs() as any);
  const result = await svc.getClubAnalytics('club-1', 'user-1');

  const tournamentSqlCall = db.calls.find(c => c.sql.includes('FROM prediction.tournaments'));
  assert(!!tournamentSqlCall, 'tournament-count SQL was issued');
  assert(!tournamentSqlCall!.sql.includes("status IN"), 'tournament count SQL no longer filters by status');
  assert(!tournamentSqlCall!.sql.includes('completed'), 'tournament count SQL does not mention "completed"');
  assert(!tournamentSqlCall!.sql.includes('archived'), 'tournament count SQL does not mention "archived"');
  assert(tournamentSqlCall!.sql.includes("scope = 'club'") && tournamentSqlCall!.sql.includes('scope_id = $1'),
    'tournament count SQL still scopes to club');

  assert(result.tournament_count === 1, 'returned tournament_count reflects all tournaments (upcoming included)');

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
