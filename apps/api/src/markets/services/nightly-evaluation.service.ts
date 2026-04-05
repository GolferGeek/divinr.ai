import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { StocksPredictionPlane } from '@divinr/prediction-planes';
import type { PredictionPlaneEvaluation } from '@divinr/prediction-planes';
import { MarketsSchemaService } from '../schema/markets-schema.service';

interface PendingEvaluation {
  prediction_id: string;
  run_id: string;
  organization_slug: string;
  instrument_id: string;
  analyst_id: string | null;
  predicted_direction: 'up' | 'down' | 'flat';
  confidence: number;
  created_at: string;
  horizon_window: number;
}

interface EvaluationSummary {
  evaluated: number;
  correct: number;
  incorrect: number;
  canonicalCandidates: number;
  profilesUpdated: number;
}

/**
 * Nightly autonomous evaluation engine.
 *
 * Phase 1: Evaluate predictions at 1d/3d/5d horizon windows via prediction plane
 * Phase 2: Build/update analyst performance profiles, flag canonical day candidates
 *
 * Designed to run as a scheduled job (cron) or manually via CLI/endpoint.
 */
@Injectable()
export class NightlyEvaluationService {
  private readonly logger = new Logger(NightlyEvaluationService.name);
  private readonly planeEval: PredictionPlaneEvaluation;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    private readonly schema: MarketsSchemaService,
  ) {
    this.planeEval = new StocksPredictionPlane().evaluation;
  }

  /**
   * Cron-triggered nightly evaluation. Runs at midnight every day.
   * Can be disabled via MARKETS_DISABLE_NIGHTLY_CRON=true.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleNightlyCron(): Promise<void> {
    if (process.env.MARKETS_DISABLE_NIGHTLY_CRON === 'true') return;
    try {
      await this.runNightlyEvaluation();
    } catch (err) {
      this.logger.error(`Nightly evaluation cron failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Run the full nightly evaluation cycle.
   * Called by cron or manually via the admin endpoint.
   */
  async runNightlyEvaluation(): Promise<EvaluationSummary> {
    await this.schema.ensureSchema();
    this.logger.log('Starting nightly evaluation cycle');

    const horizons = await this.loadEvaluationHorizons();
    let totalEvaluated = 0;
    let totalCorrect = 0;
    let totalIncorrect = 0;
    let canonicalCandidates = 0;

    // Phase 1: Evaluate at each horizon window
    for (const horizon of horizons) {
      const pending = await this.findPendingEvaluations(horizon.value, horizon.unit);
      this.logger.log(`Horizon ${horizon.label}: ${pending.length} predictions to evaluate`);

      for (const pred of pending) {
        try {
          const predDate = new Date(pred.created_at);
          const evalDate = this.addHorizon(predDate, horizon.value, horizon.unit);

          // Only evaluate if the horizon has passed
          if (evalDate > new Date()) continue;

          const actual = await this.planeEval.evaluateOutcome(
            pred.instrument_id,
            predDate,
            evalDate,
          );
          const score = this.planeEval.scorePrediction(
            { direction: pred.predicted_direction, confidence: pred.confidence },
            actual,
          );

          // Persist evaluation record
          await this.persistHorizonEvaluation({
            predictionId: pred.prediction_id,
            runId: pred.run_id,
            organizationSlug: pred.organization_slug,
            instrumentId: pred.instrument_id,
            analystId: pred.analyst_id,
            horizonWindow: horizon.value,
            predictionDate: pred.created_at,
            evaluationDate: evalDate.toISOString(),
            predictedDirection: pred.predicted_direction,
            actualDirection: actual.direction,
            actualOutcomeData: actual.data,
            wasCorrect: score.wasCorrect,
            confidenceAtPrediction: pred.confidence,
          });

          // Write to analyst memory
          if (pred.analyst_id) {
            await this.writeAnalystMemory({
              analystId: pred.analyst_id,
              organizationSlug: pred.organization_slug,
              instrumentId: pred.instrument_id,
              symbol: await this.getInstrumentSymbol(pred.instrument_id),
              predictedDirection: pred.predicted_direction,
              actualDirection: actual.direction,
              wasCorrect: score.wasCorrect,
              confidence: pred.confidence,
              runId: pred.run_id,
            });
          }

          totalEvaluated++;
          if (score.wasCorrect) totalCorrect++;
          else totalIncorrect++;
        } catch (err) {
          this.logger.warn(
            `Failed to evaluate prediction ${pred.prediction_id} at ${horizon.label}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Phase 2: Build performance profiles and flag canonical candidates
    const profilesUpdated = await this.updatePerformanceProfiles();
    canonicalCandidates = await this.flagCanonicalCandidates();

    const summary: EvaluationSummary = {
      evaluated: totalEvaluated,
      correct: totalCorrect,
      incorrect: totalIncorrect,
      canonicalCandidates,
      profilesUpdated,
    };

    // Persist report for dashboard consumption
    await this.persistReport('nightly_evaluation', summary as unknown as Record<string, unknown>);

    this.logger.log(
      `Nightly evaluation complete: ${totalEvaluated} evaluated, ${totalCorrect} correct, ${totalIncorrect} incorrect, ${canonicalCandidates} canonical candidates, ${profilesUpdated} profiles updated`,
    );

    return summary;
  }

  // ─── Phase 1: Evaluation ─────────────────────────────────────

  private async findPendingEvaluations(
    horizonDays: number,
    _unit: string,
  ): Promise<PendingEvaluation[]> {
    // Find predictions that were created N days ago and haven't been evaluated at this horizon
    const result = await this.db.rawQuery(
      `select
         mp.id as prediction_id,
         mp.run_id,
         mp.organization_slug,
         mp.instrument_id,
         mp.analyst_id,
         mp.predicted_direction,
         mp.confidence,
         mp.created_at
       from prediction.market_predictions mp
       where mp.created_at <= now() - ($1 || ' days')::interval
         and mp.created_at >= now() - ($1 + 1 || ' days')::interval
         and mp.role in ('analyst', 'arbitrator')
         and not exists (
           select 1 from prediction.prediction_horizon_evaluations phe
           where phe.prediction_id = mp.id and phe.horizon_window = $1
         )
       order by mp.organization_slug, mp.instrument_id`,
      [horizonDays],
    );
    if (result.error) {
      this.logger.warn(`Failed to find pending evaluations: ${result.error.message}`);
      return [];
    }
    return (result.data as PendingEvaluation[] | null) ?? [];
  }

  private async persistHorizonEvaluation(input: {
    predictionId: string;
    runId: string;
    organizationSlug: string;
    instrumentId: string;
    analystId: string | null;
    horizonWindow: number;
    predictionDate: string;
    evaluationDate: string;
    predictedDirection: string;
    actualDirection: string;
    actualOutcomeData: Record<string, unknown>;
    wasCorrect: boolean;
    confidenceAtPrediction: number;
  }): Promise<void> {
    const result = await this.db.rawQuery(
      `insert into prediction.prediction_horizon_evaluations
        (id, prediction_id, run_id, organization_slug, instrument_id, analyst_id,
         horizon_window, prediction_date, evaluation_date,
         predicted_direction, actual_direction, actual_outcome_data,
         was_correct, confidence_at_prediction, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       on conflict do nothing`,
      [
        randomUUID(), input.predictionId, input.runId, input.organizationSlug,
        input.instrumentId, input.analystId, input.horizonWindow,
        input.predictionDate, input.evaluationDate,
        input.predictedDirection, input.actualDirection,
        JSON.stringify(input.actualOutcomeData),
        input.wasCorrect, input.confidenceAtPrediction, new Date().toISOString(),
      ],
    );
    if (result.error) {
      this.logger.warn(`Failed to persist evaluation: ${result.error.message}`);
    }
  }

  private async loadEvaluationHorizons(): Promise<Array<{ value: number; unit: 'hours' | 'days' | 'weeks'; label: string }>> {
    // Try loading from the active universe configs
    try {
      const result = await this.db.rawQuery(
        `select distinct default_evaluation_horizons, horizon_unit
         from prediction.universes where is_active = true limit 1`,
      );
      const rows = (result.data as Array<{ default_evaluation_horizons: number[]; horizon_unit: 'hours' | 'days' | 'weeks' }> | null) ?? [];
      if (rows.length > 0 && Array.isArray(rows[0].default_evaluation_horizons)) {
        const unit = rows[0].horizon_unit;
        return rows[0].default_evaluation_horizons.map((v) => ({
          value: v,
          unit,
          label: `${v} ${unit}`,
        }));
      }
    } catch {
      // Fall through to plane defaults
    }
    return this.planeEval.getDefaultHorizons();
  }

  private addHorizon(date: Date, value: number, unit: string): Date {
    const result = new Date(date);
    if (unit === 'hours') result.setHours(result.getHours() + value);
    else if (unit === 'weeks') result.setDate(result.getDate() + value * 7);
    else result.setDate(result.getDate() + value);
    return result;
  }

  // ─── Phase 2: Profiling ──────────────────────────────────────

  private async updatePerformanceProfiles(): Promise<number> {
    // Compute rolling accuracy for each analyst × instrument × horizon × period
    const result = await this.db.rawQuery(`
      insert into prediction.analyst_performance_profiles
        (id, analyst_id, organization_slug, instrument_id, horizon_window, period,
         accuracy_rate, avg_confidence, calibration_score, systematic_biases, sample_size, computed_at)
      select
        gen_random_uuid()::text,
        phe.analyst_id,
        phe.organization_slug,
        phe.instrument_id,
        phe.horizon_window,
        '30d',
        avg(case when phe.was_correct then 1.0 else 0.0 end),
        avg(phe.confidence_at_prediction),
        1.0 - avg(abs(
          (case when phe.was_correct then 1.0 else 0.0 end) -
          (phe.confidence_at_prediction / 100.0)
        )),
        jsonb_build_object(
          'bullish_accuracy', avg(case when phe.predicted_direction = 'up' and phe.was_correct then 1.0 when phe.predicted_direction = 'up' then 0.0 else null end),
          'bearish_accuracy', avg(case when phe.predicted_direction = 'down' and phe.was_correct then 1.0 when phe.predicted_direction = 'down' then 0.0 else null end)
        ),
        count(*)::int,
        now()
      from prediction.prediction_horizon_evaluations phe
      where phe.analyst_id is not null
        and phe.created_at >= now() - interval '30 days'
      group by phe.analyst_id, phe.organization_slug, phe.instrument_id, phe.horizon_window
      on conflict do nothing
    `);
    if (result.error) {
      this.logger.warn(`Failed to update profiles: ${result.error.message}`);
      return 0;
    }
    const rows = (result.data as Array<Record<string, unknown>> | null) ?? [];
    return rows.length;
  }

  private async flagCanonicalCandidates(): Promise<number> {
    // Find predictions that were wrong at ALL evaluated horizons with high confidence
    const result = await this.db.rawQuery(`
      with multi_horizon_failures as (
        select
          phe.prediction_id,
          phe.organization_slug,
          phe.instrument_id,
          min(phe.prediction_date) as prediction_date,
          count(*) as horizons_evaluated,
          count(*) filter (where not phe.was_correct) as horizons_wrong,
          max(phe.confidence_at_prediction) as max_confidence
        from prediction.prediction_horizon_evaluations phe
        group by phe.prediction_id, phe.organization_slug, phe.instrument_id
        having count(*) >= 2
          and count(*) filter (where not phe.was_correct) = count(*)
          and max(phe.confidence_at_prediction) >= 70
      )
      select * from multi_horizon_failures
      where not exists (
        select 1 from prediction.canonical_test_days ctd
        where ctd.organization_slug = multi_horizon_failures.organization_slug
          and ctd.instrument_id = multi_horizon_failures.instrument_id
          and ctd.canonical_date = multi_horizon_failures.prediction_date::date
      )
    `);
    if (result.error) {
      this.logger.warn(`Failed to find canonical candidates: ${result.error.message}`);
      return 0;
    }

    const candidates = (result.data as Array<{
      prediction_id: string;
      organization_slug: string;
      instrument_id: string;
      prediction_date: string;
      horizons_wrong: number;
      max_confidence: number;
    }> | null) ?? [];

    // Insert canonical day candidates
    for (const c of candidates) {
      await this.db.rawQuery(
        `insert into prediction.canonical_test_days
          (id, instrument_id, organization_slug, universe_slug, canonical_date,
           failure_classification, test_scope, is_active, added_by, added_at)
         values ($1, $2, $3, 'stocks', $4,
           $5, 'prediction', true, 'nightly-evaluation', $6)
         on conflict do nothing`,
        [
          randomUUID(), c.instrument_id, c.organization_slug,
          new Date(c.prediction_date).toISOString().slice(0, 10),
          `Wrong at all ${c.horizons_wrong} horizons with ${c.max_confidence}% confidence`,
          new Date().toISOString(),
        ],
      );
    }

    return candidates.length;
  }

  private async persistReport(reportType: string, summary: Record<string, unknown>): Promise<void> {
    try {
      await this.db.rawQuery(
        `insert into prediction.learning_reports (id, report_type, report_date, summary, created_at)
         values ($1, $2, current_date, $3, now())`,
        [randomUUID(), reportType, JSON.stringify(summary)],
      );
    } catch (err) {
      this.logger.warn(`Failed to persist report: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Analyst Memory Writing ─────────────────────────────────

  private async getInstrumentSymbol(instrumentId: string): Promise<string> {
    const result = await this.db.rawQuery(
      `select symbol from prediction.instruments where id = $1`,
      [instrumentId],
    );
    const rows = (result.data as Array<{ symbol: string }> | null) ?? [];
    return rows[0]?.symbol ?? instrumentId;
  }

  private async writeAnalystMemory(input: {
    analystId: string;
    organizationSlug: string;
    instrumentId: string;
    symbol: string;
    predictedDirection: string;
    actualDirection: string;
    wasCorrect: boolean;
    confidence: number;
    runId: string;
  }): Promise<void> {
    const now = new Date().toISOString();

    try {
      // 1. Update memory_calibration — increment predictions_made, update correct count and confidence bands
      const band = input.confidence < 25 ? '0-25'
        : input.confidence < 50 ? '25-50'
        : input.confidence < 75 ? '50-75'
        : '75-100';

      await this.db.rawQuery(`
        update prediction.market_analysts
        set memory_calibration = jsonb_set(
          jsonb_set(
            jsonb_set(
              memory_calibration,
              '{predictions_made}',
              to_jsonb(coalesce((memory_calibration->>'predictions_made')::int, 0) + 1)
            ),
            '{correct}',
            to_jsonb(coalesce((memory_calibration->>'correct')::int, 0) + $1::int)
          ),
          $2::text[],
          to_jsonb(coalesce((memory_calibration #>> $2::text[])::int, 0) + 1)
        ),
        updated_at = now()
        where id = $3
      `, [input.wasCorrect ? 1 : 0, `{by_confidence_band,${band}}`, input.analystId]);

      // 2. memory_corrections — when prediction is wrong
      if (!input.wasCorrect) {
        const correction = JSON.stringify({
          correction: `Predicted ${input.predictedDirection} for ${input.symbol} at ${input.confidence}% but actual was ${input.actualDirection}`,
          source_run_id: input.runId,
          created_at: now,
        });

        // Append to array, cap at 10
        await this.db.rawQuery(`
          update prediction.market_analysts
          set memory_corrections = (
            select jsonb_agg(elem)
            from (
              select elem from jsonb_array_elements(
                memory_corrections || $1::jsonb
              ) as elem
              order by elem->>'created_at' desc
              limit 10
            ) sub
          ),
          updated_at = now()
          where id = $2
        `, [`[${correction}]`, input.analystId]);
      }

      // 3. memory_patterns — when prediction is correct on a non-obvious call (confidence < 70)
      if (input.wasCorrect && input.confidence < 70) {
        const pattern = JSON.stringify({
          pattern: `Correctly predicted ${input.predictedDirection} for ${input.symbol} at ${input.confidence}% confidence`,
          instruments: [input.symbol],
          confidence: input.confidence / 100,
          source_run_id: input.runId,
          created_at: now,
        });

        // Append to array, cap at 20
        await this.db.rawQuery(`
          update prediction.market_analysts
          set memory_patterns = (
            select jsonb_agg(elem)
            from (
              select elem from jsonb_array_elements(
                memory_patterns || $1::jsonb
              ) as elem
              order by elem->>'created_at' desc
              limit 20
            ) sub
          ),
          updated_at = now()
          where id = $2
        `, [`[${pattern}]`, input.analystId]);
      }

      // 4. memory_instrument_notes — add note for this instrument
      const note = JSON.stringify({
        note: `${input.wasCorrect ? 'Correct' : 'Incorrect'}: predicted ${input.predictedDirection} (${input.confidence}%), actual ${input.actualDirection}`,
        created_at: now,
      });

      // Get existing notes for this symbol, append, cap at 10
      await this.db.rawQuery(`
        update prediction.market_analysts
        set memory_instrument_notes = jsonb_set(
          memory_instrument_notes,
          $1::text[],
          (
            select coalesce(jsonb_agg(elem), '[]'::jsonb)
            from (
              select elem from jsonb_array_elements(
                coalesce(memory_instrument_notes->$2, '[]'::jsonb) || $3::jsonb
              ) as elem
              order by elem->>'created_at' desc
              limit 10
            ) sub
          )
        ),
        updated_at = now()
        where id = $4
      `, [`{${input.symbol}}`, input.symbol, `[${note}]`, input.analystId]);
    } catch (err) {
      this.logger.warn(
        `Failed to write memory for analyst ${input.analystId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
