/**
 * Unit tests for DayTraderSchedulerService (Phase 3 of live-prediction-pnl).
 *
 * Verifies the market-hours gate, bar-refresher + runner orchestration,
 * audit-row persistence, cron disable env flag, market-hours override, and
 * error propagation from the runner.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DayTraderSchedulerService } from '../../src/markets/services/day-trader-scheduler.service';

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

interface MockDbCall {
  sql: string;
  params: unknown[];
}

class MockDb {
  public calls: MockDbCall[] = [];
  public auditRows: Record<string, unknown>[] = [];
  async rawQuery(sql: string, params: unknown[] = []): Promise<{ data: unknown; error: null }> {
    this.calls.push({ sql, params });
    if (sql.includes('from prediction.instruments') && sql.includes('is_active = true')) {
      return {
        data: [
          { id: 'inst-A', symbol: 'AAA' },
          { id: 'inst-B', symbol: 'BBB' },
        ],
        error: null,
      };
    }
    if (sql.startsWith('insert into prediction.market_day_trader_runs')) {
      const row = {
        id: `run-${this.auditRows.length + 1}`,
        fired_at: new Date().toISOString(),
        market_open: params[0] as boolean,
        bars_refreshed: params[1] as number,
        bars_refresh_failed: params[2] as number,
        portfolios_run: params[3] as number,
        opens_written: params[4] as number,
        closes_written: params[5] as number,
        duration_ms: params[6] as number,
        error: params[7] as string | null,
      };
      this.auditRows.push(row);
      return { data: [row], error: null };
    }
    return { data: [], error: null };
  }
}

class MockRunner {
  public calls: Array<{ isLastTickOfSession?: boolean }> = [];
  public nextResult: {
    strategiesRun: number;
    opensWritten: number;
    closesWritten: number;
  } = { strategiesRun: 3, opensWritten: 0, closesWritten: 0 };
  public throwError: Error | null = null;
  async runStrategies(opts: { isLastTickOfSession?: boolean } = {}): Promise<{
    strategiesRun: number;
    opensRequested: number;
    opensWritten: number;
    closesRequested: number;
    closesWritten: number;
    eodFlat: boolean;
  }> {
    this.calls.push(opts);
    if (this.throwError) throw this.throwError;
    return {
      strategiesRun: this.nextResult.strategiesRun,
      opensRequested: this.nextResult.opensWritten,
      opensWritten: this.nextResult.opensWritten,
      closesRequested: this.nextResult.closesWritten,
      closesWritten: this.nextResult.closesWritten,
      eodFlat: opts.isLastTickOfSession ?? false,
    };
  }
}

class MockRefresher {
  public calls: Array<Array<{ id: string; symbol: string }>> = [];
  public nextResult: { refreshed: number; failed: number } = { refreshed: 0, failed: 0 };
  async refreshBarsFor(
    instruments: Array<{ id: string; symbol: string }>,
  ): Promise<{ refreshed: number; failed: number }> {
    this.calls.push(instruments);
    return this.nextResult;
  }
}

class MockMarketHours {
  constructor(private open: boolean) {}
  isUsEquityMarketOpen(_now: Date): boolean {
    return this.open;
  }
}

async function main(): Promise<void> {
  console.log('\n=== DayTraderSchedulerService Tests ===\n');

  // 1. Market closed → writes audit row with market_open=false and skips runner/refresher.
  console.log('Market closed path:');
  {
    const db = new MockDb();
    const runner = new MockRunner();
    const refresher = new MockRefresher();
    const hours = new MockMarketHours(false);
    const svc = new DayTraderSchedulerService(
      db as any,
      runner as any,
      refresher as any,
      hours as any,
    );

    const row = await svc.handleCron({ manual: true });

    assert(db.auditRows.length === 1, 'exactly 1 audit row inserted');
    assert(row.market_open === false, 'audit market_open=false');
    assert(row.bars_refreshed === 0, 'no bars refreshed');
    assert(row.portfolios_run === 0, 'no portfolios run');
    assert(row.error === null, 'no error recorded');
    assert(runner.calls.length === 0, 'runner NOT called when market closed');
    assert(refresher.calls.length === 0, 'refresher NOT called when market closed');
  }

  // 2. Market open → loads instruments, refreshes bars, runs strategies, writes audit row.
  console.log('\nMarket open happy path:');
  {
    const db = new MockDb();
    const runner = new MockRunner();
    runner.nextResult = { strategiesRun: 3, opensWritten: 2, closesWritten: 1 };
    const refresher = new MockRefresher();
    refresher.nextResult = { refreshed: 2, failed: 0 };
    const hours = new MockMarketHours(true);
    const svc = new DayTraderSchedulerService(
      db as any,
      runner as any,
      refresher as any,
      hours as any,
    );

    const row = await svc.handleCron({ manual: true });

    assert(refresher.calls.length === 1, 'refresher called once');
    assert(refresher.calls[0].length === 2, 'refresher received 2 instruments');
    assert(runner.calls.length === 1, 'runner called once');
    assert(row.market_open === true, 'audit market_open=true');
    assert(row.bars_refreshed === 2, 'audit bars_refreshed=2');
    assert(row.bars_refresh_failed === 0, 'audit bars_refresh_failed=0');
    assert(row.portfolios_run === 3, 'audit portfolios_run=3');
    assert(row.opens_written === 2, 'audit opens_written=2');
    assert(row.closes_written === 1, 'audit closes_written=1');
    assert(row.error === null, 'no error');
    assert(typeof row.duration_ms === 'number' && row.duration_ms >= 0, 'duration_ms recorded');
  }

  // 3. Runner throws → audit row records error, exception propagates.
  console.log('\nRunner throws → audit error + rethrow:');
  {
    const db = new MockDb();
    const runner = new MockRunner();
    runner.throwError = new Error('strategy boom');
    const refresher = new MockRefresher();
    refresher.nextResult = { refreshed: 2, failed: 0 };
    const hours = new MockMarketHours(true);
    const svc = new DayTraderSchedulerService(
      db as any,
      runner as any,
      refresher as any,
      hours as any,
    );

    let thrown: unknown = null;
    try {
      await svc.handleCron({ manual: true });
    } catch (err) {
      thrown = err;
    }
    assert(thrown instanceof Error, 'handleCron re-threw an Error');
    assert((thrown as Error).message === 'strategy boom', 'propagated error message preserved');
    assert(db.auditRows.length === 1, 'audit row still written on error');
    assert(db.auditRows[0].error === 'strategy boom', 'audit row records error message');
    assert(db.auditRows[0].market_open === true, 'audit row market_open=true');
  }

  // 4. scheduledTick honours DAY_TRADER_DISABLE_CRON=true.
  console.log('\nDAY_TRADER_DISABLE_CRON=true early return:');
  {
    const db = new MockDb();
    const runner = new MockRunner();
    const refresher = new MockRefresher();
    const hours = new MockMarketHours(true);
    const svc = new DayTraderSchedulerService(
      db as any,
      runner as any,
      refresher as any,
      hours as any,
    );

    const prev = process.env.DAY_TRADER_DISABLE_CRON;
    process.env.DAY_TRADER_DISABLE_CRON = 'true';
    try {
      await svc.scheduledTick();
    } finally {
      if (prev === undefined) delete process.env.DAY_TRADER_DISABLE_CRON;
      else process.env.DAY_TRADER_DISABLE_CRON = prev;
    }
    assert(db.auditRows.length === 0, 'no audit rows when cron disabled');
    assert(runner.calls.length === 0, 'runner not called when cron disabled');
  }

  // 5. DI safety — constructor params must all use explicit @Inject per CLAUDE.md.
  console.log('\nConstructor DI annotations:');
  {
    const file = resolve(
      process.cwd(),
      'src/markets/services/day-trader-scheduler.service.ts',
    );
    const src = readFileSync(file, 'utf8');
    assert(
      src.includes('@Inject(DATABASE_SERVICE)'),
      'DB service constructor uses @Inject(DATABASE_SERVICE)',
    );
    assert(
      src.includes('@Inject(DayTraderRunnerService)'),
      'runner constructor uses @Inject(DayTraderRunnerService)',
    );
    assert(
      src.includes('@Inject(IntradayBarRefresherService)'),
      'refresher constructor uses @Inject(IntradayBarRefresherService)',
    );
    assert(
      src.includes('@Inject(MarketHoursService)'),
      'market-hours constructor uses @Inject(MarketHoursService)',
    );
    assert(
      src.includes("const DEFAULT_CRON = '0 14,17,20 * * 1-5'"),
      'default day-trader cadence is throttled to three demo ticks per market day',
    );
  }

  // 6. forceEodFlat=true → runner called with isLastTickOfSession=true regardless of time.
  console.log('\nforceEodFlat=true forces eod-flat branch:');
  {
    const db = new MockDb();
    const runner = new MockRunner();
    runner.nextResult = { strategiesRun: 3, opensWritten: 0, closesWritten: 4 };
    const refresher = new MockRefresher();
    refresher.nextResult = { refreshed: 2, failed: 0 };
    const hours = new MockMarketHours(true);
    const svc = new DayTraderSchedulerService(
      db as any,
      runner as any,
      refresher as any,
      hours as any,
    );

    const row = await svc.handleCron({ forceEodFlat: true });

    assert(runner.calls.length === 1, 'runner called once');
    assert(runner.calls[0].isLastTickOfSession === true, 'runner received isLastTickOfSession=true');
    assert(row.market_open === true, 'audit market_open=true');
    assert(row.closes_written === 4, 'audit closes_written reflects forced flat');
  }

  // 7. Second @Cron method exists for EOD flat with America/New_York timezone.
  console.log('\nEOD @Cron is registered with America/New_York timezone:');
  {
    const file = resolve(
      process.cwd(),
      'src/markets/services/day-trader-scheduler.service.ts',
    );
    const src = readFileSync(file, 'utf8');
    assert(src.includes('scheduledEodFlat'), 'scheduledEodFlat method present');
    assert(
      src.includes("timeZone: EOD_CRON_TZ") || src.includes("timeZone: 'America/New_York'"),
      'EOD cron decorated with America/New_York timezone',
    );
    assert(src.includes('DAY_TRADER_EOD_CRON'), 'DAY_TRADER_EOD_CRON env override supported');
    assert(src.includes('forceEodFlat'), 'forceEodFlat path threaded through handleCron');
  }

  // 8. Outcome-tracking no longer invokes the day-trader runner.
  console.log('\nOutcomeTrackingService decoupled from day-trader runner:');
  {
    const file = resolve(
      process.cwd(),
      'src/markets/services/outcome-tracking.service.ts',
    );
    const src = readFileSync(file, 'utf8');
    assert(!src.includes('DayTraderRunnerService'), 'no DayTraderRunnerService references');
    assert(!src.includes('runStrategies'), 'no runStrategies call left behind');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
