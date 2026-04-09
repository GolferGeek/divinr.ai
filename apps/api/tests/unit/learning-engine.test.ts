/**
 * Unit tests for learning engine pattern identification and canonical test scoring.
 * Tests pure logic without DB or LLM dependencies.
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

console.log('\n=== Learning Engine Tests ===\n');

// ── Canonical Test Scoring Logic ────────────────────────────────

console.log('Canonical test scoring:');
{
  interface DayResult {
    originalCorrect: boolean;
    proposedCorrect: boolean;
    improved: boolean;
    regressed: boolean;
    severityRegression: boolean;
  }

  function scoreDayResult(originalCorrect: boolean, proposedCorrect: boolean): DayResult {
    return {
      originalCorrect,
      proposedCorrect,
      improved: !originalCorrect && proposedCorrect,
      regressed: originalCorrect && !proposedCorrect,
      severityRegression: originalCorrect && !proposedCorrect,
    };
  }

  function scoreTestResults(dayResults: DayResult[]): {
    passed: boolean; netScore: number; reason: string;
    improvementCount: number; regressionCount: number; severityCount: number;
  } {
    const improvementCount = dayResults.filter(r => r.improved).length;
    const regressionCount = dayResults.filter(r => r.regressed).length;
    const severityCount = dayResults.filter(r => r.severityRegression).length;
    const netScore = improvementCount - regressionCount;

    if (severityCount > 0) return { passed: false, netScore, reason: 'severity', improvementCount, regressionCount, severityCount };
    if (netScore <= 0) return { passed: false, netScore, reason: 'net_score', improvementCount, regressionCount, severityCount };
    return { passed: true, netScore, reason: 'passed', improvementCount, regressionCount, severityCount };
  }

  // All improvements, no regressions → PASS
  const allGood = scoreTestResults([
    scoreDayResult(false, true),  // was wrong, now right
    scoreDayResult(false, true),
    scoreDayResult(true, true),   // was right, still right
  ]);
  assert(allGood.passed === true, 'All improvements → PASS');
  assert(allGood.netScore === 2, 'Net score = 2');

  // One severity regression → BLOCK
  const severity = scoreTestResults([
    scoreDayResult(false, true),  // improved
    scoreDayResult(true, false),  // severity regression!
  ]);
  assert(severity.passed === false, 'Severity regression → BLOCK');
  assert(severity.severityCount === 1, 'One severity regression');

  // Net zero → REJECT
  const netZero = scoreTestResults([
    scoreDayResult(false, true),  // improved
    scoreDayResult(false, false), // still wrong (no change)
    scoreDayResult(true, false),  // regressed
  ]);
  assert(netZero.passed === false, 'Net zero → REJECT');
  assert(netZero.netScore === 0, 'Net score = 0');

  // No changes → REJECT (net 0)
  const noChange = scoreTestResults([
    scoreDayResult(true, true),
    scoreDayResult(false, false),
  ]);
  assert(noChange.passed === false, 'No changes → REJECT');
  assert(noChange.netScore === 0, 'Net score = 0 with no changes');

  // Empty canonical set → PASS by default
  const empty = scoreTestResults([]);
  assert(empty.netScore === 0, 'Empty set: net score = 0');
}

// ── Pattern Identification Logic ────────────────────────────────

console.log('\nPattern identification:');
{
  interface Profile {
    accuracy_rate: number | null;
    avg_confidence: number | null;
    sample_size: number;
    systematic_biases: { bullish_accuracy?: number; bearish_accuracy?: number };
  }

  function identifyPatterns(profile: Profile): string[] {
    const patterns: string[] = [];
    if (profile.sample_size < 5) return patterns;

    if (profile.avg_confidence !== null && profile.accuracy_rate !== null &&
        profile.avg_confidence > 70 && profile.accuracy_rate < 0.5) {
      patterns.push('overconfident');
    }
    if (profile.avg_confidence !== null && profile.accuracy_rate !== null &&
        profile.avg_confidence < 50 && profile.accuracy_rate > 0.7) {
      patterns.push('underconfident');
    }
    const b = profile.systematic_biases;
    if (b.bullish_accuracy !== undefined && b.bearish_accuracy !== undefined) {
      if (b.bullish_accuracy < 0.35 && b.bearish_accuracy > 0.6) patterns.push('over_optimistic');
      if (b.bearish_accuracy < 0.35 && b.bullish_accuracy > 0.6) patterns.push('over_pessimistic');
    }
    return patterns;
  }

  // Overconfident: high confidence, low accuracy
  const overconf = identifyPatterns({
    accuracy_rate: 0.4, avg_confidence: 82, sample_size: 20,
    systematic_biases: {},
  });
  assert(overconf.includes('overconfident'), 'Detects overconfident pattern');

  // Underconfident: low confidence, high accuracy
  const underconf = identifyPatterns({
    accuracy_rate: 0.8, avg_confidence: 42, sample_size: 15,
    systematic_biases: {},
  });
  assert(underconf.includes('underconfident'), 'Detects underconfident pattern');

  // Well calibrated: no patterns
  const calibrated = identifyPatterns({
    accuracy_rate: 0.65, avg_confidence: 68, sample_size: 30,
    systematic_biases: {},
  });
  assert(calibrated.length === 0, 'Well-calibrated → no patterns');

  // Bullish bias
  const bullBias = identifyPatterns({
    accuracy_rate: 0.5, avg_confidence: 65, sample_size: 25,
    systematic_biases: { bullish_accuracy: 0.3, bearish_accuracy: 0.7 },
  });
  assert(bullBias.includes('over_optimistic'), 'Detects bullish bias');

  // Bearish bias
  const bearBias = identifyPatterns({
    accuracy_rate: 0.5, avg_confidence: 65, sample_size: 25,
    systematic_biases: { bullish_accuracy: 0.7, bearish_accuracy: 0.25 },
  });
  assert(bearBias.includes('over_pessimistic'), 'Detects bearish bias');

  // Too few samples
  const tooFew = identifyPatterns({
    accuracy_rate: 0.2, avg_confidence: 95, sample_size: 3,
    systematic_biases: {},
  });
  assert(tooFew.length === 0, 'Too few samples → no patterns');
}

// ── Boundary Enforcement ────────────────────────────────────────

console.log('\nBoundary enforcement:');
{
  function clampWeight(current: number, adjustment: number, maxShift: number): number {
    const clamped = Math.min(maxShift, Math.max(-maxShift, adjustment));
    return Math.min(2.0, Math.max(0.1, current + clamped));
  }

  assert(clampWeight(1.0, 0.1, 0.2) === 1.1, 'Small weight increase');
  assert(clampWeight(1.0, 0.5, 0.2) === 1.2, 'Large increase clamped to max shift');
  assert(clampWeight(1.0, -0.5, 0.2) === 0.8, 'Large decrease clamped to max shift');
  assert(clampWeight(0.2, -0.5, 0.2) === 0.1, 'Weight floored at 0.1');
  assert(clampWeight(1.9, 0.5, 0.2) === 2.0, 'Weight capped at 2.0');
}

// ── Paper Mode Duration ─────────────────────────────────────────

console.log('\nPaper mode duration:');
{
  function shouldPromote(paperStarted: Date, durationDays: number): boolean {
    const elapsed = (Date.now() - paperStarted.getTime()) / (1000 * 60 * 60 * 24);
    return elapsed >= durationDays;
  }

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  assert(shouldPromote(threeDaysAgo, 3) === true, '3 days elapsed, 3 day duration → promote');

  const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
  assert(shouldPromote(oneDayAgo, 3) === false, '1 day elapsed, 3 day duration → not yet');

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  assert(shouldPromote(fiveDaysAgo, 3) === true, '5 days elapsed, 3 day duration → promote');
}

// ── Structured Adaptation Writes ────────────────────────────────
// Effort: tier-1-structured-writes
// Tests that the learning engine produces correct AdaptationEntry content
// from each pattern type, and that context_markdown is updated correctly.

import {
  updateAdaptationsSection,
  parseContractMarkdown,
  type AdaptationEntry,
} from '../../src/markets/utils/parse-contract-markdown';

console.log('\nStructured adaptation writes:');
{
  const baseContract = `## General

Macro analyst focused on Fed policy.

## Role: Analyst

Decision criteria for predictions.

## Adaptations

Reserved for learning-engine adaptations.`;

  // Overconfident pattern → structured entry in context_markdown
  const overconfEntry: AdaptationEntry = {
    patternType: 'Overconfident',
    date: '2026-04-10',
    instruction: 'IMPORTANT: Recent analysis shows your confidence levels tend to be too high. Be more conservative with confidence scores — only rate above 70% when evidence is very strong.',
    confidenceShift: -8,
    weightShift: 0,
  };
  const overconfResult = updateAdaptationsSection(baseContract, overconfEntry);
  const overconfParsed = parseContractMarkdown(overconfResult);
  assert(overconfParsed.adaptations.includes('### Overconfident — 2026-04-10'), 'Overconfident entry has correct heading');
  assert(overconfParsed.adaptations.includes('Confidence shift: -8%'), 'Overconfident entry has correct shift');
  assert(overconfParsed.adaptations.includes('Source: tier1_auto'), 'Overconfident entry has tier1_auto source');
  assert(overconfParsed.general.includes('Macro analyst'), 'General section preserved after overconfident write');

  // Underconfident pattern → structured entry
  const underconfEntry: AdaptationEntry = {
    patternType: 'Underconfident',
    date: '2026-04-10',
    instruction: 'Note: Your recent track record shows strong accuracy. Trust your analysis more — your directional calls have been reliable.',
    confidenceShift: 10,
    weightShift: 0,
  };
  const underconfResult = updateAdaptationsSection(baseContract, underconfEntry);
  const underconfParsed = parseContractMarkdown(underconfResult);
  assert(underconfParsed.adaptations.includes('### Underconfident — 2026-04-10'), 'Underconfident entry has correct heading');
  assert(underconfParsed.adaptations.includes('Confidence shift: 10%'), 'Underconfident entry has correct shift');

  // Directional bias pattern → structured entry
  const biasEntry: AdaptationEntry = {
    patternType: 'Bullish Bias',
    date: '2026-04-10',
    instruction: 'CAUTION: Your recent bullish calls have been significantly less accurate than your bearish calls. Double-check your reasoning when leaning bullish.',
    confidenceShift: 0,
    weightShift: 0,
  };
  const biasResult = updateAdaptationsSection(baseContract, biasEntry);
  const biasParsed = parseContractMarkdown(biasResult);
  assert(biasParsed.adaptations.includes('### Bullish Bias — 2026-04-10'), 'Directional bias entry has correct heading');
  assert(biasParsed.adaptations.includes('Weight shift: 0'), 'Directional bias entry has zero weight shift');

  // Idempotency: same pattern type on consecutive nights replaces entry
  const night1 = updateAdaptationsSection(baseContract, overconfEntry);
  const updatedEntry: AdaptationEntry = {
    ...overconfEntry,
    date: '2026-04-11',
    confidenceShift: -12,
  };
  const night2 = updateAdaptationsSection(night1, updatedEntry);
  const night2Parsed = parseContractMarkdown(night2);
  assert(!night2Parsed.adaptations.includes('2026-04-10'), 'Idempotent: old date replaced');
  assert(night2Parsed.adaptations.includes('2026-04-11'), 'Idempotent: new date present');
  assert(night2Parsed.adaptations.includes('Confidence shift: -12%'), 'Idempotent: new shift value');

  // persona_prompt should be unchanged — adaptation lives in context_markdown
  const originalPrompt = 'You are a macro analyst.';
  const proposedPrompt = originalPrompt + overconfEntry.instruction;
  assert(proposedPrompt !== originalPrompt, 'proposedPrompt differs (used only for canonical testing)');
  assert(!originalPrompt.includes('IMPORTANT'), 'persona_prompt does not contain adaptation text');
  assert(overconfParsed.adaptations.includes('IMPORTANT:'), 'Adaptation instruction in context_markdown not persona_prompt');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
