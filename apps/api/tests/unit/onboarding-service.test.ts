/**
 * Unit tests for the onboarding patch reducer (applyOnboardingPatch).
 * Effort: onboarding-tour-extended.
 *
 * Covers the v2 5-beat tour: `welcome`, `analysts-and-instruments`,
 * `reading-an-analysis`, `making-a-trade`, `where-to-go-from-here`, `done`.
 * Also covers the sanitize pass that drops unknown step ids (e.g., v1
 * users who persisted `'dashboard'` / `'risk'` in `steps_completed`).
 */
import assert from 'node:assert/strict';
import {
  applyOnboardingPatch,
  defaultOnboardingState,
  isStepId,
  STEP_ORDER,
  type OnboardingState,
} from '../../src/onboarding/onboarding.types';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const FIXED_NOW = '2026-04-14T20:00:00.000Z';
const LATER = '2026-04-14T20:05:00.000Z';
const FIRST_CONTENT_STEP = STEP_ORDER[1]!;

test('defaultOnboardingState returns pristine shape', () => {
  const s = defaultOnboardingState();
  assert.equal(s.started_at, null);
  assert.equal(s.completed_at, null);
  assert.equal(s.skipped, false);
  assert.equal(s.current_step, 'welcome');
  assert.deepEqual(s.steps_completed, []);
  assert.equal(s.last_seen_at, null);
  assert.equal(s.first_touch_muted, false);
});

test('STEP_ORDER has 6 entries (5 beats + done), welcome first, done last', () => {
  assert.equal(STEP_ORDER.length, 6);
  assert.equal(STEP_ORDER[0], 'welcome');
  assert.equal(STEP_ORDER[STEP_ORDER.length - 1], 'done');
  assert.deepEqual([...STEP_ORDER], [
    'welcome',
    'analysts-and-instruments',
    'reading-an-analysis',
    'making-a-trade',
    'where-to-go-from-here',
    'done',
  ]);
});

test('isStepId accepts valid v2 ids, rejects unknown', () => {
  assert.equal(isStepId('analysts-and-instruments'), true);
  assert.equal(isStepId('done'), true);
  assert.equal(isStepId('dashboard'), false, 'v1 id no longer valid');
  assert.equal(isStepId('risk'), false, 'v1 id no longer valid');
  assert.equal(isStepId('bogus'), false);
  assert.equal(isStepId(42), false);
  assert.equal(isStepId(null), false);
});

test('start: sets started_at, advances to first content beat, marks welcome complete', () => {
  const next = applyOnboardingPatch(defaultOnboardingState(), { action: 'start' }, FIXED_NOW);
  assert.equal(next.started_at, FIXED_NOW);
  assert.equal(next.current_step, FIRST_CONTENT_STEP);
  assert.deepEqual(next.steps_completed, ['welcome']);
  assert.equal(next.skipped, false);
  assert.equal(next.completed_at, null);
  assert.equal(next.last_seen_at, FIXED_NOW);
});

test('complete_step: advances to next step in order, dedupes', () => {
  const after_start = applyOnboardingPatch(defaultOnboardingState(), { action: 'start' }, FIXED_NOW);
  const next = applyOnboardingPatch(
    after_start,
    { action: 'complete_step', step: 'analysts-and-instruments' },
    LATER,
  );
  assert.equal(next.current_step, 'reading-an-analysis');
  assert.deepEqual(next.steps_completed, ['welcome', 'analysts-and-instruments']);
  assert.equal(next.last_seen_at, LATER);
});

test('complete_step: dedupes when called twice for same step', () => {
  const base = applyOnboardingPatch(defaultOnboardingState(), { action: 'start' }, FIXED_NOW);
  const first = applyOnboardingPatch(base, { action: 'complete_step', step: 'analysts-and-instruments' }, LATER);
  const second = applyOnboardingPatch(first, { action: 'complete_step', step: 'analysts-and-instruments' }, LATER);
  assert.deepEqual(second.steps_completed, ['welcome', 'analysts-and-instruments']);
});

test('complete_step: advancing through all beats lands on done', () => {
  let state: OnboardingState = applyOnboardingPatch(
    defaultOnboardingState(),
    { action: 'start' },
    FIXED_NOW,
  );
  const stepsToComplete = STEP_ORDER.slice(1, -1);
  for (const step of stepsToComplete) {
    state = applyOnboardingPatch(state, { action: 'complete_step', step }, LATER);
  }
  assert.equal(state.current_step, 'done');
  assert.equal(state.completed_at, null, 'not completed yet — done step not yet completed');

  state = applyOnboardingPatch(state, { action: 'complete_step', step: 'done' }, LATER);
  assert.equal(state.current_step, 'done', 'stays on done');
  assert.equal(state.completed_at, LATER);
  assert.equal(state.steps_completed.length, STEP_ORDER.length);
});

test('complete_step: invalid step id throws', () => {
  const base = defaultOnboardingState();
  assert.throws(() =>
    applyOnboardingPatch(base, { action: 'complete_step', step: 'bogus' as unknown as never }, FIXED_NOW),
  );
});

test('set_current_step: jumps to arbitrary valid step', () => {
  const base = applyOnboardingPatch(defaultOnboardingState(), { action: 'start' }, FIXED_NOW);
  const next = applyOnboardingPatch(base, { action: 'set_current_step', step: 'making-a-trade' }, LATER);
  assert.equal(next.current_step, 'making-a-trade');
  assert.deepEqual(next.steps_completed, ['welcome']);
});

test('set_current_step: invalid step id throws', () => {
  assert.throws(() =>
    applyOnboardingPatch(
      defaultOnboardingState(),
      { action: 'set_current_step', step: 'foo' as unknown as never },
      FIXED_NOW,
    ),
  );
});

test('skip: marks skipped, completes every v2 step, current_step=done', () => {
  const next = applyOnboardingPatch(defaultOnboardingState(), { action: 'skip' }, FIXED_NOW);
  assert.equal(next.skipped, true);
  assert.equal(next.completed_at, FIXED_NOW);
  assert.equal(next.current_step, 'done');
  assert.equal(next.steps_completed.length, STEP_ORDER.length);
  assert.deepEqual(next.steps_completed, [...STEP_ORDER]);
});

test('restart: resets and auto-starts on the first content beat', () => {
  const skipped = applyOnboardingPatch(defaultOnboardingState(), { action: 'skip' }, FIXED_NOW);
  assert.equal(skipped.skipped, true);

  const restarted = applyOnboardingPatch(skipped, { action: 'restart' }, LATER);
  assert.equal(restarted.skipped, false);
  assert.equal(restarted.completed_at, null);
  assert.equal(restarted.started_at, LATER);
  assert.equal(restarted.current_step, FIRST_CONTENT_STEP);
  assert.deepEqual(restarted.steps_completed, ['welcome']);
});

test('mark_seen: updates last_seen_at only', () => {
  const base = applyOnboardingPatch(defaultOnboardingState(), { action: 'start' }, FIXED_NOW);
  const next = applyOnboardingPatch(base, { action: 'mark_seen' }, LATER);
  assert.equal(next.last_seen_at, LATER);
  assert.equal(next.started_at, base.started_at);
  assert.equal(next.current_step, base.current_step);
  assert.deepEqual(next.steps_completed, base.steps_completed);
});

test('set_first_touch_mute: toggles flag without touching tour state', () => {
  const base = applyOnboardingPatch(defaultOnboardingState(), { action: 'start' }, FIXED_NOW);
  const muted = applyOnboardingPatch(base, { action: 'set_first_touch_mute', muted: true }, LATER);
  assert.equal(muted.first_touch_muted, true);
  assert.equal(muted.current_step, base.current_step);
  const unmuted = applyOnboardingPatch(muted, { action: 'set_first_touch_mute', muted: false }, LATER);
  assert.equal(unmuted.first_touch_muted, false);
});

test('sanitize: drops unknown step ids from steps_completed before reducing', () => {
  const stale: OnboardingState = {
    ...defaultOnboardingState(),
    started_at: FIXED_NOW,
    current_step: 'welcome',
    // A v1 user might have `'dashboard'` and `'risk'` persisted.
    steps_completed: ['welcome', 'dashboard' as unknown as never, 'risk' as unknown as never],
  };
  const next = applyOnboardingPatch(stale, { action: 'mark_seen' }, LATER);
  assert.deepEqual(next.steps_completed, ['welcome']);
});
