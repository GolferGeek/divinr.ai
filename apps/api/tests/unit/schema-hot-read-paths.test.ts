import assert from 'node:assert/strict';
import { BillingService } from '../../src/billing/billing.service';
import { FirstTouchService } from '../../src/first-touch/first-touch.service';
import { OnboardingService } from '../../src/onboarding/onboarding.service';
import { defaultOnboardingState } from '../../src/onboarding/onboarding.types';
import { MarketsService } from '../../src/markets/markets.service';
import { NotificationService } from '../../src/markets/services/notification.service';
import { AffinityService } from '../../src/markets/services/affinity.service';
import { FearGreedAlertService } from '../../src/markets/services/fear-greed-alert.service';
import { MessagingService } from '../../src/messaging/messaging.service';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => {
        passed++;
        console.log(`  ✓ ${name}`);
      }).catch((err) => {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(err);
      });
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

function throwingSchema() {
  return {
    ensureSchema: async () => {
      throw new Error('ensureSchema should not be called');
    },
  };
}

async function main() {
  console.log('\n=== Schema Hot Read Paths Tests ===\n');

  await test('BillingService.getSubscription skips runtime schema bootstrap', async () => {
    const svc = Object.create(BillingService.prototype) as BillingService;
    (svc as any).db = {
      rawQuery: async () => ({ data: [{ user_id: 'u1', status: 'trial' }], error: null }),
    };
    (svc as any).schema = throwingSchema();

    const row = await svc.getSubscription('u1');
    assert.equal((row as any)?.user_id, 'u1');
  });

  await test('OnboardingService.getState skips runtime schema bootstrap', async () => {
    const state = defaultOnboardingState();
    const svc = Object.create(OnboardingService.prototype) as OnboardingService;
    let call = 0;
    (svc as any).db = {
      rawQuery: async () => {
        call += 1;
        if (call === 1) return { data: [], error: null };
        return { data: [{ onboarding_state: state }], error: null };
      },
    };
    (svc as any).schema = throwingSchema();

    const result = await svc.getState('u1');
    assert.equal(result.current_step, state.current_step);
  });

  await test('FirstTouchService.getState skips runtime schema bootstrap', async () => {
    const svc = Object.create(FirstTouchService.prototype) as FirstTouchService;
    (svc as any).db = {
      rawQuery: async () => ({ data: [{ surface_key: 'learning-panel' }], error: null }),
    };
    (svc as any).schema = throwingSchema();
    (svc as any).onboarding = {
      getState: async () => defaultOnboardingState(),
    };

    const state = await svc.getState('u1');
    assert.deepEqual(state.touched, ['learning-panel']);
  });

  await test('MarketsService.listPredictionsWithRole skips runtime schema bootstrap', async () => {
    const svc = Object.create(MarketsService.prototype) as MarketsService;
    let query = '';
    let params: unknown[] = [];
    (svc as any).db = {
      rawQuery: async (sql: string, values: unknown[]) => {
        query = sql;
        params = values;
        return { data: [{ id: 'pred-1' }], error: null };
      },
    };
    (svc as any).schema = throwingSchema();
    (svc as any).requireRead = async () => undefined;

    const rows = await svc.listPredictionsWithRole({ userId: 'u1', role: 'analyst', limit: 999 });
    assert.equal(rows.length, 1);
    assert.match(query, /limit \$2$/);
    assert.deepEqual(params, ['analyst', 500]);
  });

  await test('NotificationService.getUnreadCount skips runtime schema bootstrap', async () => {
    const svc = Object.create(NotificationService.prototype) as NotificationService;
    (svc as any).db = {
      rawQuery: async () => ({ data: [{ cnt: '2' }], error: null }),
    };
    (svc as any).schema = throwingSchema();

    const count = await svc.getUnreadCount('u1');
    assert.equal(count, 2);
  });

  await test('AffinityService.getContrarianAlerts skips runtime schema bootstrap', async () => {
    const svc = Object.create(AffinityService.prototype) as AffinityService;
    (svc as any).db = {
      rawQuery: async () => ({ data: [{ id: 'a1' }], error: null }),
    };
    (svc as any).schema = throwingSchema();

    const rows = await svc.getContrarianAlerts('u1', true);
    assert.equal(rows.length, 1);
  });

  await test('FearGreedAlertService.getUnreadCount skips runtime schema bootstrap', async () => {
    const svc = Object.create(FearGreedAlertService.prototype) as FearGreedAlertService;
    (svc as any).db = {
      rawQuery: async () => ({ data: [{ cnt: '3' }], error: null }),
    };
    (svc as any).schema = throwingSchema();

    const count = await svc.getUnreadCount('u1');
    assert.equal(count, 3);
  });

  await test('MessagingService.getUnreadCounts skips runtime schema bootstrap', async () => {
    const svc = Object.create(MessagingService.prototype) as MessagingService;
    (svc as any).db = {
      rawQuery: async () => ({
        data: [
          { channel_id: 'c1', unread_count: 4 },
          { channel_id: 'c2', unread_count: 1 },
        ],
        error: null,
      }),
    };
    (svc as any).schema = throwingSchema();

    const counts = await svc.getUnreadCounts('u1');
    assert.deepEqual(counts, { c1: 4, c2: 1 });
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
