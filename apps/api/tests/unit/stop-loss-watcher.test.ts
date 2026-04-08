/**
 * Unit tests for StopLossWatcherService (Agent Autotrading — Phase 2).
 *
 * Most tests target the pure static `decide()` helper which contains the
 * stop / take-profit / trailing logic. A small set of integration tests
 * exercise `sweep()` end-to-end with a scripted MockDb to verify the SQL
 * filters (kind in analyst/arbitrator) and the close-vs-update branches.
 */
import { StopLossWatcherService } from '../../src/markets/services/stop-loss-watcher.service';

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

class MockPortfolios {
  public closed: Array<{ id: string; exitPrice: number; reason: string | undefined }> = [];
  async closePosition(id: string, exitPrice: number, reason?: string): Promise<{ realizedPnl: number; isWin: boolean }> {
    this.closed.push({ id, exitPrice, reason });
    return { realizedPnl: 0, isWin: false };
  }
}

async function main(): Promise<void> {
console.log('\n=== StopLossWatcherService Tests ===\n');

// ─── Pure decide() — long ───────────────────────────────────────
console.log('decide() long positions:');
{
  const r = StopLossWatcherService.decide({ direction: 'long', entryPrice: 100, currentPrice: 95, highWaterMark: null });
  assert(r.closeReason === 'stop_loss', 'long: -5% → stop_loss');
}
{
  const r = StopLossWatcherService.decide({ direction: 'long', entryPrice: 100, currentPrice: 94, highWaterMark: null });
  assert(r.closeReason === 'stop_loss', 'long: -6% → stop_loss');
}
{
  const r = StopLossWatcherService.decide({ direction: 'long', entryPrice: 100, currentPrice: 96, highWaterMark: null });
  assert(r.closeReason === null, 'long: -4% → no close');
}
{
  const r = StopLossWatcherService.decide({ direction: 'long', entryPrice: 100, currentPrice: 110, highWaterMark: null });
  assert(r.closeReason === 'take_profit', 'long: +10% → take_profit');
}
{
  const r = StopLossWatcherService.decide({ direction: 'long', entryPrice: 100, currentPrice: 109, highWaterMark: null });
  assert(r.closeReason === null, 'long: +9% → no close (yet)');
}
{
  // No prior HWM, current = 107 → HWM updates to 107, favorable +7% (>= 5% arm),
  // giveback from HWM = (107-107)/107 = 0% → no close.
  const r = StopLossWatcherService.decide({ direction: 'long', entryPrice: 100, currentPrice: 107, highWaterMark: null });
  assert(r.closeReason === null, 'long: +7% never given back → no trailing close');
  assert(r.newHighWaterMark === 107, 'long: HWM updates to current');
}
{
  // HWM is 108, current is 102.5: HWM stays 108 (current < HWM for long).
  // hwmFavorable = +8% (>= 5% armed). Giveback = (108-102.5)/108 ≈ 5.09% → trailing close.
  const r = StopLossWatcherService.decide({ direction: 'long', entryPrice: 100, currentPrice: 102.5, highWaterMark: 108 });
  assert(r.closeReason === 'trailing_stop', 'long: HWM 108 → 102.5 (5.09% giveback) → trailing_stop');
}
{
  // HWM is 108, current is 103.5: giveback = (108-103.5)/108 ≈ 4.17% → no close.
  const r = StopLossWatcherService.decide({ direction: 'long', entryPrice: 100, currentPrice: 103.5, highWaterMark: 108 });
  assert(r.closeReason === null, 'long: HWM 108 → 103.5 (4.17% giveback) → no close');
}
{
  // HWM is 103 (only +3% favorable, below arm threshold). Current dips to 97.
  // Stop-loss bar (-3%) hasn't fired. Trailing not armed yet. → no close.
  const r = StopLossWatcherService.decide({ direction: 'long', entryPrice: 100, currentPrice: 97, highWaterMark: 103 });
  assert(r.closeReason === null, 'long: HWM only +3% (not yet armed) → no trailing close');
}
{
  // Existing HWM 102, current rises to 106 → HWM should update to 106.
  const r = StopLossWatcherService.decide({ direction: 'long', entryPrice: 100, currentPrice: 106, highWaterMark: 102 });
  assert(r.newHighWaterMark === 106, 'long: HWM monotonic up');
}
{
  // Existing HWM 106, current dips to 104 → HWM should NOT decrease.
  const r = StopLossWatcherService.decide({ direction: 'long', entryPrice: 100, currentPrice: 104, highWaterMark: 106 });
  assert(r.newHighWaterMark === 106, 'long: HWM does not decrease when current dips');
}

// ─── Pure decide() — short ──────────────────────────────────────
console.log('\ndecide() short positions:');
{
  // Short stop-loss: price went UP 5% from entry → -5% favorable.
  const r = StopLossWatcherService.decide({ direction: 'short', entryPrice: 100, currentPrice: 105, highWaterMark: null });
  assert(r.closeReason === 'stop_loss', 'short: +5% adverse → stop_loss');
}
{
  // Short take-profit: price down 10% → +10% favorable.
  const r = StopLossWatcherService.decide({ direction: 'short', entryPrice: 100, currentPrice: 90, highWaterMark: null });
  assert(r.closeReason === 'take_profit', 'short: -10% adverse → take_profit');
}
{
  // Short trailing: HWM (= best favorable absolute price = lowest seen) is 92.
  // Current = 96.7: hwmFavorable = (100-92)/100 = 8% (armed).
  // Giveback for short = (96.7-92)/92 ≈ 5.11% → trailing close.
  const r = StopLossWatcherService.decide({ direction: 'short', entryPrice: 100, currentPrice: 96.7, highWaterMark: 92 });
  assert(r.closeReason === 'trailing_stop', 'short: HWM 92 → 96.7 (5.11% giveback) → trailing_stop');
}
{
  // Short HWM monotonic down: current 94, HWM 92 → HWM stays 92 (we want lowest).
  const r = StopLossWatcherService.decide({ direction: 'short', entryPrice: 100, currentPrice: 94, highWaterMark: 92 });
  assert(r.newHighWaterMark === 92, 'short: HWM does not increase when current rises');
}
{
  // Short HWM monotonic down: current 91, HWM 92 → HWM updates to 91.
  const r = StopLossWatcherService.decide({ direction: 'short', entryPrice: 100, currentPrice: 91, highWaterMark: 92 });
  assert(r.newHighWaterMark === 91, 'short: HWM moves to new lowest');
}

// ─── Edge: stop and take-profit precedence over trailing ────────
console.log('\nPrecedence:');
{
  // Even with HWM 110 (10% favorable), if current is 95 (-5% absolute), stop_loss fires first.
  const r = StopLossWatcherService.decide({ direction: 'long', entryPrice: 100, currentPrice: 95, highWaterMark: 110 });
  assert(r.closeReason === 'stop_loss', 'stop_loss takes precedence even when trailing would also fire');
}
{
  // +10% take-profit fires before any trailing logic.
  const r = StopLossWatcherService.decide({ direction: 'long', entryPrice: 100, currentPrice: 110, highWaterMark: 105 });
  assert(r.closeReason === 'take_profit', 'take_profit takes precedence over trailing');
}

// ─── sweep() integration with MockDb ────────────────────────────
console.log('\nsweep() integration:');
{
  // Two positions: one analyst at -5% (should close stop_loss),
  // one day-trader at -5% (should NOT be in result set at all).
  const db = new MockDb((sql, _params) => {
    if (sql.includes('from prediction.analyst_positions p') && sql.includes("kind in ('analyst','arbitrator')")) {
      return {
        data: [
          {
            id: 'pos-1',
            direction: 'long',
            entry_price: 100,
            quantity: 10,
            high_water_mark: null,
            instrument_id: 'inst-1',
            symbol: 'NVDA',
            kind: 'analyst',
          },
        ],
        error: null,
      };
    }
    if (sql.includes('from prediction.instruments where id = any')) {
      return { data: [{ id: 'inst-1', current_state: { price: 95 } }], error: null };
    }
    return { data: [], error: null };
  });
  const portfolios = new MockPortfolios();
  const watcher = new StopLossWatcherService(db as any, portfolios as any);
  const result = await watcher.sweep();
  assert(result.closed === 1, 'analyst position at -5% closed');
  assert(portfolios.closed.length === 1, 'closePosition called once');
  assert(portfolios.closed[0].reason === 'stop_loss', 'closePosition called with reason=stop_loss');
  assert(portfolios.closed[0].exitPrice === 95, 'closePosition called with exit price 95');
  // Verify the SELECT filter mentions both eligible kinds and excludes day_trader.
  const selectCall = db.calls.find(c => c.sql.includes('from prediction.analyst_positions p'));
  assert(selectCall !== undefined, 'sweep issued SELECT against analyst_positions');
  assert(selectCall!.sql.includes("kind in ('analyst','arbitrator')"), 'sweep filter excludes day_trader');
}
{
  // Position safely above stop, below take-profit, no trailing armed.
  // Should result in HWM/current_price update, no close.
  const db = new MockDb((sql, _params) => {
    if (sql.includes('from prediction.analyst_positions p')) {
      return {
        data: [
          {
            id: 'pos-2',
            direction: 'long',
            entry_price: 100,
            quantity: 10,
            high_water_mark: null,
            instrument_id: 'inst-1',
            symbol: 'NVDA',
            kind: 'arbitrator',
          },
        ],
        error: null,
      };
    }
    if (sql.includes('from prediction.instruments')) {
      return { data: [{ id: 'inst-1', current_state: { price: 102 } }], error: null };
    }
    return { data: [], error: null };
  });
  const portfolios = new MockPortfolios();
  const watcher = new StopLossWatcherService(db as any, portfolios as any);
  const result = await watcher.sweep();
  assert(result.closed === 0, 'no close when within bounds');
  assert(result.updated === 1, 'HWM/current_price update written');
  assert(portfolios.closed.length === 0, 'closePosition NOT called');
  const updateCall = db.calls.find(c => c.sql.includes('update prediction.analyst_positions'));
  assert(updateCall !== undefined, 'sweep issued UPDATE for HWM');
  assert(updateCall!.params[0] === 102, 'new HWM = current price 102');
  assert(updateCall!.params[1] === 102, 'current_price stamped');
  assert(updateCall!.params[2] === 20, 'unrealized_pnl = (102-100)*10 = 20');
}
{
  // Empty open-position list — sweep is a no-op.
  const db = new MockDb((_sql, _params) => ({ data: [], error: null }));
  const portfolios = new MockPortfolios();
  const watcher = new StopLossWatcherService(db as any, portfolios as any);
  const result = await watcher.sweep();
  assert(result.closed === 0 && result.updated === 0 && result.skipped === 0, 'empty result set → all zeros');
  // No instrument-price lookup should happen
  assert(db.calls.find(c => c.sql.includes('from prediction.instruments')) === undefined, 'skips price lookup when no positions');
}
{
  // Phase 5 — explicit day-trader isolation lock.
  // The production SQL filters `port.kind in ('analyst','arbitrator')`, so
  // day-trader positions must never reach the watcher even if they would
  // otherwise be deep enough to trigger a 10% stop. We script the mock to
  // return a day-trader row ONLY when the kind filter is absent — with the
  // real SQL, the row set is empty and closePosition is never called.
  const dayTraderRow = {
    id: 'pos-dt-deep',
    direction: 'long' as const,
    entry_price: 100,
    quantity: 10,
    high_water_mark: null,
    instrument_id: 'inst-dt',
    symbol: 'DTX',
    kind: 'day_trader',
  };
  const db = new MockDb((sql, _params) => {
    if (sql.includes('from prediction.analyst_positions p')) {
      // If the kind filter were missing, this row would surface and trip a stop.
      if (!sql.includes("kind in ('analyst','arbitrator')")) {
        return { data: [dayTraderRow], error: null };
      }
      return { data: [], error: null };
    }
    if (sql.includes('from prediction.instruments')) {
      // Price 80 → -20% favorable, would deep-trigger 10% stop.
      return { data: [{ id: 'inst-dt', current_state: { price: 80 } }], error: null };
    }
    return { data: [], error: null };
  });
  const portfolios = new MockPortfolios();
  const watcher = new StopLossWatcherService(db as any, portfolios as any);
  const result = await watcher.sweep();
  assert(result.closed === 0, 'day-trader position not closed by stop watcher');
  assert(portfolios.closed.length === 0, 'closePosition never invoked for day-trader');
  const select = db.calls.find(c => c.sql.includes('from prediction.analyst_positions p'));
  assert(select !== undefined, 'sweep issued the SELECT');
  assert(select!.sql.includes("kind in ('analyst','arbitrator')"), 'SELECT still carries kind filter');
}
{
  // Missing current price → skip without crash.
  const db = new MockDb((sql, _params) => {
    if (sql.includes('from prediction.analyst_positions p')) {
      return {
        data: [
          {
            id: 'pos-3',
            direction: 'long',
            entry_price: 100,
            quantity: 10,
            high_water_mark: null,
            instrument_id: 'inst-1',
            symbol: 'NVDA',
            kind: 'analyst',
          },
        ],
        error: null,
      };
    }
    if (sql.includes('from prediction.instruments')) {
      return { data: [{ id: 'inst-1', current_state: {} }], error: null };
    }
    return { data: [], error: null };
  });
  const portfolios = new MockPortfolios();
  const watcher = new StopLossWatcherService(db as any, portfolios as any);
  const result = await watcher.sweep();
  assert(result.skipped === 1, 'no current price → skipped');
  assert(result.closed === 0 && result.updated === 0, 'no close, no update on skipped');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
