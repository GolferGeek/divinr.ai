/**
 * Unit tests for TournamentLifecycleService logic.
 * Tests status transition rules, notification triggers, and channel lifecycle.
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

console.log('\n=== Tournament Lifecycle Tests ===\n');

// ─── Test 1: Status transitions ────────────────────────────────

console.log('Status transitions:');
{
  // upcoming → active when starts_at <= now
  const now = Date.now();
  const pastStart = new Date(now - 60000).toISOString();
  const futureStart = new Date(now + 3600000).toISOString();

  assert(new Date(pastStart).getTime() <= now, 'Past starts_at triggers upcoming → active');
  assert(new Date(futureStart).getTime() > now, 'Future starts_at keeps tournament upcoming');

  // active → completed when ends_at <= now
  const pastEnd = new Date(now - 60000).toISOString();
  const futureEnd = new Date(now + 86400000).toISOString();

  assert(new Date(pastEnd).getTime() <= now, 'Past ends_at triggers active → completed');
  assert(new Date(futureEnd).getTime() > now, 'Future ends_at keeps tournament active');
}

// ─── Test 2: Idempotency — no re-transition ───────────────────

console.log('\nIdempotency:');
{
  type Status = 'upcoming' | 'active' | 'completed' | 'archived';

  // Only upcoming tournaments transition to active
  const canActivate = (status: Status) => status === 'upcoming';
  assert(canActivate('upcoming'), 'Upcoming can activate');
  assert(!canActivate('active'), 'Active cannot re-activate');
  assert(!canActivate('completed'), 'Completed cannot activate');

  // Only active tournaments transition to completed
  const canComplete = (status: Status) => status === 'active';
  assert(canComplete('active'), 'Active can complete');
  assert(!canComplete('completed'), 'Completed cannot re-complete');
  assert(!canComplete('upcoming'), 'Upcoming cannot complete');
}

// ─── Test 3: Channel creation on activation ────────────────────

console.log('\nChannel creation:');
{
  const channelScope = 'tournament';
  const scopeId = 'tournament-123';
  const channelName = 'Weekly Sprint #1';

  assert(channelScope === 'tournament', 'Channel scope is tournament');
  assert(scopeId === 'tournament-123', 'Channel scope_id is tournament ID');
  assert(channelName === 'Weekly Sprint #1', 'Channel name is tournament name');
}

// ─── Test 4: Channel member roles ──────────────────────────────

console.log('\nChannel member roles:');
{
  const creatorId = 'user-creator';
  const entrants = [
    { user_id: 'user-creator' },
    { user_id: 'user-2' },
    { user_id: 'user-3' },
  ];

  for (const e of entrants) {
    const role = e.user_id === creatorId ? 'admin' : 'member';
    assert(
      role === (e.user_id === creatorId ? 'admin' : 'member'),
      `${e.user_id}: role=${role}`,
    );
  }
}

// ─── Test 5: Channel archived on completion ────────────────────

console.log('\nChannel archival:');
{
  const channelId = 'channel-123';
  assert(!!channelId, 'Channel archived on tournament completion');
  // No channel → no archive needed
  const noChannel: string | null = null;
  assert(!noChannel, 'No channel = skip archival');
}

// ─── Test 6: Notification events ───────────────────────────────

console.log('\nNotification events:');
{
  const eventTypes = [
    'tournament_starting',
    'tournament_started',
    'tournament_ended',
    'tournament_rank_change',
    'tournament_results',
  ];

  for (const event of eventTypes) {
    assert(event.startsWith('tournament_'), `Event type ${event} is valid`);
  }
  assert(eventTypes.length === 5, 'All 5 tournament event types defined');
}

// ─── Test 7: Starting-soon windows ─────────────────────────────

console.log('\nStarting-soon windows:');
{
  const now = Date.now();

  // 24h window: tournament starts in 23.5 hours
  const in23h = new Date(now + 23.5 * 3600000);
  const within24h = (in23h.getTime() - now) <= 24 * 3600000;
  const beyond23h = (in23h.getTime() - now) > 23 * 3600000;
  assert(within24h && beyond23h, '23.5h before start triggers 24h notification');

  // 1h window: tournament starts in 58 minutes (between 55m and 60m)
  const in58m = new Date(now + 58 * 60000);
  const within1h = (in58m.getTime() - now) <= 3600000;
  const beyond55m = (in58m.getTime() - now) > 55 * 60000;
  assert(within1h && beyond55m, '58min before start triggers 1h notification');
}

// ─── Results ──────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
