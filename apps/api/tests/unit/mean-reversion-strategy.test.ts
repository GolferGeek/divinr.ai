/**
 * Unit tests for MeanReversionStrategy.
 */
import { MeanReversionStrategy } from '../../src/markets/strategies/mean-reversion.strategy';
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
  id: 'pf', analyst_id: 'a', organization_slug: '__base__',
  current_balance: 1_000_000, strategy_name: 'mean_reversion', strategy_state: {},
};

function bar(c: number): Bar {
  return { t: '2026-04-07T00:00:00Z', o: c, h: c, l: c, c, v: 0 };
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

function main(): void {
  console.log('\n=== MeanReversionStrategy ===\n');
  const strat = new MeanReversionStrategy();

  // 19 bars at 100, 1 bar at ~80 (low) — but we need 20 bars window. Use mix.
  // Build 19 bars at 100, last bar at 50 → mean ~97.5, stdev ~10.9, threshold ~75.7
  console.log('Below threshold → open:');
  {
    const closes = [...Array(19).fill(100), 50];
    const bars = closes.map(bar);
    const r = strat.decide(ctx({ recentBars: new Map([['inst-1', bars]]) }));
    assert(r.action === 'open', 'opens long');
    if (r.action === 'open') {
      assert(r.direction === 'long', 'long');
      assert(r.sizingMultiplier === 1, 'no signal → 1');
    }
  }

  console.log('\nAbove threshold → noop:');
  {
    const bars = Array(20).fill(100).map(bar);
    const r = strat.decide(ctx({ recentBars: new Map([['inst-1', bars]]) }));
    assert(r.action === 'noop', 'noop at the mean');
  }

  console.log('\nInsufficient bars → noop:');
  {
    const r = strat.decide(ctx({ recentBars: new Map([['inst-1', [bar(50)]]]) }));
    assert(r.action === 'noop', 'noop when < 20 bars');
  }

  console.log('\nMalformed bar → noop:');
  {
    const bars: Bar[] = Array(19).fill(0).map(() => bar(100));
    bars.push({ t: '', o: 0, h: 0, l: 0, c: NaN, v: 0 });
    const r = strat.decide(ctx({ recentBars: new Map([['inst-1', bars]]) }));
    assert(r.action === 'noop', 'noop on NaN close');
  }

  console.log('\nFlat-veto:');
  {
    const bars = [...Array(19).fill(100), 50].map(bar);
    const sig: Signal = { direction: 'flat', confidence: 80 };
    const r = strat.decide(ctx({
      recentBars: new Map([['inst-1', bars]]),
      latestSignals: new Map([['inst-1', sig]]),
    }));
    assert(r.action === 'noop', 'flat-veto suppresses open');
  }

  console.log('\nConviction sizing:');
  {
    const bars = [...Array(19).fill(100), 50].map(bar);
    const sig: Signal = { direction: 'up', confidence: 100 };
    const r = strat.decide(ctx({
      recentBars: new Map([['inst-1', bars]]),
      latestSignals: new Map([['inst-1', sig]]),
    }));
    assert(r.action === 'open' && (r as any).sizingMultiplier === 1.5, 'multiplier 1.5');
  }

  console.log('\nMean revert close:');
  {
    // Open position; bars window has mean ~100, current = 100 → should close.
    const bars = Array(20).fill(100).map(bar);
    const r = strat.decide(ctx({
      recentBars: new Map([['inst-1', bars]]),
      openPositions: [{ id: 'p1', instrument_id: 'inst-1', direction: 'long', quantity: 5, entry_price: 50 }],
    }));
    assert(r.action === 'close', 'closes when price >= sma');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main();
