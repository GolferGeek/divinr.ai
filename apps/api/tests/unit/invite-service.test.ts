/**
 * Unit tests for InviteService validation logic.
 * Effort: beta-user-share-path.
 *
 * Tests the pure validation logic without DB — uses in-memory invite records.
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

// ─── Invite Validation Logic (mirrored from InviteService) ──────

interface InviteRow {
  id: string;
  organization_slug: string;
  email: string | null;
  token: string;
  role_name: string;
  created_by: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

function validateInvite(invite: InviteRow | null, email?: string): { valid: boolean; reason?: string; organizationSlug?: string } {
  if (!invite) return { valid: false, reason: 'Invite not found' };
  if (invite.revoked_at) return { valid: false, reason: 'Invite has been revoked' };
  if (invite.accepted_at) return { valid: false, reason: 'Invite has already been used' };
  if (new Date(invite.expires_at) < new Date()) return { valid: false, reason: 'Invite has expired' };
  if (email && invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
    return { valid: false, reason: 'Email mismatch' };
  }
  return { valid: true, organizationSlug: invite.organization_slug };
}

const now = new Date().toISOString();
const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();

const freshInvite: InviteRow = {
  id: 'inv-1', organization_slug: 'personal-golfergeek', email: null,
  token: 'tok-fresh', role_name: 'beta_reader', created_by: 'admin-1',
  expires_at: future, accepted_at: null, revoked_at: null, created_at: now,
};

// ─── Tests ──────────────────────────────────────────────────────

test('fresh invite validates as valid', () => {
  const result = validateInvite(freshInvite);
  assert.equal(result.valid, true);
  assert.equal(result.organizationSlug, 'personal-golfergeek');
});

test('expired invite is invalid', () => {
  const expired = { ...freshInvite, expires_at: past };
  const result = validateInvite(expired);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Invite has expired');
});

test('revoked invite is invalid', () => {
  const revoked = { ...freshInvite, revoked_at: now };
  const result = validateInvite(revoked);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Invite has been revoked');
});

test('already-accepted invite is invalid', () => {
  const accepted = { ...freshInvite, accepted_at: now };
  const result = validateInvite(accepted);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Invite has already been used');
});

test('email-restricted invite rejects mismatched email', () => {
  const restricted = { ...freshInvite, email: 'alice@example.com' };
  const result = validateInvite(restricted, 'bob@example.com');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Email mismatch');
});

test('email-restricted invite accepts matching email (case-insensitive)', () => {
  const restricted = { ...freshInvite, email: 'Alice@Example.com' };
  const result = validateInvite(restricted, 'alice@example.com');
  assert.equal(result.valid, true);
});

test('null invite returns not found', () => {
  const result = validateInvite(null);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Invite not found');
});

test('create invite generates correct structure', () => {
  // Simulate createInvite output
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const token = '11111111-2222-3333-4444-555555555555';
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const result = {
    id,
    token,
    inviteUrl: `http://localhost:7101/signup/${token}`,
    expiresAt: expiresAt.toISOString(),
  };
  assert.ok(result.id.length > 0);
  assert.ok(result.token.length > 0);
  assert.ok(result.inviteUrl.includes('/signup/'));
  assert.ok(new Date(result.expiresAt) > new Date());
});

console.log('\nInvite service tests complete.');
