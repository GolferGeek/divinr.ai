/**
 * Unit tests for MomentumBreakoutStrategy.
 */
import { MomentumBreakoutStrategy } from '../../src/markets/strategies/momentum-breakout.strategy';
import type {
  Bar,
  DecideContext,
  DayTraderPortfolioRow,
  Signal,
} from '../../src/markets/strategies/day-trader-strategy.types';

let passed = 0;
let failed = 0;
function assert(c: boolean, label: string): void {
  if (c) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

const PORTFOLIO: DayTraderPortfolioRow = {
  id: 'pf', analyst_id: 'a',
  current_balance: 1_000_000, strategy_name: 'momentum_breakout', strategy_state: {},
};

function bar(c: number, h = c, l = c, o = c): Bar {
  return { t: '2026-04-07T00:00:00Z', o, h, l, c, v: 0 };
}

function ctx(over: Partial<DecideContext>): DecideContext {
  return {
    portfolio: PORTFOLIO,
    recentBars: new Map(),
    latestSignals: new Map(),
    openPositions: [],
    state: {},
    nowMs: Date.UTC(2026, 3, 7, 15, 0, 0),
    ...over,
  };
}

function flatBars(n: number, value: number): Bar[] {
  return Array.from({ length: n }, () => bar(value));
}

function main(): void {
  console.log('\n=== MomentumBreakoutStrategy ===\n');
  const strat = new MomentumBreakoutStrategy();

  // Happy-path breakout: 20 prior bars at 100, current at 110
  console.log('Breakout open:');
  {
    const bars = [...flatBars(20, 100), bar(110, 110)];
    const r = strat.decide(ctx({ recentBars: new Map([['inst-1', bars]]) }));
    assert(r.action === 'open', 'opens on breakout');
    if (r.action === 'open') {
      assert(r.instrumentId === 'inst-1', 'correct instrument');
      assert(r.direction === 'long', 'long');
      assert(r.sizingMultiplier === 1, 'no signal → multiplier 1');
    }
  }

  // No breakout
  console.log('\nNo breakout → noop:');
  {
    const bars = [...flatBars(20, 100), bar(99, 99)];
    const r = strat.decide(ctx({ recentBars: new Map([['inst-1', bars]]) }));
    assert(r.action === 'noop', 'noop when no breakout');
  }

  // Insufficient bars
  console.log('\nInsufficient bars → noop:');
  {
    const r = strat.decide(ctx({ recentBars: new Map([['inst-1', flatBars(5, 100)]]) }));
    assert(r.action === 'noop', 'noop when < 21 bars');
  }

  // NaN/missing bar
  console.log('\nMalformed bar → noop:');
  {
    const bad: Bar[] = [...flatBars(20, 100), { t: '', o: NaN, h: NaN, l: NaN, c: NaN, v: 0 }];
    const r = strat.decide(ctx({ recentBars: new Map([['inst-1', bad]]) }));
    assert(r.action === 'noop', 'noop when current bar is NaN');
  }

  // Conviction sizing modifier
  console.log('\nConviction sizing modifier:');
  {
    const bars = [...flatBars(20, 100), bar(110, 110)];
    const sig: Signal = { direction: 'up', confidence: 100 };
    const r = strat.decide(ctx({
      recentBars: new Map([['inst-1', bars]]),
      latestSignals: new Map([['inst-1', sig]]),
    }));
    assert(r.action === 'open', 'opens with high-conviction up signal');
    if (r.action === 'open') {
      assert(Math.abs(r.sizingMultiplier - 1.5) < 1e-9, 'multiplier=1.5 at confidence 100');
    }
  }

  // Flat-veto
  console.log('\nFlat-veto:');
  {
    const bars = [...flatBars(20, 100), bar(110, 110)];
    const sig: Signal = { direction: 'flat', confidence: 80 };
    const r = strat.decide(ctx({
      recentBars: new Map([['inst-1', bars]]),
      latestSignals: new Map([['inst-1', sig]]),
    }));
    assert(r.action === 'noop', 'flat-veto suppresses open');
  }

  // Lower-high exit
  console.log('\nLower-high close:');
  {
    const bars = [bar(100, 110), bar(101, 105)];
    const r = strat.decide(ctx({
      recentBars: new Map([['inst-1', bars]]),
      openPositions: [{ id: 'p1', instrument_id: 'inst-1', direction: 'long', quantity: 10, entry_price: 100 }],
    }));
    assert(r.action === 'close', 'closes on lower high');
    if (r.action === 'close') assert(r.positionId === 'p1', 'correct position');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main();
