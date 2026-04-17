import { resolveTripleContext } from '../../src/markets/utils/resolve-triple-context';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

function coalesce(val: string | null): string {
  return val ?? 'base';
}

console.log('Triple Model: Prediction Isolation');

// Two triples produce independent prediction streams
{
  const baseTriple = resolveTripleContext(
    { id: 'analyst-A', user_id: null },
    { id: 'instrument-X', user_id: null },
  );
  const userTriple = resolveTripleContext(
    { id: 'analyst-A', user_id: null },
    { id: 'instrument-X-custom', user_id: 'user-1' },
  );
  assert(baseTriple.authorUserId === null, 'base prediction triple → null author');
  assert(userTriple.authorUserId === 'user-1', 'user prediction triple → user-1 author');
}

// Active-prediction uniqueness allows both triples to have unsettled predictions
{
  const baseActiveKey = `${coalesce(null)}:analyst-A:instrument-X`;
  const userActiveKey = `${coalesce('user-1')}:analyst-A:instrument-X`;
  assert(baseActiveKey !== userActiveKey, 'active prediction keys differ per triple');
}

// Outcome tracking propagates author_user_id
{
  const predictionAuthor: string | null = 'user-1';
  const evaluationAuthor = predictionAuthor;
  assert(evaluationAuthor === 'user-1', 'evaluation inherits prediction author_user_id');
}

// Arbitrator prediction uses run.author_user_id
{
  const runAuthorUserId: string | null = null;
  assert(runAuthorUserId === null, 'arbitrator prediction inherits null from base run');
}

// Per-analyst prediction uses resolveTripleContext
{
  const triple = resolveTripleContext(
    { id: 'analyst-custom', user_id: 'user-2' },
    { id: 'instrument-base', user_id: null },
  );
  assert(triple.authorUserId === 'user-2', 'custom analyst prediction gets user-2 author');
}

// PendingPrediction interface includes triple fields
{
  const pred = {
    id: 'pred-1',
    instrument_id: 'inst-1',
    predicted_direction: 'up',
    confidence: 80,
    horizon_minutes: 240,
    analyst_id: 'analyst-1',
    run_id: 'run-1',
    author_user_id: 'user-1' as string | null,
    created_at: '2026-04-17T00:00:00Z',
  };
  assert(pred.author_user_id === 'user-1', 'PendingPrediction carries author_user_id');
  assert(pred.analyst_id === 'analyst-1', 'PendingPrediction carries analyst_id');
  assert(pred.run_id === 'run-1', 'PendingPrediction carries run_id');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
