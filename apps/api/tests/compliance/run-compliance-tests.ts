import { strict as assert } from 'node:assert';
import {
  bootstrapComplianceApp,
  buildExecutionContext,
  cleanupComplianceData,
  ensureComplianceSchema,
  seedComplianceData,
  type ComplianceSeed,
} from './compliance-harness';

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

function logPass(name: string): void {
  // eslint-disable-next-line no-console
  console.log(`PASS  ${name}`);
}

function logFail(name: string, error: unknown): void {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`FAIL  ${name}\n${message}`);
}

async function waitForObservabilityRows<T>(
  loader: () => Promise<{ error: { message: string } | null; data: T[] | null }>,
  attempts = 20,
  delayMs = 50,
): Promise<T[]> {
  for (let i = 0; i < attempts; i += 1) {
    const result = await loader();
    assert.equal(result.error, null);
    const rows = result.data || [];
    if (rows.length > 0) {
      return rows;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return [];
}

async function main(): Promise<void> {
  const app = await bootstrapComplianceApp();
  let seed: ComplianceSeed | null = null;

  const tests: TestCase[] = [
    {
      name: 'DB provider is deterministic for baseline env',
      run: async () => {
        assert.equal(app.db.getConfig().provider, 'supabase');
      },
    },
    {
      name: 'Tenant isolation: user cannot access another tenant documents',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const allDocs = await app.db
          .from('authz', 'compliance_documents')
          .select('id, organization_slug')
          .in('organization_slug', [seed.orgA, seed.orgB]);
        assert.equal(allDocs.error, null);
        const allRows = (allDocs.data as Array<unknown> | null) || [];
        assert.equal(allRows.length, 2);

        const loadDocumentsForUser = async (userId: string, organizationSlug: string) => {
          const allowed = await app.rbac.hasPermission(
            userId,
            organizationSlug,
            'compliance.documents.read',
          );
          if (!allowed) {
            return [];
          }
          const docs = await app.db
            .from('authz', 'compliance_documents')
            .select('id, title, organization_slug')
            .eq('organization_slug', organizationSlug);
          assert.equal(docs.error, null);
          return (docs.data as Array<unknown> | null) || [];
        };

        const ownRows = await loadDocumentsForUser(seed.analystAUserId, seed.orgA);
        const crossRows = await loadDocumentsForUser(seed.analystAUserId, seed.orgB);
        assert.equal(ownRows.length, 1);
        assert.equal(crossRows.length, 0);
      },
    },
    {
      name: 'RBAC allow/deny and role assignment works',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const allowed = await app.rbac.hasPermission(
          seed.analystAUserId,
          seed.orgA,
          'compliance.documents.read',
        );
        assert.equal(allowed, true);

        const denied = await app.rbac.hasPermission(
          seed.analystAUserId,
          seed.orgB,
          'compliance.documents.read',
        );
        assert.equal(denied, false);

        await assert.rejects(async () => {
          await app.rbac.requirePermission(
            seed.analystAUserId,
            seed.orgB,
            'compliance.documents.read',
          );
        });

        await app.rbac.assignRole(
          seed.analystAUserId,
          seed.orgB,
          `${seed.runId}:analyst`,
          seed.adminUserId,
        );
        const allowedAfterGrant = await app.rbac.hasPermission(
          seed.analystAUserId,
          seed.orgB,
          'compliance.documents.read',
        );
        assert.equal(allowedAfterGrant, true);

        await app.rbac.revokeRole(
          seed.analystAUserId,
          seed.orgB,
          `${seed.runId}:analyst`,
          seed.adminUserId,
        );
        const deniedAfterRevoke = await app.rbac.hasPermission(
          seed.analystAUserId,
          seed.orgB,
          'compliance.documents.read',
        );
        assert.equal(deniedAfterRevoke, false);
      },
    },
    {
      name: 'RBAC audit evidence records grant/revoke actions',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const audit = await app.rbac.getAuditLog(seed.orgB, 25);
        const actions = audit.map((entry) => entry.action);
        assert.ok(actions.includes('grant'));
        assert.ok(actions.includes('revoke'));
      },
    },
    {
      name: 'Observability event evidence persists with tenant context',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const context = buildExecutionContext(seed);
        await app.observabilityEvents.push({
          context,
          source_app: 'compliance-test',
          hook_event_type: 'compliance.test.event',
          status: 'completed',
          message: 'compliance event persisted',
          progress: 100,
          step: 'verification',
          payload: { runId: seed.runId, objective: 'auditability' },
          timestamp: Date.now(),
        });

        const rows = await waitForObservabilityRows<{ payload: { runId?: string } }>(
          async () => {
            const query = await app.db
              .from(null, 'observability_events')
              .select('hook_event_type, organization_slug, payload')
              .eq('hook_event_type', 'compliance.test.event')
              .eq('organization_slug', seed.orgA)
              .order('created_at', { ascending: false })
              .limit(1);
            return {
              error: query.error,
              data:
                (query.data as Array<{ payload: { runId?: string } }> | null) || [],
            };
          },
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.payload?.runId, seed.runId);
      },
    },
    {
      name: 'LLM routing governance emits persisted observability evidence',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const context = buildExecutionContext(seed);
        app.llm.emitLlmObservabilityEvent('agent.llm.started', context, {
          runId: seed.runId,
          provider: context.provider,
          model: context.model,
          message: 'llm governance test',
        });

        const rows = await waitForObservabilityRows<{
          payload: { provider?: string; model?: string };
        }>(async () => {
          const result = await app.db.rawQuery(
            `
            select payload
            from public.observability_events
            where hook_event_type = 'agent.llm.started'
              and organization_slug = $1
              and payload->>'runId' = $2
            order by id desc
            limit 1
            `,
            [seed.orgA, seed.runId],
          );
          return {
            error: result.error,
            data:
              (result.data as Array<{
                payload: { provider?: string; model?: string };
              }> | null) || [],
          };
        });
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.payload?.provider, context.provider);
        assert.equal(rows[0]?.payload?.model, context.model);
      },
    },
  ];

  try {
    const connection = await app.db.checkConnection();
    assert.equal(connection.status, 'ok');
    await ensureComplianceSchema(app.db);
    seed = await seedComplianceData(app.db);

    for (const test of tests) {
      await test.run();
      logPass(test.name);
    }

    // eslint-disable-next-line no-console
    console.log('\nCompliance integration suite passed.');
  } catch (error) {
    logFail('Compliance integration suite', error);
    process.exitCode = 1;
  } finally {
    if (seed) {
      await cleanupComplianceData(app.db, seed);
    }
    await app.close();
  }
}

void main();
