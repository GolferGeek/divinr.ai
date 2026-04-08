/**
 * Unit tests for ConvictionTraderService (Agent Autotrading — Phase 1).
 *
 * No real DB. We script the DatabaseService.rawQuery responses based on
 * the SQL substring being executed and capture the INSERT calls so we
 * can assert on the parameters that would have been written.
 */
import { ConvictionTraderService } from '../../src/markets/services/conviction-trader.service';
import { AutotradeOpenHelper } from '../../src/markets/services/autotrade-open-helper.service';

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

interface ScriptedResponse {
  data?: unknown;
  error?: { message: string } | null;
}

interface MockDbCall {
  sql: string;
  params: unknown[];
}

class MockDb {
  public calls: MockDbCall[] = [];
  constructor(private readonly script: (sql: string, params: unknown[]) => ScriptedResponse) {}
  async rawQuery(sql: string, params: unknown[] = []): Promise<ScriptedResponse> {
    this.calls.push({ sql, params });
    return this.script(sql, params);
  }
}

const stubSizing = {
  getPositionPercent: async (_conf: number, _org: string) => 0.1,
  calculatePositionSize: (_balance: number, entryPrice: number, percent: number) =>
    Math.max(1, Math.floor((1_000_000 * percent) / entryPrice)),
} as any;

function makeOutcome(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'pred-1',
    run_id: 'run-1',
    organization_slug: 'acme',
    instrument_id: 'inst-1',
    analyst_id: 'analyst-1',
    predicted_direction: 'up' as 'up',
    confidence: 75,
    horizon_minutes: 240,
    rationale: '',
    created_at: new Date().toISOString(),
    ...overrides,
  } as any;
}

function buildHappyPathScript(opts: {
  portfolio?: Record<string, unknown> | null;
  existingOpenPosition?: boolean;
  instrumentPrice?: number;
} = {}) {
  const {
    portfolio = {
      id: 'pf-portfolio-analyst-1',
      analyst_id: 'analyst-1',
      organization_slug: 'acme',
      current_balance: 1_000_000,
      kind: 'analyst',
      status: 'active',
    },
    existingOpenPosition = false,
    instrumentPrice = 100,
  } = opts;

  return (sql: string, _params: unknown[]): ScriptedResponse => {
    if (sql.includes('from prediction.analyst_portfolios')) {
      return { data: portfolio ? [portfolio] : [], error: null };
    }
    if (sql.includes('from prediction.analyst_positions')) {
      return { data: existingOpenPosition ? [{ id: 'existing-pos' }] : [], error: null };
    }
    if (sql.includes('from prediction.instruments')) {
      return { data: [{ symbol: 'NVDA', current_state: { price: instrumentPrice } }], error: null };
    }
    if (sql.startsWith('insert into prediction.analyst_positions')) {
      return { data: [], error: null };
    }
    return { data: [], error: null };
  };
}

async function main(): Promise<void> {
console.log('\n=== ConvictionTraderService Tests ===\n');

// ─── Threshold gating ───────────────────────────────────────────
console.log('Threshold gating (default 70):');
delete process.env.CONVICTION_TRADE_THRESHOLD;
{
  const db = new MockDb(buildHappyPathScript());
  const service = new ConvictionTraderService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  await service.evaluateAnalyst(makeOutcome({ confidence: 69 }), 'acme');
  const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
  assert(inserts.length === 0, 'confidence 69 → no insert');
}
{
  const db = new MockDb(buildHappyPathScript());
  const service = new ConvictionTraderService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  await service.evaluateAnalyst(makeOutcome({ confidence: 70 }), 'acme');
  const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
  assert(inserts.length === 1, 'confidence 70 → insert (>= is inclusive)');
}
{
  const db = new MockDb(buildHappyPathScript());
  const service = new ConvictionTraderService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  await service.evaluateAnalyst(makeOutcome({ confidence: 75 }), 'acme');
  const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
  assert(inserts.length === 1, 'confidence 75 → insert');
  // params: id, portfolio_id, analyst_id, organization_slug, prediction_id,
  //         instrument_id, symbol, direction, quantity, entry_price, current_price,
  //         trigger_reason, trigger_prediction_id, trigger_conviction
  const params = inserts[0].params;
  assert(params[1] === 'pf-portfolio-analyst-1', 'insert routed to analyst portfolio');
  assert(params[4] === 'pred-1', 'prediction_id captured');
  assert(params[5] === 'inst-1', 'instrument_id captured');
  assert(params[6] === 'NVDA', 'symbol resolved from instruments.current_state');
  assert(params[7] === 'long', 'direction up → long');
  assert(Number(params[9]) === 100, 'entry price from current_state');
  assert(params[11] === 'signal_cross', 'trigger_reason=signal_cross');
  assert(params[13] === 'pred-1', 'trigger_prediction_id matches prediction id');
  assert(Number(params[14]) === 75, 'trigger_conviction=75');
}

// ─── Threshold env var override ─────────────────────────────────
console.log('\nThreshold env var override:');
{
  process.env.CONVICTION_TRADE_THRESHOLD = '90';
  const db = new MockDb(buildHappyPathScript());
  const service = new ConvictionTraderService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  await service.evaluateAnalyst(makeOutcome({ confidence: 85 }), 'acme');
  const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
  assert(inserts.length === 0, 'override 90, conf 85 → no insert');
  delete process.env.CONVICTION_TRADE_THRESHOLD;
}

// ─── Idempotency ────────────────────────────────────────────────
console.log('\nIdempotency:');
{
  const db = new MockDb(buildHappyPathScript({ existingOpenPosition: true }));
  const service = new ConvictionTraderService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  await service.evaluateAnalyst(makeOutcome({ confidence: 80 }), 'acme');
  const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
  assert(inserts.length === 0, 'existing open position on (portfolio,instrument,prediction) → no insert');
}

// ─── Missing analyst portfolio ──────────────────────────────────
console.log('\nMissing portfolio:');
{
  const db = new MockDb(buildHappyPathScript({ portfolio: null }));
  const service = new ConvictionTraderService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  await service.evaluateAnalyst(makeOutcome({ confidence: 80 }), 'acme');
  const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
  assert(inserts.length === 0, 'no portfolio row → no insert (warn logged)');
}

// ─── Arbitrator routing ─────────────────────────────────────────
console.log('\nArbitrator routing:');
{
  const arbPortfolio = {
    id: 'pf-portfolio-arbitrator',
    analyst_id: 'pf-base-arbitrator',
    organization_slug: '__base__',
    current_balance: 1_000_000,
    kind: 'arbitrator',
    status: 'active',
  };
  const db = new MockDb((sql, params) => {
    if (sql.includes('from prediction.analyst_portfolios') && sql.includes('where id = $1')) {
      // Arbitrator-specific lookup
      assert(params[0] === 'pf-portfolio-arbitrator', 'arbitrator looked up by hard-coded id');
      return { data: [arbPortfolio], error: null };
    }
    if (sql.includes('from prediction.analyst_positions')) {
      return { data: [], error: null };
    }
    if (sql.includes('from prediction.instruments')) {
      return { data: [{ symbol: 'NVDA', current_state: { price: 100 } }], error: null };
    }
    return { data: [], error: null };
  });
  const service = new ConvictionTraderService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  await service.evaluateArbitrator(makeOutcome({ confidence: 80, predicted_direction: 'down' }), 'acme');
  const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
  assert(inserts.length === 1, 'arbitrator >= threshold → insert');
  assert(inserts[0].params[1] === 'pf-portfolio-arbitrator', 'insert routed to pf-portfolio-arbitrator');
  assert(inserts[0].params[3] === '__base__', 'organization_slug from arbitrator portfolio row');
  assert(inserts[0].params[7] === 'short', 'direction down → short');
}

// ─── Missing instrument price ───────────────────────────────────
console.log('\nMissing price guard:');
{
  const db = new MockDb((sql, _params) => {
    if (sql.includes('from prediction.analyst_portfolios')) {
      return {
        data: [{
          id: 'pf-portfolio-analyst-1',
          analyst_id: 'analyst-1',
          organization_slug: 'acme',
          current_balance: 1_000_000,
          kind: 'analyst',
          status: 'active',
        }],
        error: null,
      };
    }
    if (sql.includes('from prediction.analyst_positions')) {
      return { data: [], error: null };
    }
    if (sql.includes('from prediction.instruments')) {
      return { data: [{ symbol: 'NVDA', current_state: {} }], error: null };
    }
    return { data: [], error: null };
  });
  const service = new ConvictionTraderService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  await service.evaluateAnalyst(makeOutcome({ confidence: 80 }), 'acme');
  const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
  assert(inserts.length === 0, 'no current price → skip with warn (no insert)');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
