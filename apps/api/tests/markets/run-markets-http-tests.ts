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
  // The HTTP smoke tests use the compliance harness's seed users (which are
  // text-id rows in authz.users with no real Supabase auth.users record), so
  // they cannot present a valid JWT. Force the dev bypass on for this runner
  // — runtime traffic still has bypass off in .env. A follow-up effort should
  // migrate the harness to create a real auth.users row + mint a JWT, at
  // which point this override can be removed. See effort/auth-bootstrap notes.
  process.env.MARKETS_DEV_AUTH_BYPASS = 'true';
  process.env.API_PORT = process.env.API_PORT || '3100';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    'postgresql://postgres:postgres@127.0.0.1:7011/postgres';
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
      name: 'Missing user identity is rejected',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const response = await request(app.getHttpServer())
          .post('/markets/instruments')
          .send({
            userId: seed.adminUserId,
            symbol: 'AMD',
          });
        // Without x-user-id header and dev bypass, should fail
        assert.ok([400, 401, 403].includes(response.status), `expected 4xx, got ${response.status}`);
      },
    },
    {
      name: 'Header identity can be used for authenticated request',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const create = await request(app.getHttpServer())
          .post('/markets/instruments')
          .set('x-user-id', seed.adminUserId)
          .send({

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
          .set('x-user-id', seed.adminUserId)
          .send({

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
            .set('x-user-id', seed.adminUserId)
            .send({
  
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
