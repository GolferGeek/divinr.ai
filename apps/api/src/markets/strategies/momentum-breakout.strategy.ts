/**
 * MomentumBreakoutStrategy — buys on a 20-bar high breakout, exits on the
 * first lower high. Sizing modulated by conviction; vetoed if the latest
 * signal is strongly "flat".
 */
import type {
  Bar,
  DayTraderStrategy,
  DecideAction,
  DecideContext,
} from './day-trader-strategy.types';
import { convictionModifier } from './day-trader-strategy.types';

const LOOKBACK = 20;

function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function barOk(b: Bar | undefined | null): b is Bar {
  return !!b && isFinitePositive(b.h) && isFinitePositive(b.l) && isFinitePositive(b.c);
}

export class MomentumBreakoutStrategy implements DayTraderStrategy {
  decide(ctx: DecideContext): DecideAction {
    const { openPositions, recentBars, state } = ctx;

    // 1. Exit check: any open position whose instrument has printed a lower high.
    for (const pos of openPositions) {
      const bars = recentBars.get(pos.instrument_id);
      if (!bars || bars.length < 2) continue;
      const cur = bars[bars.length - 1];
      const prev = bars[bars.length - 2];
      if (!barOk(cur) || !barOk(prev)) continue;
      if (cur.h < prev.h) {
        return { action: 'close', positionId: pos.id, newState: state };
      }
    }

    // 2. Entry scan — first instrument with a fresh N-bar high breakout.
    const heldInstruments = new Set(openPositions.map(p => p.instrument_id));
    for (const [instrumentId, bars] of recentBars) {
      if (heldInstruments.has(instrumentId)) continue;
      if (!bars || bars.length < LOOKBACK + 1) continue;
      const cur = bars[bars.length - 1];
      if (!barOk(cur)) continue;
      const window = bars.slice(bars.length - 1 - LOOKBACK, bars.length - 1);
      if (window.some(b => !barOk(b))) continue;
      const priorHigh = Math.max(...window.map(b => b.h));
      if (!(cur.c > priorHigh)) continue;

      const signal = ctx.latestSignals.get(instrumentId) ?? null;
      const mult = convictionModifier(signal);
      if (mult === null) continue; // flat-veto

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
