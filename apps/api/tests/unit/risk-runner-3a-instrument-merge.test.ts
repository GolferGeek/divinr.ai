/**
 * Phase 4 integration test: RiskRunnerService.runPerAnalystReflection (Stage 3a
 * reflection) loads the instrument contract fragment alongside the analyst
 * contract and merges both into the systemPrompt passed to the LLM.
 *
 * Effort: instrument-contracts (Phase 4).
 */
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { RiskRunnerService } from '../../src/markets/services/risk-runner.service';

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

NVDA general.

## Stage: Article Processing

NVDA article processing body.

## Stage: Predictor Generation

NVDA predictor body.

## Stage: Risk Assessment — Reflection (3a)

TOKEN-INSTRUMENT-3A NVDA reflection framing.

## Stage: Risk Assessment — Debate (3b)

NVDA debate body.

## Stage: Prediction Generation

NVDA prediction body.

## Stage: Learning

NVDA learning body.

## Adaptations

NVDA adaptations.
`;

const ANALYST_CONTRACT_MD = `## General

Macro strategist general.

## Role: MacroStrategist

Role body.

## Stage: Predictor Generation

Predictor body.

## Stage: Risk Assessment — Reflection (3a)

TOKEN-ANALYST-3A macro strategist reflection framing.

## Stage: Risk Assessment — Debate (3b)

Debate body.

## Stage: Prediction Generation

Prediction body.

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
  buildExecutionContext(_userId: string, _domain: string) {
    return { conversationId: 'test', userId: 'system' } as never;
  }
  async generateText(_ctx: unknown, systemPrompt: string, _userPrompt: string) {
    this.lastSystemPrompt = systemPrompt;
    return {
      text: JSON.stringify({ score: 50, confidence: 0.7, reasoning: 'stub', evidence: [] }),
      provider: 'stub',
      model: 'stub',
      llmUsageId: 'usage-1',
    };
  }
}

function makeSvc(db: PlannedDb, obs: StubObservability, llm: StubLlm): RiskRunnerService {
  const svc = Object.create(RiskRunnerService.prototype) as RiskRunnerService;
  (svc as unknown as { db: unknown; observability: unknown; llmService: unknown; logger: unknown }).db = db;
  (svc as unknown as { observability: unknown }).observability = obs;
  (svc as unknown as { llmService: unknown }).llmService = llm;
  (svc as unknown as { logger: unknown }).logger = new Logger('TestRiskRunner');
  return svc;
}

const RUN_ID = 'run-1';
const INSTRUMENT = {
  id: 'instr-nvda',
  symbol: 'NVDA',
  name: 'NVIDIA Corp.',
  asset_type: 'stock',
  current_state: null,
  current_config_version_id: 'instr-cfg-1',
  user_id: null,
  universe_slug: 'core',
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as unknown as import('../../src/markets/markets.types').MarketInstrument;

async function callReflection(svc: RiskRunnerService, item: {
  instrumentId: string;
  analystId: string;
  analystSlug: string;
  analystDisplayName: string;
  analystPersona: string;
  configVersionId: string | null;
}) {
  return (svc as unknown as {
    runPerAnalystReflection: (runId: string, item: typeof item, instrument: typeof INSTRUMENT) => Promise<{ score: number; confidence: number; reasoning: string }>;
  }).runPerAnalystReflection(RUN_ID, item, INSTRUMENT);
}

async function run() {
  console.log('\n=== Risk Runner 3a × Instrument Contract Merge Tests ===\n');

  await test('runPerAnalystReflection merges instrument + analyst fragments into systemPrompt', async () => {
    const db = new PlannedDb([
      // Prior risk assessment
      { match: 'select score, confidence, reasoning from prediction.analyst_risk_assessments', rows: [] },
      // Predictor lines
      { match: 'from prediction.market_predictors mp', rows: [] },
      // Instrument contract loader
      { match: 'JOIN prediction.instrument_config_versions', rows: [{ config_id: 'instr-cfg-1', context_markdown: INSTRUMENT_CONTRACT_MD }] },
      // Analyst contract loader
      { match: 'SELECT context_markdown FROM prediction.analyst_config_versions', rows: [{ context_markdown: ANALYST_CONTRACT_MD }] },
      // Insert analyst_risk_assessments — accept
      { match: 'insert into prediction.analyst_risk_assessments', rows: [] },
      // Insert artifact — accept
      { match: 'insert into prediction.market_run_artifacts', rows: [] },
    ]);
    const obs = new StubObservability();
    const llm = new StubLlm();
    const svc = makeSvc(db, obs, llm);

    await callReflection(svc, {
      instrumentId: INSTRUMENT.id,
      analystId: 'analyst-macro',
      analystSlug: 'macro-strategist',
      analystDisplayName: 'the Macro Strategist',
      analystPersona: 'You focus on macro.',
      configVersionId: 'analyst-cfg-1',
    });

    assert.ok(llm.lastSystemPrompt, 'systemPrompt captured');
    assert.ok(llm.lastSystemPrompt!.includes('TOKEN-INSTRUMENT-3A'), 'instrument token present');
    assert.ok(llm.lastSystemPrompt!.includes('TOKEN-ANALYST-3A'), 'analyst token present');
    assert.ok(llm.lastSystemPrompt!.includes('[Instrument: NVDA]'), 'instrument label present');
    assert.ok(llm.lastSystemPrompt!.includes('[Analyst: macro-strategist]'), 'analyst label present');
  });

  await test('runPerAnalystReflection falls back to analyst-only prompt when instrument has no contract', async () => {
    const db = new PlannedDb([
      { match: 'select score, confidence, reasoning from prediction.analyst_risk_assessments', rows: [] },
      { match: 'from prediction.market_predictors mp', rows: [] },
      // Instrument loader returns no row → fallback
      { match: 'JOIN prediction.instrument_config_versions', rows: [] },
      { match: 'SELECT context_markdown FROM prediction.analyst_config_versions', rows: [{ context_markdown: ANALYST_CONTRACT_MD }] },
      { match: 'insert into prediction.analyst_risk_assessments', rows: [] },
      { match: 'insert into prediction.market_run_artifacts', rows: [] },
    ]);
    const obs = new StubObservability();
    const llm = new StubLlm();
    const svc = makeSvc(db, obs, llm);

    await callReflection(svc, {
      instrumentId: INSTRUMENT.id,
      analystId: 'analyst-macro',
      analystSlug: 'macro-strategist',
      analystDisplayName: 'the Macro Strategist',
      analystPersona: 'You focus on macro.',
      configVersionId: 'analyst-cfg-1',
    });

    assert.ok(llm.lastSystemPrompt!.includes('TOKEN-ANALYST-3A'), 'analyst token still present');
    assert.ok(!llm.lastSystemPrompt!.includes('[Instrument:'), 'no instrument label on fallback');
    assert.ok(!llm.lastSystemPrompt!.includes('[Analyst:'), 'no analyst label on fallback (byte-identical today)');
  });

  console.log('\nRisk runner 3a × instrument contract merge tests complete.');
}

run();
