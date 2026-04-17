/**
 * Unit tests for TwelveDataAdapter.fetchIntradayBars — Phase 1 of
 * live-prediction-pnl. Verifies parse, empty/error fallbacks, missing
 * API key handling, and malformed-row skipping.
 */
import { TwelveDataAdapter } from '../../src/markets/adapters/twelve-data.adapter';

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
const originalKey = process.env.TWELVE_DATA_API_KEY;

function installFetch(handler: (url: string) => Promise<StubResponse> | StubResponse): void {
  (globalThis as any).fetch = (url: string) => Promise.resolve(handler(url));
}

function restoreFetch(): void {
  (globalThis as any).fetch = originalFetch;
}

async function main(): Promise<void> {
  console.log('TwelveDataAdapter.fetchIntradayBars');

  // 1. Happy path — parse values oldest-first
  {
    process.env.TWELVE_DATA_API_KEY = 'test-key';
    installFetch(() => stubOk({
      values: [
        { datetime: '2026-04-17 15:00:00', open: '101', high: '102', low: '100', close: '101.5', volume: '1000' },
        { datetime: '2026-04-17 14:00:00', open: '100', high: '101', low: '99.5', close: '100.5', volume: '900' },
        { datetime: '2026-04-17 13:00:00', open: '99', high: '100', low: '98.5', close: '99.5', volume: '800' },
      ],
    }));

    const adapter = new TwelveDataAdapter();
    const bars = await adapter.fetchIntradayBars('AAPL', 60, 3);
    assert(bars.length === 3, 'parses 3 bars');
    assert(bars[0].t === '2026-04-17 13:00:00', 'oldest-first: bars[0] is earliest datetime');
    assert(bars[2].t === '2026-04-17 15:00:00', 'oldest-first: bars[2] is latest datetime');
    assert(bars[0].o === 99 && bars[0].c === 99.5, 'numeric coercion on first bar');
    assert(bars[2].v === 1000, 'volume coerced to number');
    restoreFetch();
  }

  // 2. Error status from Twelve Data → []
  {
    process.env.TWELVE_DATA_API_KEY = 'test-key';
    installFetch(() => stubOk({ status: 'error', message: 'bad symbol' }));
    const adapter = new TwelveDataAdapter();
    const bars = await adapter.fetchIntradayBars('BAD', 60, 3);
    assert(bars.length === 0, 'status=error yields empty array');
    restoreFetch();
  }

  // 3. Missing API key → [], no fetch call
  {
    delete process.env.TWELVE_DATA_API_KEY;
    let fetchCalls = 0;
    installFetch(() => {
      fetchCalls++;
      return stubOk({ values: [] });
    });
    const adapter = new TwelveDataAdapter();
    const bars = await adapter.fetchIntradayBars('AAPL', 60, 3);
    assert(bars.length === 0, 'missing API key yields empty array');
    assert(fetchCalls === 0, 'missing API key skips fetch');
    restoreFetch();
  }

  // 4. Malformed row (non-numeric open) is skipped, good rows retained
  {
    process.env.TWELVE_DATA_API_KEY = 'test-key';
    installFetch(() => stubOk({
      values: [
        { datetime: '2026-04-17 15:00:00', open: 'not-a-number', high: '102', low: '100', close: '101.5', volume: '1000' },
        { datetime: '2026-04-17 14:00:00', open: '100', high: '101', low: '99.5', close: '100.5', volume: '900' },
      ],
    }));
    const adapter = new TwelveDataAdapter();
    const bars = await adapter.fetchIntradayBars('AAPL', 60, 2);
    assert(bars.length === 1, 'malformed row skipped, good row retained');
    assert(bars[0].t === '2026-04-17 14:00:00', 'retained row has correct datetime');
    restoreFetch();
  }

  // Restore env
  if (originalKey === undefined) delete process.env.TWELVE_DATA_API_KEY;
  else process.env.TWELVE_DATA_API_KEY = originalKey;

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
