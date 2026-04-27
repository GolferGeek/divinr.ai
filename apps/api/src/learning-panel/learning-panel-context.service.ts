import { Inject, Injectable, Logger } from '@nestjs/common';
import { FirstTouchService } from '../first-touch/first-touch.service';
import { OnboardingService } from '../onboarding/onboarding.service';

export interface LearningPanelUserContext {
  currentSurfaceKey?: string;
  firstTouchMuted: boolean;
  touchedKeys: string[];
  onboardingCompletedSteps: string[];
  onboardingCompleted: boolean;
}

@Injectable()
export class LearningPanelContextService {
  private readonly logger = new Logger(LearningPanelContextService.name);

  constructor(
    @Inject(FirstTouchService) private readonly firstTouch: FirstTouchService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
  ) {}

  async getUserContext(
    userId: string,
    currentSurfaceKey?: string,
  ): Promise<LearningPanelUserContext> {
    const [firstTouchState, onboardingState] = await Promise.all([
      this.firstTouch.getState(userId).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Falling back to empty first-touch context for ${userId}: ${message}`);
        return { muted: false, touched: [] };
      }),
      this.onboarding.getState(userId).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Falling back to empty onboarding context for ${userId}: ${message}`);
        return {
          started_at: null,
          completed_at: null,
          skipped: false,
          current_step: 'welcome',
          steps_completed: [],
          last_seen_at: null,
          first_touch_muted: false,
        };
      }),
    ]);

    return {
      currentSurfaceKey,
      firstTouchMuted: firstTouchState.muted,
      touchedKeys: firstTouchState.touched,
      onboardingCompletedSteps: onboardingState.steps_completed,
      onboardingCompleted: onboardingState.completed_at !== null,
    };
  }
}
