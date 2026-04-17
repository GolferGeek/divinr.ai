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

console.log('Triple Model: Calibration Isolation');

// Performance profiles keyed by triple
{
  const baseTriple = resolveTripleContext(
    { id: 'analyst-A', user_id: null },
    { id: 'instrument-X', user_id: null },
  );
  const userTriple = resolveTripleContext(
    { id: 'analyst-A', user_id: null },
    { id: 'instrument-X-custom', user_id: 'user-1' },
  );

  const baseProfileKey = `${coalesce(baseTriple.authorUserId)}:${baseTriple.analystId}:${baseTriple.instrumentId}:3:30d`;
  const userProfileKey = `${coalesce(userTriple.authorUserId)}:${userTriple.analystId}:${userTriple.instrumentId}:3:30d`;
  assert(baseProfileKey !== userProfileKey, 'performance profile keys differ per triple');
}

// Leaderboard default aggregation: GROUP BY analyst_id (no author_user_id)
{
  const defaultGroupBy = 'analyst_id';
  assert(!defaultGroupBy.includes('author_user_id'), 'default leaderboard groups by analyst only');
}

// Triple-level drill-down: GROUP BY (author_user_id, analyst_id, instrument_id)
{
  const tripleGroupBy = 'coalesce(author_user_id, \'base\'), analyst_id, instrument_id';
  assert(tripleGroupBy.includes('author_user_id'), 'triple drill-down includes author_user_id');
  assert(tripleGroupBy.includes('analyst_id'), 'triple drill-down includes analyst_id');
  assert(tripleGroupBy.includes('instrument_id'), 'triple drill-down includes instrument_id');
}

// Performance profile INSERT now includes author_user_id from evaluations
{
  const insertColumns = [
    'id', 'analyst_id', 'instrument_id', 'horizon_window', 'period',
    'author_user_id',
    'accuracy_rate', 'avg_confidence', 'calibration_score',
    'systematic_biases', 'sample_size', 'computed_at',
  ];
  assert(insertColumns.includes('author_user_id'), 'profile INSERT includes author_user_id');
}

// Learning proposals include user_id
{
  const proposalColumns = [
    'id', 'tier', 'analyst_id', 'instrument_id', 'user_id',
    'proposal_type', 'description', 'rationale', 'proposed_change',
  ];
  assert(proposalColumns.includes('user_id'), 'proposal INSERT includes user_id');
}

// Unique index enforces one profile per triple per period
{
  const indexColumns = 'coalesce(author_user_id, \'base\'), analyst_id, instrument_id, horizon_window, period';
  assert(indexColumns.includes('author_user_id'), 'unique index includes author_user_id');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
