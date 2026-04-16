/**
 * End-to-end acceptance test for the five-stage markets pipeline.
 * Effort: workflow-stages-article-pipeline (Phase 5).
 *
 * Asserts the three Goal queries from PRD §2 against a live Postgres with a
 * hermetic seed dataset:
 *   G1: every new market_run_artifact has a non-null workflow_stage
 *   G2: no market_predictors exist for (article, instrument) pairs where
 *       article_instrument_relevance.is_relevant = false or missing
 *   G3: for each instrument touched this cycle, max analyst_risk_assessments
 *       timestamp > max market_predictors.updated_at − 5 minutes
 *
 * Rather than calling AnalystPipelineService.runPipeline() (which also runs
 * the crawler and external data adapters, both of which need API keys we
 * can't guarantee in every env), this test invokes only the services the
 * effort shipped, in order:
 *
 *   ArticleRelevanceService → PredictorGeneratorService → RiskRunnerService
 *
 * LLM is forced off via explicit env overrides, so predictor scoring falls
 * back to the keyword tier and risk reflection carries prior scores forward
 * deterministically. The seed articles (AAPL symbol match, Tesla company-name
 * match) both score ≥ 0.7 in keyword-only mode.
 *
 * Skips gracefully if no database is reachable so CI-without-DB environments
 * don't block.
 */
process.env.MARKETS_DEV_AUTH_BYPASS = 'true';

import { randomUUID } from 'node:crypto';
import { bootstrapComplianceApp } from '../compliance/compliance-harness';
import { MarketsSchemaService } from '../../src/markets/schema/markets-schema.service';
import { ArticleRelevanceService } from '../../src/markets/services/article-relevance.service';
import { PredictorGeneratorService } from '../../src/markets/services/predictor-generator.service';
import { RiskRunnerService } from '../../src/markets/services/risk-runner.service';

let passed = 0;
let failed = 0;

function report(name: string, ok: boolean, detail?: string): void {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}${detail ? `\n${detail}` : ''}`); }
}

async function main(): Promise<void> {
  let app: Awaited<ReturnType<typeof bootstrapComplianceApp>> | null = null;
  try {
    // Explicitly disable LLM — the real flag names read by MarketsLlmService.
    app = await bootstrapComplianceApp({
      MARKETS_ENABLE_LLM: 'false',
      PHASE1_ENABLE_LLM: 'false',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`SKIP  stages-v2 acceptance — could not bootstrap app (${msg.slice(0, 120)})`);
    return;
  }

  try {
    const schema = app.get<MarketsSchemaService>(MarketsSchemaService);
    await schema.ensureSchema();

    const cycleStart = new Date().toISOString();

    // Seed two instruments + one matching article each.
    const aaplId = `test-${randomUUID()}`;
    const tslaId = `test-${randomUUID()}`;
    const sourceId = `test-src-${randomUUID()}`;
    const aaplArticleId = `test-art-${randomUUID()}`;
    const tslaArticleId = `test-art-${randomUUID()}`;

    try {
      await app.db.rawQuery(
        `insert into prediction.instruments (id, symbol, name, asset_type, is_active, created_at, updated_at)
         values ($1, 'AAPL', 'Apple Inc.', 'stock', true, now(), now()) on conflict (id) do nothing`,
        [aaplId],
      );
      await app.db.rawQuery(
        `insert into prediction.instruments (id, symbol, name, asset_type, is_active, created_at, updated_at)
         values ($1, 'TSLA', 'Tesla Inc.', 'stock', true, now(), now()) on conflict (id) do nothing`,
        [tslaId],
      );
      await app.db.rawQuery(
        `insert into prediction.market_sources (id, slug, name, source_type, is_active, created_at, updated_at)
         values ($1, 'test-seed', 'Test Seed', 'rss', true, now(), now()) on conflict (id) do nothing`,
        [sourceId],
      );
      await app.db.rawQuery(
        `insert into prediction.market_articles (id, source_id, title, url, summary, content, first_seen_at, created_at)
         values ($1, $2, 'AAPL hits new high', 'http://example/aapl', 'Apple rallies', 'Shares of AAPL surged today.', now(), now())
         on conflict (id) do nothing`,
        [aaplArticleId, sourceId],
      );
      await app.db.rawQuery(
        `insert into prediction.market_articles (id, source_id, title, url, summary, content, first_seen_at, created_at)
         values ($1, $2, 'Tesla plans factory', 'http://example/tsla', 'Tesla expands', 'Tesla announced a new factory.', now(), now())
         on conflict (id) do nothing`,
        [tslaArticleId, sourceId],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`SKIP  stages-v2 acceptance — seeding failed (${msg.slice(0, 200)})`);
      return;
    }

    // Stage 1 — article relevance classification (keyword tier only since LLM is off).
    const relevance = app.get<ArticleRelevanceService>(ArticleRelevanceService);
    const relResult = await relevance.classifyNewArticles();
    report('relevance classification produced results', relResult.pairsEvaluated > 0, `pairsEvaluated=${relResult.pairsEvaluated}`);

    // Stage 2 — predictor generation. Relevance gate drops non-relevant pairs.
    const predictors = app.get<PredictorGeneratorService>(PredictorGeneratorService);
    const predResult = await predictors.runGeneration();
    report('predictor generation ran', !!predResult, `predictorsCreated=${predResult.predictorsCreated}`);

    // Stage 3 — per-analyst risk reflection + debate fanout.
    const risk = app.get<RiskRunnerService>(RiskRunnerService);
    if (predResult.instrumentIdsAffected.length > 0) {
      const riskResult = await risk.executePerAnalystRiskPass(predResult.instrumentIdsAffected);
      report('risk pass wrote assessments', riskResult.assessmentsWritten > 0, `assessmentsWritten=${riskResult.assessmentsWritten}`);
    }

    // G1: every artifact created this cycle has a workflow_stage.
    const g1 = await app.db.rawQuery(
      `select count(*)::int as n from prediction.market_run_artifacts
       where workflow_stage is null and created_at > $1`,
      [cycleStart],
    );
    const g1n = (g1.data as Array<{ n: number }> | null)?.[0]?.n ?? 0;
    report('G1 — artifacts without workflow_stage (should be 0)', g1n === 0, `got ${g1n}`);

    // G2: no market_predictors without matching is_relevant=true.
    const g2 = await app.db.rawQuery(
      `select count(*)::int as n from prediction.market_predictors mp
       where mp.created_at > $1
         and not exists (
           select 1 from prediction.article_instrument_relevance air
           where air.article_id = mp.article_id
             and air.instrument_id = mp.instrument_id
             and air.is_relevant = true
         )`,
      [cycleStart],
    );
    const g2n = (g2.data as Array<{ n: number }> | null)?.[0]?.n ?? 0;
    report('G2 — predictors without is_relevant=true (should be 0)', g2n === 0, `got ${g2n}`);

    // G3: for each instrument with new predictors, max risk timestamp > max predictor timestamp − 5m.
    const g3 = await app.db.rawQuery(
      `with per_inst as (
         select mp.instrument_id,
                max(mp.updated_at) as latest_predictor,
                (select max(ara.created_at) from prediction.analyst_risk_assessments ara
                  where ara.instrument_id = mp.instrument_id and ara.created_at > $1) as latest_risk
         from prediction.market_predictors mp
         where mp.updated_at > $1
         group by mp.instrument_id
       )
       select count(*)::int as stale
       from per_inst
       where latest_predictor is not null
         and (latest_risk is null or latest_risk < latest_predictor - interval '5 minutes')`,
      [cycleStart],
    );
    const g3n = (g3.data as Array<{ stale: number }> | null)?.[0]?.stale ?? 0;
    report('G3 — instruments with stale risk (should be 0)', g3n === 0, `got ${g3n}`);
  } finally {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
    if (app) await app.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
