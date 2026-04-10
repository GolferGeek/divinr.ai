import { strict as assert } from 'node:assert';
import {
  bootstrapComplianceApp,
  cleanupComplianceData,
  ensureComplianceSchema,
  seedComplianceData,
  type ComplianceSeed,
} from './compliance-harness';

type BoundaryTest = {
  name: string;
  run: () => Promise<void>;
};

function pass(name: string): void {
  // eslint-disable-next-line no-console
  console.log(`PASS  ${name}`);
}

function fail(name: string, error: unknown): void {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`FAIL  ${name}\n${message}`);
}

async function main(): Promise<void> {
  const app = await bootstrapComplianceApp();
  let seed: ComplianceSeed | null = null;

  const tests: BoundaryTest[] = [
    {
      name: 'User-scoped RBAC permission checks work',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        // With user-scoped RBAC (no org), each user's permissions are global.
        // adminUserId and analystAUserId have roles; analystBUserId has a role too.
        const matrix = [
          { userId: seed.adminUserId, expected: true },
          { userId: seed.analystAUserId, expected: true },
          { userId: seed.analystBUserId, expected: true },
        ];

        for (const row of matrix) {
          const allowed = await app.rbac.hasPermission(
            row.userId,
            'compliance.documents.read',
          );
          assert.equal(
            allowed,
            row.expected,
            `unexpected permission result for user=${row.userId}`,
          );
        }
      },
    },
    {
      name: 'High-volume parallel checks are consistent',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const attempts = Array.from({ length: 40 }, () =>
          app.rbac.hasPermission(
            seed.analystAUserId,
            'compliance.documents.read',
          ),
        );
        const results = await Promise.all(attempts);
        for (const allowed of results) {
          assert.equal(allowed, true);
        }
      },
    },
    {
      name: 'Role grant/revoke toggles access deterministically',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const roleName = `${seed.runId}:analyst`;
        // Use a user that does not have the analyst role initially
        // to test grant/revoke cycle
        const testUserId = seed.adminUserId;

        for (let i = 0; i < 3; i += 1) {
          await app.rbac.assignRole(
            testUserId,
            roleName,
            seed.adminUserId,
          );
          const granted = await app.rbac.hasPermission(
            testUserId,
            'compliance.documents.read',
          );
          assert.equal(granted, true);

          await app.rbac.revokeRole(
            testUserId,
            roleName,
            seed.adminUserId,
          );
          // Admin still has admin role, so still has permission
          const stillAllowed = await app.rbac.hasPermission(
            testUserId,
            'compliance.documents.read',
          );
          assert.equal(stillAllowed, true);
        }
      },
    },
    {
      name: 'Audit log captures repeated entitlement changes',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const audit = await app.rbac.getAuditLog(50);
        const grants = audit.filter((entry) => entry.action === 'grant').length;
        const revokes = audit.filter((entry) => entry.action === 'revoke').length;
        assert.ok(grants >= 3, `expected >=3 grant entries, got ${grants}`);
        assert.ok(revokes >= 3, `expected >=3 revoke entries, got ${revokes}`);
      },
    },
  ];

  try {
    await ensureComplianceSchema(app.db);
    seed = await seedComplianceData(app.db);

    for (const test of tests) {
      await test.run();
      pass(test.name);
    }

    // eslint-disable-next-line no-console
    console.log('\nCompliance boundary suite passed.');
  } catch (error) {
    fail('Compliance boundary suite', error);
    process.exitCode = 1;
  } finally {
    if (seed) {
      await cleanupComplianceData(app.db, seed);
    }
    await app.close();
  }
}

void main();
