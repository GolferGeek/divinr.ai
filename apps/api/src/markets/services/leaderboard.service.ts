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
}

/**
 * Cross-actor leaderboard / master-detail read API.
 * Joins analyst_portfolios (analyst|arbitrator|day_trader) + user_portfolios.
 */
@Injectable()
export class LeaderboardService {
  constructor(@Inject(DATABASE_SERVICE) private readonly db: DatabaseService) {}

  async getAllPortfoliosSummary(): Promise<PortfolioSummaryRow[]> {
    const sql = `
      with analyst_rows as (
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
          ) as open_position_count
        from prediction.analyst_portfolios ap
        left join prediction.market_analysts ma on ma.id = ap.analyst_id
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
          ) as open_position_count
        from prediction.user_portfolios up
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
      };
    });
  }

  async getPortfolioDetail(input: { kind: string; id: string }): Promise<{
    portfolio: Record<string, unknown>;
    positions: Array<Record<string, unknown>>;
    snapshots: Array<Record<string, unknown>>;
  }> {
    const { kind, id } = input;
    if (kind !== 'user' && kind !== 'analyst') {
      throw new BadRequestException(`invalid kind: ${kind} (must be 'user' or 'analyst')`);
    }

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
      // analyst includes analyst | arbitrator | day_trader (same table)
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

    const snapRes = await this.db.rawQuery(
      `select * from prediction.daily_pnl_snapshot
       where portfolio_kind = $1 and portfolio_id = $2
       order by snapshot_date asc
       limit 30`,
      [snapshotKind, id],
    );
    const snapshots = (snapRes.data as Array<Record<string, unknown>> | null) ?? [];

    return { portfolio, positions, snapshots };
  }
}
