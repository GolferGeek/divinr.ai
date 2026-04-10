/**
 * Unit tests for crowd-reaction classification parsing in PredictorGeneratorService.
 * Tests the parsing logic that extracts fear/greed/noise classification from LLM output.
 */
import type { CrowdReaction } from '../../src/markets/markets.types';

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

console.log('\n=== Crowd Reaction Scoring Tests ===\n');

// ─── Extracted parsing logic (mirrors predictor-generator.service.ts) ──────
interface CrowdReactionResult {
  crowdReaction: CrowdReaction | null;
  crowdReactionConfidence: number | null;
  crowdReactionRationale: string | null;
  estimatedReactionWindowMinutes: number | null;
}

function parseCrowdReaction(parsed: Record<string, unknown>): CrowdReactionResult {
  const rawReaction = String(parsed['crowd_reaction'] || '');
  const crowdReaction: CrowdReaction | null = (['fear_trigger', 'greed_trigger', 'noise'] as const).includes(
    rawReaction as CrowdReaction,
  )
    ? (rawReaction as CrowdReaction)
    : 'noise';
  const rawConf = Number(parsed['crowd_reaction_confidence']);
  const crowdReactionConfidence = Number.isFinite(rawConf) ? Math.min(1, Math.max(0, rawConf)) : 0;
  const crowdReactionRationale = parsed['crowd_reaction_rationale']
    ? String(parsed['crowd_reaction_rationale']).slice(0, 500)
    : null;
  const rawWindow = Number(parsed['estimated_reaction_window_minutes']);
  const estimatedReactionWindowMinutes =
    Number.isInteger(rawWindow) && rawWindow >= 15 && rawWindow <= 120 ? rawWindow : null;
  return { crowdReaction, crowdReactionConfidence, crowdReactionRationale, estimatedReactionWindowMinutes };
}

// ─── Test: valid fear_trigger JSON ──────────────────────────────────────────
console.log('Test: valid fear_trigger JSON');
{
  const parsed = {
    relevance: 0.9,
    rationale: 'Tariff headline directly impacts MSFT supply chain',
    dismiss: false,
    crowd_reaction: 'fear_trigger',
    crowd_reaction_confidence: 0.85,
    crowd_reaction_rationale: 'Retail investors will panic-sell tech on tariff fears',
    estimated_reaction_window_minutes: 30,
  };
  const result = parseCrowdReaction(parsed);
  assert(result.crowdReaction === 'fear_trigger', 'crowd_reaction is fear_trigger');
  assert(result.crowdReactionConfidence === 0.85, 'confidence is 0.85');
  assert(result.crowdReactionRationale === 'Retail investors will panic-sell tech on tariff fears', 'rationale preserved');
  assert(result.estimatedReactionWindowMinutes === 30, 'window is 30 minutes');
}

// ─── Test: valid greed_trigger JSON ─────────────────────────────────────────
console.log('Test: valid greed_trigger JSON');
{
  const parsed = {
    relevance: 0.8,
    rationale: 'Earnings beat significantly above expectations',
    dismiss: false,
    crowd_reaction: 'greed_trigger',
    crowd_reaction_confidence: 0.72,
    crowd_reaction_rationale: 'FOMO buying as retail sees massive beat',
    estimated_reaction_window_minutes: 60,
  };
  const result = parseCrowdReaction(parsed);
  assert(result.crowdReaction === 'greed_trigger', 'crowd_reaction is greed_trigger');
  assert(result.crowdReactionConfidence === 0.72, 'confidence is 0.72');
  assert(result.estimatedReactionWindowMinutes === 60, 'window is 60 minutes');
}

// ─── Test: valid noise JSON ─────────────────────────────────────────────────
console.log('Test: valid noise JSON');
{
  const parsed = {
    relevance: 0.4,
    rationale: 'Minor product update',
    dismiss: false,
    crowd_reaction: 'noise',
    crowd_reaction_confidence: 0.9,
    crowd_reaction_rationale: 'Routine update, no emotional trigger',
    estimated_reaction_window_minutes: 60,
  };
  const result = parseCrowdReaction(parsed);
  assert(result.crowdReaction === 'noise', 'crowd_reaction is noise');
  assert(result.crowdReactionConfidence === 0.9, 'confidence is 0.9');
}

// ─── Test: malformed crowd_reaction defaults to noise ───────────────────────
console.log('Test: malformed crowd_reaction defaults to noise');
{
  const parsed = {
    relevance: 0.6,
    rationale: 'Some article',
    dismiss: false,
    crowd_reaction: 'panic_sell',
    crowd_reaction_confidence: 0.7,
  };
  const result = parseCrowdReaction(parsed);
  assert(result.crowdReaction === 'noise', 'invalid reaction type defaults to noise');
}

// ─── Test: missing fields default gracefully ────────────────────────────────
console.log('Test: missing fields default gracefully');
{
  const parsed = {
    relevance: 0.5,
    rationale: 'Some article',
    dismiss: false,
  };
  const result = parseCrowdReaction(parsed);
  assert(result.crowdReaction === 'noise', 'missing crowd_reaction defaults to noise');
  assert(result.crowdReactionConfidence === 0, 'missing confidence defaults to 0');
  assert(result.crowdReactionRationale === null, 'missing rationale defaults to null');
  assert(result.estimatedReactionWindowMinutes === null, 'missing window defaults to null');
}

// ─── Test: confidence clamped to 0-1 range ──────────────────────────────────
console.log('Test: confidence clamped to 0-1 range');
{
  const parsed = {
    crowd_reaction: 'fear_trigger',
    crowd_reaction_confidence: 1.5,
  };
  const result = parseCrowdReaction(parsed);
  assert(result.crowdReactionConfidence === 1, 'confidence > 1 clamped to 1');
}
{
  const parsed = {
    crowd_reaction: 'fear_trigger',
    crowd_reaction_confidence: -0.3,
  };
  const result = parseCrowdReaction(parsed);
  assert(result.crowdReactionConfidence === 0, 'confidence < 0 clamped to 0');
}

// ─── Test: window out of range defaults to null ─────────────────────────────
console.log('Test: window out of range defaults to null');
{
  const parsed = {
    crowd_reaction: 'fear_trigger',
    crowd_reaction_confidence: 0.8,
    estimated_reaction_window_minutes: 5,
  };
  const result = parseCrowdReaction(parsed);
  assert(result.estimatedReactionWindowMinutes === null, 'window < 15 defaults to null');
}
{
  const parsed = {
    crowd_reaction: 'fear_trigger',
    crowd_reaction_confidence: 0.8,
    estimated_reaction_window_minutes: 200,
  };
  const result = parseCrowdReaction(parsed);
  assert(result.estimatedReactionWindowMinutes === null, 'window > 120 defaults to null');
}

// ─── Test: NaN confidence defaults to 0 ─────────────────────────────────────
console.log('Test: NaN confidence defaults to 0');
{
  const parsed = {
    crowd_reaction: 'fear_trigger',
    crowd_reaction_confidence: 'high',
  };
  const result = parseCrowdReaction(parsed);
  assert(result.crowdReactionConfidence === 0, 'non-numeric confidence defaults to 0');
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
