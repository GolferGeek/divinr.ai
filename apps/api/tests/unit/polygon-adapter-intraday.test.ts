/**
 * Unit tests for PolygonAdapter.fetchIntradayBars. These keep the day-trader
 * feed on Polygon aggregates first, with empty fallbacks when credentials or
 * provider responses are unavailable.
 */
import { PolygonAdapter } from '../../src/markets/adapters/polygon.adapter';

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

interface StubResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function stubOk(body: unknown): StubResponse {
  return { ok: true, status: 200, json: async () => body };
}

const originalFetch = globalThis.fetch;
const originalKey = process.env.POLYGON_API_KEY;

function installFetch(handler: (url: string) => Promise<StubResponse> | StubResponse): void {
  (globalThis as any).fetch = (url: string | URL) => Promise.resolve(handler(url.toString()));
}

function restoreFetch(): void {
  (globalThis as any).fetch = originalFetch;
}

async function main(): Promise<void> {
  console.log('PolygonAdapter.fetchIntradayBars');

  // 1. Happy path — use aggregates endpoint and parse bars oldest-first.
  {
    process.env.POLYGON_API_KEY = 'test-key';
    let requestedUrl = '';
    installFetch((url) => {
      requestedUrl = url;
      return stubOk({
        status: 'OK',
        results: [
          { t: Date.parse('2026-04-17T13:00:00.000Z'), o: 99, h: 100, l: 98.5, c: 99.5, v: 800 },
          { t: Date.parse('2026-04-17T14:00:00.000Z'), o: 100, h: 101, l: 99.5, c: 100.5, v: 900 },
          { t: Date.parse('2026-04-17T15:00:00.000Z'), o: 101, h: 102, l: 100, c: 101.5, v: 1000 },
        ],
      });
    });

    const adapter = new PolygonAdapter();
    const bars = await adapter.fetchIntradayBars('aapl', 60, 2);
    assert(requestedUrl.includes('/v2/aggs/ticker/AAPL/range/1/hour/'), 'uses hourly Polygon aggregates for 60-minute bars');
    assert(requestedUrl.includes('adjusted=true'), 'requests adjusted bars');
    assert(bars.length === 2, 'limits parsed bars');
    assert(bars[0].t === '2026-04-17T14:00:00.000Z', 'keeps oldest-first ordering after limiting');
    assert(bars[1].c === 101.5 && bars[1].v === 1000, 'coerces price and volume numbers');
    restoreFetch();
  }

  // 2. Missing API key -> [], no network call.
  {
    delete process.env.POLYGON_API_KEY;
    let fetchCalls = 0;
    installFetch(() => {
      fetchCalls++;
      return stubOk({ status: 'OK', results: [] });
    });
    const adapter = new PolygonAdapter();
    const bars = await adapter.fetchIntradayBars('AAPL', 60, 3);
    assert(bars.length === 0, 'missing API key yields empty array');
    assert(fetchCalls === 0, 'missing API key skips fetch');
    restoreFetch();
  }

  // 3. Provider error -> [].
  {
    process.env.POLYGON_API_KEY = 'test-key';
    installFetch(() => stubOk({ status: 'ERROR', error: 'quota exceeded' }));
    const adapter = new PolygonAdapter();
    const bars = await adapter.fetchIntradayBars('AAPL', 60, 3);
    assert(bars.length === 0, 'status=ERROR yields empty array');
    restoreFetch();
  }

  // Restore env.
  if (originalKey === undefined) delete process.env.POLYGON_API_KEY;
  else process.env.POLYGON_API_KEY = originalKey;

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
