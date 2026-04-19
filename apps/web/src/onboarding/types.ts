/**
 * Shared onboarding types for the web app. Mirror of the API types in
 * apps/api/src/onboarding/onboarding.types.ts — keep in sync.
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
  started_at: string | null;
  completed_at: string | null;
  skipped: boolean;
  current_step: StepId;
  steps_completed: StepId[];
  last_seen_at: string | null;
}

export type OnboardingPatch =
  | { action: 'start' }
  | { action: 'complete_step'; step: StepId }
  | { action: 'set_current_step'; step: StepId }
  | { action: 'skip' }
  | { action: 'restart' }
  | { action: 'mark_seen' };

export type StepKind = 'got_it' | 'action';

export interface StepContent {
  id: StepId;
  title: string;
  body: string;
  routePath: string;
  pulseSelectors?: string[];
  cta?: { label: string; actionKey?: string };
  completion: { kind: StepKind; actionKey?: string };
  emotionalBeat: string;
  videoUrl?: string;
}

export function toEmbedUrl(url: string): string {
  return url.replace(/\/\/www\.loom\.com\/share\//, '//www.loom.com/embed/');
}

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
