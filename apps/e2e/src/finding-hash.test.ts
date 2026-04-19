import assert from 'node:assert/strict';
import { findingHash } from './finding-hash.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed += 1;
  }
}

console.log('=== findingHash ===\n');

test('deterministic — same inputs produce same hash', () => {
  const a = findingHash('tests/foo.spec.ts', 'bar');
  const b = findingHash('tests/foo.spec.ts', 'bar');
  assert.equal(a, b);
});

test('whitespace in test-name changes the hash', () => {
  const a = findingHash('tests/foo.spec.ts', 'bar');
  const b = findingHash('tests/foo.spec.ts', 'bar ');
  assert.notEqual(a, b);
});

test('returns exactly 8 hex chars', () => {
  const h = findingHash('tests/foo.spec.ts', 'bar');
  assert.match(h, /^[0-9a-f]{8}$/);
});

test('empty strings hash cleanly', () => {
  const h = findingHash('', '');
  assert.match(h, /^[0-9a-f]{8}$/);
});

test('different spec path changes the hash', () => {
  const a = findingHash('tests/foo.spec.ts', 'bar');
  const b = findingHash('tests/baz.spec.ts', 'bar');
  assert.notEqual(a, b);
});

test('explicit snapshot vector', () => {
  const h = findingHash(
    'tests/predictions/smoke.spec.ts',
    'loads the predictions list',
  );
  assert.equal(h, '9dd6098d');
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
