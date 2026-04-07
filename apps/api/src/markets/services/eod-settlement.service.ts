import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { StocksPredictionPlane } from '@divinr/prediction-planes';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import { AnalystPortfolioService } from './analyst-portfolio.service';
import { UserPortfolioService } from './user-portfolio.service';
import { PositionSizingService } from './position-sizing.service';
import { NightlyEvaluationService } from './nightly-evaluation.service';
import { LearningEngineService } from './learning-engine.service';
import { EodForcedBuyService } from './eod-forced-buy.service';
import type { EodSettlementLog } from '../markets.types';

/**
 * End-of-Day Settlement — runs at 5 PM ET (22:00 UTC) Mon-Fri.
 *
 * Full pipeline:
 * 0. Capture closing prices
 * 1. Execute queued user trades
 * 2. Create analyst positions from today's predictions
 * 3. Resolve expired predictions + close positions
 * 4. Update unrealized P&L
 * 5. Check portfolio status thresholds
 * 6. Run nightly evaluation (1d/3d/5d)
 * 7. Run learning cycle (Tier 1)
 * 8. Generate settlement report
 */
@Injectable()
export class EodSettlementService {
  private readonly logger = new Logger(EodSettlementService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
    @Inject(AnalystPortfolioService) private readonly analystPortfolio: AnalystPortfolioService,
    @Inject(UserPortfolioService) private readonly userPortfolio: UserPortfolioService,
    @Inject(PositionSizingService) private readonly sizing: PositionSizingService,
    @Inject(NightlyEvaluationService) private readonly nightlyEval: NightlyEvaluationService,
    @Inject(LearningEngineService) private readonly learningEngine: LearningEngineService,
    @Inject(EodForcedBuyService) private readonly eodForcedBuy: EodForcedBuyService,
  ) {}

  /** Cron: 5 PM ET Mon-Fri (22:00 UTC). Disable with MARKETS_DISABLE_EOD_SETTLEMENT=true */
  @Cron('0 22 * * 1-5')
  async handleSettlementCron(): Promise<void> {
    if (process.env.MARKETS_DISABLE_EOD_SETTLEMENT === 'true') return;
    try {
      await this.runSettlement();
    } catch (err) {
      this.logger.error(`EOD settlement cron failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async runSettlement(): Promise<EodSettlementLog> {
    await this.schema.ensureSchema();
    const startedAt = new Date();
    this.logger.log('Starting EOD settlement');

    const log: EodSettlementLog = {
      id: randomUUID(),
      organization_slug: null,
      settlement_date: new Date().toISOString().slice(0, 10),
      queued_trades_executed: 0,
      analyst_positions_created: 0,
      predictions_resolved: 0,
      positions_closed: 0,
      unrealized_pnl_updated: 0,
      total_realized_pnl: 0,
      errors: [],
      started_at: startedAt.toISOString(),
      completed_at: null,
      duration_ms: null,
    };

    try {
      // Step 0: Capture closing prices (placeholder — needs market data API)
      const closingPrices = await this.captureClosingPrices();

      // Step 1: Execute queued user trades
      const orgs = await this.getActiveOrgs();
      for (const org of orgs) {
        const queueResult = await this.userPortfolio.executeQueuedTrades(org, closingPrices);
        log.queued_trades_executed += queueResult.executed;
        log.errors.push(...queueResult.errors);
      }

      // Step 1.5: EOD forced-buy backstop sweep — opens positions for any
      // above-conviction-threshold analyst or arbitrator predictions that
      // weren't already caught by ConvictionTraderService during the
      // pipeline run. Tags them with trigger_reason='eod_sweep'. Runs
      // before createAnalystPositions so high-conviction items get proper
      // provenance instead of being captured by the default-provenance
      // backfill below. Failure-isolated.
      try {
        const sweepResult = await this.eodForcedBuy.runSweep({ manual: false });
        if (sweepResult.rowsWritten > 0 || sweepResult.errors.length > 0) {
          this.logger.log(
            `EOD forced-buy sweep wrote ${sweepResult.rowsWritten} positions (skipped ${sweepResult.skipped}, errors ${sweepResult.errors.length})`,
          );
          log.errors.push(...sweepResult.errors);
        }
      } catch (err) {
        log.errors.push(`EOD forced-buy: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Step 2: Create analyst positions from today's completed predictions
      const analystResult = await this.createAnalystPositions(closingPrices);
      log.analyst_positions_created = analystResult.created;
      log.errors.push(...analystResult.errors);

      // Step 2b: Mark all of today's predictions as settled so they drop off
      // the live dashboard. Tomorrow's pipeline will produce fresh signals.
      try {
        const settled = await this.markTodaysPredictionsSettled();
        this.logger.log(`EOD: marked ${settled} predictions as settled`);
      } catch (err) {
        log.errors.push(`Settle predictions: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Step 3: Resolve expired predictions and close positions
      const resolveResult = await this.resolveExpiredPositions(closingPrices);
      log.predictions_resolved = resolveResult.resolved;
      log.positions_closed = resolveResult.closed;
      log.total_realized_pnl = resolveResult.totalPnl;
      log.errors.push(...resolveResult.errors);

      // Step 4: Update unrealized P&L
      const pnlResult = await this.updateAllUnrealizedPnl(closingPrices);
      log.unrealized_pnl_updated = pnlResult;

      // Step 5: Run nightly evaluation
      try {
        await this.nightlyEval.runNightlyEvaluation();
      } catch (err) {
        log.errors.push(`Nightly eval: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Step 6: Run learning cycle
      try {
        await this.learningEngine.runLearningCycle();
      } catch (err) {
        log.errors.push(`Learning: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Step 6.5: Daily P&L snapshots — feeds /portfolios sparkline.
      // Failure-isolated: errors are logged but never roll back settlement.
      try {
        const snapResult = await this.writeDailySnapshots(closingPrices);
        this.logger.log(`Daily P&L snapshots written: ${snapResult.written}`);
      } catch (err) {
        log.errors.push(`Daily snapshots: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err) {
      log.errors.push(`Settlement: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 7: Persist settlement log
    log.completed_at = new Date().toISOString();
    log.duration_ms = Date.now() - startedAt.getTime();
    await this.persistSettlementLog(log);

    // Step 8: Generate settlement report
    await this.generateSettlementReport(log);

    this.logger.log(
      `EOD settlement complete in ${log.duration_ms}ms: ${log.analyst_positions_created} positions, ${log.positions_closed} closed, P&L ${log.total_realized_pnl.toFixed(2)}`,
    );

    return log;
  }

  // ─── Step 0: Closing prices ──────────────────────────────────

  async captureClosingPrices(): Promise<Map<string, number>> {
    // TODO: Integrate with market data API via prediction plane
    // For now, use current_state from instruments table
    const result = await this.db.rawQuery(
      `select id, current_state from prediction.instruments where is_active = true`,
    );
    const instruments = (result.data as Array<{ id: string; current_state: Record<string, unknown> }> | null) ?? [];
    const prices = new Map<string, number>();
    for (const inst of instruments) {
      const price = Number(inst.current_state?.['price']);
      if (price > 0) prices.set(inst.id, price);
    }
    return prices;
  }

  // ─── Step 2: Analyst positions ───────────────────────────────

  private async createAnalystPositions(closingPrices: Map<string, number>): Promise<{
    created: number; errors: string[];
  }> {
    // Find today's completed predictions that don't have positions yet
    const result = await this.db.rawQuery(
      `select mp.id as prediction_id, mp.analyst_id, mp.organization_slug,
              mp.instrument_id, mp.predicted_direction, mp.confidence, mp.role,
              i.symbol
       from prediction.market_predictions mp
       join prediction.instruments i on i.id = mp.instrument_id
       where mp.created_at::date = current_date
         and mp.role = 'analyst'
         and mp.predicted_direction != 'flat'
         and mp.is_paper = false
         and not exists (
           select 1 from prediction.analyst_positions ap
           where ap.prediction_id = mp.id
         )`,
    );
    const predictions = (result.data as Array<{
      prediction_id: string; analyst_id: string; organization_slug: string;
      instrument_id: string; predicted_direction: string; confidence: number; symbol: string;
    }> | null) ?? [];

    let created = 0;
    const errors: string[] = [];

    for (const pred of predictions) {
      try {
        const entryPrice = closingPrices.get(pred.instrument_id);
        if (!entryPrice) continue;

        // Paper trading gate: analyst portfolios start in paper mode for 3 days
        const isPaperOnly = await this.isInPaperTradingPeriod(pred.analyst_id, pred.organization_slug);

        const position = await this.analystPortfolio.createPositionFromPrediction({
          analystId: pred.analyst_id,
          organizationSlug: pred.organization_slug,
          predictionId: pred.prediction_id,
          instrumentId: pred.instrument_id,
          symbol: pred.symbol,
          direction: pred.predicted_direction as 'up' | 'down',
          confidence: pred.confidence,
          entryPrice,
          isPaperOnly,
        });
        if (position) created++;
      } catch (err) {
        errors.push(`Position for ${pred.prediction_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { created, errors };
  }

  // ─── Step 2b: Settle today's predictions ─────────────────────

  /**
   * Mark every prediction created today (that isn't already settled) as
   * settled. After this runs, the dashboard's "what should I do now?" view
   * is empty until the next day's pipeline produces fresh signals. The
   * predictions are NOT deleted — they remain in market_predictions for
   * history, evaluation, and learning, just hidden from the live view.
   */
  private async markTodaysPredictionsSettled(): Promise<number> {
    const result = await this.db.rawQuery(
      `update prediction.market_predictions
       set settled_at = now()
       where settled_at is null
         and created_at::date <= current_date
       returning id`,
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return ((result.data as Array<{ id: string }> | null) ?? []).length;
  }

  // ─── Step 3: Resolve expired ─────────────────────────────────

  private async resolveExpiredPositions(closingPrices: Map<string, number>): Promise<{
    resolved: number; closed: number; totalPnl: number; errors: string[];
  }> {
    // Find open analyst positions linked to predictions older than their horizon
    const result = await this.db.rawQuery(
      `select ap.id, ap.instrument_id
       from prediction.analyst_positions ap
       join prediction.market_predictions mp on mp.id = ap.prediction_id
       where ap.status = 'open'
         and ap.opened_at + (mp.horizon_minutes || ' minutes')::interval < now()`,
    );
    const expiredPositions = (result.data as Array<{ id: string; instrument_id: string }> | null) ?? [];

    let closed = 0;
    let totalPnl = 0;
    const errors: string[] = [];

    for (const pos of expiredPositions) {
      try {
        const exitPrice = closingPrices.get(pos.instrument_id);
        if (!exitPrice) continue;

        const { realizedPnl } = await this.analystPortfolio.closePosition(pos.id, exitPrice);
        totalPnl += realizedPnl;
        closed++;
      } catch (err) {
        errors.push(`Close ${pos.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { resolved: expiredPositions.length, closed, totalPnl, errors };
  }

  // ─── Step 4: Update unrealized ───────────────────────────────

  private async updateAllUnrealizedPnl(closingPrices: Map<string, number>): Promise<number> {
    let total = 0;
    for (const [instrumentId, price] of closingPrices) {
      total += await this.analystPortfolio.updateUnrealizedPnl(instrumentId, price);
    }
    return total;
  }

  // ─── Step 6.5: Daily P&L snapshots ───────────────────────────

  /**
   * For every analyst + user portfolio, INSERT one row into
   * prediction.daily_pnl_snapshot keyed on (kind, id, snapshot_date).
   * UNIQUE constraint makes the writer idempotent on retry.
   */
  async writeDailySnapshots(closingPrices: Map<string, number>): Promise<{ written: number }> {
    const today = new Date().toISOString().slice(0, 10);
    let written = 0;

    // Analyst portfolios (analyst | arbitrator | day_trader).
    const apRes = await this.db.rawQuery(
      `select id, current_balance, initial_balance from prediction.analyst_portfolios`,
    );
    const analystPortfolios = (apRes.data as Array<{ id: string; current_balance: number; initial_balance: number }> | null) ?? [];
    for (const ap of analystPortfolios) {
      const snap = await this.computeAnalystSnapshot(ap.id, closingPrices);
      const ins = await this.db.rawQuery(
        `insert into prediction.daily_pnl_snapshot
          (portfolio_kind, portfolio_id, snapshot_date, starting_balance, ending_balance,
           realized_pnl, unrealized_pnl, open_position_count, trades_today)
         values ('analyst', $1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (portfolio_kind, portfolio_id, snapshot_date) do update set
           ending_balance = excluded.ending_balance,
           realized_pnl = excluded.realized_pnl,
           unrealized_pnl = excluded.unrealized_pnl,
           open_position_count = excluded.open_position_count,
           trades_today = excluded.trades_today
         returning id`,
        [ap.id, today, snap.starting, snap.ending, snap.realized, snap.unrealized, snap.openCount, snap.tradesToday],
      );
      written += ((ins.data as Array<unknown> | null) ?? []).length;
    }

    // User portfolios.
    const upRes = await this.db.rawQuery(
      `select id, current_balance, initial_balance from prediction.user_portfolios`,
    );
    const userPortfolios = (upRes.data as Array<{ id: string; current_balance: number; initial_balance: number }> | null) ?? [];
    for (const up of userPortfolios) {
      const snap = await this.computeUserSnapshot(up.id, closingPrices);
      const ins = await this.db.rawQuery(
        `insert into prediction.daily_pnl_snapshot
          (portfolio_kind, portfolio_id, snapshot_date, starting_balance, ending_balance,
           realized_pnl, unrealized_pnl, open_position_count, trades_today)
         values ('user', $1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (portfolio_kind, portfolio_id, snapshot_date) do update set
           ending_balance = excluded.ending_balance,
           realized_pnl = excluded.realized_pnl,
           unrealized_pnl = excluded.unrealized_pnl,
           open_position_count = excluded.open_position_count,
           trades_today = excluded.trades_today
         returning id`,
        [up.id, today, snap.starting, snap.ending, snap.realized, snap.unrealized, snap.openCount, snap.tradesToday],
      );
      written += ((ins.data as Array<unknown> | null) ?? []).length;
    }

    return { written };
  }

  private async computeAnalystSnapshot(portfolioId: string, closingPrices: Map<string, number>) {
    const balRes = await this.db.rawQuery(
      `select current_balance from prediction.analyst_portfolios where id = $1`,
      [portfolioId],
    );
    const ending = Number(((balRes.data as Array<{ current_balance: number }> | null) ?? [{ current_balance: 0 }])[0].current_balance);

    const realizedRes = await this.db.rawQuery(
      `select coalesce(sum(realized_pnl), 0)::float8 as r
       from prediction.analyst_positions
       where portfolio_id = $1 and status = 'closed' and closed_at::date = current_date`,
      [portfolioId],
    );
    const realized = Number(((realizedRes.data as Array<{ r: number }> | null) ?? [{ r: 0 }])[0].r);

    const openRes = await this.db.rawQuery(
      `select id, instrument_id, direction, entry_price, quantity
       from prediction.analyst_positions where portfolio_id = $1 and status = 'open'`,
      [portfolioId],
    );
    const openRows = (openRes.data as Array<{ instrument_id: string; direction: string; entry_price: number; quantity: number }> | null) ?? [];
    let unrealized = 0;
    for (const p of openRows) {
      const px = closingPrices.get(p.instrument_id);
      if (!px) continue;
      const entry = Number(p.entry_price);
      const qty = Number(p.quantity);
      unrealized += p.direction === 'short' ? (entry - px) * qty : (px - entry) * qty;
    }

    const tradesRes = await this.db.rawQuery(
      `select count(*)::int as c from prediction.analyst_positions
       where portfolio_id = $1 and (opened_at::date = current_date or closed_at::date = current_date)`,
      [portfolioId],
    );
    const tradesToday = Number(((tradesRes.data as Array<{ c: number }> | null) ?? [{ c: 0 }])[0].c);

    const starting = ending - realized;
    return { starting, ending, realized, unrealized, openCount: openRows.length, tradesToday };
  }

  private async computeUserSnapshot(portfolioId: string, closingPrices: Map<string, number>) {
    const balRes = await this.db.rawQuery(
      `select current_balance from prediction.user_portfolios where id = $1`,
      [portfolioId],
    );
    const ending = Number(((balRes.data as Array<{ current_balance: number }> | null) ?? [{ current_balance: 0 }])[0].current_balance);

    const realizedRes = await this.db.rawQuery(
      `select coalesce(sum(realized_pnl), 0)::float8 as r
       from prediction.user_positions
       where portfolio_id = $1 and status = 'closed' and closed_at::date = current_date`,
      [portfolioId],
    );
    const realized = Number(((realizedRes.data as Array<{ r: number }> | null) ?? [{ r: 0 }])[0].r);

    const openRes = await this.db.rawQuery(
      `select instrument_id, direction, entry_price, quantity
       from prediction.user_positions where portfolio_id = $1 and status = 'open'`,
      [portfolioId],
    );
    const openRows = (openRes.data as Array<{ instrument_id: string; direction: string; entry_price: number; quantity: number }> | null) ?? [];
    let unrealized = 0;
    for (const p of openRows) {
      const px = closingPrices.get(p.instrument_id);
      if (!px) continue;
      const entry = Number(p.entry_price);
      const qty = Number(p.quantity);
      unrealized += p.direction === 'short' ? (entry - px) * qty : (px - entry) * qty;
    }

    const tradesRes = await this.db.rawQuery(
      `select count(*)::int as c from prediction.user_positions
       where portfolio_id = $1 and (opened_at::date = current_date or closed_at::date = current_date)`,
      [portfolioId],
    );
    const tradesToday = Number(((tradesRes.data as Array<{ c: number }> | null) ?? [{ c: 0 }])[0].c);

    const starting = ending - realized;
    return { starting, ending, realized, unrealized, openCount: openRows.length, tradesToday };
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private async getActiveOrgs(): Promise<string[]> {
    const result = await this.db.rawQuery(
      `select distinct organization_slug from prediction.instruments where is_active = true`,
    );
    return ((result.data as Array<{ organization_slug: string }> | null) ?? []).map(r => r.organization_slug);
  }

  private async persistSettlementLog(log: EodSettlementLog): Promise<void> {
    await this.db.rawQuery(
      `insert into prediction.eod_settlement_log
        (id, organization_slug, settlement_date, queued_trades_executed,
         analyst_positions_created, predictions_resolved, positions_closed,
         unrealized_pnl_updated, total_realized_pnl, errors,
         started_at, completed_at, duration_ms)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        log.id, log.organization_slug, log.settlement_date,
        log.queued_trades_executed, log.analyst_positions_created,
        log.predictions_resolved, log.positions_closed,
        log.unrealized_pnl_updated, log.total_realized_pnl,
        JSON.stringify(log.errors), log.started_at, log.completed_at, log.duration_ms,
      ],
    );
  }

  private async generateSettlementReport(log: EodSettlementLog): Promise<void> {
    // Persist as a learning report for dashboard consumption
    await this.db.rawQuery(
      `insert into prediction.learning_reports (id, report_type, report_date, summary, created_at)
       values ($1, 'daily_settlement', $2, $3, now())`,
      [randomUUID(), log.settlement_date, JSON.stringify(log)],
    );
  }

  /**
   * Paper trading gate: analyst portfolios start in paper mode for 3 days.
   * After 3 days, if portfolio drawdown < 20%, positions transition to live.
   */
  private async isInPaperTradingPeriod(analystId: string, organizationSlug: string): Promise<boolean> {
    const result = await this.db.rawQuery(
      `select created_at, current_balance, initial_balance
       from prediction.analyst_portfolios
       where analyst_id = $1 and organization_slug = $2`,
      [analystId, organizationSlug],
    );
    const rows = (result.data as Array<{ created_at: string; current_balance: number; initial_balance: number }> | null) ?? [];
    if (rows.length === 0) return true; // New portfolio → paper mode

    const portfolio = rows[0];
    const createdAt = new Date(portfolio.created_at);
    const daysSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceCreation < 3) return true; // Within 3-day paper period

    // After 3 days: check drawdown
    const drawdown = 1 - (portfolio.current_balance / portfolio.initial_balance);
    if (drawdown >= 0.2) return true; // Drawdown too high — stay in paper mode

    return false; // Promoted to live
  }
}
