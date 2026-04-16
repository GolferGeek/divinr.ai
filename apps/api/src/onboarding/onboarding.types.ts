/**
 * Shared types for the onboarding tour feature.
 *
 * The step order is fixed (intention/PRD §4.2). `complete_step` advances
 * `current_step` to the next item in STEP_ORDER. `welcome` is the initial
 * step before the tour starts; `done` is terminal.
 */

export type StepId =
  | 'welcome'
  | 'dashboard'
  | 'predictions'
  | 'instrument-detail'
  | 'analysts'
  | 'performance'
  | 'risk'
  | 'portfolios'
  | 'clubs'
  | 'tournaments'
  | 'messages'
  | 'done';

export const STEP_ORDER: readonly StepId[] = [
  'welcome',
  'dashboard',
  'predictions',
  'instrument-detail',
  'analysts',
  'performance',
  'risk',
  'portfolios',
  'clubs',
  'tournaments',
  'messages',
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
}

export type OnboardingPatch =
  | { action: 'start' }
  | { action: 'complete_step'; step: StepId }
  | { action: 'set_current_step'; step: StepId }
  | { action: 'skip' }
  | { action: 'restart' }
  | { action: 'mark_seen' };

export function defaultOnboardingState(): OnboardingState {
  return {
    started_at: null,
    completed_at: null,
    skipped: false,
    current_step: 'welcome',
    steps_completed: [],
    last_seen_at: null,
  };
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
  switch (patch.action) {
    case 'start':
      return {
        ...current,
        started_at: now,
        current_step: 'dashboard',
        steps_completed: dedupe([...current.steps_completed, 'welcome']),
        skipped: false,
        completed_at: null,
        last_seen_at: now,
      };

    case 'complete_step': {
      if (!isStepId(patch.step)) throw new Error(`Invalid step: ${String(patch.step)}`);
      const completed = dedupe([...current.steps_completed, patch.step]);
      const idx = STEP_ORDER.indexOf(patch.step);
      // Advance to the next step in order; if we're completing the last step ('done')
      // or somehow past the end, stay on 'done'.
      const nextStep: StepId =
        idx >= 0 && idx < STEP_ORDER.length - 1 ? STEP_ORDER[idx + 1]! : 'done';
      // Completing the final step ('done') marks the tour as completed.
      const completed_at = patch.step === 'done' ? (current.completed_at ?? now) : current.completed_at;
      return {
        ...current,
        steps_completed: completed,
        current_step: nextStep,
        completed_at,
        last_seen_at: now,
      };
    }

    case 'set_current_step':
      if (!isStepId(patch.step)) throw new Error(`Invalid step: ${String(patch.step)}`);
      return { ...current, current_step: patch.step, last_seen_at: now };

    case 'skip':
      return {
        ...current,
        skipped: true,
        completed_at: now,
        current_step: 'done',
        steps_completed: [...STEP_ORDER],
        last_seen_at: now,
      };

    case 'restart':
      // Reset AND auto-start: user who clicks "Retake" has already opted in;
      // skip the welcome modal and land them at the first real step (dashboard).
      return {
        started_at: now,
        completed_at: null,
        skipped: false,
        current_step: 'dashboard',
        steps_completed: ['welcome'],
        last_seen_at: now,
      };

    case 'mark_seen':
      return { ...current, last_seen_at: now };

    default: {
      const exhaustive: never = patch;
      throw new Error(`Unknown onboarding patch action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
