/**
 * Shared types for the onboarding tour feature.
 *
 * Beginner Tour v2: 5 content beats + a terminal `done`. Step IDs are named
 * after the beat's emotional content so tour-to-surface-map wiring reads
 * obviously. `complete_step` advances `current_step` to the next item in
 * STEP_ORDER. `welcome` is the initial step before the tour starts; `done`
 * is terminal.
 */

export type StepId =
  | 'welcome'
  | 'analysts-and-instruments'
  | 'reading-an-analysis'
  | 'making-a-trade'
  | 'where-to-go-from-here'
  | 'done';

export const STEP_ORDER: readonly StepId[] = [
  'welcome',
  'analysts-and-instruments',
  'reading-an-analysis',
  'making-a-trade',
  'where-to-go-from-here',
  'done',
] as const;

export const STEP_ID_SET: ReadonlySet<string> = new Set(STEP_ORDER);

export function isStepId(value: unknown): value is StepId {
  return typeof value === 'string' && STEP_ID_SET.has(value);
}

export interface OnboardingState {
  started_at: string | null;   // ISO-8601
  completed_at: string | null; // ISO-8601
  skipped: boolean;
  current_step: StepId;
  steps_completed: StepId[];
  last_seen_at: string | null; // ISO-8601
  first_touch_muted: boolean;  // global mute for first-touch walkthroughs (v2)
}

export type OnboardingPatch =
  | { action: 'start' }
  | { action: 'complete_step'; step: StepId }
  | { action: 'set_current_step'; step: StepId }
  | { action: 'skip' }
  | { action: 'restart' }
  | { action: 'mark_seen' }
  | { action: 'set_first_touch_mute'; muted: boolean };

export function defaultOnboardingState(): OnboardingState {
  return {
    started_at: null,
    completed_at: null,
    skipped: false,
    current_step: 'welcome',
    steps_completed: [],
    last_seen_at: null,
    first_touch_muted: false,
  };
}

// First real step after `welcome`. Used by `start` and `restart` so the tour
// skips the welcome modal and lands on the first content beat.
const FIRST_CONTENT_STEP: StepId = STEP_ORDER[1]!;

/**
 * Sanitize inbound state by dropping any step ids no longer in STEP_ORDER.
 * v1 users may have persisted step ids like `'dashboard'`, `'risk'`, etc. The
 * reducer treats unknown ids as "ignore" rather than crashing, so a v2 deploy
 * does not trip v1 users into a broken tour.
 */
function sanitize(current: OnboardingState): OnboardingState {
  const filtered = current.steps_completed.filter(isStepId);
  if (filtered.length === current.steps_completed.length) return current;
  return { ...current, steps_completed: filtered };
}

/**
 * Pure reducer: apply a patch to an existing state and return the new state.
 * Exported for unit testing (no DB dependency). The service writes the result
 * back to Postgres.
 *
 * Throws on invalid step IDs — the controller layer catches and returns 400.
 */
export function applyOnboardingPatch(
  current: OnboardingState,
  patch: OnboardingPatch,
  now: string = new Date().toISOString(),
): OnboardingState {
  const sanitized = sanitize(current);
  switch (patch.action) {
    case 'start':
      return {
        ...sanitized,
        started_at: now,
        current_step: FIRST_CONTENT_STEP,
        steps_completed: dedupe([...sanitized.steps_completed, 'welcome']),
        skipped: false,
        completed_at: null,
        last_seen_at: now,
      };

    case 'complete_step': {
      if (!isStepId(patch.step)) throw new Error(`Invalid step: ${String(patch.step)}`);
      const completed = dedupe([...sanitized.steps_completed, patch.step]);
      const idx = STEP_ORDER.indexOf(patch.step);
      const nextStep: StepId =
        idx >= 0 && idx < STEP_ORDER.length - 1 ? STEP_ORDER[idx + 1]! : 'done';
      const completed_at = patch.step === 'done' ? (sanitized.completed_at ?? now) : sanitized.completed_at;
      return {
        ...sanitized,
        steps_completed: completed,
        current_step: nextStep,
        completed_at,
        last_seen_at: now,
      };
    }

    case 'set_current_step':
      if (!isStepId(patch.step)) throw new Error(`Invalid step: ${String(patch.step)}`);
      return { ...sanitized, current_step: patch.step, last_seen_at: now };

    case 'skip':
      return {
        ...sanitized,
        skipped: true,
        completed_at: now,
        current_step: 'done',
        steps_completed: [...STEP_ORDER],
        last_seen_at: now,
      };

    case 'restart':
      return {
        started_at: now,
        completed_at: null,
        skipped: false,
        current_step: FIRST_CONTENT_STEP,
        steps_completed: ['welcome'],
        last_seen_at: now,
        first_touch_muted: sanitized.first_touch_muted,
      };

    case 'mark_seen':
      return { ...sanitized, last_seen_at: now };

    case 'set_first_touch_mute':
      return { ...sanitized, first_touch_muted: patch.muted === true, last_seen_at: now };

    default: {
      const exhaustive: never = patch;
      throw new Error(`Unknown onboarding patch action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
