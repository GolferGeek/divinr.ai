import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { PositionSizingService } from './position-sizing.service';
import { AutotradeOpenHelper } from './autotrade-open-helper.service';
import type { PredictionOutcome } from '../markets.types';

/**
 * Agent Autotrading — Phase 1.
 *
 * When an analyst publishes a prediction whose conviction crosses
 * CONVICTION_TRADE_THRESHOLD (default 70), the analyst opens a position
 * in their own paper portfolio. The arbitrator does the same for its
 * synthesized prediction. Idempotent on
 * (portfolio_id, instrument_id, prediction_id).
 *
 * Sizing reuses the existing Phase 6 Kelly calculator. Open is a pure
 * INSERT — current_balance only changes on close, matching the existing
 * AnalystPortfolioService convention.
 *
 * Provenance fields populated on every fill:
 *   trigger_reason='signal_cross', trigger_prediction_id, trigger_conviction
 *
 * Day-trader portfolios are intentionally not eligible (only kind='analyst'
 * for evaluateAnalyst, and the hard-coded arbitrator portfolio for
 * evaluateArbitrator). The day-traders/leaderboard effort handles them.
 */
@Injectable()
export class ConvictionTraderService {
  private readonly logger = new Logger(ConvictionTraderService.name);

  // Hard-coded id from portfolio-foundation Phase 1 seeding.
  private static readonly ARBITRATOR_PORTFOLIO_ID = 'pf-portfolio-arbitrator';

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(PositionSizingService) private readonly sizing: PositionSizingService,
    @Inject(AutotradeOpenHelper) private readonly helper: AutotradeOpenHelper,
  ) {}

  private threshold(): number {
    const raw = process.env.CONVICTION_TRADE_THRESHOLD;
    const parsed = raw ? Number(raw) : 70;
    return Number.isFinite(parsed) ? parsed : 70;
  }

  /**
   * Called from prediction-runner.service.ts after each analyst publish.
   * Routes to the analyst's own portfolio (kind='analyst').
   */
  async evaluateAnalyst(outcome: PredictionOutcome): Promise<void> {
    if (outcome.confidence < this.threshold()) return;
    if (!outcome.analyst_id) return; // arbitrator predictions have null analyst_id; routed via evaluateArbitrator

    const portfolioRow = await this.findAnalystPortfolio(outcome.analyst_id);
    if (!portfolioRow) {
      this.logger.warn(
        `evaluateAnalyst: no analyst_portfolios row for analyst_id=${outcome.analyst_id}; skipping autotrade`,
      );
      return;
    }

    await this.openPositionWithProvenance({
      portfolio: portfolioRow,
      analystId: outcome.analyst_id,
      predictionId: outcome.id,
      instrumentId: outcome.instrument_id,
      direction: outcome.predicted_direction === 'down' ? 'short' : 'long',
      confidence: outcome.confidence,
      triggerReason: 'signal_cross',
    });
  }

  /**
   * Called from prediction-runner.service.ts after the arbitrator synthesis
   * step. Routes to the seeded arbitrator portfolio (id='pf-portfolio-arbitrator').
   */
  async evaluateArbitrator(outcome: PredictionOutcome): Promise<void> {
    if (outcome.confidence < this.threshold()) return;

    const portfolioRow = await this.findArbitratorPortfolio();
    if (!portfolioRow) {
      this.logger.warn(
        `evaluateArbitrator: arbitrator portfolio ${ConvictionTraderService.ARBITRATOR_PORTFOLIO_ID} missing; skipping autotrade`,
      );
      return;
    }

    await this.openPositionWithProvenance({
      portfolio: portfolioRow,
      analystId: portfolioRow.analyst_id,
      predictionId: outcome.id,
      instrumentId: outcome.instrument_id,
      direction: outcome.predicted_direction === 'down' ? 'short' : 'long',
      confidence: outcome.confidence,
      triggerReason: 'signal_cross',
    });
  }

  // ─── internals ──────────────────────────────────────────────

  private async findAnalystPortfolio(
    analystId: string,
  ): Promise<PortfolioRow | null> {
    const result = await this.db.rawQuery(
      `select id, analyst_id, user_id, current_balance, kind, status
         from prediction.analyst_portfolios
        where analyst_id = $1
          and kind = 'analyst'
        limit 1`,
      [analystId],
    );
    const rows = (result.data as PortfolioRow[] | null) ?? [];
    return rows[0] ?? null;
  }

  private async findArbitratorPortfolio(): Promise<PortfolioRow | null> {
    const result = await this.db.rawQuery(
      `select id, analyst_id, user_id, current_balance, kind, status
         from prediction.analyst_portfolios
        where id = $1`,
      [ConvictionTraderService.ARBITRATOR_PORTFOLIO_ID],
    );
    const rows = (result.data as PortfolioRow[] | null) ?? [];
    return rows[0] ?? null;
  }

  private async openPositionWithProvenance(input: {
    portfolio: PortfolioRow;
    analystId: string;
    predictionId: string;
    instrumentId: string;
    direction: 'long' | 'short';
    confidence: number;
    triggerReason: 'signal_cross' | 'eod_sweep';
  }): Promise<void> {
    // Resolve symbol + entry price from instruments.current_state.
    const instrumentResult = await this.db.rawQuery(
      `select symbol, current_state from prediction.instruments where id = $1 limit 1`,
      [input.instrumentId],
    );
    const instrumentRows = (instrumentResult.data as Array<{
      symbol: string;
      current_state: Record<string, unknown> | null;
    }> | null) ?? [];
    if (instrumentRows.length === 0) {
      this.logger.warn(`openPositionWithProvenance: instrument ${input.instrumentId} not found; skipping`);
      return;
    }
    const symbol = instrumentRows[0].symbol;
    const currentState = instrumentRows[0].current_state ?? {};
    const entryPrice = Number(
      (currentState as Record<string, unknown>).price ??
        (currentState as Record<string, unknown>).last_price ??
        0,
    );
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      this.logger.warn(
        `openPositionWithProvenance: no valid current price for instrument ${input.instrumentId}; skipping`,
      );
      return;
    }

    // Kelly sizing — reuses the existing Phase 6 calculator.
    const positionPercent = await this.sizing.getPositionPercent(input.confidence);
    if (positionPercent <= 0) return;
    const quantity = this.sizing.calculatePositionSize(
      Number(input.portfolio.current_balance),
      entryPrice,
      positionPercent,
    );
    if (quantity <= 0) return;

    const result = await this.helper.openPosition({
      portfolio: {
        id: input.portfolio.id,
        analyst_id: input.analystId,
        user_id: input.portfolio.user_id,
        current_balance: input.portfolio.current_balance,
      },
      instrumentId: input.instrumentId,
      symbol,
      direction: input.direction,
      quantity,
      entryPrice,
      predictionId: input.predictionId,
      conviction: input.confidence,
      triggerReason: input.triggerReason,
    });
    if (result.reason !== 'inserted') return;

    this.logger.log(
      `Autotrade open: portfolio=${input.portfolio.id} symbol=${symbol} qty=${quantity} entry=${entryPrice} conviction=${input.confidence} reason=${input.triggerReason}`,
    );
  }
}

interface PortfolioRow {
  id: string;
  analyst_id: string;
  user_id: string | null;
  current_balance: number | string;
  kind: string;
  status: string;
}
