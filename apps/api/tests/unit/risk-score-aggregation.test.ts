/**
 * Unit tests for RiskScoreAggregationService
 * Pure computation — no DB or LLM dependencies.
 */
import { RiskScoreAggregationService } from '../../src/markets/services/risk-score-aggregation.service';
import type { RiskDimension, RiskDimensionAssessment } from '../../src/markets/markets.types';

const service = new RiskScoreAggregationService();

function makeDimension(id: string, slug: string, weight: number): RiskDimension {
  return {
    id, user_id: 'test-user-id', domain_slug: 'financial', slug, name: slug,
    description: null, weight, display_order: 0, is_active: true,
    system_prompt: null, output_schema: {}, created_at: '', updated_at: '',
  };
}

function makeAssessment(dimensionId: string, score: number, confidence: number): RiskDimensionAssessment {
  return {
    id: `a-${dimensionId}`, run_id: 'run-1',
    instrument_id: 'inst-1', dimension_id: dimensionId, score, confidence,
    reasoning: 'test', evidence: [], signals: [],
    model_provider: null, model_name: null, llm_usage_id: null, created_at: '',
  };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function assertClose(actual: number, expected: number, tolerance: number, label: string) {
  assert(Math.abs(actual - expected) <= tolerance, `${label} (got ${actual}, expected ~${expected})`);
}

console.log('\n=== Risk Score Aggregation Tests ===\n');

// Test 1: Basic weighted average
console.log('Weighted average:');
{
  const dims = [
    makeDimension('d1', 'market', 0.30),
    makeDimension('d2', 'fundamental', 0.30),
    makeDimension('d3', 'technical', 0.20),
    makeDimension('d4', 'macro', 0.20),
  ];
  const assessments = [
    makeAssessment('d1', 60, 0.8),
    makeAssessment('d2', 40, 0.9),
    makeAssessment('d3', 80, 0.7),
    makeAssessment('d4', 50, 0.6),
  ];
  const result = service.aggregateAssessments(assessments, dims);
  // Expected: (60*0.3 + 40*0.3 + 80*0.2 + 50*0.2) / 1.0 = 18 + 12 + 16 + 10 = 56
  assertClose(result.overallScore, 56, 1, 'Overall score = 56');
  assert(result.dimensionScores['market'] === 60, 'Market dimension = 60');
  assert(result.dimensionScores['fundamental'] === 40, 'Fundamental dimension = 40');
}

// Test 2: Geometric mean confidence
console.log('\nGeometric mean confidence:');
{
  const dims = [makeDimension('d1', 'a', 0.5), makeDimension('d2', 'b', 0.5)];
  const assessments = [makeAssessment('d1', 50, 0.8), makeAssessment('d2', 50, 0.5)];
  const result = service.aggregateAssessments(assessments, dims);
  // Geometric mean of 0.8 and 0.5 = sqrt(0.4) ≈ 0.632
  assertClose(result.confidence, 0.63, 0.02, 'Geometric mean confidence ~0.63');
}

// Test 3: Empty assessments
console.log('\nEmpty assessments:');
{
  const result = service.aggregateAssessments([], []);
  assert(result.overallScore === 0, 'Score = 0');
  assert(result.confidence === 0, 'Confidence = 0');
}

// Test 4: Debate adjustment clamping
console.log('\nDebate adjustment:');
{
  assert(service.applyDebateAdjustment(50, 10) === 60, 'Score 50 + 10 = 60');
  assert(service.applyDebateAdjustment(50, -20) === 30, 'Score 50 - 20 = 30');
  assert(service.applyDebateAdjustment(90, 20) === 100, 'Score 90 + 20 clamped to 100');
  assert(service.applyDebateAdjustment(10, -20) === 0, 'Score 10 - 20 clamped to 0');
  assert(service.applyDebateAdjustment(50, 50) === 80, 'Adjustment 50 clamped to 30 → 80');
  assert(service.applyDebateAdjustment(50, -50) === 20, 'Adjustment -50 clamped to -30 → 20');
}

// Test 5: Verdict mapping
console.log('\nVerdict from score:');
{
  assert(service.verdictFromScore(0) === 'low', '0 → low');
  assert(service.verdictFromScore(33) === 'low', '33 → low');
  assert(service.verdictFromScore(34) === 'medium', '34 → medium');
  assert(service.verdictFromScore(66) === 'medium', '66 → medium');
  assert(service.verdictFromScore(67) === 'high', '67 → high');
  assert(service.verdictFromScore(100) === 'high', '100 → high');
}

// Test 6: Weight validation
console.log('\nWeight validation:');
{
  const dims = [makeDimension('d1', 'a', 0.3), makeDimension('d2', 'b', 0.3)];
  // Should warn but not throw (weights sum to 0.6, not 1.0)
  service.validateDimensionWeights(dims);
  assert(true, 'Does not throw for mismatched weights');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
