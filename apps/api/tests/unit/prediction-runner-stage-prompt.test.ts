/**
 * Tests for PredictionRunnerService stage-prompt wiring.
 *
 * Validates that:
 *   - buildAnalystSystemPrompt (v4 path) inserts the stage fragment verbatim
 *     into the system prompt, preserving the "You are <display_name>." prefix
 *     so the existing stub LLM matching continues to work.
 *   - buildLegacyAnalystSystemPrompt (fallback path) uses persona_prompt +
 *     tier_instructions + adaptations (today's behavior).
 *   - loadContractFragment correctly assembles General + Stage Prediction
 *     Generation + Adaptations into the stage fragment passed to the v4
 *     prompt builder (via buildStagePromptFragment from the parser utility —
 *     smoke-tested here with a representative seven-stage contract body).
 *
 * Effort: stage-keyed-analyst-contracts (Phase 3 wiring).
 */
import assert from 'node:assert/strict';
import {
  parseContractMarkdown,
  buildStagePromptFragment,
} from '../../src/markets/utils/parse-contract-markdown';
import { WorkflowStage } from '../../src/markets/workflow-stages/workflow-stage';
import { PredictionRunnerService } from '../../src/markets/services/prediction-runner.service';
import type { MarketAnalyst } from '../../src/markets/markets.types';

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

// Construct a service without running its ctor's plane setup — we only need the
// private methods, which don't touch injected deps. Casting through unknown keeps
// tsc honest without needing a full MarketsSchemaService, DB, LLM, etc.
const service = Object.create(PredictionRunnerService.prototype) as PredictionRunnerService;

function makeAnalyst(overrides: Partial<MarketAnalyst> = {}): MarketAnalyst {
  const base = {
    id: 'test-analyst-id',
    slug: 'test-analyst',
    display_name: 'Test Analyst',
    persona_prompt: 'You analyze markets from a deterministic lens.',
    analyst_type: 'personality',
    default_weight: 1.0,
    tier_instructions: { silver: 'Tier-silver approach.' } as Record<string, unknown>,
    is_enabled: true,
    is_active: true,
    is_system_default: true,
    learning_enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return { ...base, ...overrides } as unknown as MarketAnalyst;
}

const SENTINEL_GENERAL = 'SENTINEL_GENERAL_BODY';
const SENTINEL_PREDICTOR = 'SENTINEL_PREDICTOR_BODY';
const SENTINEL_REFLECTION = 'SENTINEL_REFLECTION_BODY';
const SENTINEL_DEBATE = 'SENTINEL_DEBATE_BODY';
const SENTINEL_PRED_GEN = 'SENTINEL_PREDICTION_GENERATION_BODY';
const SENTINEL_LEARNING = 'SENTINEL_LEARNING_BODY';
const SENTINEL_ADAPTATIONS = 'SENTINEL_ADAPTATIONS_BODY';

const V4_PERSONALITY_MD = `## General

${SENTINEL_GENERAL}

## Stage: Predictor Generation

${SENTINEL_PREDICTOR}

## Stage: Risk Assessment — Reflection (3a)

${SENTINEL_REFLECTION}

## Stage: Risk Assessment — Debate (3b)

${SENTINEL_DEBATE}

## Stage: Prediction Generation

${SENTINEL_PRED_GEN}

## Stage: Learning

${SENTINEL_LEARNING}

## Adaptations

${SENTINEL_ADAPTATIONS}`;

// ─── Tests ──────────────────────────────────────────────────────

test('buildAnalystSystemPrompt (v4) injects the stage fragment verbatim', () => {
  const sections = parseContractMarkdown(V4_PERSONALITY_MD);
  const fragment = buildStagePromptFragment(sections, WorkflowStage.PredictionGeneration);
  const analyst = makeAnalyst();

  const prompt = (service as unknown as {
    buildAnalystSystemPrompt: (a: MarketAnalyst, f: string) => string;
  }).buildAnalystSystemPrompt(analyst, fragment);

  assert.ok(prompt.includes('You are Test Analyst.'), 'prompt should still open with "You are <display_name>."');
  assert.ok(prompt.includes(SENTINEL_GENERAL), 'prompt should contain General section body');
  assert.ok(prompt.includes(SENTINEL_PRED_GEN), 'prompt should contain Prediction Generation section body');
  assert.ok(prompt.includes(SENTINEL_ADAPTATIONS), 'prompt should contain Adaptations body');
  assert.ok(!prompt.includes(SENTINEL_REFLECTION), 'prompt should NOT contain Reflection body (wrong stage)');
  assert.ok(!prompt.includes(SENTINEL_DEBATE), 'prompt should NOT contain Debate body (wrong stage)');
  assert.ok(!prompt.includes(SENTINEL_LEARNING), 'prompt should NOT contain Learning body (wrong stage)');
  assert.ok(!prompt.includes(SENTINEL_PREDICTOR), 'prompt should NOT contain Predictor Generation body (wrong stage)');
  assert.ok(!prompt.includes(analyst.persona_prompt), 'v4 prompt should NOT include legacy persona_prompt');
  assert.ok(prompt.includes('Respond ONLY with valid JSON.'), 'prompt should include JSON output instruction');
});

test('buildLegacyAnalystSystemPrompt (fallback) uses persona_prompt + tier + adaptations', () => {
  const analyst = makeAnalyst();

  const prompt = (service as unknown as {
    buildLegacyAnalystSystemPrompt: (a: MarketAnalyst, ad: string) => string;
  }).buildLegacyAnalystSystemPrompt(analyst, 'Some adaptation text.');

  assert.ok(prompt.includes('You are Test Analyst.'), 'legacy prompt should open with "You are <display_name>."');
  assert.ok(prompt.includes(analyst.persona_prompt), 'legacy prompt should include persona_prompt');
  assert.ok(prompt.includes('Tier-silver approach.'), 'legacy prompt should include tier_instructions.silver');
  assert.ok(prompt.includes('Some adaptation text.'), 'legacy prompt should include adaptations');
  assert.ok(prompt.includes('Respond ONLY with valid JSON.'), 'legacy prompt should include JSON output instruction');
});

test('buildLegacyAnalystSystemPrompt handles empty tier_instructions and empty adaptations', () => {
  const analyst = makeAnalyst({ tier_instructions: {} } as Partial<MarketAnalyst>);

  const prompt = (service as unknown as {
    buildLegacyAnalystSystemPrompt: (a: MarketAnalyst, ad: string) => string;
  }).buildLegacyAnalystSystemPrompt(analyst, '');

  assert.ok(prompt.includes('You are Test Analyst.'));
  assert.ok(prompt.includes(analyst.persona_prompt));
  assert.ok(!prompt.includes('Analysis approach:'), 'should omit tier block when empty');
  assert.ok(!prompt.includes('Active adaptations:'), 'should omit adaptations block when empty');
});

test('v4 prompt preserves "You are <name>." prefix so stub LLM matching still works', () => {
  const sections = parseContractMarkdown(V4_PERSONALITY_MD);
  const fragment = buildStagePromptFragment(sections, WorkflowStage.PredictionGeneration);
  const analyst = makeAnalyst({ display_name: 'Macro Strategist' });

  const prompt = (service as unknown as {
    buildAnalystSystemPrompt: (a: MarketAnalyst, f: string) => string;
  }).buildAnalystSystemPrompt(analyst, fragment);

  // The integration test harness's stub LLM keys off this prefix — regressing
  // it would break every scenario.
  const match = prompt.match(/^You are ([^.]+)\./);
  assert.ok(match, 'prompt must match /^You are ([^.]+)\\./');
  assert.equal(match![1], 'Macro Strategist');
});

console.log('\nPredictionRunnerService stage-prompt tests complete.');
