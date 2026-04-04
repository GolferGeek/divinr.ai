import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DATABASE_SERVICE,
  type DatabaseService,
} from '@orchestratorai/planes/database';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';

interface ActiveInstrumentPrice {
  id: string;
  organization_slug: string;
  symbol: string;
  current_state: Record<string, unknown> | null;
}

interface PendingPrediction {
  id: string;
  instrument_id: string;
  organization_slug: string;
  predicted_direction: string;
  confidence: number;
  horizon_minutes: number;
  created_at: string;
}

interface OutcomeTrackingResult {
  snapshotsCaptured: number;
  predictionsResolved: number;
  predictorsExpired: number;
  errors: string[];
}

/**
 * OutcomeTrackingService — Captures price snapshots, resolves predictions
 * at their horizon, and expires stale predictors.
 *
 * Schedule: Every 15 minutes
 * Disable: MARKETS_DISABLE_OUTCOME_TRACKING=true
 *
 * Flow:
 * 1. Capture current prices for all active instruments via Polygon API
 * 2. Update instrument current_state with latest price data
 * 3. Resolve predictions that have reached their horizon_minutes
 * 4. Expire predictors older than their TTL
 */
@Injectable()
export class OutcomeTrackingService {
  private readonly logger = new Logger(OutcomeTrackingService.name);
  private isRunning = false;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ObservabilityEventsService) private readonly observability: ObservabilityEventsService,
  ) {}

  private emit(type: string, message: string, data?: Record<string, unknown>): void {
    this.observability.push({
      context: { conversationId: 'pipeline', userId: 'system', agentSlug: 'outcome-tracker' } as never,
      source_app: 'divinr-api',
      hook_event_type: `pipeline.outcome.${type}`,
      status: type === 'error' ? 'error' : 'running',
      message,
      progress: null,
      step: null,
      payload: data ?? {},
      timestamp: Date.now(),
    }).catch(() => {});
  }

  private isDisabled(): boolean {
    return process.env.MARKETS_DISABLE_OUTCOME_TRACKING === 'true';
  }

  /**
   * Scheduled outcome tracking — every 15 minutes
   */
  @Cron('*/15 * * * *')
  async scheduledTracking(): Promise<void> {
    if (this.isDisabled()) return;
    await this.runTracking();
  }

  /**
   * Run a full outcome tracking cycle.
   */
  async runTracking(): Promise<OutcomeTrackingResult> {
    if (this.isRunning) {
      this.logger.warn('Skipping outcome tracking — previous run still in progress');
      return { snapshotsCaptured: 0, predictionsResolved: 0, predictorsExpired: 0, errors: [] };
    }

    this.isRunning = true;
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      // Step 1: Capture price snapshots
      this.emit('snapshots.started', 'Capturing price snapshots');
      const snapshotsResult = await this.captureSnapshots(errors);
      this.emit('snapshots.complete', `${snapshotsResult} price snapshots captured`, { count: snapshotsResult });

      // Step 2: Resolve predictions at horizon
      const resolvedCount = await this.resolvePredictions(errors);
      if (resolvedCount > 0) {
        this.emit('predictions.resolved', `${resolvedCount} predictions resolved at horizon`, { count: resolvedCount });
      }

      // Step 3: Expire stale predictors
      const expiredCount = await this.expirePredictors(errors);
      if (expiredCount > 0) {
        this.emit('predictors.expired', `${expiredCount} stale predictors expired`, { count: expiredCount });
      }

      const duration = Date.now() - startTime;
      this.emit('complete', `Outcome tracking: ${snapshotsResult} snapshots, ${resolvedCount} resolved, ${expiredCount} expired`, { snapshotsResult, resolvedCount, expiredCount, duration });
      this.logger.log(
        `Outcome tracking complete: ${snapshotsResult} snapshots, ` +
          `${resolvedCount} predictions resolved, ${expiredCount} predictors expired ` +
          `(${duration}ms)`,
      );

      return {
        snapshotsCaptured: snapshotsResult,
        predictionsResolved: resolvedCount,
        predictorsExpired: expiredCount,
        errors,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Step 1: Capture current prices for all active instruments.
   * Uses Polygon API if available, otherwise skips.
   */
  private async captureSnapshots(errors: string[]): Promise<number> {
    const polygonKey = process.env.POLYGON_API_KEY;
    if (!polygonKey) {
      this.logger.debug('No POLYGON_API_KEY — skipping price capture');
      return 0;
    }

    const instruments = await this.getActiveInstruments();
    this.logger.log(`Capturing prices for ${instruments.length} instruments`);
    if (instruments.length === 0) return 0;

    let captured = 0;

    for (let i = 0; i < instruments.length; i++) {
      const inst = instruments[i];
      try {
        const price = await this.fetchPrice(inst.symbol, polygonKey);
        if (price !== null) {
          await this.updateInstrumentPrice(inst.id, inst.organization_slug, price);
          captured++;
          this.logger.log(`${inst.symbol}: $${price}`);
          this.emit('price.captured', `${inst.symbol}: $${price}`, { symbol: inst.symbol, price });
        }

        // Rate limit: 5 requests/minute on free Polygon tier
        if (i < instruments.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 12500));
        }
      } catch (err) {
        const msg = `Failed to capture price for ${inst.symbol}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        this.logger.error(msg);
      }
    }

    return captured;
  }

  /**
   * Fetch the latest price for a symbol from Polygon.
   */
  private async fetchPrice(symbol: string, apiKey: string): Promise<number | null> {
    try {
      const response = await fetch(
        `https://api.polygon.io/v2/aggs/ticker/${symbol}/prev?adjusted=true&apiKey=${apiKey}`,
      );

      if (!response.ok) {
        if (response.status === 429) {
          this.logger.warn(`Polygon rate limited for ${symbol}`);
          return null;
        }
        throw new Error(`Polygon ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        results?: Array<{ c: number; o: number; h: number; l: number; v: number; t: number }>;
      };

      if (!data.results || data.results.length === 0) return null;
      return data.results[0].c; // closing price
    } catch (err) {
      this.logger.debug(`Price fetch failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Update an instrument's current_state with latest price data.
   */
  private async updateInstrumentPrice(
    instrumentId: string,
    _organizationSlug: string,
    price: number,
  ): Promise<void> {
    // Update ALL instruments with the same symbol (across all orgs including __base__)
    // so every tenant sees the latest price
    const result = await this.db.rawQuery(
      `update prediction.instruments
       set current_state = coalesce(current_state, '{}'::jsonb) || jsonb_build_object(
         'price', $2::float,
         'price_updated_at', now()::text
       )
       where symbol = (select symbol from prediction.instruments where id = $1)`,
      [instrumentId, price],
    );
    if (result.error) {
      this.logger.error(`Failed to update price for instrument ${instrumentId}: ${result.error.message}`);
    }
  }

  /**
   * Get all active instruments.
   */
  private async getActiveInstruments(): Promise<ActiveInstrumentPrice[]> {
    const result = await this.db.rawQuery(
      `select distinct on (symbol) id, organization_slug, symbol, current_state
       from prediction.instruments
       where is_active = true and organization_slug != '__base__'
       order by symbol, organization_slug`,
    );
    if (result.error) {
      this.logger.error(`Failed to query instruments: ${result.error.message}`);
      return [];
    }
    return (result.data as ActiveInstrumentPrice[] | null) ?? [];
  }

  /**
   * Step 2: Resolve predictions that have reached their horizon.
   * A prediction is resolved when NOW() >= created_at + horizon_minutes.
   * We compare the price at prediction time vs current price.
   */
  private async resolvePredictions(errors: string[]): Promise<number> {
    // Find predictions that have reached their horizon but aren't yet resolved
    const pendingResult = await this.db.rawQuery(
      `
      select mp.id, mp.instrument_id, mp.organization_slug,
             mp.predicted_direction, mp.confidence, mp.horizon_minutes,
             mp.created_at
      from prediction.market_predictions mp
      where mp.created_at + (mp.horizon_minutes || ' minutes')::interval <= now()
        and not exists (
          select 1 from prediction.prediction_horizon_evaluations phe
          where phe.prediction_id = mp.id
        )
      order by mp.created_at asc
      limit 100
      `,
    );

    if (pendingResult.error) {
      errors.push(`Failed to query pending predictions: ${pendingResult.error.message}`);
      return 0;
    }

    const pending = (pendingResult.data as PendingPrediction[] | null) ?? [];
    if (pending.length === 0) return 0;

    let resolved = 0;

    for (const pred of pending) {
      try {
        // Get the instrument's current price
        const instResult = await this.db.rawQuery(
          `select current_state from prediction.instruments
           where id = $1 and organization_slug = $2`,
          [pred.instrument_id, pred.organization_slug],
        );

        const instruments = (instResult.data as Array<{ current_state: Record<string, unknown> | null }> | null) ?? [];
        const currentState = instruments[0]?.current_state;
        const currentPrice = currentState?.price as number | undefined;

        if (!currentPrice) {
          this.logger.debug(`No current price for prediction ${pred.id} — skipping resolution`);
          continue;
        }

        // Determine actual direction based on price change
        // We need a reference price from prediction time — use current_state if available
        // For now, mark as evaluated so nightly-evaluation can handle detailed scoring
        const horizonWindow = pred.horizon_minutes <= 1440 ? '1d' : pred.horizon_minutes <= 4320 ? '3d' : '5d';

        await this.db.rawQuery(
          `
          insert into prediction.prediction_horizon_evaluations
            (id, prediction_id, run_id, organization_slug, instrument_id,
             analyst_id, horizon_window, prediction_date, evaluation_date,
             predicted_direction, created_at)
          values (gen_random_uuid()::text, $1, null, $2, $3,
                  null, $4, $5, now(),
                  $6, now())
          on conflict do nothing
          `,
          [
            pred.id,
            pred.organization_slug,
            pred.instrument_id,
            horizonWindow,
            pred.created_at,
            pred.predicted_direction,
          ],
        );

        resolved++;
      } catch (err) {
        const msg = `Failed to resolve prediction ${pred.id}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        this.logger.error(msg);
      }
    }

    return resolved;
  }

  /**
   * Step 3: Expire stale predictors.
   * Predictors older than MARKETS_PREDICTOR_TTL_HOURS (default 48) are expired.
   */
  private async expirePredictors(errors: string[]): Promise<number> {
    const ttlHours = parseInt(process.env.MARKETS_PREDICTOR_TTL_HOURS || '48', 10);

    const result = await this.db.rawQuery(
      `
      update prediction.market_predictors
      set status = 'expired', updated_at = now()
      where status = 'active'
        and created_at < now() - ($1 || ' hours')::interval
      returning id
      `,
      [String(ttlHours)],
    );

    if (result.error) {
      errors.push(`Failed to expire predictors: ${result.error.message}`);
      return 0;
    }

    return ((result.data as Array<{ id: string }> | null) ?? []).length;
  }
}
