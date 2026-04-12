import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DATABASE_SERVICE,
  type DatabaseService,
} from '@orchestratorai/planes/database';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { StopLossWatcherService } from './stop-loss-watcher.service';
import { DayTraderRunnerService } from './day-trader-runner.service';

interface ActiveInstrumentPrice {
  id: string;
  symbol: string;
  current_state: Record<string, unknown> | null;
}

interface PendingPrediction {
  id: string;
  instrument_id: string;
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

export interface RecentBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export const RECENT_BARS_CAP = 32;

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
    @Inject(StopLossWatcherService) private readonly stopLossWatcher: StopLossWatcherService,
    @Inject(DayTraderRunnerService) private readonly dayTraderRunner: DayTraderRunnerService,
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

      // Step 1.5: Stop-loss / take-profit / trailing sweep on agent positions.
      // Synchronous so it always reads the snapshot we just wrote.
      // Failures are isolated — never break the rest of outcome tracking.
      try {
        const sweepResult = await this.stopLossWatcher.sweep();
        if (sweepResult.closed > 0 || sweepResult.updated > 0) {
          this.logger.log(
            `Stop-loss sweep: closed=${sweepResult.closed} updated=${sweepResult.updated} skipped=${sweepResult.skipped}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Stop-loss sweep failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Step 1.6: Day-trader strategy runner. Fires once per 15-min tick,
      // detects the EOD-flat boundary, and is isolated from the rest of
      // outcome tracking the same way the stop-loss sweep is.
      try {
        const isLastTickOfSession = DayTraderRunnerService.isLastTickOfSession(new Date());
        const dtResult = await this.dayTraderRunner.runStrategies({ isLastTickOfSession });
        if (dtResult.opensWritten > 0 || dtResult.closesWritten > 0 || dtResult.eodFlat) {
          this.logger.log(
            `Day-trader runner: opens=${dtResult.opensWritten} closes=${dtResult.closesWritten} eodFlat=${dtResult.eodFlat}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Day-trader runner failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

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
        const priceData = await this.fetchPrice(inst.symbol, polygonKey);
        if (priceData !== null) {
          await this.updateInstrumentPrice(inst.id, priceData);
          captured++;
          this.logger.log(`${inst.symbol}: $${priceData.price} (${priceData.change >= 0 ? '+' : ''}${priceData.changePercent.toFixed(2)}%)`);
          this.emit('price.captured', `${inst.symbol}: $${priceData.price}`, { symbol: inst.symbol, ...priceData });
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
  private async fetchPrice(symbol: string, apiKey: string): Promise<{ price: number; change: number; changePercent: number; bars: RecentBar[] } | null> {
    try {
      // Fetch recent daily bars (free-tier compatible) for real OHLC variation.
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 10); // go back 10 calendar days to get ~5 trading days
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const response = await fetch(
        `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${fmt(from)}/${fmt(to)}?adjusted=true&limit=${RECENT_BARS_CAP}&apiKey=${apiKey}`,
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

      const bars: RecentBar[] = data.results.map(raw => ({
        t: raw.t ? new Date(raw.t).toISOString() : new Date().toISOString(),
        o: raw.o,
        h: raw.h,
        l: raw.l,
        c: raw.c,
        v: raw.v ?? 0,
      }));

      const latest = data.results[data.results.length - 1];
      const change = latest.c - latest.o;
      const changePercent = latest.o > 0 ? (change / latest.o) * 100 : 0;
      return { price: latest.c, change, changePercent, bars };
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
    priceData: { price: number; change: number; changePercent: number; bars: RecentBar[] },
  ): Promise<void> {
    // Get latest prediction direction/confidence for this instrument
    // Try arbitrator first, fall back to analyst consensus
    let predDirection = '';
    let predConfidence = 0;
    try {
      const predResult = await this.db.rawQuery(
        `select mp.predicted_direction, mp.confidence
         from prediction.market_predictions mp
         join prediction.instruments i ON i.id = mp.instrument_id
         where i.symbol = (select symbol from prediction.instruments where id = $1 limit 1)
           and mp.created_at::date = current_date
         order by case when mp.role = 'arbitrator' then 0 else 1 end, mp.created_at desc
         limit 1`,
        [instrumentId],
      );
      const pRows = (predResult.data as Array<{ predicted_direction: string; confidence: number }> | null) ?? [];
      if (pRows.length > 0) {
        predDirection = pRows[0].predicted_direction;
        predConfidence = pRows[0].confidence;
      }
    } catch { /* no prediction data */ }

    // Replace the ring buffer with the full set of real OHLC bars from Polygon.
    const nextBars = priceData.bars.slice(-RECENT_BARS_CAP);

    // Update ALL instruments with the same symbol (across all orgs including __base__)
    const result = await this.db.rawQuery(
      `update prediction.instruments
       set current_state = coalesce(current_state, '{}'::jsonb) || jsonb_build_object(
         'price', $2::float,
         'change', $3::float,
         'changePercent', $4::float,
         'prediction_direction', $5::text,
         'prediction_confidence', $6::float,
         'price_updated_at', now()::text,
         'recent_bars', $7::jsonb
       )
       where symbol = (select symbol from prediction.instruments where id = $1)`,
      [instrumentId, priceData.price, priceData.change, priceData.changePercent, predDirection, predConfidence, JSON.stringify(nextBars)],
    );
    if (result.error) {
      this.logger.error(`Failed to update price for instrument ${instrumentId}: ${result.error.message}`);
    }
  }

  /**
   * Return the last `count` 15-min bars persisted for this instrument id.
   * Reads from `prediction.instruments.current_state.recent_bars`.
   * Returns at most `count` bars (oldest first).
   */
  async getRecentBars(instrumentId: string, count: number): Promise<RecentBar[]> {
    const result = await this.db.rawQuery(
      `select current_state from prediction.instruments where id = $1 limit 1`,
      [instrumentId],
    );
    const state = ((result.data as Array<{ current_state: Record<string, unknown> | null }> | null) ?? [])[0]?.current_state;
    const bars = Array.isArray(state?.recent_bars) ? (state!.recent_bars as RecentBar[]) : [];
    return bars.slice(-count);
  }

  /**
   * Get all active instruments.
   */
  private async getActiveInstruments(): Promise<ActiveInstrumentPrice[]> {
    const result = await this.db.rawQuery(
      `select distinct on (symbol) id, symbol, current_state
       from prediction.instruments
       where is_active = true
       order by symbol`,
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
      select mp.id, mp.instrument_id,
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
           where id = $1`,
          [pred.instrument_id],
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
            (id, prediction_id, run_id, instrument_id,
             analyst_id, horizon_window, prediction_date, evaluation_date,
             predicted_direction, created_at)
          values (gen_random_uuid()::text, $1, null, $2,
                  null, $3, $4, now(),
                  $5, now())
          on conflict do nothing
          `,
          [
            pred.id,
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
