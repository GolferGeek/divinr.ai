/**
 * Tests for parseContractMarkdown (shared util).
 * Effort: analyst-contracts.
 */
import assert from 'node:assert/strict';
import { parseContractMarkdown } from '../../src/markets/utils/parse-contract-markdown';

// ─── Tests ──────────────────────────────────────────────────────

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

test('happy path: all three sections present', () => {
  const md = `> v1 placeholder context

## General

This analyst focuses on macro indicators.

## Role: Analyst

Decision criteria for predictions.

## Adaptations

Reserved for learning-engine adaptations.`;

  const result = parseContractMarkdown(md);
  assert.ok(result.general.includes('macro indicators'));
  assert.ok(result.roles['Analyst']?.includes('Decision criteria'));
  assert.ok(result.adaptations.includes('Reserved'));
});

test('multiple role sections', () => {
  const md = `## General

General content.

## Role: Analyst

Prediction logic.

## Role: Arbitrator

Debate logic.

## Adaptations

`;

  const result = parseContractMarkdown(md);
  assert.equal(Object.keys(result.roles).length, 2);
  assert.ok(result.roles['Analyst']?.includes('Prediction logic'));
  assert.ok(result.roles['Arbitrator']?.includes('Debate logic'));
});

test('missing adaptations returns empty string', () => {
  const md = `## General

Some general content.

## Role: Analyst

Role content.`;

  const result = parseContractMarkdown(md);
  assert.equal(result.adaptations, '');
  assert.ok(result.general.length > 0);
  assert.ok(result.roles['Analyst']?.length > 0);
});

test('missing general returns empty string', () => {
  const md = `## Role: Portfolio Manager

PM content.

## Adaptations

Adapt.`;

  const result = parseContractMarkdown(md);
  assert.equal(result.general, '');
  assert.ok(result.roles['Portfolio Manager']?.includes('PM content'));
  assert.ok(result.adaptations.includes('Adapt'));
});

test('empty input returns empty sections', () => {
  const result = parseContractMarkdown('');
  assert.equal(result.general, '');
  assert.equal(Object.keys(result.roles).length, 0);
  assert.equal(result.adaptations, '');
});

test('unrecognized headings are ignored', () => {
  const md = `## General

General.

## Notes

Some notes.

## Role: Analyst

Analyst stuff.

## Adaptations

`;

  const result = parseContractMarkdown(md);
  assert.ok(result.general.includes('General'));
  assert.ok(result.roles['Analyst']?.includes('Analyst stuff'));
  assert.equal(result.adaptations, '');
  // "Notes" is not in any section
  assert.ok(!result.general.includes('notes'));
});

test('whitespace is trimmed from section bodies', () => {
  const md = `## General

   Indented content with trailing spaces.

## Adaptations

`;

  const result = parseContractMarkdown(md);
  assert.equal(result.general, 'Indented content with trailing spaces.');
});

console.log('\nContract markdown parser tests complete.');
