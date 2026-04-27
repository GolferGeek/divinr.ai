import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsSchemaService } from '../schema/markets-schema.service';

interface MetricsData {
  portfolio_value: number;
  today_change: number;
  today_change_pct: number;
  active_positions: number;
  total_realized_pnl: number;
  total_unrealized_pnl: number;
  win_rate: number | null;
  avg_gain: number | null;
  avg_loss: number | null;
}

interface EquityCurvePoint {
  date: string;
  balance: number;
  daily_pnl: number;
}

interface BenchmarkPoint {
  date: string;
  close: number;
}

interface AnalystLeaderboardEntry {
  analyst_id: string;
  name: string;
  accuracy_rate: number | null;
  calibration_score: number | null;
  sample_size: number;
  accuracy_7d: number | null;
  accuracy_30d: number | null;
  trend: 'improving' | 'declining' | 'stable';
}

export interface PerformanceDashboardResponse {
  has_portfolio: boolean;
  metrics: MetricsData | null;
  equity_curve: EquityCurvePoint[];
  benchmark: BenchmarkPoint[];
  analysts: AnalystLeaderboardEntry[];
  next_evaluation_at: string | null;
}

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
  ) {}

  async getDashboardData(userId: string, days: number): Promise<PerformanceDashboardResponse> {

    // Run all queries in parallel
    const [portfolioResult, equityResult, benchmarkResult, positionsResult, todayResult, analystResult] =
      await Promise.all([
        this.fetchPortfolio(userId),
        this.fetchEquityCurve(userId, days),
        this.fetchBenchmark(days),
        this.fetchPositionStats(userId),
        this.fetchTodayChange(userId),
        this.fetchAnalystLeaderboard(),
      ]);

    const hasPortfolio = portfolioResult !== null;

    const metrics: MetricsData | null = hasPortfolio ? {
      portfolio_value: Number(portfolioResult.current_balance),
      today_change: todayResult.change,
      today_change_pct: todayResult.change_pct,
      active_positions: positionsResult.active_count,
      total_realized_pnl: Number(portfolioResult.total_realized_pnl),
      total_unrealized_pnl: Number(portfolioResult.total_unrealized_pnl),
      win_rate: positionsResult.win_rate,
      avg_gain: positionsResult.avg_gain,
      avg_loss: positionsResult.avg_loss,
    } : null;

    // Next evaluation: next midnight UTC
    const now = new Date();
    const nextMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));

    return {
      has_portfolio: hasPortfolio,
      metrics,
      equity_curve: equityResult,
      benchmark: benchmarkResult,
      analysts: analystResult,
      next_evaluation_at: nextMidnight.toISOString(),
    };
  }

  private async fetchPortfolio(userId: string): Promise<{ current_balance: number; total_realized_pnl: number; total_unrealized_pnl: number } | null> {
    const result = await this.db.rawQuery(
      `SELECT current_balance, total_realized_pnl, total_unrealized_pnl
       FROM prediction.user_portfolios
       WHERE user_id = $1
       LIMIT 1`,
      [userId],
    );
    const rows = (result.data as Array<Record<string, unknown>>) ?? [];
    return rows.length > 0 ? rows[0] as { current_balance: number; total_realized_pnl: number; total_unrealized_pnl: number } : null;
  }

  private async fetchEquityCurve(userId: string, days: number): Promise<EquityCurvePoint[]> {
    const result = await this.db.rawQuery(
      `SELECT s.snapshot_date as date, s.ending_balance as balance, s.realized_pnl as daily_pnl
       FROM prediction.daily_pnl_snapshot s
       JOIN prediction.user_portfolios p ON p.id = s.portfolio_id AND p.user_id = $1
       WHERE s.portfolio_kind = 'user'
         AND s.snapshot_date >= current_date - ($2 || ' days')::interval
       ORDER BY s.snapshot_date ASC`,
      [userId, days],
    );
    return ((result.data as Array<Record<string, unknown>>) ?? []).map(r => ({
      date: String(r.date),
      balance: Number(r.balance),
      daily_pnl: Number(r.daily_pnl),
    }));
  }

  private async fetchBenchmark(days: number): Promise<BenchmarkPoint[]> {
    const result = await this.db.rawQuery(
      `SELECT trading_date as date, close_price as close
       FROM prediction.benchmark_series
       WHERE symbol = 'SPY'
         AND trading_date >= current_date - ($1 || ' days')::interval
       ORDER BY trading_date ASC`,
      [days],
    );
    return ((result.data as Array<Record<string, unknown>>) ?? []).map(r => ({
      date: String(r.date),
      close: Number(r.close),
    }));
  }

  private async fetchPositionStats(userId: string): Promise<{
    active_count: number;
    win_rate: number | null;
    avg_gain: number | null;
    avg_loss: number | null;
  }> {
    const result = await this.db.rawQuery(
      `SELECT
         count(*) filter (where status = 'open') as active_count,
         count(*) filter (where status = 'closed') as closed_count,
         count(*) filter (where status = 'closed' and realized_pnl > 0) as wins,
         avg(realized_pnl) filter (where status = 'closed' and realized_pnl > 0) as avg_gain,
         avg(realized_pnl) filter (where status = 'closed' and realized_pnl <= 0) as avg_loss
       FROM prediction.user_positions
       WHERE user_id = $1`,
      [userId],
    );
    const rows = (result.data as Array<Record<string, unknown>>) ?? [];
    if (rows.length === 0) {
      return { active_count: 0, win_rate: null, avg_gain: null, avg_loss: null };
    }
    const r = rows[0];
    const closed = Number(r.closed_count ?? 0);
    const wins = Number(r.wins ?? 0);
    return {
      active_count: Number(r.active_count ?? 0),
      win_rate: closed > 0 ? Math.round((wins / closed) * 10000) / 100 : null,
      avg_gain: r.avg_gain != null ? Math.round(Number(r.avg_gain) * 100) / 100 : null,
      avg_loss: r.avg_loss != null ? Math.round(Number(r.avg_loss) * 100) / 100 : null,
    };
  }

  private async fetchTodayChange(userId: string): Promise<{ change: number; change_pct: number }> {
    const result = await this.db.rawQuery(
      `SELECT s.ending_balance, s.starting_balance
       FROM prediction.daily_pnl_snapshot s
       JOIN prediction.user_portfolios p ON p.id = s.portfolio_id AND p.user_id = $1
       WHERE s.portfolio_kind = 'user'
       ORDER BY s.snapshot_date DESC
       LIMIT 1`,
      [userId],
    );
    const rows = (result.data as Array<Record<string, unknown>>) ?? [];
    if (rows.length === 0) return { change: 0, change_pct: 0 };
    const ending = Number(rows[0].ending_balance);
    const starting = Number(rows[0].starting_balance);
    const change = ending - starting;
    const changePct = starting > 0 ? Math.round((change / starting) * 10000) / 100 : 0;
    return { change, change_pct: changePct };
  }

  private async fetchAnalystLeaderboard(): Promise<AnalystLeaderboardEntry[]> {
    // Get 30d profiles for main stats and 7d for trend comparison
    const result = await this.db.rawQuery(
      `WITH p30 AS (
         SELECT analyst_id,
                avg(accuracy_rate) as accuracy_30d,
                avg(calibration_score) as calibration,
                sum(sample_size) as sample_size
         FROM prediction.analyst_performance_profiles
         WHERE period = '30d' AND instrument_id IS NULL
         GROUP BY analyst_id
       ),
       p7 AS (
         SELECT analyst_id,
                avg(accuracy_rate) as accuracy_7d
         FROM prediction.analyst_performance_profiles
         WHERE period = '7d' AND instrument_id IS NULL
         GROUP BY analyst_id
       )
       SELECT
         a.id as analyst_id,
         a.display_name as name,
         p30.accuracy_30d as accuracy_rate,
         p30.calibration as calibration_score,
         coalesce(p30.sample_size, 0) as sample_size,
         p7.accuracy_7d,
         p30.accuracy_30d
       FROM prediction.market_analysts a
       LEFT JOIN p30 ON p30.analyst_id = a.id
       LEFT JOIN p7 ON p7.analyst_id = a.id
       WHERE a.analyst_type = 'personality'
         AND a.is_enabled = true
       ORDER BY p30.calibration DESC NULLS LAST`,
    );

    return ((result.data as Array<Record<string, unknown>>) ?? []).map(r => {
      const acc7d = r.accuracy_7d != null ? Number(r.accuracy_7d) : null;
      const acc30d = r.accuracy_30d != null ? Number(r.accuracy_30d) : null;
      let trend: 'improving' | 'declining' | 'stable' = 'stable';
      if (acc7d != null && acc30d != null) {
        const diff = acc7d - acc30d;
        // accuracy_rate stored as decimal (0.70 = 70%), so 5pp = 0.05
        if (diff > 0.05) trend = 'improving';
        else if (diff < -0.05) trend = 'declining';
      }
      return {
        analyst_id: String(r.analyst_id),
        name: String(r.name),
        accuracy_rate: r.accuracy_rate != null ? Math.round(Number(r.accuracy_rate) * 100) / 100 : null,
        calibration_score: r.calibration_score != null ? Math.round(Number(r.calibration_score) * 1000) / 1000 : null,
        sample_size: Number(r.sample_size ?? 0),
        accuracy_7d: acc7d != null ? Math.round(acc7d * 100) / 100 : null,
        accuracy_30d: acc30d != null ? Math.round(acc30d * 100) / 100 : null,
        trend,
      };
    });
  }
}
