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
  user_id: null,
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
    assert(insert.params[10] === 'signal_cross', 'trigger_reason passed through verbatim');
    assert(insert.params[6] === 'long', 'direction long');
    const cashUpdate = db.calls.find(c => c.sql.includes('update prediction.analyst_portfolios'));
    assert(cashUpdate !== undefined, 'cash update issued');
    assert(Number(cashUpdate!.params[0]) === -5000, 'long open debits cash by qty * entry');
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
    assert(insert.params[6] === 'short', 'direction short propagated');
    const cashUpdate = db.calls.find(c => c.sql.includes('update prediction.analyst_portfolios'));
    assert(cashUpdate !== undefined, 'cash update issued for short');
    assert(Number(cashUpdate!.params[0]) === 5000, 'short open credits cash by qty * entry');
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
    assert(insert.params[10] === 'eod_sweep', 'trigger_reason eod_sweep passes through');
  }

  // 7. trigger_strategy write-through
  console.log('\ntrigger_strategy write-through:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('select id from prediction.analyst_positions')) return { data: [], error: null };
      return { data: [], error: null };
    });
    const helper = new AutotradeOpenHelper(db as any);
    await helper.openPosition(baseInput({ triggerStrategy: 'momentum_breakout' }));
    const insert = db.calls.find(c => c.sql.startsWith('insert into prediction.analyst_positions'))!;
    assert(insert.sql.includes('trigger_strategy'), 'INSERT references trigger_strategy column');
    assert(insert.params[11] === 'momentum_breakout', 'trigger_strategy passed through at param 11');
  }

  // 8. trigger_strategy defaults to null when not provided
  console.log('\ntrigger_strategy defaults to null:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('select id from prediction.analyst_positions')) return { data: [], error: null };
      return { data: [], error: null };
    });
    const helper = new AutotradeOpenHelper(db as any);
    await helper.openPosition(baseInput());
    const insert = db.calls.find(c => c.sql.startsWith('insert into prediction.analyst_positions'))!;
    assert(insert.params[11] === null, 'trigger_strategy is null when omitted (backward compatible)');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
