/**
 * Unit tests for MessagingService.
 * Uses an in-memory stub for DatabaseService.
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

console.log('\n=== Messaging Service Tests ===\n');

// ─── In-memory store ─────────────────────────────────────────

type ChannelRow = {
  id: string; scope: string; scope_id: string | null;
  name: string | null; is_archived: boolean; created_at: string;
};
type MemberRow = {
  channel_id: string; user_id: string; role: string;
  last_read_at: string; is_blocked: boolean;
};
type MessageRow = {
  id: string; channel_id: string; sender_id: string; body: string;
  parent_message_id: string | null;
  attached_entity_type: string | null; attached_entity_id: string | null;
  is_pinned: boolean; is_deleted: boolean; created_at: string;
};

const channels: ChannelRow[] = [];
const members: MemberRow[] = [];
const messages: MessageRow[] = [];
let msgCounter = 0;

function stubRawQuery(sql: string, params?: unknown[]) {
  const t = sql.replace(/\s+/g, ' ').trim();
  const p = (params ?? []) as string[];

  // Schema DDL
  if (t.startsWith('CREATE SCHEMA') || t.startsWith('CREATE TABLE') || t.startsWith('CREATE INDEX')) {
    return { data: null, error: null };
  }

  // Insert channel
  if (t.includes('INSERT INTO messaging.channels')) {
    const row: ChannelRow = {
      id: p[0], scope: p[1], scope_id: p[2] ?? null,
      name: p[3] ?? null, is_archived: false, created_at: new Date().toISOString(),
    };
    channels.push(row);
    return { data: [row], error: null };
  }

  // Insert channel member
  if (t.includes('INSERT INTO messaging.channel_members')) {
    const existing = members.find(m => m.channel_id === p[0] && m.user_id === p[1]);
    if (!existing) {
      members.push({
        channel_id: p[0], user_id: p[1], role: p[2],
        last_read_at: new Date().toISOString(), is_blocked: false,
      });
    }
    return { data: null, error: null };
  }

  // Verify membership
  if (t.includes('SELECT 1 FROM messaging.channel_members')) {
    const found = members.filter(m => m.channel_id === p[0] && m.user_id === p[1]);
    return { data: found.length > 0 ? [{ '?column?': 1 }] : [], error: null };
  }

  // Get channel by id
  if (t.includes('SELECT * FROM messaging.channels WHERE id')) {
    const found = channels.filter(c => c.id === p[0]);
    return { data: found, error: null };
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

  // List channels for user (must come before listMessages since both reference messaging.messages)
  if (t.includes('FROM messaging.channel_members cm') && t.includes('JOIN messaging.channels')) {
    const userId = p[0];
    const userMembers = members.filter(m => m.user_id === userId);
    const result = userMembers.map(m => {
      const ch = channels.find(c => c.id === m.channel_id)!;
      const chMsgs = messages.filter(msg => msg.channel_id === ch.id && !msg.is_deleted);
      const unread = chMsgs.filter(msg => msg.created_at > m.last_read_at).length;
      const last = chMsgs.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return {
        ...ch,
        unread_count: unread,
        last_message_body: last?.body ?? null,
        last_message_at: last?.created_at ?? null,
        last_message_sender_id: last?.sender_id ?? null,
      };
    });
    return { data: result, error: null };
  }

  // List messages (simplified — just filter by channel)
  if (t.includes('FROM messaging.messages m') && t.includes('WHERE m.channel_id')) {
    const channelId = p[0];
    const limit = Number(p[1]) || 51;
    let filtered = messages
      .filter(m => m.channel_id === channelId && !m.is_deleted && m.parent_message_id === null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    // cursor support
    if (p[2]) {
      const cursorMsg = messages.find(m => m.id === p[2]);
      if (cursorMsg) {
        filtered = filtered.filter(m => m.created_at < cursorMsg.created_at);
      }
    }

    const result = filtered.slice(0, limit).map(m => ({
      ...m,
      reply_count: messages.filter(r => r.parent_message_id === m.id && !r.is_deleted).length,
    }));
    return { data: result, error: null };
  }

  return { data: null, error: null };
}

// ─── Build service instance ──────────────────────────────────

import { MessagingService } from '../../src/messaging/messaging.service';

const stubDb = { rawQuery: stubRawQuery } as any;
const stubSchema = { ensureSchema: async () => {} } as any;

const service = Object.create(MessagingService.prototype) as MessagingService;
(service as any).db = stubDb;
(service as any).schema = stubSchema;
(service as any).logger = { log: () => {}, error: () => {}, warn: () => {} };

// ─── Tests ───────────────────────────────────────────────────

(async () => {
  console.log('createChannel():');
  {
    const ch = await service.createChannel('system', undefined, 'announcements');
    assert(typeof ch.id === 'string', 'returns channel with id');
    assert(ch.scope === 'system', 'correct scope');
    assert(ch.name === 'announcements', 'correct name');
    assert(ch.is_archived === false, 'not archived');
  }

  console.log('\naddChannelMember():');
  {
    const chId = channels[0].id;
    await service.addChannelMember(chId, 'user-1', 'admin');
    await service.addChannelMember(chId, 'user-2', 'member');
    assert(members.length === 2, 'two members added');
    assert(members[0].role === 'admin', 'first member is admin');
    assert(members[1].role === 'member', 'second member is member');
  }

  console.log('\naddChannelMember() duplicate:');
  {
    const chId = channels[0].id;
    await service.addChannelMember(chId, 'user-1', 'admin');
    assert(members.length === 2, 'duplicate member not added');
  }

  console.log('\ngetChannel():');
  {
    const ch = await service.getChannel(channels[0].id, 'user-1');
    assert(ch.id === channels[0].id, 'returns correct channel');
    assert(ch.scope === 'system', 'correct scope');
  }

  console.log('\ngetChannel() non-member:');
  {
    let threw = false;
    try {
      await service.getChannel(channels[0].id, 'user-999');
    } catch (e: any) {
      threw = true;
      assert(e.message.includes('Not a member') || e.status === 403, 'throws forbidden for non-member');
    }
    assert(threw, 'did throw');
  }

  console.log('\nsendMessage():');
  {
    const msg = await service.sendMessage(channels[0].id, 'user-1', 'Hello world');
    assert(typeof msg.id === 'string', 'returns message with id');
    assert(msg.channel_id === channels[0].id, 'correct channel_id');
    assert(msg.sender_id === 'user-1', 'correct sender_id');
    assert(msg.body === 'Hello world', 'correct body');
    assert(msg.is_deleted === false, 'not deleted');
  }

  console.log('\nsendMessage() empty body:');
  {
    let threw = false;
    try {
      await service.sendMessage(channels[0].id, 'user-1', '   ');
    } catch (e: any) {
      threw = true;
    }
    assert(threw, 'throws on empty body');
  }

  console.log('\nsendMessage() non-member:');
  {
    let threw = false;
    try {
      await service.sendMessage(channels[0].id, 'user-999', 'Sneaky');
    } catch {
      threw = true;
    }
    assert(threw, 'throws for non-member');
  }

  console.log('\nlistMessages():');
  {
    // Send a few more messages
    await service.sendMessage(channels[0].id, 'user-2', 'Reply 1');
    await service.sendMessage(channels[0].id, 'user-1', 'Reply 2');

    const result = await service.listMessages(channels[0].id, 'user-1');
    assert(result.data.length === 3, 'returns 3 messages');
    assert(result.has_more === false, 'no more pages');
    // Newest first
    assert(result.data[0].body === 'Reply 2', 'newest message first');
    assert(result.data[2].body === 'Hello world', 'oldest message last');
  }

  console.log('\nlistMessages() pagination:');
  {
    const result = await service.listMessages(channels[0].id, 'user-1', { limit: 2 });
    assert(result.data.length === 2, 'returns 2 messages');
    assert(result.has_more === true, 'has more');
  }

  console.log('\nlistChannels():');
  {
    const chs = await service.listChannels('user-1');
    assert(chs.length === 1, 'user-1 has 1 channel');
    assert(chs[0].unread_count >= 0, 'has unread_count');
    assert(chs[0].last_message_body !== null, 'has last message');
  }

  console.log('\nlistChannels() no channels:');
  {
    const chs = await service.listChannels('user-999');
    assert(chs.length === 0, 'unknown user has 0 channels');
  }

  // ─── Results ───────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
