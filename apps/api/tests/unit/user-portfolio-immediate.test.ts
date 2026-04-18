/**
 * Unit tests for UserPortfolioService.executeImmediate + closePosition.
 */
import { UserPortfolioService } from '../../src/markets/services/user-portfolio.service';

let passed = 0;
let failed = 0;
function assert(c: boolean, l: string) { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.error(`  ✗ ${l}`); } }

interface Call { sql: string; params: unknown[] }
class MockDb {
  public calls: Call[] = [];
  constructor(private readonly script: (sql: string, params: unknown[]) => { data?: unknown; error?: { message: string } | null }) {}
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    return this.script(sql, params);
  }
}

const stubSchema = { ensureSchema: async () => {} } as any;
const stubSizing = {} as any;
const stubBars = { getIntradayBarsForSymbols: async () => new Map() } as any;
const stubMarketHours = { isUsEquityMarketOpen: () => false } as any;

function basePortfolio() {
  return {
    id: 'pf-user-1',
    user_id: 'user-1',
    user_id: 'user-1',
    current_balance: 1_000_000,
    initial_balance: 1_000_000,
  };
}

async function main() {
  console.log('\n=== UserPortfolioService.executeImmediate Tests ===\n');

  // 1. Happy path opens position with manual trigger_reason
  console.log('Happy path:');
  {
    let inserted = false;
    const portfolio = basePortfolio();
    const db = new MockDb((sql, _params) => {
      if (sql.includes('select * from prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('insert into prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('from prediction.instruments')) return { data: [{ symbol: 'NVDA', current_state: { price: 100 } }], error: null };
      if (sql.includes('select * from prediction.user_positions')) return { data: [], error: null };
      if (sql.includes('insert into prediction.user_positions')) {
        inserted = true;
        return { data: [{ id: 'pos-1', portfolio_id: portfolio.id, user_id: 'user-1', direction: 'long', quantity: 10, entry_price: 100, status: 'open', trigger_reason: 'manual' }], error: null };
      }
      if (sql.includes('update prediction.user_portfolios')) return { data: [], error: null };
      return { data: [], error: null };
    });
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, stubBars, stubMarketHours);
    const pos = await svc.executeImmediate({
      userId: 'user-1', predictionId: 'pred-1',
      instrumentId: 'inst-1', direction: 'long', quantity: 10,
    });
    assert(inserted, 'INSERT into user_positions issued');
    assert((pos as any).trigger_reason === 'manual', 'trigger_reason=manual on returned row');
    const balUpdate = db.calls.find(c => c.sql.includes('update prediction.user_portfolios') && c.sql.includes('current_balance = current_balance -'));
    assert(balUpdate !== undefined, 'balance debit issued');
    assert(Number(balUpdate!.params[0]) === 1000, 'debit amount = qty * entry = 1000');
  }

  // 2. Idempotency: re-call returns same position id
  console.log('\nIdempotency:');
  {
    const portfolio = basePortfolio();
    const existingPos = { id: 'pos-existing', portfolio_id: portfolio.id, user_id: 'user-1', direction: 'long', quantity: 10, entry_price: 100, status: 'open' };
    let secondInsertHappened = false;
    const db = new MockDb((sql) => {
      if (sql.includes('select * from prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('insert into prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('from prediction.instruments')) return { data: [{ symbol: 'NVDA', current_state: { price: 100 } }], error: null };
      if (sql.includes('select * from prediction.user_positions')) return { data: [existingPos], error: null };
      if (sql.includes('insert into prediction.user_positions')) { secondInsertHappened = true; return { data: [], error: null }; }
      return { data: [], error: null };
    });
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, stubBars, stubMarketHours);
    const pos = await svc.executeImmediate({
      userId: 'user-1', predictionId: 'pred-1',
      instrumentId: 'inst-1', direction: 'long', quantity: 10,
    });
    assert((pos as any).id === 'pos-existing', 'returns existing position id');
    assert(secondInsertHappened === false, 'no second INSERT issued');
  }

  // 3. closePosition long P&L
  console.log('\nclosePosition long:');
  {
    const portfolio = basePortfolio();
    const pos = { id: 'pos-1', portfolio_id: portfolio.id, user_id: 'user-1', instrument_id: 'inst-1', direction: 'long', quantity: 10, entry_price: 100, status: 'open' };
    let updatedPnl: number | null = null;
    let creditAmount: number | null = null;
    const db = new MockDb((sql, params) => {
      if (sql.includes('select * from prediction.user_positions')) return { data: [pos], error: null };
      if (sql.includes('from prediction.instruments')) return { data: [{ current_state: { price: 120 } }], error: null };
      if (sql.includes('update prediction.user_positions')) {
        updatedPnl = Number(params[1]);
        return { data: [{ ...pos, status: 'closed', exit_price: 120, realized_pnl: updatedPnl }], error: null };
      }
      if (sql.includes('update prediction.user_portfolios')) {
        creditAmount = Number(params[0]);
        return { data: [], error: null };
      }
      return { data: [], error: null };
    });
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, stubBars, stubMarketHours);
    const closed = await svc.closePosition({ userId: 'user-1', positionId: 'pos-1' });
    assert(updatedPnl === 200, 'long P&L = (120-100)*10 = 200');
    assert((closed as any).status === 'closed', 'status=closed');
    assert(creditAmount === 1200, 'credit = qty*entry + pnl = 1200');
  }

  // 4. closePosition short P&L
  console.log('\nclosePosition short:');
  {
    const portfolio = basePortfolio();
    const pos = { id: 'pos-2', portfolio_id: portfolio.id, user_id: 'user-1', instrument_id: 'inst-1', direction: 'short', quantity: 10, entry_price: 100, status: 'open' };
    let updatedPnl: number | null = null;
    const db = new MockDb((sql, params) => {
      if (sql.includes('select * from prediction.user_positions')) return { data: [pos], error: null };
      if (sql.includes('from prediction.instruments')) return { data: [{ current_state: { price: 80 } }], error: null };
      if (sql.includes('update prediction.user_positions')) {
        updatedPnl = Number(params[1]);
        return { data: [{ ...pos, status: 'closed', exit_price: 80, realized_pnl: updatedPnl }], error: null };
      }
      return { data: [], error: null };
    });
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, stubBars, stubMarketHours);
    await svc.closePosition({ userId: 'user-1', positionId: 'pos-2' });
    assert(updatedPnl === 200, 'short P&L = (100-80)*10 = 200');
  }

  // 5. closePosition rejects other-user positions
  console.log('\nclosePosition cross-user guard:');
  {
    const pos = { id: 'pos-3', portfolio_id: 'pf-other', user_id: 'other-user', instrument_id: 'inst-1', direction: 'long', quantity: 10, entry_price: 100, status: 'open' };
    const db = new MockDb((sql) => {
      if (sql.includes('select * from prediction.user_positions')) return { data: [pos], error: null };
      return { data: [], error: null };
    });
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, stubBars, stubMarketHours);
    let threw = false;
    try {
      await svc.closePosition({ userId: 'user-1', positionId: 'pos-3' });
    } catch (e) {
      threw = true;
      assert(/does not belong/.test((e as Error).message), 'error mentions ownership');
    }
    assert(threw, 'closePosition throws on cross-user');
  }

  // 6. isDisclaimerAcknowledged
  console.log('\nDisclaimer ack:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('select disclaimer_acknowledged_at')) return { data: [{ disclaimer_acknowledged_at: '2026-04-07T00:00:00Z' }], error: null };
      return { data: [], error: null };
    });
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, stubBars, stubMarketHours);
    assert(await svc.isDisclaimerAcknowledged('user-1'), 'returns true when ack timestamp present');
  }
  {
    const db = new MockDb((sql) => {
      if (sql.includes('select disclaimer_acknowledged_at')) return { data: [{ disclaimer_acknowledged_at: null }], error: null };
      return { data: [], error: null };
    });
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, stubBars, stubMarketHours);
    assert((await svc.isDisclaimerAcknowledged('user-1')) === false, 'returns false when ack null');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
