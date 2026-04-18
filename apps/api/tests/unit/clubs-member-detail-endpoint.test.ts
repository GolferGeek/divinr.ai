/**
 * Regression test for Phase 4 step 4.10:
 * `GET /clubs/:clubId/members/:userId` must return
 *   { user, role, joined_at, active_positions_count, accuracy_pct, last_active_at }
 * driven by tournament_positions joined to club-scoped tournaments. Requesting
 * user must be a member of the club; otherwise the service rejects.
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

const REQUESTING = 'user-requester';
const TARGET     = 'user-target';
const CLUB       = 'club-1';

function buildService(responder: (sql: string) => { data: unknown; error: null }) {
  const db = new MockDb(responder);
  const svc = new ClubService(db as any, new StubSchema() as any, undefined as any, undefined as any);
  return { db, svc };
}

async function happyPath(): Promise<void> {
  console.log('\n=== Club Member Detail — Happy Path ===\n');

  const responder = (sql: string): { data: unknown; error: null } => {
    // requireMembership membership check (returns a row)
    if (sql.includes('FROM prediction.club_members') && sql.includes('WHERE club_id = $1 AND user_id = $2') && !sql.includes('JOIN')) {
      return { data: [{ role: 'member' }], error: null };
    }
    // Member fetch with display_name
    if (sql.includes('cm.role') && sql.includes('cm.joined_at') && sql.includes('u.display_name')) {
      return { data: [{ role: 'admin', joined_at: '2026-01-15T00:00:00.000Z', id: TARGET, display_name: 'ethan' }], error: null };
    }
    // Open positions count
    if (sql.includes('COUNT(*)') && sql.includes("status = 'open'")) {
      return { data: [{ open_count: 4 }], error: null };
    }
    // Closed positions accuracy
    if (sql.includes('COUNT(CASE WHEN tpos.realized_pnl') && sql.includes("status = 'closed'")) {
      return { data: [{ wins: 3, total: 10 }], error: null };
    }
    // Last active
    if (sql.includes('GREATEST')) {
      return { data: [{ last_active: '2026-04-10T14:22:10.000Z' }], error: null };
    }
    return { data: [], error: null };
  };

  const { svc, db } = buildService(responder);
  const result = await svc.getMemberDetail(CLUB, TARGET, REQUESTING);

  assert(result.user.id === TARGET, 'returns user.id');
  assert(result.user.display_name === 'ethan', 'returns user.display_name from authz.users');
  assert(result.role === 'admin', 'returns the target user role in the club');
  assert(result.joined_at === '2026-01-15T00:00:00.000Z', 'returns joined_at');
  assert(result.active_positions_count === 4, 'counts open tournament_positions scoped to the club');
  assert(result.accuracy_pct === 30, 'accuracy_pct = wins/total * 100, rounded to 2dp (3/10 = 30)');
  assert(result.last_active_at === '2026-04-10T14:22:10.000Z', 'last_active_at comes from tournament_positions GREATEST');

  // Authorization: first query must be the membership check with the REQUESTER
  assert(db.calls[0].sql.includes('FROM prediction.club_members'), 'first SQL call is a membership check');
  assert(db.calls[0].params[1] === REQUESTING, 'membership check uses the REQUESTING user id');
}

async function nullAccuracy(): Promise<void> {
  console.log('\n=== Club Member Detail — Zero Closed Trades ===\n');

  const responder = (sql: string): { data: unknown; error: null } => {
    if (sql.includes('FROM prediction.club_members') && sql.includes('WHERE club_id = $1 AND user_id = $2') && !sql.includes('JOIN')) {
      return { data: [{ role: 'member' }], error: null };
    }
    if (sql.includes('cm.role') && sql.includes('u.display_name')) {
      return { data: [{ role: 'member', joined_at: '2026-03-01T00:00:00.000Z', id: TARGET, display_name: null }], error: null };
    }
    if (sql.includes("status = 'open'")) return { data: [{ open_count: 0 }], error: null };
    if (sql.includes("status = 'closed'")) return { data: [{ wins: 0, total: 0 }], error: null };
    if (sql.includes('GREATEST')) return { data: [{ last_active: null }], error: null };
    return { data: [], error: null };
  };

  const { svc } = buildService(responder);
  const result = await svc.getMemberDetail(CLUB, TARGET, REQUESTING);
  assert(result.accuracy_pct === null, 'accuracy_pct is null when no closed trades');
  assert(result.active_positions_count === 0, 'active_positions_count is 0');
  assert(result.last_active_at === null, 'last_active_at is null when user has never transacted in this club');
  assert(result.user.display_name === null, 'null display_name passes through (frontend falls back to id slice)');
}

async function notAMember(): Promise<void> {
  console.log('\n=== Club Member Detail — Not a Member ===\n');

  const responder = (sql: string): { data: unknown; error: null } => {
    if (sql.includes('FROM prediction.club_members')) return { data: [], error: null };
    return { data: [], error: null };
  };

  const { svc } = buildService(responder);
  try {
    await svc.getMemberDetail(CLUB, TARGET, REQUESTING);
    assert(false, 'throws when requester is not a member of the club');
  } catch (err) {
    assert(err instanceof Error, 'rejects with an Error for non-members');
  }
}

async function main(): Promise<void> {
  await happyPath();
  await nullAccuracy();
  await notAMember();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
