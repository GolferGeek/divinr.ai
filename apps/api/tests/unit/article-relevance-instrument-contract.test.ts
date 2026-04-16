/**
 * Tests for article-relevance Stage 1 wiring to instrument contract fragment.
 * Verifies:
 *   - When an instrument has a v1 contract, the classifier's systemPrompt is
 *     the instrument fragment + trailing JSON/legal-language instructions.
 *   - When an instrument has no contract, the classifier falls back to the
 *     hardcoded systemPrompt (verbatim today's behavior).
 *   - Missing Article Processing section also triggers fallback + emits a
 *     pipeline.instrument_contract.fallback event.
 *
 * Effort: instrument-contracts (Phase 3).
 */
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
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

// Force LLM enabled via env for these tests.
process.env.MARKETS_ENABLE_LLM = 'true';

const VALID_MD = `## General

AAPL general body.

## Stage: Article Processing

DISTINCTIVE-TOKEN-ARTPROC-42. Decide relevance by hardware ecosystem, services, and supply chain.

## Stage: Predictor Generation

PG body.

## Stage: Risk Assessment — Reflection (3a)

RR body.

## Stage: Risk Assessment — Debate (3b)

RD body.

## Stage: Prediction Generation

PGen body.

## Stage: Learning

L body.

## Adaptations

A body.
`;

const PARTIAL_MD_NO_ARTICLE_PROCESSING = `## General

G

## Stage: Predictor Generation

PG

## Stage: Risk Assessment — Reflection (3a)

RR

## Stage: Risk Assessment — Debate (3b)

RD

## Stage: Prediction Generation

PGen

## Stage: Learning

L

## Adaptations

A
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
  public lastSystemPrompt: string | null = null;
  isLlmEnabled() {
    return true;
  }
  async generateText(_context: unknown, systemPrompt: string, _userPrompt: string) {
    this.lastSystemPrompt = systemPrompt;
    return {
      text: JSON.stringify({ is_relevant: true, rationale: 'stub' }),
      provider: 'stub',
      model: 'stub',
      llmUsageId: 'usage-1',
    };
  }
}

const INSTRUMENT = { id: 'instr-aapl', symbol: 'AAPL', name: 'Apple Inc.' };
const ARTICLE = {
  id: 'article-1',
  title: 'AAPL news',
  summary: 'stuff',
  content: 'more stuff',
};

function makeSvc(db: PlannedDb, obs: StubObservability, llm: StubLlm) {
  return new ArticleRelevanceService(db as never, obs as never, llm as never);
}

// llmClassify is private — expose via `as any` for tests.
async function callLlmClassify(svc: ArticleRelevanceService) {
  return (svc as unknown as { llmClassify: (a: typeof ARTICLE, i: typeof INSTRUMENT) => Promise<{ isRelevant: boolean; rationale: string; llmUsageId: string | null }> })
    .llmClassify(ARTICLE, INSTRUMENT);
}

async function run() {
  console.log('\n=== Article Relevance × Instrument Contract Tests ===\n');

  await test('systemPrompt contains instrument fragment when contract exists', async () => {
    const db = new PlannedDb([
      // Loader query — joins instruments + instrument_config_versions
      { match: 'JOIN prediction.instrument_config_versions', rows: [{ config_id: 'cfg-1', context_markdown: VALID_MD }] },
    ]);
    const obs = new StubObservability();
    const llm = new StubLlm();
    const svc = makeSvc(db, obs, llm);

    const result = await callLlmClassify(svc);
    assert.equal(result.isRelevant, true);
    assert.ok(llm.lastSystemPrompt, 'systemPrompt should be captured');
    assert.ok(
      llm.lastSystemPrompt!.includes('DISTINCTIVE-TOKEN-ARTPROC-42'),
      'instrument Article Processing body should appear in systemPrompt',
    );
    assert.ok(
      llm.lastSystemPrompt!.includes('Respond with valid JSON'),
      'trailing JSON instruction should appear',
    );
    assert.ok(
      llm.lastSystemPrompt!.includes('analysis') && llm.lastSystemPrompt!.includes('signal'),
      'legal-language framing preserved in trailing instructions',
    );
    // No fallback event when loader returned a fragment
    assert.equal(obs.pushed.length, 0, 'no fallback event on success');
  });

  await test('systemPrompt falls back to hardcoded prompt when instrument has no contract', async () => {
    const db = new PlannedDb([
      // Loader query returns no row
      { match: 'JOIN prediction.instrument_config_versions', rows: [] },
    ]);
    const obs = new StubObservability();
    const llm = new StubLlm();
    const svc = makeSvc(db, obs, llm);

    await callLlmClassify(svc);
    assert.ok(llm.lastSystemPrompt, 'systemPrompt captured');
    assert.ok(
      llm.lastSystemPrompt!.startsWith('You are an instrument-relevance classifier.'),
      'hardcoded prompt starts with the legacy string',
    );
    assert.ok(
      llm.lastSystemPrompt!.includes('AAPL') && llm.lastSystemPrompt!.includes('Apple Inc.'),
      'hardcoded prompt includes symbol and name',
    );
    // One fallback event with reason=no_config_version
    assert.equal(obs.pushed.length, 1, 'one fallback event emitted');
    const evt = obs.pushed[0] as { hook_event_type: string; payload: { reason: string; instrument_symbol: string } };
    assert.equal(evt.hook_event_type, 'pipeline.instrument_contract.fallback');
    assert.equal(evt.payload.reason, 'no_config_version');
    assert.equal(evt.payload.instrument_symbol, 'AAPL');
  });

  await test('systemPrompt falls back when Article Processing section is empty', async () => {
    const db = new PlannedDb([
      { match: 'JOIN prediction.instrument_config_versions', rows: [{ config_id: 'cfg-1', context_markdown: PARTIAL_MD_NO_ARTICLE_PROCESSING }] },
    ]);
    const obs = new StubObservability();
    const llm = new StubLlm();
    const svc = makeSvc(db, obs, llm);

    await callLlmClassify(svc);
    assert.ok(
      llm.lastSystemPrompt!.startsWith('You are an instrument-relevance classifier.'),
      'fallback to hardcoded prompt when Article Processing missing',
    );
    assert.equal(obs.pushed.length, 1, 'one fallback event emitted');
    const evt = obs.pushed[0] as { payload: { reason: string } };
    assert.equal(evt.payload.reason, 'missing_stage_section');
  });

  console.log('\nArticle relevance × instrument contract tests complete.');
}

run();
