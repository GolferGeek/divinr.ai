import { useApi } from '../composables/useApi';
import type { MasteryLevel } from '../mastery/mastery-config';

export interface MasteryMilestones {
  firstTrade: boolean;
  firstPortfolioComparison: boolean;
  firstTournamentJoined: boolean;
  firstClubJoined: boolean;
  firstAuthoredItem: boolean;
  onboardingCompleted: boolean;
  touchedCoreSurfaces: string[];
}

export interface MasteryProfile {
  currentLevel: MasteryLevel;
  preferredLevel: MasteryLevel | null;
  canSelfAdvance: boolean;
  milestones: MasteryMilestones;
  nextSuggestedSteps: string[];
  learningPanel: {
    enabled: boolean;
    usage: {
      totalCalls: number;
      totalCostCents: number;
    };
  };
  updatedAt: string;
}

export function useMasteryApi() {
  const api = useApi('/api/mastery');

  return {
    getProfile: () => api.get<MasteryProfile>('/profile'),
    updateProfile: (body: { preferredLevel?: MasteryLevel | null }) =>
      api.post<MasteryProfile>('/profile', body),
  };
}
