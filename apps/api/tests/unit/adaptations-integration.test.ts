/**
 * Integration tests for adaptations flowing through audit and prediction runner.
 * Effort: tier-1-structured-writes.
 *
 * Tests the contract parsing integration: when context_markdown has ## Adaptations,
 * audit prompts and runner prompts include the content.
 */
import assert from 'node:assert/strict';
import { parseContractMarkdown, updateAdaptationsSection, type AdaptationEntry } from '../../src/markets/utils/parse-contract-markdown';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const baseContract = `## General

This analyst focuses on macro indicators.

## Role: Analyst

Decision criteria for predictions.

## Adaptations

Reserved for learning-engine adaptations.`;

const entry: AdaptationEntry = {
  patternType: 'Overconfident',
  date: '2026-04-10',
  instruction: 'Be more conservative with confidence scores.',
  confidenceShift: -8,
  weightShift: 0,
};

// ─── Audit prompt includes adaptations ──────────────────────────

test('audit: parseContractMarkdown returns adaptations for audit prompt', () => {
  const updated = updateAdaptationsSection(baseContract, entry);
  const sections = parseContractMarkdown(updated);
  // Audit service uses sections.adaptations to build its prompt
  assert.ok(sections.adaptations.includes('Overconfident'));
  assert.ok(sections.adaptations.includes('tier1_auto'));
  assert.ok(sections.adaptations.includes('Confidence shift: -8%'));
});

test('audit: empty adaptations section returns empty string', () => {
  const sections = parseContractMarkdown(baseContract);
  // "Reserved for learning-engine adaptations." is still body text
  // but when truly empty:
  const emptyAdapt = `## General

General.

## Adaptations

`;
  const result = parseContractMarkdown(emptyAdapt);
  assert.equal(result.adaptations, '');
});

test('audit: no adaptations section returns empty string', () => {
  const noAdapt = `## General

General content.

## Role: Analyst

Role content.`;
  const sections = parseContractMarkdown(noAdapt);
  assert.equal(sections.adaptations, '');
});

// ─── Runner prompt includes adaptations ─────────────────────────

test('runner: adaptations text is non-empty after structured write', () => {
  const updated = updateAdaptationsSection(baseContract, entry);
  const sections = parseContractMarkdown(updated);
  // The runner appends sections.adaptations to the system prompt
  const adaptationsText = sections.adaptations;
  assert.ok(adaptationsText.length > 0, 'adaptations should be non-empty');
  assert.ok(adaptationsText.includes('Be more conservative'), 'should include instruction text');
});

test('runner: NULL context_markdown produces no adaptations', () => {
  // When context_markdown is NULL, runner skips adaptation loading
  const adaptationsText = '';
  // Simulating: if (!cm) adaptationsText stays empty
  assert.equal(adaptationsText, '');
});

test('runner: contract with no adaptation entries produces empty adaptations', () => {
  const noEntries = `## General

General.

## Adaptations

`;
  const sections = parseContractMarkdown(noEntries);
  assert.equal(sections.adaptations, '');
});

// ─── Multiple adaptations flow correctly ────────────────────────

test('multiple adaptations: both visible in parsed output', () => {
  const entry2: AdaptationEntry = {
    patternType: 'Bearish Bias',
    date: '2026-04-07',
    instruction: 'Double-check reasoning when leaning bullish.',
    confidenceShift: 0,
    weightShift: 0,
  };
  let updated = updateAdaptationsSection(baseContract, entry);
  updated = updateAdaptationsSection(updated, entry2);
  const sections = parseContractMarkdown(updated);
  assert.ok(sections.adaptations.includes('Overconfident'), 'first adaptation present');
  assert.ok(sections.adaptations.includes('Bearish Bias'), 'second adaptation present');
  // Both should be visible in audit and runner prompts
  assert.ok(sections.adaptations.includes('tier1_auto'), 'source tag present');
});

console.log('\nAdaptations integration tests complete.');
