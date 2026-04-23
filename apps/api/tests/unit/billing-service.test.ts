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
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const service = Object.create(BillingService.prototype);
  (service as any).db = db;
  (service as any).schema = schema;
  (service as any).logger = silentLogger;
  (service as any).lifecycleLogger = silentLogger;
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

  // ─── isReadOnly: canceled + dormant true; trial/active/past_due false ─────
  {
    const { service } = createService({
      'billing.subscriptions': [{ user_id: 'u1', status: 'canceled' }],
    });
    assert((await service.isReadOnly('u1')) === true, 'isReadOnly=true for canceled');
  }
  {
    const { service } = createService({
      'billing.subscriptions': [{ user_id: 'u1', status: 'dormant' }],
    });
    assert((await service.isReadOnly('u1')) === true, 'isReadOnly=true for dormant');
  }
  for (const status of ['trial', 'active', 'past_due']) {
    const { service } = createService({
      'billing.subscriptions': [{ user_id: 'u1', status }],
    });
    assert((await service.isReadOnly('u1')) === false, `isReadOnly=false for ${status}`);
  }
  {
    const { service } = createService({});
    assert((await service.isReadOnly('u1')) === false, 'isReadOnly=false when no subscription row');
  }

  // ─── markExpired: sets three columns + appends one audit row ──────────
  {
    const { service, db } = createService({
      'billing.subscriptions': [{ user_id: 'u1', status: 'trial' }],
      'billing.subscription_events': [{ id: 'ev-1', user_id: 'u1', from_status: 'trial', to_status: 'canceled', reason: 'trial_ended_no_card', triggered_by: 'system', created_at: '' }],
    });
    await service.markExpired('u1', 'trial_ended_no_card', 'system');
    const updateQuery = db.queries.find(q => q.sql.includes('UPDATE billing.subscriptions') && q.sql.includes("status = 'canceled'"));
    assert(updateQuery !== undefined, 'markExpired issues UPDATE with status=canceled');
    assert(updateQuery!.sql.includes('expired_at'), 'markExpired sets expired_at');
    assert(updateQuery!.sql.includes('purge_scheduled_at'), 'markExpired sets purge_scheduled_at');
    const insertQuery = db.queries.find(q => q.sql.includes('INSERT INTO billing.subscription_events'));
    assert(insertQuery !== undefined, 'markExpired appends one subscription_events row');
    assert(insertQuery!.params[3] === 'trial_ended_no_card', 'markExpired event carries supplied reason');
    assert(insertQuery!.params[4] === 'system', 'markExpired event carries triggeredBy=system');
    assert(insertQuery!.params[1] === 'trial', 'markExpired event captures fromStatus');
    assert(insertQuery!.params[2] === 'canceled', 'markExpired event captures toStatus=canceled');
    const events = db.queries.filter(q => q.sql.includes('INSERT INTO billing.subscription_events'));
    assert(events.length === 1, 'markExpired appends exactly one event row');
  }

  // ─── markExpired throws when no subscription row exists ────────────
  {
    const { service } = createService({});
    let threw = false;
    try { await service.markExpired('u-nope', 'reason', 'system'); } catch { threw = true; }
    assert(threw, 'markExpired throws when no subscription row exists');
  }

  // ─── appendSubscriptionEvent writes a single row with correct shape ──
  {
    const { service, db } = createService({
      'billing.subscription_events': [{ id: 'ev-2', user_id: 'u1', from_status: null, to_status: 'trial', reason: 'migration_backfill', triggered_by: 'system', created_at: '' }],
    });
    await service.appendSubscriptionEvent({ userId: 'u1', fromStatus: null, toStatus: 'trial', reason: 'migration_backfill', triggeredBy: 'system' });
    const insertQuery = db.queries.find(q => q.sql.includes('INSERT INTO billing.subscription_events'));
    assert(insertQuery !== undefined, 'appendSubscriptionEvent issues INSERT');
    assert(insertQuery!.params[0] === 'u1', 'appendSubscriptionEvent carries user_id');
    assert(insertQuery!.params[1] === null, 'appendSubscriptionEvent carries null from_status for bootstrap');
    assert(insertQuery!.params[2] === 'trial', 'appendSubscriptionEvent carries to_status');
    assert(insertQuery!.params[3] === 'migration_backfill', 'appendSubscriptionEvent carries reason');
    assert(insertQuery!.params[4] === 'system', 'appendSubscriptionEvent carries triggered_by');
  }

  // ─── computeLifecycleTransitions: flips trial→canceled for each row; errors don't stop loop ─
  {
    // Each DB call returns the value for the FIRST substring key it matches
    // (iteration order is insertion order). Keys are chosen so the trial scan
    // resolves before anything else, then per-user getSubscription + UPDATE +
    // INSERT fall through to the generic handlers below.
    const db = createMockDb();
    // Route queries manually for fine-grained control
    const queries = db.queries;
    db.rawQuery = async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes("status = 'trial'") && sql.includes('trial_ends_at < now()')) {
        return { data: [{ user_id: 'u-a' }, { user_id: 'u-b' }] };
      }
      if (sql.includes('SELECT * FROM billing.subscriptions')) {
        return { data: [{ user_id: params[0], status: 'trial' }] };
      }
      if (sql.includes('UPDATE billing.subscriptions')) {
        return { data: [] };
      }
      if (sql.includes('INSERT INTO billing.subscription_events')) {
        return { data: [{ id: 'ev', user_id: params[0], to_status: 'canceled' }] };
      }
      return { data: [] };
    };
    const silentLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    const service = Object.create(BillingService.prototype) as BillingService;
    (service as any).db = db;
    (service as any).schema = createMockSchema();
    (service as any).logger = silentLogger;
    (service as any).lifecycleLogger = silentLogger;
    const res = await service.computeLifecycleTransitions();
    assert(res.transitionedCount === 2, 'computeLifecycleTransitions transitions both trial rows');
    assert(res.errors.length === 0, 'computeLifecycleTransitions reports zero errors on happy path');
    const updates = queries.filter(q => q.sql.includes('UPDATE billing.subscriptions'));
    assert(updates.length === 2, 'computeLifecycleTransitions issues one UPDATE per expiring row');
    const events = queries.filter(q => q.sql.includes('INSERT INTO billing.subscription_events'));
    assert(events.length === 2, 'computeLifecycleTransitions appends one audit row per transition');
    assert(events.every(q => q.params[3] === 'trial_ended_no_card'), 'computeLifecycleTransitions uses trial_ended_no_card as reason');
  }

  // ─── computeLifecycleTransitions: one failing user is isolated, loop continues ─
  {
    const db = createMockDb();
    const queries = db.queries;
    db.rawQuery = async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes("status = 'trial'") && sql.includes('trial_ends_at < now()')) {
        return { data: [{ user_id: 'u-ok' }, { user_id: 'u-err' }] };
      }
      if (sql.includes('SELECT * FROM billing.subscriptions')) {
        return { data: [{ user_id: params[0], status: 'trial' }] };
      }
      if (sql.includes('UPDATE billing.subscriptions')) {
        if (params[0] === 'u-err') return { error: { message: 'db glitch' } };
        return { data: [] };
      }
      if (sql.includes('INSERT INTO billing.subscription_events')) {
        return { data: [{ id: 'ev' }] };
      }
      return { data: [] };
    };
    const silentLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    const service = Object.create(BillingService.prototype) as BillingService;
    (service as any).db = db;
    (service as any).schema = createMockSchema();
    (service as any).logger = silentLogger;
    (service as any).lifecycleLogger = silentLogger;
    const res = await service.computeLifecycleTransitions();
    assert(res.transitionedCount === 1, 'computeLifecycleTransitions counts only successful transitions');
    assert(res.errors.length === 1 && res.errors[0].userId === 'u-err', 'computeLifecycleTransitions collects per-user errors without throwing');
  }

  // ─── computePurgeCandidates: 30-day warning is idempotent (skips users with existing warning event) ─
  {
    const db = createMockDb();
    const queries = db.queries;
    db.rawQuery = async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('purge_scheduled_at >= now()')) {
        return { data: [{ user_id: 'u-new' }, { user_id: 'u-already-warned' }] };
      }
      if (sql.includes('purge_scheduled_at < now()')) {
        return { data: [] };
      }
      if (sql.includes("reason = 'purge_warning_30d'")) {
        return { data: params[0] === 'u-already-warned' ? [{ '?column?': 1 }] : [] };
      }
      if (sql.includes('INSERT INTO billing.subscription_events')) {
        return { data: [{ id: 'ev' }] };
      }
      return { data: [] };
    };
    const silentLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    const service = Object.create(BillingService.prototype) as BillingService;
    (service as any).db = db;
    (service as any).schema = createMockSchema();
    (service as any).logger = silentLogger;
    (service as any).lifecycleLogger = silentLogger;
    const res = await service.computePurgeCandidates();
    assert(res.warningsEmitted === 1, 'computePurgeCandidates emits one 30-day warning (idempotent skip for repeat)');
    assert(res.purgesEmitted === 0, 'computePurgeCandidates emits zero purge events when no rows past purge_scheduled_at');
    const events = queries.filter(q => q.sql.includes('INSERT INTO billing.subscription_events'));
    assert(events.length === 1 && events[0].params[3] === 'purge_warning_30d', 'computePurgeCandidates audit row carries reason=purge_warning_30d');
  }

  // ─── computePurgeCandidates: emits one purge event per row past purge_scheduled_at ─
  {
    const db = createMockDb();
    const queries = db.queries;
    db.rawQuery = async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('purge_scheduled_at >= now()')) {
        return { data: [] };
      }
      if (sql.includes('purge_scheduled_at < now()')) {
        return { data: [{ user_id: 'u-purge' }] };
      }
      if (sql.includes("reason = 'purge_scheduled'")) {
        return { data: [] };
      }
      if (sql.includes('INSERT INTO billing.subscription_events')) {
        return { data: [{ id: 'ev' }] };
      }
      return { data: [] };
    };
    const silentLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    const service = Object.create(BillingService.prototype) as BillingService;
    (service as any).db = db;
    (service as any).schema = createMockSchema();
    (service as any).logger = silentLogger;
    (service as any).lifecycleLogger = silentLogger;
    const res = await service.computePurgeCandidates();
    assert(res.purgesEmitted === 1, 'computePurgeCandidates emits one purge for expired row');
    const events = queries.filter(q => q.sql.includes('INSERT INTO billing.subscription_events'));
    assert(events.length === 1 && events[0].params[3] === 'purge_scheduled', 'computePurgeCandidates audit row carries reason=purge_scheduled');
  }

  // ─── migrateBackfillSubscriptions: inserts one row per uncovered user ───
  {
    const db = createMockDb();
    const queries = db.queries;
    let insertCall = 0;
    db.rawQuery = async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('LEFT JOIN billing.subscriptions')) {
        return { data: [{ id: 'u-1' }, { id: 'u-2' }, { id: 'u-3' }] };
      }
      if (sql.includes('count(*)') && sql.includes('authz.users')) {
        return { data: [{ n: 5 }] }; // 2 already covered, 3 missing
      }
      if (sql.includes('INSERT INTO billing.subscriptions')) {
        insertCall++;
        return { data: [{ user_id: params[0] }] };
      }
      if (sql.includes('INSERT INTO billing.subscription_events')) {
        return { data: [{ id: `ev-${insertCall}` }] };
      }
      return { data: [] };
    };
    const silentLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    const service = Object.create(BillingService.prototype) as BillingService;
    (service as any).db = db;
    (service as any).schema = createMockSchema();
    (service as any).logger = silentLogger;
    (service as any).lifecycleLogger = silentLogger;
    const res = await service.migrateBackfillSubscriptions();
    assert(res.inserted_count === 3, 'migrateBackfillSubscriptions inserts a row for every uncovered user');
    assert(res.skipped_count === 2, 'migrateBackfillSubscriptions counts already-covered users as skipped');
    assert(res.errors.length === 0, 'migrateBackfillSubscriptions reports zero errors on happy path');
    const inserts = queries.filter(q => q.sql.includes('INSERT INTO billing.subscriptions'));
    assert(inserts.length === 3, 'migrateBackfillSubscriptions issues one INSERT per uncovered user');
    assert(inserts.every(q => q.sql.includes('ON CONFLICT (user_id) DO NOTHING')), 'migrateBackfillSubscriptions uses ON CONFLICT DO NOTHING');
    const events = queries.filter(q => q.sql.includes('INSERT INTO billing.subscription_events'));
    assert(events.length === 3, 'migrateBackfillSubscriptions appends one audit row per insert');
    assert(events.every(q => q.params[3] === 'migration_backfill'), 'migrateBackfillSubscriptions audit rows carry reason=migration_backfill');
    assert(events.every(q => q.params[1] === null && q.params[2] === 'trial'), 'migrateBackfillSubscriptions audit rows transition null → trial');
  }

  // ─── migrateBackfillSubscriptions is idempotent (second run = no-op) ───
  {
    const db = createMockDb();
    const queries = db.queries;
    db.rawQuery = async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('LEFT JOIN billing.subscriptions')) {
        return { data: [] }; // nothing left
      }
      if (sql.includes('count(*)') && sql.includes('authz.users')) {
        return { data: [{ n: 5 }] };
      }
      return { data: [] };
    };
    const silentLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    const service = Object.create(BillingService.prototype) as BillingService;
    (service as any).db = db;
    (service as any).schema = createMockSchema();
    (service as any).logger = silentLogger;
    (service as any).lifecycleLogger = silentLogger;
    const res = await service.migrateBackfillSubscriptions();
    assert(res.inserted_count === 0, 'migrateBackfillSubscriptions inserts zero on idempotent re-run');
    assert(res.skipped_count === 5, 'migrateBackfillSubscriptions skipped_count equals total user count when no rows missing');
    const inserts = queries.filter(q => q.sql.includes('INSERT INTO billing.subscriptions'));
    assert(inserts.length === 0, 'migrateBackfillSubscriptions issues zero INSERTs on second run');
  }

  // ─── migrateBackfillSubscriptions isolates per-user errors ──────────
  {
    const db = createMockDb();
    const queries = db.queries;
    db.rawQuery = async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('LEFT JOIN billing.subscriptions')) {
        return { data: [{ id: 'u-ok' }, { id: 'u-err' }] };
      }
      if (sql.includes('count(*)') && sql.includes('authz.users')) {
        return { data: [{ n: 2 }] };
      }
      if (sql.includes('INSERT INTO billing.subscriptions')) {
        if (params[0] === 'u-err') return { error: { message: 'glitch' } };
        return { data: [{ user_id: params[0] }] };
      }
      if (sql.includes('INSERT INTO billing.subscription_events')) {
        return { data: [{ id: 'ev' }] };
      }
      return { data: [] };
    };
    const silentLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    const service = Object.create(BillingService.prototype) as BillingService;
    (service as any).db = db;
    (service as any).schema = createMockSchema();
    (service as any).logger = silentLogger;
    (service as any).lifecycleLogger = silentLogger;
    const res = await service.migrateBackfillSubscriptions();
    assert(res.inserted_count === 1, 'migrateBackfillSubscriptions counts only successful inserts');
    assert(res.errors.length === 1 && res.errors[0].userId === 'u-err', 'migrateBackfillSubscriptions collects per-user errors without throwing');
  }

  // ─── Append-only invariant: BillingService does NOT expose update/delete ──
  {
    const proto = BillingService.prototype as unknown as Record<string, unknown>;
    const methods = Object.getOwnPropertyNames(proto);
    const eventMutators = methods.filter(m =>
      m.toLowerCase().includes('subscriptionevent') &&
      (m.toLowerCase().includes('update') || m.toLowerCase().includes('delete'))
    );
    assert(eventMutators.length === 0, 'BillingService exposes no update/delete method for subscription_events (append-only invariant)');
  }

  // ─── Summary ──────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
