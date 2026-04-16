/**
 * Tests for instrumentKeywordScore (shared keyword-match helper).
 * Effort: workflow-stages-article-pipeline (Phase 2).
 */
import assert from 'node:assert/strict';
import { instrumentKeywordScore } from '../../src/markets/utils/instrument-keyword-match';

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

const aapl = { symbol: 'AAPL', name: 'Apple Inc.' };
const tsla = { symbol: 'TSLA', name: 'Tesla Inc.' };

test('symbol match returns 1.0', () => {
  const article = { title: 'AAPL hits new high', summary: null, content: null };
  assert.equal(instrumentKeywordScore(article, aapl), 1.0);
});

test('full name match returns 0.9', () => {
  const article = { title: 'Apple Inc. reports earnings', summary: null, content: null };
  assert.equal(instrumentKeywordScore(article, aapl), 0.9);
});

test('first-word match returns 0.7 when word > 3 chars', () => {
  const article = { title: 'Tesla plans new factory', summary: null, content: null };
  assert.equal(instrumentKeywordScore(article, tsla), 0.7);
});

test('no match returns 0', () => {
  const article = { title: 'Fed raises rates', summary: 'Inflation concerns', content: null };
  assert.equal(instrumentKeywordScore(article, aapl), 0);
});

test('symbol in content (not title) still matches', () => {
  const article = { title: 'Market movers today', summary: null, content: 'Shares of TSLA surged 5%' };
  assert.equal(instrumentKeywordScore(article, tsla), 1.0);
});

test('partial symbol without word boundary does not match', () => {
  const article = { title: 'AAPLX is a mutual fund ticker', summary: null, content: null };
  assert.equal(instrumentKeywordScore(article, aapl), 0);
});

test('case insensitive symbol match', () => {
  const article = { title: 'Gains for aapl today', summary: null, content: null };
  assert.equal(instrumentKeywordScore(article, aapl), 1.0);
});

test('null content fields handled gracefully', () => {
  const article = { title: null, summary: null, content: null };
  assert.equal(instrumentKeywordScore(article, aapl), 0);
});
