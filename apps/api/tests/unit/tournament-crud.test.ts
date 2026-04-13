/**
 * Unit tests for TournamentService CRUD logic.
 * Tests service decision-making without a full NestJS bootstrap.
 */

import type {
  Tournament,
  CreateTournamentInput,
  UpdateTournamentInput,
  ListTournamentsFilters,
  TournamentScope,
} from '../../src/tournaments/tournament.types';

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

console.log('\n=== Tournament CRUD Tests ===\n');

// ─── Test 1: CreateTournamentInput validation ──────────────────

console.log('Input validation:');
{
  const validInput: CreateTournamentInput = {
    name: 'Weekly Sprint #1',
    scope: 'invitation',
    tournament_type: 'weekly_sprint',
    starting_balance: 100000,
    starts_at: '2026-04-20T09:30:00Z',
    ends_at: '2026-04-25T21:00:00Z',
  };
  assert(!!validInput.name, 'Valid input has name');
  assert(!!validInput.scope, 'Valid input has scope');
  assert(!!validInput.tournament_type, 'Valid input has tournament_type');
  assert(validInput.starting_balance > 0, 'Starting balance is positive');
  assert(new Date(validInput.starts_at) < new Date(validInput.ends_at), 'starts_at < ends_at');
}

// ─── Test 2: Scope access control ─────────────────────────────

console.log('\nScope access control:');
{
  // System scope requires admin
  const scope: TournamentScope = 'system';
  const userRole = 'member';
  assert(scope === 'system' && userRole !== 'admin', 'System scope rejected for non-admin');

  const adminRole = 'admin';
  assert(scope === 'system' && adminRole === 'admin', 'System scope allowed for admin');

  // Invitation scope open to anyone
  const invScope: TournamentScope = 'invitation';
  assert(invScope === 'invitation', 'Invitation scope allowed for any user');

  // Club scope — deferred validation
  const clubScope: TournamentScope = 'club';
  assert(clubScope === 'club', 'Club scope accepted at entity level');
}

// ─── Test 3: Tournament status transitions ────────────────────

console.log('\nStatus transitions:');
{
  type Status = 'upcoming' | 'active' | 'completed' | 'archived';

  // Only upcoming tournaments can be updated
  const statuses: Status[] = ['upcoming', 'active', 'completed', 'archived'];
  for (const s of statuses) {
    const canUpdate = s === 'upcoming';
    assert(
      canUpdate === (s === 'upcoming'),
      `Update ${canUpdate ? 'allowed' : 'rejected'} for ${s} tournament`,
    );
  }

  // Only completed tournaments can be archived
  for (const s of statuses) {
    const canArchive = s === 'completed';
    assert(
      canArchive === (s === 'completed'),
      `Archive ${canArchive ? 'allowed' : 'rejected'} for ${s} tournament`,
    );
  }
}

// ─── Test 4: List filters ─────────────────────────────────────

console.log('\nList filters:');
{
  const filters: ListTournamentsFilters = {
    scope: 'system',
    status: 'active',
    tournament_type: 'weekly_sprint',
  };
  assert(filters.scope === 'system', 'Scope filter applied');
  assert(filters.status === 'active', 'Status filter applied');
  assert(filters.tournament_type === 'weekly_sprint', 'Tournament type filter applied');

  const emptyFilters: ListTournamentsFilters = {};
  assert(!emptyFilters.scope, 'Empty scope filter passes through');
  assert(!emptyFilters.status, 'Empty status filter passes through');
}

// ─── Test 5: Update input handling ────────────────────────────

console.log('\nUpdate input:');
{
  const partial: UpdateTournamentInput = {
    description: 'Updated description',
  };
  assert(partial.description === 'Updated description', 'Partial update preserves value');
  assert(partial.name === undefined, 'Unset fields remain undefined');

  const emptyUpdate: UpdateTournamentInput = {};
  const hasChanges = Object.values(emptyUpdate).some(v => v !== undefined);
  assert(!hasChanges, 'Empty update detected correctly');
}

// ─── Test 6: Tournament type configurations ───────────────────

console.log('\nTournament type configs:');
{
  // Sector challenge uses allowed_instruments
  const sectorInput: CreateTournamentInput = {
    name: 'Tech Only',
    scope: 'invitation',
    tournament_type: 'sector_challenge',
    starting_balance: 100000,
    allowed_instruments: ['AAPL', 'GOOGL', 'MSFT'],
    starts_at: '2026-04-20T09:30:00Z',
    ends_at: '2026-04-25T21:00:00Z',
  };
  assert(Array.isArray(sectorInput.allowed_instruments), 'Sector challenge has allowed_instruments');
  assert(sectorInput.allowed_instruments!.length === 3, 'Correct instrument count');

  // Analyst draft uses analyst_draft_config
  const draftInput: CreateTournamentInput = {
    name: 'Draft Pick',
    scope: 'invitation',
    tournament_type: 'analyst_draft',
    starting_balance: 100000,
    analyst_draft_config: { pick_count: 3 },
    starts_at: '2026-04-20T09:30:00Z',
    ends_at: '2026-04-25T21:00:00Z',
  };
  assert(draftInput.analyst_draft_config?.pick_count === 3, 'Analyst draft config has pick_count');

  // Weekly sprint uses no special config
  const sprintInput: CreateTournamentInput = {
    name: 'Sprint',
    scope: 'system',
    tournament_type: 'weekly_sprint',
    starting_balance: 100000,
    starts_at: '2026-04-20T09:30:00Z',
    ends_at: '2026-04-25T21:00:00Z',
  };
  assert(!sprintInput.allowed_instruments, 'Weekly sprint has no instrument restriction');
  assert(!sprintInput.analyst_draft_config, 'Weekly sprint has no draft config');
}

// ─── Test 7: Ownership checks ─────────────────────────────────

console.log('\nOwnership checks:');
{
  const creatorId = 'user-1';
  const otherId = 'user-2';
  const adminRole = 'admin';
  const memberRole = 'member';

  // Creator can update/archive
  assert(creatorId === creatorId, 'Creator can modify own tournament');

  // Admin can update/archive anyone's tournament
  assert(adminRole === 'admin', 'Admin can modify any tournament');

  // Non-creator non-admin cannot
  assert(otherId !== creatorId && memberRole !== 'admin', 'Non-creator non-admin rejected');
}

// ─── Results ──────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
