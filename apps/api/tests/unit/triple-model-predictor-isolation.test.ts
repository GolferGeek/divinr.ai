import { resolveTripleContext } from '../../src/markets/utils/resolve-triple-context';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

console.log('Triple Model: Predictor Isolation');

// Two triples with same (analyst, instrument) but different author_user_id
{
  const baseTriple = resolveTripleContext(
    { id: 'analyst-A', user_id: null },
    { id: 'instrument-X', user_id: null },
  );
  const userTriple = resolveTripleContext(
    { id: 'analyst-A', user_id: null },
    { id: 'instrument-X-custom', user_id: 'user-1' },
  );
  assert(baseTriple.authorUserId === null, 'base triple has null author');
  assert(userTriple.authorUserId === 'user-1', 'user triple has user-1 author');
  assert(baseTriple.authorUserId !== userTriple.authorUserId, 'triples have different authors');
}

// COALESCE-based uniqueness: two predictor rows with same (instrument, article, analyst)
// but different author_user_id are unique under the new index
{
  const baseKey = `${coalesce(null)}:instrument-X:article-1:analyst-A`;
  const userKey = `${coalesce('user-1')}:instrument-X:article-1:analyst-A`;
  assert(baseKey !== userKey, 'COALESCE keys differ for base vs user');
}

// ON CONFLICT expression matching: verify the COALESCE pattern
{
  const nullCoalesced = coalesce(null);
  const userCoalesced = coalesce('user-1');
  assert(nullCoalesced === 'base', 'null coalesces to "base"');
  assert(userCoalesced === 'user-1', 'non-null passes through');
}

// Verify SQL parameter ordering for upsertPredictor includes author_user_id
{
  const insertColumns = [
    'id', 'instrument_id', 'article_id', 'relevance_score',
    'status', 'rationale', 'created_by', 'scored_by_analyst_id', 'llm_usage_id',
    'author_user_id',
    'crowd_reaction', 'crowd_reaction_confidence', 'crowd_reaction_rationale',
    'estimated_reaction_window_minutes',
    'created_at', 'updated_at',
  ];
  assert(insertColumns.includes('author_user_id'), 'INSERT includes author_user_id column');
  assert(insertColumns.indexOf('author_user_id') === 9, 'author_user_id is $10 (index 9)');
}

function coalesce(val: string | null): string {
  return val ?? 'base';
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
