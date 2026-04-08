/**
 * Phase 3 — one-time fixture capture script.
 *
 * Calls each stub adapter in capture mode against four scenario symbols
 * (AAPL=bullish, TSLA=bearish, NVDA=split, MSFT=partial-failure) with
 * representative dataTypes per provider. Each capture writes a real-shape
 * JSON fixture under apps/api/tests/fixtures/markets/[provider]/.
 *
 * This script is REMOVED at the end of Phase 5 — capture mode then lives
 * inside the integration runner itself.
 *
 * Run with:
 *   MARKETS_FIXTURE_CAPTURE=true pnpm --filter @divinr/api test:markets:capture
 */

import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import { StubPolygonAdapter } from './stubs/stub-polygon.adapter';
import { StubFmpAdapter } from './stubs/stub-fmp.adapter';
import { StubTwelveDataAdapter } from './stubs/stub-twelve-data.adapter';
import { StubFinnhubAdapter } from './stubs/stub-finnhub.adapter';
import { StubFredAdapter } from './stubs/stub-fred.adapter';
import { StubSecEdgarAdapter } from './stubs/stub-sec-edgar.adapter';
import { StubRedditAdapter } from './stubs/stub-reddit.adapter';
import type { DataSourceAdapter, DataSourceFetchParams } from '../../../src/markets/adapters/data-source-adapter';

// Load .env from the repo root so the real adapters see API keys
loadEnv({ path: join(__dirname, '..', '..', '..', '..', '..', '.env') });

if (process.env.MARKETS_FIXTURE_CAPTURE !== 'true') {
  console.error('ERROR: this script must be run with MARKETS_FIXTURE_CAPTURE=true');
  process.exit(1);
}

const SYMBOLS = ['AAPL', 'TSLA', 'NVDA', 'MSFT'];

interface CaptureSpec {
  name: string;
  adapter: () => DataSourceAdapter;
  dataTypes: string[];
}

const SPECS: CaptureSpec[] = [
  { name: 'polygon',     adapter: () => new StubPolygonAdapter(),    dataTypes: ['snapshot'] },
  { name: 'fmp',         adapter: () => new StubFmpAdapter(),        dataTypes: ['ratios', 'earnings'] },
  { name: 'twelve-data', adapter: () => new StubTwelveDataAdapter(), dataTypes: ['rsi', 'macd'] },
  { name: 'finnhub',     adapter: () => new StubFinnhubAdapter(),    dataTypes: ['recommendations', 'price-targets'] },
  { name: 'fred',        adapter: () => new StubFredAdapter(),       dataTypes: ['cpi', 'yield-curve'] },
  { name: 'sec-edgar',   adapter: () => new StubSecEdgarAdapter(),   dataTypes: ['filings'] },
  { name: 'reddit',      adapter: () => new StubRedditAdapter(),     dataTypes: ['sentiment'] },
];

async function main(): Promise<void> {
  let totalCalls = 0;
  let totalSuccess = 0;
  let totalEmpty = 0;
  let totalFailed = 0;

  for (const spec of SPECS) {
    console.log(`\n=== ${spec.name} ===`);
    const adapter = spec.adapter();
    for (const symbol of SYMBOLS) {
      totalCalls += 1;
      const params: DataSourceFetchParams = { symbol, dataTypes: spec.dataTypes };
      try {
        const result = await adapter.fetchData(params);
        if (result.data && result.data.length > 0) {
          totalSuccess += 1;
          console.log(`  ✓ ${symbol} → ${result.data.length} chars`);
        } else {
          totalEmpty += 1;
          console.log(`  ⚠ ${symbol} → EMPTY (still wrote fixture)`);
        }
      } catch (err) {
        totalFailed += 1;
        console.error(`  ✗ ${symbol} → ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(
    `\nCapture summary: ${totalCalls} calls, ${totalSuccess} populated, ${totalEmpty} empty, ${totalFailed} failed.`,
  );
  if (totalFailed > 0) {
    console.error('Some captures failed — re-run after diagnosing the providers above.');
    process.exit(1);
  }
  if (totalEmpty === totalCalls) {
    console.error('All captures returned empty data — likely a credential or rate-limit issue.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
