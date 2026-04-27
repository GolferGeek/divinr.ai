import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { OnboardingService } from '../onboarding/onboarding.service';
import { FirstTouchSchemaService } from './first-touch-schema.service';
import {
  isValidPrefix,
  isValidSurfaceKey,
  type FirstTouchState,
} from './first-touch.types';

/**
 * Service for reading and mutating per-user first-touch walkthrough state.
 *
 * Touched rows live in prediction.user_surface_touches (one per user+surface).
 * Global mute lives on authz.user_preferences.onboarding_state.first_touch_muted
 * (delegated through OnboardingService).
 */
@Injectable()
export class FirstTouchService {
  private readonly logger = new Logger(FirstTouchService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(FirstTouchSchemaService) private readonly schema: FirstTouchSchemaService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
  ) {}

  async getState(userId: string): Promise<FirstTouchState> {
    const [touched, onboardingState] = await Promise.all([
      this.fetchTouchedKeys(userId),
      this.onboarding.getState(userId),
    ]);

    return {
      muted: onboardingState.first_touch_muted === true,
      touched,
    };
  }

  async markTouched(userId: string, surfaceKey: string): Promise<void> {
    if (!isValidSurfaceKey(surfaceKey)) {
      throw new BadRequestException(`Invalid surface_key: ${String(surfaceKey)}`);
    }

    const result = await this.db.rawQuery(
      `INSERT INTO prediction.user_surface_touches (user_id, surface_key)
       VALUES ($1, $2)
       ON CONFLICT (user_id, surface_key) DO NOTHING`,
      [userId, surfaceKey],
    );
    if (result.error) {
      throw new Error(`Failed to mark touched: ${result.error.message}`);
    }
  }

  async setMute(userId: string, muted: boolean): Promise<FirstTouchState> {
    if (typeof muted !== 'boolean') {
      throw new BadRequestException(`muted must be a boolean`);
    }
    await this.onboarding.applyPatch(userId, { action: 'set_first_touch_mute', muted });
    return this.getState(userId);
  }

  async resetAll(userId: string): Promise<FirstTouchState> {

    const result = await this.db.rawQuery(
      `DELETE FROM prediction.user_surface_touches WHERE user_id = $1`,
      [userId],
    );
    if (result.error) {
      throw new Error(`Failed to reset: ${result.error.message}`);
    }
    return this.getState(userId);
  }

  async resetByPrefix(userId: string, prefix: string): Promise<FirstTouchState> {
    if (!isValidPrefix(prefix)) {
      throw new BadRequestException(`Invalid prefix: ${String(prefix)}`);
    }

    const result = await this.db.rawQuery(
      `DELETE FROM prediction.user_surface_touches
        WHERE user_id = $1 AND surface_key LIKE $2`,
      [userId, `${prefix}%`],
    );
    if (result.error) {
      throw new Error(`Failed to reset prefix: ${result.error.message}`);
    }
    return this.getState(userId);
  }

  // ─── internal ───────────────────────────────────────────────

  private async fetchTouchedKeys(userId: string): Promise<string[]> {
    const result = await this.db.rawQuery(
      `SELECT surface_key FROM prediction.user_surface_touches WHERE user_id = $1`,
      [userId],
    );
    if (result.error) {
      throw new Error(`Failed to read touches: ${result.error.message}`);
    }
    const rows = (result.data as Array<{ surface_key: string }> | null) ?? [];
    return rows.map((r) => r.surface_key);
  }
}
