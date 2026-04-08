import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

export interface PortfolioSummaryRow {
  kind: 'user' | 'analyst' | 'arbitrator' | 'day_trader';
  id: string;
  name: string;
  current_balance: number;
  realized_pnl: number;
  unrealized_pnl: number;
  win_rate: number | null;
  total_return_pct: number;
  total_bailouts: number;
  open_position_count: number;
  sharpe_30d: number | null;
  max_drawdown_30d: number | null;
  longest_win_streak: number;
  calibration_score: number | null;
}

export interface CalibrationBucket {
  bucket_min: number;
  bucket_max: number;
  predicted_avg: number;
  realized_rate: number;
  count: number;
}

const CALIBRATION_BOUNDARIES: Array<[number, number]> = [
  [50, 60],
  [60, 70],
  [70, 80],
  [80, 90],
  [90, 101], // upper-inclusive sentinel
];
const MIN_CALIBRATION_SAMPLE = 20;

/**
 * Cross-actor leaderboard / master-detail read API.
 * Joins analyst_portfolios (analyst|arbitrator|day_trader) + user_portfolios.
 */
@Injectable()
export class LeaderboardService {
  constructor(@Inject(DATABASE_SERVICE) private readonly db: DatabaseService) {}

  async getAllPortfoliosSummary(): Promise<PortfolioSummaryRow[]> {
    const sql = `
      with snap as (
        select portfolio_kind, portfolio_id, snapshot_date, ending_balance::float8 as ending
        from prediction.daily_pnl_snapshot
        where snapshot_date >= current_date - interval '30 days'
      ),
      snap_returns as (
        select
          portfolio_kind, portfolio_id, snapshot_date, ending,
          ending / nullif(lag(ending) over (partition by portfolio_kind, portfolio_id order by snapshot_date), 0) - 1 as daily_return,
          max(ending) over (partition by portfolio_kind, portfolio_id order by snapshot_date rows between unbounded preceding and current row) as running_peak
        from snap
      ),
      snap_metrics as (
        select
          portfolio_kind,
          portfolio_id,
          count(*)::int as snap_count,
          case
            when count(daily_return) >= 10 and stddev_samp(daily_return) > 0
            then (avg(daily_return) / stddev_samp(daily_return)) * sqrt(252)
            else null
          end as sharpe_30d,
          case
            when count(*) >= 10
            then min(ending / nullif(running_peak, 0) - 1)
            else null
          end as max_drawdown_30d
        from snap_returns
        group by portfolio_kind, portfolio_id
      ),
      analyst_pos_seq as (
        select
          portfolio_id,
          case when realized_pnl > 0 then 1 else 0 end as is_win,
          row_number() over (partition by portfolio_id order by closed_at) -
          row_number() over (partition by portfolio_id, case when realized_pnl > 0 then 1 else 0 end order by closed_at) as grp
        from prediction.analyst_positions
        where status = 'closed' and closed_at is not null
      ),
      analyst_streaks as (
        select portfolio_id, coalesce(max(streak_len), 0)::int as longest_win_streak
        from (
          select portfolio_id, count(*) as streak_len
          from analyst_pos_seq
          where is_win = 1
          group by portfolio_id, grp
        ) s
        group by portfolio_id
      ),
      user_pos_seq as (
        select
          portfolio_id,
          case when realized_pnl > 0 then 1 else 0 end as is_win,
          row_number() over (partition by portfolio_id order by closed_at) -
          row_number() over (partition by portfolio_id, case when realized_pnl > 0 then 1 else 0 end order by closed_at) as grp
        from prediction.user_positions
        where status = 'closed' and closed_at is not null
      ),
      user_streaks as (
        select portfolio_id, coalesce(max(streak_len), 0)::int as longest_win_streak
        from (
          select portfolio_id, count(*) as streak_len
          from user_pos_seq
          where is_win = 1
          group by portfolio_id, grp
        ) s
        group by portfolio_id
      ),
      calibration as (
        select
          analyst_id,
          count(*)::int as resolved_count,
          1.0 - avg(abs((case when was_correct then 1.0 else 0.0 end) - (confidence_at_prediction / 100.0))) as calibration_score
        from prediction.prediction_horizon_evaluations
        where analyst_id is not null and confidence_at_prediction is not null
        group by analyst_id
      ),
      analyst_rows as (
        select
          ap.kind as kind,
          ap.id as id,
          coalesce(ma.display_name, ap.strategy_name, ap.analyst_id) as name,
          ap.current_balance::float8 as current_balance,
          ap.initial_balance::float8 as initial_balance,
          ap.total_realized_pnl::float8 as realized_pnl,
          coalesce((
            select sum(pos.unrealized_pnl)
            from prediction.analyst_positions pos
            where pos.portfolio_id = ap.id and pos.status = 'open'
          ), 0)::float8 as unrealized_pnl,
          (
            select count(*)::int from prediction.analyst_positions pos
            where pos.portfolio_id = ap.id and pos.status = 'closed' and pos.realized_pnl > 0
          ) as wins,
          (
            select count(*)::int from prediction.analyst_positions pos
            where pos.portfolio_id = ap.id and pos.status = 'closed'
          ) as closed_count,
          coalesce((
            select sum(bl.topup_amount) from prediction.bailout_ledger bl
            where bl.portfolio_kind = 'analyst' and bl.portfolio_id = ap.id
          ), 0)::float8 as total_bailouts,
          (
            select count(*)::int from prediction.analyst_positions pos
            where pos.portfolio_id = ap.id and pos.status = 'open'
          ) as open_position_count,
          sm.sharpe_30d,
          sm.max_drawdown_30d,
          coalesce(ast.longest_win_streak, 0) as longest_win_streak,
          case
            when ap.kind = 'analyst' and cal.resolved_count >= ${MIN_CALIBRATION_SAMPLE}
            then cal.calibration_score
            else null
          end as calibration_score
        from prediction.analyst_portfolios ap
        left join prediction.market_analysts ma on ma.id = ap.analyst_id
        left join snap_metrics sm on sm.portfolio_kind = 'analyst' and sm.portfolio_id = ap.id
        left join analyst_streaks ast on ast.portfolio_id = ap.id
        left join calibration cal on cal.analyst_id = ap.analyst_id
      ),
      user_rows as (
        select
          'user'::text as kind,
          up.id as id,
          up.user_id as name,
          up.current_balance::float8 as current_balance,
          up.initial_balance::float8 as initial_balance,
          up.total_realized_pnl::float8 as realized_pnl,
          coalesce((
            select sum(pos.unrealized_pnl)
            from prediction.user_positions pos
            where pos.portfolio_id = up.id and pos.status = 'open'
          ), 0)::float8 as unrealized_pnl,
          (
            select count(*)::int from prediction.user_positions pos
            where pos.portfolio_id = up.id and pos.status = 'closed' and pos.realized_pnl > 0
          ) as wins,
          (
            select count(*)::int from prediction.user_positions pos
            where pos.portfolio_id = up.id and pos.status = 'closed'
          ) as closed_count,
          coalesce((
            select sum(bl.topup_amount) from prediction.bailout_ledger bl
            where bl.portfolio_kind = 'user' and bl.portfolio_id = up.id
          ), 0)::float8 as total_bailouts,
          (
            select count(*)::int from prediction.user_positions pos
            where pos.portfolio_id = up.id and pos.status = 'open'
          ) as open_position_count,
          sm.sharpe_30d,
          sm.max_drawdown_30d,
          coalesce(ust.longest_win_streak, 0) as longest_win_streak,
          null::float8 as calibration_score
        from prediction.user_portfolios up
        left join snap_metrics sm on sm.portfolio_kind = 'user' and sm.portfolio_id = up.id
        left join user_streaks ust on ust.portfolio_id = up.id
      )
      select * from analyst_rows
      union all
      select * from user_rows
    `;
    const result = await this.db.rawQuery(sql, []);
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<Record<string, unknown>> | null) ?? [];
    return rows.map((r) => {
      const closed = Number(r.closed_count ?? 0);
      const wins = Number(r.wins ?? 0);
      const initial = Number(r.initial_balance ?? 0);
      const balance = Number(r.current_balance ?? 0);
      const realized = Number(r.realized_pnl ?? 0);
      const bailouts = Number(r.total_bailouts ?? 0);
      const totalReturnPct =
        initial > 0 ? ((balance + bailouts - initial) / initial) * 100 : 0;
      return {
        kind: r.kind as PortfolioSummaryRow['kind'],
        id: String(r.id),
        name: String(r.name ?? r.id),
        current_balance: balance,
        realized_pnl: realized,
        unrealized_pnl: Number(r.unrealized_pnl ?? 0),
        win_rate: closed > 0 ? (wins / closed) * 100 : null,
        total_return_pct: totalReturnPct,
        total_bailouts: bailouts,
        open_position_count: Number(r.open_position_count ?? 0),
        sharpe_30d: r.sharpe_30d == null ? null : Number(r.sharpe_30d),
        max_drawdown_30d: r.max_drawdown_30d == null ? null : Number(r.max_drawdown_30d),
        longest_win_streak: Number(r.longest_win_streak ?? 0),
        calibration_score: r.calibration_score == null ? null : Number(r.calibration_score),
      };
    });
  }

  /**
   * Per-analyst calibration: returns 5 buckets at conviction boundaries
   * 50/60/70/80/90% with predicted_avg, realized_rate, and count.
   * Returns null score when fewer than MIN_CALIBRATION_SAMPLE resolved evaluations.
   */
  async computeCalibration(analystId: string): Promise<{
    score: number | null;
    buckets: CalibrationBucket[];
  }> {
    const res = await this.db.rawQuery(
      `select confidence_at_prediction::float8 as conf,
              case when was_correct then 1 else 0 end as hit
       from prediction.prediction_horizon_evaluations
       where analyst_id = $1 and confidence_at_prediction is not null`,
      [analystId],
    );
    if (res.error) throw new Error(res.error.message);
    const rows = (res.data as Array<{ conf: number; hit: number }> | null) ?? [];

    const buckets: CalibrationBucket[] = CALIBRATION_BOUNDARIES.map(([lo, hi]) => ({
      bucket_min: lo,
      bucket_max: hi === 101 ? 100 : hi,
      predicted_avg: 0,
      realized_rate: 0,
      count: 0,
    }));
    const sums = CALIBRATION_BOUNDARIES.map(() => ({ confSum: 0, hitSum: 0, n: 0 }));

    for (const row of rows) {
      const conf = Number(row.conf);
      const hit = Number(row.hit);
      const idx = CALIBRATION_BOUNDARIES.findIndex(([lo, hi]) => conf >= lo && conf < hi);
      if (idx === -1) continue;
      sums[idx].confSum += conf;
      sums[idx].hitSum += hit;
      sums[idx].n += 1;
    }
    for (let i = 0; i < buckets.length; i++) {
      const s = sums[i];
      if (s.n > 0) {
        buckets[i].predicted_avg = s.confSum / s.n;
        buckets[i].realized_rate = (s.hitSum / s.n) * 100;
        buckets[i].count = s.n;
      }
    }

    const totalN = sums.reduce((acc, s) => acc + s.n, 0);
    let score: number | null = null;
    if (totalN >= MIN_CALIBRATION_SAMPLE) {
      let err = 0;
      let n = 0;
      for (const row of rows) {
        const conf = Number(row.conf);
        if (conf < 50 || conf > 100) continue;
        err += Math.abs(Number(row.hit) - conf / 100);
        n += 1;
      }
      score = n > 0 ? 1 - err / n : null;
    }

    return { score, buckets };
  }

  async getPortfolioDetail(input: { kind: string; id: string; days?: number }): Promise<{
    portfolio: Record<string, unknown>;
    positions: Array<Record<string, unknown>>;
    snapshots: Array<Record<string, unknown>>;
    snapshot_history: Array<Record<string, unknown>>;
    benchmark_series: Array<Record<string, unknown>>;
    calibration_buckets: CalibrationBucket[] | null;
  }> {
    const { kind, id } = input;
    if (kind !== 'user' && kind !== 'analyst') {
      throw new BadRequestException(`invalid kind: ${kind} (must be 'user' or 'analyst')`);
    }
    const days = Math.min(Math.max(Number(input.days ?? 90) || 90, 1), 365);

    let portfolio: Record<string, unknown> | null = null;
    let positions: Array<Record<string, unknown>> = [];
    let snapshotKind: 'user' | 'analyst';

    if (kind === 'user') {
      const pRes = await this.db.rawQuery(
        `select * from prediction.user_portfolios where id = $1`,
        [id],
      );
      portfolio = ((pRes.data as Array<Record<string, unknown>> | null) ?? [])[0] ?? null;
      if (!portfolio) throw new BadRequestException(`portfolio not found: ${id}`);
      const posRes = await this.db.rawQuery(
        `select * from prediction.user_positions
         where portfolio_id = $1
           and (status = 'open' or closed_at >= now() - interval '30 days')
         order by case when status='open' then 0 else 1 end, opened_at desc`,
        [id],
      );
      positions = (posRes.data as Array<Record<string, unknown>> | null) ?? [];
      snapshotKind = 'user';
    } else {
      const pRes = await this.db.rawQuery(
        `select ap.*, ma.display_name as analyst_name
         from prediction.analyst_portfolios ap
         left join prediction.market_analysts ma on ma.id = ap.analyst_id
         where ap.id = $1`,
        [id],
      );
      portfolio = ((pRes.data as Array<Record<string, unknown>> | null) ?? [])[0] ?? null;
      if (!portfolio) throw new BadRequestException(`portfolio not found: ${id}`);
      const posRes = await this.db.rawQuery(
        `select * from prediction.analyst_positions
         where portfolio_id = $1
           and (status = 'open' or closed_at >= now() - interval '30 days')
         order by case when status='open' then 0 else 1 end, opened_at desc`,
        [id],
      );
      positions = (posRes.data as Array<Record<string, unknown>> | null) ?? [];
      snapshotKind = 'analyst';
    }

    // Legacy 30-day snapshots field (preserved for callers).
    const snapRes = await this.db.rawQuery(
      `select * from prediction.daily_pnl_snapshot
       where portfolio_kind = $1 and portfolio_id = $2
       order by snapshot_date asc
       limit 30`,
      [snapshotKind, id],
    );
    const snapshots = (snapRes.data as Array<Record<string, unknown>> | null) ?? [];

    // Range-based snapshot_history for the equity curve.
    const histRes = await this.db.rawQuery(
      `select snapshot_date, ending_balance, realized_pnl, unrealized_pnl
       from prediction.daily_pnl_snapshot
       where portfolio_kind = $1 and portfolio_id = $2
         and snapshot_date >= current_date - ($3::int || ' days')::interval
       order by snapshot_date asc`,
      [snapshotKind, id, days],
    );
    const histRows = (histRes.data as Array<Record<string, unknown>> | null) ?? [];

    // Bailout flags by date for the same window (left-joined client-side).
    const bailRes = await this.db.rawQuery(
      `select date(created_at) as bailout_date
       from prediction.bailout_ledger
       where portfolio_kind = $1 and portfolio_id = $2
         and created_at >= current_date - ($3::int || ' days')::interval`,
      [snapshotKind, id, days],
    );
    const bailoutDates = new Set(
      ((bailRes.data as Array<{ bailout_date: string }> | null) ?? []).map((r) =>
        String(r.bailout_date).slice(0, 10),
      ),
    );

    const snapshot_history = histRows.map((r) => {
      const date = String(r.snapshot_date).slice(0, 10);
      return {
        date,
        equity: Number(r.ending_balance ?? 0),
        realized: Number(r.realized_pnl ?? 0),
        unrealized: Number(r.unrealized_pnl ?? 0),
        bailout_flag: bailoutDates.has(date),
      };
    });

    // Benchmark series (SPY default) over the same range.
    const benchRes = await this.db.rawQuery(
      `select trading_date, close_price
       from prediction.benchmark_series
       where symbol = 'SPY'
         and trading_date >= current_date - ($1::int || ' days')::interval
       order by trading_date asc`,
      [days],
    );
    const benchmark_series = ((benchRes.data as Array<Record<string, unknown>> | null) ?? []).map(
      (r) => ({
        date: String(r.trading_date).slice(0, 10),
        spy_close: Number(r.close_price ?? 0),
      }),
    );

    // Calibration buckets (analysts only with an analyst_id and ≥ 20 resolved).
    let calibration_buckets: CalibrationBucket[] | null = null;
    if (kind === 'analyst' && portfolio && portfolio.analyst_id) {
      const cal = await this.computeCalibration(String(portfolio.analyst_id));
      if (cal.score !== null) {
        calibration_buckets = cal.buckets;
      }
    }

    return {
      portfolio,
      positions,
      snapshots,
      snapshot_history,
      benchmark_series,
      calibration_buckets,
    };
  }
}
