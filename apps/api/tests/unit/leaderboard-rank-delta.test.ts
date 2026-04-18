/**
 * Pure-logic unit tests for the rank_delta formula used by both
 * TournamentLeaderboardService and ClubRankingService.
 *
 * The contract (PRD §4.3):
 *   rank_delta = prev_rank - current_rank (positive = moved up)
 *   rank_delta === null  iff  prev_rank === null (no prior-day snapshot)
 */

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

/** Mirrors the computation in both services' mappers. */
function computeDelta(prevRank: number | null, currentRank: number): number | null {
  return prevRank === null ? null : prevRank - currentRank;
}

console.log('\n=== Rank Delta Formula ===\n');

console.log('Sign conventions:');
{
  assert(computeDelta(5, 2) === 3, 'prev=5, current=2 → delta=3 (moved up 3)');
  assert(computeDelta(2, 5) === -3, 'prev=2, current=5 → delta=-3 (moved down 3)');
  assert(computeDelta(3, 3) === 0, 'prev=3, current=3 → delta=0 (unchanged)');
  assert(computeDelta(1, 1) === 0, 'prev=1, current=1 → delta=0 (held top)');
}

console.log('\nNull propagation:');
{
  assert(computeDelta(null, 1) === null, 'prev=null, current=1 → delta=null (day one)');
  assert(computeDelta(null, 42) === null, 'prev=null, current=42 → delta=null (mid-tournament joiner)');
}

console.log('\nLarge magnitudes:');
{
  assert(computeDelta(100, 1) === 99, 'prev=100, current=1 → delta=99');
  assert(computeDelta(1, 100) === -99, 'prev=1, current=100 → delta=-99');
}

console.log('\nGlyph mapping (what the web renders, mirrors PRD §2):');
{
  function glyphFor(delta: number | null): 'up' | 'down' | 'flat' | 'blank' {
    if (delta === null) return 'blank';
    if (delta > 0) return 'up';
    if (delta < 0) return 'down';
    return 'flat';
  }
  assert(glyphFor(computeDelta(5, 2)) === 'up', 'positive delta → up arrow');
  assert(glyphFor(computeDelta(2, 5)) === 'down', 'negative delta → down arrow');
  assert(glyphFor(computeDelta(3, 3)) === 'flat', 'zero delta → em-dash');
  assert(glyphFor(computeDelta(null, 1)) === 'blank', 'null delta → blank');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
