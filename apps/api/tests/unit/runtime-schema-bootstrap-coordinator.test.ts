import assert from 'node:assert/strict';
import {
  REQUEST_SCHEMA_BOOTSTRAP_LOCK,
  RuntimeSchemaBootstrapCoordinator,
} from '../../src/bootstrap/runtime-schema-bootstrap-coordinator';
import { BillingSchemaService } from '../../src/billing/billing-schema.service';
import { FirstTouchSchemaService } from '../../src/first-touch/first-touch-schema.service';
import { LearningPanelSchemaService } from '../../src/learning-panel/learning-panel-schema.service';

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

function resetCoordinator(): void {
  const inflight = (RuntimeSchemaBootstrapCoordinator as unknown as {
    inflight: Map<string, Promise<void>>;
  }).inflight;
  inflight.clear();
}

function resetSchemaFlags(): void {
  for (const schema of [BillingSchemaService, LearningPanelSchemaService, FirstTouchSchemaService]) {
    (schema as unknown as { schemaReady: boolean }).schemaReady = false;
    (schema as unknown as { schemaReadyPromise: Promise<void> | null }).schemaReadyPromise = null;
  }
}

function createBlockingDb(label: string, timeline: string[]) {
  let release!: () => void;
  const waitForRelease = new Promise<void>((resolve) => {
    release = resolve;
  });

  const db = {
    rawQuery: async () => {
      timeline.push(`${label}:start`);
      await waitForRelease;
      timeline.push(`${label}:finish`);
      return { data: [], error: null };
    },
  };

  return { db, release };
}

async function waitForTimelineLength(timeline: string[], expectedLength: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (timeline.length >= expectedLength) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`Timed out waiting for timeline length ${expectedLength}; got ${timeline.length}`);
}

async function main(): Promise<void> {
  console.log('\n=== RuntimeSchemaBootstrapCoordinator Tests ===\n');

  await test('runExclusive serializes work for the same key', async () => {
    resetCoordinator();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstWait = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = RuntimeSchemaBootstrapCoordinator.runExclusive('same-key', async () => {
      events.push('first:start');
      await firstWait;
      events.push('first:finish');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = RuntimeSchemaBootstrapCoordinator.runExclusive('same-key', async () => {
      events.push('second:start');
      events.push('second:finish');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(events, ['first:start']);

    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, ['first:start', 'first:finish', 'second:start', 'second:finish']);
  });

  await test('runExclusive clears the lock after a failure', async () => {
    resetCoordinator();
    let attempts = 0;

    await assert.rejects(
      RuntimeSchemaBootstrapCoordinator.runExclusive('failing-key', async () => {
        attempts += 1;
        throw new Error('boom');
      }),
      /boom/,
    );

    await RuntimeSchemaBootstrapCoordinator.runExclusive('failing-key', async () => {
      attempts += 1;
    });

    assert.equal(attempts, 2);
  });

  await test('shell bootstrap schema services do not overlap under the shared runtime lock', async () => {
    resetCoordinator();
    resetSchemaFlags();

    const timeline: string[] = [];
    const billingHarness = createBlockingDb('billing', timeline);
    const learningPanelHarness = createBlockingDb('learning-panel', timeline);
    const firstTouchHarness = createBlockingDb('first-touch', timeline);

    const billing = new BillingSchemaService(billingHarness.db as never);
    const learningPanel = new LearningPanelSchemaService(learningPanelHarness.db as never);
    const firstTouch = new FirstTouchSchemaService(firstTouchHarness.db as never);

    const billingPromise = billing.ensureSchema();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const learningPanelPromise = learningPanel.ensureSchema();
    const firstTouchPromise = firstTouch.ensureSchema();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(timeline, ['billing:start']);

    billingHarness.release();
    await waitForTimelineLength(timeline, 3);
    assert.deepEqual(timeline, ['billing:start', 'billing:finish', 'learning-panel:start']);

    learningPanelHarness.release();
    await waitForTimelineLength(timeline, 5);
    assert.deepEqual(timeline, [
      'billing:start',
      'billing:finish',
      'learning-panel:start',
      'learning-panel:finish',
      'first-touch:start',
    ]);

    firstTouchHarness.release();
    await Promise.all([billingPromise, learningPanelPromise, firstTouchPromise]);

    assert.deepEqual(timeline, [
      'billing:start',
      'billing:finish',
      'learning-panel:start',
      'learning-panel:finish',
      'first-touch:start',
      'first-touch:finish',
    ]);
    assert.equal(REQUEST_SCHEMA_BOOTSTRAP_LOCK, 'request-schema-bootstrap');
  });

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
