/**
 * Phase 2 shape test for the stub adapters.
 *
 * Instantiates each of the seven stub adapter classes in replay mode against
 * the placeholder fixture committed in this phase, calls fetchData() with
 * a known param shape that maps to the placeholder scenario key, and asserts
 * the returned object satisfies the DataSourceResult shape.
 *
 * Phase 3 will overwrite the placeholder fixtures with real captures; this
 * test will continue to pass against the real-shape JSON.
 */

import { StubPolygonAdapter } from '../markets/integration/stubs/stub-polygon.adapter';
import { StubFmpAdapter } from '../markets/integration/stubs/stub-fmp.adapter';
import { StubTwelveDataAdapter } from '../markets/integration/stubs/stub-twelve-data.adapter';
import { StubFinnhubAdapter } from '../markets/integration/stubs/stub-finnhub.adapter';
import { StubFredAdapter } from '../markets/integration/stubs/stub-fred.adapter';
import { StubSecEdgarAdapter } from '../markets/integration/stubs/stub-sec-edgar.adapter';
import { StubRedditAdapter } from '../markets/integration/stubs/stub-reddit.adapter';
import { scenarioKeyFromParams } from '../markets/integration/stubs/stub-adapter-base';
import type { DataSourceAdapter } from '../../src/markets/adapters/data-source-adapter';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

async function checkAdapter(name: string, adapter: DataSourceAdapter): Promise<void> {
  console.log(`\n${name}:`);
  const result = await adapter.fetchData({ symbol: 'AAPL', dataTypes: ['snapshot'] });
  assert(typeof result.data === 'string' && result.data.length > 0, 'data is non-empty string');
  assert(typeof result.metadata === 'object' && result.metadata !== null, 'metadata is an object');
  assert(typeof result.metadata.source === 'string', 'metadata.source is a string');
  assert(typeof result.metadata.fetchedAt === 'string', 'metadata.fetchedAt is a string');
  assert(typeof result.metadata.cached === 'boolean', 'metadata.cached is a boolean');
  assert(Array.isArray(result.metadata.dataTypes), 'metadata.dataTypes is an array');
  // Identity props should match the real adapter
  assert(typeof adapter.id === 'string' && adapter.id.startsWith('ds-'), 'id starts with ds-');
  assert(typeof adapter.rateLimitPerMinute === 'number' && adapter.rateLimitPerMinute > 0, 'rateLimitPerMinute is positive');
}

async function main(): Promise<void> {
  // Sanity check the deterministic key function before exercising the adapters.
  console.log('scenarioKeyFromParams:');
  assert(
    scenarioKeyFromParams({ symbol: 'AAPL', dataTypes: ['snapshot'] }) === 'aapl__snapshot',
    "{symbol:'AAPL', dataTypes:['snapshot']} → 'aapl__snapshot'",
  );
  assert(
    scenarioKeyFromParams({ symbol: 'AAPL', dataTypes: ['news', 'snapshot'] })
      === scenarioKeyFromParams({ symbol: 'AAPL', dataTypes: ['snapshot', 'news'] }),
    'dataTypes order does not affect the key',
  );
  assert(
    scenarioKeyFromParams({ symbol: 'AAPL', dataTypes: ['snapshot'], from: '2026-01-01', to: '2026-01-31' })
      === 'aapl__snapshot__2026-01-01_2026-01-31',
    'date window is appended when present',
  );

  await checkAdapter('StubPolygonAdapter', new StubPolygonAdapter());
  await checkAdapter('StubFmpAdapter', new StubFmpAdapter());
  await checkAdapter('StubTwelveDataAdapter', new StubTwelveDataAdapter());
  await checkAdapter('StubFinnhubAdapter', new StubFinnhubAdapter());
  await checkAdapter('StubFredAdapter', new StubFredAdapter());
  await checkAdapter('StubSecEdgarAdapter', new StubSecEdgarAdapter());
  await checkAdapter('StubRedditAdapter', new StubRedditAdapter());

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
