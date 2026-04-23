import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(
  new URL('../../src/markets/markets.service.ts', import.meta.url),
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

console.log('=== getPredictionProvenance fallback path ===\n');

const fnStart = src.indexOf('async getPredictionProvenance(');
assert.ok(fnStart > 0, 'getPredictionProvenance not found');
// Look for the next top-level comment marker to cap scanning.
const nextSectionMarker = src.indexOf('// ─── Prediction LLM Calls', fnStart);
const fnBody = src.slice(
  fnStart,
  nextSectionMarker > fnStart ? nextSectionMarker : fnStart + 6000,
);

test('reads contributing_article_ids from prediction row', () => {
  assert.match(
    fnBody,
    /pred\.contributing_article_ids/,
    'function should read pred.contributing_article_ids',
  );
});

test('null contributing_article_ids → fallback path with recent scored articles', () => {
  // The null branch must set fallback = true and run the recent-scored query.
  assert.match(
    fnBody,
    /storedArticleIds\s*===\s*null/,
    'should test for null storedArticleIds',
  );
  const nullBranchStart = fnBody.indexOf('if (storedArticleIds === null)');
  assert.ok(nullBranchStart > 0, 'null-branch guard not found');
  const nullBranch = fnBody.slice(nullBranchStart, nullBranchStart + 800);
  assert.match(nullBranch, /fallback\s*=\s*true/, 'null branch should set fallback = true');
  assert.match(
    nullBranch,
    /from\s+prediction\.market_predictors\s+mp/i,
    'null branch should run the recent-scored query',
  );
  assert.match(
    nullBranch,
    /order\s+by\s+mp\.relevance_score\s+desc\s+limit\s+10/i,
    'null branch should keep the existing ordering / limit',
  );
});

test('populated contributing_article_ids → query by ID + preserve stored order, no fallback', () => {
  const populatedBranchStart = fnBody.indexOf('storedArticleIds.length > 0');
  assert.ok(populatedBranchStart > 0, 'populated-branch guard not found');
  const branch = fnBody.slice(populatedBranchStart, populatedBranchStart + 1200);
  assert.match(
    branch,
    /where\s+ma\.id\s*=\s*any\(\$3::text\[\]\)/i,
    'populated branch should filter market_articles by any($3::text[])',
  );
  assert.match(
    branch,
    /left\s+join\s+prediction\.market_predictors\s+mp/i,
    'populated branch should LEFT JOIN market_predictors (score metadata may be absent)',
  );
  assert.match(
    branch,
    /storedArticleIds\s*\.map\(\(id\)\s*=>\s*byId\.get\(id\)\)/,
    'populated branch should preserve stored order via byId Map lookup',
  );
});

test('empty contributing_article_ids ([]) → articles: [], no fallback', () => {
  // The else branch (storedArticleIds is non-null but length === 0) leaves
  // articles at its initial [] and fallback at its initial false.
  assert.match(
    fnBody,
    /let\s+articles:\s*Array<Record<string,\s*unknown>>\s*=\s*\[\];/,
    'articles initialized to []',
  );
  assert.match(fnBody, /let\s+fallback\s*=\s*false;/, 'fallback initialized to false');
});

test('return shape exposes fallback flag', () => {
  assert.match(fnBody, /\breturn\s*\{/, 'return statement present');
  assert.match(fnBody, /fallback,/, 'return object should include fallback');
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
