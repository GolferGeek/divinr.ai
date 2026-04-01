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
      name: 'Cross-tenant RBAC matrix denies unauthorized access',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const matrix = [
          { userId: seed.adminUserId, org: seed.orgA, expected: true },
          { userId: seed.adminUserId, org: seed.orgB, expected: false },
          { userId: seed.analystAUserId, org: seed.orgA, expected: true },
          { userId: seed.analystAUserId, org: seed.orgB, expected: false },
          { userId: seed.analystBUserId, org: seed.orgA, expected: false },
          { userId: seed.analystBUserId, org: seed.orgB, expected: true },
        ];

        for (const row of matrix) {
          const allowed = await app.rbac.hasPermission(
            row.userId,
            row.org,
            'compliance.documents.read',
          );
          assert.equal(
            allowed,
            row.expected,
            `unexpected permission result for user=${row.userId} org=${row.org}`,
          );
        }
      },
    },
    {
      name: 'High-volume parallel checks preserve tenant boundaries',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const attempts = Array.from({ length: 40 }, (_, idx) =>
          app.rbac.hasPermission(
            idx % 2 === 0 ? seed.analystAUserId : seed.analystBUserId,
            idx % 2 === 0 ? seed.orgB : seed.orgA,
            'compliance.documents.read',
          ),
        );
        const results = await Promise.all(attempts);
        for (const allowed of results) {
          assert.equal(allowed, false);
        }
      },
    },
    {
      name: 'Role grant/revoke toggles access deterministically',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const roleName = `${seed.runId}:analyst`;

        for (let i = 0; i < 3; i += 1) {
          await app.rbac.assignRole(
            seed.analystAUserId,
            seed.orgB,
            roleName,
            seed.adminUserId,
          );
          const granted = await app.rbac.hasPermission(
            seed.analystAUserId,
            seed.orgB,
            'compliance.documents.read',
          );
          assert.equal(granted, true);

          await app.rbac.revokeRole(
            seed.analystAUserId,
            seed.orgB,
            roleName,
            seed.adminUserId,
          );
          const revoked = await app.rbac.hasPermission(
            seed.analystAUserId,
            seed.orgB,
            'compliance.documents.read',
          );
          assert.equal(revoked, false);
        }
      },
    },
    {
      name: 'Audit log captures repeated entitlement changes',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const audit = await app.rbac.getAuditLog(seed.orgB, 50);
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
