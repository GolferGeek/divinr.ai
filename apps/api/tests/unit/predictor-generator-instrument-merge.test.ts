/**
 * Phase 4 integration test: PredictorGeneratorService loads the instrument
 * contract fragment alongside the analyst contract fragment and merges them
 * into the systemPrompt passed to the LLM.
 *
 * Effort: instrument-contracts (Phase 4).
 */
import assert from 'node:assert/strict';
import { PredictorGeneratorService } from '../../src/markets/services/predictor-generator.service';

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve(fn())
    .then(() => console.log(`PASS  ${name}`))
    .catch((err) => {
      console.error(`FAIL  ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

process.env.MARKETS_ENABLE_LLM = 'true';

const INSTRUMENT_CONTRACT_MD = `## General

AAPL general body.

## Stage: Article Processing

AAPL articles body.

## Stage: Predictor Generation

TOKEN-INSTRUMENT-PRED instrument-specific predictor framing.

## Stage: Risk Assessment — Reflection (3a)

AAPL reflection body.

## Stage: Risk Assessment — Debate (3b)

AAPL debate body.

## Stage: Prediction Generation

AAPL prediction body.

## Stage: Learning

AAPL learning body.

## Adaptations

AAPL adaptations.
`;

const ANALYST_CONTRACT_MD = `## General

Contrarian general body.

## Role: Contrarian

Contrarian role body.

## Stage: Predictor Generation

TOKEN-ANALYST-PRED contrarian-specific predictor framing.

## Stage: Risk Assessment — Reflection (3a)

Contrarian reflection body.

## Stage: Risk Assessment — Debate (3b)

Contrarian debate body.

## Stage: Prediction Generation

Contrarian prediction body.

## Stage: Learning

Contrarian learning body.

## Adaptations

Contrarian adaptations.
`;

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
        typeof plan.match === 'string' ? normalized.includes(plan.match) : plan.match.test(normalized);
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
  public lastSystemPrompt: string | null = null;
  public generatedCount = 0;
  isLlmEnabled() {
    return true;
  }
  buildExecutionContext(_userId: string, _domain: string) {
    return { conversationId: 'test', userId: 'system' } as never;
  }
  async generateText(_ctx: unknown, systemPrompt: string, _userPrompt: string) {
    this.lastSystemPrompt = systemPrompt;
    this.generatedCount += 1;
    return {
      text: JSON.stringify({ relevance: 0.7, rationale: 'stub', dismiss: false }),
      provider: 'stub',
      model: 'stub',
      llmUsageId: 'usage-1',
    };
  }
}

const INSTRUMENT = { id: 'instr-aapl', symbol: 'AAPL', name: 'Apple Inc.', asset_type: 'stock' };
const ANALYST = {
  id: 'analyst-contrarian',
  slug: 'contrarian',
  display_name: 'The Contrarian',
  scoring_focus: 'Look for hype divergence.',
  current_config_version_id: 'analyst-cfg-1',
};
const ARTICLE = {
  id: 'article-1',
  title: 'AAPL earnings',
  summary: 'summary',
  content: 'content',
  source_id: 'src-1',
  published_at: new Date().toISOString(),
};

function makeSvc(db: PlannedDb, obs: StubObservability, llm: StubLlm) {
  return new PredictorGeneratorService(db as never, obs as never, llm as never);
}

async function callScore(svc: PredictorGeneratorService) {
  return (svc as unknown as {
    scoreArticleForInstrument: (
      a: typeof ARTICLE,
      i: typeof INSTRUMENT,
      an: typeof ANALYST,
    ) => Promise<{ relevanceScore: number; rationale: string; dismissed: boolean }>;
  }).scoreArticleForInstrument(ARTICLE, INSTRUMENT, ANALYST);
}

async function run() {
  console.log('\n=== Predictor Generator × Instrument Contract Merge Tests ===\n');

  await test('systemPrompt contains both instrument and analyst distinctive tokens with labeled blocks', async () => {
    const db = new PlannedDb([
      // Instrument contract loader query
      { match: 'JOIN prediction.instrument_config_versions', rows: [{ config_id: 'instr-cfg-1', context_markdown: INSTRUMENT_CONTRACT_MD }] },
      // Analyst contract loader query
      { match: 'SELECT context_markdown FROM prediction.analyst_config_versions', rows: [{ context_markdown: ANALYST_CONTRACT_MD }] },
      // upsert predictor — just accept
      { match: 'insert into prediction.market_predictors', rows: [] },
    ]);
    const obs = new StubObservability();
    const llm = new StubLlm();
    const svc = makeSvc(db, obs, llm);

    await callScore(svc);
    assert.ok(llm.lastSystemPrompt, 'systemPrompt captured');
    assert.ok(llm.lastSystemPrompt!.includes('TOKEN-INSTRUMENT-PRED'), 'instrument token present');
    assert.ok(llm.lastSystemPrompt!.includes('TOKEN-ANALYST-PRED'), 'analyst token present');
    assert.ok(llm.lastSystemPrompt!.includes('[Instrument: AAPL]'), 'instrument label present');
    assert.ok(llm.lastSystemPrompt!.includes('[Analyst: contrarian]'), 'analyst label present');
    const instrIdx = llm.lastSystemPrompt!.indexOf('[Instrument: AAPL]');
    const analystIdx = llm.lastSystemPrompt!.indexOf('[Analyst: contrarian]');
    assert.ok(instrIdx < analystIdx, 'instrument block precedes analyst block');
  });

  await test('falls back to analyst-only systemPrompt when instrument has no contract (no label added)', async () => {
    const db = new PlannedDb([
      // Instrument loader returns no rows → fallback
      { match: 'JOIN prediction.instrument_config_versions', rows: [] },
      // Analyst loader still resolves
      { match: 'SELECT context_markdown FROM prediction.analyst_config_versions', rows: [{ context_markdown: ANALYST_CONTRACT_MD }] },
      { match: 'insert into prediction.market_predictors', rows: [] },
    ]);
    const obs = new StubObservability();
    const llm = new StubLlm();
    const svc = makeSvc(db, obs, llm);

    await callScore(svc);
    assert.ok(llm.lastSystemPrompt);
    assert.ok(llm.lastSystemPrompt!.includes('TOKEN-ANALYST-PRED'), 'analyst token still present');
    assert.ok(!llm.lastSystemPrompt!.includes('TOKEN-INSTRUMENT-PRED'), 'no instrument token');
    assert.ok(!llm.lastSystemPrompt!.includes('[Instrument:'), 'no instrument label on fallback');
    assert.ok(!llm.lastSystemPrompt!.includes('[Analyst:'), 'no analyst label on instrument-fallback (byte-identical to today)');
  });

  console.log('\nPredictor generator × instrument contract merge tests complete.');
}

run();
