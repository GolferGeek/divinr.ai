/**
 * Unit tests for the onboarding patch reducer (applyOnboardingPatch).
 * Effort: onboarding-tour.
 *
 * Tests the pure reducer — no DB. Covers all 6 patch actions, dedup behavior,
 * step order advancement, and invalid step rejection.
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

test('defaultOnboardingState returns pristine shape', () => {
  const s = defaultOnboardingState();
  assert.equal(s.started_at, null);
  assert.equal(s.completed_at, null);
  assert.equal(s.skipped, false);
  assert.equal(s.current_step, 'welcome');
  assert.deepEqual(s.steps_completed, []);
  assert.equal(s.last_seen_at, null);
});

test('STEP_ORDER has 12 steps, welcome first, done last', () => {
  assert.equal(STEP_ORDER.length, 12);
  assert.equal(STEP_ORDER[0], 'welcome');
  assert.equal(STEP_ORDER[STEP_ORDER.length - 1], 'done');
});

test('isStepId accepts valid, rejects invalid', () => {
  assert.equal(isStepId('dashboard'), true);
  assert.equal(isStepId('done'), true);
  assert.equal(isStepId('bogus'), false);
  assert.equal(isStepId(42), false);
  assert.equal(isStepId(null), false);
});

test('start: sets started_at, advances to dashboard, marks welcome complete', () => {
  const next = applyOnboardingPatch(defaultOnboardingState(), { action: 'start' }, FIXED_NOW);
  assert.equal(next.started_at, FIXED_NOW);
  assert.equal(next.current_step, 'dashboard');
  assert.deepEqual(next.steps_completed, ['welcome']);
  assert.equal(next.skipped, false);
  assert.equal(next.completed_at, null);
  assert.equal(next.last_seen_at, FIXED_NOW);
});

test('complete_step: advances to next step in order, dedupes', () => {
  const after_start = applyOnboardingPatch(defaultOnboardingState(), { action: 'start' }, FIXED_NOW);
  const next = applyOnboardingPatch(
    after_start,
    { action: 'complete_step', step: 'dashboard' },
    LATER,
  );
  assert.equal(next.current_step, 'predictions');
  assert.deepEqual(next.steps_completed, ['welcome', 'dashboard']);
  assert.equal(next.last_seen_at, LATER);
});

test('complete_step: dedupes when called twice for same step', () => {
  const base = applyOnboardingPatch(defaultOnboardingState(), { action: 'start' }, FIXED_NOW);
  const first = applyOnboardingPatch(base, { action: 'complete_step', step: 'dashboard' }, LATER);
  const second = applyOnboardingPatch(first, { action: 'complete_step', step: 'dashboard' }, LATER);
  assert.deepEqual(second.steps_completed, ['welcome', 'dashboard']);
});

test('complete_step: advancing through all steps lands on done', () => {
  let state: OnboardingState = applyOnboardingPatch(
    defaultOnboardingState(),
    { action: 'start' },
    FIXED_NOW,
  );
  // walk: dashboard → predictions → ... → messages (11 complete_step calls after start)
  const stepsToComplete = STEP_ORDER.slice(1, -1); // dashboard through messages
  for (const step of stepsToComplete) {
    state = applyOnboardingPatch(state, { action: 'complete_step', step }, LATER);
  }
  assert.equal(state.current_step, 'done');
  assert.equal(state.completed_at, null, 'not completed yet — done step not yet completed');

  // complete 'done' itself → completed_at set
  state = applyOnboardingPatch(state, { action: 'complete_step', step: 'done' }, LATER);
  assert.equal(state.current_step, 'done', 'stays on done');
  assert.equal(state.completed_at, LATER);
  assert.equal(state.steps_completed.length, 12);
});

test('complete_step: invalid step id throws', () => {
  const base = defaultOnboardingState();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.throws(() => applyOnboardingPatch(base, { action: 'complete_step', step: 'bogus' as any }, FIXED_NOW));
});

test('set_current_step: jumps to arbitrary valid step', () => {
  const base = applyOnboardingPatch(defaultOnboardingState(), { action: 'start' }, FIXED_NOW);
  const next = applyOnboardingPatch(base, { action: 'set_current_step', step: 'risk' }, LATER);
  assert.equal(next.current_step, 'risk');
  // steps_completed unchanged
  assert.deepEqual(next.steps_completed, ['welcome']);
});

test('set_current_step: invalid step id throws', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.throws(() => applyOnboardingPatch(defaultOnboardingState(), { action: 'set_current_step', step: 'foo' as any }, FIXED_NOW));
});

test('skip: marks skipped, completes all 12 steps, sets completed_at, current_step=done', () => {
  const next = applyOnboardingPatch(defaultOnboardingState(), { action: 'skip' }, FIXED_NOW);
  assert.equal(next.skipped, true);
  assert.equal(next.completed_at, FIXED_NOW);
  assert.equal(next.current_step, 'done');
  assert.equal(next.steps_completed.length, 12);
  assert.deepEqual(next.steps_completed, [...STEP_ORDER]);
});

test('restart: resets and auto-starts (not the welcome-modal state)', () => {
  // user previously skipped
  const skipped = applyOnboardingPatch(defaultOnboardingState(), { action: 'skip' }, FIXED_NOW);
  assert.equal(skipped.skipped, true);

  const restarted = applyOnboardingPatch(skipped, { action: 'restart' }, LATER);
  assert.equal(restarted.skipped, false);
  assert.equal(restarted.completed_at, null);
  assert.equal(restarted.started_at, LATER, 'started_at set to now');
  assert.equal(restarted.current_step, 'dashboard', 'auto-started at dashboard, not welcome');
  assert.deepEqual(restarted.steps_completed, ['welcome']);
});

test('mark_seen: updates last_seen_at only', () => {
  const base = applyOnboardingPatch(defaultOnboardingState(), { action: 'start' }, FIXED_NOW);
  const next = applyOnboardingPatch(base, { action: 'mark_seen' }, LATER);
  assert.equal(next.last_seen_at, LATER);
  // everything else unchanged
  assert.equal(next.started_at, base.started_at);
  assert.equal(next.current_step, base.current_step);
  assert.deepEqual(next.steps_completed, base.steps_completed);
});
