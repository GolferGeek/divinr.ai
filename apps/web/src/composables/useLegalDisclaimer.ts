import { DISCLAIMERS, type DisclaimerVariant } from '../onboarding/disclaimers';

export function useLegalDisclaimer() {
  function disclaimer(variant: DisclaimerVariant = 'short'): string {
    return DISCLAIMERS[variant];
  }

  return { disclaimer };
}
