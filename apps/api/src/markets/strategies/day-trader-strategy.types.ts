/**
 * Shared types for day-trader strategies. Phase 4 of
 * day-traders-and-leaderboard moved these out of day-trader-runner.service.ts
 * so individual strategy files can import them without pulling in the runner.
 */
import type { RecentBar } from '../services/outcome-tracking.service';

export type Bar = RecentBar;

export interface Signal {
  direction: 'up' | 'down' | 'flat';
  confidence: number;
}

export interface DayTraderPortfolioRow {
  id: string;
  analyst_id: string;
  organization_slug: string;
  current_balance: number | string;
  strategy_name: string | null;
  strategy_state: Record<string, unknown> | null;
}

export interface OpenPositionRow {
  id: string;
  instrument_id: string;
  direction: 'long' | 'short';
  quantity: number;
  entry_price: number;
}

export interface DecideContext {
  portfolio: DayTraderPortfolioRow;
  recentBars: Map<string, Bar[]>;
  latestSignals: Map<string, Signal | null>;
  openPositions: OpenPositionRow[];
  state: Record<string, unknown>;
  nowMs: number;
}

export type DecideAction =
  | { action: 'noop'; newState: Record<string, unknown> }
  | {
      action: 'open';
      instrumentId: string;
      direction: 'long' | 'short';
      sizingMultiplier: number;
      newState: Record<string, unknown>;
    }
  | {
      action: 'close';
      positionId: string;
      newState: Record<string, unknown>;
    };

export interface DayTraderStrategy {
  decide(ctx: DecideContext): DecideAction | Promise<DecideAction>;
}

/**
 * Shared conviction → sizing modifier and flat-veto helper used by all
 * three real strategies.
 *
 * Returns null if the signal vetoes the open (flat with strong confidence).
 * Otherwise returns a sizing multiplier in [0.5, 1.5]:
 *   - missing signal → 1.0
 *   - confidence 0..100 maps linearly to 0.5..1.5
 */
export function convictionModifier(signal: Signal | null | undefined): number | null {
  if (!signal) return 1;
  if (signal.direction === 'flat' && Math.abs(signal.confidence) > 70) return null;
  const c = Math.max(0, Math.min(100, signal.confidence));
  return 0.5 + (c / 100);
}
