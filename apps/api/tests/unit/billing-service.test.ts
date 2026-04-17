/**
 * Unit tests for BillingService
 * Tests authored item tracking, cancellation, preview computation, and subscription status.
 */
import { BillingService } from '../../src/billing/billing.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.error(`  \u2717 ${label}`);
  }
}

// ─── Mock DB ──────────────────────────────────────────────────

interface MockRow {
  [key: string]: unknown;
}

function createMockDb(responses: Record<string, MockRow[]> = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    rawQuery: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      for (const [key, value] of Object.entries(responses)) {
        if (sql.includes(key)) {
          return { data: value };
        }
      }
      return { data: [] };
    },
  };
}

function createMockSchema() {
  return { ensureSchema: async () => {} };
}

function createService(dbResponses: Record<string, MockRow[]> = {}): {
  service: BillingService;
  db: ReturnType<typeof createMockDb>;
} {
  const db = createMockDb(dbResponses);
  const schema = createMockSchema();
  const service = Object.create(BillingService.prototype);
  (service as any).db = db;
  (service as any).schema = schema;
  (service as any).logger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return { service: service as BillingService, db };
}

async function main(): Promise<void> {
  console.log('\n=== BillingService Tests ===\n');

  // ─── addAuthoredItem inserts row with correct cents ────────
  {
    // Default ANALYST_AUTHORSHIP_USD=60 → 6000 cents
    delete process.env.ANALYST_AUTHORSHIP_USD;
    const { service, db } = createService({
      'billing.subscriptions': [{ user_id: 'u1', status: 'trial' }],
      'billing.authored_items': [{ id: 'item-1', user_id: 'u1', item_kind: 'custom_analyst', item_id: 'a1', monthly_usd_cents: 6000, status: 'active', activated_at: '', canceled_at: null }],
    });
    const item = await service.addAuthoredItem('u1', 'custom_analyst', 'a1');
    assert(item.monthly_usd_cents === 6000, 'addAuthoredItem inserts custom_analyst at 6000 cents (default $60)');
    // Check that INSERT was called with 6000
    const insertQuery = db.queries.find(q => q.sql.includes('INSERT INTO billing.authored_items'));
    assert(insertQuery !== undefined, 'addAuthoredItem issues INSERT into billing.authored_items');
    assert(insertQuery!.params[3] === 6000, 'addAuthoredItem passes 6000 cents as param');
  }

  // ─── addAuthoredItem uses env var override ─────────────────
  {
    process.env.INSTRUMENT_AUTHORSHIP_USD = '25';
    const { service, db } = createService({
      'billing.subscriptions': [{ user_id: 'u1', status: 'trial' }],
      'billing.authored_items': [{ id: 'item-2', user_id: 'u1', item_kind: 'custom_instrument', item_id: 'i1', monthly_usd_cents: 2500, status: 'active', activated_at: '', canceled_at: null }],
    });
    const item = await service.addAuthoredItem('u1', 'custom_instrument', 'i1');
    const insertQuery = db.queries.find(q => q.sql.includes('INSERT INTO billing.authored_items'));
    assert(insertQuery!.params[3] === 2500, 'addAuthoredItem uses env override INSTRUMENT_AUTHORSHIP_USD=25 → 2500 cents');
    delete process.env.INSTRUMENT_AUTHORSHIP_USD;
  }

  // ─── cancelAuthoredItem sets status to canceled ────────────
  {
    const { service, db } = createService();
    await service.cancelAuthoredItem('u1', 'custom_analyst', 'a1');
    const updateQuery = db.queries.find(q => q.sql.includes('canceled'));
    assert(updateQuery !== undefined, 'cancelAuthoredItem issues UPDATE with canceled status');
    assert(updateQuery!.params[0] === 'u1', 'cancelAuthoredItem passes correct user_id');
    assert(updateQuery!.params[1] === 'custom_analyst', 'cancelAuthoredItem passes correct item_kind');
    assert(updateQuery!.params[2] === 'a1', 'cancelAuthoredItem passes correct item_id');
  }

  // ─── getBillingPreview computes total correctly ────────────
  {
    delete process.env.BASIC_MONTHLY_USD;
    const items = [
      { item_kind: 'custom_analyst', item_id: 'a1', monthly_usd_cents: 6000, status: 'active' },
      { item_kind: 'custom_instrument', item_id: 'i1', monthly_usd_cents: 2000, status: 'active' },
    ];
    const { service } = createService({
      'billing.authored_items': items,
    });
    const preview = await service.getBillingPreview('u1');
    assert(preview.basicMonthlyUsd === 50, 'getBillingPreview uses default $50 basic monthly');
    assert(preview.authoredItems.length === 2, 'getBillingPreview returns 2 authored items');
    assert(preview.totalMonthlyUsd === 130, 'getBillingPreview total = 50 + 60 + 20 = 130');
    assert(preview.byoPlatformFeeUsd === 0, 'getBillingPreview byoPlatformFeeUsd is 0 when no byo item');
  }

  // ─── isSubscriptionActive returns true for trial/active ────
  {
    const { service } = createService({
      'billing.subscriptions': [{ user_id: 'u1', status: 'trial' }],
    });
    const result = await service.isSubscriptionActive('u1');
    assert(result === true, 'isSubscriptionActive returns true for trial status');
  }

  {
    const { service } = createService({
      'billing.subscriptions': [{ user_id: 'u1', status: 'active' }],
    });
    const result = await service.isSubscriptionActive('u1');
    assert(result === true, 'isSubscriptionActive returns true for active status');
  }

  // ─── isSubscriptionActive returns false for canceled ───────
  {
    const { service } = createService({
      'billing.subscriptions': [{ user_id: 'u1', status: 'canceled' }],
    });
    const result = await service.isSubscriptionActive('u1');
    assert(result === false, 'isSubscriptionActive returns false for canceled status');
  }

  // ─── isSubscriptionActive returns true when no row ─────────
  {
    const { service } = createService({});
    const result = await service.isSubscriptionActive('u1');
    assert(result === true, 'isSubscriptionActive returns true when no subscription row exists (pre-billing)');
  }

  // ─── Summary ──────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
