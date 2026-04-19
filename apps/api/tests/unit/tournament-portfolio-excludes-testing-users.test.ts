import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(
  new URL('../../src/tournaments/tournament-portfolio.service.ts', import.meta.url),
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

console.log('=== tournament-portfolio.service.ts excludes testing users ===\n');

test('listEntries query excludes users where is_testing is true', () => {
  const joinIdx = src.indexOf('LEFT JOIN authz.users u ON u.id = te.user_id');
  assert.ok(joinIdx > 0, 'expected LEFT JOIN authz.users on te.user_id');
  const windowAfter = src.slice(joinIdx, joinIdx + 400);
  assert.match(
    windowAfter,
    /coalesce\(\s*u\.is_testing[^)]*\)\s*=\s*false/i,
    'listEntries query missing coalesce(u.is_testing, false) = false',
  );
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
