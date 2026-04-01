import { strict as assert } from 'node:assert';
import {
  bootstrapComplianceApp,
  cleanupComplianceData,
  ensureComplianceSchema,
  seedComplianceData,
  type ComplianceSeed,
} from './compliance-harness';

type MutationTest = {
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

  const tests: MutationTest[] = [
    {
      name: 'Unauthorized cross-tenant write is blocked',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const targetDocId = `${seed.runId}:blocked-write`;
        const result = await app.db.rawQuery(
          `
          select authz.secure_upsert_document($1::uuid, $2::varchar, $3::text, $4::text, $5::text) as document_id
          `,
          [
            seed.analystAUserId,
            seed.orgB,
            targetDocId,
            'Blocked',
            'Should not exist',
          ],
        );
        assert.equal(result.error, null);
        const rows =
          (result.data as Array<{ document_id: string | null }> | null) || [];
        assert.equal(rows[0]?.document_id ?? null, null);

        const check = await app.db
          .from('authz', 'compliance_documents')
          .select('id')
          .eq('id', targetDocId)
          .maybeSingle();
        assert.equal(check.error, null);
        assert.equal(check.data, null);
      },
    },
    {
      name: 'Authorized tenant write succeeds and persists',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const targetDocId = `${seed.runId}:allowed-write`;
        const result = await app.db.rawQuery(
          `
          select authz.secure_upsert_document($1::uuid, $2::varchar, $3::text, $4::text, $5::text) as document_id
          `,
          [
            seed.adminUserId,
            seed.orgA,
            targetDocId,
            'Allowed',
            'Persisted content',
          ],
        );
        assert.equal(result.error, null);
        const rows =
          (result.data as Array<{ document_id: string | null }> | null) || [];
        assert.equal(rows[0]?.document_id, targetDocId);

        const check = await app.db
          .from('authz', 'compliance_documents')
          .select('id, organization_slug, title')
          .eq('id', targetDocId)
          .single();
        assert.equal(check.error, null);
        const row = check.data as
          | { organization_slug: string; title: string }
          | null;
        assert.equal(row?.organization_slug, seed.orgA);
        assert.equal(row?.title, 'Allowed');
      },
    },
    {
      name: 'Unauthorized overwrite does not mutate existing row',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const before = await app.db
          .from('authz', 'compliance_documents')
          .select('id, body')
          .eq('id', seed.docBId)
          .single();
        assert.equal(before.error, null);
        const beforeRow = before.data as { body: string } | null;
        assert.equal(beforeRow?.body, 'B-only policy body');

        const blocked = await app.db.rawQuery(
          `
          select authz.secure_upsert_document($1::uuid, $2::varchar, $3::text, $4::text, $5::text) as document_id
          `,
          [
            seed.analystAUserId,
            seed.orgB,
            seed.docBId,
            'Tampered',
            'tampered-content',
          ],
        );
        assert.equal(blocked.error, null);
        const rows =
          (blocked.data as Array<{ document_id: string | null }> | null) || [];
        assert.equal(rows[0]?.document_id ?? null, null);

        const after = await app.db
          .from('authz', 'compliance_documents')
          .select('id, body')
          .eq('id', seed.docBId)
          .single();
        assert.equal(after.error, null);
        const afterRow = after.data as { body: string } | null;
        assert.equal(afterRow?.body, 'B-only policy body');
      },
    },
    {
      name: 'Failed mutations do not inflate document count',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const before = await app.db
          .from('authz', 'compliance_documents')
          .select('id', { count: 'exact' });
        assert.equal(before.error, null);
        const beforeCount = before.count ?? 0;

        for (let i = 0; i < 10; i += 1) {
          const blocked = await app.db.rawQuery(
            `
            select authz.secure_upsert_document($1::uuid, $2::varchar, $3::text, $4::text, $5::text) as document_id
            `,
            [
              seed.analystBUserId,
              seed.orgA,
              `${seed.runId}:blocked-${i}`,
              `Blocked ${i}`,
              'no-op',
            ],
          );
          assert.equal(blocked.error, null);
        }

        const after = await app.db
          .from('authz', 'compliance_documents')
          .select('id', { count: 'exact' });
        assert.equal(after.error, null);
        const afterCount = after.count ?? 0;
        assert.equal(afterCount, beforeCount);
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
    console.log('\nCompliance mutation safety suite passed.');
  } catch (error) {
    fail('Compliance mutation safety suite', error);
    process.exitCode = 1;
  } finally {
    if (seed) {
      await cleanupComplianceData(app.db, seed);
    }
    await app.close();
  }
}

void main();
