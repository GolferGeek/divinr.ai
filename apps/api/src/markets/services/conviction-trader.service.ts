import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { PositionSizingService } from './position-sizing.service';
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
    private readonly sizing: PositionSizingService,
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
  async evaluateAnalyst(outcome: PredictionOutcome, organizationSlug: string): Promise<void> {
    if (outcome.confidence < this.threshold()) return;
    if (!outcome.analyst_id) return; // arbitrator predictions have null analyst_id; routed via evaluateArbitrator

    const portfolioRow = await this.findAnalystPortfolio(outcome.analyst_id, organizationSlug);
    if (!portfolioRow) {
      this.logger.warn(
        `evaluateAnalyst: no analyst_portfolios row for analyst_id=${outcome.analyst_id} org=${organizationSlug}; skipping autotrade`,
      );
      return;
    }

    await this.openPositionWithProvenance({
      portfolio: portfolioRow,
      analystId: outcome.analyst_id,
      organizationSlug,
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
  async evaluateArbitrator(outcome: PredictionOutcome, _organizationSlug: string): Promise<void> {
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
      organizationSlug: portfolioRow.organization_slug,
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
    organizationSlug: string,
  ): Promise<PortfolioRow | null> {
    // Look up an active analyst portfolio for this analyst. Try the
    // requested org first, then __base__ (where the seeded analysts live).
    const result = await this.db.rawQuery(
      `select id, analyst_id, organization_slug, current_balance, kind, status
         from prediction.analyst_portfolios
        where analyst_id = $1
          and kind = 'analyst'
          and organization_slug in ($2, '__base__', '*')
        order by case organization_slug
                   when $2 then 0
                   when '__base__' then 1
                   else 2
                 end
        limit 1`,
      [analystId, organizationSlug],
    );
    const rows = (result.data as PortfolioRow[] | null) ?? [];
    return rows[0] ?? null;
  }

  private async findArbitratorPortfolio(): Promise<PortfolioRow | null> {
    const result = await this.db.rawQuery(
      `select id, analyst_id, organization_slug, current_balance, kind, status
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
    organizationSlug: string;
    predictionId: string;
    instrumentId: string;
    direction: 'long' | 'short';
    confidence: number;
    triggerReason: 'signal_cross' | 'eod_sweep';
  }): Promise<void> {
    // Idempotency: skip if an open position already exists for
    // (portfolio_id, instrument_id, prediction_id).
    const existing = await this.db.rawQuery(
      `select id from prediction.analyst_positions
        where portfolio_id = $1
          and instrument_id = $2
          and prediction_id = $3
          and status = 'open'
        limit 1`,
      [input.portfolio.id, input.instrumentId, input.predictionId],
    );
    if (((existing.data as Array<{ id: string }> | null) ?? []).length > 0) return;

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
    const positionPercent = await this.sizing.getPositionPercent(input.confidence, input.organizationSlug);
    if (positionPercent <= 0) return;
    const quantity = this.sizing.calculatePositionSize(
      Number(input.portfolio.current_balance),
      entryPrice,
      positionPercent,
    );
    if (quantity <= 0) return;

    const id = randomUUID();
    const insertResult = await this.db.rawQuery(
      `insert into prediction.analyst_positions
         (id, portfolio_id, analyst_id, organization_slug, prediction_id,
          instrument_id, symbol, direction, quantity,
          entry_price, current_price, is_paper_only, status, opened_at,
          trigger_reason, trigger_prediction_id, trigger_conviction)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, 'open', now(),
               $12, $13, $14)`,
      [
        id,
        input.portfolio.id,
        input.analystId,
        input.portfolio.organization_slug,
        input.predictionId,
        input.instrumentId,
        symbol,
        input.direction,
        quantity,
        entryPrice,
        entryPrice,
        input.triggerReason,
        input.predictionId,
        input.confidence,
      ],
    );
    if (insertResult.error) {
      this.logger.warn(
        `openPositionWithProvenance: insert failed for portfolio=${input.portfolio.id} prediction=${input.predictionId}: ${insertResult.error.message}`,
      );
      return;
    }

    this.logger.log(
      `Autotrade open: portfolio=${input.portfolio.id} symbol=${symbol} qty=${quantity} entry=${entryPrice} conviction=${input.confidence} reason=${input.triggerReason}`,
    );
  }
}

interface PortfolioRow {
  id: string;
  analyst_id: string;
  organization_slug: string;
  current_balance: number | string;
  kind: string;
  status: string;
}
