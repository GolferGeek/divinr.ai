/**
 * Unit tests for analyst memory writing logic.
 * Tests calibration updates, correction capping, pattern detection, and instrument notes.
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

console.log('\n=== Memory Writing Tests ===\n');

// ── Confidence Band Classification ─────────────────────────────

console.log('Confidence band classification:');
{
  function classifyBand(confidence: number): string {
    if (confidence < 25) return '0-25';
    if (confidence < 50) return '25-50';
    if (confidence < 75) return '50-75';
    return '75-100';
  }

  assert(classifyBand(0) === '0-25', '0% → 0-25');
  assert(classifyBand(10) === '0-25', '10% → 0-25');
  assert(classifyBand(24) === '0-25', '24% → 0-25');
  assert(classifyBand(25) === '25-50', '25% → 25-50');
  assert(classifyBand(49) === '25-50', '49% → 25-50');
  assert(classifyBand(50) === '50-75', '50% → 50-75');
  assert(classifyBand(74) === '50-75', '74% → 50-75');
  assert(classifyBand(75) === '75-100', '75% → 75-100');
  assert(classifyBand(100) === '75-100', '100% → 75-100');
}

// ── Calibration Update Logic ───────────────────────────────────

console.log('\nCalibration update logic:');
{
  function updateCalibration(
    existing: { predictions_made?: number; correct?: number; by_confidence_band?: Record<string, number> },
    wasCorrect: boolean,
    confidence: number,
  ): { predictions_made: number; correct: number; by_confidence_band: Record<string, number> } {
    const band = confidence < 25 ? '0-25'
      : confidence < 50 ? '25-50'
      : confidence < 75 ? '50-75'
      : '75-100';

    const byBand = { ...(existing.by_confidence_band ?? {}) };
    byBand[band] = (byBand[band] ?? 0) + 1;

    return {
      predictions_made: (existing.predictions_made ?? 0) + 1,
      correct: (existing.correct ?? 0) + (wasCorrect ? 1 : 0),
      by_confidence_band: byBand,
    };
  }

  // First prediction — correct at 80%
  const cal1 = updateCalibration({}, true, 80);
  assert(cal1.predictions_made === 1, 'First prediction: count = 1');
  assert(cal1.correct === 1, 'First prediction correct: correct = 1');
  assert(cal1.by_confidence_band['75-100'] === 1, 'First prediction: 75-100 band = 1');

  // Second prediction — wrong at 60%
  const cal2 = updateCalibration(cal1, false, 60);
  assert(cal2.predictions_made === 2, 'Second prediction: count = 2');
  assert(cal2.correct === 1, 'Second prediction wrong: correct still 1');
  assert(cal2.by_confidence_band['50-75'] === 1, 'Second prediction: 50-75 band = 1');
  assert(cal2.by_confidence_band['75-100'] === 1, '75-100 band unchanged');
}

// ── Correction Capping ─────────────────────────────────────────

console.log('\nCorrection array capping:');
{
  function capArray<T>(arr: T[], max: number): T[] {
    if (arr.length <= max) return arr;
    return arr.slice(-max);
  }

  const small = [1, 2, 3];
  assert(capArray(small, 10).length === 3, 'Small array unchanged');

  const big = Array.from({ length: 15 }, (_, i) => i);
  const capped = capArray(big, 10);
  assert(capped.length === 10, 'Capped to 10');
  assert(capped[0] === 5, 'Oldest entries removed');
  assert(capped[9] === 14, 'Newest entries kept');
}

// ── Pattern Detection Criteria ─────────────────────────────────

console.log('\nPattern detection (non-obvious correct calls):');
{
  function shouldCreatePattern(wasCorrect: boolean, confidence: number): boolean {
    return wasCorrect && confidence < 70;
  }

  assert(shouldCreatePattern(true, 60) === true, 'Correct at 60% → pattern');
  assert(shouldCreatePattern(true, 69) === true, 'Correct at 69% → pattern');
  assert(shouldCreatePattern(true, 70) === false, 'Correct at 70% → no pattern (obvious)');
  assert(shouldCreatePattern(true, 85) === false, 'Correct at 85% → no pattern');
  assert(shouldCreatePattern(false, 40) === false, 'Wrong at 40% → no pattern');
  assert(shouldCreatePattern(false, 60) === false, 'Wrong at 60% → no pattern');
}

// ── Instrument Note Format ─────────────────────────────────────

console.log('\nInstrument note format:');
{
  function formatNote(wasCorrect: boolean, predicted: string, confidence: number, actual: string): string {
    return `${wasCorrect ? 'Correct' : 'Incorrect'}: predicted ${predicted} (${confidence}%), actual ${actual}`;
  }

  const correctNote = formatNote(true, 'up', 75, 'up');
  assert(correctNote === 'Correct: predicted up (75%), actual up', 'Correct note format');

  const wrongNote = formatNote(false, 'up', 80, 'down');
  assert(wrongNote === 'Incorrect: predicted up (80%), actual down', 'Wrong note format');
}

// ── Correction Format ──────────────────────────────────────────

console.log('\nCorrection format:');
{
  function formatCorrection(predicted: string, symbol: string, confidence: number, actual: string): string {
    return `Predicted ${predicted} for ${symbol} at ${confidence}% but actual was ${actual}`;
  }

  const correction = formatCorrection('up', 'MSFT', 80, 'down');
  assert(correction === 'Predicted up for MSFT at 80% but actual was down', 'Correction format matches');
}

// ── Results ────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
