import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(
  new URL('../../src/clubs/club-ranking.service.ts', import.meta.url),
  'utf8',
);

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

console.log('=== club-ranking.service.ts excludes testing users ===\n');

function countOccurrences(haystack: string, needle: RegExp): number {
  return (haystack.match(needle) ?? []).length;
}

test('every tournament_portfolios aggregation filters tp.user_id by is_testing', () => {
  const portfolioSites = countOccurrences(src, /prediction\.tournament_portfolios\s+tp/gi);
  assert.ok(portfolioSites >= 3, `expected ≥3 portfolio-aggregation sites, got ${portfolioSites}`);
  const filters = countOccurrences(
    src,
    /tp\.user_id\s+NOT\s+IN\s*\(\s*SELECT\s+id\s+FROM\s+authz\.users\s+WHERE\s+is_testing\s*=\s*true\s*\)/gi,
  );
  assert.equal(filters, portfolioSites, `expected one tp.user_id is_testing filter per aggregation site (got ${filters} for ${portfolioSites} sites)`);
});

test('every tournament_positions aggregation filters tpos.user_id by is_testing', () => {
  const positionSites = countOccurrences(src, /prediction\.tournament_positions\s+tpos/gi);
  assert.ok(positionSites >= 3, `expected ≥3 position-aggregation sites, got ${positionSites}`);
  const filters = countOccurrences(
    src,
    /tpos\.user_id\s+NOT\s+IN\s*\(\s*SELECT\s+id\s+FROM\s+authz\.users\s+WHERE\s+is_testing\s*=\s*true\s*\)/gi,
  );
  assert.equal(filters, positionSites, `expected one tpos.user_id is_testing filter per aggregation site (got ${filters} for ${positionSites} sites)`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
