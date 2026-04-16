/**
 * Phase 4 integration test: PredictionRunnerService.runSingleAnalyst loads the
 * instrument contract fragment alongside the analyst contract and merges them
 * into the systemPrompt passed to the LLM.
 *
 * Effort: instrument-contracts (Phase 4).
 */
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { PredictionRunnerService } from '../../src/markets/services/prediction-runner.service';
import type { MarketAnalyst, MarketInstrument, MarketRun } from '../../src/markets/markets.types';

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve(fn())
    .then(() => console.log(`PASS  ${name}`))
    .catch((err) => {
      console.error(`FAIL  ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

const INSTRUMENT_CONTRACT_MD = `## General

TSLA general.

## Stage: Article Processing

TSLA article processing.

## Stage: Predictor Generation

TSLA predictor.

## Stage: Risk Assessment — Reflection (3a)

TSLA reflection.

## Stage: Risk Assessment — Debate (3b)

TSLA debate.

## Stage: Prediction Generation

TOKEN-INSTRUMENT-PREDGEN TSLA prediction framing.

## Stage: Learning

TSLA learning.

## Adaptations

TSLA adaptations.
`;

const ANALYST_CONTRACT_MD = `## General

Swing trader general.

## Role: SwingTrader

Role body.

## Stage: Predictor Generation

Predictor body.

## Stage: Risk Assessment — Reflection (3a)

Reflection body.

## Stage: Risk Assessment — Debate (3b)

Debate body.

## Stage: Prediction Generation

TOKEN-ANALYST-PREDGEN swing trader prediction framing.

## Stage: Learning

Learning body.

## Adaptations

Adaptations.
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
  isLlmEnabled() {
    return true;
  }
  async generateText(_ctx: unknown, systemPrompt: string, _userPrompt: string) {
    this.lastSystemPrompt = systemPrompt;
    return {
      text: JSON.stringify({ direction: 'up', confidence: 70, rationale: 'stub', key_factors: [], risks: [] }),
      provider: 'stub',
      model: 'stub',
      llmUsageId: 'usage-1',
    };
  }
}

const RUN: MarketRun = {
  id: 'run-1',
  instrument_id: 'instr-tsla',
  user_id: null,
  run_type: 'prediction',
  status: 'running',
  trigger_source: 'test',
  started_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as unknown as MarketRun;

const INSTRUMENT: MarketInstrument = {
  id: 'instr-tsla',
  symbol: 'TSLA',
  name: 'Tesla Inc.',
  asset_type: 'stock',
  current_state: null,
  universe_slug: 'core',
  current_config_version_id: 'instr-cfg-1',
  user_id: null,
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as unknown as MarketInstrument;

const ANALYST: MarketAnalyst = {
  id: 'analyst-swing',
  slug: 'swing-trader',
  display_name: 'The Swing Trader',
  persona_prompt: 'Legacy persona.',
  analyst_type: 'personality',
  default_weight: 1.0,
  tier_instructions: { silver: 'Silver tier.' } as Record<string, unknown>,
  current_config_version_id: 'analyst-cfg-1',
  paper_config_version_id: null,
  is_enabled: true,
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as unknown as MarketAnalyst;

function makeSvc(db: PlannedDb, obs: StubObservability, llm: StubLlm): PredictionRunnerService {
  const svc = Object.create(PredictionRunnerService.prototype) as PredictionRunnerService;
  (svc as unknown as { db: unknown }).db = db;
  (svc as unknown as { observability: unknown }).observability = obs;
  (svc as unknown as { llmService: unknown }).llmService = llm;
  (svc as unknown as { logger: unknown }).logger = new Logger('TestPredictionRunner');
  (svc as unknown as { dataSources: unknown }).dataSources = {
    async fetchForAnalyst() {
      return { context: '', sourceContext: {} };
    },
  };
  return svc;
}

async function callRun(svc: PredictionRunnerService) {
  return (svc as unknown as {
    runSingleAnalyst: (
      context: unknown,
      run: typeof RUN,
      instrument: typeof INSTRUMENT,
      analyst: typeof ANALYST,
      sharedContext: string,
      contextProviderText: string,
      isPaper: boolean,
    ) => Promise<{ outcome: { id: string }; artifactId: string }>;
  }).runSingleAnalyst({ conversationId: 'test', userId: 'system' }, RUN, INSTRUMENT, ANALYST, '', '', false);
}

async function run() {
  console.log('\n=== Prediction Runner × Instrument Contract Merge Tests ===\n');

  await test('runSingleAnalyst merges instrument + analyst fragments into systemPrompt', async () => {
    const db = new PlannedDb([
      // Predictor lines
      { match: 'from prediction.market_predictors mp', rows: [] },
      // Analyst risk assessment
      { match: 'select score, confidence, reasoning from prediction.analyst_risk_assessments', rows: [] },
      // Instrument contract loader
      { match: 'JOIN prediction.instrument_config_versions', rows: [{ config_id: 'instr-cfg-1', context_markdown: INSTRUMENT_CONTRACT_MD }] },
      // Analyst contract loader
      { match: 'SELECT context_markdown FROM prediction.analyst_config_versions', rows: [{ context_markdown: ANALYST_CONTRACT_MD }] },
      // Insert artifact
      { match: 'insert into prediction.market_run_artifacts', rows: [] },
      // Insert prediction
      { match: 'insert into prediction.market_predictions', rows: [] },
    ]);
    const obs = new StubObservability();
    const llm = new StubLlm();
    const svc = makeSvc(db, obs, llm);

    await callRun(svc);

    assert.ok(llm.lastSystemPrompt, 'systemPrompt captured');
    assert.ok(llm.lastSystemPrompt!.includes('TOKEN-INSTRUMENT-PREDGEN'), 'instrument token present');
    assert.ok(llm.lastSystemPrompt!.includes('TOKEN-ANALYST-PREDGEN'), 'analyst token present');
    assert.ok(llm.lastSystemPrompt!.includes('[Instrument: TSLA]'), 'instrument label present');
    assert.ok(llm.lastSystemPrompt!.includes('[Analyst: swing-trader]'), 'analyst label present');
  });

  await test('runSingleAnalyst falls back to analyst-only systemPrompt when instrument contract missing', async () => {
    const db = new PlannedDb([
      { match: 'from prediction.market_predictors mp', rows: [] },
      { match: 'select score, confidence, reasoning from prediction.analyst_risk_assessments', rows: [] },
      // Instrument loader returns no rows → fallback
      { match: 'JOIN prediction.instrument_config_versions', rows: [] },
      { match: 'SELECT context_markdown FROM prediction.analyst_config_versions', rows: [{ context_markdown: ANALYST_CONTRACT_MD }] },
      { match: 'insert into prediction.market_run_artifacts', rows: [] },
      { match: 'insert into prediction.market_predictions', rows: [] },
    ]);
    const obs = new StubObservability();
    const llm = new StubLlm();
    const svc = makeSvc(db, obs, llm);

    await callRun(svc);

    assert.ok(llm.lastSystemPrompt!.includes('TOKEN-ANALYST-PREDGEN'), 'analyst token present');
    assert.ok(!llm.lastSystemPrompt!.includes('[Instrument:'), 'no instrument label on fallback');
    assert.ok(!llm.lastSystemPrompt!.includes('[Analyst:'), 'no analyst label on fallback (byte-identical today)');
  });

  console.log('\nPrediction runner × instrument contract merge tests complete.');
}

run();
