/**
 * Unit tests for BillingStripeSyncService — the per-event handlers that
 * translate Stripe webhook payloads into billing.subscriptions / billing.subscription_events
 * mutations. Stubs BillingService + StripeService so no DB / network is touched.
 */
import type Stripe from 'stripe';
import { BillingConfigService } from '../../src/billing/billing-config.service';
import { BillingStripeSyncService } from '../../src/billing/billing-stripe-sync.service';

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

interface AppendCall {
  userId: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string;
  triggeredBy: string;
}

interface UpdateCall {
  userId: string;
  fields: Record<string, unknown>;
}

function makeStubs(opts?: { initialStatus?: string; userId?: string; customerId?: string }) {
  const userId = opts?.userId ?? 'user-1';
  const customerId = opts?.customerId ?? 'cus_test';
  const initialStatus = opts?.initialStatus ?? 'trial';
  const updates: UpdateCall[] = [];
  const events: AppendCall[] = [];
  const rawQueries: Array<{ sql: string; params: unknown[] }> = [];
  let currentStatus = initialStatus;

  const db = {
    rawQuery: async (sql: string, params: unknown[]) => {
      rawQueries.push({ sql, params });
      return { error: null };
    },
  };

  const billing = {
    getSubscription: async (uid: string) => {
      if (uid !== userId) return null;
      return { user_id: uid, status: currentStatus, stripe_customer_id: customerId, stripe_subscription_id: 'sub_test' };
    },
    getSubscriptionByStripeCustomerId: async (cid: string) => {
      if (cid !== customerId) return null;
      return { user_id: userId, status: currentStatus, stripe_customer_id: customerId, stripe_subscription_id: 'sub_test' };
    },
    updateStripeFields: async (uid: string, fields: Record<string, unknown>) => {
      updates.push({ userId: uid, fields });
      if (fields.status && typeof fields.status === 'string') currentStatus = fields.status;
    },
    appendSubscriptionEvent: async (params: AppendCall) => {
      events.push(params);
      return { id: 'evt-row', ...params, created_at: '' };
    },
  };

  return { billing, db, updates, events, rawQueries, currentStatus: () => currentStatus };
}

async function main() {
  console.log('\nBillingStripeSyncService\n');

  const config = new BillingConfigService();
  const stripeStub = { isEnabled: () => true } as unknown as { isEnabled(): boolean };

  // ─── customer.subscription.created → mirror + initial event ───
  {
    const stubs = makeStubs({ initialStatus: 'trial' });
    const svc = new BillingStripeSyncService(stubs.billing as any, stripeStub as any, config, stubs.db as any);
    const event = {
      id: 'evt_1',
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_test',
          customer: 'cus_test',
          status: 'active',
          metadata: { userId: 'user-1' },
          trial_end: null,
          latest_invoice: 'in_test',
          default_payment_method: 'pm_test',
          items: { data: [{ price: { id: process.env.STRIPE_PRICE_BASIC_MONTHLY ?? 'price_basic_monthly' } }] },
        },
      },
    } as unknown as Stripe.Event;
    await svc.handle(event);
    assert(stubs.updates.length === 1, 'subscription.created → one updateStripeFields');
    assert(stubs.events.length === 1, 'subscription.created → one appendSubscriptionEvent');
    assert(stubs.events[0].toStatus === 'active', 'event toStatus mapped from active');
    assert(stubs.events[0].triggeredBy === 'stripe', 'event triggeredBy=stripe');
  }

  // ─── customer.subscription.updated, no status change → no event row ───
  {
    const stubs = makeStubs({ initialStatus: 'active' });
    const svc = new BillingStripeSyncService(stubs.billing as any, stripeStub as any, config, stubs.db as any);
    const event = {
      id: 'evt_2',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_test',
          customer: 'cus_test',
          status: 'active',
          metadata: { userId: 'user-1' },
          trial_end: null,
          items: { data: [] },
        },
      },
    } as unknown as Stripe.Event;
    await svc.handle(event);
    assert(stubs.updates.length === 1, 'subscription.updated → mirror update happens');
    assert(stubs.events.length === 0, 'no event when status unchanged');
  }

  // ─── customer.subscription.updated, status flipped → event row ───
  {
    const stubs = makeStubs({ initialStatus: 'trial' });
    const svc = new BillingStripeSyncService(stubs.billing as any, stripeStub as any, config, stubs.db as any);
    const event = {
      id: 'evt_3',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_test',
          customer: 'cus_test',
          status: 'past_due',
          metadata: { userId: 'user-1' },
          trial_end: null,
          items: { data: [] },
        },
      },
    } as unknown as Stripe.Event;
    await svc.handle(event);
    assert(stubs.events.length === 1, 'event row appended on status flip');
    assert(stubs.events[0].fromStatus === 'trial' && stubs.events[0].toStatus === 'past_due', 'fromStatus=trial → toStatus=past_due');
  }

  // ─── customer.subscription.deleted → canceled + purge_scheduled_at ───
  {
    const stubs = makeStubs({ initialStatus: 'active' });
    const svc = new BillingStripeSyncService(stubs.billing as any, stripeStub as any, config, stubs.db as any);
    const event = {
      id: 'evt_4',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_test', customer: 'cus_test', metadata: { userId: 'user-1' } } },
    } as unknown as Stripe.Event;
    await svc.handle(event);
    const purgeUpdate = stubs.rawQueries.find(q => q.sql.includes('purge_scheduled_at'));
    assert(!!purgeUpdate, 'purge_scheduled_at SQL update issued');
    const cancelEvent = stubs.events.find(e => e.toStatus === 'canceled');
    assert(!!cancelEvent, 'canceled event appended');
  }

  // ─── invoice.paid: trial → active ───
  {
    const stubs = makeStubs({ initialStatus: 'trial' });
    const svc = new BillingStripeSyncService(stubs.billing as any, stripeStub as any, config, stubs.db as any);
    const event = {
      id: 'evt_5',
      type: 'invoice.paid',
      data: { object: { id: 'in_x', customer: 'cus_test' } },
    } as unknown as Stripe.Event;
    await svc.handle(event);
    const activeEvent = stubs.events.find(e => e.toStatus === 'active');
    assert(!!activeEvent, 'invoice.paid flips trial → active and writes event');
  }

  // ─── invoice.payment_failed: active → past_due, but no read-only ───
  {
    const stubs = makeStubs({ initialStatus: 'active' });
    const svc = new BillingStripeSyncService(stubs.billing as any, stripeStub as any, config, stubs.db as any);
    const event = {
      id: 'evt_6',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_y', customer: 'cus_test' } },
    } as unknown as Stripe.Event;
    await svc.handle(event);
    const pdEvent = stubs.events.find(e => e.toStatus === 'past_due');
    assert(!!pdEvent, 'invoice.payment_failed flips → past_due');
  }

  // ─── payment_method.attached → caches card_last4 / exp ───
  {
    const stubs = makeStubs({ initialStatus: 'trial' });
    const svc = new BillingStripeSyncService(stubs.billing as any, stripeStub as any, config, stubs.db as any);
    const event = {
      id: 'evt_7',
      type: 'payment_method.attached',
      data: {
        object: {
          id: 'pm_xx',
          customer: 'cus_test',
          type: 'card',
          card: { last4: '4242', exp_month: 12, exp_year: 2030 },
        },
      },
    } as unknown as Stripe.Event;
    await svc.handle(event);
    const cardUpdate = stubs.updates.find(u => u.fields.card_last4 === '4242');
    assert(!!cardUpdate, 'card_last4 cached');
    assert(cardUpdate?.fields.card_exp_month === 12, 'exp_month cached');
    assert(cardUpdate?.fields.card_exp_year === 2030, 'exp_year cached');
  }

  // ─── unknown event type: no-op ───
  {
    const stubs = makeStubs({ initialStatus: 'active' });
    const svc = new BillingStripeSyncService(stubs.billing as any, stripeStub as any, config, stubs.db as any);
    await svc.handle({ id: 'evt_8', type: 'price.created', data: { object: {} } } as unknown as Stripe.Event);
    assert(stubs.updates.length === 0 && stubs.events.length === 0, 'unknown type silently ignored');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
