import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(
  new URL('../../src/markets/services/leaderboard.service.ts', import.meta.url),
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

console.log('=== leaderboard.service.ts excludes testing users ===\n');

test('user_rows CTE aggregates over prediction.user_portfolios', () => {
  assert.match(src, /from\s+prediction\.user_portfolios\s+up/i);
});

test('user_rows CTE filters out authz.users.is_testing = true', () => {
  // Filter should live in the user_rows branch, near `from prediction.user_portfolios up`.
  const userRowsStart = src.indexOf('from prediction.user_portfolios up');
  assert.ok(userRowsStart > 0, 'user_portfolios aggregation not found');
  const windowAfter = src.slice(userRowsStart, userRowsStart + 600);
  assert.match(
    windowAfter,
    /is_testing\s*=\s*true/i,
    'user_rows CTE missing `is_testing = true` filter',
  );
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
