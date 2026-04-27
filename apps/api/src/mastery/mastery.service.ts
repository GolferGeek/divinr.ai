import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { FirstTouchService } from '../first-touch/first-touch.service';
import { LlmUsageQueryService } from '../markets/services/llm-usage-query.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import {
  type LearningPanelMasteryContext,
  type MasteryLevel,
  MASTERY_LEVEL_ORDER,
  type MasteryMilestones,
  type MasteryProfilePayload,
} from './mastery.types';

interface LearningProfileRow {
  mastery_level: MasteryLevel;
  preferred_level: MasteryLevel | null;
  updated_at: string;
}

const ADMIN_ROLES = new Set(['super-admin', 'owner']);
const VISIBLE_SURFACE_SUMMARY: Record<MasteryLevel, string[]> = {
  core_trading: [
    'dashboard',
    'learning panel',
    'analyses',
    'risk',
    'trade',
    'portfolios',
    'performance',
    'billing',
    'onboarding',
  ],
  competitive_participation: [
    'clubs',
    'tournaments',
    'visibility and social settings',
  ],
  community_creation: [
    'club creation',
    'tournament creation',
    'messages',
  ],
  builder: [
    'research',
    'analysts',
    'your content',
  ],
  operator: [
    'operator dashboards',
    'system runs',
    'LLM usage',
    'cost modeling',
    'attribution admin',
  ],
};

@Injectable()
export class MasteryService {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(FirstTouchService) private readonly firstTouch: FirstTouchService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(LlmUsageQueryService) private readonly usageQuery: LlmUsageQueryService,
  ) {}

  async getProfile(userId: string): Promise<MasteryProfilePayload> {
    const profile = await this.getOrCreateProfileRow(userId);
    const [milestones, learningPanelUsage] = await Promise.all([
      this.deriveMilestones(userId),
      this.getLearningPanelUsage(userId),
    ]);

    const currentLevel = profile.preferred_level ?? profile.mastery_level;
    return {
      currentLevel,
      preferredLevel: profile.preferred_level,
      canSelfAdvance: true,
      milestones,
      nextSuggestedSteps: this.buildSuggestedSteps(currentLevel, milestones),
      learningPanel: {
        enabled: process.env.LEARNING_PANEL_ENABLED !== 'false',
        usage: learningPanelUsage,
      },
      updatedAt: profile.updated_at,
    };
  }

  async updatePreferredLevel(
    userId: string,
    preferredLevel: MasteryLevel | null,
  ): Promise<MasteryProfilePayload> {
    if (preferredLevel !== null && !MASTERY_LEVEL_ORDER.includes(preferredLevel)) {
      throw new BadRequestException('Invalid preferred level');
    }

    const result = await this.db.rawQuery(
      `INSERT INTO prediction.user_learning_profiles (user_id, preferred_level)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET preferred_level = EXCLUDED.preferred_level,
             updated_at = now()`,
      [userId, preferredLevel],
    );
    if (result.error) {
      throw new Error(`Failed to update learning profile: ${result.error.message}`);
    }

    return this.getProfile(userId);
  }

  async getLearningPanelContext(
    userId: string,
    userRole?: string,
  ): Promise<LearningPanelMasteryContext> {
    const profile = await this.getProfile(userId);
    const effectiveLevel = ADMIN_ROLES.has(userRole ?? '')
      ? 'operator'
      : profile.currentLevel;
    return {
      currentLevel: profile.currentLevel,
      effectiveLevel,
      nextLevel: this.getNextLevel(profile.currentLevel),
      visibleSurfaces: this.getVisibleSurfaceSummary(effectiveLevel),
      nextSuggestedSteps: profile.nextSuggestedSteps,
    };
  }

  private async getOrCreateProfileRow(userId: string): Promise<LearningProfileRow> {
    const insertResult = await this.db.rawQuery(
      `INSERT INTO prediction.user_learning_profiles (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );
    if (insertResult.error) {
      throw new Error(`Failed to init learning profile: ${insertResult.error.message}`);
    }

    const result = await this.db.rawQuery(
      `SELECT mastery_level, preferred_level, updated_at
         FROM prediction.user_learning_profiles
        WHERE user_id = $1
        LIMIT 1`,
      [userId],
    );
    if (result.error) {
      throw new Error(`Failed to read learning profile: ${result.error.message}`);
    }
    const row = ((result.data as LearningProfileRow[] | null) ?? [])[0];
    if (!row) {
      throw new Error('Learning profile row missing after initialization');
    }
    return row;
  }

  private async deriveMilestones(userId: string): Promise<MasteryMilestones> {
    const [tradeResult, tournamentResult, clubResult, authoredResult, firstTouchState, onboardingState] =
      await Promise.all([
        this.db.rawQuery(`SELECT EXISTS(SELECT 1 FROM prediction.user_positions WHERE user_id = $1) AS present`, [userId]),
        this.db.rawQuery(`SELECT EXISTS(SELECT 1 FROM prediction.tournament_entries WHERE user_id = $1) AS present`, [userId]),
        this.db.rawQuery(`SELECT EXISTS(SELECT 1 FROM prediction.club_members WHERE user_id = $1) AS present`, [userId]),
        this.db.rawQuery(
          `SELECT EXISTS(
             SELECT 1
               FROM billing.authored_items
              WHERE user_id = $1
                AND status <> 'canceled'
           ) AS present`,
          [userId],
        ),
        this.firstTouch.getState(userId),
        this.onboarding.getState(userId),
      ]);

    const touchedCore = firstTouchState.touched.filter((key) =>
      ['predictions', 'risk-dashboard', 'portfolios', 'chat', 'dashboard'].includes(key),
    );

    return {
      firstTrade: this.readExists(tradeResult, 'Failed to read first-trade milestone'),
      firstPortfolioComparison: firstTouchState.touched.includes('portfolios'),
      firstTournamentJoined: this.readExists(tournamentResult, 'Failed to read tournament milestone'),
      firstClubJoined: this.readExists(clubResult, 'Failed to read club milestone'),
      firstAuthoredItem: this.readExists(authoredResult, 'Failed to read authored-item milestone'),
      onboardingCompleted: onboardingState.completed_at !== null,
      touchedCoreSurfaces: touchedCore,
    };
  }

  private async getLearningPanelUsage(userId: string): Promise<{ totalCalls: number; totalCostCents: number }> {
    const now = new Date();
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1).toISOString();
    const summary = await this.usageQuery.getSummary({
      userId,
      stage: 'learning_panel',
      startDate,
      endDate,
    });
    return {
      totalCalls: summary.total_calls,
      totalCostCents: summary.total_cost_cents,
    };
  }

  private buildSuggestedSteps(level: MasteryLevel, milestones: MasteryMilestones): string[] {
    const suggestions: string[] = [];

    if (level === 'core_trading') {
      if (!milestones.firstPortfolioComparison) suggestions.push('Compare your portfolio against the analyst portfolios.');
      if (!milestones.firstTrade) suggestions.push('Make your first paper trade from a live analysis.');
      if (!milestones.firstTournamentJoined) suggestions.push('Join a tournament to practice the trading loop.');
    }
    if (level === 'competitive_participation') {
      if (!milestones.firstClubJoined) suggestions.push('Join a club to add shared analysts, activity, and competition context.');
      suggestions.push('Ask the Learning Panel what changes when you move into community creation.');
    }
    if (level === 'community_creation') {
      suggestions.push('Create a club or tournament and invite other users into a shared workflow.');
    }
    if (level === 'builder') {
      if (!milestones.firstAuthoredItem) suggestions.push('Start with one authored analyst or instrument before expanding your builder surface.');
    }
    if (suggestions.length === 0) {
      suggestions.push('Use the Learning Panel to review what is available at your current level and what to learn next.');
    }
    return suggestions.slice(0, 3);
  }

  private getNextLevel(level: MasteryLevel): MasteryLevel | null {
    const idx = MASTERY_LEVEL_ORDER.indexOf(level);
    if (idx < 0 || idx >= MASTERY_LEVEL_ORDER.length - 1) return null;
    return MASTERY_LEVEL_ORDER[idx + 1];
  }

  private getVisibleSurfaceSummary(level: MasteryLevel): string[] {
    const idx = MASTERY_LEVEL_ORDER.indexOf(level);
    if (idx < 0) return [...VISIBLE_SURFACE_SUMMARY.core_trading];
    return MASTERY_LEVEL_ORDER
      .slice(0, idx + 1)
      .flatMap((entry) => VISIBLE_SURFACE_SUMMARY[entry]);
  }

  private readExists(
    result: { data?: Array<Record<string, unknown>> | null; error?: { message: string } | null },
    errorLabel: string,
  ): boolean {
    if (result.error) {
      throw new Error(`${errorLabel}: ${result.error.message}`);
    }
    return (((result.data as Array<Record<string, unknown>> | null) ?? [])[0]?.present ?? false) === true;
  }
}
