/**
 * Unit tests for nightly evaluation logic.
 * Tests horizon window identification, scoring, and profile computation.
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

console.log('\n=== Nightly Evaluation Tests ===\n');

// ── Horizon Window Logic ────────────────────────────────────────

console.log('Horizon window computation:');
{
  function addHorizon(date: Date, value: number, unit: string): Date {
    const result = new Date(date);
    if (unit === 'hours') result.setHours(result.getHours() + value);
    else if (unit === 'weeks') result.setDate(result.getDate() + value * 7);
    else result.setDate(result.getDate() + value);
    return result;
  }

  const base = new Date('2026-04-01T10:00:00Z');

  const oneDay = addHorizon(base, 1, 'days');
  assert(oneDay.getDate() === 2, '1 day: April 1 → April 2');

  const threeDays = addHorizon(base, 3, 'days');
  assert(threeDays.getDate() === 4, '3 days: April 1 → April 4');

  const fiveDays = addHorizon(base, 5, 'days');
  assert(fiveDays.getDate() === 6, '5 days: April 1 → April 6');

  const fourHours = addHorizon(base, 4, 'hours');
  assert(fourHours.getUTCHours() === 14, '4 hours: 10:00 → 14:00 UTC');

  const twoWeeks = addHorizon(base, 2, 'weeks');
  assert(twoWeeks.getDate() === 15, '2 weeks: April 1 → April 15');
}

// ── Should-Evaluate Logic ───────────────────────────────────────

console.log('\nShould-evaluate timing:');
{
  function shouldEvaluate(predictionDate: Date, horizonDays: number): boolean {
    const evalDate = new Date(predictionDate);
    evalDate.setDate(evalDate.getDate() + horizonDays);
    return evalDate <= new Date();
  }

  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  assert(shouldEvaluate(twoDaysAgo, 1) === true, '2 days ago + 1d horizon → should evaluate');
  assert(shouldEvaluate(twoDaysAgo, 3) === false, '2 days ago + 3d horizon → too early');

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  assert(shouldEvaluate(fiveDaysAgo, 5) === true, '5 days ago + 5d horizon → should evaluate');
  assert(shouldEvaluate(fiveDaysAgo, 1) === true, '5 days ago + 1d horizon → should evaluate');
}

// ── Predictor Scoring Parse ─────────────────────────────────────

console.log('\nPredictor scoring parse:');
{
  function parseScoreResult(text: string): { relevance: number; rationale: string; dismiss: boolean } {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as Record<string, unknown>;
        return {
          relevance: Math.min(1, Math.max(0, Number(parsed['relevance']) || 0.5)),
          rationale: String(parsed['rationale'] || text.slice(0, 500)),
          dismiss: Boolean(parsed['dismiss']),
        };
      }
    } catch { /* fall through */ }
    return { relevance: 0.5, rationale: text.slice(0, 500), dismiss: false };
  }

  const valid = parseScoreResult('{"relevance": 0.85, "rationale": "Directly about AAPL earnings", "dismiss": false}');
  assert(valid.relevance === 0.85, 'Relevance parsed');
  assert(valid.rationale.includes('AAPL earnings'), 'Rationale parsed');
  assert(valid.dismiss === false, 'Not dismissed');

  const dismissed = parseScoreResult('{"relevance": 0.1, "rationale": "Unrelated to instrument", "dismiss": true}');
  assert(dismissed.dismiss === true, 'Dismiss flag parsed');
  assert(dismissed.relevance === 0.1, 'Low relevance parsed');

  const clamped = parseScoreResult('{"relevance": 5.0}');
  assert(clamped.relevance === 1, 'Relevance clamped to 1.0');

  const negative = parseScoreResult('{"relevance": -0.5}');
  assert(negative.relevance === 0, 'Negative relevance clamped to 0');

  const noJson = parseScoreResult('This article is somewhat relevant.');
  assert(noJson.relevance === 0.5, 'No JSON → default 0.5');
  assert(noJson.dismiss === false, 'No JSON → not dismissed');
}

// ── Canonical Candidate Identification ──────────────────────────

console.log('\nCanonical candidate detection:');
{
  interface HorizonEval {
    horizonWindow: number;
    wasCorrect: boolean;
    confidence: number;
  }

  function isCanonicalCandidate(evals: HorizonEval[]): boolean {
    if (evals.length < 2) return false;
    const allWrong = evals.every(e => !e.wasCorrect);
    const highConfidence = evals.some(e => e.confidence >= 70);
    return allWrong && highConfidence;
  }

  assert(
    isCanonicalCandidate([
      { horizonWindow: 1, wasCorrect: false, confidence: 80 },
      { horizonWindow: 3, wasCorrect: false, confidence: 75 },
    ]) === true,
    'Wrong at all horizons + high confidence → canonical candidate',
  );

  assert(
    isCanonicalCandidate([
      { horizonWindow: 1, wasCorrect: false, confidence: 80 },
      { horizonWindow: 3, wasCorrect: true, confidence: 70 },
    ]) === false,
    'One correct → not a candidate',
  );

  assert(
    isCanonicalCandidate([
      { horizonWindow: 1, wasCorrect: false, confidence: 50 },
      { horizonWindow: 3, wasCorrect: false, confidence: 60 },
    ]) === false,
    'All wrong but low confidence → not a candidate',
  );

  assert(
    isCanonicalCandidate([
      { horizonWindow: 1, wasCorrect: false, confidence: 90 },
    ]) === false,
    'Only one horizon evaluated → not enough data',
  );
}

// ── Performance Profile Calibration ─────────────────────────────

console.log('\nCalibration scoring:');
{
  function calibrationScore(avgConfidence: number, accuracyRate: number): number {
    return 1 - Math.abs((avgConfidence / 100) - accuracyRate);
  }

  const perfect = calibrationScore(70, 0.7);
  assert(Math.abs(perfect - 1.0) < 0.01, 'Perfect calibration: 70% conf, 70% acc → 1.0');

  const overconf = calibrationScore(90, 0.5);
  assert(overconf < 0.65, `Overconfident: 90% conf, 50% acc → ${overconf.toFixed(2)} (low)`);

  const underconf = calibrationScore(30, 0.8);
  assert(underconf < 0.55, `Underconfident: 30% conf, 80% acc → ${underconf.toFixed(2)} (low)`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
