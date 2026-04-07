import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { AutotradeOpenHelper } from './autotrade-open-helper.service';
import { AnalystPortfolioService } from './analyst-portfolio.service';

/**
 * DayTraderRunnerService — Phase 7 of portfolio-foundation-resume.
 *
 * Drives the three day-trader portfolios (momentum-breakout,
 * mean-reversion, gap-and-go). Each portfolio has a strategy hook
 * that returns zero or more open/close intents per tick. Opens route
 * through AutotradeOpenHelper with triggerReason='strategy' and
 * predictionId=null. Closes route through AnalystPortfolioService.
 *
 * Strategy *content* is intentionally stub-only at this phase — the
 * runner is wiring, not signal logic. The day-traders-and-leaderboard
 * effort fills in the actual breakout / mean-reversion / gap rules.
 */

export interface StrategyOpenIntent {
  instrumentId: string;
  direction: 'long' | 'short';
  quantity: number;
  conviction: number;
}

export interface StrategyCloseIntent {
  positionId: string;
}

export interface StrategyIntents {
  opens: StrategyOpenIntent[];
  closes: StrategyCloseIntent[];
}

export interface DayTraderStrategy {
  generateIntents(portfolio: DayTraderPortfolioRow): Promise<StrategyIntents>;
}

export interface DayTraderPortfolioRow {
  id: string;
  analyst_id: string;
  organization_slug: string;
  current_balance: number | string;
  strategy_name: string | null;
}

export interface RunStrategiesResult {
  strategiesRun: number;
  opensRequested: number;
  opensWritten: number;
  closesRequested: number;
  closesWritten: number;
}

/** Stub strategy — returns no intents. Day-traders effort replaces this. */
class StubStrategy implements DayTraderStrategy {
  async generateIntents(_portfolio: DayTraderPortfolioRow): Promise<StrategyIntents> {
    return { opens: [], closes: [] };
  }
}

@Injectable()
export class DayTraderRunnerService {
  private readonly logger = new Logger(DayTraderRunnerService.name);

  /**
   * Strategy registry keyed by analyst_portfolios.strategy_name.
   * Public so unit tests can swap stubs in for routing assertions.
   */
  public strategies: Map<string, DayTraderStrategy> = new Map([
    ['momentum_breakout', new StubStrategy()],
    ['mean_reversion', new StubStrategy()],
    ['gap_and_go', new StubStrategy()],
  ]);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(AutotradeOpenHelper) private readonly helper: AutotradeOpenHelper,
    @Inject(AnalystPortfolioService) private readonly portfolios: AnalystPortfolioService,
  ) {}

  /** Cron — hourly during US market hours, weekdays. */
  @Cron('0 14,15,16,17,18 * * 1-5')
  async cronTick(): Promise<void> {
    try {
      const result = await this.runStrategies();
      this.logger.log(
        `cron day-trader tick: ${JSON.stringify(result)}`,
      );
    } catch (err) {
      this.logger.error(`cron day-trader tick failed: ${(err as Error).message}`);
    }
  }

  async runStrategies(): Promise<RunStrategiesResult> {
    const portfolios = await this.loadDayTraderPortfolios();

    let opensRequested = 0;
    let opensWritten = 0;
    let closesRequested = 0;
    let closesWritten = 0;

    for (const portfolio of portfolios) {
      const strategyName = portfolio.strategy_name ?? '';
      const strategy = this.strategies.get(strategyName);
      if (!strategy) {
        this.logger.warn(
          `runStrategies: no strategy registered for portfolio=${portfolio.id} strategy_name=${strategyName}`,
        );
        continue;
      }

      let intents: StrategyIntents;
      try {
        intents = await strategy.generateIntents(portfolio);
      } catch (err) {
        this.logger.error(
          `runStrategies: strategy ${strategyName} threw for portfolio=${portfolio.id}: ${(err as Error).message}`,
        );
        continue;
      }

      opensRequested += intents.opens.length;
      closesRequested += intents.closes.length;

      for (const open of intents.opens) {
        const written = await this.routeOpen(portfolio, open);
        if (written) opensWritten++;
      }
      for (const close of intents.closes) {
        const written = await this.routeClose(portfolio, close);
        if (written) closesWritten++;
      }
    }

    return {
      strategiesRun: portfolios.length,
      opensRequested,
      opensWritten,
      closesRequested,
      closesWritten,
    };
  }

  private async loadDayTraderPortfolios(): Promise<DayTraderPortfolioRow[]> {
    const result = await this.db.rawQuery(
      `select id, analyst_id, organization_slug, current_balance, strategy_name
         from prediction.analyst_portfolios
        where kind = 'day_trader'
          and status = 'active'
        order by id`,
      [],
    );
    return ((result.data as DayTraderPortfolioRow[] | null) ?? []);
  }

  private async resolveInstrument(
    instrumentId: string,
  ): Promise<{ symbol: string; price: number } | null> {
    const result = await this.db.rawQuery(
      `select symbol, current_state from prediction.instruments where id = $1 limit 1`,
      [instrumentId],
    );
    const rows = (result.data as Array<{
      symbol: string;
      current_state: Record<string, unknown> | null;
    }> | null) ?? [];
    if (rows.length === 0) return null;
    const state = rows[0].current_state ?? {};
    const price = Number(
      (state as Record<string, unknown>).price ??
        (state as Record<string, unknown>).last_price ??
        0,
    );
    if (!Number.isFinite(price) || price <= 0) return null;
    return { symbol: rows[0].symbol, price };
  }

  private async routeOpen(
    portfolio: DayTraderPortfolioRow,
    intent: StrategyOpenIntent,
  ): Promise<boolean> {
    const instrument = await this.resolveInstrument(intent.instrumentId);
    if (!instrument) {
      this.logger.warn(
        `routeOpen: no instrument/price for ${intent.instrumentId} (portfolio=${portfolio.id})`,
      );
      return false;
    }

    const result = await this.helper.openPosition({
      portfolio: {
        id: portfolio.id,
        analyst_id: portfolio.analyst_id,
        organization_slug: portfolio.organization_slug,
        current_balance: portfolio.current_balance,
      },
      instrumentId: intent.instrumentId,
      symbol: instrument.symbol,
      direction: intent.direction,
      quantity: intent.quantity,
      entryPrice: instrument.price,
      predictionId: null,
      conviction: intent.conviction,
      triggerReason: 'strategy',
      organizationSlug: portfolio.organization_slug,
    });

    if (result.reason !== 'inserted') return false;

    this.logger.log(
      `Day-trader open: portfolio=${portfolio.id} strategy=${portfolio.strategy_name} symbol=${instrument.symbol} qty=${intent.quantity} entry=${instrument.price}`,
    );
    return true;
  }

  private async routeClose(
    portfolio: DayTraderPortfolioRow,
    intent: StrategyCloseIntent,
  ): Promise<boolean> {
    // Look up the position to get its instrument, then current price.
    const posResult = await this.db.rawQuery(
      `select instrument_id, portfolio_id from prediction.analyst_positions
        where id = $1 and status = 'open' limit 1`,
      [intent.positionId],
    );
    const rows = (posResult.data as Array<{
      instrument_id: string;
      portfolio_id: string;
    }> | null) ?? [];
    if (rows.length === 0) {
      this.logger.warn(
        `routeClose: position ${intent.positionId} not found or already closed`,
      );
      return false;
    }
    if (rows[0].portfolio_id !== portfolio.id) {
      this.logger.warn(
        `routeClose: position ${intent.positionId} belongs to ${rows[0].portfolio_id}, not strategy portfolio ${portfolio.id}; refusing cross-portfolio close`,
      );
      return false;
    }

    const instrument = await this.resolveInstrument(rows[0].instrument_id);
    if (!instrument) return false;

    try {
      await this.portfolios.closePosition(intent.positionId, instrument.price, 'strategy');
      return true;
    } catch (err) {
      this.logger.warn(
        `routeClose: closePosition failed for ${intent.positionId}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
