import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { ClubSchemaService } from './club-schema.service';
import { ClubService } from './club.service';

export interface ClubAnalytics {
  member_count: number;
  tournament_count: number;
  trades_count: number;
  avg_return_pct: number | null;
  club_win_rate: number | null;
  analyst_trust: Array<{ analyst_id: string; display_name: string; avg_affinity: number }>;
  analyst_trust_evolution: Array<{ analyst_id: string; display_name: string; data_points: Array<{ date: string; avg_affinity: number }> }>;
  learning_score: number | null;
  club_style: string;
  common_mistakes: Array<{ symbol: string; total_loss: number; trade_count: number }>;
  contrarian_spotlights: Array<{ user_id: string; display_name: string | null; symbol: string; direction: string }>;
}

export interface PostMortem {
  tournament_name: string;
  starts_at: string;
  ends_at: string;
  entrant_count: number;
  top_performers: Array<{ user_id: string; display_name: string | null; return_pct: number; key_trades: Array<{ symbol: string; pnl: number }> }>;
  biggest_win: { user_id: string; display_name: string | null; symbol: string; pnl: number } | null;
  biggest_loss: { user_id: string; display_name: string | null; symbol: string; pnl: number } | null;
}

@Injectable()
export class ClubAnalyticsService {
  private readonly logger = new Logger(ClubAnalyticsService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ClubSchemaService) private readonly schema: ClubSchemaService,
    @Inject(ClubService) private readonly clubs: ClubService,
  ) {}

  async getClubAnalytics(clubId: string, userId: string): Promise<ClubAnalytics> {
    await this.schema.ensureSchema();
    await this.clubs.requireMembership(clubId, userId);

    // Member count
    const mcResult = await this.db.rawQuery(
      `SELECT COUNT(*)::int as count FROM prediction.club_members WHERE club_id = $1`, [clubId]);
    const memberCount = ((mcResult.data as Array<{ count: number }> | null) ?? [{ count: 0 }])[0].count;

    const tcResult = await this.db.rawQuery(
      `SELECT COUNT(*)::int as count FROM prediction.tournaments WHERE scope = 'club' AND scope_id = $1`, [clubId]);
    const tournamentCount = ((tcResult.data as Array<{ count: number }> | null) ?? [{ count: 0 }])[0].count;

    // Average return % across all member tournament portfolios in club tournaments
    const arResult = await this.db.rawQuery(
      `SELECT AVG(CASE WHEN tp.initial_balance > 0 THEN ((tp.total_realized_pnl + tp.total_unrealized_pnl) / tp.initial_balance) * 100 ELSE 0 END)::float8 as avg_return
       FROM prediction.tournament_portfolios tp
       JOIN prediction.tournaments t ON t.id = tp.tournament_id
       WHERE t.scope = 'club' AND t.scope_id = $1 AND t.status IN ('completed', 'archived')`, [clubId]);
    const avgReturn = ((arResult.data as Array<{ avg_return: number }> | null) ?? [{ avg_return: 0 }])[0].avg_return;

    // Club win rate across tournament positions
    const wrResult = await this.db.rawQuery(
      `SELECT
         COUNT(CASE WHEN tpos.realized_pnl > 0 THEN 1 END)::int as wins,
         COUNT(*)::int as total
       FROM prediction.tournament_positions tpos
       JOIN prediction.tournaments t ON t.id = tpos.tournament_id
       WHERE t.scope = 'club' AND t.scope_id = $1 AND tpos.status = 'closed'`, [clubId]);
    const wrData = ((wrResult.data as Array<{ wins: number; total: number }> | null) ?? [{ wins: 0, total: 0 }])[0];
    const tradesCount = wrData.total;
    const clubWinRate = tradesCount > 0 ? Math.round((wrData.wins / tradesCount) * 10000) / 100 : null;

    // Top 5 trusted analysts by average affinity across club members
    const atResult = await this.db.rawQuery(
      `SELECT uaa.analyst_id, ma.display_name, AVG(uaa.affinity_score)::float8 as avg_affinity
       FROM prediction.user_analyst_affinity uaa
       JOIN prediction.club_members cm ON cm.user_id = uaa.user_id AND cm.club_id = $1
       JOIN prediction.market_analysts ma ON ma.id = uaa.analyst_id
       GROUP BY uaa.analyst_id, ma.display_name
       ORDER BY avg_affinity DESC
       LIMIT 5`, [clubId]);
    const analystTrust = (atResult.data as Array<{ analyst_id: string; display_name: string; avg_affinity: number }> | null) ?? [];

    // Club style based on aggregate affinity patterns
    const clubStyle = analystTrust.length > 0
      ? deriveClubStyle(analystTrust.map(a => a.avg_affinity))
      : 'balanced';

    // Common mistakes: symbols where club lost money together
    const cmResult = await this.db.rawQuery(
      `SELECT tpos.symbol, SUM(tpos.realized_pnl)::float8 as total_loss, COUNT(*)::int as trade_count
       FROM prediction.tournament_positions tpos
       JOIN prediction.tournaments t ON t.id = tpos.tournament_id
       WHERE t.scope = 'club' AND t.scope_id = $1 AND tpos.status = 'closed' AND tpos.realized_pnl < 0
       GROUP BY tpos.symbol
       ORDER BY total_loss ASC
       LIMIT 3`, [clubId]);
    const commonMistakes = (cmResult.data as Array<{ symbol: string; total_loss: number; trade_count: number }> | null) ?? [];

    // Contrarian spotlights: members who voted against consensus and were correct
    const csResult = await this.db.rawQuery(
      `SELECT DISTINCT v.user_id, u.display_name, p.symbol, v.direction
       FROM prediction.club_consensus_votes v
       JOIN prediction.club_consensus_polls p ON p.id = v.poll_id
       LEFT JOIN authz.users u ON u.id = v.user_id
       WHERE p.club_id = $1 AND p.status = 'revealed'
         AND v.direction != (
           SELECT cv2.direction
           FROM prediction.club_consensus_votes cv2
           WHERE cv2.poll_id = p.id
           GROUP BY cv2.direction
           ORDER BY COUNT(*) DESC
           LIMIT 1
         )
       LIMIT 5`, [clubId]);
    const contrarianSpotlights = (csResult.data as Array<{ user_id: string; display_name: string | null; symbol: string; direction: string }> | null) ?? [];

    return {
      member_count: memberCount,
      tournament_count: tournamentCount,
      trades_count: tradesCount,
      avg_return_pct: tradesCount > 0 && avgReturn != null ? Math.round(avgReturn * 100) / 100 : null,
      club_win_rate: clubWinRate,
      analyst_trust: analystTrust,
      analyst_trust_evolution: [],
      learning_score: null,
      club_style: clubStyle,
      common_mistakes: commonMistakes,
      contrarian_spotlights: contrarianSpotlights,
    };
  }

  async getPostMortem(clubId: string, tournamentId: string, userId: string): Promise<PostMortem> {
    await this.schema.ensureSchema();
    await this.clubs.requireMembership(clubId, userId);

    // Tournament info
    const tResult = await this.db.rawQuery(
      `SELECT name, starts_at, ends_at FROM prediction.tournaments WHERE id = $1 AND scope = 'club' AND scope_id = $2`,
      [tournamentId, clubId],
    );
    if (tResult.error) throw new Error(tResult.error.message);
    const tournaments = (tResult.data as Array<{ name: string; starts_at: string; ends_at: string }> | null) ?? [];
    if (tournaments.length === 0) throw new Error('Tournament not found in this club');
    const tournament = tournaments[0]!;

    // Entrant count
    const ecResult = await this.db.rawQuery(
      `SELECT COUNT(*)::int as count FROM prediction.tournament_entries WHERE tournament_id = $1`, [tournamentId]);
    const entrantCount = ((ecResult.data as Array<{ count: number }> | null) ?? [{ count: 0 }])[0].count;

    // Top 3 performers
    const topResult = await this.db.rawQuery(
      `SELECT te.user_id, u.display_name, tp.initial_balance, tp.total_realized_pnl, tp.total_unrealized_pnl
       FROM prediction.tournament_entries te
       JOIN prediction.tournament_portfolios tp ON tp.id = te.portfolio_id
       LEFT JOIN authz.users u ON u.id = te.user_id
       WHERE te.tournament_id = $1
       ORDER BY (tp.total_realized_pnl + tp.total_unrealized_pnl) DESC
       LIMIT 3`, [tournamentId]);
    const topRows = (topResult.data as Array<{ user_id: string; display_name: string | null; initial_balance: number; total_realized_pnl: number; total_unrealized_pnl: number }> | null) ?? [];

    const topPerformers = [];
    for (const row of topRows) {
      const returnPct = Number(row.initial_balance) > 0
        ? Math.round(((Number(row.total_realized_pnl) + Number(row.total_unrealized_pnl)) / Number(row.initial_balance)) * 10000) / 100
        : 0;

      // Key trades for this performer
      const tradesResult = await this.db.rawQuery(
        `SELECT symbol, realized_pnl FROM prediction.tournament_positions
         WHERE tournament_id = $1 AND user_id = $2 AND status = 'closed'
         ORDER BY ABS(realized_pnl) DESC LIMIT 3`,
        [tournamentId, row.user_id],
      );
      const keyTrades = ((tradesResult.data as Array<{ symbol: string; realized_pnl: number }> | null) ?? [])
        .map(t => ({ symbol: t.symbol, pnl: Number(t.realized_pnl) }));

      topPerformers.push({ user_id: row.user_id, display_name: row.display_name, return_pct: returnPct, key_trades: keyTrades });
    }

    // Biggest win
    const bwResult = await this.db.rawQuery(
      `SELECT tpos.user_id, u.display_name, tpos.symbol, tpos.realized_pnl
       FROM prediction.tournament_positions tpos
       LEFT JOIN authz.users u ON u.id = tpos.user_id
       WHERE tpos.tournament_id = $1 AND tpos.status = 'closed'
       ORDER BY tpos.realized_pnl DESC LIMIT 1`, [tournamentId]);
    const bwRows = (bwResult.data as Array<{ user_id: string; display_name: string | null; symbol: string; realized_pnl: number }> | null) ?? [];
    const biggestWin = bwRows.length > 0 ? { user_id: bwRows[0].user_id, display_name: bwRows[0].display_name, symbol: bwRows[0].symbol, pnl: Number(bwRows[0].realized_pnl) } : null;

    // Biggest loss
    const blResult = await this.db.rawQuery(
      `SELECT tpos.user_id, u.display_name, tpos.symbol, tpos.realized_pnl
       FROM prediction.tournament_positions tpos
       LEFT JOIN authz.users u ON u.id = tpos.user_id
       WHERE tpos.tournament_id = $1 AND tpos.status = 'closed'
       ORDER BY tpos.realized_pnl ASC LIMIT 1`, [tournamentId]);
    const blRows = (blResult.data as Array<{ user_id: string; display_name: string | null; symbol: string; realized_pnl: number }> | null) ?? [];
    const biggestLoss = blRows.length > 0 ? { user_id: blRows[0].user_id, display_name: blRows[0].display_name, symbol: blRows[0].symbol, pnl: Number(blRows[0].realized_pnl) } : null;

    return {
      tournament_name: tournament.name,
      starts_at: tournament.starts_at,
      ends_at: tournament.ends_at,
      entrant_count: entrantCount,
      top_performers: topPerformers,
      biggest_win: biggestWin,
      biggest_loss: biggestLoss,
    };
  }
}

function deriveClubStyle(affinities: number[]): string {
  if (affinities.length === 0) return 'balanced';
  const avg = affinities.reduce((a, b) => a + b, 0) / affinities.length;
  const variance = affinities.reduce((sum, a) => sum + (a - avg) ** 2, 0) / affinities.length;
  if (variance > 0.05) return 'diverse';
  if (avg > 0.65) return 'trend follower';
  if (avg < 0.35) return 'contrarian';
  return 'balanced';
}
