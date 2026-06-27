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
    const balUpdate = db.calls.find(c => c.sql.includes('update prediction.user_portfolios') && c.sql.includes('current_balance = current_balance +'));
    assert(balUpdate !== undefined, 'balance update issued');
    assert(Number(balUpdate!.params[0]) === -1000, 'long cash delta = -(qty * entry) = -1000');
  }

  // 1a. Opening a short credits cash with sale proceeds.
  console.log('\nShort open cash:');
  {
    const portfolio = basePortfolio();
    const db = new MockDb((sql, _params) => {
      if (sql.includes('select * from prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('insert into prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('from prediction.instruments')) return { data: [{ symbol: 'NVDA', current_state: { price: 100 } }], error: null };
      if (sql.includes('select * from prediction.user_positions')) return { data: [], error: null };
      if (sql.includes('insert into prediction.user_positions')) {
        return { data: [{ id: 'pos-short', portfolio_id: portfolio.id, user_id: 'user-1', direction: 'short', quantity: 10, entry_price: 100, status: 'open', trigger_reason: 'manual' }], error: null };
      }
      if (sql.includes('update prediction.user_portfolios')) return { data: [], error: null };
      return { data: [], error: null };
    });
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, stubBars, stubMarketHours);
    await svc.executeImmediate({
      userId: 'user-1', predictionId: 'pred-short',
      instrumentId: 'inst-1', direction: 'short', quantity: 10,
    });
    const balUpdate = db.calls.find(c => c.sql.includes('update prediction.user_portfolios') && c.sql.includes('current_balance = current_balance +'));
    assert(balUpdate !== undefined, 'short balance update issued');
    assert(Number(balUpdate!.params[0]) === 1000, 'short cash delta = sale proceeds = +1000');
  }

  // 2. Idempotency: re-call returns same position id
  console.log('\nIdempotency:');
  {
    const portfolio = basePortfolio();
    const existingPos = { id: 'pos-existing', portfolio_id: portfolio.id, user_id: 'user-1', direction: 'long', quantity: 10, entry_price: 100, status: 'open' };
    let secondInsertHappened = false;
    const db = new MockDb((sql, params) => {
      if (sql.includes('select * from prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('insert into prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('from prediction.instruments')) return { data: [{ symbol: 'NVDA', current_state: { price: 100 } }], error: null };
      if (sql.includes('direction = $4') && params[3] === 'short') return { data: [], error: null };
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

  // 2a. Opposite buy covers an open short instead of opening a bad long.
  console.log('\nBuy-to-cover:');
  {
    const portfolio = basePortfolio();
    const shortPos = {
      id: 'short-pos',
      portfolio_id: portfolio.id,
      user_id: 'user-1',
      prediction_id: 'pred-short',
      instrument_id: 'inst-1',
      symbol: 'NVDA',
      direction: 'short',
      quantity: 10,
      entry_price: 120,
      current_price: 110,
      unrealized_pnl: 100,
      status: 'open',
    };
    let insertedLong = false;
    let realizedPnl: number | null = null;
    let portfolioPnl: number | null = null;
    const db = new MockDb((sql, params) => {
      if (sql.includes('select * from prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('from prediction.instruments')) return { data: [{ symbol: 'NVDA', current_state: { price: 100 } }], error: null };
      if (sql.includes('direction = $4') && params[3] === 'short') return { data: [shortPos], error: null };
      if (sql.includes('update prediction.user_positions') && sql.includes("status = 'closed'")) {
        realizedPnl = Number(params[1]);
        return { data: [{ ...shortPos, status: 'closed', exit_price: params[0], realized_pnl: params[1] }], error: null };
      }
      if (sql.includes('update prediction.user_portfolios') && sql.includes('total_realized_pnl')) {
        portfolioPnl = Number(params[1]);
        return { data: [], error: null };
      }
      if (sql.includes('insert into prediction.user_positions')) {
        insertedLong = true;
        return { data: [], error: null };
      }
      return { data: [], error: null };
    });
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, stubBars, stubMarketHours);
    const result = await svc.executeImmediate({
      userId: 'user-1', predictionId: 'pred-cover',
      instrumentId: 'inst-1', direction: 'long', quantity: 10,
    });
    assert((result as any).id === 'short-pos', 'returns the covered short row');
    assert(realizedPnl === 200, 'short cover realizes profit: (120-100)*10 = 200');
    assert(portfolioPnl === 200, 'portfolio realized PnL is incremented');
    assert(insertedLong === false, 'does not insert a long when cover quantity matches short');
  }

  // 2b. Immediate trades no longer auto-mirror into tournaments.
  console.log('\nNo automatic tournament mirror:');
  {
    const portfolio = basePortfolio();
    let tournamentLookupHappened = false;
    let tournamentInsertHappened = false;
    const db = new MockDb((sql, params) => {
      if (sql.includes('select * from prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('insert into prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('from prediction.instruments')) return { data: [{ symbol: 'NVDA', current_state: { price: 100 } }], error: null };
      if (sql.includes('select * from prediction.user_positions')) return { data: [], error: null };
      if (sql.includes('insert into prediction.user_positions')) {
        return { data: [{ id: 'pos-1', portfolio_id: portfolio.id, user_id: 'user-1', direction: 'long', quantity: 10, entry_price: 100, status: 'open', trigger_reason: 'manual' }], error: null };
      }
      if (sql.includes('update prediction.user_portfolios')) return { data: [], error: null };
      if (sql.includes('from prediction.tournament_entries')) {
        tournamentLookupHappened = true;
        return { data: [], error: null };
      }
      if (sql.includes('insert into prediction.tournament_positions')) {
        tournamentInsertHappened = true;
        return { data: [], error: null };
      }
      return { data: [], error: null };
    });
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, stubBars, stubMarketHours);
    await svc.executeImmediate({
      userId: 'user-1', predictionId: 'pred-1',
      instrumentId: 'inst-1', direction: 'long', quantity: 10,
    });
    assert(tournamentLookupHappened === false, 'does not look up tournament entries');
    assert(tournamentInsertHappened === false, 'does not insert tournament position');
  }

  // 2c. Explicit destination execution can fill a tournament row.
  console.log('\nExplicit destination execution:');
  {
    const portfolio = basePortfolio();
    const tournamentInserts: unknown[][] = [];
    const db = new MockDb((sql, params) => {
      if (sql.includes('select * from prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('from prediction.instruments')) return { data: [{ symbol: 'NVDA', current_state: { price: 100 } }], error: null };
      if (sql.includes('from prediction.tournament_portfolios')) {
        return { data: [{ current_balance: 100000, allowed_instruments: ['NVDA'] }], error: null };
      }
      if (sql.includes('insert into prediction.tournament_positions')) {
        tournamentInserts.push(params);
        return { data: [{ id: 'tpos-1', symbol: 'NVDA', quantity: 10, entry_price: 100 }], error: null };
      }
      if (sql.includes('update prediction.tournament_portfolios')) return { data: [], error: null };
      return { data: [], error: null };
    });
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, stubBars, stubMarketHours);
    const result = await svc.executeTradeDestinations({
      userId: 'user-1',
      predictionId: 'pred-1',
      instrumentId: 'inst-1',
      direction: 'long',
      destinations: [{ destinationType: 'tournament', portfolioId: 'tpf-1', tournamentId: 'tour-1', quantity: 10 }],
    });
    assert(tournamentInserts.length === 1, 'explicit tournament destination inserts one position');
    assert(tournamentInserts[0][1] === 'tour-1', 'uses selected tournament id');
    assert(tournamentInserts[0][2] === 'tpf-1', 'uses selected tournament portfolio id');
    assert(((result.results[0] as any).status) === 'filled', 'returns row-level filled status');
  }

  // 2d. Trade ticket price falls back across duplicate instrument rows by symbol.
  console.log('\nTrade destination quote fallback:');
  {
    const portfolio = basePortfolio();
    const db = new MockDb((sql, params) => {
      if (sql.includes('select id, symbol, current_state') && params[0] === 'empty-ibm-id') {
        return { data: [{ id: 'empty-ibm-id', symbol: 'IBM', current_state: {} }], error: null };
      }
      if (sql.includes('select id, symbol, current_state') && params[0] === 'IBM') {
        return {
          data: [
            { id: 'empty-ibm-id', symbol: 'IBM', current_state: {} },
            { id: 'priced-ibm-id', symbol: 'IBM', current_state: { price: 244.8 } },
          ],
          error: null,
        };
      }
      if (sql.includes('select * from prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('from prediction.user_positions')) return { data: [{ long_qty: 0, short_qty: 0 }], error: null };
      if (sql.includes('from prediction.tournament_entries')) return { data: [], error: null };
      return { data: [], error: null };
    });
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, stubBars, stubMarketHours);
    const result = await svc.getTradeDestinations({
      userId: 'user-1',
      instrumentId: 'empty-ibm-id',
      symbol: 'IBM',
    });
    assert(result.currentPrice === 244.8, 'returns cached IBM price from duplicate symbol row');
    assert(result.destinations[0].allowed === true, 'keeps My Portfolio selectable');
  }

  // 2e. Stale cached quote falls through to intraday bars.
  console.log('\nStale quote fallback:');
  {
    const portfolio = basePortfolio();
    let cashDelta: number | null = null;
    const db = new MockDb((sql, params) => {
      if (sql.includes('select * from prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('insert into prediction.user_portfolios')) return { data: [portfolio], error: null };
      if (sql.includes('select id, symbol, current_state')) {
        return {
          data: [{
            id: 'inst-1',
            symbol: 'NVDA',
            current_state: { price: 198.87, price_updated_at: '2026-04-17T00:32:19.980Z' },
          }],
          error: null,
        };
      }
      if (sql.includes('direction = $4')) return { data: [], error: null };
      if (sql.includes('select * from prediction.user_positions')) return { data: [], error: null };
      if (sql.includes('insert into prediction.user_positions')) {
        return { data: [{ id: 'pos-1', portfolio_id: portfolio.id, user_id: 'user-1', direction: 'long', quantity: 10, entry_price: 227.03, status: 'open', trigger_reason: 'manual' }], error: null };
      }
      if (sql.includes('update prediction.user_portfolios')) {
        cashDelta = Number(params[0]);
        return { data: [], error: null };
      }
      return { data: [], error: null };
    });
    const bars = {
      getIntradayBarsForSymbols: async () => new Map([['NVDA', [{ t: '2026-05-15 09:49:00', o: 226.63, h: 227.05, l: 226.48, c: 227.03, v: 84906 }]]]),
    } as any;
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, bars, stubMarketHours);
    const pos = await svc.executeImmediate({
      userId: 'user-1', predictionId: 'pred-1',
      instrumentId: 'inst-1', direction: 'long', quantity: 10,
    });
    assert((pos as any).entry_price === 227.03, 'uses latest intraday close instead of stale cached quote');
    assert(cashDelta === -2270.3, 'long cash delta uses latest intraday price');
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
    let cashDelta: number | null = null;
    const db = new MockDb((sql, params) => {
      if (sql.includes('select * from prediction.user_positions')) return { data: [pos], error: null };
      if (sql.includes('from prediction.instruments')) return { data: [{ current_state: { price: 80 } }], error: null };
      if (sql.includes('update prediction.user_positions')) {
        updatedPnl = Number(params[1]);
        return { data: [{ ...pos, status: 'closed', exit_price: 80, realized_pnl: updatedPnl }], error: null };
      }
      if (sql.includes('update prediction.user_portfolios')) {
        cashDelta = Number(params[0]);
        return { data: [], error: null };
      }
      return { data: [], error: null };
    });
    const svc = new UserPortfolioService(db as any, stubSchema, stubSizing, stubBars, stubMarketHours);
    await svc.closePosition({ userId: 'user-1', positionId: 'pos-2' });
    assert(updatedPnl === 200, 'short P&L = (100-80)*10 = 200');
    assert(cashDelta === -800, 'short close cash delta = buy-to-cover cost = -800');
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
