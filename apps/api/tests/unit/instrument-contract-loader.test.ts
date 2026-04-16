/**
 * Unit tests for loadInstrumentContractFragment.
 * Effort: instrument-contracts (Phase 1).
 */
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { loadInstrumentContractFragment } from '../../src/markets/utils/instrument-contract-loader';
import { WorkflowStage } from '../../src/markets/workflow-stages/workflow-stage';

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve(fn())
    .then(() => console.log(`PASS  ${name}`))
    .catch((err) => {
      console.error(`FAIL  ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

class StubDb {
  public calls: Array<{ sql: string; params: unknown[] }> = [];
  constructor(private rows: Array<{ config_id: string | null; context_markdown: string | null }> | null = null, private shouldThrow = false) {}
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    if (this.shouldThrow) throw new Error('db boom');
    return { data: this.rows ?? [], error: null };
  }
}

class StubObservability {
  public pushed: Array<Record<string, unknown>> = [];
  async push(evt: Record<string, unknown>) {
    this.pushed.push(evt);
  }
}

const logger = new Logger('test-instrument-loader');
const instrument = { id: 'instr-1', symbol: 'AAPL' };

const VALID_MD = `## General

Instrument general body.

## Stage: Article Processing

AP-body for AAPL.

## Stage: Predictor Generation

PG-body for AAPL.

## Stage: Risk Assessment — Reflection (3a)

RR-body for AAPL.

## Stage: Risk Assessment — Debate (3b)

RD-body for AAPL.

## Stage: Prediction Generation

PGen-body for AAPL.

## Stage: Learning

L-body for AAPL.

## Adaptations

A-body for AAPL.
`;

async function run() {
  console.log('\n=== Instrument Contract Loader Tests ===\n');

  await test('returns fallback with reason=no_config_version when joined query returns no row', async () => {
    const db = new StubDb([]);
    const obs = new StubObservability();
    const result = await loadInstrumentContractFragment(
      { db: db as never, logger, observability: obs as never },
      instrument,
      WorkflowStage.ArticleProcessing,
    );
    assert.equal(result.fallback, true);
    assert.equal(result.stageFragment, '');
    assert.equal(obs.pushed.length, 1);
    const evt = obs.pushed[0] as { hook_event_type: string; payload: Record<string, unknown> };
    assert.equal(evt.hook_event_type, 'pipeline.instrument_contract.fallback');
    assert.equal(evt.payload.reason, 'no_config_version');
    assert.equal(evt.payload.instrument_symbol, 'AAPL');
    assert.equal(evt.payload.instrument_id, 'instr-1');
  });

  await test('returns fallback with reason=empty_context_markdown when context_markdown is empty', async () => {
    const db = new StubDb([{ config_id: 'cfg-1', context_markdown: '' }]);
    const obs = new StubObservability();
    const result = await loadInstrumentContractFragment(
      { db: db as never, logger, observability: obs as never },
      instrument,
      WorkflowStage.ArticleProcessing,
    );
    assert.equal(result.fallback, true);
    assert.equal((obs.pushed[0] as { payload: { reason: string } }).payload.reason, 'empty_context_markdown');
  });

  await test('returns fallback with reason=missing_stage_section when Article Processing body missing', async () => {
    const partialMd = `## General

G

## Stage: Predictor Generation

PG

## Adaptations

A`;
    const db = new StubDb([{ config_id: 'cfg-1', context_markdown: partialMd }]);
    const obs = new StubObservability();
    const result = await loadInstrumentContractFragment(
      { db: db as never, logger, observability: obs as never },
      instrument,
      WorkflowStage.ArticleProcessing,
    );
    assert.equal(result.fallback, true);
    assert.equal((obs.pushed[0] as { payload: { reason: string } }).payload.reason, 'missing_stage_section');
  });

  await test('returns fragment for well-formed instrument contract at Article Processing stage', async () => {
    const db = new StubDb([{ config_id: 'cfg-1', context_markdown: VALID_MD }]);
    const obs = new StubObservability();
    const result = await loadInstrumentContractFragment(
      { db: db as never, logger, observability: obs as never },
      instrument,
      WorkflowStage.ArticleProcessing,
    );
    assert.equal(result.fallback, false);
    assert.ok(result.stageFragment.includes('Instrument general body'));
    assert.ok(result.stageFragment.includes('AP-body for AAPL'));
    assert.ok(result.stageFragment.includes('A-body for AAPL'));
    assert.equal(obs.pushed.length, 0, 'no fallback event on success');
  });

  await test('returns fragment for well-formed instrument contract at Predictor Generation stage', async () => {
    const db = new StubDb([{ config_id: 'cfg-1', context_markdown: VALID_MD }]);
    const obs = new StubObservability();
    const result = await loadInstrumentContractFragment(
      { db: db as never, logger, observability: obs as never },
      instrument,
      WorkflowStage.PredictorGeneration,
    );
    assert.equal(result.fallback, false);
    assert.ok(result.stageFragment.includes('PG-body for AAPL'));
  });

  await test('returns fragment for Risk Assessment reflection sub-stage', async () => {
    const db = new StubDb([{ config_id: 'cfg-1', context_markdown: VALID_MD }]);
    const obs = new StubObservability();
    const result = await loadInstrumentContractFragment(
      { db: db as never, logger, observability: obs as never },
      instrument,
      WorkflowStage.RiskAssessment,
      'reflection',
    );
    assert.equal(result.fallback, false);
    assert.ok(result.stageFragment.includes('RR-body for AAPL'));
  });

  await test('emits fallback on DB throw with reason=load_error', async () => {
    const db = new StubDb(null, true);
    const obs = new StubObservability();
    const result = await loadInstrumentContractFragment(
      { db: db as never, logger, observability: obs as never },
      instrument,
      WorkflowStage.ArticleProcessing,
    );
    assert.equal(result.fallback, true);
    assert.equal((obs.pushed[0] as { payload: { reason: string } }).payload.reason, 'load_error');
  });

  console.log('\nInstrument contract loader tests complete.');
}

run();
