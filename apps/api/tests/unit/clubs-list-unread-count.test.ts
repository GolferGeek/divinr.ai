/**
 * Regression test for activity-viewed-counter:
 *   - listMyClubs / getClub must include `unread_count` derived in a single
 *     SQL statement summing challenges + polls + journals filtered by
 *     COALESCE(last_viewed_at, joined_at).
 *   - markActivitiesViewed must UPDATE only the matching (club_id, user_id)
 *     row and throw NestJS ForbiddenException when the caller is not a member.
 */
import { ForbiddenException } from '@nestjs/common';
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
  constructor(private readonly responder: (sql: string, params: unknown[]) => { data: unknown; error: null }) {}
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    return this.responder(sql, params);
  }
}

class StubSchema { async ensureSchema(): Promise<void> { /* no-op */ } }
class StubMessaging {}

function makeService(responder: (sql: string, params: unknown[]) => { data: unknown; error: null }): { svc: ClubService; db: MockDb } {
  const db = new MockDb(responder);
  // ClubService takes (db, schema, messaging, optOuts, notifications?). The
  // notifications arg is @Optional so we omit it.
  const stubOptOuts = { applyVisibilityFilter(sql: string, params: unknown[]) { return { sql, params }; } } as any;
  const svc = new ClubService(db as any, new StubSchema() as any, new StubMessaging() as any, stubOptOuts);
  return { svc, db };
}

async function testListMyClubsShape(): Promise<void> {
  console.log('\n--- listMyClubs: shape, single-SQL, COALESCE semantics ---');

  const fixedRows = [
    {
      id: 'c1', name: 'St. Thomas', description: null, invite_code: 'X', is_public: true,
      created_by: 'u-owner', channel_id: 'ch1', created_at: '2026-04-01T00:00:00Z',
      my_role: 'member', member_count: 3, unread_count: 0,
    },
    {
      id: 'c2', name: 'Active Club', description: null, invite_code: 'Y', is_public: false,
      created_by: 'u-owner', channel_id: 'ch2', created_at: '2026-04-02T00:00:00Z',
      my_role: 'admin', member_count: 5, unread_count: 5,
    },
    {
      id: 'c3', name: 'Big Backlog', description: null, invite_code: 'Z', is_public: false,
      created_by: 'u-owner', channel_id: 'ch3', created_at: '2026-04-03T00:00:00Z',
      my_role: 'member', member_count: 8, unread_count: 150,
    },
  ];

  const responder = (sql: string): { data: unknown; error: null } => {
    if (/SELECT\s+c\.\*/i.test(sql) && sql.includes('FROM prediction.clubs')) {
      return { data: fixedRows, error: null };
    }
    return { data: [], error: null };
  };

  const { svc, db } = makeService(responder);
  const result = await svc.listMyClubs('user-1');

  assert(db.calls.length === 1, 'listMyClubs issued exactly one SQL call (no N+1)');

  const sql = db.calls[0]!.sql;
  assert(sql.includes('prediction.club_prediction_challenges'), 'SQL references prediction.club_prediction_challenges');
  assert(sql.includes('prediction.club_consensus_polls'), 'SQL references prediction.club_consensus_polls');
  assert(sql.includes('prediction.club_strategy_journals'), 'SQL references prediction.club_strategy_journals');
  assert(/COALESCE\s*\(\s*cm\.last_viewed_at\s*,\s*cm\.joined_at\s*\)/i.test(sql), 'SQL uses COALESCE(cm.last_viewed_at, cm.joined_at) for first-time-viewer semantics');
  assert(sql.includes('unread_count'), 'SQL aliases the derived sum as unread_count');
  assert(sql.includes('member_count'), 'SQL still emits member_count alongside unread_count');

  assert(Array.isArray(result), 'listMyClubs returns an array');
  assert(result.length === 3, 'listMyClubs returns all stubbed rows');

  assert(result[0]!.unread_count === 0, 'row 0 unread_count round-trips as 0');
  assert(result[1]!.unread_count === 5, 'row 1 unread_count round-trips as 5');
  assert(result[2]!.unread_count === 150, 'row 2 unread_count round-trips as 150');
  assert(typeof result[2]!.unread_count === 'number', 'unread_count is a number, not a string');
}

async function testGetClubShape(): Promise<void> {
  console.log('\n--- getClub: same single-SQL derivation ---');

  const fixedRow = {
    id: 'c1', name: 'St. Thomas', description: null, invite_code: 'X', is_public: true,
    created_by: 'u-owner', channel_id: 'ch1', created_at: '2026-04-01T00:00:00Z',
    my_role: 'member', member_count: 3, unread_count: 7,
  };

  const responder = (sql: string): { data: unknown; error: null } => {
    if (/SELECT\s+c\.\*/i.test(sql) && sql.includes('FROM prediction.clubs') && sql.includes('WHERE c.id = $1')) {
      return { data: [fixedRow], error: null };
    }
    return { data: [], error: null };
  };

  const { svc, db } = makeService(responder);
  const result = await svc.getClub('c1', 'user-1');

  assert(db.calls.length === 1, 'getClub issued exactly one SQL call');
  const sql = db.calls[0]!.sql;
  assert(sql.includes('prediction.club_prediction_challenges'), 'getClub SQL references challenges');
  assert(sql.includes('prediction.club_consensus_polls'), 'getClub SQL references polls');
  assert(sql.includes('prediction.club_strategy_journals'), 'getClub SQL references journals');
  assert(/COALESCE\s*\(\s*cm\.last_viewed_at\s*,\s*cm\.joined_at\s*\)/i.test(sql), 'getClub SQL uses COALESCE(cm.last_viewed_at, cm.joined_at)');
  assert(result !== null && result.unread_count === 7, 'getClub returns unread_count = 7');
}

async function testMarkActivitiesViewedSuccess(): Promise<void> {
  console.log('\n--- markActivitiesViewed: success path ---');

  const fixedTimestamp = '2026-04-19T14:23:11.482Z';
  const responder = (sql: string, params: unknown[]): { data: unknown; error: null } => {
    if (/UPDATE\s+prediction\.club_members/i.test(sql)) {
      assert(/SET\s+last_viewed_at\s*=\s*now\(\)/i.test(sql), 'UPDATE sets last_viewed_at = now()');
      assert(/WHERE\s+club_id\s*=\s*\$1\s+AND\s+user_id\s*=\s*\$2/i.test(sql), 'UPDATE constrains by both club_id ($1) and user_id ($2)');
      assert(/RETURNING\s+last_viewed_at/i.test(sql), 'UPDATE includes RETURNING last_viewed_at');
      assert(params[0] === 'club-A' && params[1] === 'user-1', 'UPDATE params bind clubId and userId in correct order');
      return { data: [{ last_viewed_at: fixedTimestamp }], error: null };
    }
    return { data: [], error: null };
  };

  const { svc, db } = makeService(responder);
  const result = await svc.markActivitiesViewed('club-A', 'user-1');

  assert(db.calls.length === 1, 'markActivitiesViewed issued exactly one SQL call');
  assert(result.ok === true, 'response.ok === true');
  assert(result.last_viewed_at === fixedTimestamp, 'response.last_viewed_at echoes the DB value as ISO string');
  assert(typeof result.last_viewed_at === 'string', 'response.last_viewed_at is a string');
}

async function testMarkActivitiesViewedSerializesDate(): Promise<void> {
  console.log('\n--- markActivitiesViewed: pg-Date serialization ---');

  const dateValue = new Date('2026-04-19T14:23:11.482Z');
  const responder = (sql: string): { data: unknown; error: null } => {
    if (/UPDATE\s+prediction\.club_members/i.test(sql)) {
      return { data: [{ last_viewed_at: dateValue }], error: null };
    }
    return { data: [], error: null };
  };

  const { svc } = makeService(responder);
  const result = await svc.markActivitiesViewed('club-A', 'user-1');

  assert(typeof result.last_viewed_at === 'string', 'Date instances are serialized to string');
  assert(result.last_viewed_at === '2026-04-19T14:23:11.482Z', 'Date is serialized via toISOString()');
}

async function testMarkActivitiesViewedForbidden(): Promise<void> {
  console.log('\n--- markActivitiesViewed: 403 path (zero rows updated) ---');

  const responder = (sql: string): { data: unknown; error: null } => {
    if (/UPDATE\s+prediction\.club_members/i.test(sql)) {
      return { data: [], error: null };
    }
    return { data: [], error: null };
  };

  const { svc } = makeService(responder);
  let threw: unknown = null;
  try {
    await svc.markActivitiesViewed('club-Z', 'user-not-a-member');
  } catch (err) {
    threw = err;
  }
  assert(threw !== null, 'markActivitiesViewed threw when zero rows returned');
  assert(threw instanceof ForbiddenException, 'thrown error is a NestJS ForbiddenException');
  // Also assert the message does NOT contain substrings the controller's handleError
  // would re-route to NotFound/BadRequest (which we explicitly bypassed in the controller).
  const message = (threw as Error).message;
  assert(!/not found|Not a member|Invalid|Requires|Cannot|Owner cannot/.test(message),
    'error message avoids substrings handled by ClubController.handleError');
}

async function main(): Promise<void> {
  console.log('\n=== Clubs List unread_count Tests ===');
  await testListMyClubsShape();
  await testGetClubShape();
  await testMarkActivitiesViewedSuccess();
  await testMarkActivitiesViewedSerializesDate();
  await testMarkActivitiesViewedForbidden();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
