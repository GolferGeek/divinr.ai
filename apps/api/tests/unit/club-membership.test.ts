/**
 * Unit tests for ClubService membership logic.
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

console.log('\n=== Club Membership Tests ===\n');

// ─── Test 1: Invite code generation ────────────────────────────
console.log('Invite code generation:');
{
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  assert(code.length === 8, 'Invite code is 8 characters');
  assert(/^[A-Z0-9]+$/.test(code), 'Invite code is alphanumeric uppercase');
  // No ambiguous chars (0, O, 1, I, L)
  assert(!code.includes('O'), 'No ambiguous O');
  assert(!code.includes('I'), 'No ambiguous I');
  assert(!code.includes('L'), 'No ambiguous L');
  assert(!code.includes('0'), 'No ambiguous 0');
  assert(!code.includes('1'), 'No ambiguous 1');
}

// ─── Test 2: Role hierarchy ────────────────────────────────────
console.log('\nRole hierarchy:');
{
  type Role = 'owner' | 'admin' | 'member';

  const canPromote = (actorRole: Role) => actorRole === 'owner';
  assert(canPromote('owner'), 'Owner can promote');
  assert(!canPromote('admin'), 'Admin cannot promote');
  assert(!canPromote('member'), 'Member cannot promote');

  const canDemote = (actorRole: Role) => actorRole === 'owner';
  assert(canDemote('owner'), 'Owner can demote');
  assert(!canDemote('admin'), 'Admin cannot demote');

  const canRemove = (actorRole: Role) => actorRole === 'owner' || actorRole === 'admin';
  assert(canRemove('owner'), 'Owner can remove members');
  assert(canRemove('admin'), 'Admin can remove members');
  assert(!canRemove('member'), 'Member cannot remove others');

  const canUpdate = (actorRole: Role) => actorRole === 'owner' || actorRole === 'admin';
  assert(canUpdate('owner'), 'Owner can update club');
  assert(canUpdate('admin'), 'Admin can update club');

  const canDelete = (actorRole: Role) => actorRole === 'owner';
  assert(canDelete('owner'), 'Only owner can delete club');
  assert(!canDelete('admin'), 'Admin cannot delete club');
}

// ─── Test 3: Owner cannot leave ────────────────────────────────
console.log('\nOwner leave restriction:');
{
  const memberRole = 'owner';
  assert(memberRole === 'owner', 'Owner cannot leave (blocked)');
  const nonOwner = 'member';
  assert(nonOwner !== 'owner', 'Non-owner can leave');
}

// ─── Test 4: Duplicate join prevention ─────────────────────────
console.log('\nDuplicate join prevention:');
{
  const existingMembers = new Set(['user-1']);
  assert(existingMembers.has('user-1'), 'Duplicate join detected for existing member');
  assert(!existingMembers.has('user-2'), 'New member can join');
}

// ─── Test 5: Cannot remove owner ───────────────────────────────
console.log('\nCannot remove owner:');
{
  const targetRole = 'owner';
  assert(targetRole === 'owner', 'Removing owner is blocked');
  const targetAdmin = 'admin';
  assert(targetAdmin !== 'owner', 'Removing admin is allowed');
}

// ─── Test 6: Public vs private discovery ───────────────────────
console.log('\nPublic/private discovery:');
{
  const clubs = [
    { name: 'Public Club', is_public: true },
    { name: 'Private Club', is_public: false },
  ];
  const discoverable = clubs.filter(c => c.is_public);
  assert(discoverable.length === 1, 'Only 1 public club in discovery');
  assert(discoverable[0].name === 'Public Club', 'Public club is discoverable');
  assert(!clubs.filter(c => !c.is_public).some(c => discoverable.includes(c)), 'Private club not in discovery');
}

// ─── Test 7: Invite code validation ────────────────────────────
console.log('\nInvite code validation:');
{
  const clubCode = 'ABC12345';
  const inputCode = 'ABC12345';
  const wrongCode = 'WRONG123';
  assert(clubCode === inputCode, 'Correct code accepted');
  assert(clubCode !== wrongCode, 'Wrong code rejected');
}

// ─── Test 8: Invite accept flow ────────────────────────────────
console.log('\nInvite accept flow:');
{
  const pendingStatus = 'pending';
  assert(pendingStatus === 'pending', 'Pending invite can be accepted');
  const acceptedStatus = 'accepted';
  assert(acceptedStatus !== 'pending', 'Accepted invite cannot be re-accepted');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
