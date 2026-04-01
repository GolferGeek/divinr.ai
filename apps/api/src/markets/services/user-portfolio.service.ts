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
    private readonly schema: MarketsSchemaService,
    private readonly sizing: PositionSizingService,
  ) {}

  async ensurePortfolio(userId: string, organizationSlug: string, initialBalance = 1000000): Promise<UserPortfolio> {
    await this.schema.ensureSchema();

    const existing = await this.db.rawQuery(
      `select * from prediction.user_portfolios where user_id = $1 and organization_slug = $2`,
      [userId, organizationSlug],
    );
    const rows = (existing.data as UserPortfolio[] | null) ?? [];
    if (rows.length > 0) return rows[0];

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `insert into prediction.user_portfolios
        (id, user_id, organization_slug, initial_balance, current_balance)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, organization_slug) do update set updated_at = now()
       returning *`,
      [id, userId, organizationSlug, initialBalance, initialBalance],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as UserPortfolio[] | null) ?? [])[0]!;
  }

  async queueTrade(input: {
    userId: string;
    organizationSlug: string;
    predictionId: string;
    instrumentId: string;
    symbol: string;
    direction: 'long' | 'short';
    quantity: number;
  }): Promise<UserTradeQueueEntry> {
    const portfolio = await this.ensurePortfolio(input.userId, input.organizationSlug);
    const id = randomUUID();

    const result = await this.db.rawQuery(
      `insert into prediction.user_trade_queue
        (id, user_id, organization_slug, portfolio_id, prediction_id,
         instrument_id, symbol, direction, quantity, status, queued_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', now())
       returning *`,
      [
        id, input.userId, input.organizationSlug, portfolio.id,
        input.predictionId, input.instrumentId, input.symbol,
        input.direction, input.quantity,
      ],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as UserTradeQueueEntry[] | null) ?? [])[0]!;
  }

  async cancelTrade(tradeId: string, userId: string, organizationSlug: string): Promise<void> {
    const result = await this.db.rawQuery(
      `update prediction.user_trade_queue
       set status = 'cancelled', updated_at = now()
       where id = $1 and user_id = $2 and organization_slug = $3 and status = 'queued'`,
      [tradeId, userId, organizationSlug],
    );
    if (result.error) throw new Error(result.error.message);
  }

  async getQueuedTrades(userId: string, organizationSlug: string): Promise<UserTradeQueueEntry[]> {
    const result = await this.db.rawQuery(
      `select * from prediction.user_trade_queue
       where user_id = $1 and organization_slug = $2 and status = 'queued'
       order by queued_at desc`,
      [userId, organizationSlug],
    );
    return (result.data as UserTradeQueueEntry[] | null) ?? [];
  }

  async executeQueuedTrades(organizationSlug: string, closingPrices: Map<string, number>): Promise<{
    executed: number;
    errors: string[];
  }> {
    const queued = await this.db.rawQuery(
      `select * from prediction.user_trade_queue
       where organization_slug = $1 and status = 'queued'
       order by queued_at asc`,
      [organizationSlug],
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
            (id, portfolio_id, user_id, organization_slug, prediction_id,
             instrument_id, symbol, direction, quantity, entry_price, current_price,
             status, opened_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open', now())`,
          [
            posId, trade.portfolio_id, trade.user_id, trade.organization_slug,
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

  async getPortfolio(userId: string, organizationSlug: string): Promise<UserPortfolio | null> {
    const result = await this.db.rawQuery(
      `select * from prediction.user_portfolios where user_id = $1 and organization_slug = $2`,
      [userId, organizationSlug],
    );
    return ((result.data as UserPortfolio[] | null) ?? [])[0] ?? null;
  }

  async listPositions(userId: string, organizationSlug: string, status?: string): Promise<Record<string, unknown>[]> {
    let query = `select * from prediction.user_positions where user_id = $1 and organization_slug = $2`;
    const params: unknown[] = [userId, organizationSlug];
    if (status) { query += ` and status = $3`; params.push(status); }
    query += ' order by opened_at desc';
    const result = await this.db.rawQuery(query, params);
    return (result.data as Record<string, unknown>[] | null) ?? [];
  }
}
