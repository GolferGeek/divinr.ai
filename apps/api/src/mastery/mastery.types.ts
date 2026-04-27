export type MasteryLevel =
  | 'core_trading'
  | 'competitive_participation'
  | 'community_creation'
  | 'builder'
  | 'operator';

export interface MasteryMilestones {
  firstTrade: boolean;
  firstPortfolioComparison: boolean;
  firstTournamentJoined: boolean;
  firstClubJoined: boolean;
  firstAuthoredItem: boolean;
  onboardingCompleted: boolean;
  touchedCoreSurfaces: string[];
}

export interface LearningPanelUsageSummary {
  totalCalls: number;
  totalCostCents: number;
}

export interface MasteryProfilePayload {
  currentLevel: MasteryLevel;
  preferredLevel: MasteryLevel | null;
  canSelfAdvance: boolean;
  milestones: MasteryMilestones;
  nextSuggestedSteps: string[];
  learningPanel: {
    enabled: boolean;
    usage: LearningPanelUsageSummary;
  };
  updatedAt: string;
}

export interface LearningPanelMasteryContext {
  currentLevel: MasteryLevel;
  effectiveLevel: MasteryLevel;
  nextLevel: MasteryLevel | null;
  visibleSurfaces: string[];
  nextSuggestedSteps: string[];
}

export const MASTERY_LEVEL_ORDER: MasteryLevel[] = [
  'core_trading',
  'competitive_participation',
  'community_creation',
  'builder',
  'operator',
];
