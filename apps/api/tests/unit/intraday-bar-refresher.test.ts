/**
 * Unit tests for IntradayBarRefresherService — Phase 2 of
 * live-prediction-pnl. Verifies the refreshed/failed tally, the SQL
 * write shape, and per-instrument failure isolation.
 */
import { IntradayBarRefresherService } from '../../src/markets/services/intraday-bar-refresher.service';
import type { IntradayBar } from '../../src/markets/adapters/twelve-data.adapter';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

interface ScriptedQuery {
  sql: string;
  params: unknown[];
}

function makeBar(t: string, o: number): IntradayBar {
  return { t, o, h: o + 1, l: o - 1, c: o + 0.5, v: 1000 };
}

class MockDb {
  public calls: ScriptedQuery[] = [];
  public shouldError = false;

  async rawQuery(sql: string, params: unknown[]): Promise<{ data: unknown; error: { message: string } | null }> {
    this.calls.push({ sql, params });
    if (this.shouldError) return { data: null, error: { message: 'db boom' } };
    return { data: [], error: null };
  }
}

class MockAdapter {
  public calls: Array<{ symbol: string; intervalMinutes: number; limit: number }> = [];
  private programmed = new Map<string, IntradayBar[] | 'throw'>();

  program(symbol: string, result: IntradayBar[] | 'throw'): void {
    this.programmed.set(symbol, result);
  }

  async fetchIntradayBars(symbol: string, intervalMinutes: number, limit: number): Promise<IntradayBar[]> {
    this.calls.push({ symbol, intervalMinutes, limit });
    const r = this.programmed.get(symbol);
    if (r === 'throw') throw new Error('adapter boom');
    return r ?? [];
  }
}

async function main(): Promise<void> {
  console.log('IntradayBarRefresherService.refreshBarsFor');

  // 1. Mixed success/failure tally
  {
    const db = new MockDb();
    const polygon = new MockAdapter();
    const twelveData = new MockAdapter();
    polygon.program('AAPL', [makeBar('2026-04-17 13:00:00', 100), makeBar('2026-04-17 14:00:00', 101)]);
    polygon.program('MSFT', 'throw');
    polygon.program('NVDA', []); // empty result falls through to Twelve Data
    twelveData.program('NVDA', []); // empty fallback → counted as failed per PRD §5

    const svc = new IntradayBarRefresherService(db as any, polygon as any, twelveData as any);
    const result = await svc.refreshBarsFor([
      { id: 'i-aapl', symbol: 'AAPL' },
      { id: 'i-msft', symbol: 'MSFT' },
      { id: 'i-nvda', symbol: 'NVDA' },
    ]);

    assert(result.refreshed === 1, 'refreshed count = 1 (AAPL only)');
    assert(result.failed === 2, 'failed count = 2 (MSFT threw, NVDA empty)');
    assert(polygon.calls.length === 3, 'Polygon adapter called for every instrument');
    assert(polygon.calls[0].intervalMinutes === 60, 'Polygon adapter called with 60 min interval');
    assert(twelveData.calls.length === 1, 'Twelve Data fallback called only for empty Polygon bars');
    assert(db.calls.length === 1, 'db write only for successful symbol');
    assert(
      db.calls[0].sql.includes('prediction.instruments') && db.calls[0].sql.includes('intraday_bars'),
      'SQL targets prediction.instruments with intraday_bars key',
    );
    assert(db.calls[0].params[1] === 'i-aapl', 'instrument id passed as param $2');
    const bars = JSON.parse(db.calls[0].params[0] as string) as IntradayBar[];
    assert(bars.length === 2, 'wrote 2 bars for AAPL');
    assert(bars[0].t === '2026-04-17 13:00:00', 'oldest-first ordering preserved');
  }

  // 2. DB error marks the instrument as failed, does not abort the loop.
  {
    const db = new MockDb();
    db.shouldError = true;
    const polygon = new MockAdapter();
    const twelveData = new MockAdapter();
    polygon.program('AAPL', [makeBar('2026-04-17 13:00:00', 100)]);
    polygon.program('MSFT', [makeBar('2026-04-17 13:00:00', 200)]);
    const svc = new IntradayBarRefresherService(db as any, polygon as any, twelveData as any);
    const result = await svc.refreshBarsFor([
      { id: 'i-aapl', symbol: 'AAPL' },
      { id: 'i-msft', symbol: 'MSFT' },
    ]);
    assert(result.refreshed === 0, 'no successful writes when db errors');
    assert(result.failed === 2, 'both instruments counted as failed');
    assert(db.calls.length === 2, 'db write attempted for every instrument');
  }

  // 3. Refresher has explicit @Inject decorators on every param (per CLAUDE.md).
  {
    const source = await import('fs').then(m => m.readFileSync(
      require.resolve('../../src/markets/services/intraday-bar-refresher.service'),
      'utf8',
    ));
    assert(source.includes('@Inject(DATABASE_SERVICE)'), 'refresher uses @Inject(DATABASE_SERVICE)');
    assert(source.includes('@Inject(PolygonAdapter)'), 'refresher uses @Inject(PolygonAdapter)');
    assert(source.includes('@Inject(TwelveDataAdapter)'), 'refresher uses @Inject(TwelveDataAdapter)');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
