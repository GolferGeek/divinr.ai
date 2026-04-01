/**
 * Unit tests for StocksPredictionPlane
 * Tests the prediction plane interface implementations.
 */
import { StocksPredictionPlane } from '@divinr/prediction-planes';
import type { InstrumentState } from '@divinr/prediction-planes';

const plane = new StocksPredictionPlane();

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

console.log('\n=== StocksPredictionPlane Tests ===\n');

// Test 1: Domain identity
console.log('Domain identity:');
assert(plane.domain === 'financial', 'Domain is "financial"');

// Test 2: State — getPromptContext
console.log('\ngetPromptContext:');
{
  const state: InstrumentState = {
    data: { price: 174.52, change_pct: 2.3, market_cap: 2700000000000, pe_ratio: 28.5 },
    asOf: '2026-04-01T16:00:00Z',
  };
  const context = plane.state.getPromptContext('AAPL', 'Apple Inc.', state);
  assert(context.includes('AAPL'), 'Contains symbol');
  assert(context.includes('Apple Inc.'), 'Contains name');
  assert(context.includes('174.52'), 'Contains price');
  assert(context.includes('2.3'), 'Contains change %');
  assert(context.includes('2.7T'), 'Contains market cap formatted');
  assert(context.includes('28.5'), 'Contains P/E');
}

// Test 3: State — empty state
console.log('\ngetPromptContext with empty state:');
{
  const state: InstrumentState = { data: {}, asOf: '2026-04-01T00:00:00Z' };
  const context = plane.state.getPromptContext('TSLA', 'Tesla', state);
  assert(context.includes('TSLA'), 'Contains symbol even with empty state');
  assert(!context.includes('undefined'), 'No undefined in output');
}

// Test 4: State — getPrimaryMetric
console.log('\ngetPrimaryMetric:');
{
  const state: InstrumentState = {
    data: { price: 350.00, change_pct: -1.5 },
    asOf: '2026-04-01T00:00:00Z',
  };
  const metric = plane.state.getPrimaryMetric(state);
  assert(metric.value === 350, 'Price is 350');
  assert(metric.changePct === -1.5, 'Change is -1.5%');
  assert(metric.label === 'Price', 'Label is Price');
}

// Test 5: State — formatMetric
console.log('\nformatMetric:');
{
  const formatted = plane.state.formatMetric({ value: 174.52, label: 'Price', changePct: 2.3 });
  assert(formatted === '$174.52 (+2.3%)', `Formatted: ${formatted}`);

  const neg = plane.state.formatMetric({ value: 100, label: 'Price', changePct: -0.5 });
  assert(neg.includes('-0.5%'), `Negative: ${neg}`);

  const noChange = plane.state.formatMetric({ value: 50, label: 'Price' });
  assert(noChange === '$50.00', `No change: ${noChange}`);
}

// Test 6: Evaluation — scorePrediction
console.log('\nscorePrediction:');
{
  const correct = plane.evaluation.scorePrediction(
    { direction: 'up', confidence: 80 },
    { data: {}, direction: 'up', determinedAt: '' },
  );
  assert(correct.wasCorrect === true, 'Correct prediction detected');
  assert(correct.accuracy === 1, 'Accuracy = 1 for correct');

  const wrong = plane.evaluation.scorePrediction(
    { direction: 'up', confidence: 90 },
    { data: {}, direction: 'down', determinedAt: '' },
  );
  assert(wrong.wasCorrect === false, 'Incorrect prediction detected');
  assert(wrong.accuracy === 0, 'Accuracy = 0 for incorrect');
  // High confidence + wrong = low calibration
  assert(wrong.calibration < 0.2, `Low calibration for overconfident wrong call: ${wrong.calibration}`);
}

// Test 7: Evaluation — getDefaultHorizons
console.log('\ngetDefaultHorizons:');
{
  const horizons = plane.evaluation.getDefaultHorizons();
  assert(horizons.length === 3, '3 default horizons');
  assert(horizons[0].value === 1 && horizons[0].unit === 'days', '1 day');
  assert(horizons[1].value === 3 && horizons[1].unit === 'days', '3 days');
  assert(horizons[2].value === 5 && horizons[2].unit === 'days', '5 days');
}

// Test 8: Presentation — getDashboardLayout
console.log('\ngetDashboardLayout:');
{
  const layout = plane.presentation.getDashboardLayout();
  assert(layout.title === 'Financial Markets', 'Dashboard title');
  assert(layout.sections.length > 0, 'Has sections');
}

// Test 9: Presentation — getInstrumentCardFields
console.log('\ngetInstrumentCardFields:');
{
  const fields = plane.presentation.getInstrumentCardFields();
  assert(fields.length >= 4, 'At least 4 card fields');
  assert(fields.some(f => f.key === 'symbol'), 'Has symbol field');
  assert(fields.some(f => f.key === 'price'), 'Has price field');
}

// Test 10: Presentation — getPredictionDisplayFormat
console.log('\ngetPredictionDisplayFormat:');
{
  const format = plane.presentation.getPredictionDisplayFormat();
  assert(format.directionFormat === 'arrow', 'Direction as arrow');
  assert(format.confidenceFormat === 'bar', 'Confidence as bar');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
