/**
 * Regression test for Phase 2 step 2.9:
 * Club Analytics should return null (not 0) for avg_return_pct and club_win_rate
 * when trades_count == 0, so the frontend em-dash fallback is driven by real data.
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

async function emptyCase(): Promise<void> {
  console.log('\n=== Club Analytics Empty-Formatting Tests ===\n');

  const responder = (sql: string): { data: unknown; error: null } => {
    if (sql.includes('club_members') && sql.includes('COUNT(*)')) return { data: [{ count: 3 }], error: null };
    if (sql.includes('FROM prediction.tournaments')) return { data: [{ count: 1 }], error: null };
    if (sql.includes('AVG(')) return { data: [{ avg_return: null }], error: null };
    if (sql.includes('tournament_positions') && sql.includes('COUNT(CASE WHEN')) return { data: [{ wins: 0, total: 0 }], error: null };
    if (sql.includes('user_analyst_affinity')) return { data: [], error: null };
    if (sql.includes('club_consensus_votes')) return { data: [], error: null };
    if (sql.includes('tournament_positions')) return { data: [], error: null };
    return { data: [], error: null };
  };

  const db = new MockDb(responder);
  const svc = new ClubAnalyticsService(db as any, new StubSchema() as any, new StubClubs() as any);
  const result = await svc.getClubAnalytics('club-1', 'user-1');

  assert(result.trades_count === 0, 'trades_count is 0 for a club with no closed tournament positions');
  assert(result.avg_return_pct === null, 'avg_return_pct is null (not 0) when trades_count === 0');
  assert(result.club_win_rate === null, 'club_win_rate is null (not 0) when trades_count === 0');
  assert(typeof result.tournament_count === 'number', 'tournament_count is still a number (unrelated to trades)');
}

async function populatedCase(): Promise<void> {
  const responder = (sql: string): { data: unknown; error: null } => {
    if (sql.includes('club_members') && sql.includes('COUNT(*)')) return { data: [{ count: 3 }], error: null };
    if (sql.includes('FROM prediction.tournaments')) return { data: [{ count: 2 }], error: null };
    if (sql.includes('AVG(')) return { data: [{ avg_return: 4.2 }], error: null };
    if (sql.includes('tournament_positions') && sql.includes('COUNT(CASE WHEN')) return { data: [{ wins: 3, total: 5 }], error: null };
    if (sql.includes('user_analyst_affinity')) return { data: [], error: null };
    if (sql.includes('club_consensus_votes')) return { data: [], error: null };
    if (sql.includes('tournament_positions')) return { data: [], error: null };
    return { data: [], error: null };
  };

  const db = new MockDb(responder);
  const svc = new ClubAnalyticsService(db as any, new StubSchema() as any, new StubClubs() as any);
  const result = await svc.getClubAnalytics('club-2', 'user-1');

  assert(result.trades_count === 5, 'trades_count reflects the SQL total');
  assert(result.avg_return_pct === 4.2, 'avg_return_pct is the formatted number when trades > 0');
  assert(result.club_win_rate === 60, 'club_win_rate is (wins/total)*100 when trades > 0 (3/5 = 60)');
}

async function main(): Promise<void> {
  await emptyCase();
  await populatedCase();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
