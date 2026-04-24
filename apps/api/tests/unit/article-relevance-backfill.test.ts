/**
 * Tests for ArticleRelevanceService.backfillForInstrument — the per-instrument
 * backfill path added for ethan-feedback-2026-04-24 fix #1 so that newly added
 * instruments get coverage from the last 7 days of articles instead of waiting
 * for the next article to arrive.
 */
import assert from 'node:assert/strict';
import { ArticleRelevanceService } from '../../src/markets/services/article-relevance.service';

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve(fn())
    .then(() => console.log(`PASS  ${name}`))
    .catch((err) => {
      console.error(`FAIL  ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

interface PlannedQuery {
  match: RegExp | string;
  rows?: unknown[];
}

class PlannedDb {
  public calls: Array<{ sql: string; params: unknown[] }> = [];
  constructor(private plans: PlannedQuery[]) {}
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, ' ').trim();
    for (const plan of this.plans) {
      const matched =
        typeof plan.match === 'string'
          ? normalized.includes(plan.match)
          : plan.match.test(normalized);
      if (matched) {
        return { data: plan.rows ?? [], error: null };
      }
    }
    return { data: [], error: null };
  }
}

class StubObservability {
  public pushed: Array<Record<string, unknown>> = [];
  async push(evt: Record<string, unknown>) {
    this.pushed.push(evt);
  }
}

class StubLlm {
  public callCount = 0;
  isLlmEnabled() {
    return false;
  }
  async generateText() {
    this.callCount++;
    return { text: '{"is_relevant": false, "rationale": "stub"}', provider: 'stub', model: 'stub', llmUsageId: null };
  }
}

function makeSvc(db: PlannedDb) {
  return new ArticleRelevanceService(db as never, new StubObservability() as never, new StubLlm() as never);
}

const INSTRUMENT_ID = 'instr-aapl';
const APPLE = { id: INSTRUMENT_ID, symbol: 'AAPL', name: 'Apple Inc.' };

async function run() {
  console.log('\n=== ArticleRelevanceService.backfillForInstrument ===\n');

  await test('returns empty result when instrument is not found', async () => {
    // Instrument lookup returns zero rows — the method should short-circuit.
    const db = new PlannedDb([
      { match: 'from prediction.instruments where id = $1', rows: [] },
    ]);
    const svc = makeSvc(db);

    const result = await svc.backfillForInstrument(INSTRUMENT_ID);

    assert.deepEqual(result, { pairsEvaluated: 0, keywordDecided: 0, llmDecided: 0, relevantPairs: 0 });
    // Second query (articles) should NOT have been issued
    assert.equal(db.calls.length, 1, 'only the instrument lookup should run');
  });

  await test('returns empty result when no recent articles are missing a pair', async () => {
    const db = new PlannedDb([
      { match: 'from prediction.instruments where id = $1', rows: [APPLE] },
      { match: 'from prediction.market_articles ma', rows: [] },
    ]);
    const svc = makeSvc(db);

    const result = await svc.backfillForInstrument(INSTRUMENT_ID);

    assert.deepEqual(result, { pairsEvaluated: 0, keywordDecided: 0, llmDecided: 0, relevantPairs: 0 });
    assert.equal(db.calls.length, 2, 'instrument + article queries');
  });

  await test('classifies each returned article against the instrument', async () => {
    const articles = [
      { id: 'a1', title: 'AAPL hits new high', summary: null, content: null },       // symbol match → keyword relevant
      { id: 'a2', title: 'Fed raises rates', summary: null, content: null },          // no match → keyword not-relevant
      { id: 'a3', title: 'Apple Inc. earnings', summary: null, content: null },       // name match → keyword relevant
    ];
    const db = new PlannedDb([
      { match: 'from prediction.instruments where id = $1', rows: [APPLE] },
      { match: 'from prediction.market_articles ma', rows: articles },
      // pairExists always false — no prior relevance records
      { match: 'from prediction.article_instrument_relevance where article_id', rows: [] },
      // writeRelevance insert — no returned rows needed
      { match: 'insert into prediction.article_instrument_relevance', rows: [] },
    ]);
    const svc = makeSvc(db);

    const result = await svc.backfillForInstrument(INSTRUMENT_ID);

    assert.equal(result.pairsEvaluated, 3, 'three articles evaluated');
    assert.equal(result.keywordDecided, 3, 'all three decided by keyword (no LLM needed)');
    assert.equal(result.llmDecided, 0, 'LLM path not taken for strong keyword matches or clear misses');
    assert.equal(result.relevantPairs, 2, 'two relevant (AAPL symbol + Apple Inc. name)');
  });

  await test('skips articles that already have a relevance row (pairExists short-circuit)', async () => {
    const articles = [
      { id: 'a1', title: 'AAPL hits new high', summary: null, content: null },
      { id: 'a2', title: 'AAPL dips', summary: null, content: null },
    ];
    const db = new PlannedDb([
      { match: 'from prediction.instruments where id = $1', rows: [APPLE] },
      { match: 'from prediction.market_articles ma', rows: articles },
      // pairExists returns a row → pair already classified, classifyPair bails before incrementing counters
      { match: 'from prediction.article_instrument_relevance where article_id', rows: [{ '?column?': 1 }] },
    ]);
    const svc = makeSvc(db);

    const result = await svc.backfillForInstrument(INSTRUMENT_ID);

    assert.equal(result.pairsEvaluated, 0, 'no new pairs evaluated when all already exist');
    assert.equal(result.keywordDecided, 0);
    assert.equal(result.relevantPairs, 0);
  });

  await test('article-missing-pair query is parameterized by instrument id', async () => {
    const db = new PlannedDb([
      { match: 'from prediction.instruments where id = $1', rows: [APPLE] },
      { match: 'from prediction.market_articles ma', rows: [] },
    ]);
    const svc = makeSvc(db);

    await svc.backfillForInstrument(INSTRUMENT_ID);

    const articlesQuery = db.calls.find((c) => c.sql.includes('from prediction.market_articles'));
    assert.ok(articlesQuery, 'articles query was issued');
    assert.deepEqual(articlesQuery!.params, [INSTRUMENT_ID], 'instrument id passed as $1');
    // The recent-article cap should be inlined into the SQL (not a param) and match the module constant.
    assert.match(articlesQuery!.sql, /limit 200/i, 'backfill uses the BACKFILL_RECENT_ARTICLE_LIMIT cap');
  });

  console.log('\nArticle relevance backfill tests complete.');
}

run();
