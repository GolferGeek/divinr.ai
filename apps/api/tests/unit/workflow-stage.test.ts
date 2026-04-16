/**
 * Tests for WorkflowStage enum + ordering.
 * Effort: workflow-stages-article-pipeline (Phase 1).
 */
import assert from 'node:assert/strict';
import {
  WorkflowStage,
  WORKFLOW_STAGE_ORDER,
  WORKFLOW_STAGE_LABELS,
} from '../../src/markets/workflow-stages/workflow-stage';

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

test('enum has exactly five values matching PRD strings', () => {
  const values = Object.values(WorkflowStage);
  assert.equal(values.length, 5);
  assert.deepEqual(values.sort(), [
    'article_processing',
    'learning',
    'predictor_generation',
    'prediction_generation',
    'risk_assessment',
  ].sort());
});

test('WORKFLOW_STAGE_ORDER has length 5 and each value appears exactly once', () => {
  assert.equal(WORKFLOW_STAGE_ORDER.length, 5);
  const counts = new Map<string, number>();
  for (const stage of WORKFLOW_STAGE_ORDER) {
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  assert.equal(counts.size, 5);
  for (const [, count] of counts) {
    assert.equal(count, 1);
  }
});

test('order is article → predictor → risk → prediction → learning', () => {
  assert.deepEqual([...WORKFLOW_STAGE_ORDER], [
    WorkflowStage.ArticleProcessing,
    WorkflowStage.PredictorGeneration,
    WorkflowStage.RiskAssessment,
    WorkflowStage.PredictionGeneration,
    WorkflowStage.Learning,
  ]);
});

test('labels exist for every stage', () => {
  for (const stage of WORKFLOW_STAGE_ORDER) {
    const label = WORKFLOW_STAGE_LABELS[stage];
    assert.ok(label && label.length > 0, `missing label for ${stage}`);
  }
});
