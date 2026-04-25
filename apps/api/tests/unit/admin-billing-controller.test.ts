/**
 * Unit tests for AdminBillingController.
 * Covers admin role gating and the four-key response shape.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AdminBillingController } from '../../src/billing/admin-billing.controller';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; console.error(`  \u2717 ${label}`); }
}

function makeDb(isAdmin: boolean, items: unknown[] = [], events: unknown[] = []) {
  return {
    async rawQuery(sql: string, _params: unknown[] = []) {
      if (sql.includes('rbac_user_roles')) {
        return { data: isAdmin ? [{ name: 'admin' }] : [] };
      }
      if (sql.includes('billing.authored_items')) {
        return { data: items };
      }
      if (sql.includes('billing.subscription_events')) {
        return { data: events };
      }
      return { data: [] };
    },
  };
}

function makeBillingSpy(opts: {
  subscription?: unknown;
  preview?: unknown;
} = {}) {
  const calls: string[] = [];
  return {
    calls,
    service: {
      async getSubscription(userId: string) {
        calls.push(`getSubscription:${userId}`);
        return opts.subscription ?? null;
      },
      async getBillingPreview(userId: string) {
        calls.push(`getBillingPreview:${userId}`);
        return opts.preview ?? {
          basicMonthlyUsd: 50,
          authoredItems: [],
          authoredAnalysts: [],
          authoredInstruments: [],
          byoPlatformFeeUsd: 0,
          totalMonthlyUsd: 50,
        };
      },
    },
  };
}

async function expectThrows(fn: () => Promise<unknown>, expectedType: typeof Error): Promise<boolean> {
  try { await fn(); return false; }
  catch (err) { return err instanceof expectedType; }
}

// Stub StripeService — Phase 5 added stripe panel data to getUserBilling.
// Disabled returns empty arrays so the existing assertions still hold.
const fakeStripe = {
  isEnabled: () => false,
  listPaymentMethods: async () => [],
  listInvoices: async () => [],
  previewUpcomingInvoice: async () => null,
};

async function main(): Promise<void> {
  console.log('\n=== AdminBillingController Tests ===\n');

  // Non-admin → ForbiddenException
  {
    const db = makeDb(false);
    const { service } = makeBillingSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AdminBillingController(db as any, service as any, fakeStripe as any);
    const threw = await expectThrows(
      () => ctl.getUserBilling({ user: { id: 'regular-user' } }, 'target-user'),
      ForbiddenException,
    );
    assert(threw, 'non-admin gets ForbiddenException');
  }

  // Missing authentication → BadRequestException
  {
    const db = makeDb(true);
    const { service } = makeBillingSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AdminBillingController(db as any, service as any, fakeStripe as any);
    const threw = await expectThrows(
      () => ctl.getUserBilling({} as any, 'target-user'),
      BadRequestException,
    );
    assert(threw, 'missing authentication gets BadRequestException');
  }

  // Admin happy path → four-key payload
  {
    const subscription = { user_id: 'target-user', status: 'trial' as const };
    const events = [{ id: 'ev-1', user_id: 'target-user', to_status: 'trial', reason: 'migration_backfill', triggered_by: 'system' }];
    const items = [{ id: 'it-1', user_id: 'target-user', item_kind: 'custom_analyst', monthly_usd_cents: 6000, status: 'active' }];
    const db = makeDb(true, items, events);
    const { service, calls } = makeBillingSpy({ subscription });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AdminBillingController(db as any, service as any, fakeStripe as any);
    const res = await ctl.getUserBilling({ user: { id: 'admin-user' } }, 'target-user');
    assert('subscription' in res && 'authored_items' in res && 'events' in res && 'preview' in res, 'admin payload carries the four keys');
    assert(res.subscription === subscription, 'subscription pass-through matches BillingService.getSubscription');
    assert(Array.isArray(res.authored_items) && res.authored_items.length === 1, 'authored_items array populated from DB');
    assert(Array.isArray(res.events) && res.events.length === 1, 'events array populated from DB');
    assert(res.preview.basicMonthlyUsd === 50, 'preview pass-through from BillingService.getBillingPreview');
    assert(calls.includes('getSubscription:target-user'), 'getSubscription called with :id param (not caller)');
    assert(calls.includes('getBillingPreview:target-user'), 'getBillingPreview called with :id param (not caller)');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
