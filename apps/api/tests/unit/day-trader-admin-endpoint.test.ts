/**
 * Unit tests for the admin day-trader run-now endpoint
 * (POST /markets/admin/day-trader/run-now).
 *
 * Exercises auth guards + scheduler invocation by instantiating
 * MarketsController directly with mocked dependencies.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MarketsController } from '../../src/markets/markets.controller';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface DbRow {
  data: unknown;
  error: null;
}

class AdminDb {
  public calls: Array<{ sql: string; params: unknown[] }> = [];
  constructor(private readonly isAdmin: boolean) {}
  async rawQuery(sql: string, params: unknown[] = []): Promise<DbRow> {
    this.calls.push({ sql, params });
    if (sql.includes('authz.rbac_user_roles')) {
      return { data: this.isAdmin ? [{ name: 'admin' }] : [], error: null };
    }
    return { data: [], error: null };
  }
}

class MockScheduler {
  public calls: Array<{ manual?: boolean }> = [];
  public cannedRow = {
    id: 'run-stub',
    fired_at: '2026-04-17T14:00:00.000Z',
    market_open: true,
    bars_refreshed: 5,
    bars_refresh_failed: 0,
    portfolios_run: 3,
    opens_written: 2,
    closes_written: 1,
    duration_ms: 123,
    error: null,
  };
  async handleCron(opts: { manual?: boolean } = {}) {
    this.calls.push(opts);
    return this.cannedRow;
  }
}

const noop = {} as any;

function buildController(db: AdminDb, scheduler: MockScheduler): MarketsController {
  // Constructor positional order in apps/api/src/markets/markets.controller.ts.
  // Pad everything we don't exercise with `noop`.
  return new MarketsController(
    db as any,         // DATABASE_SERVICE
    noop,              // MarketsService
    noop,              // NightlyEvaluationService
    noop,              // LearningEngineService
    noop,              // AnalystPortfolioService
    noop,              // UserPortfolioService
    noop,              // LeaderboardService
    noop,              // MonthlyResetService
    noop,              // BenchmarkIngestService
    noop,              // EodSettlementService
    noop,              // OrchestratorBaseDataService
    noop,              // AnalystPipelineService
    noop,              // CrawlerService
    noop,              // PredictorGeneratorService
    noop,              // PredictionGeneratorService
    noop,              // OutcomeTrackingService
    noop,              // StopLossWatcherService
    noop,              // EodForcedBuyService
    noop,              // DayTraderRunnerService
    scheduler as any,  // DayTraderSchedulerService
    noop,              // AuditService
    noop,              // StrategicOverhaulService
    noop,              // AffinityService
    noop,              // NotificationService
    noop,              // FearGreedAlertService
    noop,              // CoordinationService
    noop,              // PerformanceService
    noop,              // WiringService
    noop,              // EnablementService
    noop,              // MessagingService
    noop,              // LlmUsageQueryService
    noop,              // MarketsBarsService
  );
}

async function main(): Promise<void> {
  console.log('\n=== Day-Trader Admin Endpoint Tests ===\n');

  // 1. Admin user → scheduler invoked with { manual: true }, result returned as-is.
  console.log('Admin caller:');
  {
    const db = new AdminDb(true);
    const scheduler = new MockScheduler();
    const ctrl = buildController(db, scheduler);

    const result = await ctrl.triggerDayTraderRunNow({
      user: { id: 'u-admin', role: 'admin' },
    });

    assert(scheduler.calls.length === 1, 'scheduler.handleCron invoked once');
    assert(scheduler.calls[0].manual === true, 'handleCron invoked with { manual: true }');
    assert(result === scheduler.cannedRow, 'controller returns the scheduler result verbatim');

    const rbacCalls = db.calls.filter(c => c.sql.includes('authz.rbac_user_roles'));
    assert(rbacCalls.length === 1, 'admin check ran once');
    assert(rbacCalls[0].params[0] === 'u-admin', 'admin check scoped to caller user id');
  }

  // 2. Non-admin caller → ForbiddenException, scheduler never invoked.
  console.log('\nNon-admin caller:');
  {
    const db = new AdminDb(false);
    const scheduler = new MockScheduler();
    const ctrl = buildController(db, scheduler);

    let thrown: unknown = null;
    try {
      await ctrl.triggerDayTraderRunNow({
        user: { id: 'u-user', role: 'user' },
      });
    } catch (err) {
      thrown = err;
    }
    assert(thrown instanceof ForbiddenException, 'non-admin gets ForbiddenException');
    assert(scheduler.calls.length === 0, 'scheduler never invoked for non-admin');
  }

  // 3. Unauthenticated caller → BadRequestException from getUser.
  console.log('\nUnauthenticated caller:');
  {
    const db = new AdminDb(true);
    const scheduler = new MockScheduler();
    const ctrl = buildController(db, scheduler);

    let thrown: unknown = null;
    try {
      await ctrl.triggerDayTraderRunNow({});
    } catch (err) {
      thrown = err;
    }
    assert(thrown instanceof BadRequestException, 'missing user throws BadRequestException');
    assert(scheduler.calls.length === 0, 'scheduler never invoked when unauthenticated');
  }

  // 4. Scheduler throws → error propagates out of the controller.
  console.log('\nScheduler throws propagates:');
  {
    const db = new AdminDb(true);
    const scheduler = new MockScheduler();
    scheduler.handleCron = async () => { throw new Error('scheduler boom'); };
    const ctrl = buildController(db, scheduler);

    let thrown: unknown = null;
    try {
      await ctrl.triggerDayTraderRunNow({
        user: { id: 'u-admin', role: 'admin' },
      });
    } catch (err) {
      thrown = err;
    }
    assert(thrown instanceof Error, 'scheduler error propagated');
    assert((thrown as Error).message === 'scheduler boom', 'error message preserved');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
