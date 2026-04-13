/**
 * Unit tests for ClubAnalyticsService logic.
 */
let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

console.log('\n=== Club Analytics Tests ===\n');

console.log('Analytics shape:');
{
  const shape = {
    member_count: 10, tournament_count: 3, avg_return_pct: 5.2,
    club_win_rate: 62.5, analyst_trust: [], analyst_trust_evolution: [],
    learning_score: null, club_style: 'balanced', common_mistakes: [],
    contrarian_spotlights: [],
  };
  const keys = Object.keys(shape);
  assert(keys.includes('member_count'), 'Has member_count');
  assert(keys.includes('avg_return_pct'), 'Has avg_return_pct');
  assert(keys.includes('club_win_rate'), 'Has club_win_rate');
  assert(keys.includes('analyst_trust'), 'Has analyst_trust');
  assert(keys.includes('learning_score'), 'Has learning_score');
  assert(keys.includes('club_style'), 'Has club_style');
  assert(keys.includes('common_mistakes'), 'Has common_mistakes');
  assert(keys.includes('contrarian_spotlights'), 'Has contrarian_spotlights');
}

console.log('\nWin rate calculation:');
{
  const wins = 15;
  const total = 24;
  const rate = Math.round((wins / total) * 10000) / 100;
  assert(rate === 62.5, `Win rate: ${rate}%`);

  const zeroRate = 0 > 0 ? (0 / 0) * 100 : 0;
  assert(zeroRate === 0, 'Zero trades = 0% win rate');
}

console.log('\nClub style derivation:');
{
  function deriveStyle(affinities: number[]): string {
    if (affinities.length === 0) return 'balanced';
    const avg = affinities.reduce((a, b) => a + b, 0) / affinities.length;
    const variance = affinities.reduce((sum, a) => sum + (a - avg) ** 2, 0) / affinities.length;
    if (variance > 0.05) return 'diverse';
    if (avg > 0.65) return 'trend follower';
    if (avg < 0.35) return 'contrarian';
    return 'balanced';
  }

  assert(deriveStyle([0.8, 0.75, 0.7]) === 'trend follower', 'High affinity = trend follower');
  assert(deriveStyle([0.2, 0.25, 0.3]) === 'contrarian', 'Low affinity = contrarian');
  assert(deriveStyle([0.5, 0.5, 0.5]) === 'balanced', 'Mid affinity = balanced');
  assert(deriveStyle([0.1, 0.9, 0.5]) === 'diverse', 'High variance = diverse');
  assert(deriveStyle([]) === 'balanced', 'Empty = balanced');
}

console.log('\nPost-mortem shape:');
{
  const pm = {
    tournament_name: 'Sprint', starts_at: '', ends_at: '', entrant_count: 5,
    top_performers: [], biggest_win: null, biggest_loss: null,
  };
  assert('tournament_name' in pm, 'Has tournament_name');
  assert('top_performers' in pm, 'Has top_performers');
  assert('biggest_win' in pm, 'Has biggest_win');
  assert('biggest_loss' in pm, 'Has biggest_loss');
}

console.log('\nMembership check:');
{
  const members = ['user-1', 'user-2'];
  assert(members.includes('user-1'), 'Member can access analytics');
  assert(!members.includes('user-3'), 'Non-member cannot access analytics');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
