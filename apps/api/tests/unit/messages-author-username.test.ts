/**
 * Regression test for walkthrough finding S8:
 * Chat rendered the raw sender-id prefix (`ed38011a`) instead of the user's
 * display name. The fix joins authz.users and returns `sender_display_name`.
 */
import { MessagingService } from '../../src/messaging/messaging.service';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall { sql: string; params: unknown[] }

class MockDb {
  public calls: MockCall[] = [];
  public script: (sql: string) => { data: unknown; error: null } = () => ({ data: [], error: null });
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    return this.script(sql);
  }
}

class StubSchema { async ensureSchema(): Promise<void> { /* no-op */ } }

async function main(): Promise<void> {
  console.log('\n=== Messages Author Username Tests ===\n');

  const db = new MockDb();
  const stubOptOuts = { applyVisibilityFilter: (sql: string, params: unknown[]) => ({ sql, params }) } as any;
  const svc = new MessagingService(db as any, new StubSchema() as any, stubOptOuts);

  // Stub verifyMembership so we can drive listMessages without a real DB.
  (svc as any).verifyMembership = async () => undefined;

  console.log('listMessages resolves username:');
  {
    db.calls = [];
    db.script = (sql: string) => {
      if (sql.includes('FROM messaging.messages m') && sql.includes('m.parent_message_id IS NULL')) {
        return {
          data: [{
            id: 'm-1', channel_id: 'c-1', sender_id: 'u-ed38011a',
            sender_display_name: 'ethan',
            body: 'Hello', parent_message_id: null,
            attached_entity_type: null, attached_entity_id: null,
            is_pinned: false, is_deleted: false,
            created_at: '2026-04-17T00:00:00.000Z', reply_count: 0,
          }], error: null,
        };
      }
      return { data: [], error: null };
    };
    const { data } = await svc.listMessages('c-1', 'user-1');
    const mainCall = db.calls.find(c => c.sql.includes('m.parent_message_id IS NULL'));
    assert(!!mainCall, 'listMessages issued the main query');
    assert(mainCall!.sql.includes('LEFT JOIN authz.users'), 'listMessages LEFT JOINs authz.users');
    assert(mainCall!.sql.includes('sender_display_name'), 'listMessages selects sender_display_name');
    assert(data.length === 1 && (data[0] as any).sender_display_name === 'ethan',
      'listMessages returns the joined username');
  }

  console.log('\nlistMessages falls back gracefully when user row missing:');
  {
    db.calls = [];
    db.script = (sql: string) => {
      if (sql.includes('FROM messaging.messages m') && sql.includes('m.parent_message_id IS NULL')) {
        return {
          data: [{
            id: 'm-2', channel_id: 'c-1', sender_id: 'u-missing',
            sender_display_name: null,
            body: 'Orphan', parent_message_id: null,
            attached_entity_type: null, attached_entity_id: null,
            is_pinned: false, is_deleted: false,
            created_at: '2026-04-17T00:00:00.000Z', reply_count: 0,
          }], error: null,
        };
      }
      return { data: [], error: null };
    };
    const { data } = await svc.listMessages('c-1', 'user-1');
    assert(data.length === 1, 'row returned');
    assert((data[0] as any).sender_display_name === null, 'sender_display_name is null when user row missing');
    assert((data[0] as any).sender_id === 'u-missing', 'sender_id still present for client-side fallback');
  }

  console.log('\ngetPinnedMessages also resolves username:');
  {
    db.calls = [];
    db.script = (sql: string) => {
      if (sql.includes('is_pinned = true')) {
        return {
          data: [{
            id: 'm-3', channel_id: 'c-1', sender_id: 'u-owner',
            sender_display_name: 'owner',
            body: 'Pinned', parent_message_id: null,
            attached_entity_type: null, attached_entity_id: null,
            is_pinned: true, is_deleted: false,
            created_at: '2026-04-17T00:00:00.000Z',
          }], error: null,
        };
      }
      return { data: [], error: null };
    };
    const pinned = await svc.getPinnedMessages('c-1', 'user-1');
    const pinCall = db.calls.find(c => c.sql.includes('is_pinned = true'));
    assert(!!pinCall, 'getPinnedMessages issued the pinned query');
    assert(pinCall!.sql.includes('LEFT JOIN authz.users'), 'pinned query LEFT JOINs authz.users');
    assert(pinned.length === 1 && (pinned[0] as any).sender_display_name === 'owner',
      'pinned messages return resolved username');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
