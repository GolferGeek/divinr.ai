import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DATABASE_SERVICE,
  type DatabaseService,
} from '@orchestratorai/planes/database';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { PredictionRunnerService } from './prediction-runner.service';

interface InstrumentWithPredictors {
  instrument_id: string;
  organization_slug: string;
  symbol: string;
  name: string;
  active_predictor_count: number;
  avg_relevance: number;
  dominant_direction?: string;
}

interface ThresholdConfig {
  minPredictors: number;
  minAvgRelevance: number;
  maxRunAgeMinutes: number;
}

interface PredictionGenResult {
  instrumentsEvaluated: number;
  runsTriggered: number;
  thresholdsNotMet: number;
  alreadyQueued: number;
  errors: string[];
}

/**
 * PredictionGeneratorService — Evaluates predictor thresholds per instrument
 * and triggers prediction runs when sufficient signal exists.
 *
 * Schedule: Every 30 minutes
 * Disable: MARKETS_DISABLE_PREDICTION_GENERATION=true
 *
 * Flow:
 * 1. Get instruments with active predictors and their predictor stats
 * 2. Evaluate threshold (min predictor count, min avg relevance)
 * 3. Skip if a recent run already exists for this instrument
 * 4. Enqueue and process a prediction run via PredictionRunnerService
 */
@Injectable()
export class PredictionGeneratorService {
  private readonly logger = new Logger(PredictionGeneratorService.name);
  private isRunning = false;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ObservabilityEventsService) private readonly observability: ObservabilityEventsService,
    private readonly predictionRunner: PredictionRunnerService,
  ) {}

  private emit(type: string, message: string, data?: Record<string, unknown>): void {
    this.observability.push({
      context: { conversationId: 'pipeline', userId: 'system', agentSlug: 'prediction-generator' } as never,
      source_app: 'divinr-api',
      hook_event_type: `pipeline.prediction.${type}`,
      status: type === 'error' ? 'error' : 'running',
      message,
      progress: null,
      step: null,
      payload: data ?? {},
      timestamp: Date.now(),
    }).catch(() => {});
  }

  private isDisabled(): boolean {
    return process.env.MARKETS_DISABLE_PREDICTION_GENERATION === 'true';
  }

  private getThresholdConfig(): ThresholdConfig {
    return {
      minPredictors: parseInt(process.env.MARKETS_MIN_PREDICTORS || '0', 10),
      minAvgRelevance: parseFloat(process.env.MARKETS_MIN_AVG_RELEVANCE || '0'),
      maxRunAgeMinutes: parseInt(process.env.MARKETS_MAX_RUN_AGE_MINUTES || '60', 10),
    };
  }

  /**
   * Scheduled prediction generation — every 30 minutes
   */
  @Cron('*/30 * * * *')
  async scheduledGeneration(): Promise<void> {
    if (this.isDisabled()) return;
    await this.runGeneration();
  }

  /**
   * Run a full prediction generation cycle.
   */
  async runGeneration(): Promise<PredictionGenResult> {
    if (this.isRunning) {
      this.logger.warn('Skipping prediction generation — previous run still in progress');
      return { instrumentsEvaluated: 0, runsTriggered: 0, thresholdsNotMet: 0, alreadyQueued: 0, errors: [] };
    }

    this.isRunning = true;
    const startTime = Date.now();
    const config = this.getThresholdConfig();
    const errors: string[] = [];
    let runsTriggered = 0;
    let thresholdsNotMet = 0;
    let alreadyQueued = 0;

    try {
      // Get instruments with their active predictor stats
      const instruments = await this.getInstrumentsWithPredictorStats();
      if (instruments.length === 0) {
        this.logger.debug('No instruments with active predictors');
        return { instrumentsEvaluated: 0, runsTriggered: 0, thresholdsNotMet: 0, alreadyQueued: 0, errors: [] };
      }

      this.logger.log(
        `Evaluating ${instruments.length} instruments for prediction generation ` +
          `(threshold: ${config.minPredictors} predictors, ${config.minAvgRelevance} avg relevance)`,
      );

      for (const inst of instruments) {
        try {
          // Check threshold
          if (
            inst.active_predictor_count < config.minPredictors ||
            inst.avg_relevance < config.minAvgRelevance
          ) {
            thresholdsNotMet++;
            this.logger.debug(
              `Threshold not met for ${inst.symbol}: ` +
                `${inst.active_predictor_count} predictors (need ${config.minPredictors}), ` +
                `avg relevance ${inst.avg_relevance.toFixed(2)} (need ${config.minAvgRelevance})`,
            );
            continue;
          }

          // Check if a recent run already exists
          const hasRecentRun = await this.hasRecentRun(
            inst.organization_slug,
            inst.instrument_id,
            config.maxRunAgeMinutes,
          );

          if (hasRecentRun) {
            alreadyQueued++;
            this.logger.debug(`Skipping ${inst.symbol} — recent run exists`);
            continue;
          }

          // Enqueue and process a prediction run
          const runId = await this.enqueueRun(inst.organization_slug, inst.instrument_id);
          if (runId) {
            this.emit('run.started', `Prediction run for ${inst.symbol} (${inst.active_predictor_count} predictors, relevance: ${inst.avg_relevance.toFixed(2)})`, { symbol: inst.symbol, predictorCount: inst.active_predictor_count, avgRelevance: inst.avg_relevance });
            await this.processRun(runId, inst.organization_slug);
            runsTriggered++;
            this.emit('run.complete', `${inst.symbol} prediction complete`, { symbol: inst.symbol, runId });
            this.logger.log(
              `Triggered prediction run ${runId} for ${inst.symbol} ` +
                `(${inst.active_predictor_count} predictors, avg relevance ${inst.avg_relevance.toFixed(2)})`,
            );
          }
        } catch (err) {
          const msg = `Error generating prediction for ${inst.symbol}: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(msg);
          this.logger.error(msg);
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Prediction generation complete: ${instruments.length} evaluated, ` +
          `${runsTriggered} runs triggered, ${thresholdsNotMet} below threshold, ` +
          `${alreadyQueued} skipped (recent), ${errors.length} errors (${duration}ms)`,
      );

      return {
        instrumentsEvaluated: instruments.length,
        runsTriggered,
        thresholdsNotMet,
        alreadyQueued,
        errors,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get all active __base__ instruments with aggregated predictor stats.
   * Pipeline runs against base instruments; all orgs see the results.
   */
  private async getInstrumentsWithPredictorStats(): Promise<InstrumentWithPredictors[]> {
    const result = await this.db.rawQuery(
      `
      select
        i.id as instrument_id,
        i.organization_slug,
        i.symbol,
        i.name,
        count(mp.id)::int as active_predictor_count,
        coalesce(avg(mp.relevance_score), 0)::float as avg_relevance
      from prediction.instruments i
      left join prediction.market_predictors mp
        on mp.instrument_id = i.id
        and mp.organization_slug = '__base__'
        and mp.status = 'active'
      where i.is_active = true
        and i.organization_slug = '__base__'
      group by i.id, i.organization_slug, i.symbol, i.name
      order by count(mp.id) desc
      `,
    );
    if (result.error) {
      this.logger.error(`Failed to query instrument predictor stats: ${result.error.message}`);
      return [];
    }
    return (result.data as InstrumentWithPredictors[] | null) ?? [];
  }

  /**
   * Check if a recent prediction run already exists for this instrument.
   */
  private async hasRecentRun(
    organizationSlug: string,
    instrumentId: string,
    maxAgeMinutes: number,
  ): Promise<boolean> {
    const result = await this.db.rawQuery(
      `
      select 1 from prediction.orchestration_runs
      where organization_slug = $1
        and instrument_id = $2
        and run_type = 'prediction'
        and status in ('queued', 'running', 'completed')
        and created_at > now() - ($3 || ' minutes')::interval
      limit 1
      `,
      [organizationSlug, instrumentId, String(maxAgeMinutes)],
    );
    if (result.error) return false;
    return ((result.data as unknown[] | null) ?? []).length > 0;
  }

  /**
   * Enqueue a new prediction run.
   */
  private async enqueueRun(
    organizationSlug: string,
    instrumentId: string,
  ): Promise<string | null> {
    const runId = crypto.randomUUID();
    const result = await this.db.rawQuery(
      `
      insert into prediction.orchestration_runs
        (id, organization_slug, instrument_id, run_type, status, requested_by, updated_at)
      values ($1, $2, $3, 'prediction', 'queued', 'pipeline', now())
      returning id
      `,
      [runId, organizationSlug, instrumentId],
    );
    if (result.error) {
      this.logger.error(`Failed to enqueue run for ${instrumentId}: ${result.error.message}`);
      return null;
    }
    const rows = (result.data as Array<{ id: string }> | null) ?? [];
    return rows[0]?.id ?? null;
  }

  /**
   * Process a queued run by transitioning it to running and executing.
   */
  private async processRun(runId: string, organizationSlug: string): Promise<void> {
    // Get the run
    const runResult = await this.db.rawQuery(
      `select * from prediction.orchestration_runs where id = $1 and organization_slug = $2`,
      [runId, organizationSlug],
    );
    if (runResult.error) throw new Error(runResult.error.message);
    const runs = (runResult.data as Array<Record<string, unknown>> | null) ?? [];
    const run = runs[0];
    if (!run) return;

    // Get the instrument
    const instResult = await this.db.rawQuery(
      `select * from prediction.instruments where id = $1 and organization_slug = $2`,
      [run.instrument_id, organizationSlug],
    );
    if (instResult.error) throw new Error(instResult.error.message);
    const instruments = (instResult.data as Array<Record<string, unknown>> | null) ?? [];
    const instrument = instruments[0];
    if (!instrument) return;

    // Update status to running
    await this.db.rawQuery(
      `update prediction.orchestration_runs set status = 'running', started_at = now(), updated_at = now() where id = $1`,
      [runId],
    );

    try {
      // Execute the prediction run via the existing multi-analyst pipeline
      await this.predictionRunner.executePredictionRun(
        run as any,
        instrument as any,
        'pipeline',
      );

      // Mark as completed
      await this.db.rawQuery(
        `update prediction.orchestration_runs set status = 'completed', completed_at = now(), updated_at = now() where id = $1`,
        [runId],
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.db.rawQuery(
        `update prediction.orchestration_runs set status = 'failed', last_error = $2, updated_at = now() where id = $1`,
        [runId, errMsg],
      );
      throw err;
    }
  }
}
