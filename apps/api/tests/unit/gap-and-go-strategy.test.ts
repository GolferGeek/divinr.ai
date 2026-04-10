/**
 * Unit tests for GapAndGoStrategy.
 */
import { GapAndGoStrategy } from '../../src/markets/strategies/gap-and-go.strategy';
import type {
  Bar,
  DecideContext,
  DayTraderPortfolioRow,
} from '../../src/markets/strategies/day-trader-strategy.types';

let passed = 0;
let failed = 0;
function assert(c: boolean, label: string): void {
  if (c) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

const PORTFOLIO: DayTraderPortfolioRow = {
  id: 'pf', analyst_id: 'a',
  current_balance: 1_000_000, strategy_name: 'gap_and_go', strategy_state: {},
};

function bar(o: number, c: number): Bar {
  return { t: '2026-04-07T00:00:00Z', o, h: Math.max(o, c), l: Math.min(o, c), c, v: 0 };
}

function ctx(over: Partial<DecideContext>): DecideContext {
  return {
    portfolio: PORTFOLIO,
    recentBars: new Map(),
    latestSignals: new Map(),
    openPositions: [],
    state: {},
    nowMs: Date.UTC(2026, 3, 7, 14, 30, 0), // 14:30 UTC
    ...over,
  };
}

function main(): void {
  console.log('\n=== GapAndGoStrategy ===\n');
  const strat = new GapAndGoStrategy();

  // Pre-14:30 noop
  console.log('Pre-open noop:');
  {
    const bars: Bar[] = [bar(100, 100), bar(102, 103)]; // 2% gap, green
    const r = strat.decide(ctx({
      nowMs: Date.UTC(2026, 3, 7, 14, 0, 0),
      recentBars: new Map([['inst-1', bars]]),
    }));
    assert(r.action === 'noop', 'noop before 14:30 UTC');
  }

  // Gap up + green → open
  console.log('Gap up + green → open:');
  {
    const bars: Bar[] = [bar(100, 100), bar(102, 103)];
    const r = strat.decide(ctx({ recentBars: new Map([['inst-1', bars]]) }));
    assert(r.action === 'open', 'opens on gap');
    if (r.action === 'open') {
      assert(r.direction === 'long', 'long');
      assert((r.newState as any).daily_armed_date === '2026-04-07', 'armed date set');
    }
  }

  // Gap down → skip
  console.log('Gap down skip:');
  {
    const bars: Bar[] = [bar(100, 100), bar(98, 99)];
    const r = strat.decide(ctx({ recentBars: new Map([['inst-1', bars]]) }));
    assert(r.action === 'noop', 'noop on gap down');
  }

  // Already armed today → skip
  console.log('Already armed → skip:');
  {
    const bars: Bar[] = [bar(100, 100), bar(102, 103)];
    const r = strat.decide(ctx({
      recentBars: new Map([['inst-1', bars]]),
      state: { daily_armed_date: '2026-04-07' },
    }));
    assert(r.action === 'noop', 'noop when already armed today');
  }

  // Red bar → close open position
  console.log('Red bar close:');
  {
    const bars: Bar[] = [bar(100, 99)]; // red
    const r = strat.decide(ctx({
      recentBars: new Map([['inst-1', bars]]),
      openPositions: [{ id: 'p1', instrument_id: 'inst-1', direction: 'long', quantity: 5, entry_price: 100 }],
    }));
    assert(r.action === 'close', 'closes on red bar');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main();
