import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { ClubSchemaService } from './club-schema.service';
import type { Club } from './club.types';

export interface RankedClub {
  id: string;
  name: string;
  description: string | null;
  ranking_position: number;
  ranking_score: number;
  badges: Array<{ badge: string; earned_at: string }>;
  member_count: number;
  avg_return_pct: number;
  club_win_rate: number;
  tournament_count: number;
  prev_rank: number | null;
  rank_delta: number | null;
}

export interface ClubComparison {
  club_a: RankedClub;
  club_b: RankedClub;
}

export interface BadgeType {
  badge: string;
  label: string;
  description: string;
  color: string;
}

const BADGE_TYPES: BadgeType[] = [
  { badge: 'top_10_pct', label: 'Top 10%', description: 'Ranked in the top 10% of all public clubs', color: 'gold' },
  { badge: 'top_25_pct', label: 'Top 25%', description: 'Ranked in the top 25% of all public clubs', color: 'silver' },
  { badge: 'rising_club', label: 'Rising Club', description: 'Moved up 5+ positions in the last month', color: 'green' },
  { badge: 'most_improved', label: 'Most Improved', description: 'Biggest ranking score increase in the last month', color: 'blue' },
];

@Injectable()
export class ClubRankingService {
  private readonly logger = new Logger(ClubRankingService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ClubSchemaService) private readonly schema: ClubSchemaService,
  ) {}

  /** Nightly recomputation at 3 AM UTC */
  @Cron('0 3 * * *')
  async handleNightlyRankingCron(): Promise<void> {
    if (process.env.MARKETS_DISABLE_CLUB_RANKINGS === 'true') return;
    try {
      await this.recomputeRankings();
    } catch (err) {
      this.logger.error(`Ranking cron failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Daily snapshot at 23:50 UTC — fires before the 03:00 UTC recompute above so
   * that "yesterday's EOD rank" is captured before `clubs.ranking_position` is overwritten.
   */
  @Cron('50 23 * * *')
  async handleDailyRankSnapshotCron(): Promise<void> {
    if (process.env.MARKETS_DISABLE_RANK_SNAPSHOTS === 'true') return;
    try {
      const { snapshots } = await this.snapshotDaily();
      this.logger.log(`Club rank daily snapshot cron: ${snapshots} rows`);
    } catch (err) {
      this.logger.error(`Club rank daily snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async snapshotDaily(): Promise<{ snapshots: number }> {

    const now = new Date();
    const periodLabel = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

    const result = await this.db.rawQuery(`
      INSERT INTO prediction.club_ranking_snapshots
        (club_id, period_type, period_label, ranking_position, ranking_score,
         avg_return_pct, club_win_rate, member_count, tournament_count)
      SELECT c.id, 'daily', $1, c.ranking_position, c.ranking_score,
        COALESCE((
          SELECT AVG(CASE WHEN tp.initial_balance > 0
            THEN ((tp.total_realized_pnl + tp.total_unrealized_pnl) / tp.initial_balance) * 100 ELSE 0 END)::float8
          FROM prediction.tournament_portfolios tp
          JOIN prediction.tournaments t ON t.id = tp.tournament_id
          WHERE t.scope = 'club' AND t.scope_id = c.id AND t.status IN ('completed', 'archived')
            AND tp.user_id NOT IN (SELECT id FROM authz.users WHERE is_testing = true)
        ), 0),
        COALESCE((
          SELECT CASE WHEN COUNT(*) > 0
            THEN (COUNT(CASE WHEN tpos.realized_pnl > 0 THEN 1 END)::float8 / COUNT(*)::float8) * 100 ELSE 0 END
          FROM prediction.tournament_positions tpos
          JOIN prediction.tournaments t ON t.id = tpos.tournament_id
          WHERE t.scope = 'club' AND t.scope_id = c.id AND tpos.status = 'closed'
            AND tpos.user_id NOT IN (SELECT id FROM authz.users WHERE is_testing = true)
        ), 0),
        (SELECT COUNT(*)::int FROM prediction.club_members cm WHERE cm.club_id = c.id),
        (SELECT COUNT(*)::int FROM prediction.tournaments t WHERE t.scope = 'club' AND t.scope_id = c.id AND t.status IN ('completed', 'archived'))
      FROM prediction.clubs c
      WHERE c.is_public = true AND c.ranking_position IS NOT NULL
      ON CONFLICT (club_id, period_type, period_label) DO UPDATE SET
        ranking_position = excluded.ranking_position,
        ranking_score = excluded.ranking_score,
        avg_return_pct = excluded.avg_return_pct,
        club_win_rate = excluded.club_win_rate,
        member_count = excluded.member_count,
        tournament_count = excluded.tournament_count
      RETURNING id
    `, [periodLabel]);
    if (result.error) throw new Error(result.error.message);

    const count = ((result.data as Array<unknown> | null) ?? []).length;
    return { snapshots: count };
  }

  /** Monthly snapshot on 1st of each month at 4 AM UTC */
  @Cron('0 4 1 * *')
  async handleMonthlySnapshotCron(): Promise<void> {
    if (process.env.MARKETS_DISABLE_CLUB_RANKINGS === 'true') return;
    try {
      const now = new Date();
      const label = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      await this.createSnapshot('monthly', label);
    } catch (err) {
      this.logger.error(`Monthly snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Quarterly snapshot on 1st of Jan/Apr/Jul/Oct at 4 AM UTC */
  @Cron('0 4 1 1,4,7,10 *')
  async handleQuarterlySnapshotCron(): Promise<void> {
    if (process.env.MARKETS_DISABLE_CLUB_RANKINGS === 'true') return;
    try {
      const now = new Date();
      const quarter = Math.ceil((now.getMonth() + 1) / 3);
      const label = `${now.getFullYear()}-Q${quarter}`;
      await this.createSnapshot('quarterly', label);
    } catch (err) {
      this.logger.error(`Quarterly snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async recomputeRankings(): Promise<{ ranked: number }> {
    this.logger.log('Recomputing club rankings');

    // Get all public clubs with their stats
    const result = await this.db.rawQuery(`
      SELECT c.id,
        (SELECT COUNT(*)::int FROM prediction.club_members cm WHERE cm.club_id = c.id) as member_count,
        (SELECT COUNT(*)::int FROM prediction.tournaments t
         WHERE t.scope = 'club' AND t.scope_id = c.id AND t.status IN ('completed', 'archived')
         AND (SELECT COUNT(*) FROM prediction.tournament_entries te WHERE te.tournament_id = t.id) >= 3
        ) as tournament_count,
        COALESCE((
          SELECT AVG(CASE WHEN tp.initial_balance > 0
            THEN ((tp.total_realized_pnl + tp.total_unrealized_pnl) / tp.initial_balance) * 100 ELSE 0 END)::float8
          FROM prediction.tournament_portfolios tp
          JOIN prediction.tournaments t ON t.id = tp.tournament_id
          WHERE t.scope = 'club' AND t.scope_id = c.id AND t.status IN ('completed', 'archived')
            AND (SELECT COUNT(*) FROM prediction.tournament_entries te WHERE te.tournament_id = t.id) >= 3
            AND tp.user_id NOT IN (SELECT id FROM authz.users WHERE is_testing = true)
        ), 0) as avg_return_pct,
        COALESCE((
          SELECT CASE WHEN COUNT(*) > 0
            THEN (COUNT(CASE WHEN tpos.realized_pnl > 0 THEN 1 END)::float8 / COUNT(*)::float8) * 100
            ELSE 0 END
          FROM prediction.tournament_positions tpos
          JOIN prediction.tournaments t ON t.id = tpos.tournament_id
          WHERE t.scope = 'club' AND t.scope_id = c.id AND tpos.status = 'closed'
            AND tpos.user_id NOT IN (SELECT id FROM authz.users WHERE is_testing = true)
        ), 0) as club_win_rate
      FROM prediction.clubs c
      WHERE c.is_public = true
      ORDER BY c.id
    `);
    if (result.error) throw new Error(result.error.message);

    const clubs = (result.data as Array<{
      id: string; member_count: number; tournament_count: number;
      avg_return_pct: number; club_win_rate: number;
    }> | null) ?? [];

    // Compute composite scores
    const scored = clubs.map(c => ({
      ...c,
      score: (Number(c.avg_return_pct) * 0.4) +
             (Number(c.club_win_rate) * 0.3) +
             (Math.log2(Number(c.member_count) + 1) * 10 * 0.2) +
             (Number(c.tournament_count) * 0.1),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Get last month's positions for badge computation
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const lastLabel = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
    const snapResult = await this.db.rawQuery(
      `SELECT club_id, ranking_position, ranking_score FROM prediction.club_ranking_snapshots
       WHERE period_type = 'monthly' AND period_label = $1`,
      [lastLabel],
    );
    const lastPositions = new Map<string, { position: number; score: number }>();
    for (const row of ((snapResult.data as Array<{ club_id: string; ranking_position: number; ranking_score: number }> | null) ?? [])) {
      lastPositions.set(row.club_id, { position: row.ranking_position, score: Number(row.ranking_score) });
    }

    // Find most improved for badge
    let mostImprovedId: string | null = null;
    let mostImprovedDelta = 0;

    // Update each club
    for (let i = 0; i < scored.length; i++) {
      const c = scored[i];
      const position = i + 1;
      const badges: Array<{ badge: string; earned_at: string }> = [];
      const now = new Date().toISOString();
      const totalClubs = scored.length;

      if (totalClubs >= 3) {
        if (position <= Math.ceil(totalClubs * 0.1)) badges.push({ badge: 'top_10_pct', earned_at: now });
        else if (position <= Math.ceil(totalClubs * 0.25)) badges.push({ badge: 'top_25_pct', earned_at: now });

        const last = lastPositions.get(c.id);
        if (last && (last.position - position) >= 5) badges.push({ badge: 'rising_club', earned_at: now });

        if (last) {
          const delta = c.score - last.score;
          if (delta > mostImprovedDelta) {
            mostImprovedDelta = delta;
            mostImprovedId = c.id;
          }
        }
      }

      await this.db.rawQuery(
        `UPDATE prediction.clubs SET ranking_score = $1, ranking_position = $2, badges = $3 WHERE id = $4`,
        [Math.round(c.score * 100) / 100, position, JSON.stringify(badges), c.id],
      );
    }

    // Assign most_improved badge
    if (mostImprovedId && mostImprovedDelta > 0 && scored.length >= 3) {
      const existing = await this.db.rawQuery(`SELECT badges FROM prediction.clubs WHERE id = $1`, [mostImprovedId]);
      const currentBadges = ((existing.data as Array<{ badges: unknown[] }> | null) ?? [])[0]?.badges ?? [];
      const badges = Array.isArray(currentBadges) ? [...currentBadges] : [];
      badges.push({ badge: 'most_improved', earned_at: new Date().toISOString() });
      await this.db.rawQuery(`UPDATE prediction.clubs SET badges = $1 WHERE id = $2`, [JSON.stringify(badges), mostImprovedId]);
    }

    this.logger.log(`Rankings computed for ${scored.length} clubs`);
    return { ranked: scored.length };
  }

  async getLeaderboard(sortBy = 'ranking_score', limit = 50, offset = 0): Promise<RankedClub[]> {

    const validSorts: Record<string, string> = {
      ranking_score: 'c.ranking_score DESC',
      return_pct: 'avg_return_pct DESC',
      win_rate: 'club_win_rate DESC',
      member_count: 'member_count DESC',
    };
    const orderBy = validSorts[sortBy] ?? 'c.ranking_score DESC';

    const result = await this.db.rawQuery(`
      SELECT c.id, c.name, c.description, c.ranking_position, c.ranking_score, c.badges,
        (SELECT COUNT(*)::int FROM prediction.club_members cm WHERE cm.club_id = c.id) as member_count,
        COALESCE((
          SELECT AVG(CASE WHEN tp.initial_balance > 0
            THEN ((tp.total_realized_pnl + tp.total_unrealized_pnl) / tp.initial_balance) * 100 ELSE 0 END)::float8
          FROM prediction.tournament_portfolios tp
          JOIN prediction.tournaments t ON t.id = tp.tournament_id
          WHERE t.scope = 'club' AND t.scope_id = c.id AND t.status IN ('completed', 'archived')
            AND tp.user_id NOT IN (SELECT id FROM authz.users WHERE is_testing = true)
        ), 0) as avg_return_pct,
        COALESCE((
          SELECT CASE WHEN COUNT(*) > 0
            THEN (COUNT(CASE WHEN tpos.realized_pnl > 0 THEN 1 END)::float8 / COUNT(*)::float8) * 100
            ELSE 0 END
          FROM prediction.tournament_positions tpos
          JOIN prediction.tournaments t ON t.id = tpos.tournament_id
          WHERE t.scope = 'club' AND t.scope_id = c.id AND tpos.status = 'closed'
            AND tpos.user_id NOT IN (SELECT id FROM authz.users WHERE is_testing = true)
        ), 0) as club_win_rate,
        (SELECT COUNT(*)::int FROM prediction.tournaments t
         WHERE t.scope = 'club' AND t.scope_id = c.id AND t.status IN ('completed', 'archived')
        ) as tournament_count,
        s.prev_rank
      FROM prediction.clubs c
      LEFT JOIN LATERAL (
        SELECT ranking_position AS prev_rank
        FROM prediction.club_ranking_snapshots
        WHERE club_id = c.id
          AND period_type = 'daily'
          AND period_label < to_char(CURRENT_DATE, 'YYYY-MM-DD')
        ORDER BY period_label DESC
        LIMIT 1
      ) s ON TRUE
      WHERE c.is_public = true
      ORDER BY ${orderBy}
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    if (result.error) throw new Error(result.error.message);

    return ((result.data as Array<Record<string, unknown>> | null) ?? []).map(row => {
      const rankingPosition = Number(row.ranking_position ?? 0);
      const prevRank = row.prev_rank === null || row.prev_rank === undefined
        ? null
        : Number(row.prev_rank);
      const rankDelta = prevRank === null ? null : prevRank - rankingPosition;

      return {
        id: row.id as string,
        name: row.name as string,
        description: row.description as string | null,
        ranking_position: rankingPosition,
        ranking_score: Number(row.ranking_score ?? 0),
        badges: (row.badges as Array<{ badge: string; earned_at: string }>) ?? [],
        member_count: Number(row.member_count ?? 0),
        avg_return_pct: Math.round(Number(row.avg_return_pct ?? 0) * 100) / 100,
        club_win_rate: Math.round(Number(row.club_win_rate ?? 0) * 100) / 100,
        tournament_count: Number(row.tournament_count ?? 0),
        prev_rank: prevRank,
        rank_delta: rankDelta,
      };
    });
  }

  async compareClubs(clubIdA: string, clubIdB: string): Promise<ClubComparison> {
    const leaderboard = await this.getLeaderboard('ranking_score', 1000, 0);
    const clubA = leaderboard.find(c => c.id === clubIdA);
    const clubB = leaderboard.find(c => c.id === clubIdB);

    if (!clubA) throw new Error(`Club ${clubIdA} not found in public rankings`);
    if (!clubB) throw new Error(`Club ${clubIdB} not found in public rankings`);

    return { club_a: clubA, club_b: clubB };
  }

  async getRankingHistory(clubId: string): Promise<Array<{
    period_type: string; period_label: string; ranking_position: number;
    ranking_score: number; avg_return_pct: number; club_win_rate: number;
    member_count: number; tournament_count: number;
  }>> {
    const result = await this.db.rawQuery(
      `SELECT period_type, period_label, ranking_position, ranking_score,
              avg_return_pct, club_win_rate, member_count, tournament_count
       FROM prediction.club_ranking_snapshots
       WHERE club_id = $1
       ORDER BY created_at DESC`,
      [clubId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Array<{
      period_type: string; period_label: string; ranking_position: number;
      ranking_score: number; avg_return_pct: number; club_win_rate: number;
      member_count: number; tournament_count: number;
    }> | null) ?? [];
  }

  async createSnapshot(periodType: 'monthly' | 'quarterly', periodLabel: string): Promise<number> {
    this.logger.log(`Creating ${periodType} snapshot: ${periodLabel}`);

    const result = await this.db.rawQuery(`
      INSERT INTO prediction.club_ranking_snapshots
        (club_id, period_type, period_label, ranking_position, ranking_score,
         avg_return_pct, club_win_rate, member_count, tournament_count)
      SELECT c.id, $1, $2, c.ranking_position, c.ranking_score,
        COALESCE((
          SELECT AVG(CASE WHEN tp.initial_balance > 0
            THEN ((tp.total_realized_pnl + tp.total_unrealized_pnl) / tp.initial_balance) * 100 ELSE 0 END)::float8
          FROM prediction.tournament_portfolios tp
          JOIN prediction.tournaments t ON t.id = tp.tournament_id
          WHERE t.scope = 'club' AND t.scope_id = c.id AND t.status IN ('completed', 'archived')
            AND tp.user_id NOT IN (SELECT id FROM authz.users WHERE is_testing = true)
        ), 0),
        COALESCE((
          SELECT CASE WHEN COUNT(*) > 0
            THEN (COUNT(CASE WHEN tpos.realized_pnl > 0 THEN 1 END)::float8 / COUNT(*)::float8) * 100 ELSE 0 END
          FROM prediction.tournament_positions tpos
          JOIN prediction.tournaments t ON t.id = tpos.tournament_id
          WHERE t.scope = 'club' AND t.scope_id = c.id AND tpos.status = 'closed'
            AND tpos.user_id NOT IN (SELECT id FROM authz.users WHERE is_testing = true)
        ), 0),
        (SELECT COUNT(*)::int FROM prediction.club_members cm WHERE cm.club_id = c.id),
        (SELECT COUNT(*)::int FROM prediction.tournaments t WHERE t.scope = 'club' AND t.scope_id = c.id AND t.status IN ('completed', 'archived'))
      FROM prediction.clubs c
      WHERE c.is_public = true AND c.ranking_position IS NOT NULL
      ON CONFLICT (club_id, period_type, period_label) DO UPDATE SET
        ranking_position = excluded.ranking_position,
        ranking_score = excluded.ranking_score,
        avg_return_pct = excluded.avg_return_pct,
        club_win_rate = excluded.club_win_rate,
        member_count = excluded.member_count,
        tournament_count = excluded.tournament_count
      RETURNING id
    `, [periodType, periodLabel]);
    if (result.error) throw new Error(result.error.message);
    const count = ((result.data as Array<unknown> | null) ?? []).length;
    this.logger.log(`${periodType} snapshot ${periodLabel}: ${count} clubs captured`);
    return count;
  }

  getBadgeTypes(): BadgeType[] {
    return BADGE_TYPES;
  }
}
