import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { PositionSizingService } from './position-sizing.service';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import { MarketsBarsService } from './markets-bars.service';
import { MarketHoursService } from './market-hours.service';
import type { IntradayBar } from '../adapters/twelve-data.adapter';
import type { UserPortfolio, UserTradeQueueEntry } from '../markets.types';

const ET_TZ = 'America/New_York';
const QUOTE_FRESHNESS_MS = 15 * 60 * 1000;

interface InstrumentQuote {
  symbol: string;
  currentPrice: number;
}

interface OppositeCloseResult {
  remainingQuantity: number;
  closedRows: Record<string, unknown>[];
  portfolioCashDelta: number;
}

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
    @Inject(MarketsBarsService) private readonly marketsBars: MarketsBarsService,
    @Inject(MarketHoursService) private readonly marketHours: MarketHoursService,
  ) {}

  async ensurePortfolio(userId: string, initialBalance = 1000000): Promise<UserPortfolio> {

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

        const closeResult = await this.closeOppositeUserPositions({
          userId: trade.user_id,
          portfolioId: trade.portfolio_id,
          predictionId: trade.prediction_id,
          instrumentId: trade.instrument_id,
          direction: trade.direction,
          quantity: trade.quantity,
          executionPrice: closingPrice,
        });

        let posId = closeResult.closedRows.at(-1)?.id as string | undefined;
        if (closeResult.remainingQuantity > 0) {
          // Create user position for the portion not consumed by opposite lots.
          posId = randomUUID();
          const insertResult = await this.db.rawQuery(
            `insert into prediction.user_positions
              (id, portfolio_id, user_id, prediction_id,
               instrument_id, symbol, direction, quantity, entry_price, current_price,
               status, opened_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', now())`,
            [
              posId, trade.portfolio_id, trade.user_id,
              trade.prediction_id, trade.instrument_id, trade.symbol,
              trade.direction, closeResult.remainingQuantity, closingPrice, closingPrice,
            ],
          );
          if (insertResult.error) throw new Error(insertResult.error.message);

          const cost = closeResult.remainingQuantity * closingPrice;
          const balanceResult = await this.db.rawQuery(
            `update prediction.user_portfolios
               set current_balance = current_balance - $1,
                   updated_at = now()
             where id = $2`,
            [cost, trade.portfolio_id],
          );
          if (balanceResult.error) throw new Error(balanceResult.error.message);
        }

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

    const quote = await this.loadInstrumentQuote(input.instrumentId);
    const symbol = quote.symbol;
    const entryPrice = quote.currentPrice;
    if (entryPrice <= 0) {
      throw new Error(`No cached price for instrument ${input.instrumentId}`);
    }

    const closeResult = await this.closeOppositeUserPositions({
      userId: input.userId,
      portfolioId: portfolio.id,
      predictionId: input.predictionId,
      instrumentId: input.instrumentId,
      direction: input.direction,
      quantity: input.quantity,
      executionPrice: entryPrice,
    });
    if (closeResult.remainingQuantity <= 0) {
      return closeResult.closedRows.at(-1) ?? {};
    }

    // Idempotency: same user/prediction/instrument/direction open today.
    const existing = await this.db.rawQuery(
      `select * from prediction.user_positions
        where user_id = $1 and prediction_id = $2 and instrument_id = $3
          and direction = $4 and status = 'open' and opened_at::date = current_date
        limit 1`,
      [input.userId, input.predictionId, input.instrumentId, input.direction],
    );
    const existingRows = (existing.data as Record<string, unknown>[] | null) ?? [];
    if (existingRows.length > 0) return existingRows[0];

    const id = randomUUID();
    const cost = closeResult.remainingQuantity * entryPrice;
    const insertResult = await this.db.rawQuery(
      `insert into prediction.user_positions
         (id, portfolio_id, user_id, prediction_id,
          instrument_id, symbol, direction, quantity, entry_price, current_price,
          status, opened_at, trigger_reason, trigger_prediction_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, 'open', now(), 'manual', $4)
       returning *`,
      [
        id, portfolio.id, input.userId, input.predictionId,
        input.instrumentId, symbol, input.direction, closeResult.remainingQuantity, entryPrice,
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
      `User immediate trade: user=${input.userId} symbol=${symbol} qty=${closeResult.remainingQuantity} entry=${entryPrice} dir=${input.direction}`,
    );
    return ((insertResult.data as Record<string, unknown>[] | null) ?? [])[0]!;
  }

  async getTradeDestinations(input: {
    userId: string;
    instrumentId: string;
    symbol: string;
  }): Promise<{ currentPrice: number; destinations: Array<Record<string, unknown>> }> {
    const quote = await this.loadInstrumentQuote(input.instrumentId, input.symbol);
    const currentPrice = quote.currentPrice;

    const portfolio = await this.ensurePortfolio(input.userId);
    const userHolding = await this.getUserHolding(input.userId, input.instrumentId);
    const destinations: Array<Record<string, unknown>> = [{
      destinationType: 'user',
      id: portfolio.id,
      name: 'My Portfolio',
      currentBalance: Number(portfolio.current_balance ?? 0),
      longQty: userHolding.longQty,
      shortQty: userHolding.shortQty,
      netQty: userHolding.netQty,
      allowed: true,
    }];

    const entriesResult = await this.db.rawQuery(
      `select t.id as tournament_id,
              t.name,
              t.allowed_instruments,
              tp.id as portfolio_id,
              tp.current_balance
       from prediction.tournament_entries te
       join prediction.tournaments t on t.id = te.tournament_id
       join prediction.tournament_portfolios tp on tp.id = te.portfolio_id
       where te.user_id = $1 and t.status = 'active'
       order by t.starts_at desc nulls last, t.name asc`,
      [input.userId],
    );
    if (entriesResult.error) throw new Error(entriesResult.error.message);

    const entries = (entriesResult.data as Array<{
      tournament_id: string;
      name: string;
      portfolio_id: string;
      current_balance: number | string;
      allowed_instruments: unknown;
    }> | null) ?? [];

    for (const entry of entries) {
      const allowed = this.parseAllowedInstruments(entry.allowed_instruments);
      const allowedForSymbol = !allowed || allowed.includes(input.symbol);
      const holding = await this.getTournamentHolding(input.userId, entry.portfolio_id, input.symbol);
      destinations.push({
        destinationType: 'tournament',
        id: entry.portfolio_id,
        tournamentId: entry.tournament_id,
        name: entry.name,
        currentBalance: Number(entry.current_balance ?? 0),
        longQty: holding.longQty,
        shortQty: holding.shortQty,
        netQty: holding.netQty,
        allowed: allowedForSymbol,
      });
    }

    return {
      currentPrice,
      destinations,
    };
  }

  async executeTradeDestinations(input: {
    userId: string;
    predictionId: string;
    instrumentId: string;
    direction: 'long' | 'short';
    destinations: Array<{
      destinationType: 'user' | 'tournament';
      portfolioId?: string;
      tournamentId?: string;
      quantity: number;
    }>;
  }): Promise<{ results: Array<Record<string, unknown>> }> {
    if (!Array.isArray(input.destinations) || input.destinations.length === 0) {
      throw new Error('At least one destination is required');
    }

    const quote = await this.loadInstrumentQuote(input.instrumentId);
    const symbol = quote.symbol;
    const entryPrice = quote.currentPrice;
    if (entryPrice <= 0) {
      throw new Error(`No cached price for instrument ${input.instrumentId}`);
    }

    const results: Array<Record<string, unknown>> = [];
    for (const destination of input.destinations) {
      try {
        const quantity = Number(destination.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be > 0');
        if (destination.destinationType === 'user') {
          const row = await this.openUserDestination({
            userId: input.userId,
            predictionId: input.predictionId,
            instrumentId: input.instrumentId,
            symbol,
            direction: input.direction,
            quantity,
            entryPrice,
          });
          results.push({ destinationType: 'user', status: 'filled', position: row });
        } else {
          if (!destination.portfolioId || !destination.tournamentId) {
            throw new Error('Tournament destination is missing portfolio context');
          }
          const row = await this.openTournamentDestination({
            userId: input.userId,
            predictionId: input.predictionId,
            symbol,
            direction: input.direction,
            quantity,
            entryPrice,
            portfolioId: destination.portfolioId,
            tournamentId: destination.tournamentId,
          });
          results.push({
            destinationType: 'tournament',
            portfolioId: destination.portfolioId,
            tournamentId: destination.tournamentId,
            status: 'filled',
            position: row,
          });
        }
      } catch (err) {
        results.push({
          destinationType: destination.destinationType,
          portfolioId: destination.portfolioId,
          tournamentId: destination.tournamentId,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { results };
  }

  private async openUserDestination(input: {
    userId: string;
    predictionId: string;
    instrumentId: string;
    symbol: string;
    direction: 'long' | 'short';
    quantity: number;
    entryPrice: number;
  }): Promise<Record<string, unknown>> {
    const portfolio = await this.ensurePortfolio(input.userId);
    const closeResult = await this.closeOppositeUserPositions({
      userId: input.userId,
      portfolioId: portfolio.id,
      predictionId: input.predictionId,
      instrumentId: input.instrumentId,
      direction: input.direction,
      quantity: input.quantity,
      executionPrice: input.entryPrice,
    });
    if (closeResult.remainingQuantity <= 0) {
      return closeResult.closedRows.at(-1) ?? {};
    }

    const cost = closeResult.remainingQuantity * input.entryPrice;
    const availableCash = Number(portfolio.current_balance ?? 0) + closeResult.portfolioCashDelta;
    if (availableCash < cost) {
      throw new Error(`Insufficient cash in My Portfolio`);
    }

    const id = randomUUID();
    const insertResult = await this.db.rawQuery(
      `insert into prediction.user_positions
         (id, portfolio_id, user_id, prediction_id,
          instrument_id, symbol, direction, quantity, entry_price, current_price,
          status, opened_at, trigger_reason, trigger_prediction_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, 'open', now(), 'manual', $4)
       returning *`,
      [
        id, portfolio.id, input.userId, input.predictionId,
        input.instrumentId, input.symbol, input.direction, closeResult.remainingQuantity, input.entryPrice,
      ],
    );
    if (insertResult.error) throw new Error(insertResult.error.message);

    await this.db.rawQuery(
      `update prediction.user_portfolios
         set current_balance = current_balance - $1, updated_at = now()
       where id = $2`,
      [cost, portfolio.id],
    );
    return ((insertResult.data as Record<string, unknown>[] | null) ?? [])[0]!;
  }

  private async closeOppositeUserPositions(input: {
    userId: string;
    portfolioId: string;
    predictionId: string | null;
    instrumentId: string;
    direction: 'long' | 'short';
    quantity: number;
    executionPrice: number;
  }): Promise<OppositeCloseResult> {
    const oppositeDirection = input.direction === 'long' ? 'short' : 'long';
    const openResult = await this.db.rawQuery(
      `select *
       from prediction.user_positions
       where user_id = $1
         and portfolio_id = $2
         and instrument_id = $3
         and direction = $4
         and status = 'open'
       order by opened_at asc`,
      [input.userId, input.portfolioId, input.instrumentId, oppositeDirection],
    );
    if (openResult.error) throw new Error(openResult.error.message);

    const openRows = (openResult.data as Record<string, unknown>[] | null) ?? [];
    const closedRows: Record<string, unknown>[] = [];
    let remainingQuantity = Number(input.quantity);
    let portfolioCashDelta = 0;

    for (const pos of openRows) {
      if (remainingQuantity <= 0) break;
      const positionQuantity = Number(pos.quantity);
      const entryPrice = Number(pos.entry_price);
      if (positionQuantity <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) continue;

      const closeQuantity = Math.min(remainingQuantity, positionQuantity);
      const realizedPnl = pos.direction === 'short'
        ? (entryPrice - input.executionPrice) * closeQuantity
        : (input.executionPrice - entryPrice) * closeQuantity;
      const closedUnrealizedPnl = Number(pos.unrealized_pnl ?? 0) * (closeQuantity / positionQuantity);
      const closeCredit = closeQuantity * entryPrice + realizedPnl;
      portfolioCashDelta += closeCredit;

      if (closeQuantity === positionQuantity) {
        const updateResult = await this.db.rawQuery(
          `update prediction.user_positions
             set status = 'closed',
                 exit_price = $1,
                 realized_pnl = $2,
                 unrealized_pnl = 0,
                 current_price = $1,
                 closed_at = now(),
                 updated_at = now()
           where id = $3
           returning *`,
          [input.executionPrice, realizedPnl, pos.id],
        );
        if (updateResult.error) throw new Error(updateResult.error.message);
        const rows = (updateResult.data as Record<string, unknown>[] | null) ?? [];
        if (rows.length > 0) closedRows.push(rows[0]);
      } else {
        const remainingOpenQuantity = positionQuantity - closeQuantity;
        const remainingUnrealizedPnl = Number(pos.unrealized_pnl ?? 0) - closedUnrealizedPnl;
        const updateResult = await this.db.rawQuery(
          `update prediction.user_positions
             set quantity = $1,
                 current_price = $2,
                 unrealized_pnl = $3,
                 updated_at = now()
           where id = $4
           returning *`,
          [remainingOpenQuantity, input.executionPrice, remainingUnrealizedPnl, pos.id],
        );
        if (updateResult.error) throw new Error(updateResult.error.message);
        closedRows.push({
          ...(pos as Record<string, unknown>),
          quantity: closeQuantity,
          exit_price: input.executionPrice,
          realized_pnl: realizedPnl,
          status: 'closed',
        });
      }

      const portfolioResult = await this.db.rawQuery(
        `update prediction.user_portfolios
           set current_balance = current_balance + $1,
               total_realized_pnl = total_realized_pnl + $2,
               total_unrealized_pnl = total_unrealized_pnl - $3,
               updated_at = now()
         where id = $4`,
        [closeCredit, realizedPnl, closedUnrealizedPnl, input.portfolioId],
      );
      if (portfolioResult.error) throw new Error(portfolioResult.error.message);

      remainingQuantity -= closeQuantity;
    }

    return { remainingQuantity, closedRows, portfolioCashDelta };
  }

  private async loadInstrumentQuote(instrumentId: string, symbolHint?: string): Promise<InstrumentQuote> {
    const byIdResult = await this.db.rawQuery(
      `select id, symbol, current_state
         from prediction.instruments
        where id = $1
        limit 1`,
      [instrumentId],
    );
    if (byIdResult.error) throw new Error(byIdResult.error.message);
    const byIdRows = (byIdResult.data as Array<{
      id: string;
      symbol: string;
      current_state: Record<string, unknown> | null;
    }> | null) ?? [];
    if (byIdRows.length === 0) throw new Error(`Instrument ${instrumentId} not found`);

    const symbol = byIdRows[0].symbol || symbolHint || '';
    const exactPrice = this.extractCurrentPrice(byIdRows[0].current_state);
    if (exactPrice > 0 && this.isQuoteFresh(byIdRows[0].current_state)) {
      return { symbol, currentPrice: exactPrice };
    }
    const intradayPrice = await this.loadLatestIntradayPrice(symbol);
    if (intradayPrice > 0) return { symbol, currentPrice: intradayPrice };

    const fallbackSymbol = symbolHint || symbol;
    if (!fallbackSymbol) return { symbol, currentPrice: exactPrice };

    const fallbackResult = await this.db.rawQuery(
      `select id, symbol, current_state
         from prediction.instruments
        where upper(symbol) = upper($1)
        order by created_at desc`,
      [fallbackSymbol],
    );
    if (fallbackResult.error) throw new Error(fallbackResult.error.message);
    const fallbackRows = (fallbackResult.data as Array<{
      id: string;
      symbol: string;
      current_state: Record<string, unknown> | null;
    }> | null) ?? [];
    for (const row of fallbackRows) {
      const price = this.extractCurrentPrice(row.current_state);
      if (price > 0 && this.isQuoteFresh(row.current_state)) {
        return { symbol: row.symbol || symbol, currentPrice: price };
      }
      const fallbackIntradayPrice = await this.loadLatestIntradayPrice(row.symbol || symbol);
      if (fallbackIntradayPrice > 0) {
        return { symbol: row.symbol || symbol, currentPrice: fallbackIntradayPrice };
      }
      if (price > 0) return { symbol: row.symbol || symbol, currentPrice: price };
    }

    return { symbol, currentPrice: exactPrice };
  }

  private extractCurrentPrice(currentState: Record<string, unknown> | null): number {
    const price = Number(currentState?.price ?? currentState?.last_price ?? 0);
    return Number.isFinite(price) && price > 0 ? price : 0;
  }

  private isQuoteFresh(currentState: Record<string, unknown> | null): boolean {
    const raw = currentState?.price_updated_at ?? currentState?.updated_at;
    if (typeof raw !== 'string' || raw.length === 0) return false;
    const updatedAt = Date.parse(raw);
    return Number.isFinite(updatedAt) && Date.now() - updatedAt <= QUOTE_FRESHNESS_MS;
  }

  private async loadLatestIntradayPrice(symbol: string): Promise<number> {
    if (!symbol) return 0;
    try {
      const barsMap = await this.marketsBars.getIntradayBarsForSymbols([symbol]);
      const bars = barsMap.get(symbol.toUpperCase()) ?? barsMap.get(symbol) ?? [];
      const latest = bars.at(-1);
      const price = Number(latest?.c ?? 0);
      return Number.isFinite(price) && price > 0 ? price : 0;
    } catch (err) {
      this.logger.warn(
        `loadLatestIntradayPrice failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  private async openTournamentDestination(input: {
    userId: string;
    predictionId: string;
    symbol: string;
    direction: 'long' | 'short';
    quantity: number;
    entryPrice: number;
    portfolioId: string;
    tournamentId: string;
  }): Promise<Record<string, unknown>> {
    const tournamentResult = await this.db.rawQuery(
      `select t.allowed_instruments, tp.current_balance
       from prediction.tournament_portfolios tp
       join prediction.tournaments t on t.id = tp.tournament_id
       where tp.id = $1 and tp.user_id = $2 and t.id = $3 and t.status = 'active'
       limit 1`,
      [input.portfolioId, input.userId, input.tournamentId],
    );
    if (tournamentResult.error) throw new Error(tournamentResult.error.message);
    const rows = (tournamentResult.data as Array<{
      allowed_instruments: unknown;
      current_balance: number | string;
    }> | null) ?? [];
    if (rows.length === 0) throw new Error('Tournament portfolio is not active');
    const allowed = this.parseAllowedInstruments(rows[0].allowed_instruments);
    if (allowed && !allowed.includes(input.symbol)) {
      throw new Error(`${input.symbol} is not allowed in this tournament`);
    }
    const cost = input.quantity * input.entryPrice;
    if (Number(rows[0].current_balance ?? 0) < cost) {
      throw new Error('Insufficient cash in tournament');
    }

    const insertResult = await this.db.rawQuery(
      `insert into prediction.tournament_positions
        (id, tournament_id, portfolio_id, user_id, symbol, direction,
         quantity, entry_price, current_price, status, opened_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8, 'open', now())
       returning *`,
      [
        randomUUID(),
        input.tournamentId,
        input.portfolioId,
        input.userId,
        input.symbol,
        input.direction,
        input.quantity,
        input.entryPrice,
      ],
    );
    if (insertResult.error) throw new Error(insertResult.error.message);

    await this.db.rawQuery(
      `update prediction.tournament_portfolios
         set current_balance = current_balance - $1
       where id = $2`,
      [cost, input.portfolioId],
    );
    return ((insertResult.data as Record<string, unknown>[] | null) ?? [])[0]!;
  }

  private async getUserHolding(
    userId: string,
    instrumentId: string,
  ): Promise<{ longQty: number; shortQty: number; netQty: number }> {
    const result = await this.db.rawQuery(
      `select
         coalesce(sum(case when direction = 'long' then quantity else 0 end), 0) as long_qty,
         coalesce(sum(case when direction = 'short' then quantity else 0 end), 0) as short_qty
       from prediction.user_positions
       where user_id = $1 and instrument_id = $2 and status = 'open'`,
      [userId, instrumentId],
    );
    const row = ((result.data as Array<{ long_qty: string; short_qty: string }> | null) ?? [])[0];
    const longQty = Number(row?.long_qty ?? 0);
    const shortQty = Number(row?.short_qty ?? 0);
    return { longQty, shortQty, netQty: longQty - shortQty };
  }

  private async getTournamentHolding(
    userId: string,
    portfolioId: string,
    symbol: string,
  ): Promise<{ longQty: number; shortQty: number; netQty: number }> {
    const result = await this.db.rawQuery(
      `select
         coalesce(sum(case when direction = 'long' then quantity else 0 end), 0) as long_qty,
         coalesce(sum(case when direction = 'short' then quantity else 0 end), 0) as short_qty
       from prediction.tournament_positions
       where user_id = $1 and portfolio_id = $2 and symbol = $3 and status = 'open'`,
      [userId, portfolioId, symbol],
    );
    const row = ((result.data as Array<{ long_qty: string; short_qty: string }> | null) ?? [])[0];
    const longQty = Number(row?.long_qty ?? 0);
    const shortQty = Number(row?.short_qty ?? 0);
    return { longQty, shortQty, netQty: longQty - shortQty };
  }

  private parseAllowedInstruments(value: unknown): string[] | null {
    if (value == null) return null;
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
      } catch {
        return null;
      }
    }
    return null;
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
    const closedUnrealizedPnl = Number(pos.unrealized_pnl ?? 0);

    const updateResult = await this.db.rawQuery(
      `update prediction.user_positions
         set status = 'closed', exit_price = $1, closed_at = now(),
             realized_pnl = $2, unrealized_pnl = 0,
             current_price = $1, updated_at = now()
       where id = $3
       returning *`,
      [exitPrice, realizedPnl, input.positionId],
    );
    if (updateResult.error) throw new Error(updateResult.error.message);

    await this.db.rawQuery(
      `update prediction.user_portfolios
         set current_balance = current_balance + $1,
             total_realized_pnl = total_realized_pnl + $2,
             total_unrealized_pnl = total_unrealized_pnl - $3,
             updated_at = now()
       where id = $4`,
      [credit, realizedPnl, closedUnrealizedPnl, pos.portfolio_id],
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
    const rows = (result.data as Record<string, unknown>[] | null) ?? [];
    if (rows.length === 0) return rows;
    return this.enrichWithIntraday(rows);
  }

  private async enrichWithIntraday(
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const openSymbols = new Set<string>();
    for (const row of rows) {
      if (row.status === 'open' && typeof row.symbol === 'string' && row.symbol.length > 0) {
        openSymbols.add(row.symbol);
      }
    }
    if (openSymbols.size === 0) {
      return rows.map(r => ({ ...r, today_open: null, intraday_pct: null }));
    }

    const now = new Date();
    const marketOpen = this.marketHours.isUsEquityMarketOpen(now);
    let barsMap = new Map<string, IntradayBar[]>();
    try {
      barsMap = await this.marketsBars.getIntradayBarsForSymbols(Array.from(openSymbols));
    } catch (err) {
      this.logger.warn(
        `enrichWithIntraday bar fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const todayEt = this.etDateKey(now);

    return rows.map(r => {
      if (r.status !== 'open' || !marketOpen) {
        return { ...r, today_open: null, intraday_pct: null };
      }
      const bars = barsMap.get(r.symbol as string) ?? [];
      const todayOpen = this.deriveTodayOpen(bars, todayEt);
      const rawPrice = r.current_price;
      const currentPrice = rawPrice == null ? NaN : Number(rawPrice);
      if (todayOpen == null || todayOpen <= 0 || !Number.isFinite(currentPrice)) {
        return { ...r, today_open: todayOpen, intraday_pct: null };
      }
      const intradayPct = (currentPrice - todayOpen) / todayOpen;
      return { ...r, today_open: todayOpen, intraday_pct: intradayPct };
    });
  }

  private deriveTodayOpen(bars: IntradayBar[] | undefined, todayEt: string): number | null {
    if (!bars || bars.length === 0) return null;
    for (const b of bars) {
      if (!b || typeof b.t !== 'string') continue;
      if (this.etDateKeyForTimestamp(b.t) === todayEt) {
        return Number.isFinite(b.o) ? b.o : null;
      }
    }
    return null;
  }

  private etDateKey(d: Date): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ET_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const by = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    return `${by('year')}-${by('month')}-${by('day')}`;
  }

  private etDateKeyForTimestamp(ts: string): string {
    // Twelve Data timestamps are "YYYY-MM-DD HH:MM:SS" in the exchange timezone
    // (US equities → ET). Parse the date portion directly rather than round-trip
    // through Date — which would reinterpret the naive string as UTC.
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ts);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    // Fallback: parse as UTC Date and derive ET date — covers ISO timestamps.
    const parsed = new Date(ts);
    if (Number.isNaN(parsed.getTime())) return '';
    return this.etDateKey(parsed);
  }
}
