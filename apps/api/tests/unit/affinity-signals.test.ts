/**
 * Unit tests for affinity signal collection logic.
 * Tests the signal type determination logic — which signal types
 * should be generated for different user actions.
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

console.log('\n=== Affinity Signal Collection Tests ===\n');

// ─── Signal Type Determination ─────────────────────────────────
// These test the pure logic of which signals should fire for each scenario.

type SignalType = 'buy_agreement' | 'sell_agreement' | 'skip_disagreement' | 'challenge_accept' | 'challenge_reject';

/**
 * Determines signals to fire for a trade confirmation.
 * Mirrors the logic in MarketsService.recordTradeAffinitySignals.
 */
function getTradeSignals(
  decision: 'buy' | 'sell',
  analystPredictions: Array<{ analyst_id: string; predicted_direction: string }>,
  challengedAnalystIds: string[],
): Array<{ analyst_id: string; signal_type: SignalType }> {
  const signals: Array<{ analyst_id: string; signal_type: SignalType }> = [];
  const userDirection = decision === 'buy' ? 'up' : 'down';

  for (const a of analystPredictions) {
    if (a.predicted_direction === userDirection) {
      signals.push({
        analyst_id: a.analyst_id,
        signal_type: decision === 'buy' ? 'buy_agreement' : 'sell_agreement',
      });
    }
  }

  // Challenge signals: user acted after challenge → accept
  for (const id of challengedAnalystIds) {
    signals.push({ analyst_id: id, signal_type: 'challenge_accept' });
  }

  return signals;
}

/**
 * Determines signals to fire for a skip decision.
 * Mirrors the logic in MarketsService.recordSkipAffinitySignals.
 */
function getSkipSignals(
  analystPredictions: Array<{ analyst_id: string; predicted_direction: string }>,
  challengedAnalystIds: string[],
): Array<{ analyst_id: string; signal_type: SignalType }> {
  const signals: Array<{ analyst_id: string; signal_type: SignalType }> = [];

  for (const a of analystPredictions) {
    if (a.predicted_direction !== 'flat') {
      signals.push({ analyst_id: a.analyst_id, signal_type: 'skip_disagreement' });
    }
  }

  // Challenge signals: user walked away after challenge → reject
  for (const id of challengedAnalystIds) {
    signals.push({ analyst_id: id, signal_type: 'challenge_reject' });
  }

  return signals;
}

// ─── Buy Agreement ─────────────────────────────────────────────
console.log('Buy decision with bullish analyst:');
{
  const signals = getTradeSignals('buy', [
    { analyst_id: 'a1', predicted_direction: 'up' },
    { analyst_id: 'a2', predicted_direction: 'down' },
    { analyst_id: 'a3', predicted_direction: 'up' },
  ], []);

  assert(signals.length === 2, `2 agreement signals (got ${signals.length})`);
  assert(signals[0].signal_type === 'buy_agreement', 'Signal type is buy_agreement');
  assert(signals[0].analyst_id === 'a1', 'First matching analyst is a1');
  assert(signals[1].analyst_id === 'a3', 'Second matching analyst is a3');
}

// ─── Sell Agreement ────────────────────────────────────────────
console.log('\nSell decision with bearish analyst:');
{
  const signals = getTradeSignals('sell', [
    { analyst_id: 'a1', predicted_direction: 'down' },
    { analyst_id: 'a2', predicted_direction: 'up' },
  ], []);

  assert(signals.length === 1, `1 sell_agreement signal (got ${signals.length})`);
  assert(signals[0].signal_type === 'sell_agreement', 'Signal type is sell_agreement');
  assert(signals[0].analyst_id === 'a1', 'Matching analyst is a1');
}

// ─── Skip Disagreement ─────────────────────────────────────────
console.log('\nSkip decision generates disagreement signals:');
{
  const signals = getSkipSignals([
    { analyst_id: 'a1', predicted_direction: 'up' },
    { analyst_id: 'a2', predicted_direction: 'down' },
    { analyst_id: 'a3', predicted_direction: 'flat' },
  ], []);

  assert(signals.length === 2, `2 skip_disagreement signals (flat excluded) (got ${signals.length})`);
  assert(signals.every(s => s.signal_type === 'skip_disagreement'), 'All are skip_disagreement');
  assert(signals[0].analyst_id === 'a1', 'Non-flat analyst a1 included');
  assert(signals[1].analyst_id === 'a2', 'Non-flat analyst a2 included');
}

// ─── Challenge + Buy → Accept ──────────────────────────────────
console.log('\nChallenge then buy → challenge_accept:');
{
  const signals = getTradeSignals('buy', [
    { analyst_id: 'a1', predicted_direction: 'up' },
  ], ['a1']);

  const challengeSignal = signals.find(s => s.signal_type === 'challenge_accept');
  assert(challengeSignal !== undefined, 'challenge_accept signal generated');
  assert(challengeSignal?.analyst_id === 'a1', 'challenge_accept for the challenged analyst');
}

// ─── Challenge + Skip → Reject ─────────────────────────────────
console.log('\nChallenge then skip → challenge_reject:');
{
  const signals = getSkipSignals([
    { analyst_id: 'a1', predicted_direction: 'up' },
  ], ['a1']);

  const challengeSignal = signals.find(s => s.signal_type === 'challenge_reject');
  assert(challengeSignal !== undefined, 'challenge_reject signal generated');
  assert(challengeSignal?.analyst_id === 'a1', 'challenge_reject for the challenged analyst');
}

// ─── No Analysts → No Signals ──────────────────────────────────
console.log('\nNo analysts in run → no signals:');
{
  const signals = getTradeSignals('buy', [], []);
  assert(signals.length === 0, 'No signals when no analysts');

  const skipSignals = getSkipSignals([], []);
  assert(skipSignals.length === 0, 'No skip signals when no analysts');
}

// ─── Summary ───────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
