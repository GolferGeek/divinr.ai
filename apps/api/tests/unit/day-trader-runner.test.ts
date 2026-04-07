/**
 * Unit tests for DayTraderRunnerService (Phase 7 of
 * portfolio-foundation-resume).
 *
 * Verifies routing-only behavior: opens go through AutotradeOpenHelper
 * with triggerReason='strategy' and predictionId=null; closes go through
 * AnalystPortfolioService.closePosition; cross-portfolio close requests
 * are rejected; positions land in the correct portfolio_id.
 */
import { DayTraderRunnerService } from '../../src/markets/services/day-trader-runner.service';
import type {
  DayTraderStrategy,
  DayTraderPortfolioRow,
  StrategyIntents,
} from '../../src/markets/services/day-trader-runner.service';
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

const PORTFOLIOS: DayTraderPortfolioRow[] = [
  {
    id: 'pf-portfolio-momentum-breakout',
    analyst_id: 'pf-base-day-trader-momentum',
    organization_slug: '__base__',
    current_balance: 1_000_000,
    strategy_name: 'momentum_breakout',
  },
  {
    id: 'pf-portfolio-mean-reversion',
    analyst_id: 'pf-base-day-trader-mean_reversion',
    organization_slug: '__base__',
    current_balance: 1_000_000,
    strategy_name: 'mean_reversion',
  },
  {
    id: 'pf-portfolio-gap-and-go',
    analyst_id: 'pf-base-day-trader-gap_and_go',
    organization_slug: '__base__',
    current_balance: 1_000_000,
    strategy_name: 'gap_and_go',
  },
];

class MockDb {
  public calls: MockDbCall[] = [];
  // open positions keyed by id for routeClose lookups
  public openPositions: Record<string, { instrument_id: string; portfolio_id: string }> = {};
  constructor(private readonly instrumentPrice = 100) {}
  async rawQuery(sql: string, params: unknown[] = []): Promise<ScriptedResponse> {
    this.calls.push({ sql, params });
    if (sql.includes("kind = 'day_trader'")) {
      return { data: PORTFOLIOS, error: null };
    }
    if (sql.includes('from prediction.instruments')) {
      const instrumentId = params[0] as string;
      return {
        data: [{ symbol: instrumentId.toUpperCase(), current_state: { price: this.instrumentPrice } }],
        error: null,
      };
    }
    if (
      sql.includes('from prediction.analyst_positions') &&
      sql.includes("status = 'open'") &&
      sql.includes('id = $1')
    ) {
      const id = params[0] as string;
      const row = this.openPositions[id];
      return { data: row ? [row] : [], error: null };
    }
    if (sql.includes('from prediction.analyst_positions')) {
      // helper idempotency lookup — should never be called for strategy opens
      return { data: [], error: null };
    }
    if (sql.startsWith('insert into prediction.analyst_positions')) {
      return { data: [], error: null };
    }
    return { data: [], error: null };
  }
}

class FixedStrategy implements DayTraderStrategy {
  constructor(private readonly intents: StrategyIntents) {}
  async generateIntents(_p: DayTraderPortfolioRow): Promise<StrategyIntents> {
    return this.intents;
  }
}

const stubPortfolios = {
  closePosition: async (_id: string, _price: number, _reason?: string) => ({
    realizedPnl: 0,
    isWin: false,
  }),
} as any;

async function main(): Promise<void> {
  console.log('\n=== DayTraderRunnerService Tests ===\n');

  // 1. Empty intents from all strategies → no inserts, no closes.
  console.log('Empty intents:');
  {
    const db = new MockDb();
    const helper = new AutotradeOpenHelper(db as any);
    const svc = new DayTraderRunnerService(db as any, helper, stubPortfolios);
    const result = await svc.runStrategies();
    assert(result.strategiesRun === 3, '3 strategies run');
    assert(result.opensRequested === 0 && result.opensWritten === 0, 'no opens');
    assert(result.closesRequested === 0 && result.closesWritten === 0, 'no closes');
    const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
    assert(inserts.length === 0, 'no INSERTs hit DB');
  }

  // 2. Each strategy emits one open → routed through helper to its own portfolio.
  console.log('\nEach strategy opens its own position:');
  {
    const db = new MockDb();
    const helper = new AutotradeOpenHelper(db as any);
    const svc = new DayTraderRunnerService(db as any, helper, stubPortfolios);
    svc.strategies.set(
      'momentum_breakout',
      new FixedStrategy({
        opens: [{ instrumentId: 'inst-mom', direction: 'long', quantity: 10, conviction: 80 }],
        closes: [],
      }),
    );
    svc.strategies.set(
      'mean_reversion',
      new FixedStrategy({
        opens: [{ instrumentId: 'inst-mr', direction: 'short', quantity: 5, conviction: 65 }],
        closes: [],
      }),
    );
    svc.strategies.set(
      'gap_and_go',
      new FixedStrategy({
        opens: [{ instrumentId: 'inst-gap', direction: 'long', quantity: 7, conviction: 90 }],
        closes: [],
      }),
    );

    const result = await svc.runStrategies();
    assert(result.opensRequested === 3, '3 opens requested');
    assert(result.opensWritten === 3, '3 opens written');

    const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
    assert(inserts.length === 3, '3 INSERT calls');

    // Routing: each insert lands in its own portfolio (no cross-pollination).
    // Param order from helper: id, portfolio_id, analyst_id, org, prediction_id, instrument_id, symbol, direction, qty, entry, current, trigger_reason, trigger_prediction_id, trigger_conviction
    const byInstrument = new Map<string, unknown[]>();
    for (const ins of inserts) byInstrument.set(ins.params[5] as string, ins.params);

    const mom = byInstrument.get('inst-mom')!;
    assert(mom[1] === 'pf-portfolio-momentum-breakout', 'momentum insert → momentum portfolio');
    assert(mom[4] === null, 'prediction_id is NULL for strategy open');
    assert(mom[11] === 'strategy', 'trigger_reason=strategy');
    assert(mom[7] === 'long', 'momentum direction long');
    assert(mom[8] === 10, 'momentum quantity 10');

    const mr = byInstrument.get('inst-mr')!;
    assert(mr[1] === 'pf-portfolio-mean-reversion', 'mean_reversion insert → mean_reversion portfolio');
    assert(mr[7] === 'short', 'mean_reversion direction short');

    const gap = byInstrument.get('inst-gap')!;
    assert(gap[1] === 'pf-portfolio-gap-and-go', 'gap_and_go insert → gap_and_go portfolio');

    // Critically: helper idempotency SELECT must NOT have happened (predictionId=null skips it).
    const idempotencySelects = db.calls.filter(
      c =>
        c.sql.includes('from prediction.analyst_positions') &&
        c.sql.includes('prediction_id = $3'),
    );
    assert(idempotencySelects.length === 0, 'helper skipped idempotency SELECT for null predictionId');
  }

  // 3. Close intent routes through closePosition with the correct exit price.
  console.log('\nClose intent routes through AnalystPortfolioService:');
  {
    const db = new MockDb(150);
    db.openPositions['pos-1'] = {
      instrument_id: 'inst-mom',
      portfolio_id: 'pf-portfolio-momentum-breakout',
    };
    const helper = new AutotradeOpenHelper(db as any);

    const closeCalls: Array<{ id: string; price: number; reason?: string }> = [];
    const portfolios = {
      closePosition: async (id: string, price: number, reason?: string) => {
        closeCalls.push({ id, price, reason });
        return { realizedPnl: 50, isWin: true };
      },
    } as any;

    const svc = new DayTraderRunnerService(db as any, helper, portfolios);
    svc.strategies.set(
      'momentum_breakout',
      new FixedStrategy({ opens: [], closes: [{ positionId: 'pos-1' }] }),
    );
    svc.strategies.set('mean_reversion', new FixedStrategy({ opens: [], closes: [] }));
    svc.strategies.set('gap_and_go', new FixedStrategy({ opens: [], closes: [] }));

    const result = await svc.runStrategies();
    assert(result.closesRequested === 1, 'one close requested');
    assert(result.closesWritten === 1, 'one close written');
    assert(closeCalls.length === 1, 'closePosition invoked exactly once');
    assert(closeCalls[0].id === 'pos-1', 'closed pos-1');
    assert(closeCalls[0].price === 150, 'exit price from current_state');
    assert(closeCalls[0].reason === 'strategy', 'close trigger_reason=strategy');
  }

  // 4. Cross-portfolio close is refused.
  console.log('\nCross-portfolio close refused:');
  {
    const db = new MockDb();
    db.openPositions['pos-foreign'] = {
      instrument_id: 'inst-mr',
      portfolio_id: 'pf-portfolio-mean-reversion',
    };
    const helper = new AutotradeOpenHelper(db as any);

    let closeCalled = false;
    const portfolios = {
      closePosition: async () => {
        closeCalled = true;
        return { realizedPnl: 0, isWin: false };
      },
    } as any;

    const svc = new DayTraderRunnerService(db as any, helper, portfolios);
    // momentum strategy tries to close a position belonging to mean_reversion
    svc.strategies.set(
      'momentum_breakout',
      new FixedStrategy({ opens: [], closes: [{ positionId: 'pos-foreign' }] }),
    );
    svc.strategies.set('mean_reversion', new FixedStrategy({ opens: [], closes: [] }));
    svc.strategies.set('gap_and_go', new FixedStrategy({ opens: [], closes: [] }));

    const result = await svc.runStrategies();
    assert(result.closesRequested === 1, 'close requested');
    assert(result.closesWritten === 0, 'close NOT written (cross-portfolio refusal)');
    assert(closeCalled === false, 'closePosition never invoked across portfolios');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
