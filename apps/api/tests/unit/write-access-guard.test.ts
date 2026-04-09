/**
 * Unit tests for requireWriteAccess logic.
 * Effort: beta-user-share-path.
 *
 * Tests the role-based write access control without DB.
 */
import assert from 'node:assert/strict';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// Mirror the requireWriteAccess logic
function checkWriteAccess(roles: string[]): 'allow' | 'deny' {
  const writableRoles = ['super-admin', 'owner', 'member', 'admin'];
  if (roles.some(r => writableRoles.includes(r))) return 'allow';
  if (roles.includes('beta_reader') || roles.length === 0) return 'deny';
  return 'allow'; // Unknown roles default to allow (forward-compat)
}

test('beta_reader role is denied write access', () => {
  assert.equal(checkWriteAccess(['beta_reader']), 'deny');
});

test('member role is allowed write access', () => {
  assert.equal(checkWriteAccess(['member']), 'allow');
});

test('owner role is allowed write access', () => {
  assert.equal(checkWriteAccess(['owner']), 'allow');
});

test('admin role is allowed write access', () => {
  assert.equal(checkWriteAccess(['admin']), 'allow');
});

test('super-admin role is allowed write access', () => {
  assert.equal(checkWriteAccess(['super-admin']), 'allow');
});

test('user with both beta_reader and member roles is allowed (higher role wins)', () => {
  assert.equal(checkWriteAccess(['beta_reader', 'member']), 'allow');
});

test('user with no roles is denied', () => {
  assert.equal(checkWriteAccess([]), 'deny');
});

test('user with only beta_reader and no other roles is denied', () => {
  assert.equal(checkWriteAccess(['beta_reader']), 'deny');
});

console.log('\nWrite access guard tests complete.');
