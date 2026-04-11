/**
 * Unit tests for MessagingService threading, reactions, and pinning.
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

console.log('\n=== Messaging Threads / Reactions / Pins Tests ===\n');

// ─── In-memory store ─────────────────────────────────────────

type ChannelRow = { id: string; scope: string; scope_id: string | null; name: string | null; is_archived: boolean; created_at: string };
type MemberRow = { channel_id: string; user_id: string; role: string; last_read_at: string; is_blocked: boolean };
type MessageRow = { id: string; channel_id: string; sender_id: string; body: string; parent_message_id: string | null; attached_entity_type: string | null; attached_entity_id: string | null; is_pinned: boolean; is_deleted: boolean; created_at: string };
type ReactionRow = { message_id: string; user_id: string; emoji: string; created_at: string };

const channels: ChannelRow[] = [];
const members: MemberRow[] = [];
const messages: MessageRow[] = [];
const reactions: ReactionRow[] = [];
let msgCounter = 0;

function stubRawQuery(sql: string, params?: unknown[]) {
  const t = sql.replace(/\s+/g, ' ').trim();
  const p = (params ?? []) as string[];

  if (t.startsWith('CREATE SCHEMA') || t.startsWith('CREATE TABLE') || t.startsWith('CREATE INDEX')) {
    return { data: null, error: null };
  }

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

  // Get message channel_id (for reaction membership check)
  if (t.includes('SELECT channel_id FROM messaging.messages WHERE id')) {
    const msg = messages.find(m => m.id === p[0]);
    return { data: msg ? [{ channel_id: msg.channel_id }] : [], error: null };
  }

  // Get message for pin toggle
  if (t.includes('SELECT m.channel_id, m.is_pinned FROM messaging.messages')) {
    const msg = messages.find(m => m.id === p[0]);
    return { data: msg ? [{ channel_id: msg.channel_id, is_pinned: msg.is_pinned }] : [], error: null };
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

  // Get thread replies
  if (t.includes('FROM messaging.messages') && t.includes('parent_message_id = $2') && t.includes('ORDER BY created_at ASC')) {
    const channelId = p[0];
    const parentId = p[1];
    const found = messages.filter(m => m.channel_id === channelId && m.parent_message_id === parentId && !m.is_deleted);
    found.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { data: found, error: null };
  }

  // Insert reaction
  if (t.includes('INSERT INTO messaging.message_reactions')) {
    const existing = reactions.find(r => r.message_id === p[0] && r.user_id === p[1] && r.emoji === p[2]);
    if (!existing) {
      reactions.push({ message_id: p[0], user_id: p[1], emoji: p[2], created_at: new Date().toISOString() });
    }
    return { data: null, error: null };
  }

  // Delete reaction
  if (t.includes('DELETE FROM messaging.message_reactions')) {
    const idx = reactions.findIndex(r => r.message_id === p[0] && r.user_id === p[1] && r.emoji === p[2]);
    if (idx >= 0) reactions.splice(idx, 1);
    return { data: null, error: null };
  }

  // Get reactions
  if (t.includes('FROM messaging.message_reactions') && t.includes('GROUP BY')) {
    const msgIds = p.slice(0, -1);
    const userId = p[p.length - 1];
    const filtered = reactions.filter(r => msgIds.includes(r.message_id));
    const grouped: Record<string, Record<string, { count: number; user_reacted: boolean }>> = {};
    for (const r of filtered) {
      if (!grouped[r.message_id]) grouped[r.message_id] = {};
      if (!grouped[r.message_id][r.emoji]) grouped[r.message_id][r.emoji] = { count: 0, user_reacted: false };
      grouped[r.message_id][r.emoji].count++;
      if (r.user_id === userId) grouped[r.message_id][r.emoji].user_reacted = true;
    }
    const result: Array<{ message_id: string; emoji: string; count: number; user_reacted: boolean }> = [];
    for (const [msgId, emojis] of Object.entries(grouped)) {
      for (const [emoji, data] of Object.entries(emojis)) {
        result.push({ message_id: msgId, emoji, count: data.count, user_reacted: data.user_reacted });
      }
    }
    return { data: result, error: null };
  }

  // Update pin
  if (t.includes('UPDATE messaging.messages SET is_pinned')) {
    const newPinned = p[0] === 'true' || p[0] === true;
    const msg = messages.find(m => m.id === p[1]);
    if (msg) msg.is_pinned = newPinned as boolean;
    return { data: null, error: null };
  }

  // Get pinned messages
  if (t.includes('FROM messaging.messages') && t.includes('is_pinned = true')) {
    const channelId = p[0];
    const found = messages.filter(m => m.channel_id === channelId && m.is_pinned && !m.is_deleted);
    return { data: found, error: null };
  }

  // List messages (for reply_count)
  if (t.includes('FROM messaging.messages m') && t.includes('WHERE m.channel_id')) {
    const channelId = p[0];
    const limit = Number(p[1]) || 51;
    const filtered = messages
      .filter(m => m.channel_id === channelId && !m.is_deleted && m.parent_message_id === null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const result = filtered.slice(0, limit).map(m => ({
      ...m,
      reply_count: messages.filter(r => r.parent_message_id === m.id && !r.is_deleted).length,
    }));
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
  // Setup: create channel with admin and member
  const ch = await service.createChannel('club', 'club-1', 'Test Club');
  await service.addChannelMember(ch.id, 'admin-1', 'admin');
  await service.addChannelMember(ch.id, 'user-1', 'member');

  // Send parent message
  const parent = await service.sendMessage(ch.id, 'user-1', 'Parent message');

  console.log('Thread replies:');
  {
    // Send replies
    const reply1 = await service.sendMessage(ch.id, 'admin-1', 'Reply 1', { parent_message_id: parent.id });
    const reply2 = await service.sendMessage(ch.id, 'user-1', 'Reply 2', { parent_message_id: parent.id });

    const replies = await service.getThreadReplies(ch.id, parent.id, 'user-1');
    assert(replies.length === 2, 'two replies returned');
    assert(replies[0].body === 'Reply 1', 'replies in chronological order');
    assert(replies[1].body === 'Reply 2', 'second reply correct');
  }

  console.log('\nReply count in listMessages:');
  {
    const result = await service.listMessages(ch.id, 'user-1');
    const parentInList = result.data.find((m: any) => m.id === parent.id);
    assert(parentInList !== undefined, 'parent message in list');
    assert((parentInList as any).reply_count === 2, 'reply_count is 2');
  }

  console.log('\nAdd reaction:');
  {
    await service.addReaction(parent.id, 'user-1', '👍');
    await service.addReaction(parent.id, 'admin-1', '👍');
    await service.addReaction(parent.id, 'user-1', '🎉');
    assert(reactions.length === 3, 'three reactions stored');
  }

  console.log('\nAdd duplicate reaction:');
  {
    await service.addReaction(parent.id, 'user-1', '👍');
    assert(reactions.length === 3, 'duplicate not added');
  }

  console.log('\nGet reactions:');
  {
    const rxns = await service.getReactions([parent.id], 'user-1');
    assert(rxns[parent.id] !== undefined, 'reactions returned for message');
    const thumbs = rxns[parent.id].find(r => r.emoji === '👍');
    assert(thumbs !== undefined, 'thumbs up found');
    assert(thumbs!.count === 2, 'thumbs up count is 2');
    assert(thumbs!.user_reacted === true, 'user-1 reacted with thumbs up');
    const party = rxns[parent.id].find(r => r.emoji === '🎉');
    assert(party !== undefined, 'party found');
    assert(party!.count === 1, 'party count is 1');
  }

  console.log('\nRemove reaction:');
  {
    await service.removeReaction(parent.id, 'user-1', '👍');
    assert(reactions.length === 2, 'reaction removed');
    const rxns = await service.getReactions([parent.id], 'user-1');
    const thumbs = rxns[parent.id].find(r => r.emoji === '👍');
    assert(thumbs!.count === 1, 'thumbs count decremented to 1');
    assert(thumbs!.user_reacted === false, 'user-1 no longer reacted');
  }

  console.log('\nToggle pin (admin):');
  {
    const result = await service.togglePin(parent.id, 'admin-1');
    assert(result.is_pinned === true, 'message pinned');
    const pinned = await service.getPinnedMessages(ch.id, 'user-1');
    assert(pinned.length === 1, 'one pinned message');
    assert(pinned[0].id === parent.id, 'correct message pinned');
  }

  console.log('\nToggle pin (unpin):');
  {
    const result = await service.togglePin(parent.id, 'admin-1');
    assert(result.is_pinned === false, 'message unpinned');
    const pinned = await service.getPinnedMessages(ch.id, 'user-1');
    assert(pinned.length === 0, 'no pinned messages');
  }

  console.log('\nToggle pin (non-admin):');
  {
    let threw = false;
    try {
      await service.togglePin(parent.id, 'user-1');
    } catch {
      threw = true;
    }
    assert(threw, 'non-admin cannot pin');
  }

  // ─── Results ───────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
