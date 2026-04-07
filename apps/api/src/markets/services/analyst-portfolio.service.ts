import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { PositionSizingService } from './position-sizing.service';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import type { AnalystPortfolio, AnalystPosition, PortfolioStatus } from '../markets.types';

/**
 * Manages analyst portfolios and positions.
 * Each analyst gets a portfolio per organization.
 * Positions are created automatically from predictions at EOD settlement.
 */
@Injectable()
export class AnalystPortfolioService {
  private readonly logger = new Logger(AnalystPortfolioService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
    @Inject(PositionSizingService) private readonly sizing: PositionSizingService,
  ) {}

  async ensurePortfolio(analystId: string, organizationSlug: string, initialBalance = 1000000): Promise<AnalystPortfolio> {
    await this.schema.ensureSchema();

    // Check if portfolio exists
    const existing = await this.db.rawQuery(
      `select * from prediction.analyst_portfolios where analyst_id = $1 and organization_slug = $2`,
      [analystId, organizationSlug],
    );
    const rows = (existing.data as AnalystPortfolio[] | null) ?? [];
    if (rows.length > 0) return rows[0];

    // Create new portfolio
    const id = randomUUID();
    const result = await this.db.rawQuery(
      `insert into prediction.analyst_portfolios
        (id, analyst_id, organization_slug, initial_balance, current_balance)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [id, analystId, organizationSlug, initialBalance, initialBalance],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as AnalystPortfolio[] | null) ?? [])[0]!;
  }

  async createPositionFromPrediction(input: {
    analystId: string;
    organizationSlug: string;
    predictionId: string;
    instrumentId: string;
    symbol: string;
    direction: 'up' | 'down';
    confidence: number;
    entryPrice: number;
    isPaperOnly?: boolean;
  }): Promise<AnalystPosition | null> {
    const portfolio = await this.ensurePortfolio(input.analystId, input.organizationSlug);

    // Check portfolio status
    if (portfolio.status === 'suspended' && !input.isPaperOnly) {
      input.isPaperOnly = true;
    }

    // Calculate position size
    const positionPercent = await this.sizing.getPositionPercent(input.confidence, input.organizationSlug);
    if (positionPercent <= 0) return null; // Below min confidence

    const quantity = this.sizing.calculatePositionSize(portfolio.current_balance, input.entryPrice, positionPercent);
    if (quantity <= 0) return null;

    const posDirection = input.direction === 'up' ? 'long' : 'short';
    const id = randomUUID();

    const result = await this.db.rawQuery(
      `insert into prediction.analyst_positions
        (id, portfolio_id, analyst_id, organization_slug, prediction_id, instrument_id, symbol,
         direction, quantity, entry_price, current_price, is_paper_only, status, opened_at,
         trigger_reason, trigger_prediction_id, trigger_conviction)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'open', now(),
               'eod_backfill', $5, $13)
       returning *`,
      [
        id, portfolio.id, input.analystId, input.organizationSlug,
        input.predictionId, input.instrumentId, input.symbol,
        posDirection, quantity, input.entryPrice, input.entryPrice,
        input.isPaperOnly ?? false, input.confidence,
      ],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as AnalystPosition[] | null) ?? [])[0] ?? null;
  }

  async closePosition(
    positionId: string,
    exitPrice: number,
    triggerReason?: string,
    triggerStrategy?: string,
  ): Promise<{ realizedPnl: number; isWin: boolean }> {
    // Load position
    const posResult = await this.db.rawQuery(
      `select * from prediction.analyst_positions where id = $1 and status = 'open'`,
      [positionId],
    );
    const positions = (posResult.data as AnalystPosition[] | null) ?? [];
    if (positions.length === 0) throw new Error('Position not found or already closed');
    const pos = positions[0];

    const realizedPnl = this.sizing.calculatePnl(pos.direction, pos.entry_price, exitPrice, pos.quantity);
    const isWin = realizedPnl > 0;

    // Close position. Optionally overwrite trigger_reason to record the
    // lifecycle exit reason (stop_loss / take_profit / trailing_stop /
    // eod_sweep). Existing callers that don't pass triggerReason leave the
    // open-time reason intact.
    if (triggerReason) {
      await this.db.rawQuery(
        `update prediction.analyst_positions
         set status = 'closed', exit_price = $1, realized_pnl = $2,
             current_price = $3, unrealized_pnl = 0,
             trigger_reason = $5,
             trigger_strategy = coalesce($6, trigger_strategy),
             closed_at = now(), updated_at = now()
         where id = $4`,
        [exitPrice, realizedPnl, exitPrice, positionId, triggerReason, triggerStrategy ?? null],
      );
    } else {
      await this.db.rawQuery(
        `update prediction.analyst_positions
         set status = 'closed', exit_price = $1, realized_pnl = $2,
             current_price = $3, unrealized_pnl = 0,
             trigger_strategy = coalesce($5, trigger_strategy),
             closed_at = now(), updated_at = now()
         where id = $4`,
        [exitPrice, realizedPnl, exitPrice, positionId, triggerStrategy ?? null],
      );
    }

    // Update portfolio balance
    if (!pos.is_paper_only) {
      const winInc = isWin ? 1 : 0;
      const lossInc = isWin ? 0 : 1;
      await this.db.rawQuery(
        `update prediction.analyst_portfolios
         set current_balance = current_balance + $1,
             total_realized_pnl = total_realized_pnl + $2,
             win_count = win_count + $3,
             loss_count = loss_count + $4,
             updated_at = now()
         where id = $5`,
        [realizedPnl, realizedPnl, winInc, lossInc, pos.portfolio_id],
      );

      // Check and update status
      await this.checkAndUpdateStatus(pos.portfolio_id);
    }

    return { realizedPnl, isWin };
  }

  async updateUnrealizedPnl(instrumentId: string, currentPrice: number): Promise<number> {
    const positions = await this.db.rawQuery(
      `select id, direction, entry_price, quantity from prediction.analyst_positions
       where instrument_id = $1 and status = 'open'`,
      [instrumentId],
    );
    const rows = (positions.data as AnalystPosition[] | null) ?? [];
    let updated = 0;

    for (const pos of rows) {
      const pnl = this.sizing.calculatePnl(pos.direction, pos.entry_price, currentPrice, pos.quantity);
      await this.db.rawQuery(
        `update prediction.analyst_positions
         set current_price = $1, unrealized_pnl = $2, updated_at = now()
         where id = $3`,
        [currentPrice, pnl, pos.id],
      );
      updated++;
    }
    return updated;
  }

  async getPortfolio(analystId: string, organizationSlug: string): Promise<AnalystPortfolio | null> {
    const result = await this.db.rawQuery(
      `select * from prediction.analyst_portfolios where analyst_id = $1 and organization_slug = $2`,
      [analystId, organizationSlug],
    );
    return ((result.data as AnalystPortfolio[] | null) ?? [])[0] ?? null;
  }

  async listPortfolios(organizationSlug: string): Promise<AnalystPortfolio[]> {
    const result = await this.db.rawQuery(
      `select ap.*, ma.display_name as analyst_name
       from prediction.analyst_portfolios ap
       join prediction.market_analysts ma on ma.id = ap.analyst_id
       where (ap.organization_slug = $1 or ap.organization_slug = '__base__' or ap.organization_slug = '*')
       order by ap.current_balance desc`,
      [organizationSlug],
    );
    return (result.data as AnalystPortfolio[] | null) ?? [];
  }

  async listPositions(analystId: string, organizationSlug: string, status?: string): Promise<AnalystPosition[]> {
    let query = `select * from prediction.analyst_positions where analyst_id = $1 and organization_slug = $2`;
    const params: unknown[] = [analystId, organizationSlug];
    if (status) {
      query += ` and status = $3`;
      params.push(status);
    }
    query += ' order by opened_at desc';
    const result = await this.db.rawQuery(query, params);
    return (result.data as AnalystPosition[] | null) ?? [];
  }

  async getLeaderboard(organizationSlug: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.db.rawQuery(
      `select ap.*, ma.display_name as analyst_name, ma.default_weight,
              case when ap.win_count + ap.loss_count > 0
                then round(ap.win_count::numeric / (ap.win_count + ap.loss_count) * 100, 1)
                else 0 end as win_rate,
              round((ap.current_balance - ap.initial_balance) / ap.initial_balance * 100, 2) as pnl_percent
       from prediction.analyst_portfolios ap
       join prediction.market_analysts ma on ma.id = ap.analyst_id
       where (ap.organization_slug = $1 or ap.organization_slug = '__base__' or ap.organization_slug = '*')
       order by ap.current_balance desc`,
      [organizationSlug],
    );
    return (result.data as Record<string, unknown>[] | null) ?? [];
  }

  private async checkAndUpdateStatus(portfolioId: string): Promise<void> {
    const result = await this.db.rawQuery(
      `select * from prediction.analyst_portfolios where id = $1`,
      [portfolioId],
    );
    const portfolio = ((result.data as AnalystPortfolio[] | null) ?? [])[0];
    if (!portfolio) return;

    const newStatus = this.sizing.determinePortfolioStatus(portfolio.current_balance, portfolio.initial_balance);
    if (newStatus !== portfolio.status) {
      await this.db.rawQuery(
        `update prediction.analyst_portfolios
         set status = $1, status_changed_at = now(), updated_at = now()
         where id = $2`,
        [newStatus, portfolioId],
      );
      this.logger.log(`Analyst portfolio ${portfolioId} status: ${portfolio.status} → ${newStatus}`);
    }
  }
}
