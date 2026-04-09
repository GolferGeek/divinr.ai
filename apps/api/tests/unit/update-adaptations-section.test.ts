/**
 * Tests for updateAdaptationsSection utility.
 * Effort: tier-1-structured-writes.
 */
import assert from 'node:assert/strict';
import {
  parseContractMarkdown,
  updateAdaptationsSection,
  AdaptationEntry,
} from '../../src/markets/utils/parse-contract-markdown';

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

const entry1: AdaptationEntry = {
  patternType: 'Overconfident',
  date: '2026-04-10',
  instruction:
    'Recent analysis shows confidence levels exceed accuracy. Be more conservative — only rate above 70% when evidence is very strong.',
  confidenceShift: -8,
  weightShift: 0,
};

const entry2: AdaptationEntry = {
  patternType: 'Bearish Bias',
  date: '2026-04-07',
  instruction:
    'Bullish calls have been significantly less accurate than bearish. Double-check reasoning when leaning bullish.',
  confidenceShift: 0,
  weightShift: 0,
};

// ─── Tests ──────────────────────────────────────────────────────

test('append single entry to empty Adaptations section', () => {
  const result = updateAdaptationsSection(baseContract, entry1);
  assert.ok(result.includes('### Overconfident — 2026-04-10'));
  assert.ok(result.includes('Confidence shift: -8%'));
  assert.ok(result.includes('Source: tier1_auto'));
  // The "Reserved" placeholder should be gone (replaced by real entry)
  // Actually the placeholder has no ### heading, so it gets dropped
});

test('append second entry with different pattern type', () => {
  const after1 = updateAdaptationsSection(baseContract, entry1);
  const after2 = updateAdaptationsSection(after1, entry2);
  assert.ok(after2.includes('### Overconfident — 2026-04-10'));
  assert.ok(after2.includes('### Bearish Bias — 2026-04-07'));
  assert.ok(after2.includes('Confidence shift: -8%'));
  assert.ok(after2.includes('Confidence shift: 0%'));
});

test('idempotent update: same pattern type replaces existing entry', () => {
  const after1 = updateAdaptationsSection(baseContract, entry1);
  const updatedEntry: AdaptationEntry = {
    patternType: 'Overconfident',
    date: '2026-04-11',
    instruction: 'Updated instruction after second night.',
    confidenceShift: -12,
    weightShift: 0,
  };
  const after2 = updateAdaptationsSection(after1, updatedEntry);
  // Old entry gone
  assert.ok(!after2.includes('2026-04-10'));
  assert.ok(!after2.includes('Confidence shift: -8%'));
  // New entry present
  assert.ok(after2.includes('### Overconfident — 2026-04-11'));
  assert.ok(after2.includes('Confidence shift: -12%'));
  assert.ok(after2.includes('Updated instruction'));
});

test('contract with no Adaptations section — section is created', () => {
  const noAdapt = `## General

General content.

## Role: Analyst

Role content.`;

  const result = updateAdaptationsSection(noAdapt, entry1);
  assert.ok(result.includes('## Adaptations'));
  assert.ok(result.includes('### Overconfident — 2026-04-10'));
  // Original sections preserved
  assert.ok(result.includes('## General'));
  assert.ok(result.includes('## Role: Analyst'));
});

test('round-trip: updateAdaptationsSection → parseContractMarkdown', () => {
  const result = updateAdaptationsSection(baseContract, entry1);
  const parsed = parseContractMarkdown(result);
  assert.ok(parsed.adaptations.includes('Overconfident'));
  assert.ok(parsed.adaptations.includes('tier1_auto'));
  assert.ok(parsed.adaptations.includes('-8%'));
  assert.ok(parsed.general.includes('macro indicators'));
  assert.equal(Object.keys(parsed.roles).length, 1);
  assert.ok(parsed.roles['Analyst']?.includes('Decision criteria'));
});

test('preserves other sections unchanged', () => {
  const result = updateAdaptationsSection(baseContract, entry1);
  const parsed = parseContractMarkdown(result);
  assert.equal(parsed.general, 'This analyst focuses on macro indicators.');
  assert.equal(parsed.roles['Analyst'], 'Decision criteria for predictions.');
});

console.log('\nupdateAdaptationsSection tests complete.');
