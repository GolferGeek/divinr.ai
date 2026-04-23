import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { TournamentSchemaService } from './tournament-schema.service';
import { SocialOptOutService } from '../users/social-opt-out.service';
import type {
  Tournament,
  TournamentEntry,
  TournamentPortfolio,
  TournamentPosition,
  TournamentTradeQueueEntry,
} from './tournament.types';

@Injectable()
export class TournamentPortfolioService {
  private readonly logger = new Logger(TournamentPortfolioService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(TournamentSchemaService) private readonly schema: TournamentSchemaService,
    @Inject(SocialOptOutService) private readonly optOuts: SocialOptOutService,
  ) {}

  async enterTournament(tournamentId: string, userId: string): Promise<TournamentEntry> {
    await this.schema.ensureSchema();

    // Fetch tournament to validate
    const tResult = await this.db.rawQuery(
      `SELECT * FROM prediction.tournaments WHERE id = $1`,
      [tournamentId],
    );
    if (tResult.error) throw new Error(tResult.error.message);
    const tournaments = (tResult.data as Tournament[] | null) ?? [];
    if (tournaments.length === 0) throw new Error('Tournament not found');

    const tournament = tournaments[0]!;
    if (tournament.status !== 'upcoming' && tournament.status !== 'active') {
      throw new Error('Tournament is not accepting entries');
    }

    // Create portfolio
    const portfolioId = randomUUID();
    const pResult = await this.db.rawQuery(
      `INSERT INTO prediction.tournament_portfolios
        (id, tournament_id, user_id, initial_balance, current_balance)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [portfolioId, tournamentId, userId, tournament.starting_balance, tournament.starting_balance],
    );
    if (pResult.error) throw new Error(pResult.error.message);

    // Create entry
    const entryId = randomUUID();
    const eResult = await this.db.rawQuery(
      `INSERT INTO prediction.tournament_entries
        (id, tournament_id, user_id, portfolio_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [entryId, tournamentId, userId, portfolioId],
    );
    if (eResult.error) {
      // Clean up portfolio on duplicate entry
      if (eResult.error.message.includes('unique') || eResult.error.message.includes('duplicate')) {
        await this.db.rawQuery(`DELETE FROM prediction.tournament_portfolios WHERE id = $1`, [portfolioId]);
        throw new Error('Already entered this tournament');
      }
      throw new Error(eResult.error.message);
    }

    return ((eResult.data as TournamentEntry[] | null) ?? [])[0]!;
  }

  async getPortfolio(tournamentId: string, userId: string): Promise<TournamentPortfolio | null> {
    await this.schema.ensureSchema();
    const result = await this.db.rawQuery(
      `SELECT * FROM prediction.tournament_portfolios WHERE tournament_id = $1 AND user_id = $2`,
      [tournamentId, userId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as TournamentPortfolio[] | null) ?? [];
    return rows[0] ?? null;
  }

  async getMyEntries(userId: string): Promise<Array<TournamentEntry & { tournament_name: string; tournament_status: string; tournament_type: string; tournament_starts_at: string }>> {
    await this.schema.ensureSchema();
    const result = await this.db.rawQuery(
      `SELECT te.*, t.name as tournament_name, t.status as tournament_status, t.tournament_type, t.starts_at as tournament_starts_at
       FROM prediction.tournament_entries te
       JOIN prediction.tournaments t ON t.id = te.tournament_id
       WHERE te.user_id = $1 AND t.status IN ('upcoming', 'active')
       ORDER BY t.starts_at DESC`,
      [userId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Array<TournamentEntry & { tournament_name: string; tournament_status: string; tournament_type: string; tournament_starts_at: string }> | null) ?? [];
  }

  async queueTrade(
    tournamentId: string,
    userId: string,
    input: { symbol: string; direction: 'long' | 'short'; quantity: number; predictionId?: string },
  ): Promise<TournamentTradeQueueEntry> {
    await this.schema.ensureSchema();

    // Validate tournament is active
    const tResult = await this.db.rawQuery(
      `SELECT * FROM prediction.tournaments WHERE id = $1`,
      [tournamentId],
    );
    if (tResult.error) throw new Error(tResult.error.message);
    const tournaments = (tResult.data as Tournament[] | null) ?? [];
    if (tournaments.length === 0) throw new Error('Tournament not found');

    const tournament = tournaments[0]!;
    if (tournament.status !== 'active') {
      throw new Error('Tournament is not active — trades can only be queued during active tournaments');
    }

    // Check instrument is allowed
    if (tournament.allowed_instruments) {
      const allowed = tournament.allowed_instruments as string[];
      if (!allowed.includes(input.symbol)) {
        throw new Error(`Instrument ${input.symbol} is not allowed in this tournament`);
      }
    }

    // Get portfolio
    const portfolio = await this.getPortfolio(tournamentId, userId);
    if (!portfolio) throw new Error('Not entered in this tournament');

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.tournament_trade_queue
        (id, tournament_id, portfolio_id, user_id, prediction_id, symbol, direction, quantity, status, queued_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', now())
       RETURNING *`,
      [id, tournamentId, portfolio.id, userId, input.predictionId ?? null, input.symbol, input.direction, input.quantity],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as TournamentTradeQueueEntry[] | null) ?? [])[0]!;
  }

  async listPositions(tournamentId: string, userId: string, status?: 'open' | 'closed'): Promise<TournamentPosition[]> {
    await this.schema.ensureSchema();

    let sql = `SELECT * FROM prediction.tournament_positions WHERE tournament_id = $1 AND user_id = $2`;
    const params: unknown[] = [tournamentId, userId];

    if (status) {
      sql += ` AND status = $3`;
      params.push(status);
    }
    sql += ` ORDER BY opened_at DESC`;

    const result = await this.db.rawQuery(sql, params);
    if (result.error) throw new Error(result.error.message);
    return (result.data as TournamentPosition[] | null) ?? [];
  }

  async closePosition(tournamentId: string, positionId: string, userId: string): Promise<TournamentPosition> {
    await this.schema.ensureSchema();

    // Fetch position
    const pResult = await this.db.rawQuery(
      `SELECT * FROM prediction.tournament_positions WHERE id = $1 AND tournament_id = $2 AND user_id = $3 AND status = 'open'`,
      [positionId, tournamentId, userId],
    );
    if (pResult.error) throw new Error(pResult.error.message);
    const positions = (pResult.data as TournamentPosition[] | null) ?? [];
    if (positions.length === 0) throw new Error('Open position not found');

    const position = positions[0]!;
    const exitPrice = position.current_price ?? position.entry_price;
    if (!exitPrice || !position.entry_price) throw new Error('No price available to close position');

    const realizedPnl = position.direction === 'long'
      ? (exitPrice - position.entry_price) * position.quantity
      : (position.entry_price - exitPrice) * position.quantity;

    // Update position
    const uResult = await this.db.rawQuery(
      `UPDATE prediction.tournament_positions
       SET status = 'closed', exit_price = $1, realized_pnl = $2, unrealized_pnl = 0, closed_at = now()
       WHERE id = $3
       RETURNING *`,
      [exitPrice, realizedPnl, positionId],
    );
    if (uResult.error) throw new Error(uResult.error.message);

    // Update portfolio balance
    await this.db.rawQuery(
      `UPDATE prediction.tournament_portfolios
       SET current_balance = current_balance + $1,
           total_realized_pnl = total_realized_pnl + $1
       WHERE id = $2`,
      [realizedPnl, position.portfolio_id],
    );

    return ((uResult.data as TournamentPosition[] | null) ?? [])[0]!;
  }

  async listEntries(
    tournamentId: string,
    viewerId: string,
  ): Promise<Array<TournamentEntry & { display_name?: string }>> {
    await this.schema.ensureSchema();
    const filter = this.optOuts.applyVisibilityFilter(
      `SELECT te.*, u.display_name
       FROM prediction.tournament_entries te
       LEFT JOIN authz.users u ON u.id = te.user_id
       WHERE te.tournament_id = $1
         AND coalesce(u.is_testing, false) = false`,
      [tournamentId],
      viewerId,
      'social_tournament_participation',
    );
    const result = await this.db.rawQuery(
      filter.sql + ` ORDER BY te.joined_at ASC`,
      filter.params,
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Array<TournamentEntry & { display_name?: string }> | null) ?? [];
  }

  // ─── EOD Settlement integration ─────────────────────────────

  async executeQueuedTournamentTrades(closingPrices: Map<string, number>): Promise<{ executed: number; errors: string[] }> {
    await this.schema.ensureSchema();

    // Fetch all queued trades for active tournaments
    const result = await this.db.rawQuery(
      `SELECT tq.*, t.status as tournament_status
       FROM prediction.tournament_trade_queue tq
       JOIN prediction.tournaments t ON t.id = tq.tournament_id
       WHERE tq.status = 'queued' AND t.status = 'active'`,
    );
    if (result.error) throw new Error(result.error.message);

    const trades = (result.data as Array<TournamentTradeQueueEntry & { tournament_status: string }> | null) ?? [];
    let executed = 0;
    const errors: string[] = [];

    for (const trade of trades) {
      try {
        // Look up closing price by symbol (match against instruments table)
        let entryPrice: number | undefined;
        const priceResult = await this.db.rawQuery(
          `SELECT id FROM prediction.instruments WHERE symbol = $1 AND is_active = true LIMIT 1`,
          [trade.symbol],
        );
        const instruments = (priceResult.data as Array<{ id: string }> | null) ?? [];
        if (instruments.length > 0) {
          entryPrice = closingPrices.get(instruments[0].id);
        }
        if (!entryPrice) {
          errors.push(`No closing price for ${trade.symbol}`);
          continue;
        }

        // Create position
        const posId = randomUUID();
        await this.db.rawQuery(
          `INSERT INTO prediction.tournament_positions
            (id, tournament_id, portfolio_id, user_id, symbol, direction, quantity, entry_price, current_price, status, opened_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', now())`,
          [posId, trade.tournament_id, trade.portfolio_id, trade.user_id, trade.symbol, trade.direction, trade.quantity, entryPrice, entryPrice],
        );

        // Mark trade as executed
        await this.db.rawQuery(
          `UPDATE prediction.tournament_trade_queue SET status = 'executed', execution_price = $1, executed_at = now() WHERE id = $2`,
          [entryPrice, trade.id],
        );

        executed++;
      } catch (err) {
        errors.push(`Trade ${trade.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(`Tournament EOD: executed ${executed} trades, ${errors.length} errors`);
    return { executed, errors };
  }

  async updateTournamentUnrealizedPnl(closingPrices: Map<string, number>): Promise<number> {
    await this.schema.ensureSchema();

    // Fetch all open tournament positions
    const result = await this.db.rawQuery(
      `SELECT tp.id, tp.portfolio_id, tp.symbol, tp.direction, tp.entry_price, tp.quantity
       FROM prediction.tournament_positions tp
       JOIN prediction.tournaments t ON t.id = tp.tournament_id
       WHERE tp.status = 'open' AND t.status = 'active'`,
    );
    if (result.error) throw new Error(result.error.message);

    const positions = (result.data as Array<{ id: string; portfolio_id: string; symbol: string; direction: string; entry_price: number; quantity: number }> | null) ?? [];
    let updated = 0;

    // Build symbol → instrument_id map
    const symbolMap = new Map<string, string>();
    for (const pos of positions) {
      if (!symbolMap.has(pos.symbol)) {
        const iResult = await this.db.rawQuery(
          `SELECT id FROM prediction.instruments WHERE symbol = $1 AND is_active = true LIMIT 1`,
          [pos.symbol],
        );
        const instruments = (iResult.data as Array<{ id: string }> | null) ?? [];
        if (instruments.length > 0) symbolMap.set(pos.symbol, instruments[0].id);
      }
    }

    // Group PnL by portfolio for batch update
    const portfolioPnl = new Map<string, number>();

    for (const pos of positions) {
      const instrumentId = symbolMap.get(pos.symbol);
      if (!instrumentId) continue;
      const currentPrice = closingPrices.get(instrumentId);
      if (!currentPrice) continue;

      const unrealizedPnl = pos.direction === 'long'
        ? (currentPrice - pos.entry_price) * pos.quantity
        : (pos.entry_price - currentPrice) * pos.quantity;

      await this.db.rawQuery(
        `UPDATE prediction.tournament_positions SET current_price = $1, unrealized_pnl = $2 WHERE id = $3`,
        [currentPrice, unrealizedPnl, pos.id],
      );

      portfolioPnl.set(pos.portfolio_id, (portfolioPnl.get(pos.portfolio_id) ?? 0) + unrealizedPnl);
      updated++;
    }

    // Update portfolio totals
    for (const [portfolioId, totalUnrealized] of portfolioPnl) {
      await this.db.rawQuery(
        `UPDATE prediction.tournament_portfolios SET total_unrealized_pnl = $1 WHERE id = $2`,
        [totalUnrealized, portfolioId],
      );
    }

    this.logger.log(`Tournament PnL: updated ${updated} positions`);
    return updated;
  }
}
