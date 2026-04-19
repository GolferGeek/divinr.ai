/**
 * Unit tests for the first-touch validation helpers + the extended onboarding
 * reducer (set_first_touch_mute action). No DB.
 *
 * Effort: onboarding-tour-extended.
 */
import assert from 'node:assert/strict';
import {
  isValidPrefix,
  isValidSurfaceKey,
} from '../../src/first-touch/first-touch.types';
import {
  applyOnboardingPatch,
  defaultOnboardingState,
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

const FIXED_NOW = '2026-04-19T12:00:00.000Z';

// ─── surface-key validation ───────────────────────────────────────────────

test('isValidSurfaceKey accepts well-formed dotted keys', () => {
  assert.equal(isValidSurfaceKey('dashboard'), true);
  assert.equal(isValidSurfaceKey('portfolio.detail'), true);
  assert.equal(isValidSurfaceKey('authoring.contract-section.predictor-generation'), true);
  assert.equal(isValidSurfaceKey('admin.cost-modeling.experiments'), true);
  assert.equal(isValidSurfaceKey('tournament.detail.my-positions'), true);
});

test('isValidSurfaceKey rejects empty, whitespace, leading-dot, uppercase, spaces', () => {
  assert.equal(isValidSurfaceKey(''), false);
  assert.equal(isValidSurfaceKey('   '), false);
  assert.equal(isValidSurfaceKey('.dashboard'), false);
  assert.equal(isValidSurfaceKey('-dashboard'), false);
  assert.equal(isValidSurfaceKey('Dashboard'), false);
  assert.equal(isValidSurfaceKey('portfolio detail'), false);
  assert.equal(isValidSurfaceKey('portfolio_detail'), false);
  assert.equal(isValidSurfaceKey('portfolio/detail'), false);
});

test('isValidSurfaceKey rejects non-strings', () => {
  assert.equal(isValidSurfaceKey(undefined), false);
  assert.equal(isValidSurfaceKey(null), false);
  assert.equal(isValidSurfaceKey(42), false);
  assert.equal(isValidSurfaceKey({}), false);
});

test('isValidSurfaceKey rejects keys over 120 chars', () => {
  const longKey = 'a'.repeat(121);
  assert.equal(isValidSurfaceKey(longKey), false);
  const maxKey = 'a'.repeat(120);
  assert.equal(isValidSurfaceKey(maxKey), true);
});

test('isValidPrefix accepts top-level and dotted prefixes', () => {
  assert.equal(isValidPrefix('portfolio'), true);
  assert.equal(isValidPrefix('portfolio.'), true);
  assert.equal(isValidPrefix('admin.cost-modeling'), true);
  assert.equal(isValidPrefix(''), false);
  assert.equal(isValidPrefix(null), false);
});

// ─── onboarding reducer: set_first_touch_mute ─────────────────────────────

test('defaultOnboardingState includes first_touch_muted: false', () => {
  const s = defaultOnboardingState();
  assert.equal(s.first_touch_muted, false);
});

test('set_first_touch_mute action flips the flag to true', () => {
  const start = defaultOnboardingState();
  const next = applyOnboardingPatch(start, { action: 'set_first_touch_mute', muted: true }, FIXED_NOW);
  assert.equal(next.first_touch_muted, true);
  assert.equal(next.last_seen_at, FIXED_NOW);
});

test('set_first_touch_mute action flips the flag back to false', () => {
  const muted = { ...defaultOnboardingState(), first_touch_muted: true };
  const next = applyOnboardingPatch(muted, { action: 'set_first_touch_mute', muted: false }, FIXED_NOW);
  assert.equal(next.first_touch_muted, false);
});

test('set_first_touch_mute does not affect other state fields', () => {
  const started = applyOnboardingPatch(defaultOnboardingState(), { action: 'start' }, FIXED_NOW);
  const muted = applyOnboardingPatch(started, { action: 'set_first_touch_mute', muted: true }, FIXED_NOW);
  assert.equal(muted.started_at, started.started_at);
  assert.equal(muted.current_step, started.current_step);
  assert.deepEqual(muted.steps_completed, started.steps_completed);
  assert.equal(muted.first_touch_muted, true);
});

test('set_first_touch_mute coerces non-true to false', () => {
  const start = defaultOnboardingState();
  // TypeScript would normally block this, but the reducer should still treat non-true as false.
  const next = applyOnboardingPatch(
    start,
    { action: 'set_first_touch_mute', muted: 'yes' as unknown as boolean },
    FIXED_NOW,
  );
  assert.equal(next.first_touch_muted, false);
});
