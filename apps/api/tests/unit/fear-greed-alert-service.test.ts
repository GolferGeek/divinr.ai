/**
 * Unit tests for FearGreedAlertService.
 * Uses an in-memory stub for DatabaseService to test alert generation,
 * deduplication, cap enforcement, and trade rec inclusion.
 */
import type { FearGreedAlert } from '../../src/markets/markets.types';
import { FearGreedAlertService } from '../../src/markets/services/fear-greed-alert.service';

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

console.log('\n=== Fear/Greed Alert Service Tests ===\n');

// ─── In-memory stores ──────────────────────────────────────────
type AlertRow = FearGreedAlert;
type NotificationRow = { id: string; user_id: string; event_type: string; urgency: string; title: string; summary: string | null; link_to: string };
type PredictorRow = {
  id: string; instrument_id: string; crowd_reaction: string;
  crowd_reaction_confidence: number; crowd_reaction_rationale: string | null;
  estimated_reaction_window_minutes: number | null;
  symbol: string; instrument_name: string;
};

const alerts: AlertRow[] = [];
const notifications: NotificationRow[] = [];
const predictors: PredictorRow[] = [];
const positions: Array<{ user_id: string; instrument_id: string; status: string }> = [];
const tradeQueue: Array<{ user_id: string; instrument_id: string; status: string }> = [];
const portfolios: Array<{ user_id: string }> = [];
const tradeRecs: Array<{
  instrument_id: string; direction: string; entry_price: number;
  stop_loss_price: number | null; take_profit_price: number | null; created_at: string;
}> = [];

let notifCounter = 0;

function stubRawQuery(sql: string, params?: unknown[]) {
  const trimmed = sql.replace(/\s+/g, ' ').trim();

  // Predictor queries
  if (trimmed.includes('from prediction.market_predictors mp') && trimmed.includes('join prediction.instruments i')) {
    const ids = params as string[];
    const matches = predictors.filter(p => ids.includes(p.id)
      && ['fear_trigger', 'greed_trigger'].includes(p.crowd_reaction)
      && p.crowd_reaction_confidence >= 0.7);
    return {
      data: matches.map(p => ({
        predictor_id: p.id, instrument_id: p.instrument_id,
        crowd_reaction: p.crowd_reaction, crowd_reaction_confidence: p.crowd_reaction_confidence,
        crowd_reaction_rationale: p.crowd_reaction_rationale,
        estimated_reaction_window_minutes: p.estimated_reaction_window_minutes,
        symbol: p.symbol, instrument_name: p.instrument_name,
      })),
      error: null,
    };
  }

  // User positions + trade queue union
  if (trimmed.includes('from prediction.user_positions') && trimmed.includes('union')) {
    const instId = (params as string[])[0];
    const posUsers = positions.filter(p => p.instrument_id === instId && p.status === 'open').map(p => ({ user_id: p.user_id }));
    const queueUsers = tradeQueue.filter(t => t.instrument_id === instId && t.status === 'queued').map(t => ({ user_id: t.user_id }));
    const uniqueUsers = [...new Map([...posUsers, ...queueUsers].map(u => [u.user_id, u])).values()];
    return { data: uniqueUsers, error: null };
  }

  // Fallback: all portfolio users
  if (trimmed.includes('from prediction.user_portfolios')) {
    return { data: portfolios.map(p => ({ user_id: p.user_id })), error: null };
  }

  // Check existing alert (idempotency)
  if (trimmed.includes('from prediction.fear_greed_alerts') && trimmed.includes('predictor_id = $1 and user_id = $2')) {
    const [predictorId, userId] = params as string[];
    const existing = alerts.filter(a => a.predictor_id === predictorId && a.user_id === userId);
    return { data: existing.length > 0 ? [{ _: 1 }] : [], error: null };
  }

  // Unread count
  if (trimmed.includes('count(*)') && trimmed.includes('from prediction.fear_greed_alerts')) {
    const userId = (params as string[])[0];
    const count = alerts.filter(a => a.user_id === userId && !a.is_read).length;
    return { data: [{ cnt: String(count) }], error: null };
  }

  // Insert alert
  if (trimmed.startsWith('insert into prediction.fear_greed_alerts')) {
    const p = params as (string | number | null)[];
    alerts.push({
      id: p[0] as string, user_id: p[1] as string, predictor_id: p[2] as string,
      instrument_id: p[3] as string, symbol: p[4] as string,
      crowd_reaction: p[5] as 'fear_trigger' | 'greed_trigger',
      crowd_reaction_confidence: p[6] as number,
      estimated_reaction_window_minutes: p[7] as number | null,
      trade_action: p[8] as string | null, entry_price: p[9] as number | null,
      stop_loss: p[10] as number | null, take_profit: p[11] as number | null,
      notification_id: p[12] as string | null,
      is_read: false, created_at: new Date().toISOString(),
    });
    return { data: null, error: null };
  }

  // Insert notification
  if (trimmed.startsWith('insert into prediction.notifications')) {
    const p = params as string[];
    notifications.push({
      id: p[0], user_id: p[1], event_type: p[2], urgency: p[3],
      title: p[4], summary: p[5] ?? null, link_to: p[6],
    });
    return { data: null, error: null };
  }

  // Trade rec lookup
  if (trimmed.includes('from prediction.market_predictions mp') && trimmed.includes("role = 'portfolio_manager'")) {
    const instId = (params as string[])[0];
    const recs = tradeRecs.filter(r => r.instrument_id === instId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (recs.length > 0) {
      return { data: [{ action: recs[0].direction, entry_price: recs[0].entry_price, stop_loss: recs[0].stop_loss_price, take_profit: recs[0].take_profit_price }], error: null };
    }
    return { data: [], error: null };
  }

  // Recent predictors query
  if (trimmed.includes('from prediction.market_predictors') && trimmed.includes('interval')) {
    const matches = predictors.filter(p =>
      ['fear_trigger', 'greed_trigger'].includes(p.crowd_reaction)
      && p.crowd_reaction_confidence >= 0.7);
    return { data: matches.map(p => ({ id: p.id })), error: null };
  }

  // Schema ensure (no-op)
  return { data: null, error: null };
}

const stubDb = { rawQuery: stubRawQuery };
const stubSchema = { ensureSchema: async () => {} };

// Build service with stubs
function buildService(): FearGreedAlertService {
  const service = Object.create(FearGreedAlertService.prototype);
  (service as any).db = stubDb;
  (service as any).schema = stubSchema;
  (service as any).logger = { log: () => {}, error: () => {}, warn: () => {}, debug: () => {} };

  // Stub NotificationService
  const notifService = {
    notify: async (userId: string, input: { event_type: string; urgency: string; title: string; summary?: string; link_to: string }) => {
      const id = `notif-${++notifCounter}`;
      notifications.push({ id, user_id: userId, event_type: input.event_type, urgency: input.urgency, title: input.title, summary: input.summary ?? null, link_to: input.link_to });
      return id;
    },
  };
  (service as any).notifications = notifService;

  return service;
}

function resetStores() {
  alerts.length = 0;
  notifications.length = 0;
  predictors.length = 0;
  positions.length = 0;
  tradeQueue.length = 0;
  portfolios.length = 0;
  tradeRecs.length = 0;
  notifCounter = 0;
}

// ─── Test (a): alert generated for fear_trigger with confidence 0.8 ���────────
(async () => {
  console.log('Test (a): alert generated for fear_trigger with confidence 0.8');
  resetStores();
  const service = buildService();

  predictors.push({
    id: 'pred-1', instrument_id: 'inst-1', crowd_reaction: 'fear_trigger',
    crowd_reaction_confidence: 0.8, crowd_reaction_rationale: 'Tariff fears',
    estimated_reaction_window_minutes: 30, symbol: 'MSFT', instrument_name: 'Microsoft',
  });
  positions.push({ user_id: 'user-1', instrument_id: 'inst-1', status: 'open' });
  tradeRecs.push({
    instrument_id: 'inst-1', direction: 'sell', entry_price: 420,
    stop_loss_price: 425, take_profit_price: 400, created_at: '2026-04-10T00:00:00Z',
  });

  const count = await service.evaluatePredictors(['pred-1']);
  assert(count === 1, 'generated 1 alert');
  assert(alerts.length === 1, 'alert row created');
  assert(alerts[0].crowd_reaction === 'fear_trigger', 'alert is fear_trigger');
  assert(alerts[0].trade_action === 'sell', 'trade action is sell');
  assert(alerts[0].entry_price === 420, 'entry_price from trade rec');
  assert(notifications.length === 1, 'notification pushed');
  assert(notifications[0].event_type === 'fear_greed_alert', 'notification event type is fear_greed_alert');
  assert(notifications[0].urgency === 'immediate', 'notification urgency is immediate');
  assert(!notifications[0].title.includes('recommend'), 'title uses legal language (no "recommend")');
  assert(notifications[0].title.includes('FEAR'), 'title contains FEAR label');

  // ─── Test (b): no alert for noise ──────────────────────────────────
  console.log('Test (b): no alert for noise');
  resetStores();
  predictors.push({
    id: 'pred-2', instrument_id: 'inst-1', crowd_reaction: 'noise',
    crowd_reaction_confidence: 0.9, crowd_reaction_rationale: 'Routine',
    estimated_reaction_window_minutes: null, symbol: 'MSFT', instrument_name: 'Microsoft',
  });
  positions.push({ user_id: 'user-1', instrument_id: 'inst-1', status: 'open' });

  const noiseCount = await service.evaluatePredictors(['pred-2']);
  assert(noiseCount === 0, 'no alerts for noise');
  assert(alerts.length === 0, 'no alert rows');

  // ─── Test (c): no alert when confidence below threshold ────────────
  console.log('Test (c): no alert when confidence below threshold (0.5)');
  resetStores();
  predictors.push({
    id: 'pred-3', instrument_id: 'inst-1', crowd_reaction: 'fear_trigger',
    crowd_reaction_confidence: 0.5, crowd_reaction_rationale: 'Mild concern',
    estimated_reaction_window_minutes: 60, symbol: 'MSFT', instrument_name: 'Microsoft',
  });
  positions.push({ user_id: 'user-1', instrument_id: 'inst-1', status: 'open' });

  const lowConfCount = await service.evaluatePredictors(['pred-3']);
  assert(lowConfCount === 0, 'no alerts for low confidence');

  // ─── Test (d): no duplicate alert for same predictor+user ──────────
  console.log('Test (d): no duplicate alert for same predictor+user');
  resetStores();
  predictors.push({
    id: 'pred-4', instrument_id: 'inst-1', crowd_reaction: 'greed_trigger',
    crowd_reaction_confidence: 0.85, crowd_reaction_rationale: 'FOMO buying',
    estimated_reaction_window_minutes: 45, symbol: 'AAPL', instrument_name: 'Apple',
  });
  positions.push({ user_id: 'user-1', instrument_id: 'inst-1', status: 'open' });

  await service.evaluatePredictors(['pred-4']);
  assert(alerts.length === 1, 'first alert created');
  const secondCount = await service.evaluatePredictors(['pred-4']);
  assert(secondCount === 0, 'duplicate blocked');
  assert(alerts.length === 1, 'still only 1 alert');

  // ─── Test (e): alert cap enforcement ───────────────────────────────
  console.log('Test (e): alert cap enforcement (6th alert blocked)');
  resetStores();
  positions.push({ user_id: 'user-cap', instrument_id: 'inst-1', status: 'open' });

  // Create 5 existing unread alerts
  for (let i = 0; i < 5; i++) {
    alerts.push({
      id: `existing-${i}`, user_id: 'user-cap', predictor_id: `old-pred-${i}`,
      instrument_id: 'inst-1', symbol: 'TEST', crowd_reaction: 'fear_trigger',
      crowd_reaction_confidence: 0.8, estimated_reaction_window_minutes: 30,
      trade_action: 'sell', entry_price: 100, stop_loss: 105, take_profit: 90,
      notification_id: null, is_read: false, created_at: new Date().toISOString(),
    });
  }

  predictors.push({
    id: 'pred-cap', instrument_id: 'inst-1', crowd_reaction: 'fear_trigger',
    crowd_reaction_confidence: 0.9, crowd_reaction_rationale: 'Big news',
    estimated_reaction_window_minutes: 15, symbol: 'TEST', instrument_name: 'Test Inc',
  });

  const capCount = await service.evaluatePredictors(['pred-cap']);
  assert(capCount === 0, '6th alert blocked by cap');
  assert(alerts.length === 5, 'still only 5 alerts');

  // ─── Test (f): alert includes trade rec data ───���───────────────────
  console.log('Test (f): alert includes trade rec data when available');
  resetStores();
  predictors.push({
    id: 'pred-tr', instrument_id: 'inst-tr', crowd_reaction: 'greed_trigger',
    crowd_reaction_confidence: 0.75, crowd_reaction_rationale: 'Earnings beat',
    estimated_reaction_window_minutes: 60, symbol: 'GOOG', instrument_name: 'Alphabet',
  });
  positions.push({ user_id: 'user-tr', instrument_id: 'inst-tr', status: 'open' });
  tradeRecs.push({
    instrument_id: 'inst-tr', direction: 'buy', entry_price: 180,
    stop_loss_price: 175, take_profit_price: 195, created_at: '2026-04-10T01:00:00Z',
  });

  await service.evaluatePredictors(['pred-tr']);
  assert(alerts[0].trade_action === 'buy', 'trade action from rec');
  assert(alerts[0].entry_price === 180, 'entry price from rec');
  assert(alerts[0].stop_loss === 175, 'stop loss from rec');
  assert(alerts[0].take_profit === 195, 'take profit from rec');

  // ─── Test (g): "Analysis pending" when no trade rec exists ─────────
  console.log('Test (g): alert says "Analysis pending" when no trade rec exists');
  resetStores();
  predictors.push({
    id: 'pred-no-tr', instrument_id: 'inst-no-tr', crowd_reaction: 'fear_trigger',
    crowd_reaction_confidence: 0.8, crowd_reaction_rationale: 'Regulatory threat',
    estimated_reaction_window_minutes: 90, symbol: 'NVDA', instrument_name: 'NVIDIA',
  });
  positions.push({ user_id: 'user-no-tr', instrument_id: 'inst-no-tr', status: 'open' });
  // No trade recs for inst-no-tr

  await service.evaluatePredictors(['pred-no-tr']);
  assert(alerts[0].trade_action === null, 'trade action is null when no rec');
  assert(alerts[0].entry_price === null, 'entry price is null when no rec');
  assert(notifications[0].summary?.includes('Analysis pending') ?? false, 'notification summary mentions "Analysis pending"');

  // ─── Summary ──────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
