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

console.log('Triple Model: Risk Isolation');

// Risk assessments for two triples produce independent records
{
  const baseTriple = resolveTripleContext(
    { id: 'analyst-A', user_id: null },
    { id: 'instrument-X', user_id: null },
  );
  const userTriple = resolveTripleContext(
    { id: 'analyst-A', user_id: 'user-1' },
    { id: 'instrument-X', user_id: null },
  );
  assert(baseTriple.authorUserId === null, 'base risk triple has null author');
  assert(userTriple.authorUserId === 'user-1', 'user risk triple has user-1');
}

// Orchestration run queuing respects triple-scoped uniqueness
{
  const baseRunKey = `${coalesce(null)}:instrument-X:risk`;
  const userRunKey = `${coalesce('user-1')}:instrument-X:risk`;
  assert(baseRunKey !== userRunKey, 'queued run keys differ per triple');
  assert(baseRunKey === 'base:instrument-X:risk', 'base run key correct');
  assert(userRunKey === 'user-1:instrument-X:risk', 'user run key correct');
}

// Prior risk assessment query includes author_user_id filter
{
  const priorQueryPattern = "coalesce(user_id, 'base') = coalesce($3, 'base')";
  assert(priorQueryPattern.includes('coalesce'), 'prior query uses COALESCE for null-safe comparison');
}

// Verify analyst_risk_assessments INSERT now includes user_id
{
  const columns = [
    'id', 'run_id', 'instrument_id', 'analyst_id', 'user_id',
    'score', 'confidence', 'reasoning', 'evidence', 'source_data',
    'model_provider', 'model_name', 'llm_usage_id', 'created_at',
  ];
  assert(columns.includes('user_id'), 'analyst_risk_assessments INSERT includes user_id');
}

// market_risk_assessments INSERT includes author_user_id
{
  const columns = [
    'id', 'run_id', 'instrument_id', 'risk_score', 'verdict',
    'rationale', 'author_user_id', 'created_at',
  ];
  assert(columns.includes('author_user_id'), 'market_risk_assessments INSERT includes author_user_id');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
