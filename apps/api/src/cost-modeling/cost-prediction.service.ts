import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { CostCalibrationService } from './cost-calibration.service';

export interface ConfigurationOverride {
  addTriples?: Array<{ analystId: string; instrumentId: string }>;
  removeTriples?: Array<{ analystId: string; instrumentId: string }>;
  modelOverrides?: Array<{ analystId: string; provider: string; model: string }>;
}

export interface BreakdownEntry {
  key: string;
  costCents: number;
}

export interface PredictionResult {
  predictedMonthlyCents: number;
  confidenceRange: [number, number];
  confidence: 'low' | 'medium' | 'high';
  breakdownByStage: BreakdownEntry[];
  breakdownByTriple: BreakdownEntry[];
  basisDays: number;
}

interface UserHistoryRow {
  history_days: number | string | null;
  raw_total_cents: number | string | null;
}

interface StageBreakdownRow {
  stage: string;
  total_cost_cents: number | string | null;
}

interface TripleBreakdownRow {
  analyst_id: string | null;
  instrument_id: string | null;
  total_cost_cents: number | string | null;
}

interface TripleCountRow {
  count: number | string;
}

interface PercentileRow {
  p75: number | string | null;
}

@Injectable()
export class CostPredictionService {
  private readonly logger = new Logger(CostPredictionService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(CostCalibrationService) private readonly calibration: CostCalibrationService,
  ) {}

  private envInt(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private headroomPct(): number { return this.envInt('COST_PREDICTION_HEADROOM_PCT', 25); }
  private minHistoryDays(): number { return this.envInt('COST_PREDICTION_MIN_HISTORY_DAYS', 14); }

  async predictForUser(userId: string, override?: ConfigurationOverride): Promise<PredictionResult> {
    const historyResult = await this.db.rawQuery(
      `SELECT
         coalesce(extract(day from (max("timestamp") - min("timestamp"))), 0)::int as history_days,
         coalesce(sum(cost_cents), 0)::bigint as raw_total_cents
       FROM prediction.llm_usage_log
       WHERE billed_user_id = $1
         AND "timestamp" >= now() - interval '30 days'`,
      [userId],
    );
    const histRows = (historyResult.data as UserHistoryRow[] | null) ?? [];
    const historyDays = Number(histRows[0]?.history_days ?? 0);
    const rawCents30d = Number(histRows[0]?.raw_total_cents ?? 0);

    const minHistory = this.minHistoryDays();

    if (historyDays < minHistory) {
      return this.coldStartPredict(userId, override);
    }

    const baseStages = await this.userStageBreakdown(userId);
    const baseTriples = await this.userTripleBreakdown(userId);

    const scale = 30 / Math.max(historyDays, 1);
    let scaledMonthly = Math.round(rawCents30d * (rawCents30d > 0 ? 1 : 1) * scale);
    if (rawCents30d === 0) scaledMonthly = 0;

    const adjusted = await this.applyOverride(scaledMonthly, baseStages, baseTriples, override);

    const headroomMultiplier = 1 + this.headroomPct() / 100;
    const predictedMonthlyCents = Math.round(adjusted * headroomMultiplier);
    const confidence: PredictionResult['confidence'] = historyDays >= 28 ? 'high' : 'medium';
    const confidenceRange: [number, number] = [
      Math.round(predictedMonthlyCents * 0.75),
      Math.round(predictedMonthlyCents * 1.25),
    ];

    return {
      predictedMonthlyCents,
      confidenceRange,
      confidence,
      breakdownByStage: this.scaleBreakdown(baseStages, scale, headroomMultiplier),
      breakdownByTriple: this.scaleBreakdown(baseTriples, scale, headroomMultiplier),
      basisDays: historyDays,
    };
  }

  private async userStageBreakdown(userId: string): Promise<BreakdownEntry[]> {
    const result = await this.db.rawQuery(
      `SELECT stage, coalesce(sum(cost_cents), 0)::bigint as total_cost_cents
       FROM prediction.llm_usage_log
       WHERE billed_user_id = $1
         AND "timestamp" >= now() - interval '30 days'
       GROUP BY stage`,
      [userId],
    );
    const rows = (result.data as StageBreakdownRow[] | null) ?? [];
    return rows.map((r) => ({ key: r.stage, costCents: Number(r.total_cost_cents ?? 0) }));
  }

  private async userTripleBreakdown(userId: string): Promise<BreakdownEntry[]> {
    const result = await this.db.rawQuery(
      `SELECT analyst_id, instrument_id, coalesce(sum(cost_cents), 0)::bigint as total_cost_cents
       FROM prediction.llm_usage_log
       WHERE billed_user_id = $1
         AND "timestamp" >= now() - interval '30 days'
         AND analyst_id IS NOT NULL
         AND instrument_id IS NOT NULL
       GROUP BY analyst_id, instrument_id`,
      [userId],
    );
    const rows = (result.data as TripleBreakdownRow[] | null) ?? [];
    return rows.map((r) => ({
      key: `${r.analyst_id ?? 'na'}:${r.instrument_id ?? 'na'}`,
      costCents: Number(r.total_cost_cents ?? 0),
    }));
  }

  private scaleBreakdown(
    rows: BreakdownEntry[],
    scale: number,
    headroomMultiplier: number,
  ): BreakdownEntry[] {
    return rows.map((r) => ({
      key: r.key,
      costCents: Math.round(r.costCents * scale * headroomMultiplier),
    }));
  }

  private async applyOverride(
    baselineMonthly: number,
    baseStages: BreakdownEntry[],
    baseTriples: BreakdownEntry[],
    override?: ConfigurationOverride,
  ): Promise<number> {
    if (!override) return baselineMonthly;

    let result = baselineMonthly;
    const tripleCount = baseTriples.length || 1;
    const perTripleAvg = baselineMonthly / tripleCount;

    if (override.addTriples) {
      result += override.addTriples.length * perTripleAvg;
    }
    if (override.removeTriples) {
      result = Math.max(0, result - override.removeTriples.length * perTripleAvg);
    }

    if (override.modelOverrides && override.modelOverrides.length > 0) {
      // Scale stages tied to overridden analysts by ratio of new model avg vs current weighted avg.
      // Heuristic: use a single global current-avg from calibration table when available.
      const calibrations = await this.calibration.getCalibration();
      const currentGlobalAvg = this.weightedAvgCostPerCall(calibrations);
      let multiplier = 1;
      for (const ov of override.modelOverrides) {
        const target = await this.calibration.getCalibrationFor(ov.model, ov.provider);
        if (target?.rolling_avg_cost_cents_per_call != null && currentGlobalAvg > 0) {
          multiplier *= target.rolling_avg_cost_cents_per_call / currentGlobalAvg;
        }
      }
      // Apply only to the share of cost attributable to overridden analysts (approximate as 1/tripleCount each).
      const affectedShare = Math.min(1, override.modelOverrides.length / tripleCount);
      result = result * (1 - affectedShare) + result * affectedShare * multiplier;
    }

    // Suppress unused-warning for baseStages — it's part of the public surface for potential future weighting.
    void baseStages;
    return Math.max(0, Math.round(result));
  }

  private weightedAvgCostPerCall(rows: Array<{ rolling_avg_cost_cents_per_call: number | null; samples_count: number }>): number {
    let totalSamples = 0;
    let weightedSum = 0;
    for (const r of rows) {
      if (r.rolling_avg_cost_cents_per_call == null) continue;
      totalSamples += r.samples_count;
      weightedSum += r.rolling_avg_cost_cents_per_call * r.samples_count;
    }
    return totalSamples > 0 ? weightedSum / totalSamples : 0;
  }

  private async coldStartPredict(userId: string, override?: ConfigurationOverride): Promise<PredictionResult> {
    const tripleCountResult = await this.db.rawQuery(
      `SELECT count(*)::integer as count
         FROM prediction.user_enabled_triples
        WHERE user_id = $1 AND disabled_at IS NULL`,
      [userId],
    );
    const tripleRows = (tripleCountResult.data as TripleCountRow[] | null) ?? [];
    const userTriples = Number(tripleRows[0]?.count ?? 0);

    const bin = userTriples <= 3 ? '1-3' : userTriples <= 10 ? '4-10' : '11+';
    let lowerBound = 1;
    let upperBound = 3;
    if (bin === '4-10') { lowerBound = 4; upperBound = 10; }
    else if (bin === '11+') { lowerBound = 11; upperBound = 1_000_000; }

    const seedResult = await this.db.rawQuery(
      `WITH peer_users AS (
         SELECT user_id
           FROM prediction.user_enabled_triples
          WHERE disabled_at IS NULL
          GROUP BY user_id
         HAVING count(*) BETWEEN $1 AND $2
       )
       SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY total_cost_cents) as p75
         FROM prediction.llm_usage_per_user_monthly
        WHERE billed_user_id IN (SELECT user_id FROM peer_users)
          AND total_cost_cents IS NOT NULL`,
      [lowerBound, upperBound],
    );
    const seedRows = (seedResult.data as PercentileRow[] | null) ?? [];
    const seedCents = Number(seedRows[0]?.p75 ?? 0);

    const stageProportionsResult = await this.db.rawQuery(
      `SELECT stage, coalesce(sum(total_cost_cents), 0)::bigint as total_cost_cents
         FROM prediction.llm_usage_per_stage_daily
        WHERE date >= (current_date - interval '30 days')::date
        GROUP BY stage`,
    );
    const stageProportions = (stageProportionsResult.data as StageBreakdownRow[] | null) ?? [];
    const totalStageCents = stageProportions.reduce((acc, r) => acc + Number(r.total_cost_cents ?? 0), 0);

    let baseline = seedCents;
    if (override?.addTriples) baseline += override.addTriples.length * (seedCents / Math.max(userTriples, 1));
    if (override?.removeTriples) baseline = Math.max(0, baseline - override.removeTriples.length * (seedCents / Math.max(userTriples, 1)));

    const headroomMultiplier = 1 + this.headroomPct() / 100;
    const predictedMonthlyCents = Math.round(baseline * headroomMultiplier);
    const confidenceRange: [number, number] = [
      Math.round(predictedMonthlyCents * 0.5),
      Math.round(predictedMonthlyCents * 1.5),
    ];

    const breakdownByStage: BreakdownEntry[] = totalStageCents > 0
      ? stageProportions.map((r) => ({
          key: r.stage,
          costCents: Math.round((Number(r.total_cost_cents ?? 0) / totalStageCents) * predictedMonthlyCents),
        }))
      : [];

    return {
      predictedMonthlyCents,
      confidenceRange,
      confidence: 'low',
      breakdownByStage,
      breakdownByTriple: [],
      basisDays: 0,
    };
  }
}
