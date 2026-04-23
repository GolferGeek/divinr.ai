import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const runnerSrc = readFileSync(
  new URL('../../src/markets/services/prediction-runner.service.ts', import.meta.url),
  'utf8',
);
const schemaSrc = readFileSync(
  new URL('../../src/markets/schema/markets-schema.service.ts', import.meta.url),
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

console.log('=== prediction-runner contributing_article_ids write path ===\n');

test('schema service registers contributing_article_ids on market_predictions', () => {
  assert.match(
    schemaSrc,
    /alter\s+table\s+prediction\.market_predictions\s+add\s+column\s+if\s+not\s+exists\s+contributing_article_ids\s+jsonb/i,
    'market_predictions missing `add column if not exists contributing_article_ids jsonb` DDL',
  );
});

test('loadPredictorLines returns article IDs alongside rendered lines', () => {
  const fnStart = runnerSrc.indexOf('private async loadPredictorLines');
  assert.ok(fnStart > 0, 'loadPredictorLines not found');
  const fnBody = runnerSrc.slice(fnStart, fnStart + 1800);
  assert.match(
    fnBody,
    /Promise<\{\s*lines:\s*string\[\];\s*articleIds:\s*string\[\]\s*\}>/,
    'loadPredictorLines should return `{ lines, articleIds }`',
  );
  assert.match(
    fnBody,
    /select\s+mp\.article_id,/i,
    'loadPredictorLines SQL should select mp.article_id',
  );
  assert.match(
    fnBody,
    /return\s*\{\s*lines,\s*articleIds\s*\};?/,
    'loadPredictorLines should return the destructured object',
  );
});

test('runSingleAnalyst captures analyst article IDs and inserts them', () => {
  const analystFnStart = runnerSrc.indexOf('private async runSingleAnalyst');
  assert.ok(analystFnStart > 0, 'runSingleAnalyst not found');
  const arbitratorFnStart = runnerSrc.indexOf('private async runArbitrator');
  assert.ok(arbitratorFnStart > analystFnStart, 'runArbitrator must follow runSingleAnalyst');
  const analystBody = runnerSrc.slice(analystFnStart, arbitratorFnStart);

  assert.match(
    analystBody,
    /articleIds:\s*analystArticleIds\s*\}\s*=\s*await this\.loadPredictorLines/,
    'runSingleAnalyst should destructure articleIds from loadPredictorLines',
  );
  // INSERT column list includes contributing_article_ids
  const insertMatch = analystBody.match(
    /insert\s+into\s+prediction\.market_predictions\s*\(([\s\S]*?)\)/i,
  );
  assert.ok(insertMatch, 'analyst INSERT not found');
  assert.match(
    insertMatch![1],
    /contributing_article_ids/i,
    'analyst INSERT column list missing contributing_article_ids',
  );
  // Param list stringifies analystArticleIds
  assert.match(
    analystBody,
    /JSON\.stringify\(analystArticleIds\)/,
    'analyst INSERT params should JSON.stringify(analystArticleIds)',
  );
  // Outcome object exposes article_ids
  assert.match(
    analystBody,
    /article_ids:\s*analystArticleIds/,
    'analyst outcome should expose article_ids = analystArticleIds',
  );
});

test('runArbitrator unions analyst article IDs and inserts the dedup set', () => {
  const arbitratorFnStart = runnerSrc.indexOf('private async runArbitrator');
  assert.ok(arbitratorFnStart > 0, 'runArbitrator not found');
  // Use the next private method as a cap to avoid greedy scanning.
  const nextPrivateStart = runnerSrc.indexOf('private ', arbitratorFnStart + 'private async runArbitrator'.length);
  const arbitratorBody = runnerSrc.slice(
    arbitratorFnStart,
    nextPrivateStart > arbitratorFnStart ? nextPrivateStart + 200 : arbitratorFnStart + 4000,
  );

  assert.match(
    arbitratorBody,
    /\[\s*\.\.\.new\s+Set\(\s*analystOutcomes\.flatMap\(\(o\)\s*=>\s*o\.article_ids\s*\?\?\s*\[\]\)\s*\)\s*,?\s*\]/,
    'runArbitrator should compute `new Set(flatMap(o.article_ids ?? []))`',
  );
  const insertMatch = arbitratorBody.match(
    /insert\s+into\s+prediction\.market_predictions\s*\(([\s\S]*?)\)/i,
  );
  assert.ok(insertMatch, 'arbitrator INSERT not found');
  assert.match(
    insertMatch![1],
    /contributing_article_ids/i,
    'arbitrator INSERT column list missing contributing_article_ids',
  );
  assert.match(
    arbitratorBody,
    /JSON\.stringify\(unionedArticleIds\)/,
    'arbitrator INSERT params should JSON.stringify(unionedArticleIds)',
  );
  assert.match(
    arbitratorBody,
    /article_ids:\s*unionedArticleIds/,
    'arbitrator outcome should expose article_ids = unionedArticleIds',
  );
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
