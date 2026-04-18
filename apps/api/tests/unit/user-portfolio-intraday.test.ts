/**
 * Unit tests for UserPortfolioService.listPositions intraday enrichment.
 *
 * Covers the today_open + intraday_pct fields returned on each row:
 *  - market open + today bar → real percent
 *  - market open, no bars → nulls
 *  - market open, bars don't match today's ET date → nulls
 *  - market closed → nulls
 *  - closed position → nulls, symbol not fetched
 *  - today_open <= 0 → null pct
 *  - current_price missing/NaN → null pct
 *  - no open positions → bar fetch skipped
 */
import { UserPortfolioService } from '../../src/markets/services/user-portfolio.service';
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

function todayEtTimestamp(hour = 13): string {
  // Build a timestamp whose date portion matches today's ET date, so the
  // service's ET-date comparison in deriveTodayOpen matches.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const by = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${by('year')}-${by('month')}-${by('day')} ${String(hour).padStart(2, '0')}:00:00`;
}

function oldTimestamp(): string {
  return '2020-01-01 13:00:00';
}

type Row = Record<string, unknown>;

class MockDb {
  public calls: Array<{ sql: string; params: unknown[] }> = [];
  public rows: Row[] = [];
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    if (sql.includes('from prediction.user_positions')) {
      return { data: this.rows, error: null };
    }
    return { data: [], error: null };
  }
}

class MockBars {
  public calls: string[][] = [];
  public programmed = new Map<string, IntradayBar[]>();
  async getIntradayBarsForSymbols(symbols: string[]): Promise<Map<string, IntradayBar[]>> {
    this.calls.push([...symbols]);
    const map = new Map<string, IntradayBar[]>();
    for (const s of symbols) map.set(s, this.programmed.get(s) ?? []);
    return map;
  }
}

class MockMarketHours {
  constructor(public open: boolean) {}
  isUsEquityMarketOpen(): boolean { return this.open; }
}

const stubSchema = { ensureSchema: async () => {} } as any;
const stubSizing = {} as any;

function make(db: MockDb, bars: MockBars, hours: MockMarketHours): UserPortfolioService {
  return new UserPortfolioService(db as any, stubSchema, stubSizing, bars as any, hours as any);
}

async function main(): Promise<void> {
  console.log('\n=== UserPortfolioService.listPositions intraday enrichment ===\n');

  // 1. Market open + today bar present → computed pct.
  console.log('Market open + today bar present:');
  {
    const db = new MockDb();
    db.rows = [
      { id: 'p1', symbol: 'AAPL', status: 'open', current_price: 210 },
    ];
    const bars = new MockBars();
    bars.programmed.set('AAPL', [bar(todayEtTimestamp(10), 200), bar(todayEtTimestamp(14), 208)]);
    const svc = make(db, bars, new MockMarketHours(true));

    const rows = await svc.listPositions('user-1');
    assert(rows.length === 1, 'single row returned');
    assert(rows[0].today_open === 200, 'today_open = 200 from first-today-bar.o');
    assert(Math.abs((rows[0].intraday_pct as number) - (210 - 200) / 200) < 1e-9, 'intraday_pct = (210 - 200) / 200');
    assert(bars.calls.length === 1 && bars.calls[0][0] === 'AAPL', 'bars fetched once for AAPL');
  }

  // 2. Market open, no bars for the symbol → nulls.
  console.log('\nMarket open + no bars:');
  {
    const db = new MockDb();
    db.rows = [{ id: 'p1', symbol: 'NVDA', status: 'open', current_price: 500 }];
    const bars = new MockBars();
    // NVDA not programmed → empty array
    const svc = make(db, bars, new MockMarketHours(true));
    const rows = await svc.listPositions('user-1');
    assert(rows[0].today_open === null, 'today_open null when no bars');
    assert(rows[0].intraday_pct === null, 'intraday_pct null when no bars');
  }

  // 3. Market open, bars exist but none match today's ET date → nulls.
  console.log('\nMarket open + bars but none match today:');
  {
    const db = new MockDb();
    db.rows = [{ id: 'p1', symbol: 'MSFT', status: 'open', current_price: 400 }];
    const bars = new MockBars();
    bars.programmed.set('MSFT', [bar(oldTimestamp(), 390), bar(oldTimestamp(), 395)]);
    const svc = make(db, bars, new MockMarketHours(true));
    const rows = await svc.listPositions('user-1');
    assert(rows[0].today_open === null, 'today_open null when no bar matches today');
    assert(rows[0].intraday_pct === null, 'intraday_pct null when no bar matches today');
  }

  // 4. Market closed → nulls, bar service not consulted for enrichment logic.
  console.log('\nMarket closed:');
  {
    const db = new MockDb();
    db.rows = [{ id: 'p1', symbol: 'AAPL', status: 'open', current_price: 210 }];
    const bars = new MockBars();
    bars.programmed.set('AAPL', [bar(todayEtTimestamp(10), 200)]);
    const svc = make(db, bars, new MockMarketHours(false));
    const rows = await svc.listPositions('user-1');
    assert(rows[0].today_open === null, 'today_open null when market closed');
    assert(rows[0].intraday_pct === null, 'intraday_pct null when market closed');
  }

  // 5. Closed position → nulls, symbol not included in bar fetch.
  console.log('\nClosed position:');
  {
    const db = new MockDb();
    db.rows = [
      { id: 'p1', symbol: 'AAPL', status: 'open', current_price: 210 },
      { id: 'p2', symbol: 'TSLA', status: 'closed', current_price: 300 },
    ];
    const bars = new MockBars();
    bars.programmed.set('AAPL', [bar(todayEtTimestamp(10), 200)]);
    const svc = make(db, bars, new MockMarketHours(true));
    const rows = await svc.listPositions('user-1');
    const closed = rows.find(r => r.id === 'p2')!;
    assert(closed.today_open === null, 'closed row today_open null');
    assert(closed.intraday_pct === null, 'closed row intraday_pct null');
    assert(bars.calls[0].length === 1 && bars.calls[0][0] === 'AAPL', 'TSLA symbol not in bar fetch');
  }

  // 6. today_open <= 0 → null pct.
  console.log('\ntoday_open <= 0:');
  {
    const db = new MockDb();
    db.rows = [{ id: 'p1', symbol: 'ZZZ', status: 'open', current_price: 100 }];
    const bars = new MockBars();
    bars.programmed.set('ZZZ', [bar(todayEtTimestamp(10), 0)]);
    const svc = make(db, bars, new MockMarketHours(true));
    const rows = await svc.listPositions('user-1');
    assert(rows[0].today_open === 0, 'today_open preserved as 0');
    assert(rows[0].intraday_pct === null, 'intraday_pct null to avoid divide-by-zero');
  }

  // 7. current_price missing/NaN → null pct.
  console.log('\ncurrent_price missing/NaN:');
  {
    const db = new MockDb();
    db.rows = [{ id: 'p1', symbol: 'AAPL', status: 'open', current_price: null }];
    const bars = new MockBars();
    bars.programmed.set('AAPL', [bar(todayEtTimestamp(10), 200)]);
    const svc = make(db, bars, new MockMarketHours(true));
    const rows = await svc.listPositions('user-1');
    assert(rows[0].today_open === 200, 'today_open still derived');
    assert(rows[0].intraday_pct === null, 'intraday_pct null when current_price unusable');
  }

  // 8. No open positions → bar fetch skipped.
  console.log('\nNo open positions:');
  {
    const db = new MockDb();
    db.rows = [{ id: 'p1', symbol: 'TSLA', status: 'closed', current_price: 300 }];
    const bars = new MockBars();
    const svc = make(db, bars, new MockMarketHours(true));
    const rows = await svc.listPositions('user-1');
    assert(bars.calls.length === 0, 'bar service never called when no open rows');
    assert(rows[0].today_open === null, 'closed-only row today_open null');
    assert(rows[0].intraday_pct === null, 'closed-only row intraday_pct null');
  }

  // 9. Empty result set short-circuits.
  console.log('\nEmpty result set:');
  {
    const db = new MockDb();
    const bars = new MockBars();
    const svc = make(db, bars, new MockMarketHours(true));
    const rows = await svc.listPositions('user-1');
    assert(rows.length === 0, 'empty rows returned as-is');
    assert(bars.calls.length === 0, 'bar service not called on empty set');
  }

  // 10. DI decorators on all constructor params.
  console.log('\nDI decorators:');
  {
    const src = await import('fs').then(m => m.readFileSync(
      require.resolve('../../src/markets/services/user-portfolio.service'),
      'utf8',
    ));
    assert(src.includes('@Inject(MarketsBarsService)'), '@Inject(MarketsBarsService) present');
    assert(src.includes('@Inject(MarketHoursService)'), '@Inject(MarketHoursService) present');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
