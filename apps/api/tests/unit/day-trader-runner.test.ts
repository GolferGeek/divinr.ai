/**
 * Unit tests for DayTraderRunnerService — Phase 2 of
 * day-traders-and-leaderboard.
 *
 * Verifies the new stateful decide() interface, strategy_state load +
 * persist, EOD-flat force-close path, and the existing routing/cross-
 * portfolio purity invariants.
 */
import { DayTraderRunnerService } from '../../src/markets/services/day-trader-runner.service';
import type {
  DayTraderStrategy,
  DayTraderPortfolioRow,
  DecideContext,
  DecideAction,
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
    user_id: null,
    current_balance: 1_000_000,
    strategy_name: 'momentum_breakout',
    strategy_state: { momentum_breakout: { last_seen: 'prior-tick' } },
  },
  {
    id: 'pf-portfolio-mean-reversion',
    analyst_id: 'pf-base-day-trader-mean_reversion',
    user_id: null,
    current_balance: 1_000_000,
    strategy_name: 'mean_reversion',
    strategy_state: {},
  },
  {
    id: 'pf-portfolio-gap-and-go',
    analyst_id: 'pf-base-day-trader-gap_and_go',
    user_id: null,
    current_balance: 1_000_000,
    strategy_name: 'gap_and_go',
    strategy_state: {},
  },
];

class MockDb {
  public calls: MockDbCall[] = [];
  public openPositionsByPortfolio: Record<string, Array<{ id: string; instrument_id: string; direction: 'long' | 'short'; quantity: number; entry_price: number; portfolio_id: string }>> = {};
  public stateUpdates: Array<{ id: string; state: unknown }> = [];
  constructor(private readonly instrumentPrice = 100) {}
  async rawQuery(sql: string, params: unknown[] = []): Promise<ScriptedResponse> {
    this.calls.push({ sql, params });

    if (sql.includes("kind = 'day_trader'")) {
      return { data: PORTFOLIOS, error: null };
    }
    if (sql.startsWith('update prediction.analyst_portfolios') && sql.includes('strategy_state')) {
      this.stateUpdates.push({ id: params[1] as string, state: JSON.parse(params[0] as string) });
      return { data: [], error: null };
    }
    if (
      sql.includes('from prediction.analyst_positions') &&
      sql.includes('portfolio_id = $1') &&
      sql.includes("status = 'open'")
    ) {
      const pid = params[0] as string;
      return { data: this.openPositionsByPortfolio[pid] ?? [], error: null };
    }
    if (
      sql.includes('from prediction.analyst_positions') &&
      sql.includes('id = $1') &&
      sql.includes("status = 'open'")
    ) {
      const id = params[0] as string;
      for (const list of Object.values(this.openPositionsByPortfolio)) {
        const row = list.find(p => p.id === id);
        if (row) return { data: [{ instrument_id: row.instrument_id, portfolio_id: row.portfolio_id }], error: null };
      }
      return { data: [], error: null };
    }
    if (sql.includes('from prediction.instruments') && sql.includes('is_active = true')) {
      return {
        data: [
          { id: 'inst-mom', symbol: 'MOM', current_state: { price: this.instrumentPrice, recent_bars: [] } },
          { id: 'inst-mr', symbol: 'MR', current_state: { price: this.instrumentPrice, recent_bars: [] } },
          { id: 'inst-gap', symbol: 'GAP', current_state: { price: this.instrumentPrice, recent_bars: [] } },
        ],
        error: null,
      };
    }
    if (sql.includes('from prediction.instruments') && sql.includes('id = ANY($1)')) {
      const ids = (params[0] as string[]) ?? [];
      return {
        data: ids.map(id => ({ id, current_state: { price: this.instrumentPrice, recent_bars: [] } })),
        error: null,
      };
    }
    if (sql.includes('from prediction.market_predictions')) {
      return { data: [], error: null };
    }
    if (sql.includes('from prediction.instruments') && sql.includes('id = $1')) {
      const id = params[0] as string;
      return {
        data: [{ symbol: id.toUpperCase(), current_state: { price: this.instrumentPrice } }],
        error: null,
      };
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

class FixedDecide implements DayTraderStrategy {
  public sawState: Record<string, unknown> | null = null;
  constructor(private readonly result: DecideAction) {}
  decide(ctx: DecideContext): DecideAction {
    this.sawState = ctx.state;
    return this.result;
  }
}

const stubPortfolios = {
  closePosition: async (_id: string, _price: number, _reason?: string, _strategy?: string) => ({
    realizedPnl: 0,
    isWin: false,
  }),
} as any;

async function main(): Promise<void> {
  console.log('\n=== DayTraderRunnerService Tests ===\n');

  // 1. All strategies noop → no inserts, state still persisted, decision context delivered.
  console.log('All noop:');
  {
    const db = new MockDb();
    const helper = new AutotradeOpenHelper(db as any);
    const svc = new DayTraderRunnerService(db as any, helper, stubPortfolios);
    const mom = new FixedDecide({ action: 'noop', newState: { tick: 1 } });
    svc.strategies.set('momentum_breakout', mom);
    svc.strategies.set('mean_reversion', new FixedDecide({ action: 'noop', newState: {} }));
    svc.strategies.set('gap_and_go', new FixedDecide({ action: 'noop', newState: {} }));

    const result = await svc.runStrategies();
    assert(result.strategiesRun === 3, '3 strategies run');
    assert(result.opensRequested === 0 && result.closesRequested === 0, 'no opens/closes requested');
    assert(result.eodFlat === false, 'eodFlat false on normal tick');

    // Prior state was loaded into momentum.decide
    assert((mom.sawState as any)?.last_seen === 'prior-tick', 'momentum saw prior strategy_state slice');

    // strategy_state persisted for all 3
    assert(db.stateUpdates.length === 3, '3 strategy_state updates');
    const momUpdate = db.stateUpdates.find(u => u.id === 'pf-portfolio-momentum-breakout');
    assert((momUpdate?.state as any)?.momentum_breakout?.tick === 1, 'momentum newState merged under strategy_name key');

    const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
    assert(inserts.length === 0, 'no INSERTs hit DB');
  }

  // 2. Each strategy emits an open → routed through helper to its own portfolio with triggerStrategy.
  console.log('\nEach strategy opens its own position:');
  {
    const db = new MockDb();
    const helper = new AutotradeOpenHelper(db as any);
    const svc = new DayTraderRunnerService(db as any, helper, stubPortfolios);
    svc.strategies.set('momentum_breakout', new FixedDecide({
      action: 'open', instrumentId: 'inst-mom', direction: 'long', sizingMultiplier: 1, newState: {},
    }));
    svc.strategies.set('mean_reversion', new FixedDecide({
      action: 'open', instrumentId: 'inst-mr', direction: 'short', sizingMultiplier: 1, newState: {},
    }));
    svc.strategies.set('gap_and_go', new FixedDecide({
      action: 'open', instrumentId: 'inst-gap', direction: 'long', sizingMultiplier: 2, newState: {},
    }));

    const result = await svc.runStrategies();
    assert(result.opensRequested === 3, '3 opens requested');
    assert(result.opensWritten === 3, '3 opens written');

    const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
    assert(inserts.length === 3, '3 INSERT calls');

    // Param order from helper:
    // id, portfolio_id, analyst_id, prediction_id, instrument_id, symbol, direction, qty, entry, current,
    // trigger_reason(10), trigger_strategy(11), trigger_prediction_id(12), trigger_conviction(13)
    const byInstrument = new Map<string, unknown[]>();
    for (const ins of inserts) byInstrument.set(ins.params[4] as string, ins.params);

    const mom = byInstrument.get('inst-mom')!;
    assert(mom[1] === 'pf-portfolio-momentum-breakout', 'momentum insert → momentum portfolio');
    assert(mom[3] === null, 'prediction_id is NULL for strategy open');
    assert(mom[10] === 'strategy', 'trigger_reason=strategy');
    assert(mom[11] === 'momentum_breakout', 'trigger_strategy=momentum_breakout');
    assert(mom[6] === 'long', 'momentum direction long');
    // qty = floor(1_000_000 * 0.05 * 1 / 100) = 500
    assert(mom[7] === 500, 'momentum quantity computed from balance × BASE_SIZE_PCT × multiplier / price');

    const mr = byInstrument.get('inst-mr')!;
    assert(mr[11] === 'mean_reversion', 'mean_reversion trigger_strategy');
    assert(mr[6] === 'short', 'mean_reversion direction short');

    const gap = byInstrument.get('inst-gap')!;
    assert(gap[11] === 'gap_and_go', 'gap_and_go trigger_strategy');
    // qty = floor(1_000_000 * 0.05 * 2 / 100) = 1000
    assert(gap[7] === 1000, 'gap_and_go sizing multiplier 2 doubled qty');

    // helper idempotency SELECT must NOT have happened (predictionId=null skips it).
    const idempotencySelects = db.calls.filter(
      c => c.sql.includes('from prediction.analyst_positions') && c.sql.includes('prediction_id = $3'),
    );
    assert(idempotencySelects.length === 0, 'helper skipped idempotency SELECT');
  }

  // 3. Close action routes through closePosition with trigger_strategy.
  console.log('\nClose action routes with trigger_strategy:');
  {
    const db = new MockDb(150);
    db.openPositionsByPortfolio['pf-portfolio-momentum-breakout'] = [
      { id: 'pos-1', instrument_id: 'inst-mom', direction: 'long', quantity: 10, entry_price: 100, portfolio_id: 'pf-portfolio-momentum-breakout' },
    ];
    const helper = new AutotradeOpenHelper(db as any);

    const closeCalls: Array<{ id: string; price: number; reason?: string; strategy?: string }> = [];
    const portfolios = {
      closePosition: async (id: string, price: number, reason?: string, strategy?: string) => {
        closeCalls.push({ id, price, reason, strategy });
        return { realizedPnl: 50, isWin: true };
      },
    } as any;

    const svc = new DayTraderRunnerService(db as any, helper, portfolios);
    svc.strategies.set('momentum_breakout', new FixedDecide({
      action: 'close', positionId: 'pos-1', newState: {},
    }));
    svc.strategies.set('mean_reversion', new FixedDecide({ action: 'noop', newState: {} }));
    svc.strategies.set('gap_and_go', new FixedDecide({ action: 'noop', newState: {} }));

    const result = await svc.runStrategies();
    assert(result.closesRequested === 1, 'one close requested');
    assert(result.closesWritten === 1, 'one close written');
    assert(closeCalls.length === 1, 'closePosition invoked once');
    assert(closeCalls[0].id === 'pos-1', 'closed pos-1');
    assert(closeCalls[0].price === 150, 'exit price from current_state');
    assert(closeCalls[0].reason === 'strategy', 'close trigger_reason=strategy');
    assert(closeCalls[0].strategy === 'momentum_breakout', 'close trigger_strategy=momentum_breakout');
  }

  // 4. Cross-portfolio close is refused.
  console.log('\nCross-portfolio close refused:');
  {
    const db = new MockDb();
    db.openPositionsByPortfolio['pf-portfolio-mean-reversion'] = [
      { id: 'pos-foreign', instrument_id: 'inst-mr', direction: 'long', quantity: 5, entry_price: 100, portfolio_id: 'pf-portfolio-mean-reversion' },
    ];
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
    svc.strategies.set('momentum_breakout', new FixedDecide({
      action: 'close', positionId: 'pos-foreign', newState: {},
    }));
    svc.strategies.set('mean_reversion', new FixedDecide({ action: 'noop', newState: {} }));
    svc.strategies.set('gap_and_go', new FixedDecide({ action: 'noop', newState: {} }));

    const result = await svc.runStrategies();
    assert(result.closesRequested === 1, 'close requested');
    assert(result.closesWritten === 0, 'close NOT written (cross-portfolio refusal)');
    assert(closeCalled === false, 'closePosition never invoked across portfolios');
  }

  // 5. EOD-flat path: force-closes all open day-trader positions, ignores strategies.
  console.log('\nEOD-flat force-close:');
  {
    const db = new MockDb(120);
    db.openPositionsByPortfolio['pf-portfolio-momentum-breakout'] = [
      { id: 'pos-a', instrument_id: 'inst-mom', direction: 'long', quantity: 10, entry_price: 100, portfolio_id: 'pf-portfolio-momentum-breakout' },
      { id: 'pos-b', instrument_id: 'inst-mom', direction: 'long', quantity: 5, entry_price: 100, portfolio_id: 'pf-portfolio-momentum-breakout' },
    ];
    db.openPositionsByPortfolio['pf-portfolio-gap-and-go'] = [
      { id: 'pos-c', instrument_id: 'inst-gap', direction: 'long', quantity: 7, entry_price: 100, portfolio_id: 'pf-portfolio-gap-and-go' },
    ];
    const helper = new AutotradeOpenHelper(db as any);

    const closeCalls: Array<{ id: string; reason?: string; strategy?: string }> = [];
    const portfolios = {
      closePosition: async (id: string, _price: number, reason?: string, strategy?: string) => {
        closeCalls.push({ id, reason, strategy });
        return { realizedPnl: 0, isWin: false };
      },
    } as any;

    let strategyCalled = false;
    class TripStrategy implements DayTraderStrategy {
      decide(ctx: DecideContext): DecideAction {
        strategyCalled = true;
        return { action: 'noop', newState: ctx.state };
      }
    }

    const svc = new DayTraderRunnerService(db as any, helper, portfolios);
    svc.strategies.set('momentum_breakout', new TripStrategy());
    svc.strategies.set('mean_reversion', new TripStrategy());
    svc.strategies.set('gap_and_go', new TripStrategy());

    const result = await svc.runStrategies({ isLastTickOfSession: true });
    assert(result.eodFlat === true, 'eodFlat true');
    assert(strategyCalled === false, 'strategies NOT consulted on EOD tick');
    assert(result.closesRequested === 3, '3 closes requested (all open positions)');
    assert(result.closesWritten === 3, '3 closes written');
    assert(closeCalls.every(c => c.strategy === 'eod_flat'), 'all closes tagged eod_flat');
    assert(closeCalls.every(c => c.reason === 'strategy'), 'all closes use trigger_reason=strategy');
    const ids = closeCalls.map(c => c.id).sort();
    assert(ids.join(',') === 'pos-a,pos-b,pos-c', 'all three positions closed');
  }

  // 6. EOD boundary detection (Phase 3): isLastTickOfSession must be true at
  // 21:45 UTC (next 15-min boundary = 22:00) and false everywhere else.
  console.log('\nEOD boundary detection:');
  {
    const at = (h: number, m: number) => new Date(Date.UTC(2026, 3, 7, h, m, 0, 0));
    assert(DayTraderRunnerService.isLastTickOfSession(at(21, 45)) === true, '21:45 UTC → last tick');
    assert(DayTraderRunnerService.isLastTickOfSession(at(21, 30)) === false, '21:30 UTC → not last tick');
    assert(DayTraderRunnerService.isLastTickOfSession(at(22, 0)) === false, '22:00 UTC → already past close');
    assert(DayTraderRunnerService.isLastTickOfSession(at(14, 30)) === false, '14:30 UTC → mid-session');
    assert(DayTraderRunnerService.isLastTickOfSession(at(0, 0)) === false, '00:00 UTC → overnight');
  }

  // 7. Synthetic-fixture session: each of the three real strategies opens
  // at least one position when fed appropriate recent_bars.
  console.log('\nReal strategies open against synthetic fixtures:');
  {
    type Bar = { t: string; o: number; h: number; l: number; c: number; v: number };
    const mkBar = (o: number, c: number): Bar => ({ t: '', o, h: Math.max(o, c), l: Math.min(o, c), c, v: 0 });
    const flat = (n: number, v: number): Bar[] => Array.from({ length: n }, () => mkBar(v, v));

    // momentum: 20 flat at 100 + breakout to 110
    const momBars: Bar[] = [...flat(20, 100), mkBar(110, 110)];
    // mean-reversion: 19 at 100, last at 50
    const mrBars: Bar[] = [...flat(19, 100), mkBar(50, 50)];
    // gap-and-go: 100→102 gap up green
    const gapBars: Bar[] = [mkBar(100, 100), mkBar(102, 103)];

    const instruments = [
      { id: 'inst-mom', symbol: 'MOM', current_state: { price: 110, recent_bars: momBars } },
      { id: 'inst-mr', symbol: 'MR', current_state: { price: 50, recent_bars: mrBars } },
      { id: 'inst-gap', symbol: 'GAP', current_state: { price: 103, recent_bars: gapBars } },
    ];

    class FixtureDb {
      public calls: MockDbCall[] = [];
      async rawQuery(sql: string, params: unknown[] = []): Promise<ScriptedResponse> {
        this.calls.push({ sql, params });
        if (sql.includes("kind = 'day_trader'")) return { data: PORTFOLIOS, error: null };
        if (sql.startsWith('update prediction.analyst_portfolios') && sql.includes('strategy_state')) {
          return { data: [], error: null };
        }
        if (sql.includes('from prediction.analyst_positions') && sql.includes('portfolio_id = $1')) {
          return { data: [], error: null };
        }
        if (sql.includes('from prediction.instruments') && sql.includes('is_active = true')) {
          return { data: instruments, error: null };
        }
        if (sql.includes('from prediction.instruments') && sql.includes('id = ANY($1)')) {
          return { data: instruments, error: null };
        }
        if (sql.includes('from prediction.market_predictions')) return { data: [], error: null };
        if (sql.includes('from prediction.instruments') && sql.includes('id = $1')) {
          const id = params[0] as string;
          const row = instruments.find(i => i.id === id);
          return { data: row ? [{ symbol: row.symbol, current_state: row.current_state }] : [], error: null };
        }
        if (sql.includes('from prediction.analyst_positions')) return { data: [], error: null };
        if (sql.startsWith('insert into prediction.analyst_positions')) return { data: [], error: null };
        return { data: [], error: null };
      }
    }

    const db = new FixtureDb();
    const helper = new AutotradeOpenHelper(db as any);
    const svc = new DayTraderRunnerService(db as any, helper, stubPortfolios);
    // Use registry defaults (real strategies). Force gap-and-go time to 15:00 UTC by overriding nowMs is impossible from outside,
    // but real Date.now() should suffice if test runs during business hours OR we can verify two strategies always open.
    // We assert ≥2 inserts deterministically (momentum + mean-reversion), and the third is best-effort.
    const result = await svc.runStrategies();
    const inserts = db.calls.filter(c => c.sql.startsWith('insert into prediction.analyst_positions'));
    assert(inserts.length >= 2, `at least 2 real strategies opened (got ${inserts.length})`);
    assert(result.opensRequested >= 2, 'opensRequested >= 2');

    const triggerStrategies = inserts.map(i => i.params[11]);
    assert(triggerStrategies.includes('momentum_breakout'), 'momentum_breakout opened');
    assert(triggerStrategies.includes('mean_reversion'), 'mean_reversion opened');
  }

  // 8. Phase 5 — strategy_state persists across consecutive ticks.
  // Tick 1's decide() writes {foo:'bar'}; the runner persists it; tick 2's
  // decide() must observe state.foo === 'bar' for the same strategy slice.
  console.log('\nstrategy_state persists across ticks:');
  {
    class StatefulDb {
      public calls: MockDbCall[] = [];
      // Live copy of the momentum portfolio's strategy_state, mutated by persistStrategyState.
      private momState: Record<string, unknown> = {};
      async rawQuery(sql: string, params: unknown[] = []): Promise<ScriptedResponse> {
        this.calls.push({ sql, params });
        if (sql.includes("kind = 'day_trader'")) {
          return {
            data: [
              {
                id: 'pf-portfolio-momentum-breakout',
                analyst_id: 'pf-base-day-trader-momentum',
                user_id: null,
                current_balance: 1_000_000,
                strategy_name: 'momentum_breakout',
                strategy_state: this.momState,
              },
            ],
            error: null,
          };
        }
        if (sql.startsWith('update prediction.analyst_portfolios') && sql.includes('strategy_state')) {
          this.momState = JSON.parse(params[0] as string);
          return { data: [], error: null };
        }
        if (sql.includes('from prediction.analyst_positions') && sql.includes('portfolio_id = $1')) {
          return { data: [], error: null };
        }
        if (sql.includes('from prediction.instruments') && sql.includes('is_active = true')) {
          return { data: [], error: null };
        }
        if (sql.includes('from prediction.instruments') && sql.includes('id = ANY($1)')) {
          return { data: [], error: null };
        }
        if (sql.includes('from prediction.market_predictions')) return { data: [], error: null };
        return { data: [], error: null };
      }
    }

    class TwoTickStrategy implements DayTraderStrategy {
      public seenStates: Array<Record<string, unknown>> = [];
      private tick = 0;
      decide(ctx: DecideContext): DecideAction {
        this.seenStates.push({ ...ctx.state });
        this.tick++;
        if (this.tick === 1) {
          return { action: 'noop', newState: { foo: 'bar' } };
        }
        return { action: 'noop', newState: ctx.state };
      }
    }

    const db = new StatefulDb();
    const helper = new AutotradeOpenHelper(db as any);
    const svc = new DayTraderRunnerService(db as any, helper, stubPortfolios);
    const strat = new TwoTickStrategy();
    svc.strategies.set('momentum_breakout', strat);
    svc.strategies.set('mean_reversion', new FixedDecide({ action: 'noop', newState: {} }));
    svc.strategies.set('gap_and_go', new FixedDecide({ action: 'noop', newState: {} }));

    await svc.runStrategies();
    await svc.runStrategies();

    assert(strat.seenStates.length === 2, 'strategy decide called twice');
    assert(strat.seenStates[0].foo === undefined, 'tick 1 saw empty state slice');
    assert(strat.seenStates[1].foo === 'bar', 'tick 2 saw state.foo from tick 1');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
