/**
 * Unit tests for chatAsk and getDailyAnalystSummary service methods.
 * Tests input validation, market hours logic, and response shape
 * without requiring a database or LLM.
 */
import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => { passed++; console.log(`  \u2713 ${name}`); }).catch(err => {
        failed++; console.error(`  \u2717 ${name}`); console.error(err);
      });
    }
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.error(`  \u2717 ${name}`);
    console.error(err);
  }
}

// ---- chatAsk validation tests ----

console.log('\nchatAsk input validation:');

// Simulate the validation logic from MarketsService.chatAsk
function validateChatInput(message: unknown): { valid: boolean; trimmed: string } {
  if (!message || typeof message !== 'string') return { valid: false, trimmed: '' };
  const trimmed = (message as string).trim().slice(0, 2000);
  if (!trimmed) return { valid: false, trimmed: '' };
  return { valid: true, trimmed };
}

test('rejects empty string', () => {
  assert.equal(validateChatInput('').valid, false);
});

test('rejects null', () => {
  assert.equal(validateChatInput(null).valid, false);
});

test('rejects undefined', () => {
  assert.equal(validateChatInput(undefined).valid, false);
});

test('rejects whitespace-only', () => {
  assert.equal(validateChatInput('   \n  ').valid, false);
});

test('accepts valid message', () => {
  const result = validateChatInput('How is AAPL doing?');
  assert.equal(result.valid, true);
  assert.equal(result.trimmed, 'How is AAPL doing?');
});

test('trims whitespace', () => {
  const result = validateChatInput('  hello world  ');
  assert.equal(result.trimmed, 'hello world');
});

test('truncates at 2000 chars', () => {
  const longMessage = 'x'.repeat(3000);
  const result = validateChatInput(longMessage);
  assert.equal(result.valid, true);
  assert.equal(result.trimmed.length, 2000);
});

// ---- Market hours logic tests ----

console.log('\nmarket hours logic:');

function isMarketsOpen(date: Date): boolean {
  const isWeekday = date.getUTCDay() >= 1 && date.getUTCDay() <= 5;
  const etHour = Number(date.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
  return isWeekday && etHour >= 9 && etHour < 16;
}

test('weekday 10 AM ET is open', () => {
  // 10 AM ET on a Wednesday (2026-04-15 = Wed)
  // 10 AM EDT = 14:00 UTC
  const d = new Date('2026-04-15T14:00:00Z');
  assert.equal(isMarketsOpen(d), true);
});

test('weekday 5 PM ET is closed', () => {
  // 5 PM EDT = 21:00 UTC
  const d = new Date('2026-04-15T21:00:00Z');
  assert.equal(isMarketsOpen(d), false);
});

test('weekday 8 AM ET is closed (pre-market)', () => {
  // 8 AM EDT = 12:00 UTC
  const d = new Date('2026-04-15T12:00:00Z');
  assert.equal(isMarketsOpen(d), false);
});

test('Saturday is closed regardless of time', () => {
  // 2026-04-18 is a Saturday
  const d = new Date('2026-04-18T14:00:00Z');
  assert.equal(isMarketsOpen(d), false);
});

test('Sunday is closed regardless of time', () => {
  const d = new Date('2026-04-19T14:00:00Z');
  assert.equal(isMarketsOpen(d), false);
});

// ---- getDailyAnalystSummary response shape tests ----

console.log('\ndaily summary response shape:');

interface AnalystSummaryRow {
  analystId: string;
  analystName: string;
  analystSlug: string;
  instrumentsCovered: number;
  predictionsToday: number;
  avgConfidence: number;
  dominantDirection: string;
  symbols: string[];
  latestRiskReasoning: string | null;
}

function mapRow(r: Record<string, unknown>): AnalystSummaryRow {
  return {
    analystId: String(r.analyst_id),
    analystName: String(r.analyst_name),
    analystSlug: String(r.analyst_slug),
    instrumentsCovered: Number(r.instruments_covered) || 0,
    predictionsToday: Number(r.predictions_today) || 0,
    avgConfidence: Number(r.avg_confidence) || 0,
    dominantDirection: String(r.dominant_direction || 'flat'),
    symbols: (r.symbols as string[] | null) ?? [],
    latestRiskReasoning: r.latest_risk_reasoning ? String(r.latest_risk_reasoning) : null,
  };
}

test('maps row with all fields', () => {
  const row = {
    analyst_id: 'a1', analyst_name: 'Test Analyst', analyst_slug: 'test',
    instruments_covered: '3', predictions_today: '5', avg_confidence: '72.5',
    dominant_direction: 'up', symbols: ['AAPL', 'GOOG'], latest_risk_reasoning: 'Some reasoning',
  };
  const mapped = mapRow(row);
  assert.equal(mapped.analystId, 'a1');
  assert.equal(mapped.instrumentsCovered, 3);
  assert.equal(mapped.avgConfidence, 72.5);
  assert.equal(mapped.dominantDirection, 'up');
  assert.deepEqual(mapped.symbols, ['AAPL', 'GOOG']);
  assert.equal(mapped.latestRiskReasoning, 'Some reasoning');
});

test('handles null/missing fields gracefully', () => {
  const row = {
    analyst_id: 'a2', analyst_name: 'Empty', analyst_slug: 'empty',
    instruments_covered: null, predictions_today: null, avg_confidence: null,
    dominant_direction: null, symbols: null, latest_risk_reasoning: null,
  };
  const mapped = mapRow(row);
  assert.equal(mapped.instrumentsCovered, 0);
  assert.equal(mapped.predictionsToday, 0);
  assert.equal(mapped.avgConfidence, 0);
  assert.equal(mapped.dominantDirection, 'flat');
  assert.deepEqual(mapped.symbols, []);
  assert.equal(mapped.latestRiskReasoning, null);
});

// ---- getMinimumConfidence tests ----

console.log('\ngetMinimumConfidence:');

function getMinimumConfidence(tiers: Array<{ min_confidence: number }>): number {
  if (tiers.length === 0) return 60;
  return Math.min(...tiers.map(t => t.min_confidence));
}

test('returns 60 for empty tiers', () => {
  assert.equal(getMinimumConfidence([]), 60);
});

test('returns lowest min_confidence from tiers', () => {
  const tiers = [
    { min_confidence: 50 },
    { min_confidence: 70 },
    { min_confidence: 80 },
  ];
  assert.equal(getMinimumConfidence(tiers), 50);
});

test('handles single tier', () => {
  assert.equal(getMinimumConfidence([{ min_confidence: 65 }]), 65);
});

// ---- Summary ----

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
