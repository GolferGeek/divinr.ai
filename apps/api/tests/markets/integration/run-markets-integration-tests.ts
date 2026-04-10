/**
 * Markets integration test runner — drives PredictionRunnerService end-to-end
 * against the seven stub adapters and the stub LLM service. Asserts on
 * persisted rows in prediction.market_predictions and
 * prediction.market_run_artifacts for each of the four scenarios.
 *
 * Bootstrap strategy: NestFactory.createApplicationContext(AppModule), then
 * post-bootstrap surgery to swap the seven adapters and the LLM service. We
 * do not use @nestjs/testing because it is not a workspace dep and adding it
 * just for this is unnecessary — adapter swapping is a Map mutation and the
 * LLM service is a single private field.
 *
 * Capture mode: pass MARKETS_FIXTURE_CAPTURE=true to make every stub adapter
 * call the real upstream and rewrite its fixture. Capture mode short-circuits
 * before the assertion phase.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';

// Force defaults BEFORE importing AppModule so DI sees them.
loadEnv({ path: join(__dirname, '..', '..', '..', '..', '..', '.env') });
process.env.MARKETS_DEV_AUTH_BYPASS = 'true';
process.env.MARKETS_ENABLE_LLM = 'true';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.DB_PROVIDER = process.env.DB_PROVIDER || 'supabase';
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || 'simplified';
process.env.OBSERVABILITY_PROVIDER = process.env.OBSERVABILITY_PROVIDER || 'supabase';
process.env.CONFIG_PROVIDER = process.env.CONFIG_PROVIDER || 'local';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../src/app.module';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsService } from '../../../src/markets/markets.service';
import { DataSourceService } from '../../../src/markets/services/data-source.service';
import { MarketsLlmService } from '../../../src/markets/services/markets-llm.service';

import { StubPolygonAdapter } from './stubs/stub-polygon.adapter';
import { StubFmpAdapter } from './stubs/stub-fmp.adapter';
import { StubTwelveDataAdapter } from './stubs/stub-twelve-data.adapter';
import { StubFinnhubAdapter } from './stubs/stub-finnhub.adapter';
import { StubFredAdapter } from './stubs/stub-fred.adapter';
import { StubSecEdgarAdapter } from './stubs/stub-sec-edgar.adapter';
import { StubRedditAdapter } from './stubs/stub-reddit.adapter';
import { StubLlmService } from './stubs/stub-llm-service';

import { SCENARIOS, seedScenario, cleanupScenario, type ScenarioSpec, type SeedResult } from './db-fixtures';

const CAPTURE = process.env.MARKETS_FIXTURE_CAPTURE === 'true';

interface DataSourceServicePrivate {
  adapters: Map<string, unknown>;
}
interface MarketsLlmServicePrivate {
  llm: unknown;
}

function installStubs(dataSources: DataSourceService, marketsLlm: MarketsLlmService): void {
  const stubs = [
    new StubPolygonAdapter(),
    new StubFmpAdapter(),
    new StubTwelveDataAdapter(),
    new StubFinnhubAdapter(),
    new StubFredAdapter(),
    new StubSecEdgarAdapter(),
    new StubRedditAdapter(),
  ];
  (dataSources as unknown as DataSourceServicePrivate).adapters = new Map(stubs.map((s) => [s.id, s]));
  if (!CAPTURE) {
    (marketsLlm as unknown as MarketsLlmServicePrivate).llm = new StubLlmService();
  }
}

interface ScenarioResult {
  scenario: ScenarioSpec;
  durationMs: number;
  ok: boolean;
  error?: string;
}

async function runScenario(
  service: MarketsService,
  db: DatabaseService,
  scenario: ScenarioSpec,
): Promise<void> {
  const seeded: SeedResult = await seedScenario(service, db, scenario);
  try {
    const queued = await service.enqueueRun({
      userId: seeded.userId,
      instrumentId: seeded.instrumentId,
      runType: 'prediction',
    });
    const processed = await service.processNextQueuedRun({
      userId: seeded.userId,
    });
    assert.equal(processed.processed, true, 'processNextQueuedRun did not process a run');
    assert.equal(processed.runId, queued.runId, 'processNextQueuedRun claimed an unexpected run');
    assert.equal(processed.status, 'completed', `expected completed, got ${processed.status}`);

    if (CAPTURE) return;

    // Per-analyst predictions: expect 3 for full scenarios, 2 for partial-failure.
    const expectedAnalystPreds = scenario.name === 'partial-failure' ? 2 : 3;
    const analystPredQ = await db.rawQuery(
      `select predicted_direction, confidence, analyst_id, llm_usage_id
       from prediction.market_predictions
       where run_id = $1 and role = 'analyst'`,
      [queued.runId],
    );
    if (analystPredQ.error) throw new Error(analystPredQ.error.message);
    const analystPredictions = (analystPredQ.data as Array<{ predicted_direction: string; confidence: number; analyst_id: string; llm_usage_id: string | null }>) ?? [];
    assert.equal(
      analystPredictions.length,
      expectedAnalystPreds,
      `${scenario.name}: expected ${expectedAnalystPreds} analyst predictions, got ${analystPredictions.length}`,
    );

    // Effort: llm-reasoning-capture — every analyst row produced from an LLM
    // call must have a non-null llm_usage_id. The stub LLM service mints a
    // synthetic uuid per call when includeMetadata=true (which
    // MarketsLlmService.generateText now always passes), and the markets
    // services capture that id and stamp it on the inserted row.
    for (const row of analystPredictions) {
      assert.ok(
        row.llm_usage_id !== null && row.llm_usage_id !== undefined,
        `${scenario.name}: analyst prediction for analyst_id=${row.analyst_id} has null llm_usage_id`,
      );
    }

    // Arbitrator prediction: exactly one row, role='arbitrator'.
    const arbQ = await db.rawQuery(
      `select predicted_direction, confidence, llm_usage_id
       from prediction.market_predictions
       where run_id = $1 and role = 'arbitrator'`,
      [queued.runId],
    );
    if (arbQ.error) throw new Error(arbQ.error.message);
    const arbRows = (arbQ.data as Array<{ predicted_direction: string; confidence: number; llm_usage_id: string | null }>) ?? [];
    assert.equal(arbRows.length, 1, `${scenario.name}: expected exactly one arbitrator row`);
    const arbitratorDirection = arbRows[0].predicted_direction;
    assert.ok(
      arbRows[0].llm_usage_id !== null && arbRows[0].llm_usage_id !== undefined,
      `${scenario.name}: arbitrator prediction has null llm_usage_id`,
    );

    // Per-scenario direction assertion.
    const expectedDirection: Record<string, string> = {
      bullish: 'up',
      bearish: 'down',
      split: 'flat',
      'partial-failure': 'up',
    };
    assert.equal(
      arbitratorDirection,
      expectedDirection[scenario.name],
      `${scenario.name}: arbitrator direction was ${arbitratorDirection}, expected ${expectedDirection[scenario.name]}`,
    );

    // Run artifacts: one per analyst that ran + one for the arbitrator.
    const artifactQ = await db.rawQuery(
      `select role from prediction.market_run_artifacts where run_id = $1`,
      [queued.runId],
    );
    if (artifactQ.error) throw new Error(artifactQ.error.message);
    const artifacts = (artifactQ.data as Array<{ role: string }>) ?? [];
    const analystArtifacts = artifacts.filter((a) => a.role === 'analyst').length;
    const arbitratorArtifacts = artifacts.filter((a) => a.role === 'arbitrator').length;
    assert.equal(analystArtifacts, expectedAnalystPreds, `${scenario.name}: analyst artifact count`);
    assert.equal(arbitratorArtifacts, 1, `${scenario.name}: arbitrator artifact count`);
  } finally {
    await cleanupScenario(db, `integration-test-${scenario.name}`);
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const db = app.get<DatabaseService>(DATABASE_SERVICE);
    const service = app.get(MarketsService);
    const dataSources = app.get(DataSourceService);
    const marketsLlm = app.get(MarketsLlmService);

    installStubs(dataSources, marketsLlm);

    const results: ScenarioResult[] = [];
    for (const scenario of SCENARIOS) {
      const t0 = Date.now();
      try {
        await runScenario(service, db, scenario);
        results.push({ scenario, durationMs: Date.now() - t0, ok: true });
        // eslint-disable-next-line no-console
        console.log(`PASS  ${scenario.name.padEnd(16)} (${scenario.symbol}) — ${Date.now() - t0}ms`);
      } catch (err) {
        const message = err instanceof Error ? err.stack || err.message : String(err);
        results.push({ scenario, durationMs: Date.now() - t0, ok: false, error: message });
        // eslint-disable-next-line no-console
        console.error(`FAIL  ${scenario.name.padEnd(16)} (${scenario.symbol}) — ${Date.now() - t0}ms\n${message}`);
      }
    }

    const totalMs = Date.now() - startedAt;
    const passed = results.filter((r) => r.ok).length;
    // eslint-disable-next-line no-console
    console.log(
      `\nMarkets integration suite: ${passed}/${results.length} scenarios passed in ${totalMs}ms${CAPTURE ? ' (CAPTURE mode)' : ''}.`,
    );
    if (passed !== results.length) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
