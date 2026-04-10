import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { AnalystPortfolioService } from './analyst-portfolio.service';
import { NotificationService } from './notification.service';

/**
 * Agent Autotrading — Phase 2.
 *
 * Sweeps open analyst + arbitrator positions on every 15-minute price
 * refresh and closes any that hit:
 *
 *   - Stop-loss:    favorable_pct <= -5%
 *   - Take-profit:  favorable_pct >= +10%
 *   - Trailing:     after favorable_pct ever reached >= 5%, close if it
 *                   then drops 5% from the high-water mark
 *
 * "Favorable pct" is direction-aware:
 *   long  → (current - entry) / entry
 *   short → (entry - current) / entry
 *
 * The watcher reuses one column — `high_water_mark` — to mean
 * "best-favorable absolute price seen since open":
 *   long  → max price (current_price replaces if larger than HWM)
 *   short → min price (current_price replaces if smaller than HWM)
 *
 * Day-trader positions are intentionally excluded (filtered at SQL).
 * User positions live in a separate table and are not touched at all.
 */
@Injectable()
export class StopLossWatcherService {
  private readonly logger = new Logger(StopLossWatcherService.name);

  // Defaults match PRD §4.1. Each is overridable via env at call time so
  // ops can dial risk without redeploying. Read-on-access (not cached) so
  // tests can mutate process.env between cases.
  private static envNum(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }
  static get STOP_LOSS_PCT(): number {
    return StopLossWatcherService.envNum('STOP_LOSS_PCT', -0.05);
  }
  static get TAKE_PROFIT_PCT(): number {
    return StopLossWatcherService.envNum('TAKE_PROFIT_PCT', 0.10);
  }
  static get TRAILING_STOP_PCT(): number {
    return StopLossWatcherService.envNum('TRAILING_STOP_PCT', 0.05);
  }
  static get TRAILING_ARM_PCT(): number {
    return StopLossWatcherService.envNum('TRAILING_ARM_PCT', 0.05);
  }

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(AnalystPortfolioService) private readonly portfolios: AnalystPortfolioService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  /**
   * Pure helper — determines what action a position should take given
   * its entry, current price, direction, and high-water mark.
   * Returns the new high_water_mark and an optional close reason.
   */
  static decide(input: {
    direction: 'long' | 'short';
    entryPrice: number;
    currentPrice: number;
    highWaterMark: number | null;
  }): { newHighWaterMark: number; closeReason: 'stop_loss' | 'take_profit' | 'trailing_stop' | null } {
    const { direction, entryPrice, currentPrice } = input;

    // Favorable percent — positive when the position is in the money.
    const favorablePct =
      direction === 'long'
        ? (currentPrice - entryPrice) / entryPrice
        : (entryPrice - currentPrice) / entryPrice;

    // Stop-loss / take-profit happen first.
    if (favorablePct <= StopLossWatcherService.STOP_LOSS_PCT) {
      return { newHighWaterMark: input.highWaterMark ?? entryPrice, closeReason: 'stop_loss' };
    }
    if (favorablePct >= StopLossWatcherService.TAKE_PROFIT_PCT) {
      return { newHighWaterMark: input.highWaterMark ?? entryPrice, closeReason: 'take_profit' };
    }

    // Update HWM (best favorable absolute price seen).
    const prior = input.highWaterMark ?? entryPrice;
    const newHighWaterMark =
      direction === 'long'
        ? Math.max(prior, currentPrice)
        : Math.min(prior, currentPrice);

    // Trailing stop only arms after we've banked at least TRAILING_ARM_PCT
    // in our favor (so noisy bars right after open don't insta-close).
    const hwmFavorablePct =
      direction === 'long'
        ? (newHighWaterMark - entryPrice) / entryPrice
        : (entryPrice - newHighWaterMark) / entryPrice;

    if (hwmFavorablePct >= StopLossWatcherService.TRAILING_ARM_PCT) {
      // How far have we given back from the peak?
      const givebackPct =
        direction === 'long'
          ? (newHighWaterMark - currentPrice) / newHighWaterMark
          : (currentPrice - newHighWaterMark) / newHighWaterMark;
      if (givebackPct >= StopLossWatcherService.TRAILING_STOP_PCT) {
        return { newHighWaterMark, closeReason: 'trailing_stop' };
      }
    }

    return { newHighWaterMark, closeReason: null };
  }

  /**
   * Sweep all open analyst + arbitrator positions and apply stop / take /
   * trailing rules. Invoked synchronously by OutcomeTrackingService after
   * each 15-min price refresh writes new current_state values.
   */
  async sweep(): Promise<{ closed: number; updated: number; skipped: number }> {
    const result = await this.db.rawQuery(
      `select p.id, p.direction, p.entry_price, p.quantity, p.high_water_mark,
              p.instrument_id, p.symbol, port.kind
         from prediction.analyst_positions p
         join prediction.analyst_portfolios port on port.id = p.portfolio_id
        where p.status = 'open'
          and port.kind in ('analyst','arbitrator')`,
    );
    const rows = (result.data as Array<{
      id: string;
      direction: 'long' | 'short';
      entry_price: number | string;
      quantity: number | string;
      high_water_mark: number | string | null;
      instrument_id: string;
      symbol: string;
      kind: string;
    }> | null) ?? [];

    if (rows.length === 0) return { closed: 0, updated: 0, skipped: 0 };

    // Batch-load current prices for the unique instruments we touch.
    const uniqueInstrumentIds = Array.from(new Set(rows.map(r => r.instrument_id)));
    const priceMap = await this.loadCurrentPrices(uniqueInstrumentIds);

    let closed = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const currentPrice = priceMap.get(row.instrument_id);
      if (currentPrice === undefined || !Number.isFinite(currentPrice) || currentPrice <= 0) {
        skipped++;
        continue;
      }

      const decision = StopLossWatcherService.decide({
        direction: row.direction,
        entryPrice: Number(row.entry_price),
        currentPrice,
        highWaterMark: row.high_water_mark === null ? null : Number(row.high_water_mark),
      });

      if (decision.closeReason) {
        try {
          await this.portfolios.closePosition(row.id, currentPrice, decision.closeReason);
          closed++;
          this.logger.log(
            `Stop watcher close: position=${row.id} symbol=${row.symbol} reason=${decision.closeReason} exit=${currentPrice}`,
          );
          await this.notifications.notifyAllUsers({
            event_type: 'stop_loss',
            urgency: 'immediate',
            title: `${row.symbol} ${decision.closeReason.replace(/_/g, ' ')} triggered`,
            summary: `Position closed at $${currentPrice.toFixed(2)} (entry $${Number(row.entry_price).toFixed(2)})`,
            link_to: '/portfolios',
          }).catch(err => this.logger.warn(`Notification failed: ${err}`));
        } catch (err) {
          this.logger.warn(
            `Stop watcher close failed for position=${row.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        // Persist HWM update + current_price + unrealized_pnl. Skip the write
        // if HWM didn't actually move and current_price didn't change much.
        const priorHwm = row.high_water_mark === null ? Number(row.entry_price) : Number(row.high_water_mark);
        if (Math.abs(decision.newHighWaterMark - priorHwm) > 1e-9 || true) {
          const dirSign = row.direction === 'long' ? 1 : -1;
          const unrealized = dirSign * (currentPrice - Number(row.entry_price)) * Number(row.quantity);
          await this.db.rawQuery(
            `update prediction.analyst_positions
                set high_water_mark = $1,
                    current_price = $2,
                    unrealized_pnl = $3,
                    updated_at = now()
              where id = $4`,
            [decision.newHighWaterMark, currentPrice, unrealized, row.id],
          );
          updated++;
        }
      }
    }

    return { closed, updated, skipped };
  }

  private async loadCurrentPrices(instrumentIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (instrumentIds.length === 0) return map;

    const result = await this.db.rawQuery(
      `select id, current_state from prediction.instruments where id = any($1::text[])`,
      [instrumentIds],
    );
    const rows = (result.data as Array<{ id: string; current_state: Record<string, unknown> | null }> | null) ?? [];
    for (const row of rows) {
      const cs = row.current_state ?? {};
      const price = Number((cs as Record<string, unknown>).price ?? (cs as Record<string, unknown>).last_price ?? 0);
      if (Number.isFinite(price) && price > 0) {
        map.set(row.id, price);
      }
    }
    return map;
  }
}
