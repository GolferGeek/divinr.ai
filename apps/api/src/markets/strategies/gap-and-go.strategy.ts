/**
 * GapAndGoStrategy — at the first 15-min tick after 14:30 UTC, opens long
 * on any instrument that gapped up ≥ 1% versus the prior bar's close AND
 * is currently printing a green bar. Exits on the first red 15-min bar.
 *
 * Uses state.daily_armed_date so the strategy fires at most once per
 * trading session.
 */
import type {
  Bar,
  DayTraderStrategy,
  DecideAction,
  DecideContext,
} from './day-trader-strategy.types';
import { convictionModifier } from './day-trader-strategy.types';

const GAP_PCT = 0.01;

function barOk(b: Bar | undefined | null): b is Bar {
  return (
    !!b &&
    typeof b.o === 'number' && Number.isFinite(b.o) && b.o > 0 &&
    typeof b.c === 'number' && Number.isFinite(b.c) && b.c > 0
  );
}

function utcDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export class GapAndGoStrategy implements DayTraderStrategy {
  decide(ctx: DecideContext): DecideAction {
    const { openPositions, recentBars, state, nowMs } = ctx;

    // 1. Exit: any open position whose instrument is printing a red bar.
    for (const pos of openPositions) {
      const bars = recentBars.get(pos.instrument_id);
      if (!bars || bars.length < 1) continue;
      const cur = bars[bars.length - 1];
      if (!barOk(cur)) continue;
      if (cur.c < cur.o) {
        return { action: 'close', positionId: pos.id, newState: state };
      }
    }

    const now = new Date(nowMs);
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

    // Only arms after 14:30 UTC (US open).
    if (utcMinutes < 14 * 60 + 30) {
      return { action: 'noop', newState: state };
    }

    // Once-per-session guard.
    const today = utcDate(nowMs);
    if (state.daily_armed_date === today) {
      return { action: 'noop', newState: state };
    }

    // 2. Entry scan.
    const held = new Set(openPositions.map(p => p.instrument_id));
    for (const [instrumentId, bars] of recentBars) {
      if (held.has(instrumentId)) continue;
      if (!bars || bars.length < 2) continue;
      const cur = bars[bars.length - 1];
      const prev = bars[bars.length - 2];
      if (!barOk(cur) || !barOk(prev)) continue;
      const gap = (cur.o - prev.c) / prev.c;
      if (gap < GAP_PCT) continue;
      if (!(cur.c >= cur.o)) continue; // green bar

      const signal = ctx.latestSignals.get(instrumentId) ?? null;
      const mult = convictionModifier(signal);
      if (mult === null) continue;

      return {
        action: 'open',
        instrumentId,
        direction: 'long',
        sizingMultiplier: mult,
        newState: { ...state, daily_armed_date: today },
      };
    }

    return { action: 'noop', newState: state };
  }
}
