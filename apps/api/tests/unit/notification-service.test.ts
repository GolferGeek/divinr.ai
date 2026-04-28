/**
 * Unit tests for NotificationService.
 * Uses an in-memory stub for DatabaseService to test insert, query, update logic.
 */
import type { Notification, NotificationEventType, NotificationUrgency } from '../../src/markets/markets.types';

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

console.log('\n=== Notification Service Tests ===\n');

// ─── In-memory store to simulate the database ─────────────────
type Row = {
  id: string;
  user_id: string;
  event_type: string;
  urgency: string;
  title: string;
  summary: string | null;
  link_to: string;
  is_read: boolean;
  created_at: string;
};

const rows: Row[] = [];

function isVisibleNotification(row: Row): boolean {
  return new Date(row.created_at).getTime() >= Date.now() - 24 * 60 * 60 * 1000;
}

function stubRawQuery(sql: string, params?: unknown[]) {
  const trimmed = sql.replace(/\s+/g, ' ').trim();

  if (trimmed.startsWith('insert into prediction.notifications')) {
    const p = params as string[];
    rows.push({
      id: p[0],
      user_id: p[1],
      event_type: p[2],
      urgency: p[3],
      title: p[4],
      summary: p[5] ?? null,
      link_to: p[6],
      is_read: false,
      created_at: new Date().toISOString(),
    });
    return { data: null, error: null };
  }

  if (trimmed.startsWith('select * from prediction.notifications')) {
    const userId = (params as string[])[0];
    let filtered = rows.filter((r) => r.user_id === userId);
    if (trimmed.includes('is_read = false')) {
      filtered = filtered.filter((r) => !r.is_read);
    }
    if (trimmed.includes('created_at >=')) {
      filtered = filtered.filter(isVisibleNotification);
    }
    filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { data: filtered.slice(0, 100), error: null };
  }

  if (trimmed.startsWith('select count(*)')) {
    const userId = (params as string[])[0];
    const requiresVisible = trimmed.includes('created_at >=');
    const count = rows.filter((r) => (
      r.user_id === userId
      && !r.is_read
      && (!requiresVisible || isVisibleNotification(r))
    )).length;
    return { data: [{ cnt: String(count) }], error: null };
  }

  if (trimmed.startsWith('update prediction.notifications') && trimmed.includes('where id =')) {
    const p = params as string[];
    const row = rows.find((r) => r.id === p[0] && r.user_id === p[1]);
    if (row) row.is_read = true;
    return { data: null, error: null };
  }

  if (trimmed.startsWith('update prediction.notifications') && trimmed.includes('where user_id =')) {
    const userId = (params as string[])[0];
    for (const r of rows) {
      if (r.user_id === userId && !r.is_read) r.is_read = true;
    }
    return { data: null, error: null };
  }

  // Schema DDL — no-op
  return { data: null, error: null };
}

// ─── Build a minimal NotificationService instance ─────────────
// We import the class and construct it with stubs rather than
// using NestJS DI, since these are fast unit tests.

import { NotificationService } from '../../src/markets/services/notification.service';

const stubDb = { rawQuery: stubRawQuery } as any;
const stubSchema = { ensureSchema: async () => {} } as any;

// Construct via Object.create to bypass constructor DI
const service = Object.create(NotificationService.prototype) as NotificationService;
(service as any).db = stubDb;
(service as any).schema = stubSchema;
(service as any).logger = { log: () => {}, error: () => {}, warn: () => {} };

// ─── Tests ────────────────────────────────────────────────────

(async () => {
  console.log('notify():');
  {
    const id = await service.notify('user-1', {
      event_type: 'stop_loss',
      urgency: 'immediate',
      title: 'AAPL stop-loss triggered',
      summary: 'Position closed at $145.20',
      link_to: '/portfolios',
    });
    assert(typeof id === 'string' && id.length > 0, 'returns a notification id');
    assert(rows.length === 1, 'inserted one row');
    assert(rows[0].user_id === 'user-1', 'correct user_id');
    assert(rows[0].event_type === 'stop_loss', 'correct event_type');
    assert(rows[0].urgency === 'immediate', 'correct urgency');
    assert(rows[0].title === 'AAPL stop-loss triggered', 'correct title');
    assert(rows[0].summary === 'Position closed at $145.20', 'correct summary');
    assert(rows[0].link_to === '/portfolios', 'correct link_to');
    assert(rows[0].is_read === false, 'is_read defaults to false');
  }

  console.log('\nnotify() with no summary:');
  {
    await service.notify('user-1', {
      event_type: 'nightly_eval',
      urgency: 'informational',
      title: 'Nightly evaluation complete',
      link_to: '/evaluations',
    });
    assert(rows.length === 2, 'second row inserted');
    assert(rows[1].summary === null, 'summary is null when omitted');
  }

  console.log('\nnotify() for different user:');
  {
    await service.notify('user-2', {
      event_type: 'trade_recommendation',
      urgency: 'actionable',
      title: 'TSLA buy recommendation',
      summary: 'Kelly fraction: 0.12',
      link_to: '/portfolios',
    });
    assert(rows.length === 3, 'third row inserted');
  }

  console.log('\ngetNotifications():');
  {
    const all = await service.getNotifications('user-1');
    assert(all.length === 2, 'user-1 has 2 notifications');
    assert(all.every((n: Notification) => n.user_id === 'user-1'), 'all belong to user-1');
  }

  console.log('\ngetNotifications(unreadOnly):');
  {
    const unread = await service.getNotifications('user-1', true);
    assert(unread.length === 2, 'user-1 has 2 unread');
  }

  console.log('\ngetUnreadCount():');
  {
    const count = await service.getUnreadCount('user-1');
    assert(count === 2, 'user-1 unread count is 2');

    const count2 = await service.getUnreadCount('user-2');
    assert(count2 === 1, 'user-2 unread count is 1');

    const count3 = await service.getUnreadCount('user-999');
    assert(count3 === 0, 'non-existent user has 0 unread');
  }

  console.log('\nmarkRead():');
  {
    const targetId = rows[0].id;
    await service.markRead(targetId, 'user-1');
    assert(rows[0].is_read === true, 'first notification marked as read');

    const count = await service.getUnreadCount('user-1');
    assert(count === 1, 'user-1 unread count decremented to 1');
  }

  console.log('\nmarkRead() wrong user:');
  {
    const targetId = rows[2].id; // belongs to user-2
    await service.markRead(targetId, 'user-1'); // wrong user
    assert(rows[2].is_read === false, 'notification not marked read for wrong user');
  }

  console.log('\nmarkAllRead():');
  {
    // Add a couple more for user-1
    await service.notify('user-1', {
      event_type: 'contrarian_alert',
      urgency: 'actionable',
      title: 'Contrarian alert: GOOG',
      link_to: '/affinity',
    });
    await service.notify('user-1', {
      event_type: 'tier3_proposal',
      urgency: 'actionable',
      title: 'Strategic proposal: MSFT analyst',
      link_to: '/proposals',
    });

    const beforeCount = await service.getUnreadCount('user-1');
    assert(beforeCount === 3, 'user-1 has 3 unread before markAllRead');

    await service.markAllRead('user-1');
    const afterCount = await service.getUnreadCount('user-1');
    assert(afterCount === 0, 'user-1 has 0 unread after markAllRead');

    // Verify user-2 unaffected
    const user2Count = await service.getUnreadCount('user-2');
    assert(user2Count === 1, 'user-2 unread count unchanged');
  }

  console.log('\n24-hour visibility cutoff:');
  {
    rows.length = 0;
    rows.push({
      id: 'fresh',
      user_id: 'user-cutoff',
      event_type: 'fear_greed_alert',
      urgency: 'immediate',
      title: 'Fresh notification',
      summary: null,
      link_to: '/notifications',
      is_read: false,
      created_at: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
    });
    rows.push({
      id: 'old',
      user_id: 'user-cutoff',
      event_type: 'fear_greed_alert',
      urgency: 'immediate',
      title: 'Old notification',
      summary: null,
      link_to: '/notifications',
      is_read: false,
      created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });

    const visible = await service.getNotifications('user-cutoff');
    assert(visible.length === 1, 'only notifications from last 24 hours are visible');
    assert(visible[0].id === 'fresh', 'old notification hidden from list');

    const visibleUnread = await service.getNotifications('user-cutoff', true);
    assert(visibleUnread.length === 1, 'old unread notification hidden from unread list');

    const count = await service.getUnreadCount('user-cutoff');
    assert(count === 1, 'old unread notification excluded from unread count');
  }

  // ─── Results ──────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
