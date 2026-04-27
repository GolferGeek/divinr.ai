import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { OnboardingSchemaService } from './onboarding-schema.service';
import {
  applyOnboardingPatch,
  defaultOnboardingState,
  isStepId,
  type OnboardingPatch,
  type OnboardingState,
} from './onboarding.types';

/**
 * Service for reading and mutating per-user onboarding tour state.
 *
 * State lives in authz.user_preferences.onboarding_state (JSONB).
 * Rows are lazy-initialized on first GET via INSERT ... ON CONFLICT DO NOTHING.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(OnboardingSchemaService) private readonly schema: OnboardingSchemaService,
  ) {}

  async getState(userId: string): Promise<OnboardingState> {
    // Lazy-init the row with the default onboarding_state. If it exists, this
    // is a no-op; if it doesn't, we get the default via the column default.
    const insertResult = await this.db.rawQuery(
      `INSERT INTO authz.user_preferences (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );
    if (insertResult.error) {
      throw new Error(`Failed to init user preferences: ${insertResult.error.message}`);
    }

    return this.fetchState(userId);
  }

  async applyPatch(userId: string, patch: OnboardingPatch): Promise<OnboardingState> {
    await this.schema.ensureSchema();

    this.validatePatch(patch);

    const current = await this.getState(userId);
    let next: OnboardingState;
    try {
      next = applyOnboardingPatch(current, patch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(message);
    }

    const updateResult = await this.db.rawQuery(
      `UPDATE authz.user_preferences
         SET onboarding_state = $2::jsonb,
             updated_at = now()
       WHERE user_id = $1`,
      [userId, JSON.stringify(next)],
    );
    if (updateResult.error) {
      throw new Error(`Failed to update onboarding state: ${updateResult.error.message}`);
    }

    return next;
  }

  /**
   * Super-admin-only: wipe a user's onboarding state back to pristine defaults
   * (so they see the welcome modal again on next login). Caller gates role.
   */
  async resetUser(targetUserId: string): Promise<OnboardingState> {
    await this.schema.ensureSchema();

    const pristine = defaultOnboardingState();
    const result = await this.db.rawQuery(
      `INSERT INTO authz.user_preferences (user_id, onboarding_state)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO UPDATE
         SET onboarding_state = EXCLUDED.onboarding_state,
             updated_at = now()`,
      [targetUserId, JSON.stringify(pristine)],
    );
    if (result.error) {
      throw new Error(`Failed to reset onboarding: ${result.error.message}`);
    }
    return pristine;
  }

  // ─── internal ───────────────────────────────────────────────

  private async fetchState(userId: string): Promise<OnboardingState> {
    const result = await this.db.rawQuery(
      `SELECT onboarding_state FROM authz.user_preferences WHERE user_id = $1`,
      [userId],
    );
    if (result.error) {
      throw new Error(`Failed to read onboarding state: ${result.error.message}`);
    }
    const rows = (result.data as Array<{ onboarding_state: unknown }> | null) ?? [];
    if (rows.length === 0) {
      // Should never happen because getState() always INSERTs first, but be safe.
      return defaultOnboardingState();
    }
    const raw = rows[0]!.onboarding_state;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return this.normalizeState(parsed);
  }

  private normalizeState(raw: unknown): OnboardingState {
    const fallback = defaultOnboardingState();
    if (!raw || typeof raw !== 'object') return fallback;
    const r = raw as Record<string, unknown>;
    const currentStep = typeof r.current_step === 'string' && isStepId(r.current_step)
      ? r.current_step
      : fallback.current_step;
    const stepsRaw = Array.isArray(r.steps_completed) ? r.steps_completed : [];
    const steps = stepsRaw.filter(isStepId);
    return {
      started_at: typeof r.started_at === 'string' ? r.started_at : null,
      completed_at: typeof r.completed_at === 'string' ? r.completed_at : null,
      skipped: r.skipped === true,
      current_step: currentStep,
      steps_completed: steps,
      last_seen_at: typeof r.last_seen_at === 'string' ? r.last_seen_at : null,
      first_touch_muted: r.first_touch_muted === true,
    };
  }

  private validatePatch(patch: OnboardingPatch): void {
    const allowedActions = new Set([
      'start',
      'complete_step',
      'set_current_step',
      'skip',
      'restart',
      'mark_seen',
      'set_first_touch_mute',
    ]);
    if (!patch || typeof patch !== 'object' || !allowedActions.has((patch as { action?: string }).action ?? '')) {
      throw new BadRequestException(`Invalid patch action`);
    }
    if ((patch.action === 'complete_step' || patch.action === 'set_current_step') && !isStepId(patch.step)) {
      throw new BadRequestException(`Invalid step id: ${String((patch as { step?: unknown }).step)}`);
    }
    if (patch.action === 'set_first_touch_mute' && typeof (patch as { muted?: unknown }).muted !== 'boolean') {
      throw new BadRequestException(`set_first_touch_mute requires boolean muted`);
    }
  }
}
