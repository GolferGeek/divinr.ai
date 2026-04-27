import assert from 'node:assert/strict';
import { SchemaBootstrapService } from '../../src/bootstrap/schema-bootstrap.service';
import { SchemaReadinessService } from '../../src/bootstrap/schema-readiness.service';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => {
        passed++;
        console.log(`  \u2713 ${name}`);
      }).catch((err) => {
        failed++;
        console.error(`  \u2717 ${name}`);
        console.error(err);
      });
    }
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.error(`  \u2717 ${name}`);
    console.error(err);
  }
}

async function main(): Promise<void> {
  console.log('\n=== Schema Bootstrap Tests ===\n');

  await test('bootstrap runs the smallest schema tasks in deterministic order', async () => {
    const calls: string[] = [];
    const makeTask = (key: string, method: 'ensureSchema' | 'bootstrap' = 'ensureSchema') => ({
      ensureSchema: async () => {
        if (method !== 'ensureSchema') return;
        calls.push(key);
      },
      bootstrap: async () => {
        if (method !== 'bootstrap') return;
        calls.push(key);
      },
    });

    const service = new SchemaBootstrapService(
      makeTask('billing') as never,
      makeTask('clubs') as never,
      makeTask('credentials') as never,
      makeTask('curriculum') as never,
      makeTask('first-touch') as never,
      makeTask('invites') as never,
      makeTask('learning-panel') as never,
      makeTask('markets', 'bootstrap') as never,
      makeTask('mastery') as never,
      makeTask('messaging') as never,
      makeTask('onboarding') as never,
      makeTask('service-api-keys') as never,
      makeTask('tournaments') as never,
    );

    const results = await service.runAll();
    assert.deepEqual(calls, [
      'billing',
      'markets',
      'messaging',
      'clubs',
      'tournaments',
      'curriculum',
      'credentials',
      'onboarding',
      'invites',
      'first-touch',
      'learning-panel',
      'mastery',
      'service-api-keys',
    ]);
    assert.deepEqual(results.map((result) => result.key), calls);
    assert(results.every((result) => result.status === 'ok'));
  });

  await test('readiness check reports missing relations', async () => {
    const db = {
      rawQuery: async () => ({
        data: [
          { key: 'billing.subscriptions', present: true },
          { key: 'credentials.user_llm_credentials', present: false },
        ],
        error: null,
      }),
    };
    const service = new SchemaReadinessService(db as never);
    const state = await service.check();
    assert.equal(state.ok, false);
    assert.deepEqual(state.missing, ['credentials.user_llm_credentials']);
  });

  await test('assertReady throws when bootstrap state is incomplete', async () => {
    const db = {
      rawQuery: async () => ({
        data: [{ key: 'prediction.learning_panel_threads', present: false }],
        error: null,
      }),
    };
    const service = new SchemaReadinessService(db as never);
    await assert.rejects(() => service.assertReady(), /missing relations: prediction.learning_panel_threads/);
  });

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
