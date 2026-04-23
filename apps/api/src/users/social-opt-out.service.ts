import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

/**
 * Five boolean "silent-user" flags on `authz.users`. Defaulted to `true`
 * (fully visible) at migration time — see
 * `apps/api/db/migrations/2026-04-19-social-opt-outs.sql`.
 */
export interface SocialOptOuts {
  social_visible_in_member_lists: boolean;
  social_messaging_enabled: boolean;
  social_tournament_participation: boolean;
  social_leaderboard_visible: boolean;
  social_notifications_enabled: boolean;
}

export type SocialOptOutFlag = keyof SocialOptOuts;

const FLAGS: readonly SocialOptOutFlag[] = [
  'social_visible_in_member_lists',
  'social_messaging_enabled',
  'social_tournament_participation',
  'social_leaderboard_visible',
  'social_notifications_enabled',
] as const;

const ALL_VISIBLE: SocialOptOuts = {
  social_visible_in_member_lists: true,
  social_messaging_enabled: true,
  social_tournament_participation: true,
  social_leaderboard_visible: true,
  social_notifications_enabled: true,
};

/**
 * Self-serve social opt-outs for the silent-$50-user experience.
 * Values live on `authz.users` (PRD names `public.profiles`; the Phase-2
 * migration deviated to `authz.users` since that's the canonical user row
 * in this codebase and already carries `is_testing`).
 */
@Injectable()
export class SocialOptOutService {
  private readonly logger = new Logger(SocialOptOutService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async getOptOuts(userId: string): Promise<SocialOptOuts> {
    const result = await this.db.rawQuery(
      `SELECT ${FLAGS.join(', ')} FROM authz.users WHERE id = $1`,
      [userId],
    );
    if (result.error) throw new Error(`getOptOuts failed: ${result.error.message}`);
    const rows = (result.data as SocialOptOuts[] | null) ?? [];
    if (rows.length === 0) return { ...ALL_VISIBLE };
    const row = rows[0];
    return {
      social_visible_in_member_lists: !!row.social_visible_in_member_lists,
      social_messaging_enabled: !!row.social_messaging_enabled,
      social_tournament_participation: !!row.social_tournament_participation,
      social_leaderboard_visible: !!row.social_leaderboard_visible,
      social_notifications_enabled: !!row.social_notifications_enabled,
    };
  }

  async setOptOuts(userId: string, partial: Partial<SocialOptOuts>): Promise<SocialOptOuts> {
    const updates = FLAGS.filter((f) => partial[f] !== undefined);
    if (updates.length === 0) return this.getOptOuts(userId);

    const setClauses = updates.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = [userId, ...updates.map((f) => !!partial[f])];
    const result = await this.db.rawQuery(
      `UPDATE authz.users SET ${setClauses} WHERE id = $1 RETURNING ${FLAGS.join(', ')}`,
      values,
    );
    if (result.error) throw new Error(`setOptOuts failed: ${result.error.message}`);
    const rows = (result.data as SocialOptOuts[] | null) ?? [];
    if (rows.length === 0) throw new Error(`setOptOuts: no user row for ${userId}`);
    return rows[0];
  }

  /**
   * Append a visibility filter to a SQL fragment. The caller supplies SQL whose
   * WHERE clause already exists and can be extended; we append
   *   AND (u.<flag> IS NOT FALSE OR u.id = $viewerId)
   * and return the extended SQL plus the appended params. The viewer always
   * sees themselves (PRD §4.3 US-7 implicit). `IS NOT FALSE` is NULL-safe so
   * LEFT-JOINed rows with no matching `authz.users` default to visible.
   *
   * Requires the caller to have already joined `authz.users u ON u.id = <target_user_id>`.
   * If the join doesn't exist, wire it in before calling this helper.
   */
  applyVisibilityFilter(
    sql: string,
    params: unknown[],
    viewerId: string,
    flag: SocialOptOutFlag,
    alias = 'u',
  ): { sql: string; params: unknown[] } {
    if (!FLAGS.includes(flag)) throw new Error(`unknown opt-out flag: ${flag}`);
    const placeholder = `$${params.length + 1}`;
    const clause = ` AND (${alias}.${flag} IS NOT FALSE OR ${alias}.id = ${placeholder})`;
    return {
      sql: sql + clause,
      params: [...params, viewerId],
    };
  }

  static get flags(): readonly SocialOptOutFlag[] {
    return FLAGS;
  }
}
