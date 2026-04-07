/**
 * Unit tests for AutotradeOpenHelper.
 * Verifies the single-source-of-truth INSERT path used by both
 * ConvictionTraderService and EodForcedBuyService.
 */
import { AutotradeOpenHelper } from '../../src/markets/services/autotrade-open-helper.service';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall { sql: string; params: unknown[] }
class MockDb {
  public calls: MockCall[] = [];
  constructor(private readonly script: (sql: string, params: unknown[]) => { data?: unknown; error?: { message: string } | null }) {}
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    return this.script(sql, params);
  }
}

const portfolio = {
  id: 'pf-1',
  analyst_id: 'analyst-1',
  organization_slug: 'acme',
  current_balance: 1_000_000,
};

function baseInput(overrides: Partial<any> = {}) {
  return {
    portfolio,
    instrumentId: 'inst-1',
    symbol: 'NVDA',
    direction: 'long' as const,
    quantity: 100,
    entryPrice: 50,
    predictionId: 'pred-1',
    conviction: 80,
    triggerReason: 'signal_cross',
    organizationSlug: 'acme',
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log('\n=== AutotradeOpenHelper Tests ===\n');

  // 1. Happy-path insert
  console.log('Happy-path insert:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('select id from prediction.analyst_positions')) return { data: [], error: null };
      if (sql.startsWith('insert into prediction.analyst_positions')) return { data: [], error: null };
      return { data: [], error: null };
    });
    const helper = new AutotradeOpenHelper(db as any);
    const result = await helper.openPosition(baseInput());
    assert(result.reason === 'inserted', 'reason=inserted');
    assert(typeof result.positionId === 'string' && result.positionId!.length > 0, 'positionId returned');
    const insert = db.calls.find(c => c.sql.startsWith('insert into prediction.analyst_positions'))!;
    assert(insert !== undefined, 'INSERT issued');
    assert(insert.sql.includes('high_water_mark'), 'INSERT explicitly references high_water_mark column');
    assert(insert.sql.includes('NULL'), 'INSERT writes NULL for high_water_mark');
    assert(insert.params[1] === 'pf-1', 'portfolio_id from input');
    assert(insert.params[11] === 'signal_cross', 'trigger_reason passed through verbatim');
    assert(insert.params[7] === 'long', 'direction long');
  }

  // 2. Idempotency hit
  console.log('\nIdempotency hit:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('select id from prediction.analyst_positions')) {
        return { data: [{ id: 'existing-pos-id' }], error: null };
      }
      return { data: [], error: null };
    });
    const helper = new AutotradeOpenHelper(db as any);
    const result = await helper.openPosition(baseInput());
    assert(result.reason === 'idempotent', 'reason=idempotent');
    assert(result.positionId === 'existing-pos-id', 'returns existing id');
    const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
    assert(inserts.length === 0, 'no INSERT issued on idempotent hit');
  }

  // 3. Missing price
  console.log('\nMissing price:');
  {
    const db = new MockDb(() => ({ data: [], error: null }));
    const helper = new AutotradeOpenHelper(db as any);
    const result = await helper.openPosition(baseInput({ entryPrice: 0 }));
    assert(result.reason === 'no_price', 'reason=no_price for entryPrice<=0');
    assert(result.positionId === null, 'positionId=null on no_price');
    assert(db.calls.length === 0, 'no DB calls when price invalid');
  }

  // 4. Missing portfolio
  console.log('\nMissing portfolio:');
  {
    const db = new MockDb(() => ({ data: [], error: null }));
    const helper = new AutotradeOpenHelper(db as any);
    const result = await helper.openPosition(baseInput({ portfolio: { id: '' } as any }));
    assert(result.reason === 'no_portfolio', 'reason=no_portfolio when portfolio.id empty');
  }

  // 5. Direction mapping (short)
  console.log('\nDirection mapping (short):');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('select id from prediction.analyst_positions')) return { data: [], error: null };
      return { data: [], error: null };
    });
    const helper = new AutotradeOpenHelper(db as any);
    await helper.openPosition(baseInput({ direction: 'short' }));
    const insert = db.calls.find(c => c.sql.startsWith('insert into prediction.analyst_positions'))!;
    assert(insert.params[7] === 'short', 'direction short propagated');
  }

  // 6. trigger_reason verbatim (eod_sweep)
  console.log('\ntrigger_reason verbatim:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('select id from prediction.analyst_positions')) return { data: [], error: null };
      return { data: [], error: null };
    });
    const helper = new AutotradeOpenHelper(db as any);
    await helper.openPosition(baseInput({ triggerReason: 'eod_sweep' }));
    const insert = db.calls.find(c => c.sql.startsWith('insert into prediction.analyst_positions'))!;
    assert(insert.params[11] === 'eod_sweep', 'trigger_reason eod_sweep passes through');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
