/**
 * Unit tests for AttributionAggregationService.
 * Verifies the 6-view refresh list, CONCURRENT → non-CONCURRENT fallback,
 * per-view failure isolation, cron gating, and return shape.
 */
import { AttributionAggregationService, ATTRIBUTION_VIEWS } from '../../src/attribution/attribution-aggregation.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall { sql: string }

type Script = (sql: string, callIndex: number) => { data?: unknown; error?: { message: string } | null } | Promise<never>;

class MockDb {
  public calls: MockCall[] = [];
  constructor(private readonly script: Script) {}
  async rawQuery(sql: string) {
    const idx = this.calls.length;
    this.calls.push({ sql });
    const result = this.script(sql, idx);
    return await result;
  }
}

function buildService(db: MockDb): AttributionAggregationService {
  return new (AttributionAggregationService as unknown as {
    new (db: MockDb): AttributionAggregationService;
  })(db);
}

function silence(svc: AttributionAggregationService): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).logger = { log: () => {}, warn: () => {}, error: () => {} };
}

async function main(): Promise<void> {
  console.log('\n=== Attribution Aggregation Service Tests ===\n');
  const ORIGINAL_ENV = { ...process.env };
  delete process.env.ATTRIBUTION_DISABLE_NIGHTLY_REFRESH;

  console.log('view list: contains all 6 expected views in prediction schema:');
  {
    assert(ATTRIBUTION_VIEWS.length === 6, 'exactly 6 views');
    assert(ATTRIBUTION_VIEWS.every((v) => v.startsWith('prediction.attribution_')), 'all in prediction schema');
    assert(ATTRIBUTION_VIEWS.includes('prediction.attribution_per_triple_monthly'), 'per-triple view present');
    assert(ATTRIBUTION_VIEWS.includes('prediction.attribution_per_analyst_monthly'), 'per-analyst view present');
    assert(ATTRIBUTION_VIEWS.includes('prediction.attribution_per_instrument_monthly'), 'per-instrument view present');
    assert(ATTRIBUTION_VIEWS.includes('prediction.attribution_per_source_monthly'), 'per-source view present');
    assert(ATTRIBUTION_VIEWS.includes('prediction.attribution_per_article_lifetime'), 'per-article view present');
    assert(ATTRIBUTION_VIEWS.includes('prediction.attribution_per_author_monthly'), 'per-author view present');
  }

  console.log('\nrefreshViews: issues exactly 6 CONCURRENT refreshes on happy path:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    silence(svc);
    const result = await svc.refreshViews();
    assert(result.refreshed === 6, 'refreshed=6');
    assert(result.failed.length === 0, 'no failures');
    assert(db.calls.length === 6, 'exactly 6 SQL calls');
    assert(db.calls.every((c) => c.sql.startsWith('REFRESH MATERIALIZED VIEW CONCURRENTLY')), 'all CONCURRENT');
  }

  console.log('\nrefreshViews: falls back to non-CONCURRENT when CONCURRENT throws:');
  {
    let concurrentCount = 0;
    let fallbackCount = 0;
    const db = new MockDb((sql) => {
      if (sql.includes('CONCURRENTLY')) {
        concurrentCount++;
        if (sql.includes('attribution_per_triple_monthly')) {
          // Throw synchronously to force fallback
          return Promise.reject(new Error('concurrent unsupported'));
        }
        return { data: [] };
      }
      fallbackCount++;
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    const result = await svc.refreshViews();
    assert(concurrentCount === 6, 'attempted CONCURRENT on all 6 views');
    assert(fallbackCount === 1, 'fallback issued exactly once');
    assert(result.refreshed === 6, 'all 6 counted as refreshed (fallback succeeded)');
    assert(result.failed.length === 0, 'no permanent failures');
  }

  console.log('\nrefreshViews: per-view failure recorded but does not throw:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('attribution_per_source_monthly')) {
        return Promise.reject(new Error('view broken'));
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    const result = await svc.refreshViews();
    assert(result.refreshed === 5, '5 views refreshed');
    assert(result.failed.length === 1, '1 failure recorded');
    assert(result.failed[0] === 'prediction.attribution_per_source_monthly', 'failed view name captured');
  }

  console.log('\nrefreshViews: falls back when CONCURRENT returns {error} (db adapter returns, not throws):');
  {
    let concurrentCount = 0;
    let fallbackCount = 0;
    const db = new MockDb((sql) => {
      if (sql.includes('CONCURRENTLY')) {
        concurrentCount++;
        // Simulate real DB adapter which returns {error} rather than rejecting.
        return { error: { message: 'cannot refresh CONCURRENTLY: not yet populated' } };
      }
      fallbackCount++;
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    const result = await svc.refreshViews();
    assert(concurrentCount === 6, 'attempted CONCURRENT on all 6 views');
    assert(fallbackCount === 6, 'fallback invoked for every view that returned error');
    assert(result.refreshed === 6, 'all counted as refreshed via fallback');
    assert(result.failed.length === 0, 'no permanent failures after successful fallback');
  }

  console.log('\nrefreshViews: captures failure when both CONCURRENT and non-CONCURRENT return {error}:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('attribution_per_source_monthly')) {
        // Both CONCURRENT and non-CONCURRENT branches return errors.
        return { error: { message: 'view corrupted' } };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    const result = await svc.refreshViews();
    assert(result.refreshed === 5, '5 views refreshed (via CONCURRENT success on others)');
    assert(result.failed.length === 1, '1 failure recorded');
    assert(result.failed[0] === 'prediction.attribution_per_source_monthly', 'failed view name captured');
  }

  console.log('\nrefreshViews: multiple failures isolated, method returns:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('attribution_per_source_monthly')) return Promise.reject(new Error('broken-1'));
      if (sql.includes('attribution_per_author_monthly')) return Promise.reject(new Error('broken-2'));
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    let threw = false;
    try {
      const result = await svc.refreshViews();
      assert(result.refreshed === 4, '4 views refreshed');
      assert(result.failed.length === 2, '2 failures recorded');
    } catch {
      threw = true;
    }
    assert(!threw, 'refreshViews never throws even on multiple failures');
  }

  console.log('\nhandleNightlyRefresh: skipped when env flag set:');
  {
    process.env.ATTRIBUTION_DISABLE_NIGHTLY_REFRESH = 'true';
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    silence(svc);
    await svc.handleNightlyRefresh();
    assert(db.calls.length === 0, 'no DB calls issued when flag is true');
    delete process.env.ATTRIBUTION_DISABLE_NIGHTLY_REFRESH;
  }

  console.log('\nhandleNightlyRefresh: runs refresh when env flag unset:');
  {
    delete process.env.ATTRIBUTION_DISABLE_NIGHTLY_REFRESH;
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    silence(svc);
    await svc.handleNightlyRefresh();
    assert(db.calls.length === 6, 'issued 6 refresh calls when flag unset');
  }

  console.log('\nhandleNightlyRefresh: runs refresh when env flag = "false":');
  {
    process.env.ATTRIBUTION_DISABLE_NIGHTLY_REFRESH = 'false';
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    silence(svc);
    await svc.handleNightlyRefresh();
    assert(db.calls.length === 6, 'issued 6 refresh calls when flag is "false"');
    delete process.env.ATTRIBUTION_DISABLE_NIGHTLY_REFRESH;
  }

  console.log('\nhandleNightlyRefresh: catches thrown error from refreshViews:');
  {
    // refreshViews itself doesn't throw, but if db.rawQuery throws synchronously
    // before the catch in refreshViews, handleNightlyRefresh's outer try/catch
    // must still suppress it.
    delete process.env.ATTRIBUTION_DISABLE_NIGHTLY_REFRESH;
    const db = new MockDb(() => { throw new Error('sync boom'); });
    const svc = buildService(db);
    silence(svc);
    let threw = false;
    try {
      await svc.handleNightlyRefresh();
    } catch {
      threw = true;
    }
    assert(!threw, 'handleNightlyRefresh never throws out to scheduler');
  }

  // Restore env
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }

  console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
