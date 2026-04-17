import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

export type AttributionWindow = '7d' | '30d' | '90d';

export type SliceDimension = 'triple' | 'analyst' | 'instrument' | 'source' | 'author';

export interface CommonFilters {
  yearMonth?: string;
  from?: string;
  to?: string;
  authorUserId?: string;
  analystId?: string;
  instrumentId?: string;
  sourceKey?: string;
  limit?: number;
  offset?: number;
}

export interface GraduationParams {
  window: AttributionWindow;
  top?: number;
  minPredictions?: number;
}

export interface SliceParams {
  dimX: SliceDimension;
  dimY: SliceDimension;
  filters?: CommonFilters;
}

export const SLICE_MAX_ROWS = 10000;

type Row = Record<string, unknown>;

interface DimSpec {
  selectCols: string;
  groupCols: string[];
  fromExpr: string;
}

const DIMENSIONS: Record<SliceDimension, DimSpec> = {
  triple: {
    selectCols: `coalesce(oro.author_user_id,'base') as dim_triple_author, oro.analyst_id as dim_analyst, oro.instrument_id as dim_instrument`,
    groupCols: ['dim_triple_author', 'dim_analyst', 'dim_instrument'],
    fromExpr: `prediction.outcome_records oro`,
  },
  analyst: {
    selectCols: `oro.analyst_id as dim_analyst`,
    groupCols: ['dim_analyst'],
    fromExpr: `prediction.outcome_records oro`,
  },
  instrument: {
    selectCols: `oro.instrument_id as dim_instrument`,
    groupCols: ['dim_instrument'],
    fromExpr: `prediction.outcome_records oro`,
  },
  author: {
    selectCols: `oro.author_user_id as dim_author`,
    groupCols: ['dim_author'],
    fromExpr: `prediction.outcome_records oro`,
  },
  source: {
    selectCols: `sks.source_key as dim_source`,
    groupCols: ['dim_source'],
    fromExpr: `prediction.outcome_records oro,
      lateral jsonb_array_elements_text(oro.contributing_source_keys) as sks(source_key)`,
  },
};

@Injectable()
export class AttributionQueryService {
  private readonly logger = new Logger(AttributionQueryService.name);

  constructor(@Inject(DATABASE_SERVICE) private readonly db: DatabaseService) {}

  async queryPerTriple(filters: CommonFilters = {}): Promise<{ rows: Row[] }> {
    const params: unknown[] = [];
    const where: string[] = [];
    this.applyMonthly(filters, params, where, 'year_month');
    this.applyEq(filters.authorUserId, 'author_user_id', params, where);
    this.applyEq(filters.analystId, 'analyst_id', params, where);
    this.applyEq(filters.instrumentId, 'instrument_id', params, where);

    const { limit, offset } = this.pagination(filters);
    const sql = `select triple_key_author, author_user_id, analyst_id, instrument_id, year_month,
        outcomes_count, hits_count, hit_rate, total_pnl_cents, avg_calibration_score, avg_confidence
      from prediction.attribution_per_triple_monthly
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by year_month desc, total_pnl_cents desc nulls last
      limit ${limit} offset ${offset}`;
    const res = await this.db.rawQuery(sql, params);
    if (res.error) throw new Error(res.error.message);
    return { rows: (res.data as Row[]) ?? [] };
  }

  async queryPerAnalyst(filters: CommonFilters = {}): Promise<{ rows: Row[] }> {
    const params: unknown[] = [];
    const where: string[] = [];
    this.applyMonthly(filters, params, where, 'year_month');
    this.applyEq(filters.authorUserId, 'author_user_id', params, where);
    this.applyEq(filters.analystId, 'analyst_id', params, where);
    const { limit, offset } = this.pagination(filters);
    const sql = `select triple_key_author, author_user_id, analyst_id, year_month,
        outcomes_count, hits_count, hit_rate, total_pnl_cents, avg_calibration_score, avg_confidence
      from prediction.attribution_per_analyst_monthly
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by year_month desc, total_pnl_cents desc nulls last
      limit ${limit} offset ${offset}`;
    const res = await this.db.rawQuery(sql, params);
    if (res.error) throw new Error(res.error.message);
    return { rows: (res.data as Row[]) ?? [] };
  }

  async queryPerInstrument(filters: CommonFilters = {}): Promise<{ rows: Row[] }> {
    const params: unknown[] = [];
    const where: string[] = [];
    this.applyMonthly(filters, params, where, 'year_month');
    this.applyEq(filters.instrumentId, 'instrument_id', params, where);
    const { limit, offset } = this.pagination(filters);
    const sql = `select instrument_id, year_month, outcomes_count, hits_count, hit_rate,
        total_pnl_cents, avg_calibration_score, avg_confidence
      from prediction.attribution_per_instrument_monthly
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by year_month desc, total_pnl_cents desc nulls last
      limit ${limit} offset ${offset}`;
    const res = await this.db.rawQuery(sql, params);
    if (res.error) throw new Error(res.error.message);
    return { rows: (res.data as Row[]) ?? [] };
  }

  async queryPerSource(filters: CommonFilters = {}): Promise<{ rows: Row[] }> {
    const params: unknown[] = [];
    const where: string[] = [];
    this.applyMonthly(filters, params, where, 'year_month');
    this.applyEq(filters.sourceKey, 'source_key', params, where);
    const { limit, offset } = this.pagination(filters);
    const sql = `select source_key, year_month, predictions_contributed, total_pnl_cents,
        avg_pnl_per_prediction_cents, avg_calibration_score
      from prediction.attribution_per_source_monthly
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by year_month desc, total_pnl_cents desc nulls last
      limit ${limit} offset ${offset}`;
    const res = await this.db.rawQuery(sql, params);
    if (res.error) throw new Error(res.error.message);
    return { rows: (res.data as Row[]) ?? [] };
  }

  async queryPerAuthor(filters: CommonFilters = {}): Promise<{ rows: Row[] }> {
    const params: unknown[] = [];
    const where: string[] = [];
    this.applyMonthly(filters, params, where, 'year_month');
    this.applyEq(filters.authorUserId, 'author_user_id', params, where);
    const { limit, offset } = this.pagination(filters);
    const sql = `select author_user_id, year_month, outcomes_count, hits_count, hit_rate,
        total_pnl_cents, avg_calibration_score, distinct_items_count
      from prediction.attribution_per_author_monthly
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by year_month desc, total_pnl_cents desc nulls last
      limit ${limit} offset ${offset}`;
    const res = await this.db.rawQuery(sql, params);
    if (res.error) throw new Error(res.error.message);
    return { rows: (res.data as Row[]) ?? [] };
  }

  /**
   * Rank top user-authored items by trailing-window paper P&L (fall back to calibration score
   * when no position-method outcomes exist). Joins billing.authored_items for itemKind/itemId
   * tagging so the future graduation flow can identify what's being graduated.
   */
  async queryGraduationCandidates(params: GraduationParams): Promise<{ candidates: Row[] }> {
    const window = params.window;
    const top = this.clampInt(params.top, 50, 1, 500);
    const minPredictions = this.clampInt(
      params.minPredictions,
      this.defaultMinPredictions(),
      1,
      100000,
    );
    const intervalDays = window === '7d' ? 7 : window === '90d' ? 90 : 30;

    const sql = `
      with agg as (
        select
          oro.author_user_id,
          oro.analyst_id,
          oro.instrument_id,
          count(*)::bigint as prediction_count,
          sum(case when oro.was_correct then 1 else 0 end)::bigint as hits_count,
          coalesce(sum(oro.attributable_pnl_cents),0)::bigint as total_pnl_cents,
          avg(oro.calibration_score) as avg_calibration_score
        from prediction.outcome_records oro
        where oro.author_user_id is not null
          and oro.evaluation_date >= (now() - ($1::int || ' days')::interval)
        group by 1,2,3
        having count(*) >= $2::bigint
      )
      select
        a.author_user_id,
        a.analyst_id,
        a.instrument_id,
        a.prediction_count,
        a.hits_count,
        a.total_pnl_cents,
        a.avg_calibration_score,
        ai_an.id as analyst_item_id,
        ai_an.item_kind as analyst_item_kind,
        ai_in.id as instrument_item_id,
        ai_in.item_kind as instrument_item_kind
      from agg a
      left join billing.authored_items ai_an
        on ai_an.user_id = a.author_user_id
        and ai_an.item_id = a.analyst_id
        and ai_an.item_kind in ('custom_analyst','analyst_contract_override')
        and ai_an.status = 'active'
      left join billing.authored_items ai_in
        on ai_in.user_id = a.author_user_id
        and ai_in.item_id = a.instrument_id
        and ai_in.item_kind in ('custom_instrument','instrument_contract_override')
        and ai_in.status = 'active'
      order by a.total_pnl_cents desc, a.avg_calibration_score desc nulls last
      limit $3::int`;
    const res = await this.db.rawQuery(sql, [intervalDays, minPredictions, top]);
    if (res.error) throw new Error(res.error.message);
    const rows = (res.data as Array<{
      author_user_id: string;
      analyst_id: string | null;
      instrument_id: string;
      prediction_count: number | string;
      hits_count: number | string;
      total_pnl_cents: number | string;
      avg_calibration_score: number | null;
      analyst_item_id: string | null;
      analyst_item_kind: string | null;
      instrument_item_id: string | null;
      instrument_item_kind: string | null;
    }> | null) ?? [];

    const candidates: Row[] = rows.map((r) => {
      const itemKind = r.analyst_item_kind ?? r.instrument_item_kind ?? 'unlinked';
      const itemId = r.analyst_item_id ?? r.instrument_item_id ?? null;
      const pnlCents = Number(r.total_pnl_cents ?? 0);
      const calibration = r.avg_calibration_score == null ? null : Number(r.avg_calibration_score);
      const score = pnlCents !== 0 ? pnlCents : calibration ?? 0;
      return {
        authorUserId: r.author_user_id,
        analystId: r.analyst_id,
        instrumentId: r.instrument_id,
        itemKind,
        itemId,
        predictionCount: Number(r.prediction_count ?? 0),
        hitsCount: Number(r.hits_count ?? 0),
        pnlCents,
        avgCalibrationScore: calibration,
        score,
        window,
      };
    });
    return { candidates };
  }

  /**
   * 2-D ad-hoc slice across outcome_records. Dimensions are a closed enum; result is
   * capped at SLICE_MAX_ROWS. Rejects repeated dimensions and non-enum values.
   */
  async querySlice(args: SliceParams): Promise<{ rows: Row[]; truncated: boolean }> {
    const { dimX, dimY } = args;
    if (!DIMENSIONS[dimX] || !DIMENSIONS[dimY]) {
      throw new Error(`Unknown slice dimension: ${dimX} / ${dimY}`);
    }
    if (dimX === dimY) {
      throw new Error('Slice dimX and dimY must be different');
    }
    const xSpec = DIMENSIONS[dimX];
    const ySpec = DIMENSIONS[dimY];
    const needsSource = dimX === 'source' || dimY === 'source';
    const fromClause = needsSource ? DIMENSIONS.source.fromExpr : DIMENSIONS.analyst.fromExpr;

    const filters = args.filters ?? {};
    const params: unknown[] = [];
    const where: string[] = [];
    this.applyRange(filters, params, where, 'oro.evaluation_date');
    this.applyEq(filters.authorUserId, 'oro.author_user_id', params, where);
    this.applyEq(filters.analystId, 'oro.analyst_id', params, where);
    this.applyEq(filters.instrumentId, 'oro.instrument_id', params, where);

    const groupCols = [...xSpec.groupCols, ...ySpec.groupCols];
    const selectDims = [xSpec.selectCols, ySpec.selectCols].join(', ');

    const sql = `select ${selectDims},
        count(*)::bigint as outcomes_count,
        sum(case when oro.was_correct then 1 else 0 end)::bigint as hits_count,
        coalesce(sum(oro.attributable_pnl_cents),0)::bigint as total_pnl_cents,
        avg(oro.calibration_score) as avg_calibration_score
      from ${fromClause}
      ${where.length ? 'where ' + where.join(' and ') : ''}
      group by ${groupCols.join(', ')}
      order by total_pnl_cents desc nulls last
      limit ${SLICE_MAX_ROWS + 1}`;
    const res = await this.db.rawQuery(sql, params);
    if (res.error) throw new Error(res.error.message);
    const all = (res.data as Row[]) ?? [];
    const truncated = all.length > SLICE_MAX_ROWS;
    if (truncated) {
      this.logger.warn(`Slice ${dimX}×${dimY} returned > ${SLICE_MAX_ROWS} rows; truncated.`);
    }
    return { rows: truncated ? all.slice(0, SLICE_MAX_ROWS) : all, truncated };
  }

  /**
   * Author-facing summary: current month aggregate, per-item breakdown joined to
   * billing.authored_items, 3-month history, and top-decile items (the subset of
   * `queryGraduationCandidates` that belong to the calling user).
   */
  async queryMySummary(userId: string): Promise<{
    currentMonth: Row | null;
    byItem: Row[];
    history: Row[];
    topDecileItems: Row[];
  }> {
    const currentMonth = this.currentYearMonth();

    const currentRes = await this.db.rawQuery(
      `select author_user_id, year_month, outcomes_count, hits_count, hit_rate,
          total_pnl_cents, avg_calibration_score, distinct_items_count
        from prediction.attribution_per_author_monthly
        where author_user_id = $1 and year_month = $2`,
      [userId, currentMonth],
    );
    if (currentRes.error) throw new Error(currentRes.error.message);
    const currentRows = (currentRes.data as Row[]) ?? [];

    const byItemRes = await this.db.rawQuery(
      `select triple_key_author, author_user_id, analyst_id, instrument_id, year_month,
          outcomes_count, hits_count, hit_rate, total_pnl_cents, avg_calibration_score, avg_confidence
        from prediction.attribution_per_triple_monthly
        where author_user_id = $1 and year_month = $2
        order by total_pnl_cents desc nulls last
        limit 200`,
      [userId, currentMonth],
    );
    if (byItemRes.error) throw new Error(byItemRes.error.message);

    const historyRes = await this.db.rawQuery(
      `select author_user_id, year_month, outcomes_count, hits_count, hit_rate,
          total_pnl_cents, avg_calibration_score, distinct_items_count
        from prediction.attribution_per_author_monthly
        where author_user_id = $1
          and year_month >= to_char((now() - interval '3 months'),'YYYY-MM')
        order by year_month desc
        limit 6`,
      [userId],
    );
    if (historyRes.error) throw new Error(historyRes.error.message);

    const graduation = await this.queryGraduationCandidates({
      window: '30d',
      top: 100,
      minPredictions: this.defaultMinPredictions(),
    });
    const topDecileItems = graduation.candidates.filter((c) => c.authorUserId === userId);

    return {
      currentMonth: currentRows[0] ?? null,
      byItem: (byItemRes.data as Row[]) ?? [],
      history: (historyRes.data as Row[]) ?? [],
      topDecileItems,
    };
  }

  /**
   * Instrument drill-down: base (author_user_id IS NULL), per-author breakdown,
   * and top triples. Caller must pass the ID so we can tag user-owned rows.
   */
  async queryInstrument(instrumentId: string, callerUserId: string | null = null): Promise<{
    base: Row | null;
    byAuthor: Row[];
    topTriples: Row[];
  }> {
    const month = this.currentYearMonth();

    const baseRes = await this.db.rawQuery(
      `select triple_key_author, author_user_id, analyst_id, instrument_id, year_month,
          outcomes_count, hits_count, hit_rate, total_pnl_cents, avg_calibration_score, avg_confidence
        from prediction.attribution_per_triple_monthly
        where instrument_id = $1 and author_user_id is null and year_month = $2
        order by total_pnl_cents desc nulls last`,
      [instrumentId, month],
    );
    if (baseRes.error) throw new Error(baseRes.error.message);
    const baseRows = (baseRes.data as Row[]) ?? [];
    const base = baseRows[0]
      ? {
          ...baseRows[0],
          totalOutcomes: baseRows.reduce((s, r) => s + Number(r.outcomes_count ?? 0), 0),
          totalPnlCents: baseRows.reduce((s, r) => s + Number(r.total_pnl_cents ?? 0), 0),
        }
      : null;

    const byAuthorRes = await this.db.rawQuery(
      `select triple_key_author, author_user_id, analyst_id, instrument_id, year_month,
          outcomes_count, hits_count, hit_rate, total_pnl_cents, avg_calibration_score, avg_confidence
        from prediction.attribution_per_triple_monthly
        where instrument_id = $1 and author_user_id is not null and year_month = $2
        order by total_pnl_cents desc nulls last
        limit 200`,
      [instrumentId, month],
    );
    if (byAuthorRes.error) throw new Error(byAuthorRes.error.message);
    const byAuthor = ((byAuthorRes.data as Row[]) ?? []).map((r) => ({
      ...r,
      userOwned: callerUserId != null && r.author_user_id === callerUserId,
    }));

    const topTriplesRes = await this.db.rawQuery(
      `select triple_key_author, author_user_id, analyst_id, instrument_id, year_month,
          outcomes_count, hits_count, hit_rate, total_pnl_cents, avg_calibration_score
        from prediction.attribution_per_triple_monthly
        where instrument_id = $1
        order by total_pnl_cents desc nulls last
        limit 10`,
      [instrumentId],
    );
    if (topTriplesRes.error) throw new Error(topTriplesRes.error.message);
    const topTriples = ((topTriplesRes.data as Row[]) ?? []).map((r) => ({
      ...r,
      userOwned: callerUserId != null && r.author_user_id === callerUserId,
    }));

    return { base, byAuthor, topTriples };
  }

  private applyMonthly(
    filters: CommonFilters,
    params: unknown[],
    where: string[],
    column: string,
  ): void {
    if (filters.yearMonth) {
      params.push(filters.yearMonth);
      where.push(`${column} = $${params.length}`);
      return;
    }
    if (filters.from) {
      params.push(filters.from);
      where.push(`${column} >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`${column} <= $${params.length}`);
    }
  }

  private applyRange(
    filters: CommonFilters,
    params: unknown[],
    where: string[],
    column: string,
  ): void {
    if (filters.from) {
      params.push(filters.from + '-01');
      where.push(`${column} >= $${params.length}::timestamptz`);
    }
    if (filters.to) {
      params.push(filters.to + '-01');
      where.push(`${column} < ($${params.length}::timestamptz + interval '1 month')`);
    }
  }

  private applyEq(
    value: string | undefined,
    column: string,
    params: unknown[],
    where: string[],
  ): void {
    if (value == null || value === '') return;
    params.push(value);
    where.push(`${column} = $${params.length}`);
  }

  private pagination(filters: CommonFilters): { limit: number; offset: number } {
    return {
      limit: this.clampInt(filters.limit, 100, 1, 1000),
      offset: this.clampInt(filters.offset, 0, 0, 1000000),
    };
  }

  private clampInt(raw: number | string | undefined, fallback: number, min: number, max: number): number {
    const n = typeof raw === 'string' ? parseInt(raw, 10) : raw;
    if (n == null || !Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return Math.floor(n);
  }

  private currentYearMonth(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = (now.getUTCMonth() + 1).toString().padStart(2, '0');
    return `${y}-${m}`;
  }

  private defaultMinPredictions(): number {
    const raw = process.env.ATTRIBUTION_GRADUATION_MIN_PREDICTIONS;
    if (!raw) return 20;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return 20;
    return n;
  }
}
