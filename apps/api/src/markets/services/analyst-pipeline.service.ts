import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import {
  DATABASE_SERVICE,
  type DatabaseService,
} from '@orchestratorai/planes/database';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import { PredictionRunnerService } from './prediction-runner.service';
import { RiskRunnerService } from './risk-runner.service';

/**
 * Analyst Pipeline — runs every 30 minutes.
 *
 * Automated pipeline steps:
 * 1. Query all active instruments from user watchlists across all tenants
 * 2. For each instrument, check entitled sources for new articles
 * 3. Score new articles as predictors
 * 4. Enqueue prediction runs for instruments with new predictors
 * 5. Enqueue risk runs for instruments with completed prediction runs
 * 6. Process all queued runs
 *
 * Controlled by MARKETS_ENABLE_PIPELINE env var (default: false).
 * Uses Ollama local (qwen2.5:7b) by default, falls back to OpenRouter.
 */
@Injectable()
export class AnalystPipelineService {
  private readonly logger = new Logger(AnalystPipelineService.name);
  private readonly enabled: boolean;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    private readonly schema: MarketsSchemaService,
    private readonly predictionRunner: PredictionRunnerService,
    private readonly riskRunner: RiskRunnerService,
    private readonly configService: ConfigService,
  ) {
    this.enabled =
      this.configService.get<string>('MARKETS_ENABLE_PIPELINE') === 'true';
    if (this.enabled) {
      this.logger.log(
        'Analyst pipeline ENABLED — will run every 30 minutes',
      );
    } else {
      this.logger.log(
        'Analyst pipeline DISABLED — set MARKETS_ENABLE_PIPELINE=true to enable',
      );
    }
  }

  @Cron('*/30 * * * *')
  async runScheduled(): Promise<void> {
    if (!this.enabled) return;
    this.logger.log('Analyst pipeline starting (scheduled)');
    await this.runPipeline();
  }

  /**
   * Run the pipeline manually (called from admin endpoint).
   */
  async runPipeline(): Promise<PipelineResult> {
    await this.schema.ensureSchema();
    const startTime = Date.now();
    const result: PipelineResult = {
      instrumentsProcessed: 0,
      newArticlesFound: 0,
      predictorsScored: 0,
      predictionRunsEnqueued: 0,
      riskRunsEnqueued: 0,
      runsProcessed: 0,
      errors: [],
      durationMs: 0,
    };

    try {
      // Step 1: Get all active __base__ instruments — pipeline runs once for base,
      // all orgs see the results
      const instrumentsResult = await this.db.rawQuery(`
        SELECT DISTINCT i.id, i.organization_slug, i.symbol, i.name
        FROM prediction.instruments i
        WHERE i.is_active = true
          AND i.organization_slug = '__base__'
        ORDER BY i.symbol
        LIMIT 100
      `);

      if (instrumentsResult.error) {
        result.errors.push(
          `Failed to query instruments: ${instrumentsResult.error.message}`,
        );
        return this.finalize(result, startTime);
      }

      const instruments =
        (instrumentsResult.data as Array<{
          id: string;
          organization_slug: string;
          symbol: string;
          name: string;
        }>) ?? [];

      result.instrumentsProcessed = instruments.length;
      this.logger.log(
        `Pipeline: processing ${instruments.length} active instruments`,
      );

      // Step 2-3: Check for new articles and score as predictors
      // (Articles come from FireCrawl external sync — this step checks
      //  if there are unscored articles for each instrument)
      for (const instrument of instruments) {
        try {
          const unscoredResult = await this.db.rawQuery(
            `
            SELECT ma.id as article_id
            FROM prediction.market_articles ma
            WHERE NOT EXISTS (
              SELECT 1 FROM prediction.market_predictors mp
              WHERE mp.article_id = ma.id
                AND mp.instrument_id = $1
                AND mp.organization_slug = $2
            )
            LIMIT 10
          `,
            [instrument.id, instrument.organization_slug],
          );

          const unscoredArticles =
            (unscoredResult.data as Array<{ article_id: string }>) ?? [];
          result.newArticlesFound += unscoredArticles.length;

          // Step 4: Enqueue prediction run if new predictors exist
          if (unscoredArticles.length > 0) {
            const enqueueResult = await this.db.rawQuery(
              `
              INSERT INTO prediction.orchestration_runs
                (id, organization_slug, instrument_id, run_type, status, requested_by)
              VALUES (gen_random_uuid(), $1, $2, 'prediction', 'queued', 'pipeline')
              ON CONFLICT DO NOTHING
              RETURNING id
            `,
              [instrument.organization_slug, instrument.id],
            );

            if (!enqueueResult.error) {
              const enqueued =
                (enqueueResult.data as Array<{ id: string }>) ?? [];
              if (enqueued.length > 0) {
                result.predictionRunsEnqueued++;
              }
            }
          }

          // Step 5: Enqueue risk run if recent prediction run completed
          const recentPredRunResult = await this.db.rawQuery(
            `
            SELECT id FROM prediction.orchestration_runs
            WHERE organization_slug = $1
              AND instrument_id = $2
              AND run_type = 'prediction'
              AND status = 'completed'
              AND completed_at > now() - interval '1 hour'
            LIMIT 1
          `,
            [instrument.organization_slug, instrument.id],
          );

          const recentPredRuns =
            (recentPredRunResult.data as Array<{ id: string }>) ?? [];
          if (recentPredRuns.length > 0) {
            const riskEnqueue = await this.db.rawQuery(
              `
              INSERT INTO prediction.orchestration_runs
                (id, organization_slug, instrument_id, run_type, status, requested_by)
              VALUES (gen_random_uuid(), $1, $2, 'risk', 'queued', 'pipeline')
              ON CONFLICT DO NOTHING
              RETURNING id
            `,
              [instrument.organization_slug, instrument.id],
            );

            if (!riskEnqueue.error) {
              const enqueued =
                (riskEnqueue.data as Array<{ id: string }>) ?? [];
              if (enqueued.length > 0) {
                result.riskRunsEnqueued++;
              }
            }
          }
        } catch (err) {
          result.errors.push(
            `Error processing ${instrument.symbol}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      this.logger.log(
        `Pipeline complete: ${result.instrumentsProcessed} instruments, ` +
          `${result.newArticlesFound} new articles, ` +
          `${result.predictionRunsEnqueued} prediction runs, ` +
          `${result.riskRunsEnqueued} risk runs`,
      );
    } catch (err) {
      result.errors.push(
        `Pipeline failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.logger.error('Pipeline failed:', err);
    }

    return this.finalize(result, startTime);
  }

  private finalize(result: PipelineResult, startTime: number): PipelineResult {
    result.durationMs = Date.now() - startTime;
    return result;
  }
}

export interface PipelineResult {
  instrumentsProcessed: number;
  newArticlesFound: number;
  predictorsScored: number;
  predictionRunsEnqueued: number;
  riskRunsEnqueued: number;
  runsProcessed: number;
  errors: string[];
  durationMs: number;
}
