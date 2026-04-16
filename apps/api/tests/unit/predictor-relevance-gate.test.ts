/**
 * Tests for PredictorGeneratorService.filterByRelevance — flag-gated
 * behavior that only returns articles marked is_relevant=true for the
 * given instrument in article_instrument_relevance.
 * Effort: workflow-stages-article-pipeline (Phase 3).
 */
import assert from 'node:assert/strict';
import { PredictorGeneratorService } from '../../src/markets/services/predictor-generator.service';

interface MockCall { sql: string; params: unknown[] }
class MockDb {
  public calls: MockCall[] = [];
  public relevantArticleIds: Set<string> = new Set();

  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    if (sql.includes('article_instrument_relevance')) {
      const ids = (params[1] as string[]) ?? [];
      return {
        data: ids.filter(id => this.relevantArticleIds.has(id)).map(id => ({ article_id: id })),
        error: null,
      };
    }
    return { data: [], error: null };
  }
}

const mockObservability: any = { push: async () => {} };
const mockLlm: any = { isLlmEnabled: () => false, generateText: async () => ({ text: '', provider: 'x', model: 'y', llmUsageId: null }) };

function test(name: string, fn: () => Promise<void> | void) {
  Promise.resolve(fn())
    .then(() => console.log(`PASS  ${name}`))
    .catch(err => { console.error(`FAIL  ${name}`); console.error(err); process.exitCode = 1; });
}

const instrument = { id: 'inst-1', symbol: 'AAPL', name: 'Apple Inc.', asset_type: 'stock' };
const articles = [
  { id: 'a1', title: 't1', summary: null, content: null, source_id: 's', published_at: null },
  { id: 'a2', title: 't2', summary: null, content: null, source_id: 's', published_at: null },
  { id: 'a3', title: 't3', summary: null, content: null, source_id: 's', published_at: null },
];

test('filterByRelevance returns only articles marked is_relevant=true', async () => {
  const db = new MockDb();
  db.relevantArticleIds = new Set(['a1', 'a3']);
  const svc = new PredictorGeneratorService(db as any, mockObservability, mockLlm);
  const filterFn = (svc as any).filterByRelevance.bind(svc);
  const result = await filterFn(instrument, articles);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((a: { id: string }) => a.id).sort(), ['a1', 'a3']);
});

test('filterByRelevance returns empty when no articles are relevant', async () => {
  const db = new MockDb();
  db.relevantArticleIds = new Set();
  const svc = new PredictorGeneratorService(db as any, mockObservability, mockLlm);
  const filterFn = (svc as any).filterByRelevance.bind(svc);
  const result = await filterFn(instrument, articles);
  assert.equal(result.length, 0);
});

test('filterByRelevance queries with instrument id and article ids', async () => {
  const db = new MockDb();
  db.relevantArticleIds = new Set(['a2']);
  const svc = new PredictorGeneratorService(db as any, mockObservability, mockLlm);
  const filterFn = (svc as any).filterByRelevance.bind(svc);
  await filterFn(instrument, articles);
  const relevanceCall = db.calls.find(c => c.sql.includes('article_instrument_relevance'));
  assert.ok(relevanceCall, 'should query article_instrument_relevance');
  assert.equal(relevanceCall!.params[0], 'inst-1');
  assert.deepEqual(relevanceCall!.params[1], ['a1', 'a2', 'a3']);
});

test('filterByRelevance short-circuits on empty input', async () => {
  const db = new MockDb();
  const svc = new PredictorGeneratorService(db as any, mockObservability, mockLlm);
  const filterFn = (svc as any).filterByRelevance.bind(svc);
  const result = await filterFn(instrument, []);
  assert.equal(result.length, 0);
  assert.equal(db.calls.length, 0, 'should not hit the database');
});
