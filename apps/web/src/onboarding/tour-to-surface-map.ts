/**
 * Map each Beginner Tour beat to the first-touch surface keys it covers.
 *
 * When a beat completes (via `completeStep`) or the whole tour is skipped,
 * the onboarding store calls `firstTouchStore.markTouched(key)` for every
 * key in the beat's list — so a user who has just been walked through these
 * surfaces does not then get a first-touch panel on the same screens.
 *
 * Keys here MUST exist in PRD Appendix A / surface-content.ts; the coverage
 * script catches drift.
 */
import type { StepId } from './types';

export const tourBeatToSurfaces: Record<StepId, string[]> = {
  welcome: ['welcome-modal'],
  'analysts-and-instruments': [
    'analysts',
    'analyst.detail',
    'instruments',
    'instrument.detail',
  ],
  'reading-an-analysis': [
    'predictions',
    'prediction.card',
    'prediction.detail',
  ],
  'making-a-trade': ['prediction.trade-cta'],
  'where-to-go-from-here': [
    'clubs',
    'tournaments',
    'learning-dashboard',
    'dashboard',
    'settings.onboarding',
  ],
  done: [],
};

/**
 * Flattened set of every surface key taught by the tour. Used by the
 * skip-tour sweep so a user who opts out of the tour still has those
 * surfaces marked as "already shown".
 */
export function allTourSurfaceKeys(): string[] {
  return Array.from(new Set(Object.values(tourBeatToSurfaces).flat()));
}
