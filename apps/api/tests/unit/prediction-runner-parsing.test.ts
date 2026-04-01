/**
 * Unit tests for prediction runner output parsing and prompt building logic.
 * Tests the pure functions without LLM or DB dependencies.
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

// Replicate the parseStructuredOutput logic from prediction-runner
function parseStructuredOutput(text: string): {
  direction: 'up' | 'down' | 'flat';
  confidence: number;
  rationale: string;
  key_factors: string[];
  risks: string[];
} {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const rawDir = String(parsed['direction'] || 'flat').toLowerCase();
      const direction: 'up' | 'down' | 'flat' =
        rawDir === 'up' || rawDir === 'bullish' ? 'up' :
        rawDir === 'down' || rawDir === 'bearish' ? 'down' : 'flat';
      return {
        direction,
        confidence: Math.min(100, Math.max(0, Math.round(Number(parsed['confidence']) || 65))),
        rationale: String(parsed['rationale'] || text.slice(0, 1200)),
        key_factors: Array.isArray(parsed['key_factors']) ? parsed['key_factors'].map(String) : [],
        risks: Array.isArray(parsed['risks']) ? parsed['risks'].map(String) : [],
      };
    }
  } catch { /* fall through */ }

  const lower = text.toLowerCase();
  const direction: 'up' | 'down' | 'flat' =
    lower.includes('down') || lower.includes('bearish') ? 'down' :
    lower.includes('flat') || lower.includes('neutral') ? 'flat' : 'up';
  return {
    direction,
    confidence: direction === 'flat' ? 55 : 67,
    rationale: text.slice(0, 1200),
    key_factors: [],
    risks: [],
  };
}

console.log('\n=== Prediction Runner Parsing Tests ===\n');

// Test 1: Valid JSON output
console.log('Valid JSON parsing:');
{
  const json = JSON.stringify({
    direction: 'up',
    confidence: 78,
    rationale: 'Strong earnings momentum.',
    key_factors: ['Revenue growth', 'Margin expansion'],
    risks: ['Valuation stretched'],
  });
  const result = parseStructuredOutput(json);
  assert(result.direction === 'up', 'Direction = up');
  assert(result.confidence === 78, 'Confidence = 78');
  assert(result.rationale === 'Strong earnings momentum.', 'Rationale extracted');
  assert(result.key_factors.length === 2, '2 key factors');
  assert(result.risks.length === 1, '1 risk');
}

// Test 2: JSON with bullish/bearish directions
console.log('\nBullish/bearish direction mapping:');
{
  const bullish = parseStructuredOutput('{"direction": "bullish", "confidence": 70, "rationale": "test"}');
  assert(bullish.direction === 'up', 'bullish → up');

  const bearish = parseStructuredOutput('{"direction": "bearish", "confidence": 60, "rationale": "test"}');
  assert(bearish.direction === 'down', 'bearish → down');

  const neutral = parseStructuredOutput('{"direction": "neutral", "confidence": 50, "rationale": "test"}');
  assert(neutral.direction === 'flat', 'neutral → flat');
}

// Test 3: JSON embedded in markdown
console.log('\nJSON embedded in text:');
{
  const messy = 'Here is my analysis:\n```json\n{"direction": "down", "confidence": 85, "rationale": "Bad news.", "key_factors": ["Earnings miss"], "risks": []}\n```\nThat is all.';
  const result = parseStructuredOutput(messy);
  assert(result.direction === 'down', 'Extracts direction from embedded JSON');
  assert(result.confidence === 85, 'Extracts confidence from embedded JSON');
}

// Test 4: Confidence clamping
console.log('\nConfidence clamping:');
{
  const over = parseStructuredOutput('{"direction": "up", "confidence": 150, "rationale": "test"}');
  assert(over.confidence === 100, 'Confidence capped at 100');

  const under = parseStructuredOutput('{"direction": "up", "confidence": -10, "rationale": "test"}');
  assert(under.confidence === 0, 'Confidence floored at 0');

  const missing = parseStructuredOutput('{"direction": "up", "rationale": "test"}');
  assert(missing.confidence === 65, 'Missing confidence defaults to 65');
}

// Test 5: Keyword fallback
console.log('\nKeyword fallback (no JSON):');
{
  const bearishText = 'The stock is likely to go down due to weak fundamentals.';
  const result = parseStructuredOutput(bearishText);
  assert(result.direction === 'down', 'Keyword "down" detected');
  assert(result.confidence === 67, 'Default confidence for directional');
  assert(result.key_factors.length === 0, 'No key_factors in fallback');
}

{
  const flatText = 'The outlook is neutral with mixed signals.';
  const result = parseStructuredOutput(flatText);
  assert(result.direction === 'flat', 'Keyword "neutral" → flat');
  assert(result.confidence === 55, 'Lower confidence for flat');
}

{
  const bullishText = 'Strong momentum suggests continued upside.';
  const result = parseStructuredOutput(bullishText);
  assert(result.direction === 'up', 'No bearish/flat keywords → defaults up');
}

// Test 6: Empty/garbage input
console.log('\nEdge cases:');
{
  const empty = parseStructuredOutput('');
  assert(empty.direction === 'up', 'Empty string → defaults up');

  const garbage = parseStructuredOutput('asdfghjkl');
  assert(garbage.direction === 'up', 'Garbage → defaults up');

  const brokenJson = parseStructuredOutput('{direction: up, confidence');
  assert(brokenJson.direction === 'up', 'Malformed JSON → falls to keyword fallback');
}

// Test 7: Debate parse - arbiter adjustment clamping (replicating logic)
console.log('\nArbiter adjustment parsing:');
{
  function parseAdjustment(text: string): number {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as Record<string, unknown>;
        return Math.min(30, Math.max(-30, Math.round(Number(parsed['recommended_adjustment']) || 0)));
      }
    } catch { /* fall through */ }
    return 0;
  }

  assert(parseAdjustment('{"recommended_adjustment": 15}') === 15, 'Normal adjustment = 15');
  assert(parseAdjustment('{"recommended_adjustment": 50}') === 30, 'Over 30 clamped to 30');
  assert(parseAdjustment('{"recommended_adjustment": -50}') === -30, 'Under -30 clamped to -30');
  assert(parseAdjustment('{"recommended_adjustment": 0}') === 0, 'Zero = 0');
  assert(parseAdjustment('no json here') === 0, 'No JSON = 0 default');
  assert(parseAdjustment('{"recommended_adjustment": "invalid"}') === 0, 'Non-number = 0 default');
}

// Test 8: Dimension analyzer parse (replicating logic)
console.log('\nDimension analyzer parsing:');
{
  function parseDimension(text: string): { score: number; confidence: number } {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        return {
          score: Math.min(100, Math.max(0, Math.round(Number(parsed['score']) || 50))),
          confidence: Math.min(1, Math.max(0, Number(parsed['confidence']) || 0.5)),
        };
      }
    } catch { /* fall through */ }
    const lower = text.toLowerCase();
    const score = lower.includes('extreme') || lower.includes('very high') ? 82
      : lower.includes('high') ? 68
      : lower.includes('low') || lower.includes('minimal') ? 25 : 50;
    return { score, confidence: 0.5 };
  }

  const valid = parseDimension('{"score": 72, "confidence": 0.85, "reasoning": "test"}');
  assert(valid.score === 72, 'Score parsed from JSON');
  assert(valid.confidence === 0.85, 'Confidence parsed from JSON');

  const clamped = parseDimension('{"score": 150, "confidence": 2.0}');
  assert(clamped.score === 100, 'Score clamped to 100');
  assert(clamped.confidence === 1, 'Confidence clamped to 1');

  const keyword = parseDimension('This is a very high risk situation.');
  assert(keyword.score === 82, 'Keyword "very high" → 82');

  const lowKeyword = parseDimension('Risk appears minimal at this point.');
  assert(lowKeyword.score === 25, 'Keyword "minimal" → 25');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
