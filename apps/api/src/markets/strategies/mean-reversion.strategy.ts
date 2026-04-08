/**
 * MeanReversionStrategy — buys when price is more than k stdevs below the
 * 20-bar SMA, exits when price reverts back to the mean. Sizing modulated
 * by conviction; vetoed if the latest signal is strongly "flat".
 */
import type {
  Bar,
  DayTraderStrategy,
  DecideAction,
  DecideContext,
} from './day-trader-strategy.types';
import { convictionModifier } from './day-trader-strategy.types';

const LOOKBACK = 20;
const K = 2.0;

function barOk(b: Bar | undefined | null): b is Bar {
  return !!b && typeof b.c === 'number' && Number.isFinite(b.c) && b.c > 0;
}

function smaStdev(closes: number[]): { sma: number; stdev: number } {
  const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
  const variance = closes.reduce((a, c) => a + (c - sma) * (c - sma), 0) / closes.length;
  return { sma, stdev: Math.sqrt(variance) };
}

export class MeanReversionStrategy implements DayTraderStrategy {
  decide(ctx: DecideContext): DecideAction {
    const { openPositions, recentBars, state } = ctx;

    // 1. Exit: price has reverted back to (or above) the mean.
    for (const pos of openPositions) {
      const bars = recentBars.get(pos.instrument_id);
      if (!bars || bars.length < LOOKBACK) continue;
      const window = bars.slice(bars.length - LOOKBACK);
      if (window.some(b => !barOk(b))) continue;
      const { sma } = smaStdev(window.map(b => b.c));
      const cur = bars[bars.length - 1];
      if (cur.c >= sma) {
        return { action: 'close', positionId: pos.id, newState: state };
      }
    }

    // 2. Entry: first instrument printing below sma − k×stdev.
    const held = new Set(openPositions.map(p => p.instrument_id));
    for (const [instrumentId, bars] of recentBars) {
      if (held.has(instrumentId)) continue;
      if (!bars || bars.length < LOOKBACK) continue;
      const window = bars.slice(bars.length - LOOKBACK);
      if (window.some(b => !barOk(b))) continue;
      const { sma, stdev } = smaStdev(window.map(b => b.c));
      const cur = bars[bars.length - 1];
      const threshold = sma - K * stdev;
      if (!(cur.c < threshold)) continue;

      const signal = ctx.latestSignals.get(instrumentId) ?? null;
      const mult = convictionModifier(signal);
      if (mult === null) continue;

      return {
        action: 'open',
        instrumentId,
        direction: 'long',
        sizingMultiplier: mult,
        newState: state,
      };
    }

    return { action: 'noop', newState: state };
  }
}
