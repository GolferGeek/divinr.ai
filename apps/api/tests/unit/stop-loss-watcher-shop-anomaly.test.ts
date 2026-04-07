/**
 * Phase 8.3a — SHOP $0-P&L anomaly regression test.
 *
 * Historical observation: a long SHOP position opened at $110 with no
 * favorable move (current=110) closed instantly at $0 P&L because the
 * row was written with high_water_mark=$118.80 — an artifact of an old
 * code path that inherited HWM across opens. decide() then correctly
 * computed an 8% giveback from peak and emitted 'trailing_stop'.
 *
 * Phase 1.2 fixed the *write* path so freshly opened rows always have
 * high_water_mark = NULL. This test pins decide()'s behavior on the
 * pathological input to prove the math itself is right; the fix lives
 * in AutotradeOpenHelper, not here.
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

console.log('\n=== SHOP anomaly regression (Phase 8.3a) ===\n');

const decision = StopLossWatcherService.decide({
  direction: 'long',
  entryPrice: 110,
  currentPrice: 110,
  highWaterMark: 118.80,
});

assert(
  decision.closeReason === 'trailing_stop',
  'decide() emits trailing_stop when HWM=118.80 vs current=110 (8% giveback ≥ 5%)',
);
assert(
  Math.abs(decision.newHighWaterMark - 118.80) < 1e-9,
  'newHighWaterMark stays at 118.80 (current 110 is below HWM for a long)',
);

// Sanity: same inputs but HWM=null (the post-Phase-1 reality) → no close.
const fixed = StopLossWatcherService.decide({
  direction: 'long',
  entryPrice: 110,
  currentPrice: 110,
  highWaterMark: null,
});
assert(fixed.closeReason === null, 'with HWM=NULL (post Phase 1.2), same prices do NOT close');
assert(fixed.newHighWaterMark === 110, 'HWM defaults to entryPrice when null');

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
