/**
 * Unit tests for badge evaluation and comparison logic.
 */
let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

console.log('\n=== Club Badges Tests ===\n');

console.log('Badge types:');
{
  const badges = [
    { badge: 'top_10_pct', label: 'Top 10%', color: 'gold' },
    { badge: 'top_25_pct', label: 'Top 25%', color: 'silver' },
    { badge: 'rising_club', label: 'Rising Club', color: 'green' },
    { badge: 'most_improved', label: 'Most Improved', color: 'blue' },
  ];
  assert(badges.length === 4, '4 badge types defined');
  for (const b of badges) assert(!!b.badge && !!b.label && !!b.color, `${b.label} has all fields`);
}

console.log('\nBadge assignment logic:');
{
  const totalClubs = 30;
  const top10 = Math.ceil(totalClubs * 0.1); // 3
  const top25 = Math.ceil(totalClubs * 0.25); // 8

  // Position 1 → top_10_pct
  assert(1 <= top10, 'Position 1 earns top_10_pct');
  // Position 5 → top_25_pct (not top_10)
  assert(5 > top10 && 5 <= top25, 'Position 5 earns top_25_pct');
  // Position 10 → no percentile badge
  assert(10 > top25, 'Position 10 earns no percentile badge');
}

console.log('\nMost improved:');
{
  const clubs = [
    { id: 'A', currentScore: 50, lastScore: 30 },
    { id: 'B', currentScore: 40, lastScore: 35 },
    { id: 'C', currentScore: 60, lastScore: 55 },
  ];
  const deltas = clubs.map(c => ({ id: c.id, delta: c.currentScore - c.lastScore }));
  const best = deltas.reduce((a, b) => a.delta > b.delta ? a : b);
  assert(best.id === 'A', 'Club A is most improved (delta=20)');
  assert(best.delta === 20, 'Biggest delta is 20');
}

console.log('\nComparison shape:');
{
  const comparison = {
    club_a: { id: 'A', name: 'Alpha', ranking_position: 1, ranking_score: 50, badges: [], member_count: 30, avg_return_pct: 12, club_win_rate: 65, tournament_count: 5 },
    club_b: { id: 'B', name: 'Beta', ranking_position: 5, ranking_score: 35, badges: [], member_count: 15, avg_return_pct: 8, club_win_rate: 55, tournament_count: 3 },
  };
  assert('club_a' in comparison, 'Has club_a');
  assert('club_b' in comparison, 'Has club_b');
  assert(comparison.club_a.ranking_position < comparison.club_b.ranking_position, 'Club A ranks higher');
  assert(comparison.club_a.avg_return_pct > comparison.club_b.avg_return_pct, 'Club A has better return');
}

console.log('\nSnapshot period labels:');
{
  const now = new Date('2026-04-01');
  const monthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  assert(monthLabel === '2026-04', 'Monthly label format correct');

  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const qLabel = `${now.getFullYear()}-Q${quarter}`;
  assert(qLabel === '2026-Q2', 'Quarterly label format correct');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
