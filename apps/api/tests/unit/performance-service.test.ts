/**
 * Unit tests for PerformanceService — dashboard aggregation logic.
 * Tests metrics computation, trend detection, and edge cases.
 */
import { PerformanceService } from '../../src/markets/services/performance.service';
import type { PerformanceDashboardResponse } from '../../src/markets/services/performance.service';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

function assertClose(actual: number, expected: number, tolerance: number, label: string): void {
  assert(Math.abs(actual - expected) <= tolerance, `${label} (got ${actual}, expected ~${expected})`);
}

interface MockCall { sql: string; params: unknown[] }
class MockDb {
  public calls: MockCall[] = [];
  private responses: Array<{ data?: unknown; error?: { message: string } | null }>;
  private callIdx = 0;
  constructor(responses: Array<{ data?: unknown; error?: { message: string } | null }>) {
    this.responses = responses;
  }
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    return this.responses[this.callIdx++] ?? { data: [] };
  }
}

class MockSchema {
  async ensureSchema() { /* no-op */ }
}

function buildService(db: MockDb): PerformanceService {
  return new (PerformanceService as unknown as {
    new (db: MockDb, schema: MockSchema): PerformanceService;
  })(db, new MockSchema());
}

async function main(): Promise<void> {
  console.log('\n=== PerformanceService Tests ===\n');

  // ─── Full dashboard with data ───

  console.log('Full dashboard — all data present:');
  {
    const db = new MockDb([
      // 1. fetchPortfolio
      { data: [{ current_balance: 1050000, total_realized_pnl: 50000, total_unrealized_pnl: 5000 }] },
      // 2. fetchEquityCurve
      { data: [
        { date: '2026-04-01', balance: 1000000, daily_pnl: 0 },
        { date: '2026-04-02', balance: 1010000, daily_pnl: 10000 },
        { date: '2026-04-03', balance: 1050000, daily_pnl: 40000 },
      ] },
      // 3. fetchBenchmark
      { data: [
        { date: '2026-04-01', close: 500 },
        { date: '2026-04-02', close: 505 },
      ] },
      // 4. fetchPositionStats
      { data: [{ active_count: 3, closed_count: 10, wins: 7, avg_gain: 15000, avg_loss: -8000 }] },
      // 5. fetchTodayChange
      { data: [{ ending_balance: 1050000, starting_balance: 1040000 }] },
      // 6. fetchAnalystLeaderboard
      { data: [
        { analyst_id: 'a1', name: 'Alpha', accuracy_rate: 0.72, calibration_score: 0.85, sample_size: 50, accuracy_7d: 0.80, accuracy_30d: 0.72 },
        { analyst_id: 'a2', name: 'Beta', accuracy_rate: 0.60, calibration_score: 0.70, sample_size: 30, accuracy_7d: 0.50, accuracy_30d: 0.60 },
        { analyst_id: 'a3', name: 'Gamma', accuracy_rate: 0.65, calibration_score: null, sample_size: 15, accuracy_7d: 0.66, accuracy_30d: 0.65 },
      ] },
    ]);

    const svc = buildService(db);
    const result: PerformanceDashboardResponse = await svc.getDashboardData('user-1', 30);

    assert(result.has_portfolio === true, 'has_portfolio is true');
    assert(result.metrics !== null, 'metrics not null');
    if (result.metrics) {
      assert(result.metrics.portfolio_value === 1050000, 'portfolio_value = 1050000');
      assert(result.metrics.today_change === 10000, 'today_change = 10000');
      assertClose(result.metrics.today_change_pct, 0.96, 0.01, 'today_change_pct ≈ 0.96%');
      assert(result.metrics.active_positions === 3, 'active_positions = 3');
      assert(result.metrics.total_realized_pnl === 50000, 'total_realized_pnl = 50000');
      assert(result.metrics.total_unrealized_pnl === 5000, 'total_unrealized_pnl = 5000');
      assert(result.metrics.win_rate === 70, 'win_rate = 70%');
      assert(result.metrics.avg_gain === 15000, 'avg_gain = 15000');
      assert(result.metrics.avg_loss === -8000, 'avg_loss = -8000');
    }

    // Equity curve
    assert(result.equity_curve.length === 3, 'equity_curve has 3 points');
    assert(result.equity_curve[0].balance === 1000000, 'first equity point balance');

    // Benchmark
    assert(result.benchmark.length === 2, 'benchmark has 2 points');
    assert(result.benchmark[0].close === 500, 'first benchmark close');

    // Analysts
    assert(result.analysts.length === 3, '3 analysts returned');

    // Next evaluation
    assert(result.next_evaluation_at !== null, 'next_evaluation_at set');
    assert(new Date(result.next_evaluation_at!).getTime() > Date.now(), 'next eval is in the future');
  }

  // ─── Trend detection ───

  console.log('\nTrend detection:');
  {
    const db = new MockDb([
      { data: [{ current_balance: 1000000, total_realized_pnl: 0, total_unrealized_pnl: 0 }] },
      { data: [] },
      { data: [] },
      { data: [{ active_count: 0, closed_count: 0, wins: 0, avg_gain: null, avg_loss: null }] },
      { data: [] },
      { data: [
        // improving: 7d (80) - 30d (70) = 10 > 5
        { analyst_id: 'a1', name: 'Improver', accuracy_rate: 0.70, calibration_score: 0.80, sample_size: 40, accuracy_7d: 0.80, accuracy_30d: 0.70 },
        // declining: 7d (50) - 30d (70) = -20 < -5
        { analyst_id: 'a2', name: 'Decliner', accuracy_rate: 0.70, calibration_score: 0.75, sample_size: 40, accuracy_7d: 0.50, accuracy_30d: 0.70 },
        // stable: 7d (72) - 30d (70) = 2, within ±5
        { analyst_id: 'a3', name: 'Stable', accuracy_rate: 0.70, calibration_score: 0.70, sample_size: 40, accuracy_7d: 0.72, accuracy_30d: 0.70 },
        // stable: null 7d
        { analyst_id: 'a4', name: 'NoData', accuracy_rate: null, calibration_score: null, sample_size: 5, accuracy_7d: null, accuracy_30d: null },
      ] },
    ]);

    const svc = buildService(db);
    const result = await svc.getDashboardData('user-1', 30);
    assert(result.analysts[0].trend === 'improving', 'a1 trend = improving');
    assert(result.analysts[1].trend === 'declining', 'a2 trend = declining');
    assert(result.analysts[2].trend === 'stable', 'a3 trend = stable');
    assert(result.analysts[3].trend === 'stable', 'a4 null data = stable');
  }

  // ─── No portfolio ───

  console.log('\nNo portfolio:');
  {
    const db = new MockDb([
      { data: [] },  // no portfolio
      { data: [] },
      { data: [] },
      { data: [{ active_count: 0, closed_count: 0, wins: 0, avg_gain: null, avg_loss: null }] },
      { data: [] },
      { data: [] },
    ]);

    const svc = buildService(db);
    const result = await svc.getDashboardData('user-1', 30);
    assert(result.has_portfolio === false, 'has_portfolio is false');
    assert(result.metrics === null, 'metrics is null when no portfolio');
    assert(result.equity_curve.length === 0, 'empty equity curve');
  }

  // ─── Win rate with no closed positions ───

  console.log('\nWin rate — no closed positions:');
  {
    const db = new MockDb([
      { data: [{ current_balance: 1000000, total_realized_pnl: 0, total_unrealized_pnl: 0 }] },
      { data: [] },
      { data: [] },
      { data: [{ active_count: 2, closed_count: 0, wins: 0, avg_gain: null, avg_loss: null }] },
      { data: [] },
      { data: [] },
    ]);

    const svc = buildService(db);
    const result = await svc.getDashboardData('user-1', 30);
    assert(result.metrics?.win_rate === null, 'win_rate null when no closed positions');
    assert(result.metrics?.avg_gain === null, 'avg_gain null when no closed positions');
    assert(result.metrics?.avg_loss === null, 'avg_loss null when no closed positions');
    assert(result.metrics?.active_positions === 2, 'active_positions = 2');
  }

  // ─── Today change with no snapshots ───

  console.log('\nToday change — no snapshots:');
  {
    const db = new MockDb([
      { data: [{ current_balance: 1000000, total_realized_pnl: 0, total_unrealized_pnl: 0 }] },
      { data: [] },
      { data: [] },
      { data: [{ active_count: 0, closed_count: 0, wins: 0, avg_gain: null, avg_loss: null }] },
      { data: [] },  // no today snapshot
      { data: [] },
    ]);

    const svc = buildService(db);
    const result = await svc.getDashboardData('user-1', 30);
    assert(result.metrics?.today_change === 0, 'today_change = 0 when no snapshot');
    assert(result.metrics?.today_change_pct === 0, 'today_change_pct = 0 when no snapshot');
  }

  // ─── Days param clamping (tested via controller, verified SQL) ───

  console.log('\nDays param in SQL:');
  {
    const db = new MockDb([
      { data: [] }, { data: [] }, { data: [] },
      { data: [{ active_count: 0, closed_count: 0, wins: 0, avg_gain: null, avg_loss: null }] },
      { data: [] }, { data: [] },
    ]);
    const svc = buildService(db);
    await svc.getDashboardData('user-1', 90);
    // Check equity curve query uses days param
    const equityCall = db.calls[1];
    assert(equityCall.params[1] === 90, 'equity curve query receives days param');
    // Check benchmark query uses days param
    const benchmarkCall = db.calls[2];
    assert(benchmarkCall.params[0] === 90, 'benchmark query receives days param');
  }

  // ─── Summary ───

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
