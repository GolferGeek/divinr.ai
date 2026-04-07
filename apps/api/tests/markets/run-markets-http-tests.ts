import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import request from 'supertest';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import {
  cleanupComplianceData,
  ensureComplianceSchema,
  seedComplianceData,
  type ComplianceSeed,
} from '../compliance/compliance-harness';

type TestCase = {
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
  process.env.API_PORT = process.env.API_PORT || '3100';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  process.env.DB_PROVIDER = process.env.DB_PROVIDER || 'supabase';
  process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || 'simplified';
  process.env.COMMERCIAL_LLM_PROVIDER = process.env.COMMERCIAL_LLM_PROVIDER || 'none';
  process.env.OPENSOURCE_LLM_PROVIDER = process.env.OPENSOURCE_LLM_PROVIDER || 'none';
  process.env.OBSERVABILITY_PROVIDER = process.env.OBSERVABILITY_PROVIDER || 'supabase';
  process.env.CONFIG_PROVIDER = process.env.CONFIG_PROVIDER || 'local';

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  let seed: ComplianceSeed | null = null;

  const db = app.get<DatabaseService>(DATABASE_SERVICE);
  const tests: TestCase[] = [
    {
      name: 'Header identity mismatch is rejected',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const response = await request(app.getHttpServer())
          .post('/markets/instruments')
          .set('x-org-slug', seed.orgA)
          .set('x-user-id', seed.adminUserId)
          .send({
            organizationSlug: seed.orgB,
            userId: seed.adminUserId,
            symbol: 'AMD',
          });
        assert.equal(response.status, 400);
      },
    },
    {
      name: 'Header identity can be used for authenticated request',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const create = await request(app.getHttpServer())
          .post('/markets/instruments')
          .set('x-org-slug', seed.orgA)
          .set('x-user-id', seed.adminUserId)
          .send({
            organizationSlug: seed.orgA,
            userId: seed.adminUserId,
            symbol: 'CRM',
          });
        if (create.status !== 201) {
          throw new Error(
            `create instrument failed status=${create.status} body=${JSON.stringify(create.body)}`,
          );
        }
        assert.equal(create.status, 201);
        const instrumentId = create.body.id as string;
        assert.ok(instrumentId);

        const enqueue = await request(app.getHttpServer())
          .post('/markets/runs')
          .set('x-org-slug', seed.orgA)
          .set('x-user-id', seed.adminUserId)
          .send({
            organizationSlug: seed.orgA,
            userId: seed.adminUserId,
            instrumentId,
            runType: 'prediction',
          });
        if (enqueue.status !== 201) {
          throw new Error(
            `enqueue run failed status=${enqueue.status} body=${JSON.stringify(enqueue.body)}`,
          );
        }
        assert.equal(enqueue.status, 201);

        // Driving /markets/runs/process from here would invoke the full
        // prediction pipeline (real Polygon/FMP/LLM calls) — that belongs
        // in the on-demand integration suite, not the smoke gate. The
        // header-identity assertion is satisfied by the successful create
        // + enqueue above. See run-markets-smoke-tests.ts for the
        // MARKETS_INTEGRATION_TESTS=true convention.
        if (process.env.MARKETS_INTEGRATION_TESTS === 'true') {
          const processed = await request(app.getHttpServer())
            .post('/markets/runs/process')
            .set('x-org-slug', seed.orgA)
            .set('x-user-id', seed.adminUserId)
            .send({
              organizationSlug: seed.orgA,
              userId: seed.adminUserId,
              maxRuns: 1,
            });
          if (processed.status !== 201) {
            throw new Error(
              `process run failed status=${processed.status} body=${JSON.stringify(processed.body)}`,
            );
          }
          assert.equal(processed.status, 201);
          assert.equal(processed.body.processedCount, 1);
        }
      },
    },
  ];

  try {
    await app.init();
    await ensureComplianceSchema(db);
    seed = await seedComplianceData(db);

    for (const test of tests) {
      await test.run();
      pass(test.name);
    }

    // eslint-disable-next-line no-console
    console.log(
      `\nMarkets HTTP suite passed${process.env.MARKETS_INTEGRATION_TESTS === 'true' ? '' : ' (integration steps skipped — set MARKETS_INTEGRATION_TESTS=true to include)'}.`,
    );
  } catch (error) {
    fail('Markets HTTP suite', error);
    process.exitCode = 1;
  } finally {
    if (seed) {
      await cleanupComplianceData(db, seed);
    }
    await app.close();
  }
}

void main();
