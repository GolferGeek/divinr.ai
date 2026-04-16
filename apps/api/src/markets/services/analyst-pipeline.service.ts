import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DATABASE_SERVICE,
  type DatabaseService,
} from '@orchestratorai/planes/database';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import { PredictionRunnerService } from './prediction-runner.service';
import { RiskRunnerService } from './risk-runner.service';
import { CrawlerService } from './crawler.service';
import { PredictorGeneratorService } from './predictor-generator.service';
import { PredictionGeneratorService } from './prediction-generator.service';
import { OutcomeTrackingService } from './outcome-tracking.service';
import { AffinityService } from './affinity.service';
import { FearGreedAlertService } from './fear-greed-alert.service';
import { ArticleRelevanceService } from './article-relevance.service';

/**
 * Analyst Pipeline — runs every 30 minutes.
 *
 * Five-stage flow (per PRD §4.1 of workflow-stages-article-pipeline):
 * 1. Crawl new articles
 * 2. Stage 1 — Article Processing: instrument-keyed relevance (keyword +
 *    optional LLM) writes `article_instrument_relevance` without analyst fanout.
 * 3. Stage 2 — Predictor Generation: per-analyst article scoring gated by
 *    Stage 1; creates `market_predictors` only for relevant (article,
 *    instrument) pairs.
 * 4. (Fear/greed alert evaluation — unchanged side effect)
 * 5. Stage 3 — Risk Assessment: per-analyst reflection (3a) then Blue/Red/
 *    Arbiter debate (3b) per instrument whose predictors moved this cycle.
 * 6. Stage 4 — Prediction Generation: reads just-written risk rows; logs a
 *    warning if risk is stale relative to predictors.
 * 7. (Contrarian alerts — unchanged side effect)
 * 8. Outcome tracking
 * 9. Stage 5 — Learning (downstream outcome evaluation; already post-outcome).
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
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
    @Inject(PredictionRunnerService) private readonly predictionRunner: PredictionRunnerService,
    @Inject(RiskRunnerService) private readonly riskRunner: RiskRunnerService,
    @Inject(CrawlerService) private readonly crawlerService: CrawlerService,
    @Inject(PredictorGeneratorService) private readonly predictorGenerator: PredictorGeneratorService,
    @Inject(PredictionGeneratorService) private readonly predictionGenerator: PredictionGeneratorService,
    @Inject(OutcomeTrackingService) private readonly outcomeTracking: OutcomeTrackingService,
    @Inject(AffinityService) private readonly affinityService: AffinityService,
    @Inject(FearGreedAlertService) private readonly fearGreedAlertService: FearGreedAlertService,
    @Inject(ArticleRelevanceService) private readonly articleRelevance: ArticleRelevanceService,
  ) {
    this.enabled = process.env.MARKETS_ENABLE_PIPELINE === 'true';
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
   * Run the full integrated pipeline manually (called from admin endpoint).
   *
   * Unified pipeline flow:
   * 1. Crawl articles
   * 2. Per-analyst article scoring (5 scores per article)
   * 3. Signal-based prediction generation (triggers runs when threshold met)
   * 4. Outcome tracking
   * 5. Log pipeline metrics
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
      // Step 1: Crawl new articles
      this.logger.log('Pipeline Step 1: Crawling articles');
      const crawlStart = Date.now();
      try {
        const crawlResult = await this.crawlerService.runCrawl();
        result.newArticlesFound = crawlResult.articlesNew;
        this.logger.log(`Crawl: ${crawlResult.articlesNew} new articles (${Date.now() - crawlStart}ms)`);
      } catch (err) {
        result.errors.push(`Crawl failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Step 1a: Article relevance classification (Stage 1)
      this.logger.log('Pipeline Step 1a: Article relevance classification');
      const relStart = Date.now();
      try {
        const relResult = await this.articleRelevance.classifyNewArticles();
        result.relevancePairsEvaluated = relResult.pairsEvaluated;
        result.relevancePairsRelevant = relResult.relevantPairs;
        this.logger.log(`Relevance: ${relResult.pairsEvaluated} pairs, ${relResult.relevantPairs} relevant (${Date.now() - relStart}ms)`);
      } catch (err) {
        result.errors.push(`Article relevance failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Step 2: Per-analyst article scoring
      this.logger.log('Pipeline Step 2: Per-analyst article scoring');
      const scoringStart = Date.now();
      let instrumentIdsAffected: string[] = [];
      try {
        const scoringResult = await this.predictorGenerator.runGeneration();
        result.predictorsScored = scoringResult.predictorsCreated;
        result.instrumentsProcessed = scoringResult.instrumentsAffected;
        instrumentIdsAffected = scoringResult.instrumentIdsAffected;
        this.logger.log(`Scoring: ${scoringResult.predictorsCreated} predictors created (${Date.now() - scoringStart}ms)`);
      } catch (err) {
        result.errors.push(`Scoring failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Step 2c: Per-analyst risk reflection + Stage 3b debate (Stage 3)
      if (instrumentIdsAffected.length > 0) {
        this.logger.log('Pipeline Step 2c: Per-analyst risk assessment');
        const riskStart = Date.now();
        try {
          const riskResult = await this.riskRunner.executePerAnalystRiskPass(instrumentIdsAffected);
          result.riskAssessmentsWritten = riskResult.assessmentsWritten;
          result.debatesRun = riskResult.debatesRun;
          this.logger.log(`Risk pass: ${riskResult.assessmentsWritten} assessments, ${riskResult.debatesRun} debates (${Date.now() - riskStart}ms)`);
          if (riskResult.errors.length > 0) {
            for (const e of riskResult.errors) result.errors.push(`Risk pass: ${e}`);
          }
        } catch (err) {
          result.errors.push(`Risk pass failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Step 2b: Fear/greed alert evaluation on recently scored predictors
      if (result.predictorsScored > 0) {
        try {
          const fgStart = Date.now();
          const fgAlerts = await this.fearGreedAlertService.evaluateRecentPredictors();
          if (fgAlerts > 0) {
            this.logger.log(`Fear/greed: ${fgAlerts} alerts generated (${Date.now() - fgStart}ms)`);
          }
        } catch (err) {
          result.errors.push(`Fear/greed alerts failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Step 3: Signal-based prediction generation (includes risk runs)
      this.logger.log('Pipeline Step 3: Signal-based prediction + risk generation');
      const predStart = Date.now();
      try {
        const predResult = await this.predictionGenerator.runGeneration();
        result.predictionRunsEnqueued = predResult.runsTriggered;
        result.runsProcessed = predResult.runsTriggered;
        this.logger.log(`Predictions: ${predResult.runsTriggered} runs triggered (${Date.now() - predStart}ms)`);
      } catch (err) {
        result.errors.push(`Prediction generation failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Step 3b: Generate contrarian alerts for users with affinity data
      if (result.runsProcessed > 0) {
        try {
          await this.generateContrarianAlertsForRecentRuns();
        } catch (err) {
          result.errors.push(`Contrarian alerts failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Step 4: Outcome tracking
      this.logger.log('Pipeline Step 4: Outcome tracking');
      const outcomeStart = Date.now();
      try {
        const outcomeResult = await this.outcomeTracking.runTracking();
        this.logger.log(`Outcomes: ${outcomeResult.snapshotsCaptured} snapshots, ${outcomeResult.predictionsResolved} resolved (${Date.now() - outcomeStart}ms)`);
      } catch (err) {
        result.errors.push(`Outcome tracking failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const totalDuration = Date.now() - startTime;
      this.logger.log(
        `Pipeline complete: ${result.instrumentsProcessed} instruments, ` +
          `${result.newArticlesFound} new articles, ` +
          `${result.predictorsScored} predictors, ` +
          `${result.predictionRunsEnqueued} prediction runs, ` +
          `${totalDuration}ms total`,
      );
    } catch (err) {
      result.errors.push(
        `Pipeline failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.logger.error('Pipeline failed:', err);
    }

    return this.finalize(result, startTime);
  }

  /**
   * After new predictions are generated, check for contrarian alerts
   * for all users who have affinity data.
   */
  private async generateContrarianAlertsForRecentRuns(): Promise<void> {
    // Get runs created in the last hour (covers this pipeline cycle)
    const runsResult = await this.db.rawQuery(
      `select distinct run_id from prediction.market_predictions
       where created_at > now() - interval '1 hour' and role = 'analyst'`,
    );
    const runs = (runsResult.data as Array<{ run_id: string }> | null) ?? [];
    if (runs.length === 0) return;

    // Get users with affinity data
    const usersResult = await this.db.rawQuery(
      `select distinct user_id from prediction.user_analyst_affinity`,
    );
    const users = (usersResult.data as Array<{ user_id: string }> | null) ?? [];
    if (users.length === 0) return;

    let totalAlerts = 0;
    for (const user of users) {
      for (const run of runs) {
        try {
          totalAlerts += await this.affinityService.generateContrarianAlerts(user.user_id, run.run_id);
        } catch {
          // Skip failures for individual user/run combos
        }
      }
    }

    if (totalAlerts > 0) {
      this.logger.log(`Contrarian alerts: ${totalAlerts} generated across ${users.length} users`);
    }
  }

  private finalize(result: PipelineResult, startTime: number): PipelineResult {
    result.durationMs = Date.now() - startTime;
    return result;
  }
}

export interface PipelineResult {
  instrumentsProcessed: number;
  newArticlesFound: number;
  relevancePairsEvaluated?: number;
  relevancePairsRelevant?: number;
  predictorsScored: number;
  riskAssessmentsWritten?: number;
  debatesRun?: number;
  predictionRunsEnqueued: number;
  riskRunsEnqueued: number;
  runsProcessed: number;
  errors: string[];
  durationMs: number;
}
