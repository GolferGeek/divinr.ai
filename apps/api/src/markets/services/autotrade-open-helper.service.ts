import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

/**
 * AutotradeOpenHelper — single source of truth for opening an
 * analyst_positions row from any autotrading code path.
 *
 * Extracted from ConvictionTraderService and EodForcedBuyService, which
 * had two byte-level-different copies of the same INSERT. This helper
 * also enforces the invariant that newly opened positions explicitly
 * write `high_water_mark = NULL` — that fix is the root cause of the
 * SHOP $0-P&L anomaly Phase 8.3 verifies is no longer reproducible.
 *
 * Idempotency: SELECT on (portfolio_id, instrument_id, prediction_id)
 * before INSERT. If a row exists, return its id with reason='idempotent'
 * (caller does not log as a fresh open).
 */

export interface AutotradeOpenPortfolio {
  id: string;
  analyst_id: string;
  organization_slug: string;
  current_balance: number | string;
}

export interface AutotradeOpenInput {
  db?: DatabaseService;
  portfolio: AutotradeOpenPortfolio;
  instrumentId: string;
  symbol: string;
  direction: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  predictionId: string | null;
  conviction: number;
  triggerReason: string;
  triggerStrategy?: string;
  organizationSlug: string;
}

export type AutotradeOpenReason =
  | 'inserted'
  | 'idempotent'
  | 'no_price'
  | 'no_portfolio';

export interface AutotradeOpenResult {
  positionId: string | null;
  reason: AutotradeOpenReason;
}

@Injectable()
export class AutotradeOpenHelper {
  private readonly logger = new Logger(AutotradeOpenHelper.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly defaultDb: DatabaseService,
  ) {}

  async openPosition(input: AutotradeOpenInput): Promise<AutotradeOpenResult> {
    const db = input.db ?? this.defaultDb;

    if (!input.portfolio || !input.portfolio.id) {
      return { positionId: null, reason: 'no_portfolio' };
    }
    if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) {
      return { positionId: null, reason: 'no_price' };
    }

    // Idempotency: (portfolio_id, instrument_id, prediction_id) is the
    // unique signal-cross key. If a row already exists, return it.
    // Strategy-driven opens have predictionId=null and skip the lookup —
    // each strategy tick is a fresh decision, not an idempotent retry.
    if (input.predictionId !== null) {
      const existing = await db.rawQuery(
        `select id from prediction.analyst_positions
          where portfolio_id = $1 and instrument_id = $2 and prediction_id = $3
          limit 1`,
        [input.portfolio.id, input.instrumentId, input.predictionId],
      );
      const existingRow = Array.isArray((existing as any).data)
        ? ((existing as any).data[0] as { id?: string } | undefined)
        : undefined;
      if (existingRow && existingRow.id) {
        return { positionId: existingRow.id, reason: 'idempotent' };
      }
    }

    const id = randomUUID();
    const insertResult = await db.rawQuery(
      `insert into prediction.analyst_positions
         (id, portfolio_id, analyst_id, organization_slug, prediction_id,
          instrument_id, symbol, direction, quantity,
          entry_price, current_price, is_paper_only, status, opened_at,
          trigger_reason, trigger_strategy, trigger_prediction_id, trigger_conviction,
          high_water_mark)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, 'open', now(),
               $12, $13, $14, $15, NULL)`,
      [
        id,
        input.portfolio.id,
        input.portfolio.analyst_id,
        input.portfolio.organization_slug,
        input.predictionId,
        input.instrumentId,
        input.symbol,
        input.direction,
        input.quantity,
        input.entryPrice,
        input.entryPrice,
        input.triggerReason,
        input.triggerStrategy ?? null,
        input.predictionId,
        input.conviction,
      ],
    );
    if ((insertResult as any).error) {
      this.logger.warn(
        `openPosition: insert failed for portfolio=${input.portfolio.id} prediction=${input.predictionId}: ${(insertResult as any).error.message}`,
      );
      return { positionId: null, reason: 'no_portfolio' };
    }

    return { positionId: id, reason: 'inserted' };
  }
}
