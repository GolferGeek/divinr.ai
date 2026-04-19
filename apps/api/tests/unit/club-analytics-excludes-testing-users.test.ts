import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(
  new URL('../../src/clubs/club-analytics.service.ts', import.meta.url),
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

console.log('=== club-analytics.service.ts excludes testing users ===\n');

test('trusted-analysts aggregation filters uaa.user_id by is_testing', () => {
  const aggIdx = src.indexOf('prediction.user_analyst_affinity uaa');
  assert.ok(aggIdx > 0, 'expected user_analyst_affinity aggregation');
  const windowAfter = src.slice(aggIdx, aggIdx + 600);
  assert.match(
    windowAfter,
    /uaa\.user_id\s+NOT\s+IN\s*\(\s*SELECT\s+id\s+FROM\s+authz\.users\s+WHERE\s+is_testing\s*=\s*true\s*\)/i,
    'trusted-analysts missing uaa.user_id NOT IN (SELECT … is_testing = true)',
  );
});

test('common-mistakes aggregation filters tpos.user_id by is_testing', () => {
  const aggIdx = src.indexOf("total_loss, COUNT(*)::int as trade_count");
  assert.ok(aggIdx > 0, 'expected common-mistakes aggregation');
  const windowAfter = src.slice(aggIdx, aggIdx + 700);
  assert.match(
    windowAfter,
    /tpos\.user_id\s+NOT\s+IN\s*\(\s*SELECT\s+id\s+FROM\s+authz\.users\s+WHERE\s+is_testing\s*=\s*true\s*\)/i,
    'common-mistakes missing tpos.user_id NOT IN filter',
  );
});

test('contrarian-spotlights aggregation filters v.user_id via u.is_testing', () => {
  const aggIdx = src.indexOf('prediction.club_consensus_votes v');
  assert.ok(aggIdx > 0, 'expected contrarian-spotlights query');
  const windowAfter = src.slice(aggIdx, aggIdx + 700);
  assert.match(
    windowAfter,
    /coalesce\(\s*u\.is_testing[^)]*\)\s*=\s*false/i,
    'contrarian-spotlights missing coalesce(u.is_testing, false) = false',
  );
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
