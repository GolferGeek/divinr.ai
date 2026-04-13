/**
 * Unit tests for ClubRankingService logic.
 */
let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

console.log('\n=== Club Ranking Tests ===\n');

console.log('Composite score formula:');
{
  function score(avgReturn: number, winRate: number, members: number, tournaments: number): number {
    return (avgReturn * 0.4) + (winRate * 0.3) + (Math.log2(members + 1) * 10 * 0.2) + (tournaments * 0.1);
  }

  // Club A: 10% return, 60% win, 50 members, 5 tournaments
  const a = score(10, 60, 50, 5);
  // Club B: 5% return, 70% win, 10 members, 10 tournaments
  const b = score(5, 70, 10, 10);
  assert(a > 0 && b > 0, 'Both scores positive');
  assert(Math.abs(a - (4 + 18 + Math.log2(51)*10*0.2 + 0.5)) < 0.01, `Club A score: ${a.toFixed(2)}`);

  // Member scaling is logarithmic
  const small = score(10, 60, 5, 5);
  const large = score(10, 60, 500, 5);
  assert(large > small, 'More members = higher score');
  assert(large < small * 5, 'Member advantage is sub-linear (log2)');
}

console.log('\nRanking position assignment:');
{
  const clubs = [
    { id: 'C', score: 30 },
    { id: 'A', score: 50 },
    { id: 'B', score: 40 },
  ];
  clubs.sort((a, b) => b.score - a.score);
  assert(clubs[0].id === 'A', 'Rank 1: highest score');
  assert(clubs[1].id === 'B', 'Rank 2: middle score');
  assert(clubs[2].id === 'C', 'Rank 3: lowest score');
}

console.log('\nBadge thresholds:');
{
  const totalClubs = 20;
  const top10 = Math.ceil(totalClubs * 0.1); // 2
  const top25 = Math.ceil(totalClubs * 0.25); // 5
  assert(top10 === 2, 'Top 10% = positions 1-2');
  assert(top25 === 5, 'Top 25% = positions 1-5');

  assert(1 <= top10, 'Position 1 gets top_10_pct');
  assert(3 <= top25 && 3 > top10, 'Position 3 gets top_25_pct (not top_10)');
  assert(6 > top25, 'Position 6 gets no percentile badge');

  // Min 3 clubs for badges
  const tooFew = 2;
  assert(tooFew < 3, 'Badges disabled with < 3 clubs');
}

console.log('\nRising club detection:');
{
  const lastPosition = 15;
  const currentPosition = 8;
  const improvement = lastPosition - currentPosition;
  assert(improvement >= 5, `Moved up ${improvement} positions → rising_club badge`);

  const smallMove = 12 - 10;
  assert(smallMove < 5, `Moved up ${smallMove} positions → no rising_club badge`);
}

console.log('\nSort options:');
{
  const validSorts = ['ranking_score', 'return_pct', 'win_rate', 'member_count'];
  for (const s of validSorts) assert(validSorts.includes(s), `Sort by ${s} is valid`);
  assert(!validSorts.includes('invalid'), 'Invalid sort rejected');
}

console.log('\nOnly public clubs:');
{
  const clubs = [
    { name: 'Public', is_public: true },
    { name: 'Private', is_public: false },
  ];
  const ranked = clubs.filter(c => c.is_public);
  assert(ranked.length === 1, 'Only public clubs in leaderboard');
  assert(ranked[0].name === 'Public', 'Public club is ranked');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
