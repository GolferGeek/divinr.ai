/**
 * Tests for parseContractMarkdown (shared util).
 * Effort: analyst-contracts + stage-keyed-analyst-contracts.
 */
import assert from 'node:assert/strict';
import {
  parseContractMarkdown,
  buildStagePromptFragment,
  validateContractSections,
  stageToKey,
} from '../../src/markets/utils/parse-contract-markdown';
import { WorkflowStage } from '../../src/markets/workflow-stages/workflow-stage';

// ─── Tests ──────────────────────────────────────────────────────

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

test('happy path: all three sections present', () => {
  const md = `> v1 placeholder context

## General

This analyst focuses on macro indicators.

## Role: Analyst

Decision criteria for predictions.

## Adaptations

Reserved for learning-engine adaptations.`;

  const result = parseContractMarkdown(md);
  assert.ok(result.general.includes('macro indicators'));
  assert.ok(result.roles['Analyst']?.includes('Decision criteria'));
  assert.ok(result.adaptations.includes('Reserved'));
});

test('multiple role sections', () => {
  const md = `## General

General content.

## Role: Analyst

Prediction logic.

## Role: Arbitrator

Debate logic.

## Adaptations

`;

  const result = parseContractMarkdown(md);
  assert.equal(Object.keys(result.roles).length, 2);
  assert.ok(result.roles['Analyst']?.includes('Prediction logic'));
  assert.ok(result.roles['Arbitrator']?.includes('Debate logic'));
});

test('missing adaptations returns empty string', () => {
  const md = `## General

Some general content.

## Role: Analyst

Role content.`;

  const result = parseContractMarkdown(md);
  assert.equal(result.adaptations, '');
  assert.ok(result.general.length > 0);
  assert.ok(result.roles['Analyst']?.length > 0);
});

test('missing general returns empty string', () => {
  const md = `## Role: Portfolio Manager

PM content.

## Adaptations

Adapt.`;

  const result = parseContractMarkdown(md);
  assert.equal(result.general, '');
  assert.ok(result.roles['Portfolio Manager']?.includes('PM content'));
  assert.ok(result.adaptations.includes('Adapt'));
});

test('empty input returns empty sections', () => {
  const result = parseContractMarkdown('');
  assert.equal(result.general, '');
  assert.equal(Object.keys(result.roles).length, 0);
  assert.equal(result.adaptations, '');
});

test('unrecognized headings are ignored', () => {
  const md = `## General

General.

## Notes

Some notes.

## Role: Analyst

Analyst stuff.

## Adaptations

`;

  const result = parseContractMarkdown(md);
  assert.ok(result.general.includes('General'));
  assert.ok(result.roles['Analyst']?.includes('Analyst stuff'));
  assert.equal(result.adaptations, '');
  // "Notes" is not in any section
  assert.ok(!result.general.includes('notes'));
});

test('whitespace is trimmed from section bodies', () => {
  const md = `## General

   Indented content with trailing spaces.

## Adaptations

`;

  const result = parseContractMarkdown(md);
  assert.equal(result.general, 'Indented content with trailing spaces.');
});

// ─── Stage-keyed parsing (stage-keyed-analyst-contracts) ──────────

const STAGE_KEYED_PERSONALITY_MD = `## General

Fundamentals analyst worldview. Produces analysis and signals, never financial guidance.

## Stage: Predictor Generation

Score articles against instruments using valuation-metric lens.

## Stage: Risk Assessment — Reflection (3a)

First-person update on holistic risk view for an instrument.

## Stage: Risk Assessment — Debate (3b)

Bullish/bearish stance for Red/Blue role.

## Stage: Prediction Generation

Issue directional signal from predictors + risk.

## Stage: Learning

Adapt from outcomes.

## Adaptations

Reserved for learning-engine adaptations.`;

test('parses all five stage sections', () => {
  const r = parseContractMarkdown(STAGE_KEYED_PERSONALITY_MD);
  assert.ok(r.stages.predictorGeneration.includes('valuation-metric'));
  assert.ok(r.stages.riskReflection.includes('holistic risk'));
  assert.ok(r.stages.riskDebate.includes('Red/Blue'));
  assert.ok(r.stages.predictionGeneration.includes('directional signal'));
  assert.ok(r.stages.learning.includes('outcomes'));
  assert.ok(r.general.includes('worldview'));
  assert.ok(r.adaptations.includes('Reserved'));
});

test('parses sub-stage discriminator with ASCII double-hyphen', () => {
  const md = `## General

G.

## Stage: Risk Assessment -- Reflection (3a)

Reflection body ASCII.

## Stage: Risk Assessment -- Debate (3b)

Debate body ASCII.

## Adaptations

A.`;
  const r = parseContractMarkdown(md);
  assert.ok(r.stages.riskReflection.includes('Reflection body ASCII'));
  assert.ok(r.stages.riskDebate.includes('Debate body ASCII'));
});

test('buildStagePromptFragment returns General + stage + Adaptations in order', () => {
  const sections = parseContractMarkdown(STAGE_KEYED_PERSONALITY_MD);
  const frag = buildStagePromptFragment(sections, WorkflowStage.PredictionGeneration);
  const gIdx = frag.indexOf('worldview');
  const sIdx = frag.indexOf('directional signal');
  const aIdx = frag.indexOf('Reserved');
  assert.ok(gIdx >= 0 && sIdx > gIdx && aIdx > sIdx, 'expected General < Stage < Adaptations order');
});

test('buildStagePromptFragment returns empty string when stage section missing', () => {
  const sections = parseContractMarkdown('## General\n\nG.\n\n## Adaptations\n\nA.\n');
  const frag = buildStagePromptFragment(sections, WorkflowStage.PredictionGeneration);
  assert.equal(frag, '');
});

test('buildStagePromptFragment throws for ArticleProcessing', () => {
  const sections = parseContractMarkdown(STAGE_KEYED_PERSONALITY_MD);
  assert.throws(() => buildStagePromptFragment(sections, WorkflowStage.ArticleProcessing), /instrument-keyed/);
});

test('stageToKey requires subStage for RiskAssessment', () => {
  assert.throws(() => stageToKey(WorkflowStage.RiskAssessment), /subStage/);
  assert.equal(stageToKey(WorkflowStage.RiskAssessment, 'reflection'), 'riskReflection');
  assert.equal(stageToKey(WorkflowStage.RiskAssessment, 'debate'), 'riskDebate');
});

test('validateContractSections accepts valid personality contract', () => {
  const sections = parseContractMarkdown(STAGE_KEYED_PERSONALITY_MD);
  const result = validateContractSections(sections, 'personality');
  assert.equal(result.valid, true, `expected valid; got ${JSON.stringify(result)}`);
  assert.deepEqual(result.missingSections, []);
  assert.deepEqual(result.forbiddenPhrases, []);
  assert.deepEqual(result.extraSections, []);
});

test('validateContractSections flags missing required section', () => {
  const md = STAGE_KEYED_PERSONALITY_MD.replace(
    /## Stage: Learning\n\nAdapt from outcomes\./,
    '## Stage: Learning\n\n',
  );
  const sections = parseContractMarkdown(md);
  const result = validateContractSections(sections, 'personality');
  assert.equal(result.valid, false);
  assert.ok(result.missingSections.some((s) => s.includes('Learning')));
});

test('validateContractSections flags forbidden phrase', () => {
  const md = STAGE_KEYED_PERSONALITY_MD.replace(
    'directional signal from predictors',
    'this is a financial recommendation from predictors',
  );
  const sections = parseContractMarkdown(md);
  const result = validateContractSections(sections, 'personality');
  assert.equal(result.valid, false);
  assert.ok(result.forbiddenPhrases.includes('recommendation'));
});

test('validateContractSections accepts arbitrator shape (no Predictor/Reflection/PredictionGen)', () => {
  const md = `## General

Arbitrator worldview. Produces analysis and signals.

## Stage: Risk Assessment — Debate (3b)

Arbiter synthesis of Red/Blue positions.

## Stage: Learning

Adapt arbiter heuristics.

## Adaptations

Reserved.`;
  const sections = parseContractMarkdown(md);
  const result = validateContractSections(sections, 'arbitrator');
  assert.equal(result.valid, true, `arbitrator should be valid; got ${JSON.stringify(result)}`);
});

test('validateContractSections flags extra section for arbitrator', () => {
  const md = `## General

G.

## Stage: Predictor Generation

Arbitrator does not score predictors — this is extra.

## Stage: Risk Assessment — Debate (3b)

D.

## Stage: Learning

L.

## Adaptations

A.`;
  const sections = parseContractMarkdown(md);
  const result = validateContractSections(sections, 'arbitrator');
  assert.equal(result.valid, false);
  assert.ok(result.extraSections.some((s) => s.includes('Predictor Generation')));
});

test('validateContractSections accepts portfolio-manager shape', () => {
  const md = `## General

Portfolio Manager converts analyst signals to sized trade signals.

## Stage: Prediction Generation

Sizing logic.

## Stage: Learning

Refine sizing rules.

## Adaptations

Reserved.`;
  const sections = parseContractMarkdown(md);
  const result = validateContractSections(sections, 'portfolio_manager');
  assert.equal(result.valid, true, `portfolio_manager should be valid; got ${JSON.stringify(result)}`);
});

test('pre-stage-keyed (## Role: Analyst) parses without stage sections and does not throw', () => {
  const md = `## General

G.

## Role: Analyst

Legacy role.

## Adaptations

A.`;
  const sections = parseContractMarkdown(md);
  assert.equal(sections.stages.predictorGeneration, '');
  assert.equal(sections.stages.riskDebate, '');
  assert.ok(sections.roles['Analyst']?.includes('Legacy role'));
});

test('unknown ## Stage: heading is ignored (forward-compat)', () => {
  const md = `## General

G.

## Stage: Futuristic New Stage

Ignored.

## Stage: Prediction Generation

Used.

## Adaptations

A.`;
  const sections = parseContractMarkdown(md);
  assert.equal(sections.stages.predictionGeneration.trim(), 'Used.');
  // "Ignored." body should not leak into any recognized stage
  for (const key of Object.keys(sections.stages) as Array<keyof typeof sections.stages>) {
    if (key === 'predictionGeneration') continue;
    assert.ok(!sections.stages[key].includes('Ignored'), `unexpected leak into ${String(key)}`);
  }
});

console.log('\nContract markdown parser tests complete.');
