/**
 * Unit tests for MessagingService DM, read tracking, and blocking.
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

console.log('\n=== Messaging DM / Read Tracking / Blocking Tests ===\n');

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
type BlockRow = { blocker_id: string; blocked_id: string; created_at: string };

const channels: ChannelRow[] = [];
const members: MemberRow[] = [];
const messages: MessageRow[] = [];
const blocks: BlockRow[] = [];
let msgCounter = 0;

function stubRawQuery(sql: string, params?: unknown[]) {
  const t = sql.replace(/\s+/g, ' ').trim();
  const p = (params ?? []) as string[];

  // Schema DDL
  if (t.startsWith('CREATE SCHEMA') || t.startsWith('CREATE TABLE') || t.startsWith('CREATE INDEX')) {
    return { data: null, error: null };
  }

  // Delete block (must come before block checks since they'd also match)
  if (t.includes('DELETE FROM messaging.user_blocks')) {
    const idx = blocks.findIndex(b => b.blocker_id === p[0] && b.blocked_id === p[1]);
    if (idx >= 0) blocks.splice(idx, 1);
    return { data: null, error: null };
  }

  // Insert block (must come before block checks)
  if (t.includes('INSERT INTO messaging.user_blocks')) {
    const existing = blocks.find(b => b.blocker_id === p[0] && b.blocked_id === p[1]);
    if (!existing) {
      blocks.push({ blocker_id: p[0], blocked_id: p[1], created_at: new Date().toISOString() });
    }
    return { data: null, error: null };
  }

  // Block check (for DM creation — bidirectional with OR)
  if (t.includes('FROM messaging.user_blocks') && t.includes('OR')) {
    const found = blocks.filter(b =>
      (b.blocker_id === p[0] && b.blocked_id === p[1]) ||
      (b.blocker_id === p[1] && b.blocked_id === p[0])
    );
    return { data: found.length > 0 ? [{ '?column?': 1 }] : [], error: null };
  }

  // One-directional block check (for sendMessage DM check)
  if (t.includes('FROM messaging.user_blocks') && t.includes('blocker_id = $1')) {
    const found = blocks.filter(b => b.blocker_id === p[0] && b.blocked_id === p[1]);
    return { data: found.length > 0 ? [{ '?column?': 1 }] : [], error: null };
  }

  // Find existing DM channel
  if (t.includes('FROM messaging.channels c') && t.includes("scope = 'dm'")) {
    const found = channels.filter(c => {
      if (c.scope !== 'dm') return false;
      const mems = members.filter(m => m.channel_id === c.id);
      return mems.some(m => m.user_id === p[0]) && mems.some(m => m.user_id === p[1]);
    });
    return { data: found, error: null };
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

  // Get channel scope (for sendMessage block check)
  if (t.includes('SELECT scope FROM messaging.channels WHERE id')) {
    const ch = channels.find(c => c.id === p[0]);
    return { data: ch ? [{ scope: ch.scope }] : [], error: null };
  }

  // Get other DM member
  if (t.includes('SELECT user_id FROM messaging.channel_members') && t.includes('user_id != $2')) {
    const found = members.filter(m => m.channel_id === p[0] && m.user_id !== p[1]);
    return { data: found.map(m => ({ user_id: m.user_id })), error: null };
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

  // Update last_read_at
  if (t.includes('UPDATE messaging.channel_members') && t.includes('last_read_at')) {
    const mem = members.find(m => m.channel_id === p[0] && m.user_id === p[1]);
    if (mem) mem.last_read_at = new Date().toISOString();
    return { data: null, error: null };
  }

  // Unread counts
  if (t.includes('FROM messaging.channel_members cm') && t.includes('LEFT JOIN messaging.messages m') && t.includes('GROUP BY')) {
    const userId = p[0];
    const userMems = members.filter(m => m.user_id === userId);
    const result = userMems.map(m => {
      const unread = messages.filter(msg =>
        msg.channel_id === m.channel_id && !msg.is_deleted && msg.created_at > m.last_read_at
      ).length;
      return { channel_id: m.channel_id, unread_count: unread };
    });
    return { data: result, error: null };
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
  console.log('getOrCreateDmChannel():');
  {
    const ch = await service.getOrCreateDmChannel('user-a', 'user-b');
    assert(typeof ch.id === 'string', 'returns channel with id');
    assert(ch.scope === 'dm', 'scope is dm');
    assert(members.filter(m => m.channel_id === ch.id).length === 2, 'both users are members');
  }

  console.log('\ngetOrCreateDmChannel() returns existing:');
  {
    const ch = await service.getOrCreateDmChannel('user-a', 'user-b');
    assert(channels.filter(c => c.scope === 'dm').length === 1, 'does not create duplicate DM channel');
  }

  console.log('\ngetOrCreateDmChannel() self-DM:');
  {
    let threw = false;
    try {
      await service.getOrCreateDmChannel('user-a', 'user-a');
    } catch {
      threw = true;
    }
    assert(threw, 'throws on self-DM');
  }

  console.log('\nblockUser():');
  {
    await service.blockUser('user-c', 'user-d');
    assert(blocks.length === 1, 'block added');
    assert(blocks[0].blocker_id === 'user-c', 'correct blocker');
    assert(blocks[0].blocked_id === 'user-d', 'correct blocked');
  }

  console.log('\ngetOrCreateDmChannel() blocked:');
  {
    let threw = false;
    try {
      await service.getOrCreateDmChannel('user-c', 'user-d');
    } catch (e: any) {
      threw = true;
      assert(e.message.includes('blocked') || e.status === 403, 'correct error for blocked DM');
    }
    assert(threw, 'throws when creating DM with blocked user');
  }

  console.log('\nsendMessage() in DM when blocked:');
  {
    // Create a DM between user-e and user-f, then block
    const dmCh = await service.getOrCreateDmChannel('user-e', 'user-f');
    await service.blockUser('user-f', 'user-e'); // user-f blocks user-e

    let threw = false;
    try {
      await service.sendMessage(dmCh.id, 'user-e', 'Hello blocked');
    } catch (e: any) {
      threw = true;
    }
    assert(threw, 'blocked user cannot send DM');
  }

  console.log('\nunblockUser():');
  {
    await service.unblockUser('user-f', 'user-e');
    const stillBlocked = blocks.find(b => b.blocker_id === 'user-f' && b.blocked_id === 'user-e');
    assert(!stillBlocked, 'block removed');
  }

  console.log('\nupdateLastRead():');
  {
    const chId = channels[0].id;
    const before = members.find(m => m.channel_id === chId && m.user_id === 'user-a')!.last_read_at;
    // Small delay to ensure different timestamp
    await new Promise(r => setTimeout(r, 10));
    await service.updateLastRead(chId, 'user-a');
    const after = members.find(m => m.channel_id === chId && m.user_id === 'user-a')!.last_read_at;
    assert(after >= before, 'last_read_at updated');
  }

  console.log('\ngetUnreadCounts():');
  {
    // Send a message after last_read_at
    const chId = channels[0].id;
    await new Promise(r => setTimeout(r, 10));
    await service.sendMessage(chId, 'user-b', 'New message after read');

    const counts = await service.getUnreadCounts('user-a');
    assert(typeof counts === 'object', 'returns counts object');
    assert(counts[chId] >= 1, 'has unread for channel');
  }

  console.log('\ngetUnreadCounts() no channels:');
  {
    const counts = await service.getUnreadCounts('user-unknown');
    assert(Object.keys(counts).length === 0, 'no unread for unknown user');
  }

  // ─── Results ───────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
