import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { AnalystPortfolioService } from './analyst-portfolio.service';
import { UserPortfolioService } from './user-portfolio.service';

const RESET_TARGET = 1_000_000;

/**
 * Monthly portfolio reset:
 * 1. Closes any open positions at last cached price
 * 2. Computes top-up needed to bring balance back to $1M
 * 3. Writes a bailout_ledger row (idempotent on (kind,id,reset_date))
 * 4. Resets current_balance to $1M
 *
 * Runs on the 1st of every month at 00:00 UTC.
 */
@Injectable()
export class MonthlyResetService {
  private readonly logger = new Logger(MonthlyResetService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    private readonly analystPortfolio: AnalystPortfolioService,
    private readonly userPortfolio: UserPortfolioService,
  ) {}

  @Cron('0 0 1 * *')
  async handleCron(): Promise<void> {
    if (process.env.MARKETS_DISABLE_MONTHLY_RESET === 'true') return;
    try {
      await this.runReset({ manual: false });
    } catch (err) {
      this.logger.error(`Monthly reset cron failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async runReset(_input: { manual: boolean }): Promise<{
    ledgerRowsWritten: number;
    alreadyResetCount: number;
    portfoliosProcessed: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let ledgerRowsWritten = 0;
    let alreadyResetCount = 0;
    let portfoliosProcessed = 0;

    // Build a price map from instruments.current_state — used to close any open positions.
    const priceMap = await this.buildPriceMap();

    // ── analyst portfolios (analyst | arbitrator | day_trader) ──
    const apRes = await this.db.rawQuery(`select id, current_balance from prediction.analyst_portfolios`);
    const analystPortfolios = (apRes.data as Array<{ id: string; current_balance: number }> | null) ?? [];
    for (const ap of analystPortfolios) {
      portfoliosProcessed++;
      try {
        // Close any open positions for this portfolio.
        const openRes = await this.db.rawQuery(
          `select id, instrument_id from prediction.analyst_positions where portfolio_id = $1 and status = 'open'`,
          [ap.id],
        );
        const openPositions = (openRes.data as Array<{ id: string; instrument_id: string }> | null) ?? [];
        for (const pos of openPositions) {
          const px = priceMap.get(pos.instrument_id);
          if (!px) continue;
          try {
            // Don't override trigger_reason — CHECK constraint won't accept 'monthly_reset'
            await this.analystPortfolio.closePosition(pos.id, px);
          } catch (err) {
            errors.push(`close analyst pos ${pos.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const written = await this.writeBailoutAndReset('analyst', ap.id);
        if (written) ledgerRowsWritten++;
        else alreadyResetCount++;
      } catch (err) {
        errors.push(`analyst portfolio ${ap.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── user portfolios ──
    const upRes = await this.db.rawQuery(`select id, user_id, current_balance from prediction.user_portfolios`);
    const userPortfolios = (upRes.data as Array<{ id: string; user_id: string; current_balance: number }> | null) ?? [];
    for (const up of userPortfolios) {
      portfoliosProcessed++;
      try {
        const openRes = await this.db.rawQuery(
          `select id from prediction.user_positions where portfolio_id = $1 and status = 'open'`,
          [up.id],
        );
        const openPositions = (openRes.data as Array<{ id: string }> | null) ?? [];
        for (const pos of openPositions) {
          try {
            await this.userPortfolio.closePosition({ userId: up.user_id, positionId: pos.id });
          } catch (err) {
            errors.push(`close user pos ${pos.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const written = await this.writeBailoutAndReset('user', up.id);
        if (written) ledgerRowsWritten++;
        else alreadyResetCount++;
      } catch (err) {
        errors.push(`user portfolio ${up.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(
      `Monthly reset complete: ${ledgerRowsWritten} ledger rows written, ${alreadyResetCount} already reset (idempotent skip)`,
    );
    return { ledgerRowsWritten, alreadyResetCount, portfoliosProcessed, errors };
  }

  private async buildPriceMap(): Promise<Map<string, number>> {
    const result = await this.db.rawQuery(
      `select id, current_state from prediction.instruments where is_active = true`,
    );
    const rows = (result.data as Array<{ id: string; current_state: Record<string, unknown> | null }> | null) ?? [];
    const map = new Map<string, number>();
    for (const r of rows) {
      const px = Number((r.current_state ?? {})['price'] ?? 0);
      if (Number.isFinite(px) && px > 0) map.set(r.id, px);
    }
    return map;
  }

  /**
   * Atomic-ish: read balance, INSERT ledger row (UNIQUE handles dup),
   * then bump balance back to $1M. If the INSERT was a no-op (already-reset
   * for today), do NOT touch the balance — return false.
   */
  private async writeBailoutAndReset(kind: 'analyst' | 'user', portfolioId: string): Promise<boolean> {
    // Read current balance fresh.
    const table = kind === 'analyst' ? 'analyst_portfolios' : 'user_portfolios';
    const balRes = await this.db.rawQuery(
      `select current_balance from prediction.${table} where id = $1`,
      [portfolioId],
    );
    const balRows = (balRes.data as Array<{ current_balance: number }> | null) ?? [];
    if (balRows.length === 0) return false;
    const balanceBefore = Number(balRows[0].current_balance);
    const topup = Math.max(0, RESET_TARGET - balanceBefore);

    // Cumulative bailouts for this portfolio (existing total + this one).
    const cumRes = await this.db.rawQuery(
      `select coalesce(sum(topup_amount), 0)::float8 as total
       from prediction.bailout_ledger where portfolio_kind = $1 and portfolio_id = $2`,
      [kind, portfolioId],
    );
    const existingCum = Number(((cumRes.data as Array<{ total: number }> | null) ?? [{ total: 0 }])[0].total);
    const cumulative = existingCum + topup;

    const insertRes = await this.db.rawQuery(
      `insert into prediction.bailout_ledger
        (id, portfolio_kind, portfolio_id, reset_date, balance_before, topup_amount, cumulative_bailouts, notes)
       values ($1, $2, $3, current_date, $4, $5, $6, $7)
       on conflict (portfolio_kind, portfolio_id, reset_date) do nothing
       returning id`,
      [randomUUID(), kind, portfolioId, balanceBefore, topup, cumulative, 'monthly_reset'],
    );
    const inserted = ((insertRes.data as Array<{ id: string }> | null) ?? []).length > 0;
    if (!inserted) return false;

    // Reset balance.
    await this.db.rawQuery(
      `update prediction.${table} set current_balance = $1, updated_at = now() where id = $2`,
      [RESET_TARGET, portfolioId],
    );
    return true;
  }
}
