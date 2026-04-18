/**
 * Unit tests for MarketsBarsService.
 *
 * Covers the bulk intraday-bars read path:
 *  - cached fast path (no refresher call)
 *  - uncached + market open → refresher called for missing subset only
 *  - uncached + market closed → refresher NOT called
 *  - missing instruments (no row)
 *  - malformed intraday_bars shapes
 *  - dedupe + uppercase input
 */
import { MarketsBarsService } from '../../src/markets/services/markets-bars.service';
import type { IntradayBar } from '../../src/markets/adapters/twelve-data.adapter';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

function bar(t: string, o: number): IntradayBar {
  return { t, o, h: o + 1, l: o - 1, c: o + 0.5, v: 1000 };
}

interface InstrumentSeed {
  id: string;
  symbol: string;
  intraday_bars?: unknown;
}

class MockDb {
  public calls: Array<{ sql: string; params: unknown[] }> = [];
  public instruments: InstrumentSeed[] = [];

  async rawQuery(sql: string, params: unknown[] = []): Promise<{ data: unknown; error: { message: string } | null }> {
    this.calls.push({ sql, params });
    const symbols = (params[0] as string[]) ?? [];
    const rows = this.instruments
      .filter(i => symbols.includes(i.symbol))
      .map(i => ({
        id: i.id,
        symbol: i.symbol,
        current_state: i.intraday_bars === undefined
          ? null
          : { intraday_bars: i.intraday_bars },
      }));
    return { data: rows, error: null };
  }
}

class MockRefresher {
  public calls: Array<Array<{ id: string; symbol: string }>> = [];
  public onRefresh?: (inst: Array<{ id: string; symbol: string }>) => void;

  async refreshBarsFor(instruments: Array<{ id: string; symbol: string }>): Promise<{ refreshed: number; failed: number }> {
    this.calls.push(instruments.map(i => ({ id: i.id, symbol: i.symbol })));
    if (this.onRefresh) this.onRefresh(instruments);
    return { refreshed: instruments.length, failed: 0 };
  }
}

class MockMarketHours {
  constructor(public open: boolean) {}
  isUsEquityMarketOpen(): boolean { return this.open; }
}

function makeService(db: MockDb, refresher: MockRefresher, hours: MockMarketHours): MarketsBarsService {
  return new MarketsBarsService(db as any, refresher as any, hours as any);
}

async function main(): Promise<void> {
  console.log('\n=== MarketsBarsService.getIntradayBarsForSymbols ===\n');

  // 1. Cached path — all symbols have bars; refresher is never called.
  console.log('Cached path:');
  {
    const db = new MockDb();
    db.instruments = [
      { id: 'i-aapl', symbol: 'AAPL', intraday_bars: [bar('2026-04-17 13:00:00', 100)] },
      { id: 'i-msft', symbol: 'MSFT', intraday_bars: [bar('2026-04-17 13:00:00', 200), bar('2026-04-17 14:00:00', 202)] },
    ];
    const refresher = new MockRefresher();
    const svc = makeService(db, refresher, new MockMarketHours(true));
    const map = await svc.getIntradayBarsForSymbols(['AAPL', 'MSFT']);
    assert(map.get('AAPL')?.length === 1, 'AAPL returns 1 cached bar');
    assert(map.get('MSFT')?.length === 2, 'MSFT returns 2 cached bars');
    assert(refresher.calls.length === 0, 'refresher never called when all symbols cached');
    assert(db.calls.length === 1, 'single DB read when all cached');
  }

  // 2. Uncached + market open — refresher called with exact missing subset; re-read picks up bars.
  console.log('\nUncached + market open:');
  {
    const db = new MockDb();
    db.instruments = [
      { id: 'i-aapl', symbol: 'AAPL', intraday_bars: [bar('2026-04-17 13:00:00', 100)] },
      { id: 'i-msft', symbol: 'MSFT', intraday_bars: [] },
      { id: 'i-nvda', symbol: 'NVDA', intraday_bars: [] },
    ];
    const refresher = new MockRefresher();
    refresher.onRefresh = (insts) => {
      // Simulate refresher populating bars for each requested instrument.
      for (const inst of insts) {
        const seed = db.instruments.find(i => i.id === inst.id);
        if (seed) seed.intraday_bars = [bar('2026-04-17 15:00:00', 500)];
      }
    };
    const svc = makeService(db, refresher, new MockMarketHours(true));
    const map = await svc.getIntradayBarsForSymbols(['AAPL', 'MSFT', 'NVDA']);
    assert(refresher.calls.length === 1, 'refresher called once');
    const refreshedSymbols = refresher.calls[0].map(r => r.symbol).sort();
    assert(
      refreshedSymbols.length === 2 && refreshedSymbols[0] === 'MSFT' && refreshedSymbols[1] === 'NVDA',
      'refresher called with exact missing subset [MSFT, NVDA]',
    );
    assert(map.get('AAPL')?.length === 1, 'AAPL cached path untouched');
    assert(map.get('MSFT')?.length === 1, 'MSFT refreshed bars present');
    assert(map.get('NVDA')?.length === 1, 'NVDA refreshed bars present');
    assert(db.calls.length === 2, 'two DB reads total (initial + post-refresh)');
  }

  // 3. Uncached + market closed — refresher NOT called; empties returned.
  console.log('\nUncached + market closed:');
  {
    const db = new MockDb();
    db.instruments = [
      { id: 'i-aapl', symbol: 'AAPL', intraday_bars: [] },
    ];
    const refresher = new MockRefresher();
    const svc = makeService(db, refresher, new MockMarketHours(false));
    const map = await svc.getIntradayBarsForSymbols(['AAPL']);
    assert(refresher.calls.length === 0, 'refresher NOT called when market closed');
    assert(map.get('AAPL')?.length === 0, 'AAPL returns empty array when market closed and uncached');
    assert(db.calls.length === 1, 'single DB read when market closed');
  }

  // 4. Missing instrument row — symbol still present in map as empty array.
  console.log('\nMissing instrument:');
  {
    const db = new MockDb();
    // No instruments seeded — DB returns [].
    const refresher = new MockRefresher();
    const svc = makeService(db, refresher, new MockMarketHours(true));
    const map = await svc.getIntradayBarsForSymbols(['GHOST']);
    assert(map.has('GHOST'), 'ghost symbol present in map');
    assert(map.get('GHOST')?.length === 0, 'ghost symbol returns empty array');
    assert(refresher.calls.length === 0, 'refresher not called for unknown symbol (no instrument row to refresh)');
  }

  // 5. Malformed intraday_bars shapes.
  console.log('\nMalformed bars are treated as empty:');
  {
    const db = new MockDb();
    db.instruments = [
      { id: 'i-a', symbol: 'A', intraday_bars: null },
      { id: 'i-b', symbol: 'B', intraday_bars: 'not-an-array' },
      { id: 'i-c', symbol: 'C', intraday_bars: { not: 'an array' } },
      { id: 'i-d', symbol: 'D', intraday_bars: [{ t: 'ok', o: 1, h: 2, l: 0, c: 1.5, v: 100 }, null, { t: 'bad', o: 'NaN' }] },
    ];
    const refresher = new MockRefresher();
    // market closed so we don't get into refresh-on-empty
    const svc = makeService(db, refresher, new MockMarketHours(false));
    const map = await svc.getIntradayBarsForSymbols(['A', 'B', 'C', 'D']);
    assert(map.get('A')?.length === 0, 'null intraday_bars → empty');
    assert(map.get('B')?.length === 0, 'string intraday_bars → empty');
    assert(map.get('C')?.length === 0, 'object intraday_bars → empty');
    assert(map.get('D')?.length === 1, 'mixed-valid-invalid array keeps only well-formed bars');
  }

  // 6. Dedupe + uppercase.
  console.log('\nDedupe + uppercase:');
  {
    const db = new MockDb();
    db.instruments = [
      { id: 'i-aapl', symbol: 'AAPL', intraday_bars: [bar('2026-04-17 13:00:00', 100)] },
    ];
    const refresher = new MockRefresher();
    const svc = makeService(db, refresher, new MockMarketHours(true));
    const map = await svc.getIntradayBarsForSymbols(['aapl', 'AAPL', 'Aapl', ' AAPL ']);
    assert(map.size === 1, 'map has one entry');
    assert(map.has('AAPL'), 'entry keyed on uppercase AAPL');
    const paramSymbols = db.calls[0].params[0] as string[];
    assert(paramSymbols.length === 1 && paramSymbols[0] === 'AAPL', 'DB looked up AAPL once');
  }

  // 7. DI decorators on every constructor param.
  console.log('\nDI decorators:');
  {
    const src = await import('fs').then(m => m.readFileSync(
      require.resolve('../../src/markets/services/markets-bars.service'),
      'utf8',
    ));
    assert(src.includes('@Inject(DATABASE_SERVICE)'), '@Inject(DATABASE_SERVICE) present');
    assert(src.includes('@Inject(IntradayBarRefresherService)'), '@Inject(IntradayBarRefresherService) present');
    assert(src.includes('@Inject(MarketHoursService)'), '@Inject(MarketHoursService) present');
  }

  // 8. Refresher throws — service still returns cached state without crashing.
  console.log('\nRefresher throws is absorbed:');
  {
    const db = new MockDb();
    db.instruments = [{ id: 'i-aapl', symbol: 'AAPL', intraday_bars: [] }];
    const refresher = new MockRefresher();
    refresher.onRefresh = () => { throw new Error('refresher boom'); };
    const svc = makeService(db, refresher, new MockMarketHours(true));
    const map = await svc.getIntradayBarsForSymbols(['AAPL']);
    assert(map.get('AAPL')?.length === 0, 'AAPL returns empty array when refresher throws');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
