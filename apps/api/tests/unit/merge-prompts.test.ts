/**
 * Tests for buildMergedSystemPrompt — the Phase 4 helper that merges an
 * instrument stage fragment and an analyst stage fragment into a single
 * labeled system prompt.
 *
 * Effort: instrument-contracts (Phase 4).
 */
import assert from 'node:assert/strict';
import { buildMergedSystemPrompt, emitPromptTokenEstimate } from '../../src/markets/utils/merge-prompts';

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve(fn())
    .then(() => console.log(`PASS  ${name}`))
    .catch((err) => {
      console.error(`FAIL  ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

async function run() {
  console.log('\n=== Merge Prompts Tests ===\n');

  await test('both fragments present — produces labeled two-block output in instrument-first order', () => {
    const out = buildMergedSystemPrompt({
      instrumentSymbol: 'AAPL',
      instrumentFragment: 'INSTRUMENT-TOKEN-1',
      analystSlug: 'contrarian',
      analystFragment: 'ANALYST-TOKEN-1',
    });
    // instrument first
    const instrIdx = out.indexOf('[Instrument: AAPL]');
    const analystIdx = out.indexOf('[Analyst: contrarian]');
    assert.ok(instrIdx >= 0, 'instrument label present');
    assert.ok(analystIdx >= 0, 'analyst label present');
    assert.ok(instrIdx < analystIdx, 'instrument block precedes analyst block');
    assert.ok(out.includes('INSTRUMENT-TOKEN-1'), 'instrument fragment body present');
    assert.ok(out.includes('ANALYST-TOKEN-1'), 'analyst fragment body present');
  });

  await test('instrument fragment empty — output starts with analyst block', () => {
    const out = buildMergedSystemPrompt({
      instrumentSymbol: 'AAPL',
      instrumentFragment: '',
      analystSlug: 'contrarian',
      analystFragment: 'ANALYST-TOKEN-1',
    });
    assert.ok(out.startsWith('[Analyst: contrarian]'), 'starts with analyst block when instrument empty');
    assert.ok(!out.includes('[Instrument:'), 'no instrument block when fragment empty');
    assert.ok(out.includes('ANALYST-TOKEN-1'), 'analyst body present');
  });

  await test('analyst fragment empty — output contains only instrument block', () => {
    const out = buildMergedSystemPrompt({
      instrumentSymbol: 'AAPL',
      instrumentFragment: 'INSTRUMENT-TOKEN-1',
      analystSlug: 'contrarian',
      analystFragment: '',
    });
    assert.ok(out.startsWith('[Instrument: AAPL]'), 'starts with instrument block when analyst empty');
    assert.ok(!out.includes('[Analyst:'), 'no analyst block when fragment empty');
    assert.ok(out.includes('INSTRUMENT-TOKEN-1'), 'instrument body present');
  });

  await test('both empty — output is empty string', () => {
    const out = buildMergedSystemPrompt({
      instrumentSymbol: 'AAPL',
      instrumentFragment: '   ',
      analystSlug: 'contrarian',
      analystFragment: '\n\n',
    });
    assert.equal(out, '', 'empty output when both fragments effectively empty');
  });

  await test('distinct tokens in each fragment both appear in output', () => {
    const out = buildMergedSystemPrompt({
      instrumentSymbol: 'NVDA',
      instrumentFragment: 'NVDA-DISTINCT-INSTR-TOKEN',
      analystSlug: 'contrarian',
      analystFragment: 'CONTRARIAN-DISTINCT-ANALYST-TOKEN',
    });
    assert.ok(out.includes('NVDA-DISTINCT-INSTR-TOKEN'));
    assert.ok(out.includes('CONTRARIAN-DISTINCT-ANALYST-TOKEN'));
    assert.ok(out.includes('[Instrument: NVDA]'));
    assert.ok(out.includes('[Analyst: contrarian]'));
  });

  await test('emitPromptTokenEstimate pushes event with chars+tokens payload', async () => {
    const events: Array<Record<string, unknown>> = [];
    const observability = {
      async push(evt: Record<string, unknown>) {
        events.push(evt);
      },
    };
    const warnings: string[] = [];
    const logger = { warn: (msg: string) => warnings.push(msg) };

    emitPromptTokenEstimate(
      observability,
      logger,
      { prompt: 'abcd'.repeat(100), stage: 'PredictorGeneration', subStage: null, analystSlug: 'contrarian', instrumentSymbol: 'AAPL' },
    );
    // Let the microtask queue drain
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(events.length, 1);
    const evt = events[0] as { hook_event_type: string; payload: { prompt_length_chars: number; estimated_tokens: number; stage: string; analyst_slug: string; instrument_symbol: string } };
    assert.equal(evt.hook_event_type, 'pipeline.prompt_token_estimate');
    assert.equal(evt.payload.prompt_length_chars, 400);
    assert.equal(evt.payload.estimated_tokens, 100);
    assert.equal(evt.payload.stage, 'PredictorGeneration');
    assert.equal(evt.payload.analyst_slug, 'contrarian');
    assert.equal(evt.payload.instrument_symbol, 'AAPL');
    assert.equal(warnings.length, 0, 'no warn under soft cap');
  });

  await test('emitPromptTokenEstimate warns when estimate exceeds soft cap', async () => {
    const events: Array<Record<string, unknown>> = [];
    const observability = {
      async push(evt: Record<string, unknown>) {
        events.push(evt);
      },
    };
    const warnings: string[] = [];
    const logger = { warn: (msg: string) => warnings.push(msg) };

    const bigPrompt = 'x'.repeat(32_000); // ~8000 estimated tokens
    emitPromptTokenEstimate(
      observability,
      logger,
      { prompt: bigPrompt, stage: 'PredictionGeneration', subStage: null, analystSlug: 'contrarian', instrumentSymbol: 'AAPL' },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(warnings.length, 1, 'warn fires above cap');
    assert.ok(warnings[0].includes('exceeds soft cap'));
  });

  console.log('\nMerge prompts tests complete.');
}

run();
