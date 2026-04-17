import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

export interface RecordOutcomesResult {
  scanned: number;
  inserted: number;
  skipped: number;
  errors: number;
}

interface EvaluationRow {
  eval_id: string;
  prediction_id: string;
  run_id: string | null;
  analyst_id: string | null;
  instrument_id: string;
  horizon_window: number;
  prediction_date: string;
  evaluation_date: string;
  predicted_direction: 'up' | 'down' | 'flat';
  actual_direction: 'up' | 'down' | 'flat';
  was_correct: boolean;
  confidence_at_prediction: number | null;
  author_user_id: string | null;
  pred_author_user_id: string | null;
  pred_analyst_id: string | null;
  config_version_id: string | null;
}

interface PositionRow {
  realized_pnl: number | null;
  status: string;
}

interface PredictorRow {
  id: string;
  article_id: string;
  external_source_slug: string | null;
}

@Injectable()
export class OutcomeAttributionService {
  private readonly logger = new Logger(OutcomeAttributionService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  /**
   * Scan prediction_horizon_evaluations for rows lacking an outcome_records row
   * and compute attribution for each. Idempotent via UNIQUE (evaluation_id).
   *
   * Invoked by NightlyEvaluationService after every evaluation cycle.
   */
  async recordOutcomesForEvaluationRun(runStartedAt: Date): Promise<RecordOutcomesResult> {
    const cutoff = this.getCutoffDate();
    const effectiveSince = runStartedAt < cutoff ? cutoff : runStartedAt;

    const result: RecordOutcomesResult = { scanned: 0, inserted: 0, skipped: 0, errors: 0 };

    const evalsResult = await this.db.rawQuery(
      `select
         phe.id as eval_id,
         phe.prediction_id,
         phe.run_id,
         phe.analyst_id,
         phe.instrument_id,
         phe.horizon_window,
         phe.prediction_date,
         phe.evaluation_date,
         phe.predicted_direction,
         phe.actual_direction,
         phe.was_correct,
         phe.confidence_at_prediction,
         phe.author_user_id,
         mp.author_user_id as pred_author_user_id,
         mp.analyst_id as pred_analyst_id,
         mp.config_version_id
       from prediction.prediction_horizon_evaluations phe
       left join prediction.market_predictions mp on mp.id = phe.prediction_id
       where phe.created_at >= $1
         and phe.evaluation_date >= $2
         and not exists (
           select 1 from prediction.outcome_records oro
           where oro.evaluation_id = phe.id
         )`,
      [effectiveSince.toISOString(), cutoff.toISOString()],
    );
    if (evalsResult.error) {
      this.logger.error(`Failed to scan evaluations for attribution: ${evalsResult.error.message}`);
      return result;
    }
    const evals = (evalsResult.data as EvaluationRow[] | null) ?? [];
    result.scanned = evals.length;

    for (const ev of evals) {
      try {
        await this.recordOneOutcome(ev);
        result.inserted++;
      } catch (err) {
        result.errors++;
        this.logger.warn(
          `Failed to record outcome for evaluation ${ev.eval_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `Outcome attribution: scanned=${result.scanned} inserted=${result.inserted} errors=${result.errors}`,
    );
    return result;
  }

  private async recordOneOutcome(ev: EvaluationRow): Promise<void> {
    const authorUserId = ev.author_user_id ?? ev.pred_author_user_id ?? null;
    const analystId = ev.analyst_id ?? ev.pred_analyst_id;
    if (!analystId) {
      // Analyst-less predictions (e.g., orchestrator roles) are not attributable.
      return;
    }

    const confidence = this.normalizeConfidence(ev.confidence_at_prediction);
    const calibrationScore = ev.was_correct ? confidence : -confidence;

    const { attributionMethod, pnlCents, pnlType } = await this.computePnl(ev.prediction_id);

    const lookbackHours = this.getPredictorLookbackHours();
    const predictors = await this.findContributingPredictors(
      authorUserId,
      analystId,
      ev.instrument_id,
      ev.prediction_date,
      lookbackHours,
    );

    const predictorIds = predictors.map((p) => p.id);
    const articleIds = Array.from(new Set(predictors.map((p) => p.article_id)));
    const sourceKeys = Array.from(
      new Set(predictors.map((p) => p.external_source_slug).filter((s): s is string => !!s)),
    );
    const predictorAttributionMethod = predictors.length > 0 ? 'lookback_window' : 'none';

    const insert = await this.db.rawQuery(
      `insert into prediction.outcome_records (
         id, evaluation_id, prediction_id, run_id, author_user_id, analyst_id, instrument_id,
         horizon_window, prediction_date, evaluation_date,
         predicted_direction, actual_direction, was_correct,
         confidence_at_prediction, pnl_type, attribution_method, attributable_pnl_cents,
         calibration_score, contributing_predictor_ids, contributing_article_ids, contributing_source_keys,
         predictor_attribution_method, analyst_config_version_id, instrument_config_version_id, computed_at
       )
       values (
         $1,$2,$3,$4,$5,$6,$7,
         $8,$9,$10,
         $11,$12,$13,
         $14,$15,$16,$17,
         $18,$19::jsonb,$20::jsonb,$21::jsonb,
         $22,$23,$24, now()
       )
       on conflict (evaluation_id) do nothing`,
      [
        randomUUID(),
        ev.eval_id,
        ev.prediction_id,
        ev.run_id,
        authorUserId,
        analystId,
        ev.instrument_id,
        ev.horizon_window,
        ev.prediction_date,
        ev.evaluation_date,
        ev.predicted_direction,
        ev.actual_direction,
        ev.was_correct,
        ev.confidence_at_prediction,
        pnlType,
        attributionMethod,
        pnlCents,
        calibrationScore,
        JSON.stringify(predictorIds),
        JSON.stringify(articleIds),
        JSON.stringify(sourceKeys),
        predictorAttributionMethod,
        ev.config_version_id,
        null,
      ],
    );
    if (insert.error) {
      throw new Error(insert.error.message);
    }
  }

  private async computePnl(predictionId: string): Promise<{
    attributionMethod: 'position' | 'calibration';
    pnlCents: number;
    pnlType: 'paper' | 'real';
  }> {
    const posResult = await this.db.rawQuery(
      `select realized_pnl, status from prediction.analyst_positions
        where prediction_id = $1 and status = 'closed' and realized_pnl is not null
       union all
       select realized_pnl, status from prediction.user_positions
        where prediction_id = $1 and status = 'closed' and realized_pnl is not null`,
      [predictionId],
    );
    if (posResult.error) {
      this.logger.warn(`Position lookup failed for ${predictionId}: ${posResult.error.message}`);
      return { attributionMethod: 'calibration', pnlCents: 0, pnlType: 'paper' };
    }
    const rows = (posResult.data as PositionRow[] | null) ?? [];
    if (rows.length === 0) {
      return { attributionMethod: 'calibration', pnlCents: 0, pnlType: 'paper' };
    }
    const totalDollars = rows.reduce((sum, r) => sum + Number(r.realized_pnl ?? 0), 0);
    const pnlCents = Math.round(totalDollars * 100);
    return { attributionMethod: 'position', pnlCents, pnlType: 'paper' };
  }

  private async findContributingPredictors(
    authorUserId: string | null,
    analystId: string,
    instrumentId: string,
    predictionDate: string,
    lookbackHours: number,
  ): Promise<PredictorRow[]> {
    const predResult = await this.db.rawQuery(
      `select mp.id, mp.article_id, ma.external_source_slug
         from prediction.market_predictors mp
         left join prediction.market_articles ma on ma.id = mp.article_id
        where coalesce(mp.author_user_id,'base') = coalesce($1,'base')
          and mp.scored_by_analyst_id = $2
          and mp.instrument_id = $3
          and mp.created_at >= ($4::timestamptz - ($5::int || ' hours')::interval)
          and mp.created_at <= $4::timestamptz
          and mp.status = 'active'`,
      [authorUserId, analystId, instrumentId, predictionDate, lookbackHours],
    );
    if (predResult.error) {
      this.logger.warn(`Predictor lookup failed: ${predResult.error.message}`);
      return [];
    }
    return (predResult.data as PredictorRow[] | null) ?? [];
  }

  private normalizeConfidence(raw: number | null | undefined): number {
    if (raw == null || Number.isNaN(Number(raw))) return 0;
    const n = Number(raw);
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }

  private getCutoffDate(): Date {
    const raw = process.env.ATTRIBUTION_CUTOFF_DATE ?? '2026-04-19';
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      this.logger.warn(`Invalid ATTRIBUTION_CUTOFF_DATE '${raw}', defaulting to 2026-04-19`);
      return new Date('2026-04-19');
    }
    return parsed;
  }

  private getPredictorLookbackHours(): number {
    const raw = process.env.ATTRIBUTION_PREDICTOR_LOOKBACK_HOURS;
    if (!raw) return 24;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return 24;
    return n;
  }
}
