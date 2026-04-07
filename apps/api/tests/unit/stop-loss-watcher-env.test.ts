/**
 * Phase 8.1 — env override for stop-loss / take-profit / trailing constants.
 *
 * Asserts that:
 *   - Defaults are unchanged when no env vars are set.
 *   - Each env var, when set, overrides the corresponding static getter.
 *   - Decisions made via decide() respect the override (e.g. a wider
 *     stop-loss prevents an otherwise-triggering close).
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

function clearEnv(): void {
  delete process.env.STOP_LOSS_PCT;
  delete process.env.TAKE_PROFIT_PCT;
  delete process.env.TRAILING_STOP_PCT;
  delete process.env.TRAILING_ARM_PCT;
}

console.log('\n=== StopLossWatcher env override (Phase 8.1) ===\n');

// Defaults
clearEnv();
assert(StopLossWatcherService.STOP_LOSS_PCT === -0.05, 'STOP_LOSS_PCT default = -0.05');
assert(StopLossWatcherService.TAKE_PROFIT_PCT === 0.10, 'TAKE_PROFIT_PCT default = 0.10');
assert(StopLossWatcherService.TRAILING_STOP_PCT === 0.05, 'TRAILING_STOP_PCT default = 0.05');
assert(StopLossWatcherService.TRAILING_ARM_PCT === 0.05, 'TRAILING_ARM_PCT default = 0.05');

// Overrides
process.env.STOP_LOSS_PCT = '-0.08';
process.env.TAKE_PROFIT_PCT = '0.20';
process.env.TRAILING_STOP_PCT = '0.07';
process.env.TRAILING_ARM_PCT = '0.06';
assert(StopLossWatcherService.STOP_LOSS_PCT === -0.08, 'STOP_LOSS_PCT overridden by env');
assert(StopLossWatcherService.TAKE_PROFIT_PCT === 0.20, 'TAKE_PROFIT_PCT overridden by env');
assert(StopLossWatcherService.TRAILING_STOP_PCT === 0.07, 'TRAILING_STOP_PCT overridden by env');
assert(StopLossWatcherService.TRAILING_ARM_PCT === 0.06, 'TRAILING_ARM_PCT overridden by env');

// With wider stop-loss, a -6% drop should NOT trigger close.
const wideStop = StopLossWatcherService.decide({
  direction: 'long',
  entryPrice: 100,
  currentPrice: 94,
  highWaterMark: null,
});
assert(wideStop.closeReason === null, 'wider STOP_LOSS_PCT prevents -6% close');

// Garbage env value falls back to default.
process.env.STOP_LOSS_PCT = 'not-a-number';
assert(StopLossWatcherService.STOP_LOSS_PCT === -0.05, 'invalid env falls back to default');

clearEnv();
assert(StopLossWatcherService.STOP_LOSS_PCT === -0.05, 'STOP_LOSS_PCT restored to default after clear');

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
