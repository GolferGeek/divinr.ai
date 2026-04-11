/**
 * Unit tests for MessagingService moderation, mentions, and system channels.
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

console.log('\n=== Messaging Moderation Tests ===\n');

// ─── In-memory store ─────────────────────────────────────────

type ChannelRow = { id: string; scope: string; scope_id: string | null; name: string | null; is_archived: boolean; created_at: string };
type MemberRow = { channel_id: string; user_id: string; role: string; last_read_at: string; is_blocked: boolean };
type MessageRow = { id: string; channel_id: string; sender_id: string; body: string; parent_message_id: string | null; attached_entity_type: string | null; attached_entity_id: string | null; is_pinned: boolean; is_deleted: boolean; created_at: string };

const channels: ChannelRow[] = [];
const members: MemberRow[] = [];
const messages: MessageRow[] = [];
let msgCounter = 0;

function stubRawQuery(sql: string, params?: unknown[]) {
  const t = sql.replace(/\s+/g, ' ').trim();
  const p = (params ?? []) as string[];

  if (t.startsWith('CREATE')) return { data: null, error: null };

  // Insert channel
  if (t.includes('INSERT INTO messaging.channels')) {
    const row: ChannelRow = { id: p[0], scope: p[1], scope_id: p[2] ?? null, name: p[3] ?? null, is_archived: false, created_at: new Date().toISOString() };
    channels.push(row);
    return { data: [row], error: null };
  }

  // Insert channel member
  if (t.includes('INSERT INTO messaging.channel_members')) {
    const existing = members.find(m => m.channel_id === p[0] && m.user_id === p[1]);
    if (!existing) {
      members.push({ channel_id: p[0], user_id: p[1], role: p[2], last_read_at: new Date().toISOString(), is_blocked: false });
    }
    return { data: null, error: null };
  }

  // Get channel scope
  if (t.includes('SELECT scope FROM messaging.channels WHERE id')) {
    const ch = channels.find(c => c.id === p[0]);
    return { data: ch ? [{ scope: ch.scope }] : [], error: null };
  }

  // Verify membership
  if (t.includes('SELECT 1 FROM messaging.channel_members')) {
    const found = members.filter(m => m.channel_id === p[0] && m.user_id === p[1]);
    return { data: found.length > 0 ? [{ '?column?': 1 }] : [], error: null };
  }

  // Verify admin
  if (t.includes('SELECT role FROM messaging.channel_members')) {
    const mem = members.find(m => m.channel_id === p[0] && m.user_id === p[1]);
    return { data: mem ? [{ role: mem.role }] : [], error: null };
  }

  // Get message for delete check
  if (t.includes('SELECT sender_id, channel_id FROM messaging.messages WHERE id')) {
    const msg = messages.find(m => m.id === p[0] && m.channel_id === p[1]);
    return { data: msg ? [{ sender_id: msg.sender_id, channel_id: msg.channel_id }] : [], error: null };
  }

  // Soft delete
  if (t.includes('UPDATE messaging.messages SET is_deleted = true WHERE id')) {
    const msg = messages.find(m => m.id === p[0]);
    if (msg) msg.is_deleted = true;
    return { data: null, error: null };
  }

  // Insert message
  if (t.includes('INSERT INTO messaging.messages')) {
    msgCounter++;
    const row: MessageRow = {
      id: p[0], channel_id: p[1], sender_id: p[2], body: p[3],
      parent_message_id: p[4] ?? null,
      attached_entity_type: p[5] ?? null, attached_entity_id: p[6] ?? null,
      is_pinned: false, is_deleted: false,
      created_at: new Date(Date.now() + msgCounter).toISOString(),
    };
    messages.push(row);
    return { data: [row], error: null };
  }

  // User search
  if (t.includes('FROM auth.users') && t.includes('ILIKE')) {
    return { data: [{ id: 'user-found', email: 'testuser@example.com' }], error: null };
  }

  // Resolve usernames
  if (t.includes('FROM auth.users') && t.includes('split_part')) {
    return { data: [{ id: 'user-mentioned', email: 'mentioned@example.com' }], error: null };
  }

  return { data: null, error: null };
}

// ─── Build service ───────────────────────────────────────────

import { MessagingService } from '../../src/messaging/messaging.service';

const stubDb = { rawQuery: stubRawQuery } as any;
const stubSchema = { ensureSchema: async () => {} } as any;

const service = Object.create(MessagingService.prototype) as MessagingService;
(service as any).db = stubDb;
(service as any).schema = stubSchema;
(service as any).logger = { log: () => {}, error: () => {}, warn: () => {} };

// ─── Tests ───────────────────────────────────────────────────

(async () => {
  // Setup
  const ch = await service.createChannel('club', 'club-1', 'Test Club');
  await service.addChannelMember(ch.id, 'admin-1', 'admin');
  await service.addChannelMember(ch.id, 'user-1', 'member');
  await service.addChannelMember(ch.id, 'user-2', 'member');

  console.log('parseMentions():');
  {
    assert(service.parseMentions('Hello @alice').length === 1, 'finds one mention');
    assert(service.parseMentions('Hello @alice and @bob')[0] === 'alice', 'first mention correct');
    assert(service.parseMentions('Hello @alice and @bob')[1] === 'bob', 'second mention correct');
    assert(service.parseMentions('No mentions here').length === 0, 'no mentions');
    assert(service.parseMentions('@alice @alice').length === 1, 'deduplicates');
  }

  console.log('\ndeleteMessage() as sender:');
  {
    const msg = await service.sendMessage(ch.id, 'user-1', 'Delete me');
    await service.deleteMessage(msg.id, ch.id, 'user-1');
    assert(messages.find(m => m.id === msg.id)!.is_deleted === true, 'message soft-deleted');
  }

  console.log('\ndeleteMessage() as admin:');
  {
    const msg = await service.sendMessage(ch.id, 'user-2', 'Admin will delete');
    await service.deleteMessage(msg.id, ch.id, 'admin-1');
    assert(messages.find(m => m.id === msg.id)!.is_deleted === true, 'admin can delete others messages');
  }

  console.log('\ndeleteMessage() as super-admin:');
  {
    const msg = await service.sendMessage(ch.id, 'user-2', 'Super admin delete');
    await service.deleteMessage(msg.id, ch.id, 'user-1', 'super-admin');
    assert(messages.find(m => m.id === msg.id)!.is_deleted === true, 'super-admin can delete');
  }

  console.log('\ndeleteMessage() unauthorized:');
  {
    const msg = await service.sendMessage(ch.id, 'admin-1', 'Protected message');
    let threw = false;
    try {
      await service.deleteMessage(msg.id, ch.id, 'user-2');
    } catch {
      threw = true;
    }
    assert(threw, 'non-sender non-admin cannot delete');
    assert(messages.find(m => m.id === msg.id)!.is_deleted === false, 'message not deleted');
  }

  console.log('\ncreateSystemChannel():');
  {
    const sysCh = await service.createSystemChannel('announcements');
    assert(sysCh.scope === 'system', 'system scope');
    assert(sysCh.name === 'announcements', 'correct name');
  }

  console.log('\ncreateScopedChannel():');
  {
    const clubCh = await service.createScopedChannel('club', 'club-2', 'Club Chat', 'admin-1');
    assert(clubCh.scope === 'club', 'club scope');
    assert(clubCh.scope_id === 'club-2', 'correct scope_id');
    const admin = members.find(m => m.channel_id === clubCh.id && m.user_id === 'admin-1');
    assert(admin !== undefined, 'admin added as member');
    assert(admin!.role === 'admin', 'admin has admin role');
  }

  console.log('\nsearchUsers():');
  {
    const users = await service.searchUsers('test');
    assert(users.length === 1, 'returns one user');
    assert(users[0].display_name === 'testuser', 'correct display_name');
  }

  // ─── Results ───────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
