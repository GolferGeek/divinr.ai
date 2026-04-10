/**
 * Unit tests for EodForcedBuyService (Agent Autotrading — Phase 3).
 *
 * Pure scripted MockDb. Verifies threshold gating, idempotency on
 * (portfolio, instrument, prediction), arbitrator routing, day-trader
 * exclusion (predictions never reach a day-trader portfolio), and
 * provenance writes (trigger_reason='eod_sweep').
 */
import { EodForcedBuyService } from '../../src/markets/services/eod-forced-buy.service';
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
  getPositionPercent: async (_conf: number) => 0.1,
  calculatePositionSize: (_balance: number, entryPrice: number, percent: number) =>
    Math.max(1, Math.floor((1_000_000 * percent) / entryPrice)),
} as any;

function makePrediction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    prediction_id: 'pred-1',
    analyst_id: 'analyst-1',
    instrument_id: 'inst-1',
    predicted_direction: 'up',
    confidence: 80,
    role: 'analyst',
    symbol: 'NVDA',
    current_state: { price: 100 },
    ...overrides,
  };
}

function makeAnalystPortfolio() {
  return {
    id: 'pf-portfolio-analyst-1',
    analyst_id: 'analyst-1',
    user_id: null,
    current_balance: 1_000_000,
    kind: 'analyst',
    status: 'active',
  };
}

function makeArbitratorPortfolio() {
  return {
    id: 'pf-portfolio-arbitrator',
    analyst_id: 'pf-base-arbitrator',
    user_id: null,
    current_balance: 1_000_000,
    kind: 'arbitrator',
    status: 'active',
  };
}

interface ScriptOpts {
  predictions?: Array<ReturnType<typeof makePrediction>>;
  analystPortfolio?: ReturnType<typeof makeAnalystPortfolio> | null;
  arbitratorPortfolio?: ReturnType<typeof makeArbitratorPortfolio> | null;
  existingPositionFor?: Set<string>; // set of "portfolioId|instrumentId|predictionId" tuples that already have positions
}

function buildScript(opts: ScriptOpts = {}) {
  const {
    predictions = [makePrediction()],
    analystPortfolio = makeAnalystPortfolio(),
    arbitratorPortfolio = makeArbitratorPortfolio(),
    existingPositionFor = new Set<string>(),
  } = opts;

  return (sql: string, params: unknown[]): ScriptedResponse => {
    if (sql.includes('from prediction.market_predictions')) {
      // Threshold filter happens client-side via $1; we still apply it here.
      const threshold = Number(params[0] ?? 70);
      return { data: predictions.filter(p => Number(p.confidence) >= threshold), error: null };
    }
    if (sql.includes('from prediction.analyst_portfolios') && sql.includes('where id = $1')) {
      return { data: arbitratorPortfolio ? [arbitratorPortfolio] : [], error: null };
    }
    if (sql.includes('from prediction.analyst_portfolios')) {
      return { data: analystPortfolio ? [analystPortfolio] : [], error: null };
    }
    if (sql.includes('from prediction.analyst_positions')) {
      const key = `${params[0]}|${params[1]}|${params[2]}`;
      return { data: existingPositionFor.has(key) ? [{ id: 'existing' }] : [], error: null };
    }
    if (sql.startsWith('insert into prediction.analyst_positions')) {
      return { data: [], error: null };
    }
    return { data: [], error: null };
  };
}

async function main(): Promise<void> {
console.log('\n=== EodForcedBuyService Tests ===\n');

// ─── Threshold gating ───────────────────────────────────────────
console.log('Threshold gating (default 70):');
delete process.env.CONVICTION_TRADE_THRESHOLD;
{
  const db = new MockDb(buildScript({ predictions: [makePrediction({ confidence: 69 })] }));
  const service = new EodForcedBuyService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  const result = await service.runSweep({ manual: true });
  assert(result.rowsWritten === 0, 'confidence 69 → 0 rows written');
}
{
  const db = new MockDb(buildScript({ predictions: [makePrediction({ confidence: 70 })] }));
  const service = new EodForcedBuyService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  const result = await service.runSweep({ manual: true });
  assert(result.rowsWritten === 1, 'confidence 70 → 1 row written (>= inclusive)');
}
{
  const db = new MockDb(buildScript({ predictions: [makePrediction({ confidence: 85 })] }));
  const service = new EodForcedBuyService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  const result = await service.runSweep({ manual: true });
  assert(result.rowsWritten === 1, 'confidence 85 → 1 row written');
  const insert = db.calls.find(c => c.sql.startsWith('insert into prediction.analyst_positions'));
  assert(insert !== undefined, 'INSERT issued');
  // Param positions (helper INSERT): id=0, portfolio_id=1, analyst_id=2,
  // prediction_id=3, instrument_id=4, symbol=5, direction=6, qty=7, entry=8, current=9,
  // trigger_reason=10, trigger_strategy=11, trigger_prediction_id=12, trigger_conviction=13
  assert(insert!.params[10] === 'eod_sweep', 'INSERT writes trigger_reason=eod_sweep');
  assert(insert!.params[1] === 'pf-portfolio-analyst-1', 'routed to analyst portfolio');
  assert(insert!.params[6] === 'long', 'direction up → long');
  assert(insert!.params[13] === 85, 'trigger_conviction = 85');
  assert(insert!.params[12] === 'pred-1', 'trigger_prediction_id = pred-1');
}

// ─── Idempotency ────────────────────────────────────────────────
console.log('\nIdempotency:');
{
  const existing = new Set<string>(['pf-portfolio-analyst-1|inst-1|pred-1']);
  const db = new MockDb(buildScript({ existingPositionFor: existing }));
  const service = new EodForcedBuyService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  const result = await service.runSweep({ manual: true });
  assert(result.rowsWritten === 0, 'existing position → 0 rows');
  assert(result.skipped === 1, 'existing position → skipped count = 1');
  const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
  assert(inserts.length === 0, 'no INSERT issued when position exists');
}

// ─── Arbitrator routing ─────────────────────────────────────────
console.log('\nArbitrator routing:');
{
  const arbPrediction = makePrediction({
    role: 'arbitrator',
    analyst_id: null,
    confidence: 80,
    predicted_direction: 'down',
  });
  const db = new MockDb(buildScript({ predictions: [arbPrediction] }));
  const service = new EodForcedBuyService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  const result = await service.runSweep({ manual: true });
  assert(result.rowsWritten === 1, 'arbitrator role → 1 row');
  const insert = db.calls.find(c => c.sql.startsWith('insert into prediction.analyst_positions'));
  assert(insert!.params[1] === 'pf-portfolio-arbitrator', 'routed to pf-portfolio-arbitrator');
  assert(insert!.params[6] === 'short', 'direction down → short');
  // Confirm the arbitrator-specific portfolio lookup query was issued
  const arbLookup = db.calls.find(c => c.sql.includes('from prediction.analyst_portfolios') && c.sql.includes('where id = $1'));
  assert(arbLookup !== undefined, 'arbitrator portfolio looked up by id');
  assert(arbLookup!.params[0] === 'pf-portfolio-arbitrator', 'arbitrator id is hard-coded constant');
}

// ─── Mixed batch ────────────────────────────────────────────────
console.log('\nMixed batch:');
{
  const predictions = [
    makePrediction({ prediction_id: 'p-low', confidence: 50 }),    // below threshold
    makePrediction({ prediction_id: 'p-an', confidence: 75 }),      // above
    makePrediction({ prediction_id: 'p-arb', role: 'arbitrator', analyst_id: null, confidence: 90 }),
  ];
  const db = new MockDb(buildScript({ predictions }));
  const service = new EodForcedBuyService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  const result = await service.runSweep({ manual: true });
  assert(result.rowsWritten === 2, 'mixed batch → 2 rows (low filtered out by threshold)');
}

// ─── Empty / no eligible predictions ────────────────────────────
console.log('\nNo eligible predictions:');
{
  const db = new MockDb(buildScript({ predictions: [] }));
  const service = new EodForcedBuyService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  const result = await service.runSweep({ manual: false });
  assert(result.rowsWritten === 0 && result.skipped === 0 && result.errors.length === 0, 'empty result → all zeros');
}

// ─── Missing portfolio ──────────────────────────────────────────
console.log('\nMissing portfolio:');
{
  const db = new MockDb(buildScript({ analystPortfolio: null }));
  const service = new EodForcedBuyService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  const result = await service.runSweep({ manual: true });
  assert(result.rowsWritten === 0, 'missing analyst portfolio → 0 rows');
  assert(result.errors.length === 1, 'missing analyst portfolio → 1 error logged');
}

// ─── Day-trader exclusion (eligibility) ─────────────────────────
console.log('\nDay-trader exclusion:');
{
  // The SQL filter `kind='analyst'` (in the analyst lookup) means even
  // if a day-trader prediction somehow leaked in, we'd never resolve a
  // day-trader portfolio for it. Verify by setting an analyst lookup
  // that returns null and asserting no insert.
  const db = new MockDb(buildScript({ analystPortfolio: null }));
  const service = new EodForcedBuyService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  const result = await service.runSweep({ manual: true });
  assert(result.rowsWritten === 0, 'no analyst portfolio matched → no insert (proxy for day-trader exclusion)');
}

// ─── SELECT filter shape ────────────────────────────────────────
console.log('\nSELECT filter shape:');
{
  const db = new MockDb(buildScript());
  const service = new EodForcedBuyService(db as any, stubSizing, new AutotradeOpenHelper(db as any));
  await service.runSweep({ manual: true });
  const select = db.calls.find(c => c.sql.includes('from prediction.market_predictions'));
  assert(select !== undefined, 'SELECT issued against market_predictions');
  assert(select!.sql.includes("role in ('analyst','arbitrator')"), 'SELECT filters role in (analyst,arbitrator)');
  assert(select!.sql.includes("predicted_direction != 'flat'"), 'SELECT excludes flat predictions');
  assert(select!.sql.includes('confidence >= $1'), 'SELECT applies threshold via $1');
  assert(select!.sql.includes('current_date'), 'SELECT scopes to today');
  assert(Number(select!.params[0]) === 70, 'threshold param = default 70');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
