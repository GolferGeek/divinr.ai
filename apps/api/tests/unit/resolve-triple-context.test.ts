import { resolveTripleContext } from '../../src/markets/utils/resolve-triple-context';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

console.log('resolveTripleContext');

// Both base
{
  const result = resolveTripleContext(
    { id: 'analyst-1', user_id: null },
    { id: 'instrument-1', user_id: null },
  );
  assert(result.authorUserId === null, 'both base → authorUserId null');
  assert(result.analystId === 'analyst-1', 'both base → analystId preserved');
  assert(result.instrumentId === 'instrument-1', 'both base → instrumentId preserved');
}

// Base analyst + user instrument
{
  const result = resolveTripleContext(
    { id: 'analyst-1', user_id: null },
    { id: 'instrument-1', user_id: 'user-X' },
  );
  assert(result.authorUserId === 'user-X', 'base analyst + user instrument → user-X');
}

// User analyst + base instrument
{
  const result = resolveTripleContext(
    { id: 'analyst-1', user_id: 'user-Y' },
    { id: 'instrument-1', user_id: null },
  );
  assert(result.authorUserId === 'user-Y', 'user analyst + base instrument → user-Y');
}

// Both user-authored, same user
{
  const result = resolveTripleContext(
    { id: 'analyst-1', user_id: 'user-Z' },
    { id: 'instrument-1', user_id: 'user-Z' },
  );
  assert(result.authorUserId === 'user-Z', 'both same user → user-Z');
}

// Mixed authorship → throws
{
  let threw = false;
  try {
    resolveTripleContext(
      { id: 'analyst-1', user_id: 'user-A' },
      { id: 'instrument-1', user_id: 'user-B' },
    );
  } catch (e) {
    threw = true;
    assert((e as Error).message.includes('Mixed authorship'), 'error message mentions mixed authorship');
  }
  assert(threw, 'mixed authorship throws error');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
