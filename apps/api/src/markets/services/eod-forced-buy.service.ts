import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { PositionSizingService } from './position-sizing.service';
import { AutotradeOpenHelper } from './autotrade-open-helper.service';

/**
 * Agent Autotrading — Phase 3.
 *
 * EOD backstop sweep. For each of today's market_predictions where
 * confidence >= CONVICTION_TRADE_THRESHOLD and role in ('analyst','arbitrator'),
 * if no open position exists for (portfolio_id, instrument_id, prediction_id),
 * open one with trigger_reason='eod_sweep'.
 *
 * Two roles served by this service:
 *   1. Backstop above-threshold predictions where in-pipeline
 *      ConvictionTraderService failed silently (autotrade try/catch
 *      swallowed an error).
 *   2. Cover above-threshold ARBITRATOR predictions, since
 *      eod-settlement.service.ts's existing createAnalystPositions
 *      filters role='analyst' and skips arbitrator entirely.
 *
 * Idempotent: re-running on the same day produces zero new rows because
 * every open or closed position already exists for the
 * (portfolio_id, instrument_id, prediction_id) tuple.
 *
 * Day-trader portfolios are intentionally not eligible (only kind='analyst'
 * for analyst predictions, and the hard-coded arbitrator portfolio for
 * arbitrator predictions).
 */
@Injectable()
export class EodForcedBuyService {
  private readonly logger = new Logger(EodForcedBuyService.name);

  // Hard-coded id from portfolio-foundation Phase 1 seeding (matches ConvictionTraderService).
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
   * Run the EOD backstop sweep. Called from eod-settlement.service.ts
   * at the start of EOD settlement, before the existing
   * createAnalystPositions step.
   *
   * @param manual whether this was a manual invocation (logged for audit)
   */
  async runSweep({ manual = false }: { manual?: boolean } = {}): Promise<{ rowsWritten: number; skipped: number; errors: string[] }> {
    const threshold = this.threshold();
    const errors: string[] = [];

    // Find today's eligible predictions. Filter by role + threshold + non-flat
    // direction. We do NOT filter by `not exists` here because we want to
    // count "skipped because already had a position" separately for logging.
    const result = await this.db.rawQuery(
      `select mp.id as prediction_id,
              mp.analyst_id,
              mp.organization_slug,
              mp.instrument_id,
              mp.predicted_direction,
              mp.confidence,
              mp.role,
              i.symbol,
              i.current_state
         from prediction.market_predictions mp
         join prediction.instruments i on i.id = mp.instrument_id
        where mp.created_at::date = current_date
          and mp.role in ('analyst','arbitrator')
          and mp.predicted_direction != 'flat'
          and mp.is_paper = false
          and mp.confidence >= $1`,
      [threshold],
    );
    const predictions = (result.data as Array<{
      prediction_id: string;
      analyst_id: string | null;
      organization_slug: string;
      instrument_id: string;
      predicted_direction: 'up' | 'down' | 'flat';
      confidence: number;
      role: string;
      symbol: string;
      current_state: Record<string, unknown> | null;
    }> | null) ?? [];

    if (predictions.length === 0) {
      this.logger.log(`EOD forced-buy: no eligible predictions today (threshold=${threshold}, manual=${manual})`);
      return { rowsWritten: 0, skipped: 0, errors };
    }

    let rowsWritten = 0;
    let skipped = 0;

    for (const pred of predictions) {
      try {
        // Resolve portfolio
        const portfolio = pred.role === 'arbitrator'
          ? await this.findArbitratorPortfolio()
          : await this.findAnalystPortfolio(pred.analyst_id, pred.organization_slug);

        if (!portfolio) {
          errors.push(`No portfolio for prediction ${pred.prediction_id} (role=${pred.role})`);
          continue;
        }

        // Resolve entry price from current_state
        const cs = pred.current_state ?? {};
        const entryPrice = Number((cs as Record<string, unknown>).price ?? (cs as Record<string, unknown>).last_price ?? 0);
        if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
          errors.push(`No price for instrument ${pred.instrument_id}`);
          continue;
        }

        // Sizing
        const positionPercent = await this.sizing.getPositionPercent(pred.confidence, portfolio.organization_slug);
        if (positionPercent <= 0) {
          skipped++;
          continue;
        }
        const quantity = this.sizing.calculatePositionSize(Number(portfolio.current_balance), entryPrice, positionPercent);
        if (quantity <= 0) {
          skipped++;
          continue;
        }

        const direction = pred.predicted_direction === 'down' ? 'short' : 'long';
        const result = await this.helper.openPosition({
          portfolio: {
            id: portfolio.id,
            analyst_id: portfolio.analyst_id,
            organization_slug: portfolio.organization_slug,
            current_balance: portfolio.current_balance,
          },
          instrumentId: pred.instrument_id,
          symbol: pred.symbol,
          direction,
          quantity,
          entryPrice,
          predictionId: pred.prediction_id,
          conviction: pred.confidence,
          triggerReason: 'eod_sweep',
          organizationSlug: portfolio.organization_slug,
        });
        if (result.reason === 'idempotent') {
          skipped++;
          continue;
        }
        if (result.reason !== 'inserted') {
          errors.push(`Insert failed for ${pred.prediction_id}: reason=${result.reason}`);
          continue;
        }

        rowsWritten++;
        this.logger.log(
          `EOD forced-buy: portfolio=${portfolio.id} symbol=${pred.symbol} qty=${quantity} entry=${entryPrice} conviction=${pred.confidence} role=${pred.role}`,
        );
      } catch (err) {
        errors.push(`Prediction ${pred.prediction_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(
      `EOD forced-buy sweep complete: rowsWritten=${rowsWritten} skipped=${skipped} errors=${errors.length} manual=${manual}`,
    );

    return { rowsWritten, skipped, errors };
  }

  // ─── internals ──────────────────────────────────────────────

  private async findAnalystPortfolio(
    analystId: string | null,
    organizationSlug: string,
  ): Promise<PortfolioRow | null> {
    if (!analystId) return null;
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
      [EodForcedBuyService.ARBITRATOR_PORTFOLIO_ID],
    );
    const rows = (result.data as PortfolioRow[] | null) ?? [];
    return rows[0] ?? null;
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
