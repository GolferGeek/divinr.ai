import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { TournamentSchemaService } from './tournament-schema.service';
import type { Tournament, TournamentEntry } from './tournament.types';

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string | null;
  return_pct: number;
  total_pnl: number;
  win_rate: number;
  sharpe_ratio: number | null;
  prev_rank: number | null;
  rank_delta: number | null;
}

export interface TournamentResults {
  tournament: Tournament;
  standings: Array<LeaderboardEntry & { final_rank: number }>;
  notable_stats: {
    best_trade: { user_id: string; display_name: string | null; symbol: string; pnl: number } | null;
    highest_sharpe: { user_id: string; display_name: string | null; sharpe_ratio: number } | null;
    biggest_comeback: { user_id: string; display_name: string | null; lowest_point: number; final_return: number } | null;
  };
}

@Injectable()
export class TournamentLeaderboardService {
  private readonly logger = new Logger(TournamentLeaderboardService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(TournamentSchemaService) private readonly schema: TournamentSchemaService,
  ) {}

  async getLeaderboard(tournamentId: string): Promise<LeaderboardEntry[]> {
    await this.schema.ensureSchema();

    const result = await this.db.rawQuery(
      `SELECT
         te.user_id,
         u.display_name,
         tp.initial_balance,
         tp.current_balance,
         tp.total_realized_pnl,
         tp.total_unrealized_pnl,
         (SELECT COUNT(*) FROM prediction.tournament_positions pos
          WHERE pos.portfolio_id = tp.id AND pos.status = 'closed' AND pos.realized_pnl > 0
         )::int as wins,
         (SELECT COUNT(*) FROM prediction.tournament_positions pos
          WHERE pos.portfolio_id = tp.id AND pos.status = 'closed'
         )::int as total_closed,
         s.prev_rank
       FROM prediction.tournament_entries te
       JOIN prediction.tournament_portfolios tp ON tp.id = te.portfolio_id
       LEFT JOIN authz.users u ON u.id = te.user_id
       LEFT JOIN LATERAL (
         SELECT rank AS prev_rank
         FROM prediction.tournament_rank_snapshots
         WHERE tournament_id = $1
           AND user_id = te.user_id
           AND snapshot_date < CURRENT_DATE
         ORDER BY snapshot_date DESC
         LIMIT 1
       ) s ON TRUE
       WHERE te.tournament_id = $1
       ORDER BY (tp.total_realized_pnl + tp.total_unrealized_pnl) DESC, te.user_id ASC`,
      [tournamentId],
    );
    if (result.error) throw new Error(result.error.message);

    const rows = (result.data as Array<{
      user_id: string;
      display_name: string | null;
      initial_balance: number;
      current_balance: number;
      total_realized_pnl: number;
      total_unrealized_pnl: number;
      wins: number;
      total_closed: number;
      prev_rank: number | null;
    }> | null) ?? [];

    return rows.map((row, index) => {
      const totalPnl = Number(row.total_realized_pnl) + Number(row.total_unrealized_pnl);
      const returnPct = Number(row.initial_balance) > 0
        ? (totalPnl / Number(row.initial_balance)) * 100
        : 0;
      const winRate = row.total_closed > 0
        ? (row.wins / row.total_closed) * 100
        : 0;

      const rank = index + 1;
      const prevRank = row.prev_rank === null || row.prev_rank === undefined
        ? null
        : Number(row.prev_rank);
      const rankDelta = prevRank === null ? null : prevRank - rank;

      return {
        rank,
        user_id: row.user_id,
        display_name: row.display_name,
        return_pct: Math.round(returnPct * 100) / 100,
        total_pnl: Math.round(totalPnl * 100) / 100,
        win_rate: Math.round(winRate * 100) / 100,
        sharpe_ratio: null, // Requires daily return history — computed in finalizeResults
        prev_rank: prevRank,
        rank_delta: rankDelta,
      };
    });
  }

  async getResults(tournamentId: string): Promise<TournamentResults | null> {
    await this.schema.ensureSchema();

    // Verify tournament is completed
    const tResult = await this.db.rawQuery(
      `SELECT * FROM prediction.tournaments WHERE id = $1`,
      [tournamentId],
    );
    if (tResult.error) throw new Error(tResult.error.message);
    const tournaments = (tResult.data as Tournament[] | null) ?? [];
    if (tournaments.length === 0) return null;

    const tournament = tournaments[0]!;
    if (tournament.status !== 'completed' && tournament.status !== 'archived') {
      return null;
    }

    // Get standings with final_rank
    const leaderboard = await this.getLeaderboard(tournamentId);
    const entriesResult = await this.db.rawQuery(
      `SELECT user_id, final_rank FROM prediction.tournament_entries WHERE tournament_id = $1`,
      [tournamentId],
    );
    const entries = (entriesResult.data as Array<{ user_id: string; final_rank: number | null }> | null) ?? [];
    const rankMap = new Map(entries.map(e => [e.user_id, e.final_rank]));

    const standings = leaderboard.map(entry => ({
      ...entry,
      final_rank: rankMap.get(entry.user_id) ?? entry.rank,
    }));

    // Notable stats
    const bestTrade = await this.getBestTrade(tournamentId);
    const highestSharpe = standings.length > 0 && standings[0].sharpe_ratio !== null
      ? { user_id: standings[0].user_id, display_name: standings[0].display_name, sharpe_ratio: standings[0].sharpe_ratio }
      : null;

    return {
      tournament,
      standings,
      notable_stats: {
        best_trade: bestTrade,
        highest_sharpe: highestSharpe,
        biggest_comeback: null, // Requires daily snapshot history — future enhancement
      },
    };
  }

  async finalizeResults(tournamentId: string): Promise<void> {
    await this.schema.ensureSchema();
    this.logger.log(`Finalizing results for tournament ${tournamentId}`);

    // Close all open positions at current prices
    const openPositions = await this.db.rawQuery(
      `SELECT id, portfolio_id, direction, entry_price, current_price, quantity
       FROM prediction.tournament_positions
       WHERE tournament_id = $1 AND status = 'open'`,
      [tournamentId],
    );
    if (openPositions.error) throw new Error(openPositions.error.message);

    const positions = (openPositions.data as Array<{
      id: string; portfolio_id: string; direction: string;
      entry_price: number; current_price: number; quantity: number;
    }> | null) ?? [];

    for (const pos of positions) {
      const exitPrice = pos.current_price ?? pos.entry_price;
      if (!exitPrice || !pos.entry_price) continue;

      const realizedPnl = pos.direction === 'long'
        ? (exitPrice - pos.entry_price) * pos.quantity
        : (pos.entry_price - exitPrice) * pos.quantity;

      await this.db.rawQuery(
        `UPDATE prediction.tournament_positions
         SET status = 'closed', exit_price = $1, realized_pnl = $2, unrealized_pnl = 0, closed_at = now()
         WHERE id = $3`,
        [exitPrice, realizedPnl, pos.id],
      );

      await this.db.rawQuery(
        `UPDATE prediction.tournament_portfolios
         SET current_balance = current_balance + $1,
             total_realized_pnl = total_realized_pnl + $2,
             total_unrealized_pnl = GREATEST(total_unrealized_pnl - $3, 0)
         WHERE id = $4`,
        [realizedPnl, realizedPnl, Math.abs(Number(pos.current_price ?? 0) - Number(pos.entry_price)) * pos.quantity, pos.portfolio_id],
      );
    }

    // Cancel any remaining queued trades
    await this.db.rawQuery(
      `UPDATE prediction.tournament_trade_queue
       SET status = 'cancelled'
       WHERE tournament_id = $1 AND status = 'queued'`,
      [tournamentId],
    );

    // Compute final rankings and set final_rank
    const leaderboard = await this.getLeaderboard(tournamentId);
    for (const entry of leaderboard) {
      await this.db.rawQuery(
        `UPDATE prediction.tournament_entries SET final_rank = $1 WHERE tournament_id = $2 AND user_id = $3`,
        [entry.rank, tournamentId, entry.user_id],
      );
    }

    this.logger.log(`Finalized tournament ${tournamentId}: ${positions.length} positions closed, ${leaderboard.length} entries ranked`);
  }

  async getHistory(userId: string): Promise<Array<{
    tournament_id: string;
    tournament_name: string;
    tournament_type: string;
    final_rank: number | null;
    return_pct: number;
    starts_at: string;
    ends_at: string;
  }>> {
    await this.schema.ensureSchema();

    const result = await this.db.rawQuery(
      `SELECT t.id as tournament_id, t.name as tournament_name, t.tournament_type,
              te.final_rank, t.starts_at, t.ends_at,
              tp.initial_balance, tp.total_realized_pnl, tp.total_unrealized_pnl
       FROM prediction.tournament_entries te
       JOIN prediction.tournaments t ON t.id = te.tournament_id
       JOIN prediction.tournament_portfolios tp ON tp.id = te.portfolio_id
       WHERE te.user_id = $1 AND t.status IN ('completed', 'archived')
       ORDER BY t.ends_at DESC`,
      [userId],
    );
    if (result.error) throw new Error(result.error.message);

    const rows = (result.data as Array<{
      tournament_id: string; tournament_name: string; tournament_type: string;
      final_rank: number | null; starts_at: string; ends_at: string;
      initial_balance: number; total_realized_pnl: number; total_unrealized_pnl: number;
    }> | null) ?? [];

    return rows.map(row => ({
      tournament_id: row.tournament_id,
      tournament_name: row.tournament_name,
      tournament_type: row.tournament_type,
      final_rank: row.final_rank,
      return_pct: Number(row.initial_balance) > 0
        ? Math.round(((Number(row.total_realized_pnl) + Number(row.total_unrealized_pnl)) / Number(row.initial_balance)) * 10000) / 100
        : 0,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
    }));
  }

  /**
   * Daily rank snapshot cron — fires 23:50 UTC, before the 03:00 UTC club-ranking recompute.
   * Captures today's leaderboard rank for every active tournament entry so that the next
   * day's read-path can compute a rank_delta via LATERAL join.
   */
  @Cron('50 23 * * *')
  async handleDailyRankSnapshotCron(): Promise<void> {
    if (process.env.MARKETS_DISABLE_RANK_SNAPSHOTS === 'true') return;
    try {
      const { snapshots } = await this.snapshotDaily();
      this.logger.log(`Tournament rank snapshot cron: ${snapshots} rows`);
    } catch (err) {
      this.logger.error(`Tournament rank snapshot cron failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async snapshotDaily(): Promise<{ snapshots: number }> {
    await this.schema.ensureSchema();

    const tResult = await this.db.rawQuery(
      `SELECT id FROM prediction.tournaments
       WHERE status = 'active' AND starts_at <= now()`,
    );
    if (tResult.error) throw new Error(tResult.error.message);

    const tournaments = (tResult.data as Array<{ id: string }> | null) ?? [];
    let totalSnapshots = 0;

    for (const t of tournaments) {
      const leaderboard = await this.getLeaderboard(t.id);
      for (const entry of leaderboard) {
        const insertResult = await this.db.rawQuery(
          `INSERT INTO prediction.tournament_rank_snapshots
             (tournament_id, user_id, snapshot_date, rank)
           VALUES ($1, $2, CURRENT_DATE, $3)
           ON CONFLICT (tournament_id, user_id, snapshot_date)
             DO UPDATE SET rank = EXCLUDED.rank`,
          [t.id, entry.user_id, entry.rank],
        );
        if (insertResult.error) throw new Error(insertResult.error.message);
        totalSnapshots++;
      }
    }

    return { snapshots: totalSnapshots };
  }

  private async getBestTrade(tournamentId: string): Promise<{ user_id: string; display_name: string | null; symbol: string; pnl: number } | null> {
    const result = await this.db.rawQuery(
      `SELECT tp.user_id, u.display_name, tp.symbol, tp.realized_pnl
       FROM prediction.tournament_positions tp
       LEFT JOIN authz.users u ON u.id = tp.user_id
       WHERE tp.tournament_id = $1 AND tp.status = 'closed'
       ORDER BY tp.realized_pnl DESC
       LIMIT 1`,
      [tournamentId],
    );
    if (result.error) return null;
    const rows = (result.data as Array<{ user_id: string; display_name: string | null; symbol: string; realized_pnl: number }> | null) ?? [];
    if (rows.length === 0) return null;
    return { user_id: rows[0].user_id, display_name: rows[0].display_name, symbol: rows[0].symbol, pnl: Number(rows[0].realized_pnl) };
  }
}
