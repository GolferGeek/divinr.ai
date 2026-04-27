import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsSchemaService } from '../schema/markets-schema.service';

@Injectable()
export class CoordinationService {
  private readonly logger = new Logger(CoordinationService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
  ) {}

  // ─── Scheduling ───────────────────────────────────────────────

  @Cron('0 2 * * 0') // Sunday 2 AM
  async handleWeeklyCron(): Promise<void> {
    if (process.env.MARKETS_DISABLE_COORDINATION_CRON === 'true') return;
    this.logger.log('Weekly coordination cron starting');
    await this.computeAll();
    this.logger.log('Weekly coordination cron complete');
  }

  async computeAll(): Promise<{ status: string; computed_at: string }> {
    const start = Date.now();
    const periods = ['30d', '90d', 'all'];
    for (const period of periods) {
      await this.computeCorrelations(period);
      await this.computeCoverage(period);
      await this.computeContributions(period);
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    this.logger.log(`computeAll complete in ${elapsed}s`);
    return { status: 'completed', computed_at: new Date().toISOString() };
  }

  // ─── Correlation Analysis ─────────────────────────────────────

  async computeCorrelations(period: string): Promise<number> {
    const cutoff = this.periodToCutoff(period);

    // Find all analyst pairs that share prediction runs and compute agreement rate.
    // We pair analysts by matching on the same run_id (same prediction run),
    // then check if they predicted the same direction.
    const sql = `
      with pair_evals as (
        select
          case when e1.analyst_id < e2.analyst_id then e1.analyst_id else e2.analyst_id end as analyst_a_id,
          case when e1.analyst_id < e2.analyst_id then e2.analyst_id else e1.analyst_id end as analyst_b_id,
          e1.instrument_id,
          e1.horizon_window,
          case when e1.predicted_direction = e2.predicted_direction then 1 else 0 end as agreed
        from prediction.prediction_horizon_evaluations e1
        join prediction.prediction_horizon_evaluations e2
          on e1.run_id = e2.run_id
          and e1.instrument_id = e2.instrument_id
          and e1.horizon_window = e2.horizon_window
          and e1.analyst_id < e2.analyst_id
        where e1.analyst_id is not null
          and e2.analyst_id is not null
          ${cutoff ? `and e1.created_at >= $1` : ''}
      ),
      agg as (
        select
          analyst_a_id,
          analyst_b_id,
          null::text as instrument_id,
          null::integer as horizon_window,
          avg(agreed::numeric) as agreement_rate,
          count(*) as sample_size
        from pair_evals
        group by analyst_a_id, analyst_b_id
        having count(*) >= 5
      )
      insert into prediction.analyst_pair_correlations
        (analyst_a_id, analyst_b_id, instrument_id, horizon_window, period, agreement_rate, sample_size, flag, computed_at)
      select
        analyst_a_id,
        analyst_b_id,
        instrument_id,
        horizon_window,
        $${cutoff ? '2' : '1'}::text as period,
        round(agreement_rate, 4),
        sample_size,
        case
          when agreement_rate > 0.90 then 'redundant'
          when agreement_rate < 0.20 then 'adversarial'
          else null
        end as flag,
        now()
      from agg
      on conflict (analyst_a_id, analyst_b_id, instrument_id, horizon_window, period)
      do update set
        agreement_rate = excluded.agreement_rate,
        sample_size = excluded.sample_size,
        flag = excluded.flag,
        computed_at = excluded.computed_at
    `;

    const params: unknown[] = [];
    if (cutoff) params.push(cutoff);
    params.push(period);

    const result = await this.db.rawQuery(sql, params);
    if (result.error) {
      this.logger.error(`computeCorrelations failed: ${result.error.message}`);
      throw new Error(`Correlation computation failed: ${result.error.message}`);
    }

    const count = Array.isArray(result.data) ? result.data.length : 0;
    this.logger.log(`Computed ${count} correlation pairs for period=${period}`);
    return count;
  }

  async getCorrelations(
    period: string,
    instrumentId?: string,
    flagOnly?: boolean,
  ): Promise<unknown[]> {

    const conditions = ['c.period = $1'];
    const params: unknown[] = [period];
    let idx = 2;

    if (instrumentId) {
      conditions.push(`c.instrument_id = $${idx}`);
      params.push(instrumentId);
      idx++;
    } else {
      conditions.push('c.instrument_id is null');
    }

    if (flagOnly) {
      conditions.push('c.flag is not null');
    }

    const sql = `
      select
        c.*,
        a.display_name as analyst_a_name,
        b.display_name as analyst_b_name
      from prediction.analyst_pair_correlations c
      left join prediction.market_analysts a on a.id = c.analyst_a_id
      left join prediction.market_analysts b on b.id = c.analyst_b_id
      where ${conditions.join(' and ')}
      order by c.agreement_rate desc
    `;

    const result = await this.db.rawQuery(sql, params);
    return (result.data as unknown[]) ?? [];
  }

  // ─── Coverage Analysis ─────────────────────────────────────────

  async computeCoverage(period: string): Promise<number> {
    const cutoff = this.periodToCutoff(period);

    const sql = `
      with per_analyst as (
        select
          instrument_id,
          analyst_id,
          count(*) filter (where was_correct) as correct,
          count(*) as total
        from prediction.prediction_horizon_evaluations
        where analyst_id is not null
          ${cutoff ? `and created_at >= $1` : ''}
        group by instrument_id, analyst_id
      ),
      per_instrument as (
        select
          instrument_id,
          null::integer as horizon_window,
          count(distinct analyst_id) as analyst_count,
          round(avg(correct::numeric / nullif(total, 0)), 4) as avg_accuracy,
          (array_agg(analyst_id order by correct::numeric / nullif(total, 0) desc nulls last))[1] as best_analyst_id,
          max(correct::numeric / nullif(total, 0)) as best_accuracy
        from per_analyst
        group by instrument_id
      )
      insert into prediction.analyst_coverage_gaps
        (instrument_id, horizon_window, period, best_analyst_id, best_accuracy, analyst_count, avg_accuracy, is_gap, computed_at)
      select
        instrument_id,
        horizon_window,
        $${cutoff ? '2' : '1'}::text as period,
        best_analyst_id,
        round(best_accuracy, 4),
        analyst_count,
        avg_accuracy,
        (avg_accuracy < 0.50 or analyst_count < 2) as is_gap,
        now()
      from per_instrument
      on conflict (instrument_id, horizon_window, period)
      do update set
        best_analyst_id = excluded.best_analyst_id,
        best_accuracy = excluded.best_accuracy,
        analyst_count = excluded.analyst_count,
        avg_accuracy = excluded.avg_accuracy,
        is_gap = excluded.is_gap,
        computed_at = excluded.computed_at
    `;

    const params: unknown[] = [];
    if (cutoff) params.push(cutoff);
    params.push(period);

    const result = await this.db.rawQuery(sql, params);
    if (result.error) {
      this.logger.error(`computeCoverage failed: ${result.error.message}`);
      throw new Error(`Coverage computation failed: ${result.error.message}`);
    }

    const count = Array.isArray(result.data) ? result.data.length : 0;
    this.logger.log(`Computed ${count} coverage entries for period=${period}`);
    return count;
  }

  async getCoverage(period: string, gapsOnly?: boolean): Promise<unknown[]> {

    const conditions = ['g.period = $1'];
    const params: unknown[] = [period];

    if (gapsOnly) {
      conditions.push('g.is_gap = true');
    }

    const sql = `
      select
        g.*,
        i.symbol as instrument_symbol,
        a.display_name as best_analyst_name
      from prediction.analyst_coverage_gaps g
      left join prediction.instruments i on i.id = g.instrument_id
      left join prediction.market_analysts a on a.id = g.best_analyst_id
      where ${conditions.join(' and ')}
      order by g.avg_accuracy asc
    `;

    const result = await this.db.rawQuery(sql, params);
    return (result.data as unknown[]) ?? [];
  }

  // ─── Contribution Scoring ─────────────────────────────────────

  async computeContributions(period: string): Promise<number> {
    const cutoff = this.periodToCutoff(period);

    // Step 1: Get all evaluated runs with their analyst predictions and arbitrator outcome.
    // Uses evaluation table directly (both arbitrator and analyst rows) instead of
    // joining to market_predictions, which may not have matching run_ids for
    // nightly-evaluation-seeded data.
    const fetchSql = `
      select
        e_arb.run_id,
        e_arb.instrument_id,
        e_arb.was_correct as arbitrator_correct,
        e_arb.actual_direction,
        array_agg(json_build_object(
          'analyst_id', e_analyst.analyst_id,
          'direction', e_analyst.predicted_direction
        )) as analyst_predictions
      from prediction.prediction_horizon_evaluations e_arb
      join prediction.prediction_horizon_evaluations e_analyst
        on e_analyst.run_id = e_arb.run_id
        and e_analyst.instrument_id = e_arb.instrument_id
        and e_analyst.horizon_window = e_arb.horizon_window
        and e_analyst.analyst_id is not null
      where e_arb.analyst_id is null
        ${cutoff ? `and e_arb.created_at >= $1` : ''}
      group by e_arb.run_id, e_arb.instrument_id, e_arb.was_correct, e_arb.actual_direction
      having count(e_analyst.id) >= 2
    `;

    const fetchParams: unknown[] = [];
    if (cutoff) fetchParams.push(cutoff);

    const fetchResult = await this.db.rawQuery(fetchSql, fetchParams);
    if (fetchResult.error) {
      this.logger.error(`computeContributions fetch failed: ${fetchResult.error.message}`);
      throw new Error(`Contribution fetch failed: ${fetchResult.error.message}`);
    }

    const runs = (fetchResult.data as Array<{
      run_id: string;
      instrument_id: string;
      arbitrator_correct: boolean;
      actual_direction: string;
      analyst_predictions: Array<{ analyst_id: string; direction: string }>;
    }>) ?? [];

    if (runs.length === 0) {
      this.logger.log('No evaluated runs found for contribution scoring');
      return 0;
    }

    // Step 2: For each analyst, compute leave-one-out accuracy.
    const analystIds = new Set<string>();
    for (const run of runs) {
      for (const pred of run.analyst_predictions) {
        analystIds.add(pred.analyst_id);
      }
    }

    const scores: Array<{
      analyst_id: string;
      composite_with: number;
      composite_without: number;
      marginal: number;
      count: number;
    }> = [];

    for (const analystId of analystIds) {
      const relevantRuns = runs.filter(r =>
        r.analyst_predictions.some(p => p.analyst_id === analystId),
      );
      if (relevantRuns.length === 0) continue;

      let actualCorrect = 0;
      let simulatedCorrect = 0;

      for (const run of relevantRuns) {
        if (run.arbitrator_correct) actualCorrect++;

        // Majority vote without target analyst
        const others = run.analyst_predictions.filter(p => p.analyst_id !== analystId);
        if (others.length === 0) continue;
        const ups = others.filter(p => p.direction === 'up').length;
        const downs = others.filter(p => p.direction === 'down').length;
        const simDirection = ups > downs ? 'up' : downs > ups ? 'down' : 'flat';
        if (simDirection === run.actual_direction) simulatedCorrect++;
      }

      const compositeWith = actualCorrect / relevantRuns.length;
      const compositeWithout = simulatedCorrect / relevantRuns.length;

      scores.push({
        analyst_id: analystId,
        composite_with: compositeWith,
        composite_without: compositeWithout,
        marginal: compositeWith - compositeWithout,
        count: relevantRuns.length,
      });
    }

    // Step 3: Upsert into contribution scores table.
    let upserted = 0;
    for (const s of scores) {
      const upsertSql = `
        insert into prediction.analyst_contribution_scores
          (analyst_id, instrument_id, period, composite_accuracy_with, composite_accuracy_without, marginal_contribution, prediction_count, computed_at)
        values ($1, null, $2, $3, $4, $5, $6, now())
        on conflict (analyst_id, instrument_id, period)
        do update set
          composite_accuracy_with = excluded.composite_accuracy_with,
          composite_accuracy_without = excluded.composite_accuracy_without,
          marginal_contribution = excluded.marginal_contribution,
          prediction_count = excluded.prediction_count,
          computed_at = excluded.computed_at
      `;
      const upsertResult = await this.db.rawQuery(upsertSql, [
        s.analyst_id, period,
        Math.round(s.composite_with * 10000) / 10000,
        Math.round(s.composite_without * 10000) / 10000,
        Math.round(s.marginal * 10000) / 10000,
        s.count,
      ]);
      if (!upsertResult.error) upserted++;
    }

    this.logger.log(`Computed ${upserted} contribution scores for period=${period}`);
    return upserted;
  }

  async getContributions(period: string, instrumentId?: string): Promise<unknown[]> {

    const conditions = ['s.period = $1'];
    const params: unknown[] = [period];
    let idx = 2;

    if (instrumentId) {
      conditions.push(`s.instrument_id = $${idx}`);
      params.push(instrumentId);
    } else {
      conditions.push('s.instrument_id is null');
    }

    const sql = `
      select
        s.*,
        a.display_name as analyst_name
      from prediction.analyst_contribution_scores s
      left join prediction.market_analysts a on a.id = s.analyst_id
      where ${conditions.join(' and ')}
      order by s.marginal_contribution desc
    `;

    const result = await this.db.rawQuery(sql, params);
    return (result.data as unknown[]) ?? [];
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private periodToCutoff(period: string): string | null {
    if (period === '30d') return new Date(Date.now() - 30 * 86400000).toISOString();
    if (period === '90d') return new Date(Date.now() - 90 * 86400000).toISOString();
    return null; // 'all'
  }
}
