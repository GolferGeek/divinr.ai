import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MarketsService } from '../../src/markets/markets.service';
import {
  bootstrapComplianceApp,
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

async function waitForDedupEvidence(
  app: { db: { rawQuery: (sql: string, params: unknown[]) => Promise<{ error: { message: string } | null; data: unknown }> } },
  organizationSlug: string,
  runId: string,
): Promise<number> {
  for (let i = 0; i < 20; i += 1) {
    const result = await app.db.rawQuery(
      `
      select id
      from public.observability_events
      where source_app = 'divinr-api'
        and hook_event_type = 'markets.orchestration.deduplicated'
        and organization_slug = $1
        and payload->>'runId' = $2
      order by id desc
      limit 1
      `,
      [organizationSlug, runId],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    const rows = (result.data as Array<{ id: number }> | null) ?? [];
    if (rows.length === 1) {
      return rows[0].id;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return 0;
}

async function seedExternalCrawlerData(
  app: { db: { rawQuery: (sql: string, params?: unknown[]) => Promise<{ error: { message: string } | null; data: unknown }> } },
  organizationSlug: string,
): Promise<{ externalSourceId: string; externalArticleId: string; externalOrganizationSlug: string }> {
  const externalSourceId = '11111111-1111-4111-8111-111111111111';
  const externalArticleId = '22222222-2222-4222-8222-222222222222';
  let externalOrganizationSlug = organizationSlug;
  const orgLookup = await app.db.rawQuery(
    `
    select slug
    from public.organizations
    order by slug asc
    limit 1
    `,
  );
  if (!orgLookup.error) {
    const found = ((orgLookup.data as Array<{ slug: string }> | null) ?? [])[0];
    if (found?.slug) {
      externalOrganizationSlug = found.slug;
    }
  }
  const setupStatements = [
    'create schema if not exists crawler',
    `
    create table if not exists crawler.sources (
      id uuid primary key,
      organization_slug text not null,
      name text not null,
      source_type text not null,
      url text not null,
      is_active boolean not null default true,
      is_test boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
    `,
    `
    create table if not exists crawler.articles (
      id uuid primary key,
      organization_slug text not null,
      source_id uuid not null references crawler.sources(id) on delete cascade,
      url text not null,
      title text,
      content text,
      summary text,
      author text,
      published_at timestamptz,
      content_hash text not null,
      first_seen_at timestamptz not null default now(),
      metadata jsonb default '{}'::jsonb,
      is_test boolean not null default false
    )
    `,
  ];
  for (const statement of setupStatements) {
    const setup = await app.db.rawQuery(statement);
    if (setup.error) {
      throw new Error(setup.error.message);
    }
  }

  const sourceSeed = await app.db.rawQuery(
    `
    insert into crawler.sources
      (id, organization_slug, name, source_type, url, is_active, is_test, updated_at)
    values
      ($1::uuid, $2, 'Orchestrator Demo Feed', 'rss', 'https://demo-feed.example/rss', true, false, now())
    on conflict (id)
    do update set
      organization_slug = excluded.organization_slug,
      name = excluded.name,
      source_type = excluded.source_type,
      url = excluded.url,
      is_active = excluded.is_active,
      is_test = excluded.is_test,
      updated_at = excluded.updated_at;
    `,
    [externalSourceId, externalOrganizationSlug],
  );
  if (sourceSeed.error) {
    throw new Error(sourceSeed.error.message);
  }

  const articleSeed = await app.db.rawQuery(
    `
    insert into crawler.articles
      (id, organization_slug, source_id, url, title, content, summary, author, published_at, content_hash, first_seen_at, metadata, is_test)
    values
      (
        $3::uuid,
        $2,
        $1::uuid,
        'https://demo-feed.example/article-1',
        'Demo external article',
        'External crawler content',
        'External crawler summary',
        'Divinr Bot',
        now() - interval '2 hours',
        'external-content-hash-1',
        now() - interval '2 hours',
        '{"origin":"orchestrator"}'::jsonb,
        false
      )
    on conflict (id)
    do update set
      organization_slug = excluded.organization_slug,
      source_id = excluded.source_id,
      url = excluded.url,
      title = excluded.title,
      content = excluded.content,
      summary = excluded.summary,
      author = excluded.author,
      published_at = excluded.published_at,
      content_hash = excluded.content_hash,
      first_seen_at = excluded.first_seen_at,
      metadata = excluded.metadata,
      is_test = excluded.is_test;
    `,
    [externalSourceId, externalOrganizationSlug, externalArticleId],
  );
  if (articleSeed.error) {
    throw new Error(articleSeed.error.message);
  }
  return { externalSourceId, externalArticleId, externalOrganizationSlug };
}

async function main(): Promise<void> {
  const app = await bootstrapComplianceApp();
  const service = app.get<typeof MarketsService, MarketsService>(MarketsService);
  let seed: ComplianceSeed | null = null;

  const tests: TestCase[] = [
    {
      name: 'Create instrument and enqueue/get run',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const instrument = await service.createInstrument({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          symbol: 'AAPL',
          name: 'Apple Inc.',
          assetType: 'stock',
        });
        assert.equal(instrument.symbol, 'AAPL');
        assert.equal(instrument.organization_slug, seed.orgA);

        const queued = await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'risk',
        });
        assert.equal(queued.status, 'queued');

        const run = await service.getRun(seed.orgA, seed.adminUserId, queued.runId);
        assert.equal(run.run_type, 'risk');
        assert.equal(run.status, 'queued');

        const deduped = await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'risk',
        });
        assert.equal(deduped.runId, queued.runId);

        const dedupEvidenceId = await waitForDedupEvidence(
          app,
          seed.orgA,
          queued.runId,
        );
        assert.ok(dedupEvidenceId > 0);

        const queuedRuns = await service.listRuns({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          status: 'queued',
        });
        const matching = queuedRuns.filter(
          (r) =>
            r.instrument_id === instrument.id &&
            r.run_type === 'risk' &&
            r.status === 'queued',
        );
        assert.equal(matching.length, 1);
      },
    },
    {
      name: 'Run status transitions are persisted',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const instrument = await service.createInstrument({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          symbol: 'MSFT',
          name: 'Microsoft',
          assetType: 'stock',
        });
        const queued = await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'prediction',
        });

        const running = await service.updateRunStatus({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          runId: queued.runId,
          status: 'running',
        });
        assert.equal(running.previousStatus, 'queued');
        assert.equal(running.status, 'running');

        const completed = await service.updateRunStatus({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          runId: queued.runId,
          status: 'completed',
        });
        assert.equal(completed.previousStatus, 'running');
        assert.equal(completed.status, 'completed');

        await assert.rejects(
          () =>
            service.updateRunStatus({
              organizationSlug: seed.orgA,
              userId: seed.adminUserId,
              runId: queued.runId,
              status: 'running',
            }),
          BadRequestException,
        );

        const finalRun = await service.getRun(seed.orgA, seed.adminUserId, queued.runId);
        assert.ok(finalRun.started_at);
        assert.ok(finalRun.completed_at);
        assert.equal(finalRun.last_error, null);
      },
    },
    {
      name: 'Failed transitions persist error evidence',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const instrument = await service.createInstrument({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          symbol: 'IBM',
          name: 'IBM',
        });
        const queued = await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'prediction',
        });
        await service.updateRunStatus({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          runId: queued.runId,
          status: 'failed',
          errorMessage: 'model provider timeout',
        });

        const failedRun = await service.getRun(seed.orgA, seed.adminUserId, queued.runId);
        assert.equal(failedRun.status, 'failed');
        assert.equal(failedRun.last_error, 'model provider timeout');
        assert.ok(failedRun.completed_at);

        const another = await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'risk',
        });
        await assert.rejects(
          () =>
            service.updateRunStatus({
              organizationSlug: seed.orgA,
              userId: seed.adminUserId,
              runId: another.runId,
              status: 'failed',
            }),
          BadRequestException,
        );
      },
    },
    {
      name: 'Run listing is tenant-scoped and status-filtered',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const instrumentA = await service.createInstrument({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          symbol: 'NVDA',
          name: 'NVIDIA',
        });
        const runA = await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrumentA.id,
          runType: 'risk',
        });
        const runB = await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrumentA.id,
          runType: 'prediction',
        });

        await service.updateRunStatus({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          runId: runB.runId,
          status: 'running',
        });

        const orgARuns = await service.listRuns({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
        });
        assert.ok(orgARuns.some((r) => r.id === runA.runId));
        assert.ok(orgARuns.some((r) => r.id === runB.runId));

        const orgARunning = await service.listRuns({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          status: 'running',
        });
        assert.ok(orgARunning.some((r) => r.id === runB.runId));
        assert.ok(!orgARunning.some((r) => r.id === runA.runId));

        const orgBRuns = await service.listRuns({
          organizationSlug: seed.orgB,
          userId: seed.analystBUserId,
        });
        assert.ok(!orgBRuns.some((r) => r.organization_slug === seed.orgA));
      },
    },
    {
      name: 'Analyst assignment and source entitlement persistence works',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const instrument = await service.createInstrument({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          symbol: 'SHOP',
          name: 'Shopify',
        });
        const analyst = await service.createAnalyst({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          slug: 'momentum-analyst',
          displayName: 'Momentum Analyst',
          personaPrompt: 'Focus on momentum and trend persistence.',
        });
        await service.assignAnalystToInstrument({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          analystId: analyst.id,
        });

        const analysts = await service.listAnalysts(seed.orgA, seed.adminUserId);
        assert.ok(analysts.some((a) => a.id === analyst.id));

        const sources = await service.listEntitledSources(
          seed.orgA,
          seed.adminUserId,
        );
        assert.ok(sources.length > 0);
        const source = sources[0];
        const entitlement = await service.upsertSourceEntitlement({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          sourceId: source.id,
          isEnabled: false,
          overrideNotes: 'Tenant-specific override',
        });
        assert.equal(entitlement.is_enabled, false);
        assert.equal(entitlement.organization_slug, seed.orgA);
      },
    },
    {
      name: 'External crawler sources and articles can be synced into markets',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const previousEnabled = process.env.MARKETS_EXTERNAL_SYNC_ENABLED;
        const previousOrg = process.env.MARKETS_EXTERNAL_SYNC_ORG_SLUG;
        const previousSourceLimit = process.env.MARKETS_EXTERNAL_SOURCE_LIMIT;
        const previousArticleLimit = process.env.MARKETS_EXTERNAL_ARTICLE_LIMIT;
        const previousLookback = process.env.MARKETS_EXTERNAL_ARTICLE_LOOKBACK_DAYS;
        try {
          const externalSeed = await seedExternalCrawlerData(app, seed.orgA);
          process.env.MARKETS_EXTERNAL_SYNC_ENABLED = 'true';
          process.env.MARKETS_EXTERNAL_SYNC_ORG_SLUG = externalSeed.externalOrganizationSlug;
          process.env.MARKETS_EXTERNAL_SOURCE_LIMIT = '25';
          process.env.MARKETS_EXTERNAL_ARTICLE_LIMIT = '25';
          process.env.MARKETS_EXTERNAL_ARTICLE_LOOKBACK_DAYS = '30';

          const syncResult = await service.syncExternalCrawlerData({
            organizationSlug: seed.orgA,
            userId: seed.adminUserId,
          });
          assert.equal(syncResult.enabled, true);
          assert.equal(
            syncResult.externalOrganizationSlug,
            externalSeed.externalOrganizationSlug,
          );
          assert.ok(syncResult.sourceRowsProcessed >= 1);
          assert.ok(syncResult.articleRowsProcessed >= 1);

          const sources = await service.listEntitledSources(seed.orgA, seed.adminUserId);
          assert.ok(
            sources.some(
              (source) =>
                source.source_origin === 'orchestrator_crawler' &&
                source.external_source_id,
            ),
          );

          const articles = await service.listMarketArticles({
            organizationSlug: seed.orgA,
            userId: seed.adminUserId,
            limit: 10,
          });
          assert.ok(articles.length >= 1);
          assert.ok(
            articles.some(
              (article) =>
                article.source_origin === 'orchestrator_crawler' &&
                article.external_organization_slug === externalSeed.externalOrganizationSlug,
            ),
          );
        } finally {
          if (previousEnabled === undefined) {
            delete process.env.MARKETS_EXTERNAL_SYNC_ENABLED;
          } else {
            process.env.MARKETS_EXTERNAL_SYNC_ENABLED = previousEnabled;
          }
          if (previousOrg === undefined) {
            delete process.env.MARKETS_EXTERNAL_SYNC_ORG_SLUG;
          } else {
            process.env.MARKETS_EXTERNAL_SYNC_ORG_SLUG = previousOrg;
          }
          if (previousSourceLimit === undefined) {
            delete process.env.MARKETS_EXTERNAL_SOURCE_LIMIT;
          } else {
            process.env.MARKETS_EXTERNAL_SOURCE_LIMIT = previousSourceLimit;
          }
          if (previousArticleLimit === undefined) {
            delete process.env.MARKETS_EXTERNAL_ARTICLE_LIMIT;
          } else {
            process.env.MARKETS_EXTERNAL_ARTICLE_LIMIT = previousArticleLimit;
          }
          if (previousLookback === undefined) {
            delete process.env.MARKETS_EXTERNAL_ARTICLE_LOOKBACK_DAYS;
          } else {
            process.env.MARKETS_EXTERNAL_ARTICLE_LOOKBACK_DAYS = previousLookback;
          }
        }
      },
    },
    {
      name: 'Cross-tenant and permission checks deny unauthorized actions',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        await assert.rejects(
          () =>
            service.createInstrument({
              organizationSlug: seed.orgB,
              userId: seed.analystAUserId,
              symbol: 'TSLA',
            }),
          ForbiddenException,
        );
        await assert.rejects(
          () =>
            service.processNextQueuedRun({
              organizationSlug: seed.orgA,
              userId: seed.analystAUserId,
            }),
          ForbiddenException,
        );
      },
    },
    {
      name: 'Queued run processor completes next run deterministically',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const instrument = await service.createInstrument({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          symbol: 'META',
          name: 'Meta',
        });
        const queued = await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'risk',
        });

        const processed = await service.processNextQueuedRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
        });
        assert.equal(processed.processed, true);
        assert.equal(processed.status, 'completed');

        // Previous tests may leave queued runs in orgA.
        // Keep processing deterministically until our new run is completed.
        for (let i = 0; i < 10; i += 1) {
          const after = await service.getRun(seed.orgA, seed.adminUserId, queued.runId);
          if (after.status === 'completed') {
            break;
          }
          const next = await service.processNextQueuedRun({
            organizationSlug: seed.orgA,
            userId: seed.adminUserId,
          });
          assert.equal(next.processed, true);
        }

        const after = await service.getRun(seed.orgA, seed.adminUserId, queued.runId);
        assert.equal(after.status, 'completed');

        const evidence = await app.db.rawQuery(
          `
          select id
          from public.observability_events
          where source_app = 'divinr-api'
            and hook_event_type = 'markets.orchestration.processed'
            and organization_slug = $1
            and payload->>'runId' = $2
          order by id desc
          limit 1
          `,
          [seed.orgA, queued.runId],
        );
        if (evidence.error) {
          throw new Error(evidence.error.message);
        }
        const evidenceRows =
          (evidence.data as Array<{ id: number }> | null) ?? [];
        assert.equal(evidenceRows.length, 1);

        let noWork = await service.processNextQueuedRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
        });
        while (noWork.processed) {
          noWork = await service.processNextQueuedRun({
            organizationSlug: seed.orgA,
            userId: seed.adminUserId,
          });
        }
        assert.equal(noWork.processed, false);
      },
    },
    {
      name: 'Run evaluation and replay are tenant-isolated',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const instrument = await service.createInstrument({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          symbol: 'ADBE',
          name: 'Adobe',
        });
        const run = await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'prediction',
        });
        await service.processNextQueuedRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
        });

        const evaluation = await service.evaluateRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          runId: run.runId,
          actualDirection: 'up',
        });
        assert.equal(evaluation.organization_slug, seed.orgA);
        assert.equal(evaluation.run_id, run.runId);

        const replay = await service.replayRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          runId: run.runId,
          scenario: 'macro shock scenario',
        });
        assert.equal(replay.organization_slug, seed.orgA);
        assert.equal(replay.run_id, run.runId);

        const artifacts = await service.listRunArtifacts({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          runId: run.runId,
        });
        assert.ok(artifacts.length >= 1);

        const predictions = await service.listPredictionOutcomes({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          runId: run.runId,
        });
        assert.ok(predictions.length >= 1);

        const evaluations = await service.listRunEvaluations(
          seed.orgA,
          seed.adminUserId,
          run.runId,
        );
        assert.ok(evaluations.length >= 1);

        const replays = await service.listRunReplays(
          seed.orgA,
          seed.adminUserId,
          run.runId,
        );
        assert.ok(replays.length >= 1);

        await assert.rejects(
          () =>
            service.evaluateRun({
              organizationSlug: seed.orgB,
              userId: seed.analystBUserId,
              runId: run.runId,
              actualDirection: 'down',
            }),
          ForbiddenException,
        );
      },
    },
    {
      name: 'Parallel processors claim distinct queued runs',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const instrument = await service.createInstrument({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          symbol: 'GOOGL',
          name: 'Alphabet',
        });
        await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'risk',
        });
        await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'prediction',
        });

        const [first, second] = await Promise.all([
          service.processNextQueuedRun({
            organizationSlug: seed.orgA,
            userId: seed.adminUserId,
          }),
          service.processNextQueuedRun({
            organizationSlug: seed.orgA,
            userId: seed.adminUserId,
          }),
        ]);
        assert.equal(first.processed, true);
        assert.equal(second.processed, true);
        assert.ok(first.runId);
        assert.ok(second.runId);
        assert.notEqual(first.runId, second.runId);

        const pending = await service.listRuns({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          status: 'queued',
        });
        assert.equal(pending.length, 0);
      },
    },
    {
      name: 'Concurrent enqueue deduplicates to one queued run',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const instrument = await service.createInstrument({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          symbol: 'INTC',
          name: 'Intel',
        });
        const [first, second] = await Promise.all([
          service.enqueueRun({
            organizationSlug: seed.orgA,
            userId: seed.adminUserId,
            instrumentId: instrument.id,
            runType: 'prediction',
          }),
          service.enqueueRun({
            organizationSlug: seed.orgA,
            userId: seed.adminUserId,
            instrumentId: instrument.id,
            runType: 'prediction',
          }),
        ]);
        assert.equal(first.runId, second.runId);

        const queued = await service.listRuns({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          status: 'queued',
        });
        const matching = queued.filter(
          (r) =>
            r.instrument_id === instrument.id &&
            r.run_type === 'prediction' &&
            r.status === 'queued',
        );
        assert.equal(matching.length, 1);
      },
    },
    {
      name: 'Batch processor drains up to maxRuns',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const instrument = await service.createInstrument({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          symbol: 'NFLX',
          name: 'Netflix',
        });
        await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'risk',
        });
        await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'prediction',
        });
        await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'risk',
        });

        const batch = await service.processQueuedRuns({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          maxRuns: 2,
        });
        assert.equal(batch.requested, 2);
        assert.equal(batch.processedCount, 2);
        assert.equal(batch.results.length, 2);
        assert.ok(batch.results.every((r) => r.processed));

        const remaining = await service.listRuns({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          status: 'queued',
        });
        assert.equal(remaining.length, 1);
      },
    },
    {
      name: 'Concurrent status transition allows only one winner',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        const instrument = await service.createInstrument({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          symbol: 'ORCL',
          name: 'Oracle',
        });
        const queued = await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'risk',
        });

        const outcomes = await Promise.allSettled([
          service.updateRunStatus({
            organizationSlug: seed.orgA,
            userId: seed.adminUserId,
            runId: queued.runId,
            status: 'running',
          }),
          service.updateRunStatus({
            organizationSlug: seed.orgA,
            userId: seed.adminUserId,
            runId: queued.runId,
            status: 'running',
          }),
        ]);

        const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
        const rejected = outcomes.filter((o) => o.status === 'rejected');
        assert.equal(fulfilled.length, 1);
        assert.equal(rejected.length, 1);

        const run = await service.getRun(seed.orgA, seed.adminUserId, queued.runId);
        assert.equal(run.status, 'running');
      },
    },
    {
      name: 'Predictors and risk context feed prediction prompts',
      run: async () => {
        assert.ok(seed, 'seed data must be initialized');
        await service.listInstruments(seed.orgA, seed.adminUserId);

        const articleId = randomUUID();
        const externalArticleId = `ext-${randomUUID()}`;
        const externalSourceId = `src-${randomUUID()}`;
        const articleInsert = await app.db.rawQuery(
          `
          insert into prediction.market_articles
            (id, external_article_id, external_source_id, source_id, source_origin, external_organization_slug, title, url, summary, published_at, content_hash, first_seen_at, metadata, created_at, updated_at)
          values
            ($1, $2, $3, 'source_marketwatch', 'divinr', $4, 'Test predictor article', 'https://example.test/predictor-article', 'Brief summary', now(), 'hash-predictor', now(), '{}'::jsonb, now(), now())
          `,
          [articleId, externalArticleId, externalSourceId, seed.orgA],
        );
        if (articleInsert.error) {
          throw new Error(articleInsert.error.message);
        }

        const instrument = await service.createInstrument({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          symbol: 'PLTR',
          name: 'Palantir',
        });

        const predictor = await service.upsertPredictor({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          articleId,
          relevanceScore: 0.82,
          rationale: 'Macro headline aligns with sector view.',
        });
        assert.equal(predictor.article_id, articleId);
        assert.equal(predictor.status, 'active');

        const listed = await service.listPredictors({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
        });
        assert.ok(listed.some((p) => p.id === predictor.id));

        let drain = await service.processNextQueuedRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
        });
        let guard = 0;
        while (drain.processed && guard < 40) {
          guard += 1;
          drain = await service.processNextQueuedRun({
            organizationSlug: seed.orgA,
            userId: seed.adminUserId,
          });
        }

        const riskRun = await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'risk',
        });
        const predRun = await service.enqueueRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          instrumentId: instrument.id,
          runType: 'prediction',
        });

        const pr1 = await service.processNextQueuedRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
        });
        assert.equal(pr1.processed, true);
        assert.equal(pr1.runId, riskRun.runId);

        const pr2 = await service.processNextQueuedRun({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
        });
        assert.equal(pr2.processed, true);
        assert.equal(pr2.runId, predRun.runId);

        const artifacts = await service.listRunArtifacts({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          runId: predRun.runId,
        });
        assert.ok(artifacts.length >= 1);
        const prompt = artifacts[0].prompt;
        assert.ok(prompt.includes('Latest risk context'));
        assert.ok(prompt.includes('Active article predictors'));
        assert.ok(prompt.includes('Test predictor article'));

        const predictions = await service.listPredictionOutcomes({
          organizationSlug: seed.orgA,
          userId: seed.adminUserId,
          runId: predRun.runId,
        });
        assert.ok(predictions.length >= 1);
        assert.equal(predictions[0].analyst_id, null);
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
    console.log('\nMarkets smoke suite passed.');
  } catch (error) {
    fail('Markets smoke suite', error);
    process.exitCode = 1;
  } finally {
    if (seed) {
      await cleanupComplianceData(app.db, seed);
    }
    await app.close();
  }
}

void main();
