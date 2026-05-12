/**
 * StudentBillingService — informational only since the stripe-integration
 * effort retired the variable cost-pass-through accrual path.
 *
 * Students are now billed via Stripe at a flat 10% of regular per-item
 * Prices (see BillingConfigService.priceForKind + BillingService.maybeMirrorAddToStripe).
 * This service still surfaces LLM-cost summaries for the operator/educator
 * dashboard (`/billing/summary` LLM-cost rollup, /admin cost views) but those
 * numbers no longer feed billing.
 *
 * The historical `withFloorCents` field and `STUDENT_FLOOR_USD` env var were
 * dropped by the stripe-integration effort; consumers that previously read
 * them should switch to GET /billing/preview's upcomingInvoice for what's
 * actually being billed.
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

export interface StudentAccrual {
  rawCostCents: number;
  breakdownByTriple: Array<{ analystId: string | null; instrumentId: string | null; costCents: number }>;
  daysIntoPeriod: number;
  projectedMonthlyCents: number;
  isStudent: boolean;
}

export interface MonthlyCostResult {
  rawCostCents: number;
}

export interface MySummary {
  yearMonth: string;
  totalCallsThisMonth: number;
  totalCostCentsThisMonth: number;
  byStage: Array<{ stage: string; subStage: string | null; costCents: number; calls: number }>;
  byTriple: Array<{ analystId: string | null; instrumentId: string | null; costCents: number; calls: number }>;
  byModel: Array<{ model: string; provider: string; costCents: number; calls: number }>;
  priorMonth: {
    yearMonth: string;
    totalCallsThisMonth: number;
    totalCostCentsThisMonth: number;
  };
}

interface MonthlyTotalRow {
  total_calls: string | number | null;
  total_cost_cents: string | number | null;
}

interface StageRow {
  stage: string;
  sub_stage: string | null;
  cost_cents: string | number | null;
  calls: string | number | null;
}

interface TripleRow {
  analyst_id: string | null;
  instrument_id: string | null;
  cost_cents: string | number | null;
  calls: string | number | null;
}

interface ModelRow {
  model: string;
  provider: string;
  cost_cents: string | number | null;
  calls: string | number | null;
}

interface SubscriptionRow {
  status: string;
  trial_ends_at: string | null;
}

@Injectable()
export class StudentBillingService {
  private readonly logger = new Logger(StudentBillingService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  private currentMonth(): string { return new Date().toISOString().slice(0, 7); }
  private priorMonth(yearMonth = this.currentMonth()): string {
    const match = yearMonth.match(/^(\d{4})-(\d{2})$/);
    const d = match
      ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
      : new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  }

  async getUserCostCentsThisMonth(userId: string): Promise<MonthlyCostResult> {
    const result = await this.db.rawQuery(
      `SELECT coalesce(total_cost_cents, 0)::integer as total_cost_cents
         FROM prediction.llm_usage_per_user_monthly
        WHERE billed_user_id = $1 AND year_month = $2`,
      [userId, this.currentMonth()],
    );
    const rows = (result.data as Array<{ total_cost_cents: string | number }> | null) ?? [];
    const rawCostCents = Number(rows[0]?.total_cost_cents ?? 0);
    return { rawCostCents };
  }

  async getStudentAccrual(userId: string): Promise<StudentAccrual> {
    const monthly = await this.getUserCostCentsThisMonth(userId);
    const isStudent = await this.isStudentTier(userId);

    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const daysIntoPeriod = Math.max(1, Math.floor((today.getTime() - monthStart.getTime()) / 86400000) + 1);
    const projectedMonthlyCents = Math.round((monthly.rawCostCents / daysIntoPeriod) * 30);

    const tripleResult = await this.db.rawQuery(
      `SELECT analyst_id, instrument_id,
              coalesce(sum(total_cost_cents), 0)::integer as cost_cents,
              coalesce(sum(total_calls), 0)::integer as calls
         FROM prediction.llm_usage_per_triple_daily
        WHERE billed_user_id = $1
          AND date >= date_trunc('month', current_date)::date
        GROUP BY analyst_id, instrument_id
        ORDER BY cost_cents DESC NULLS LAST`,
      [userId],
    );
    const tripleRows = (tripleResult.data as TripleRow[] | null) ?? [];
    const breakdownByTriple = tripleRows.map((r) => ({
      analystId: r.analyst_id,
      instrumentId: r.instrument_id,
      costCents: Number(r.cost_cents ?? 0),
    }));

    return {
      ...monthly,
      breakdownByTriple,
      daysIntoPeriod,
      projectedMonthlyCents,
      isStudent,
    };
  }

  async getMySummary(userId: string, yearMonth?: string): Promise<MySummary> {
    const ym = yearMonth ?? this.currentMonth();
    const prior = this.priorMonth(ym);

    const totalsResult = await this.db.rawQuery(
      `SELECT coalesce(total_calls, 0)::integer as total_calls,
              coalesce(total_cost_cents, 0)::integer as total_cost_cents
         FROM prediction.llm_usage_per_user_monthly
        WHERE billed_user_id = $1 AND year_month = $2`,
      [userId, ym],
    );
    const totalsRows = (totalsResult.data as MonthlyTotalRow[] | null) ?? [];
    const totalCallsThisMonth = Number(totalsRows[0]?.total_calls ?? 0);
    const totalCostCentsThisMonth = Number(totalsRows[0]?.total_cost_cents ?? 0);

    const priorTotalsResult = await this.db.rawQuery(
      `SELECT coalesce(total_calls, 0)::integer as total_calls,
              coalesce(total_cost_cents, 0)::integer as total_cost_cents
         FROM prediction.llm_usage_per_user_monthly
        WHERE billed_user_id = $1 AND year_month = $2`,
      [userId, prior],
    );
    const priorRows = (priorTotalsResult.data as MonthlyTotalRow[] | null) ?? [];
    const priorTotal = {
      yearMonth: prior,
      totalCallsThisMonth: Number(priorRows[0]?.total_calls ?? 0),
      totalCostCentsThisMonth: Number(priorRows[0]?.total_cost_cents ?? 0),
    };

    const stageResult = await this.db.rawQuery(
      `SELECT stage, sub_stage,
              coalesce(sum(cost_cents), 0)::integer as cost_cents,
              count(*)::integer as calls
         FROM prediction.llm_usage_log
        WHERE billed_user_id = $1
          AND to_char("timestamp", 'YYYY-MM') = $2
        GROUP BY stage, sub_stage
        ORDER BY cost_cents DESC NULLS LAST`,
      [userId, ym],
    );
    const stageRows = (stageResult.data as StageRow[] | null) ?? [];
    const byStage = stageRows.map((r) => ({
      stage: r.stage,
      subStage: r.sub_stage,
      costCents: Number(r.cost_cents ?? 0),
      calls: Number(r.calls ?? 0),
    }));

    const tripleResult = await this.db.rawQuery(
      `SELECT analyst_id, instrument_id,
              coalesce(sum(cost_cents), 0)::integer as cost_cents,
              count(*)::integer as calls
         FROM prediction.llm_usage_log
        WHERE billed_user_id = $1
          AND to_char("timestamp", 'YYYY-MM') = $2
          AND analyst_id IS NOT NULL
          AND instrument_id IS NOT NULL
        GROUP BY analyst_id, instrument_id
        ORDER BY cost_cents DESC NULLS LAST`,
      [userId, ym],
    );
    const tripleRows = (tripleResult.data as TripleRow[] | null) ?? [];
    const byTriple = tripleRows.map((r) => ({
      analystId: r.analyst_id,
      instrumentId: r.instrument_id,
      costCents: Number(r.cost_cents ?? 0),
      calls: Number(r.calls ?? 0),
    }));

    const modelResult = await this.db.rawQuery(
      `SELECT model, provider,
              coalesce(sum(cost_cents), 0)::integer as cost_cents,
              count(*)::integer as calls
         FROM prediction.llm_usage_log
        WHERE billed_user_id = $1
          AND to_char("timestamp", 'YYYY-MM') = $2
        GROUP BY model, provider
        ORDER BY cost_cents DESC NULLS LAST`,
      [userId, ym],
    );
    const modelRows = (modelResult.data as ModelRow[] | null) ?? [];
    const byModel = modelRows.map((r) => ({
      model: r.model,
      provider: r.provider,
      costCents: Number(r.cost_cents ?? 0),
      calls: Number(r.calls ?? 0),
    }));

    return {
      yearMonth: ym,
      totalCallsThisMonth,
      totalCostCentsThisMonth,
      byStage,
      byTriple,
      byModel,
      priorMonth: priorTotal,
    };
  }

  /**
   * Heuristic for v1: a user is treated as student-tier when their billing.subscriptions row
   * has status 'trial' (i.e., student accounts not yet on a paid plan). The dedicated
   * student-accounts effort will replace this with a proper account_type column.
   */
  private async isStudentTier(userId: string): Promise<boolean> {
    const result = await this.db.rawQuery(
      `SELECT status, trial_ends_at FROM billing.subscriptions WHERE user_id = $1`,
      [userId],
    );
    const rows = (result.data as SubscriptionRow[] | null) ?? [];
    if (rows.length === 0) return false;
    return rows[0].status === 'trial';
  }
}
