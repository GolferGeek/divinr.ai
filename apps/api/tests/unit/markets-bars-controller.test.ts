/**
 * Unit tests for MarketsController.getLatestBars — the
 * GET /markets/bars/latest?symbols=... handler.
 *
 * Exercises query-param validation, per-symbol null fallbacks,
 * and case/dedupe normalization by instantiating MarketsController
 * directly with a mock MarketsBarsService.
 */
import { BadRequestException } from '@nestjs/common';
import { MarketsController } from '../../src/markets/markets.controller';
import type { IntradayBar } from '../../src/markets/adapters/twelve-data.adapter';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

function bar(t: string, o: number): IntradayBar {
  return { t, o, h: o + 1, l: o - 1, c: o + 0.5, v: 1000 };
}

class MockMarketsBarsService {
  public calls: string[][] = [];
  public programmed = new Map<string, IntradayBar[]>();
  async getIntradayBarsForSymbols(symbols: string[]): Promise<Map<string, IntradayBar[]>> {
    this.calls.push([...symbols]);
    const map = new Map<string, IntradayBar[]>();
    for (const s of symbols) map.set(s, this.programmed.get(s) ?? []);
    return map;
  }
}

const noop = {} as any;

function buildController(bars: MockMarketsBarsService): MarketsController {
  return new MarketsController(
    noop,  // DATABASE_SERVICE
    noop,  // MarketsService
    noop,  // NightlyEvaluationService
    noop,  // LearningEngineService
    noop,  // AnalystPortfolioService
    noop,  // UserPortfolioService
    noop,  // LeaderboardService
    noop,  // MonthlyResetService
    noop,  // BenchmarkIngestService
    noop,  // EodSettlementService
    noop,  // OrchestratorBaseDataService
    noop,  // AnalystPipelineService
    noop,  // CrawlerService
    noop,  // PredictorGeneratorService
    noop,  // PredictionGeneratorService
    noop,  // OutcomeTrackingService
    noop,  // StopLossWatcherService
    noop,  // EodForcedBuyService
    noop,  // DayTraderRunnerService
    noop,  // DayTraderSchedulerService
    noop,  // AuditService
    noop,  // StrategicOverhaulService
    noop,  // AffinityService
    noop,  // NotificationService
    noop,  // FearGreedAlertService
    noop,  // CoordinationService
    noop,  // PerformanceService
    noop,  // WiringService
    noop,  // EnablementService
    noop,  // MessagingService
    noop,  // LlmUsageQueryService
    bars as any,  // MarketsBarsService
  );
}

const user = { user: { id: 'u-1' } };

async function expectBadRequest(fn: () => Promise<unknown>, label: string): Promise<void> {
  let thrown: unknown = null;
  try { await fn(); } catch (err) { thrown = err; }
  assert(thrown instanceof BadRequestException, label);
}

async function main(): Promise<void> {
  console.log('\n=== MarketsController.getLatestBars ===\n');

  // 1. Valid symbols → controller returns { [symbol]: bar | null } keyed in request order.
  console.log('Happy path:');
  {
    const svc = new MockMarketsBarsService();
    svc.programmed.set('AAPL', [bar('2026-04-17 15:00:00', 210)]);
    svc.programmed.set('MSFT', [bar('2026-04-17 15:00:00', 420), bar('2026-04-17 16:00:00', 425)]);
    svc.programmed.set('NVDA', []); // no bars → null
    const ctrl = buildController(svc);
    const result = await ctrl.getLatestBars(user, 'AAPL,MSFT,NVDA');
    assert(svc.calls.length === 1, 'service called once');
    assert(JSON.stringify(Object.keys(result)) === JSON.stringify(['AAPL', 'MSFT', 'NVDA']), 'keys preserve request order');
    assert((result.AAPL as IntradayBar).o === 210, 'AAPL last bar is the lone cached bar');
    assert((result.MSFT as IntradayBar).o === 425, 'MSFT last bar is the newest (last element)');
    assert(result.NVDA === null, 'NVDA with no bars returns null');
  }

  // 2. Case-insensitive input normalized to uppercase; duplicates deduped.
  console.log('\nNormalization:');
  {
    const svc = new MockMarketsBarsService();
    svc.programmed.set('AAPL', [bar('t', 1)]);
    const ctrl = buildController(svc);
    const result = await ctrl.getLatestBars(user, 'aapl,AAPL,Aapl');
    assert(svc.calls[0].length === 1 && svc.calls[0][0] === 'AAPL', 'service called with single AAPL');
    assert(JSON.stringify(Object.keys(result)) === JSON.stringify(['AAPL']), 'response keyed on AAPL only');
  }

  // 3. Missing symbols param → 400.
  console.log('\nValidation errors:');
  {
    const svc = new MockMarketsBarsService();
    const ctrl = buildController(svc);
    await expectBadRequest(() => ctrl.getLatestBars(user, undefined), 'missing symbols → BadRequestException');
    await expectBadRequest(() => ctrl.getLatestBars(user, ''), 'empty symbols → BadRequestException');
    await expectBadRequest(() => ctrl.getLatestBars(user, '   '), 'whitespace symbols → BadRequestException');
    await expectBadRequest(() => ctrl.getLatestBars(user, ',,,'), 'only-commas → BadRequestException');
    await expectBadRequest(() => ctrl.getLatestBars(user, 'AAPL;DROP'), 'illegal char → BadRequestException');
    await expectBadRequest(() => ctrl.getLatestBars(user, 'VERYLONGSYMBOL'), '>10 chars → BadRequestException');
    const many = Array.from({ length: 51 }, (_, i) => `SYM${i}`).join(',');
    await expectBadRequest(() => ctrl.getLatestBars(user, many), '>50 symbols → BadRequestException');
    assert(svc.calls.length === 0, 'service never called on validation failure');
  }

  // 4. Unauthenticated call → BadRequestException from getUser.
  console.log('\nAuth guard:');
  {
    const svc = new MockMarketsBarsService();
    const ctrl = buildController(svc);
    await expectBadRequest(() => ctrl.getLatestBars({} as any, 'AAPL'), 'missing user → BadRequestException');
    assert(svc.calls.length === 0, 'service never called without user');
  }

  // 5. DI decorator present on the new constructor param.
  console.log('\nDI decorator on constructor param:');
  {
    const src = await import('fs').then(m => m.readFileSync(
      require.resolve('../../src/markets/markets.controller'),
      'utf8',
    ));
    assert(src.includes('@Inject(MarketsBarsService)'), '@Inject(MarketsBarsService) present on controller');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
