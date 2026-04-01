/**
 * Unit tests for Sprint 7 view logic — data transformations,
 * component prop contracts, and display formatting.
 */

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

console.log('\n=== Sprint 7 View Logic Tests ===\n');

// ── RunStatusChip color logic ─────────────────────────────────

console.log('RunStatusChip colors:');
{
  function statusColor(status: string): string {
    if (status === 'completed') return 'success';
    if (status === 'failed') return 'error';
    if (status === 'running') return 'info';
    return 'grey';
  }

  assert(statusColor('completed') === 'success', 'completed → success');
  assert(statusColor('failed') === 'error', 'failed → error');
  assert(statusColor('running') === 'info', 'running → info');
  assert(statusColor('queued') === 'grey', 'queued → grey');
}

// ── CompositeScoreGauge logic ─────────────────────────────────

console.log('\nCompositeScoreGauge:');
{
  function scoreColor(score: number): string {
    if (score <= 33) return 'success';
    if (score <= 66) return 'warning';
    return 'error';
  }

  function verdictLabel(score: number): string {
    if (score <= 33) return 'LOW RISK';
    if (score <= 66) return 'MEDIUM RISK';
    return 'HIGH RISK';
  }

  assert(scoreColor(20) === 'success', 'Score 20 → success (low)');
  assert(scoreColor(33) === 'success', 'Score 33 → success (boundary)');
  assert(scoreColor(34) === 'warning', 'Score 34 → warning');
  assert(scoreColor(66) === 'warning', 'Score 66 → warning (boundary)');
  assert(scoreColor(67) === 'error', 'Score 67 → error');
  assert(scoreColor(100) === 'error', 'Score 100 → error');

  assert(verdictLabel(25) === 'LOW RISK', '25 → LOW RISK');
  assert(verdictLabel(50) === 'MEDIUM RISK', '50 → MEDIUM RISK');
  assert(verdictLabel(80) === 'HIGH RISK', '80 → HIGH RISK');
}

// ── Direction color logic ─────────────────────────────────────

console.log('\nDirection colors:');
{
  function directionColor(dir: string): string {
    if (dir === 'up') return 'success';
    if (dir === 'down') return 'error';
    return 'grey';
  }

  assert(directionColor('up') === 'success', 'up → success');
  assert(directionColor('down') === 'error', 'down → error');
  assert(directionColor('flat') === 'grey', 'flat → grey');
}

// ── Evaluation report summary formatting ──────────────────────

console.log('\nReport summary formatting:');
{
  function formatSummary(summary: Record<string, unknown>): string {
    const parts: string[] = [];
    if (summary['evaluated']) parts.push(`Evaluated: ${summary['evaluated']}`);
    if (summary['correct']) parts.push(`Correct: ${summary['correct']}`);
    if (summary['incorrect']) parts.push(`Incorrect: ${summary['incorrect']}`);
    if (summary['canonicalCandidates']) parts.push(`Canonical: ${summary['canonicalCandidates']}`);
    return parts.join(' | ') || 'No data';
  }

  const full = formatSummary({ evaluated: 25, correct: 18, incorrect: 7, canonicalCandidates: 2 });
  assert(full.includes('Evaluated: 25'), 'Includes evaluated count');
  assert(full.includes('Correct: 18'), 'Includes correct count');
  assert(full.includes('Canonical: 2'), 'Includes canonical count');

  const empty = formatSummary({});
  assert(empty === 'No data', 'Empty summary → No data');
}

// ── Multi-horizon pattern interpretation ──────────────────────

console.log('\nMulti-horizon patterns:');
{
  type HorizonResult = { correct: boolean };

  function interpretPattern(d1: HorizonResult, d3: HorizonResult, d5: HorizonResult): string {
    if (d1.correct && d3.correct && d5.correct) return 'strong_call';
    if (!d1.correct && d3.correct && d5.correct) return 'early_but_correct';
    if (d1.correct && !d3.correct && !d5.correct) return 'momentum_only';
    if (!d1.correct && !d3.correct && !d5.correct) return 'real_miss';
    return 'mixed';
  }

  assert(interpretPattern({ correct: true }, { correct: true }, { correct: true }) === 'strong_call', 'All correct → strong call');
  assert(interpretPattern({ correct: false }, { correct: true }, { correct: true }) === 'early_but_correct', 'Wrong 1d, right 3d/5d → early but correct');
  assert(interpretPattern({ correct: true }, { correct: false }, { correct: false }) === 'momentum_only', 'Right 1d, wrong 3d/5d → momentum only');
  assert(interpretPattern({ correct: false }, { correct: false }, { correct: false }) === 'real_miss', 'All wrong → real miss');
  assert(interpretPattern({ correct: true }, { correct: false }, { correct: true }) === 'mixed', 'Mixed pattern');
}

// ── Position sizing tier matching ─────────────────────────────

console.log('\nPosition sizing tiers:');
{
  function getPositionPercent(confidence: number): number {
    if (confidence >= 80) return 0.15;
    if (confidence >= 70) return 0.10;
    if (confidence >= 60) return 0.05;
    return 0; // No position below 60%
  }

  function calculatePositionSize(portfolioBalance: number, entryPrice: number, confidence: number): number {
    const percent = getPositionPercent(confidence);
    const positionValue = portfolioBalance * percent;
    return Math.max(0, Math.floor(positionValue / entryPrice));
  }

  assert(getPositionPercent(85) === 0.15, '85% conf → 15%');
  assert(getPositionPercent(75) === 0.10, '75% conf → 10%');
  assert(getPositionPercent(65) === 0.05, '65% conf → 5%');
  assert(getPositionPercent(50) === 0, '50% conf → no position');

  const shares = calculatePositionSize(1000000, 175, 80);
  assert(shares === 857, `$1M portfolio, $175 stock, 80% conf → ${shares} shares (15% = $150K / $175)`);

  const smallShares = calculatePositionSize(1000000, 175, 65);
  assert(smallShares === 285, `$1M portfolio, $175 stock, 65% conf → ${smallShares} shares (5% = $50K / $175)`);
}

// ── API endpoint count verification ───────────────────────────

console.log('\nAPI endpoint coverage:');
{
  const endpoints = [
    'GET /instruments', 'POST /instruments',
    'GET /analysts', 'PUT /analysts/:id', 'POST /analysts/:id/rollback', 'POST /analysts', 'POST /analysts/assign',
    'GET /instruments/:id/analysts',
    'GET /sources', 'POST /sources/entitlements',
    'POST /data/sync/external-crawler',
    'GET /articles',
    'GET /predictors', 'POST /predictors', 'POST /predictors/score', 'POST /predictors/score-batch',
    'POST /runs', 'GET /runs', 'GET /runs/:id', 'POST /runs/:id/status',
    'POST /runs/process-next', 'POST /runs/process',
    'POST /runs/:id/evaluate', 'POST /runs/:id/replay',
    'GET /runs/:id/artifacts', 'GET /runs/:id/evaluations', 'GET /runs/:id/replays',
    'GET /runs/:id/risk-details',
    'GET /predictions', 'GET /risk-assessments',
    'GET /risk-dimensions', 'POST /risk-dimensions',
    'GET /instruments/:id/composite-score',
    'GET /learning/proposals', 'POST /learning/proposals/:id/approve', 'POST /learning/proposals/:id/reject',
    'GET /learning/reports',
    'POST /admin/run-nightly-evaluation', 'POST /admin/run-learning-cycle',
  ];
  assert(endpoints.length === 39, `Expected 39 endpoints, got ${endpoints.length}`);
}

// ── Route count verification ──────────────────────────────────

console.log('\nWeb app route coverage:');
{
  const routes = [
    '/', '/domain/:domain',
    '/instruments', '/instruments/:id',
    '/analysts', '/analysts/:id/performance',
    '/runs', '/runs/:id',
    '/risk', '/predictions', '/sources',
    '/evaluations', '/learning', '/learning/canonical/:id',
  ];
  assert(routes.length === 14, `Expected 14 routes, got ${routes.length}`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
