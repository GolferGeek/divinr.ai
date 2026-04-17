import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

export interface CalibrationRow {
  model: string;
  provider: string;
  last_calibrated_at: string;
  samples_count: number;
  window_start: string;
  window_end: string;
  rolling_avg_cost_cents_per_call: number | null;
  rolling_avg_tokens_in: number;
  rolling_avg_tokens_out: number;
  rolling_avg_latency_ms: number;
  per_million_tokens_in_usd: number | null;
  per_million_tokens_out_usd: number | null;
  previous_avg_cost_cents_per_call: number | null;
  drift_pct: number | null;
}

export interface DriftAlertRow {
  id: string;
  model: string;
  provider: string;
  detected_at: string;
  previous_avg_cost_cents_per_call: number;
  new_avg_cost_cents_per_call: number;
  drift_pct: number;
  threshold_pct: number;
  samples_count: number;
  acknowledged_at: string | null;
  acknowledged_by_user_id: string | null;
}

interface SampleAggregateRow {
  samples_count: string | number;
  avg_cost_cents: string | number | null;
  avg_tokens_in: string | number;
  avg_tokens_out: string | number;
  avg_latency_ms: string | number;
  total_tokens_in: string | number;
  total_tokens_out: string | number;
  total_cost_cents: string | number | null;
  window_start: string;
  window_end: string;
}

export interface RecomputeResult {
  model: string;
  provider: string;
  updated: boolean;
  samplesCount: number;
  alertRaised: boolean;
  reason?: string;
}

export interface WeeklyCalibrationSummary {
  refreshedModels: number;
  alertsRaised: number;
  skippedModels: number;
  perModel: RecomputeResult[];
}

@Injectable()
export class CostCalibrationService {
  private readonly logger = new Logger(CostCalibrationService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  private envInt(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private windowDays(): number { return this.envInt('COST_CALIBRATION_WINDOW_DAYS', 28); }
  private minSamples(): number { return this.envInt('COST_CALIBRATION_MIN_SAMPLES', 50); }
  private driftThreshold(): number { return this.envInt('COST_CALIBRATION_DRIFT_THRESHOLD', 20); }
  private driftMinSamples(): number { return this.envInt('COST_CALIBRATION_DRIFT_MIN_SAMPLES', 200); }

  /**
   * Cron entry — Mondays at 03:00 local. Disabled with MARKETS_DISABLE_NIGHTLY_CRON=true
   * (reuses the existing umbrella flag so dev environments can shut off all background work).
   */
  @Cron('0 3 * * 1')
  async handleWeeklyCron(): Promise<void> {
    if (process.env.MARKETS_DISABLE_NIGHTLY_CRON === 'true') return;
    try {
      await this.runWeeklyCalibration();
    } catch (err) {
      this.logger.error(`Weekly calibration cron failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async runWeeklyCalibration(): Promise<WeeklyCalibrationSummary> {
    const windowDays = this.windowDays();
    const distinct = await this.db.rawQuery(
      `SELECT DISTINCT model, provider
         FROM prediction.llm_usage_log
         WHERE "timestamp" >= now() - ($1::int * interval '1 day')`,
      [windowDays],
    );
    const pairs = (distinct.data as Array<{ model: string; provider: string }> | null) ?? [];

    const perModel: RecomputeResult[] = [];
    let refreshedModels = 0;
    let alertsRaised = 0;
    let skippedModels = 0;

    for (const pair of pairs) {
      const result = await this.recomputeForModel(pair.model, pair.provider);
      perModel.push(result);
      if (result.updated) refreshedModels += 1;
      if (result.alertRaised) alertsRaised += 1;
      if (!result.updated) skippedModels += 1;
    }

    this.logger.log(
      `Weekly calibration complete: refreshed=${refreshedModels} alerts=${alertsRaised} skipped=${skippedModels}`,
    );
    return { refreshedModels, alertsRaised, skippedModels, perModel };
  }

  async recomputeForModel(model: string, provider: string): Promise<RecomputeResult> {
    const windowDays = this.windowDays();
    const minSamples = this.minSamples();

    const aggResult = await this.db.rawQuery(
      `SELECT
         count(*)::integer as samples_count,
         avg(cost_cents)::numeric(10,4) as avg_cost_cents,
         avg(tokens_in)::numeric(12,2) as avg_tokens_in,
         avg(tokens_out)::numeric(12,2) as avg_tokens_out,
         avg(latency_ms)::numeric(10,2) as avg_latency_ms,
         coalesce(sum(tokens_in), 0)::bigint as total_tokens_in,
         coalesce(sum(tokens_out), 0)::bigint as total_tokens_out,
         sum(cost_cents)::bigint as total_cost_cents,
         min("timestamp") as window_start,
         max("timestamp") as window_end
       FROM prediction.llm_usage_log
       WHERE model = $1 AND provider = $2
         AND "timestamp" >= now() - ($3::int * interval '1 day')`,
      [model, provider, windowDays],
    );

    const aggRows = (aggResult.data as SampleAggregateRow[] | null) ?? [];
    const agg = aggRows[0];
    const samplesCount = agg ? Number(agg.samples_count) : 0;

    if (samplesCount < minSamples) {
      return {
        model, provider,
        updated: false,
        samplesCount,
        alertRaised: false,
        reason: `samples=${samplesCount} below min=${minSamples}`,
      };
    }

    const avgCostCents = agg.avg_cost_cents != null ? Number(agg.avg_cost_cents) : null;
    const avgTokensIn = Number(agg.avg_tokens_in ?? 0);
    const avgTokensOut = Number(agg.avg_tokens_out ?? 0);
    const avgLatency = Number(agg.avg_latency_ms ?? 0);
    const totalTokensIn = Number(agg.total_tokens_in ?? 0);
    const totalTokensOut = Number(agg.total_tokens_out ?? 0);
    const totalCostCents = agg.total_cost_cents != null ? Number(agg.total_cost_cents) : null;

    let perMillionIn: number | null = null;
    let perMillionOut: number | null = null;
    if (totalCostCents != null && (totalTokensIn + totalTokensOut) > 0) {
      const totalCostUsd = totalCostCents / 100;
      const inputShare = totalTokensIn / (totalTokensIn + totalTokensOut);
      const outputShare = totalTokensOut / (totalTokensIn + totalTokensOut);
      if (totalTokensIn > 0) perMillionIn = (totalCostUsd * inputShare) / (totalTokensIn / 1_000_000);
      if (totalTokensOut > 0) perMillionOut = (totalCostUsd * outputShare) / (totalTokensOut / 1_000_000);
    }

    const prevResult = await this.db.rawQuery(
      `SELECT rolling_avg_cost_cents_per_call FROM prediction.model_pricing_calibration
        WHERE model = $1 AND provider = $2`,
      [model, provider],
    );
    const prevRows = (prevResult.data as Array<{ rolling_avg_cost_cents_per_call: string | number | null }> | null) ?? [];
    const previousAvg = prevRows[0]?.rolling_avg_cost_cents_per_call != null
      ? Number(prevRows[0].rolling_avg_cost_cents_per_call)
      : null;

    let driftPct: number | null = null;
    let alertRaised = false;
    const driftThreshold = this.driftThreshold();
    const driftMinSamples = this.driftMinSamples();

    if (previousAvg != null && previousAvg !== 0 && avgCostCents != null) {
      driftPct = Number((((avgCostCents - previousAvg) / previousAvg) * 100).toFixed(2));
      if (Math.abs(driftPct) >= driftThreshold && samplesCount >= driftMinSamples) {
        await this.db.rawQuery(
          `INSERT INTO prediction.model_pricing_drift_alerts
             (model, provider, previous_avg_cost_cents_per_call, new_avg_cost_cents_per_call,
              drift_pct, threshold_pct, samples_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [model, provider, previousAvg, avgCostCents, driftPct, driftThreshold, samplesCount],
        );
        alertRaised = true;
      }
    }

    await this.db.rawQuery(
      `INSERT INTO prediction.model_pricing_calibration
         (model, provider, last_calibrated_at, samples_count, window_start, window_end,
          rolling_avg_cost_cents_per_call, rolling_avg_tokens_in, rolling_avg_tokens_out,
          rolling_avg_latency_ms, per_million_tokens_in_usd, per_million_tokens_out_usd,
          previous_avg_cost_cents_per_call, drift_pct)
       VALUES ($1, $2, now(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (model, provider) DO UPDATE SET
         last_calibrated_at = excluded.last_calibrated_at,
         samples_count = excluded.samples_count,
         window_start = excluded.window_start,
         window_end = excluded.window_end,
         rolling_avg_cost_cents_per_call = excluded.rolling_avg_cost_cents_per_call,
         rolling_avg_tokens_in = excluded.rolling_avg_tokens_in,
         rolling_avg_tokens_out = excluded.rolling_avg_tokens_out,
         rolling_avg_latency_ms = excluded.rolling_avg_latency_ms,
         per_million_tokens_in_usd = excluded.per_million_tokens_in_usd,
         per_million_tokens_out_usd = excluded.per_million_tokens_out_usd,
         previous_avg_cost_cents_per_call = excluded.previous_avg_cost_cents_per_call,
         drift_pct = excluded.drift_pct`,
      [
        model, provider, samplesCount, agg.window_start, agg.window_end,
        avgCostCents, avgTokensIn, avgTokensOut, avgLatency,
        perMillionIn, perMillionOut, previousAvg, driftPct,
      ],
    );

    return { model, provider, updated: true, samplesCount, alertRaised };
  }

  async getCalibration(): Promise<CalibrationRow[]> {
    const result = await this.db.rawQuery(
      `SELECT model, provider, last_calibrated_at, samples_count,
              window_start, window_end,
              rolling_avg_cost_cents_per_call, rolling_avg_tokens_in,
              rolling_avg_tokens_out, rolling_avg_latency_ms,
              per_million_tokens_in_usd, per_million_tokens_out_usd,
              previous_avg_cost_cents_per_call, drift_pct
         FROM prediction.model_pricing_calibration
         ORDER BY last_calibrated_at DESC`,
    );
    return ((result.data as CalibrationRow[] | null) ?? []).map((row) => ({
      ...row,
      samples_count: Number(row.samples_count),
      rolling_avg_cost_cents_per_call: row.rolling_avg_cost_cents_per_call != null ? Number(row.rolling_avg_cost_cents_per_call) : null,
      rolling_avg_tokens_in: Number(row.rolling_avg_tokens_in),
      rolling_avg_tokens_out: Number(row.rolling_avg_tokens_out),
      rolling_avg_latency_ms: Number(row.rolling_avg_latency_ms),
      per_million_tokens_in_usd: row.per_million_tokens_in_usd != null ? Number(row.per_million_tokens_in_usd) : null,
      per_million_tokens_out_usd: row.per_million_tokens_out_usd != null ? Number(row.per_million_tokens_out_usd) : null,
      previous_avg_cost_cents_per_call: row.previous_avg_cost_cents_per_call != null ? Number(row.previous_avg_cost_cents_per_call) : null,
      drift_pct: row.drift_pct != null ? Number(row.drift_pct) : null,
    }));
  }

  async getCalibrationFor(model: string, provider: string): Promise<CalibrationRow | null> {
    const result = await this.db.rawQuery(
      `SELECT model, provider, last_calibrated_at, samples_count,
              window_start, window_end,
              rolling_avg_cost_cents_per_call, rolling_avg_tokens_in,
              rolling_avg_tokens_out, rolling_avg_latency_ms,
              per_million_tokens_in_usd, per_million_tokens_out_usd,
              previous_avg_cost_cents_per_call, drift_pct
         FROM prediction.model_pricing_calibration
        WHERE model = $1 AND provider = $2`,
      [model, provider],
    );
    const rows = (result.data as CalibrationRow[] | null) ?? [];
    return rows[0] ?? null;
  }

  async getDriftAlerts(opts: { onlyUnacknowledged?: boolean } = {}): Promise<DriftAlertRow[]> {
    const where = opts.onlyUnacknowledged ? 'WHERE acknowledged_at IS NULL' : '';
    const result = await this.db.rawQuery(
      `SELECT id, model, provider, detected_at,
              previous_avg_cost_cents_per_call, new_avg_cost_cents_per_call,
              drift_pct, threshold_pct, samples_count,
              acknowledged_at, acknowledged_by_user_id
         FROM prediction.model_pricing_drift_alerts
         ${where}
         ORDER BY detected_at DESC`,
    );
    return ((result.data as DriftAlertRow[] | null) ?? []).map((row) => ({
      ...row,
      previous_avg_cost_cents_per_call: Number(row.previous_avg_cost_cents_per_call),
      new_avg_cost_cents_per_call: Number(row.new_avg_cost_cents_per_call),
      drift_pct: Number(row.drift_pct),
      threshold_pct: Number(row.threshold_pct),
      samples_count: Number(row.samples_count),
    }));
  }

  async acknowledgeDriftAlert(id: string, userId: string): Promise<{ acknowledged_at: string } | null> {
    const result = await this.db.rawQuery(
      `UPDATE prediction.model_pricing_drift_alerts
          SET acknowledged_at = now(), acknowledged_by_user_id = $2
        WHERE id = $1
        RETURNING acknowledged_at`,
      [id, userId],
    );
    const rows = (result.data as Array<{ acknowledged_at: string }> | null) ?? [];
    return rows[0] ?? null;
  }
}
