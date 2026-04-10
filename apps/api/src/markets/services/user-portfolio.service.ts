import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { PositionSizingService } from './position-sizing.service';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import type { UserPortfolio, UserTradeQueueEntry } from '../markets.types';

/**
 * Manages user portfolios and trade queue.
 * Users queue trades during the day; trades execute at 5 PM ET settlement.
 */
@Injectable()
export class UserPortfolioService {
  private readonly logger = new Logger(UserPortfolioService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
    @Inject(PositionSizingService) private readonly sizing: PositionSizingService,
  ) {}

  async ensurePortfolio(userId: string, initialBalance = 1000000): Promise<UserPortfolio> {
    await this.schema.ensureSchema();

    const existing = await this.db.rawQuery(
      `select * from prediction.user_portfolios where user_id = $1`,
      [userId],
    );
    const rows = (existing.data as UserPortfolio[] | null) ?? [];
    if (rows.length > 0) return rows[0];

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `insert into prediction.user_portfolios
        (id, user_id, initial_balance, current_balance)
       values ($1, $2, $3, $4)
       on conflict (user_id) do update set updated_at = now()
       returning *`,
      [id, userId, initialBalance, initialBalance],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as UserPortfolio[] | null) ?? [])[0]!;
  }

  async queueTrade(input: {
    userId: string;
    predictionId: string;
    instrumentId: string;
    symbol: string;
    direction: 'long' | 'short';
    quantity: number;
  }): Promise<UserTradeQueueEntry> {
    const portfolio = await this.ensurePortfolio(input.userId);
    const id = randomUUID();

    const result = await this.db.rawQuery(
      `insert into prediction.user_trade_queue
        (id, user_id, portfolio_id, prediction_id,
         instrument_id, symbol, direction, quantity, status, queued_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', now())
       returning *`,
      [
        id, input.userId, portfolio.id,
        input.predictionId, input.instrumentId, input.symbol,
        input.direction, input.quantity,
      ],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as UserTradeQueueEntry[] | null) ?? [])[0]!;
  }

  async cancelTrade(tradeId: string, userId: string): Promise<void> {
    const result = await this.db.rawQuery(
      `update prediction.user_trade_queue
       set status = 'cancelled', updated_at = now()
       where id = $1 and user_id = $2 and status = 'queued'`,
      [tradeId, userId],
    );
    if (result.error) throw new Error(result.error.message);
  }

  async getQueuedTrades(userId: string): Promise<UserTradeQueueEntry[]> {
    const result = await this.db.rawQuery(
      `select * from prediction.user_trade_queue
       where user_id = $1 and status = 'queued'
       order by queued_at desc`,
      [userId],
    );
    return (result.data as UserTradeQueueEntry[] | null) ?? [];
  }

  async executeQueuedTrades(closingPrices: Map<string, number>): Promise<{
    executed: number;
    errors: string[];
  }> {
    const queued = await this.db.rawQuery(
      `select * from prediction.user_trade_queue
       where status = 'queued'
       order by queued_at asc`,
    );
    const trades = (queued.data as UserTradeQueueEntry[] | null) ?? [];
    let executed = 0;
    const errors: string[] = [];

    for (const trade of trades) {
      try {
        const closingPrice = closingPrices.get(trade.instrument_id);
        if (!closingPrice) {
          errors.push(`No closing price for ${trade.symbol}`);
          continue;
        }

        // Create user position
        const posId = randomUUID();
        await this.db.rawQuery(
          `insert into prediction.user_positions
            (id, portfolio_id, user_id, prediction_id,
             instrument_id, symbol, direction, quantity, entry_price, current_price,
             status, opened_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', now())`,
          [
            posId, trade.portfolio_id, trade.user_id,
            trade.prediction_id, trade.instrument_id, trade.symbol,
            trade.direction, trade.quantity, closingPrice, closingPrice,
          ],
        );

        // Mark trade as executed
        await this.db.rawQuery(
          `update prediction.user_trade_queue
           set status = 'executed', executed_position_id = $1,
               execution_price = $2, executed_at = now(), updated_at = now()
           where id = $3`,
          [posId, closingPrice, trade.id],
        );

        executed++;
      } catch (err) {
        errors.push(`Trade ${trade.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { executed, errors };
  }

  async getPortfolio(userId: string): Promise<UserPortfolio | null> {
    const result = await this.db.rawQuery(
      `select * from prediction.user_portfolios where user_id = $1`,
      [userId],
    );
    return ((result.data as UserPortfolio[] | null) ?? [])[0] ?? null;
  }

  async isDisclaimerAcknowledged(userId: string): Promise<boolean> {
    const result = await this.db.rawQuery(
      `select disclaimer_acknowledged_at from prediction.user_portfolios
        where user_id = $1 limit 1`,
      [userId],
    );
    const rows = (result.data as Array<{ disclaimer_acknowledged_at: string | null }> | null) ?? [];
    return rows.length > 0 && rows[0].disclaimer_acknowledged_at !== null;
  }

  /**
   * Open a user position immediately at the current cached instrument price.
   * Bypasses the 5pm queue. Idempotent within the trading day on
   * (user_id, prediction_id, instrument_id, status='open', opened_at::date).
   */
  async executeImmediate(input: {
    userId: string;
    predictionId: string;
    instrumentId: string;
    direction: 'long' | 'short';
    quantity: number;
  }): Promise<Record<string, unknown>> {
    if (!input.quantity || input.quantity <= 0) {
      throw new Error('quantity must be > 0');
    }

    const portfolio = await this.ensurePortfolio(input.userId);

    // Resolve symbol + cached price.
    const instrumentResult = await this.db.rawQuery(
      `select symbol, current_state from prediction.instruments where id = $1 limit 1`,
      [input.instrumentId],
    );
    const instrumentRows = (instrumentResult.data as Array<{
      symbol: string;
      current_state: Record<string, unknown> | null;
    }> | null) ?? [];
    if (instrumentRows.length === 0) throw new Error(`Instrument ${input.instrumentId} not found`);
    const symbol = instrumentRows[0].symbol;
    const cs = instrumentRows[0].current_state ?? {};
    const entryPrice = Number((cs as any).price ?? (cs as any).last_price ?? 0);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      throw new Error(`No cached price for instrument ${input.instrumentId}`);
    }

    // Idempotency: same user/prediction/instrument open today.
    const existing = await this.db.rawQuery(
      `select * from prediction.user_positions
        where user_id = $1 and prediction_id = $2 and instrument_id = $3
          and status = 'open' and opened_at::date = current_date
        limit 1`,
      [input.userId, input.predictionId, input.instrumentId],
    );
    const existingRows = (existing.data as Record<string, unknown>[] | null) ?? [];
    if (existingRows.length > 0) return existingRows[0];

    const id = randomUUID();
    const cost = input.quantity * entryPrice;
    const insertResult = await this.db.rawQuery(
      `insert into prediction.user_positions
         (id, portfolio_id, user_id, prediction_id,
          instrument_id, symbol, direction, quantity, entry_price, current_price,
          status, opened_at, trigger_reason, trigger_prediction_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, 'open', now(), 'manual', $4)
       returning *`,
      [
        id, portfolio.id, input.userId, input.predictionId,
        input.instrumentId, symbol, input.direction, input.quantity, entryPrice,
      ],
    );
    if (insertResult.error) throw new Error(insertResult.error.message);

    await this.db.rawQuery(
      `update prediction.user_portfolios
         set current_balance = current_balance - $1, updated_at = now()
       where id = $2`,
      [cost, portfolio.id],
    );

    this.logger.log(
      `User immediate trade: user=${input.userId} symbol=${symbol} qty=${input.quantity} entry=${entryPrice} dir=${input.direction}`,
    );
    return ((insertResult.data as Record<string, unknown>[] | null) ?? [])[0]!;
  }

  /**
   * Close a user position at the current cached price.
   */
  async closePosition(input: { userId: string; positionId: string }): Promise<Record<string, unknown>> {
    const posResult = await this.db.rawQuery(
      `select * from prediction.user_positions where id = $1 limit 1`,
      [input.positionId],
    );
    const posRows = (posResult.data as Record<string, unknown>[] | null) ?? [];
    if (posRows.length === 0) throw new Error(`Position ${input.positionId} not found`);
    const pos = posRows[0];
    if (pos.user_id !== input.userId) {
      throw new Error('Position does not belong to this user');
    }
    if (pos.status !== 'open') {
      throw new Error(`Position ${input.positionId} is not open (status=${pos.status})`);
    }

    const instrumentResult = await this.db.rawQuery(
      `select current_state from prediction.instruments where id = $1 limit 1`,
      [pos.instrument_id],
    );
    const iRows = (instrumentResult.data as Array<{ current_state: Record<string, unknown> | null }> | null) ?? [];
    const cs = (iRows[0]?.current_state ?? {}) as any;
    const exitPrice = Number(cs.price ?? cs.last_price ?? 0);
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      throw new Error(`No cached price for instrument ${pos.instrument_id}`);
    }

    const qty = Number(pos.quantity);
    const entry = Number(pos.entry_price);
    const realizedPnl = pos.direction === 'short'
      ? (entry - exitPrice) * qty
      : (exitPrice - entry) * qty;
    const credit = qty * entry + realizedPnl; // mirrors the open-time debit + P&L

    const updateResult = await this.db.rawQuery(
      `update prediction.user_positions
         set status = 'closed', exit_price = $1, closed_at = now(),
             realized_pnl = $2, current_price = $1, updated_at = now()
       where id = $3
       returning *`,
      [exitPrice, realizedPnl, input.positionId],
    );
    if (updateResult.error) throw new Error(updateResult.error.message);

    await this.db.rawQuery(
      `update prediction.user_portfolios
         set current_balance = current_balance + $1, updated_at = now()
       where id = $2`,
      [credit, pos.portfolio_id],
    );

    this.logger.log(
      `User close: user=${input.userId} position=${input.positionId} exit=${exitPrice} pnl=${realizedPnl}`,
    );
    return ((updateResult.data as Record<string, unknown>[] | null) ?? [])[0]!;
  }

  async listPositions(userId: string, status?: string): Promise<Record<string, unknown>[]> {
    let query = `select * from prediction.user_positions where user_id = $1`;
    const params: unknown[] = [userId];
    if (status) { query += ` and status = $2`; params.push(status); }
    query += ' order by opened_at desc';
    const result = await this.db.rawQuery(query, params);
    return (result.data as Record<string, unknown>[] | null) ?? [];
  }
}
