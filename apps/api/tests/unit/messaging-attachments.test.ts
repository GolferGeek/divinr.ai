/**
 * Unit tests for MessagingService entity attachments.
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

console.log('\n=== Messaging Attachments Tests ===\n');

// ─── In-memory store ─────────────────────────────────────────

type ChannelRow = { id: string; scope: string; scope_id: string | null; name: string | null; is_archived: boolean; created_at: string };
type MemberRow = { channel_id: string; user_id: string; role: string; last_read_at: string; is_blocked: boolean };
type MessageRow = { id: string; channel_id: string; sender_id: string; body: string; parent_message_id: string | null; attached_entity_type: string | null; attached_entity_id: string | null; is_pinned: boolean; is_deleted: boolean; created_at: string };

const channels: ChannelRow[] = [];
const members: MemberRow[] = [];
const messages: MessageRow[] = [];
let msgCounter = 0;

// Fake entity tables
const instruments = [{ id: 'inst-1', symbol: 'AAPL', name: 'Apple Inc.', asset_type: 'stock' }];
const analysts = [{ id: 'analyst-1', display_name: 'Bullseye', analyst_type: 'personality', workflow_scope: 'prediction' }];
const predictions = [{ id: 'pred-1', predicted_direction: 'up', confidence: 85, analyst_id: 'analyst-1', instrument_id: 'inst-1', horizon_minutes: 60 }];
const positions = [{ id: 'pos-1', symbol: 'AAPL', direction: 'long', entry_price: 150, current_price: 155, unrealized_pnl: 5, status: 'open' }];

function stubRawQuery(sql: string, params?: unknown[]) {
  const t = sql.replace(/\s+/g, ' ').trim();
  const p = (params ?? []) as string[];

  if (t.startsWith('CREATE')) return { data: null, error: null };

  // Entity lookups
  if (t.includes('FROM prediction.instruments WHERE id')) {
    const found = instruments.filter(i => i.id === p[0]);
    return { data: found, error: null };
  }
  if (t.includes('FROM prediction.market_analysts WHERE id')) {
    const found = analysts.filter(a => a.id === p[0]);
    return { data: found, error: null };
  }
  if (t.includes('FROM prediction.market_predictions WHERE id')) {
    const found = predictions.filter(pr => pr.id === p[0]);
    return { data: found, error: null };
  }
  if (t.includes('FROM prediction.user_positions WHERE id')) {
    const found = positions.filter(po => po.id === p[0]);
    return { data: found, error: null };
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

  // Verify membership
  if (t.includes('SELECT 1 FROM messaging.channel_members')) {
    const found = members.filter(m => m.channel_id === p[0] && m.user_id === p[1]);
    return { data: found.length > 0 ? [{ '?column?': 1 }] : [], error: null };
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
  const ch = await service.createChannel('club', 'club-1', 'Test');
  await service.addChannelMember(ch.id, 'user-1', 'admin');

  console.log('resolveAttachment() — instrument:');
  {
    const att = await service.resolveAttachment('instrument', 'inst-1', 'user-1');
    assert(att !== null, 'returns attachment');
    assert(att!.entity_type === 'instrument', 'correct type');
    assert(att!.symbol === 'AAPL', 'correct symbol');
    assert(att!.name === 'Apple Inc.', 'correct name');
  }

  console.log('\nresolveAttachment() — analyst:');
  {
    const att = await service.resolveAttachment('analyst', 'analyst-1', 'user-1');
    assert(att !== null, 'returns attachment');
    assert(att!.display_name === 'Bullseye', 'correct display_name');
    assert(att!.analyst_type === 'personality', 'correct analyst_type');
  }

  console.log('\nresolveAttachment() — prediction:');
  {
    const att = await service.resolveAttachment('prediction', 'pred-1', 'user-1');
    assert(att !== null, 'returns attachment');
    assert(att!.predicted_direction === 'up', 'correct direction');
    assert(att!.confidence === 85, 'correct confidence');
  }

  console.log('\nresolveAttachment() — position:');
  {
    const att = await service.resolveAttachment('position', 'pos-1', 'user-1');
    assert(att !== null, 'returns attachment');
    assert(att!.symbol === 'AAPL', 'correct symbol');
    assert(att!.direction === 'long', 'correct direction');
  }

  console.log('\nresolveAttachment() — tournament (stub):');
  {
    const att = await service.resolveAttachment('tournament', 'tour-1', 'user-1');
    assert(att !== null, 'returns stub');
    assert(att!.entity_type === 'tournament', 'correct type');
  }

  console.log('\nresolveAttachment() — not found:');
  {
    const att = await service.resolveAttachment('instrument', 'nonexistent', 'user-1');
    assert(att === null, 'returns null for unknown entity');
  }

  console.log('\nvalidateAndResolveAttachment() — valid:');
  {
    const att = await service.validateAndResolveAttachment('instrument', 'inst-1', 'user-1');
    assert(att !== null, 'valid entity resolves');
  }

  console.log('\nvalidateAndResolveAttachment() — invalid:');
  {
    let threw = false;
    try {
      await service.validateAndResolveAttachment('instrument', 'nonexistent', 'user-1');
    } catch {
      threw = true;
    }
    assert(threw, 'throws for invalid entity');
  }

  console.log('\nsendMessage() with valid attachment:');
  {
    const msg = await service.sendMessage(ch.id, 'user-1', 'Check this stock', {
      attached_entity_type: 'instrument',
      attached_entity_id: 'inst-1',
    });
    assert(msg.attached_entity_type === 'instrument', 'attachment type stored');
    assert(msg.attached_entity_id === 'inst-1', 'attachment id stored');
  }

  console.log('\nsendMessage() with invalid attachment:');
  {
    let threw = false;
    try {
      await service.sendMessage(ch.id, 'user-1', 'Bad ref', {
        attached_entity_type: 'instrument',
        attached_entity_id: 'nonexistent',
      });
    } catch {
      threw = true;
    }
    assert(threw, 'rejects invalid attachment');
  }

  console.log('\nvalidateAndResolveAttachment() — no attachment:');
  {
    const att = await service.validateAndResolveAttachment(undefined, undefined, 'user-1');
    assert(att === null, 'null when no attachment');
  }

  // ─── Results ───────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
