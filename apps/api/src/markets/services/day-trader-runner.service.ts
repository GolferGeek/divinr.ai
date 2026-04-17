import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { AutotradeOpenHelper } from './autotrade-open-helper.service';
import { AnalystPortfolioService } from './analyst-portfolio.service';
import type { RecentBar } from './outcome-tracking.service';
import { MomentumBreakoutStrategy } from '../strategies/momentum-breakout.strategy';
import { MeanReversionStrategy } from '../strategies/mean-reversion.strategy';
import { GapAndGoStrategy } from '../strategies/gap-and-go.strategy';

/**
 * DayTraderRunnerService — drives the three day-trader portfolios
 * (momentum-breakout, mean-reversion, gap-and-go).
 *
 * Phase 2 of day-traders-and-leaderboard rewrote the strategy hook to a
 * stateful `decide({portfolio, recentBars, latestSignals, openPositions,
 * state})` interface. The runner is responsible for fetching ambient
 * context (bars, signals, open positions), invoking the strategy, routing
 * the resulting open/close action through the helper / portfolio service,
 * and persisting the returned newState back into
 * `analyst_portfolios.strategy_state` keyed by strategy_name.
 *
 * The runner no longer carries its own cron — Phase 3 invokes it from
 * OutcomeTrackingService after every 15-min stop-loss sweep, which is
 * also where the EOD-flat boundary is detected.
 */

const BASE_SIZE_PCT = 0.05;
const LOOKBACK_MIN = 20;

export interface DayTraderPortfolioRow {
  id: string;
  analyst_id: string;
  user_id: string | null;
  analyst_user_id: string | null;
  current_balance: number | string;
  strategy_name: string | null;
  strategy_state: Record<string, unknown> | null;
}

export interface OpenPositionRow {
  id: string;
  instrument_id: string;
  direction: 'long' | 'short';
  quantity: number;
  entry_price: number;
}

export interface Signal {
  direction: 'up' | 'down' | 'flat';
  confidence: number;
}

export interface DecideContext {
  portfolio: DayTraderPortfolioRow;
  recentBars: Map<string, RecentBar[]>;
  latestSignals: Map<string, Signal | null>;
  openPositions: OpenPositionRow[];
  state: Record<string, unknown>;
  nowMs: number;
}

export type DecideAction =
  | { action: 'noop'; newState: Record<string, unknown> }
  | {
      action: 'open';
      instrumentId: string;
      direction: 'long' | 'short';
      sizingMultiplier: number;
      newState: Record<string, unknown>;
    }
  | {
      action: 'close';
      positionId: string;
      newState: Record<string, unknown>;
    };

export interface DayTraderStrategy {
  decide(ctx: DecideContext): DecideAction | Promise<DecideAction>;
}

export interface RunStrategiesResult {
  strategiesRun: number;
  opensRequested: number;
  opensWritten: number;
  closesRequested: number;
  closesWritten: number;
  eodFlat: boolean;
}

@Injectable()
export class DayTraderRunnerService {
  private readonly logger = new Logger(DayTraderRunnerService.name);

  /**
   * Strategy registry keyed by analyst_portfolios.strategy_name.
   * Public so unit tests can swap stubs in for routing assertions.
   */
  public strategies: Map<string, DayTraderStrategy> = new Map<string, DayTraderStrategy>([
    ['momentum_breakout', new MomentumBreakoutStrategy()],
    ['mean_reversion', new MeanReversionStrategy()],
    ['gap_and_go', new GapAndGoStrategy()],
  ]);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(AutotradeOpenHelper) private readonly helper: AutotradeOpenHelper,
    @Inject(AnalystPortfolioService) private readonly portfolios: AnalystPortfolioService,
  ) {}

  /**
   * True when the next 15-min boundary lands at-or-after 22:00 UTC. Caller
   * (OutcomeTrackingService) is responsible for invoking with the wall-clock
   * `now` of the current tick. Used to trigger the EOD-flat force-close.
   */
  static isLastTickOfSession(now: Date): boolean {
    const next = new Date(now.getTime() + 15 * 60 * 1000);
    const cutoff = new Date(Date.UTC(
      next.getUTCFullYear(),
      next.getUTCMonth(),
      next.getUTCDate(),
      22, 0, 0, 0,
    ));
    return next.getTime() >= cutoff.getTime() && now.getUTCHours() < 22;
  }

  async runStrategies(opts: { isLastTickOfSession?: boolean } = {}): Promise<RunStrategiesResult> {
    const portfolios = await this.loadDayTraderPortfolios();

    if (opts.isLastTickOfSession) {
      return this.runEodFlat(portfolios);
    }

    let opensRequested = 0;
    let opensWritten = 0;
    let closesRequested = 0;
    let closesWritten = 0;

    // Per-tick caches so base-analyst candidates (which are identical
    // across all base portfolios) are loaded once.
    const candidateCache = new Map<string, Array<{ id: string; symbol: string; price: number }>>();

    for (const portfolio of portfolios) {
      const strategyName = portfolio.strategy_name ?? '';
      const strategy = this.strategies.get(strategyName);
      if (!strategy) {
        this.logger.warn(
          `runStrategies: no strategy registered for portfolio=${portfolio.id} strategy_name=${strategyName}`,
        );
        continue;
      }

      const analyst = { id: portfolio.analyst_id, user_id: portfolio.analyst_user_id };
      const cacheKey = analyst.user_id === null ? 'base' : `${analyst.user_id}:${analyst.id}`;
      let instruments = candidateCache.get(cacheKey);
      if (!instruments) {
        instruments = await this.loadCandidateInstruments(analyst);
        candidateCache.set(cacheKey, instruments);
      }
      const instrumentIds = instruments.map(i => i.id);
      const recentBarsMap = await this.loadRecentBarsMap(instruments);
      const latestSignals = await this.loadLatestSignals(instrumentIds);

      const openPositions = await this.loadOpenPositions(portfolio.id);
      const fullState = (portfolio.strategy_state ?? {}) as Record<string, unknown>;
      const stateForStrategy = (fullState[strategyName] as Record<string, unknown> | undefined) ?? {};

      let decision: DecideAction;
      try {
        decision = await strategy.decide({
          portfolio,
          recentBars: recentBarsMap,
          latestSignals,
          openPositions,
          state: stateForStrategy,
          nowMs: Date.now(),
        });
      } catch (err) {
        this.logger.error(
          `runStrategies: strategy ${strategyName} threw for portfolio=${portfolio.id}: ${(err as Error).message}`,
        );
        continue;
      }

      // Persist newState regardless of action.
      try {
        const merged = { ...fullState, [strategyName]: decision.newState };
        await this.persistStrategyState(portfolio.id, merged);
      } catch (err) {
        this.logger.error(
          `runStrategies: failed to persist strategy_state for portfolio=${portfolio.id}: ${(err as Error).message}`,
        );
      }

      if (decision.action === 'open') {
        opensRequested++;
        const written = await this.routeOpen(portfolio, decision);
        if (written) opensWritten++;
      } else if (decision.action === 'close') {
        closesRequested++;
        const written = await this.routeClose(portfolio, decision.positionId, portfolio.strategy_name ?? 'unknown');
        if (written) closesWritten++;
      }
    }

    return {
      strategiesRun: portfolios.length,
      opensRequested,
      opensWritten,
      closesRequested,
      closesWritten,
      eodFlat: false,
    };
  }

  /**
   * EOD-flat path: force-close every open day-trader position at the
   * last cached price. Strategies are NOT consulted.
   */
  private async runEodFlat(portfolios: DayTraderPortfolioRow[]): Promise<RunStrategiesResult> {
    let closesRequested = 0;
    let closesWritten = 0;

    for (const portfolio of portfolios) {
      const open = await this.loadOpenPositions(portfolio.id);
      for (const pos of open) {
        closesRequested++;
        const written = await this.routeClose(portfolio, pos.id, 'eod_flat');
        if (written) closesWritten++;
      }
    }

    return {
      strategiesRun: portfolios.length,
      opensRequested: 0,
      opensWritten: 0,
      closesRequested,
      closesWritten,
      eodFlat: true,
    };
  }

  private async loadDayTraderPortfolios(): Promise<DayTraderPortfolioRow[]> {
    const result = await this.db.rawQuery(
      `select p.id, p.analyst_id, p.user_id, a.user_id as analyst_user_id,
              p.current_balance, p.strategy_name, p.strategy_state
         from prediction.analyst_portfolios p
         join prediction.market_analysts a on a.id = p.analyst_id
        where p.kind = 'day_trader'
          and p.status = 'active'
        order by p.id`,
      [],
    );
    return ((result.data as DayTraderPortfolioRow[] | null) ?? []).map(r => ({
      ...r,
      analyst_user_id: r.analyst_user_id ?? null,
    }));
  }

  private async loadOpenPositions(portfolioId: string): Promise<OpenPositionRow[]> {
    const result = await this.db.rawQuery(
      `select id, instrument_id, direction, quantity, entry_price
         from prediction.analyst_positions
        where portfolio_id = $1 and status = 'open'`,
      [portfolioId],
    );
    return ((result.data as OpenPositionRow[] | null) ?? []).map(r => ({
      id: r.id,
      instrument_id: r.instrument_id,
      direction: r.direction,
      quantity: Number(r.quantity),
      entry_price: Number(r.entry_price),
    }));
  }

  private async loadCandidateInstruments(
    analyst: { id: string; user_id: string | null },
  ): Promise<Array<{ id: string; symbol: string; price: number }>> {
    if (analyst.user_id === null) {
      return this.loadActiveInstruments();
    }

    const enabledResult = await this.db.rawQuery(
      `select instrument_id
         from prediction.user_enabled_triples
        where author_user_id = $1
          and analyst_id = $2
          and disabled_at is null`,
      [analyst.user_id, analyst.id],
    );
    const enabled = ((enabledResult.data as Array<{ instrument_id: string }> | null) ?? [])
      .map(r => r.instrument_id);
    if (enabled.length === 0) {
      this.logger.log(
        `loadCandidateInstruments: authored analyst ${analyst.id} (user=${analyst.user_id}) has zero enabled triples — no-op`,
      );
      return [];
    }

    const result = await this.db.rawQuery(
      `select id, symbol, current_state
         from prediction.instruments
        where id = ANY($1) and is_active = true`,
      [enabled],
    );
    return this.projectPricedInstruments(result.data);
  }

  private async loadActiveInstruments(): Promise<Array<{ id: string; symbol: string; price: number }>> {
    const result = await this.db.rawQuery(
      `select distinct on (symbol) id, symbol, current_state
         from prediction.instruments
        where is_active = true
        order by symbol`,
      [],
    );
    return this.projectPricedInstruments(result.data);
  }

  private projectPricedInstruments(
    data: unknown,
  ): Array<{ id: string; symbol: string; price: number }> {
    const rows = (data as Array<{
      id: string;
      symbol: string;
      current_state: Record<string, unknown> | null;
    }> | null) ?? [];
    const out: Array<{ id: string; symbol: string; price: number }> = [];
    for (const r of rows) {
      const state = r.current_state ?? {};
      const price = Number(
        (state as Record<string, unknown>).price ??
          (state as Record<string, unknown>).last_price ??
          0,
      );
      if (Number.isFinite(price) && price > 0) {
        out.push({ id: r.id, symbol: r.symbol, price });
      }
    }
    return out;
  }

  private async loadRecentBarsMap(
    instruments: Array<{ id: string; current_state?: unknown }>,
  ): Promise<Map<string, RecentBar[]>> {
    // We re-query to get current_state with recent_bars; cheaper than N round-trips.
    const ids = instruments.map(i => i.id);
    if (ids.length === 0) return new Map();
    const result = await this.db.rawQuery(
      `select id, current_state from prediction.instruments where id = ANY($1)`,
      [ids],
    );
    const rows = (result.data as Array<{
      id: string;
      current_state: Record<string, unknown> | null;
    }> | null) ?? [];
    const map = new Map<string, RecentBar[]>();
    for (const r of rows) {
      const intraday = Array.isArray(r.current_state?.intraday_bars)
        ? (r.current_state!.intraday_bars as RecentBar[])
        : [];
      const daily = Array.isArray(r.current_state?.recent_bars)
        ? (r.current_state!.recent_bars as RecentBar[])
        : [];
      const bars = intraday.length >= LOOKBACK_MIN ? intraday : daily;
      map.set(r.id, bars);
    }
    return map;
  }

  private async loadLatestSignals(instrumentIds: string[]): Promise<Map<string, Signal | null>> {
    const map = new Map<string, Signal | null>();
    if (instrumentIds.length === 0) return map;
    const result = await this.db.rawQuery(
      `select distinct on (instrument_id)
              instrument_id, predicted_direction, confidence
         from prediction.market_predictions
        where instrument_id = ANY($1)
        order by instrument_id, created_at desc`,
      [instrumentIds],
    );
    const rows = (result.data as Array<{
      instrument_id: string;
      predicted_direction: 'up' | 'down' | 'flat';
      confidence: number | string;
    }> | null) ?? [];
    for (const r of rows) {
      map.set(r.instrument_id, {
        direction: r.predicted_direction,
        confidence: Number(r.confidence),
      });
    }
    return map;
  }

  private async persistStrategyState(
    portfolioId: string,
    state: Record<string, unknown>,
  ): Promise<void> {
    await this.db.rawQuery(
      `update prediction.analyst_portfolios
          set strategy_state = $1::jsonb,
              updated_at = now()
        where id = $2`,
      [JSON.stringify(state), portfolioId],
    );
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
    decision: Extract<DecideAction, { action: 'open' }>,
  ): Promise<boolean> {
    const instrument = await this.resolveInstrument(decision.instrumentId);
    if (!instrument) {
      this.logger.warn(
        `routeOpen: no instrument/price for ${decision.instrumentId} (portfolio=${portfolio.id})`,
      );
      return false;
    }

    const balance = Number(portfolio.current_balance);
    const multiplier = Number.isFinite(decision.sizingMultiplier) ? decision.sizingMultiplier : 1;
    const dollarSize = balance * BASE_SIZE_PCT * multiplier;
    const quantity = Math.floor(dollarSize / instrument.price);
    if (quantity <= 0) {
      this.logger.warn(
        `routeOpen: computed quantity ${quantity} <= 0 for portfolio=${portfolio.id} instrument=${decision.instrumentId}`,
      );
      return false;
    }

    const result = await this.helper.openPosition({
      portfolio: {
        id: portfolio.id,
        analyst_id: portfolio.analyst_id,
        user_id: portfolio.user_id,
        current_balance: portfolio.current_balance,
      },
      instrumentId: decision.instrumentId,
      symbol: instrument.symbol,
      direction: decision.direction,
      quantity,
      entryPrice: instrument.price,
      predictionId: null,
      conviction: 0,
      triggerReason: 'strategy',
      triggerStrategy: portfolio.strategy_name ?? undefined,
    });

    if (result.reason !== 'inserted') return false;

    this.logger.log(
      `Day-trader open: portfolio=${portfolio.id} strategy=${portfolio.strategy_name} symbol=${instrument.symbol} qty=${quantity} entry=${instrument.price}`,
    );
    return true;
  }

  private async routeClose(
    portfolio: DayTraderPortfolioRow,
    positionId: string,
    triggerStrategy: string,
  ): Promise<boolean> {
    const posResult = await this.db.rawQuery(
      `select instrument_id, portfolio_id from prediction.analyst_positions
        where id = $1 and status = 'open' limit 1`,
      [positionId],
    );
    const rows = (posResult.data as Array<{
      instrument_id: string;
      portfolio_id: string;
    }> | null) ?? [];
    if (rows.length === 0) {
      this.logger.warn(
        `routeClose: position ${positionId} not found or already closed`,
      );
      return false;
    }
    if (rows[0].portfolio_id !== portfolio.id) {
      this.logger.warn(
        `routeClose: position ${positionId} belongs to ${rows[0].portfolio_id}, not strategy portfolio ${portfolio.id}; refusing cross-portfolio close`,
      );
      return false;
    }

    const instrument = await this.resolveInstrument(rows[0].instrument_id);
    if (!instrument) return false;

    try {
      await this.portfolios.closePosition(positionId, instrument.price, 'strategy', triggerStrategy);
      return true;
    } catch (err) {
      this.logger.warn(
        `routeClose: closePosition failed for ${positionId}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
