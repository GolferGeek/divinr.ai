/**
 * Unit tests for US-1 — every new user gets a 30-day trial subscription seeded
 * on signup. Two flows: invite acceptance (InviteService.acceptInvite) and
 * club-code signup (AuthController.signupWithClubCode). These tests mock the
 * surrounding DB and auth service and assert ensureSubscription() is invoked
 * exactly once with the newly created user id after successful account creation.
 *
 * Effort: user-billing-model (Phase 2 step 2.9). See plan.md.
 */
import { InviteService } from '../../src/auth/invite.service';
import { AuthController } from '../../src/auth/auth.controller';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.error(`  \u2717 ${label}`);
  }
}

interface MockRow { [key: string]: unknown }

function future(days = 30): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function createMockDb(responses: Record<string, MockRow[]> = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    rawQuery: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      for (const [key, value] of Object.entries(responses)) {
        if (sql.includes(key)) return { data: value };
      }
      return { data: [] };
    },
  };
}

function createMockBilling() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    calls,
    ensureSubscription: async (userId: string) => {
      calls.push({ method: 'ensureSubscription', args: [userId] });
      return { user_id: userId, status: 'trial' };
    },
  };
}

async function main(): Promise<void> {
  console.log('\n=== Signup Trial Seeding ===\n');

  // ─── Flow A: invite acceptance seeds trial ────────────────────────
  {
    const db = createMockDb({
      // The atomic-claim UPDATE returns the valid invite row
      'UPDATE authz.invites': [{
        id: 'inv-1',
        email: null,
        token: 'tok-1',
        role_name: 'beta_reader',
        created_by: 'admin-1',
        expires_at: future(),
        accepted_at: null,
        revoked_at: null,
        created_at: new Date().toISOString(),
      }],
    });
    const authService = {
      createUser: async () => ({ id: 'new-user-1', email: 'new@example.com' }),
      login: async () => ({ accessToken: 'tok', refreshToken: 'r', tokenType: 'bearer', expiresIn: 3600 }),
    };
    const billing = createMockBilling();
    const svc = Object.create(InviteService.prototype);
    (svc as any).db = db;
    (svc as any).schema = { ensureSchema: async () => {} };
    (svc as any).authService = authService;
    (svc as any).billing = billing;
    (svc as any).logger = { log: () => {}, error: () => {}, warn: () => {}, debug: () => {} };

    await (svc as InviteService).acceptInvite('tok-1', 'new@example.com', 'pw', 'New User');
    assert(billing.calls.length === 1, 'invite acceptance invokes ensureSubscription exactly once');
    assert(billing.calls[0]?.args[0] === 'new-user-1', 'invite acceptance passes newly created user id');
  }

  // ─── Flow A: invite acceptance with billing failure does NOT block signup ─
  {
    const db = createMockDb({
      'UPDATE authz.invites': [{
        id: 'inv-2',
        email: null,
        token: 'tok-2',
        role_name: 'beta_reader',
        created_by: 'admin-1',
        expires_at: future(),
        accepted_at: null,
        revoked_at: null,
        created_at: new Date().toISOString(),
      }],
    });
    const authService = {
      createUser: async () => ({ id: 'new-user-2' }),
      login: async () => ({ accessToken: 'tok', refreshToken: 'r', tokenType: 'bearer', expiresIn: 3600 }),
    };
    const billing = {
      ensureSubscription: async () => { throw new Error('billing db transient'); },
    };
    const errors: string[] = [];
    const svc = Object.create(InviteService.prototype);
    (svc as any).db = db;
    (svc as any).schema = { ensureSchema: async () => {} };
    (svc as any).authService = authService;
    (svc as any).billing = billing;
    (svc as any).logger = { log: () => {}, error: (m: string) => errors.push(m), warn: () => {}, debug: () => {} };

    let threw = false;
    try { await (svc as InviteService).acceptInvite('tok-2', 'new@example.com', 'pw'); } catch { threw = true; }
    assert(!threw, 'invite acceptance does not throw when ensureSubscription fails');
    assert(errors.some(m => m.includes('ensureSubscription failed')), 'invite acceptance logs billing failure for ops visibility');
  }

  // ─── Flow B: club-code signup seeds trial ─────────────────────────
  {
    const db = createMockDb({
      'FROM prediction.clubs': [{ id: 'club-xyz', name: 'Test Club' }],
    });
    const authService = {
      createUser: async () => ({ id: 'new-user-3', email: 'friend@example.com' }),
      login: async () => ({ accessToken: 'tok', refreshToken: 'r', tokenType: 'bearer', expiresIn: 3600 }),
    };
    const billing = createMockBilling();
    const inviteService = { /* not used on club-code path */ };
    const ctrl = Object.create(AuthController.prototype);
    (ctrl as any).authService = authService;
    (ctrl as any).inviteService = inviteService;
    (ctrl as any).db = db;
    (ctrl as any).billing = billing;

    await (ctrl as AuthController).signupWithClubCode({
      clubCode: 'ABC123',
      email: 'friend@example.com',
      password: 'pw',
      displayName: 'Friend',
    });
    assert(billing.calls.length === 1, 'club-code signup invokes ensureSubscription exactly once');
    assert(billing.calls[0]?.args[0] === 'new-user-3', 'club-code signup passes newly created user id');
  }

  // ─── Flow B: missing user id skips ensureSubscription (cannot seed without id) ─
  {
    const db = createMockDb({
      'FROM prediction.clubs': [{ id: 'club-xyz', name: 'Test Club' }],
    });
    const authService = {
      createUser: async () => ({ /* no id */ }),
      login: async () => ({ accessToken: 'tok', refreshToken: 'r', tokenType: 'bearer', expiresIn: 3600 }),
    };
    const billing = createMockBilling();
    const ctrl = Object.create(AuthController.prototype);
    (ctrl as any).authService = authService;
    (ctrl as any).inviteService = {};
    (ctrl as any).db = db;
    (ctrl as any).billing = billing;

    await (ctrl as AuthController).signupWithClubCode({
      clubCode: 'ABC123',
      email: 'friend@example.com',
      password: 'pw',
    });
    assert(billing.calls.length === 0, 'club-code signup skips ensureSubscription when createUser returns no id');
  }

  // ─── Flow B: billing failure is swallowed (non-fatal) ─────────────
  {
    const db = createMockDb({
      'FROM prediction.clubs': [{ id: 'club-xyz', name: 'Test Club' }],
    });
    const authService = {
      createUser: async () => ({ id: 'new-user-4' }),
      login: async () => ({ accessToken: 'tok', refreshToken: 'r', tokenType: 'bearer', expiresIn: 3600 }),
    };
    const billing = {
      ensureSubscription: async () => { throw new Error('boom'); },
    };
    const ctrl = Object.create(AuthController.prototype);
    (ctrl as any).authService = authService;
    (ctrl as any).inviteService = {};
    (ctrl as any).db = db;
    (ctrl as any).billing = billing;

    let threw = false;
    try {
      await (ctrl as AuthController).signupWithClubCode({
        clubCode: 'ABC123',
        email: 'friend@example.com',
        password: 'pw',
      });
    } catch { threw = true; }
    assert(!threw, 'club-code signup does not throw when ensureSubscription fails');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
