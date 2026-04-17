/**
 * Unit tests for AttributionQueryService.
 * Verifies per-* query SQL shape + filter application, graduation-candidates
 * windowing + min-predictions + P&L-vs-calibration fallback, slice dimension
 * validation + truncation, and my-summary topDecileItems filtering.
 */
import {
  AttributionQueryService,
  SLICE_MAX_ROWS,
  type CommonFilters,
  type SliceDimension,
} from '../../src/attribution/attribution-query.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall {
  sql: string;
  params: unknown[];
}

type Scripter = (sql: string, params: unknown[], callIndex: number) =>
  | { data?: unknown; error?: { message: string } | null }
  | Promise<{ data?: unknown; error?: { message: string } | null }>;

class MockDb {
  public calls: MockCall[] = [];
  constructor(private readonly script: Scripter) {}
  async rawQuery(sql: string, params: unknown[] = []) {
    const idx = this.calls.length;
    this.calls.push({ sql, params });
    return await this.script(sql, params, idx);
  }
}

function buildService(db: MockDb): AttributionQueryService {
  return new (AttributionQueryService as unknown as {
    new (db: MockDb): AttributionQueryService;
  })(db);
}

function silence(svc: AttributionQueryService): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).logger = { log: () => {}, warn: () => {}, error: () => {} };
}

async function main(): Promise<void> {
  console.log('\n=== Attribution Query Service Tests ===\n');

  console.log('queryPerTriple: returns {rows} shape; applies yearMonth + authorUserId filters:');
  {
    const db = new MockDb(() => ({
      data: [
        { instrument_id: 'AAPL', total_pnl_cents: 1000, avg_calibration_score: 0.5 },
      ],
    }));
    const svc = buildService(db);
    silence(svc);
    const out = await svc.queryPerTriple({
      yearMonth: '2026-04',
      authorUserId: 'user-1',
      analystId: 'china-analyst',
      instrumentId: 'AAPL',
    });
    assert(Array.isArray(out.rows), 'returns {rows} array');
    assert(out.rows.length === 1, 'one row returned');
    assert(db.calls.length === 1, 'exactly 1 SQL call');
    const sql = db.calls[0].sql;
    const params = db.calls[0].params;
    assert(sql.includes('from prediction.attribution_per_triple_monthly'), 'targets per_triple view');
    assert(sql.includes('year_month = $1'), 'year_month filter applied');
    assert(sql.includes('author_user_id = $2'), 'author_user_id filter applied');
    assert(sql.includes('analyst_id = $3'), 'analyst_id filter applied');
    assert(sql.includes('instrument_id = $4'), 'instrument_id filter applied');
    assert(Array.isArray(params) && params.length === 4, 'exactly 4 params passed');
    assert((params as string[])[0] === '2026-04', 'yearMonth param value');
    assert((params as string[])[1] === 'user-1', 'authorUserId param value');
    assert(sql.includes('limit 100'), 'default limit 100 applied');
    assert(sql.includes('offset 0'), 'default offset 0 applied');
  }

  console.log('\nqueryPerTriple: no filters → empty WHERE clause; custom limit/offset respected:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    silence(svc);
    await svc.queryPerTriple({ limit: 25, offset: 50 });
    const sql = db.calls[0].sql;
    assert(!sql.includes('where '), 'no WHERE clause when no filters');
    assert(sql.includes('limit 25'), 'custom limit used');
    assert(sql.includes('offset 50'), 'custom offset used');
  }

  console.log('\nqueryPerTriple: from/to range maps to year_month comparisons:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    silence(svc);
    await svc.queryPerTriple({ from: '2026-01', to: '2026-04' });
    const sql = db.calls[0].sql;
    const params = db.calls[0].params;
    assert(sql.includes('year_month >= $1'), 'from → year_month >=');
    assert(sql.includes('year_month <= $2'), 'to → year_month <=');
    assert((params as string[])[0] === '2026-01' && (params as string[])[1] === '2026-04', 'range params passed');
  }

  console.log('\nqueryPerAnalyst / queryPerInstrument / queryPerSource / queryPerAuthor: correct view + shape:');
  {
    const views: Array<[string, (f: CommonFilters) => Promise<{ rows: unknown[] }>]> = [];
    const db1 = new MockDb(() => ({ data: [] }));
    const s1 = buildService(db1); silence(s1);
    await s1.queryPerAnalyst({ yearMonth: '2026-04' });
    assert(db1.calls[0].sql.includes('attribution_per_analyst_monthly'), 'per_analyst targets right view');

    const db2 = new MockDb(() => ({ data: [] }));
    const s2 = buildService(db2); silence(s2);
    await s2.queryPerInstrument({ yearMonth: '2026-04', instrumentId: 'AAPL' });
    assert(db2.calls[0].sql.includes('attribution_per_instrument_monthly'), 'per_instrument targets right view');
    assert(db2.calls[0].sql.includes('instrument_id = $2'), 'per_instrument applies instrumentId filter');

    const db3 = new MockDb(() => ({ data: [] }));
    const s3 = buildService(db3); silence(s3);
    await s3.queryPerSource({ yearMonth: '2026-04', sourceKey: 'reuters' });
    assert(db3.calls[0].sql.includes('attribution_per_source_monthly'), 'per_source targets right view');
    assert(db3.calls[0].sql.includes('source_key = $2'), 'per_source applies sourceKey filter');

    const db4 = new MockDb(() => ({ data: [] }));
    const s4 = buildService(db4); silence(s4);
    await s4.queryPerAuthor({ authorUserId: 'user-1' });
    assert(db4.calls[0].sql.includes('attribution_per_author_monthly'), 'per_author targets right view');

    void views;
  }

  console.log('\nqueryGraduationCandidates: window maps to interval days; minPredictions gates having:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    silence(svc);
    await svc.queryGraduationCandidates({ window: '7d', top: 10, minPredictions: 5 });
    const p7 = db.calls[0].params as unknown[];
    assert(p7[0] === 7, '7d maps to 7 interval days');
    assert(p7[1] === 5, 'minPredictions 5 passed');
    assert(p7[2] === 10, 'top=10 passed');

    const db90 = new MockDb(() => ({ data: [] }));
    const svc90 = buildService(db90); silence(svc90);
    await svc90.queryGraduationCandidates({ window: '90d' });
    const p90 = db90.calls[0].params as unknown[];
    assert(p90[0] === 90, '90d maps to 90 days');
    assert(p90[2] === 50, 'top defaults to 50');
    assert(typeof p90[1] === 'number' && (p90[1] as number) >= 1, 'minPredictions defaults from env or 20');
  }

  console.log('\nqueryGraduationCandidates: filters author_user_id IS NOT NULL:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db); silence(svc);
    await svc.queryGraduationCandidates({ window: '30d' });
    const sql = db.calls[0].sql;
    assert(sql.includes('author_user_id is not null'), 'filters out base (author_user_id null)');
    assert(sql.includes('having count(*) >= $2'), 'having clause gates min predictions');
    assert(sql.includes('left join billing.authored_items'), 'joins authored_items for item tagging');
  }

  console.log('\nqueryGraduationCandidates: maps rows → candidates with fallback score:');
  {
    const db = new MockDb(() => ({
      data: [
        {
          author_user_id: 'user-1',
          analyst_id: 'china',
          instrument_id: 'AAPL',
          prediction_count: 10,
          hits_count: 7,
          total_pnl_cents: 12345,
          avg_calibration_score: 0.4,
          analyst_item_id: 'ai-1',
          analyst_item_kind: 'custom_analyst',
          instrument_item_id: null,
          instrument_item_kind: null,
        },
        {
          author_user_id: 'user-2',
          analyst_id: 'esg',
          instrument_id: 'MSFT',
          prediction_count: 8,
          hits_count: 6,
          total_pnl_cents: 0,
          avg_calibration_score: 0.3,
          analyst_item_id: null,
          analyst_item_kind: null,
          instrument_item_id: null,
          instrument_item_kind: null,
        },
      ],
    }));
    const svc = buildService(db); silence(svc);
    const out = await svc.queryGraduationCandidates({ window: '30d' });
    assert(out.candidates.length === 2, 'maps 2 rows → 2 candidates');
    const c0 = out.candidates[0] as Record<string, unknown>;
    assert(c0.authorUserId === 'user-1', 'candidate preserves authorUserId');
    assert(c0.itemKind === 'custom_analyst', 'itemKind picks analyst when joined');
    assert(c0.itemId === 'ai-1', 'itemId from analyst join');
    assert(c0.pnlCents === 12345, 'pnlCents numeric passthrough');
    assert(c0.score === 12345, 'score defaults to pnlCents when non-zero');
    assert(c0.window === '30d', 'window echoed on candidate');
    const c1 = out.candidates[1] as Record<string, unknown>;
    assert(c1.itemKind === 'unlinked', 'itemKind falls back to "unlinked" with no joined row');
    assert(c1.itemId === null, 'itemId null when no linked item');
    assert(c1.score === 0.3, 'score falls back to calibration when pnlCents is 0');
  }

  console.log('\nquerySlice: rejects identical dimensions and unknown dimensions:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db); silence(svc);
    let caught = false;
    try { await svc.querySlice({ dimX: 'analyst', dimY: 'analyst' }); }
    catch (e) { caught = (e as Error).message.includes('different'); }
    assert(caught, 'rejects dimX === dimY');
    let caught2 = false;
    try { await svc.querySlice({ dimX: 'xxx' as SliceDimension, dimY: 'analyst' }); }
    catch (e) { caught2 = (e as Error).message.includes('Unknown slice dimension'); }
    assert(caught2, 'rejects unknown dimension');
  }

  console.log('\nquerySlice: triple×source uses lateral unnest; caps at SLICE_MAX_ROWS:');
  {
    // Return exactly SLICE_MAX_ROWS + 1 rows to trigger truncation.
    const overLimit = Array.from({ length: SLICE_MAX_ROWS + 1 }, (_, i) => ({
      dim_analyst: `a-${i}`,
      outcomes_count: 1,
      total_pnl_cents: i,
    }));
    const db = new MockDb(() => ({ data: overLimit }));
    const svc = buildService(db); silence(svc);
    const out = await svc.querySlice({ dimX: 'triple', dimY: 'source' });
    assert(out.truncated === true, 'truncated flag set');
    assert(out.rows.length === SLICE_MAX_ROWS, `rows capped at ${SLICE_MAX_ROWS}`);
    const sql = db.calls[0].sql;
    assert(sql.includes('lateral jsonb_array_elements_text'), 'source dim pulls lateral unnest');
    assert(sql.includes('group by'), 'group by emitted for 2-D aggregation');
  }

  console.log('\nquerySlice: plain dimensions omit lateral unnest; reports truncated=false when small:');
  {
    const db = new MockDb(() => ({ data: [{ dim_analyst: 'a1', dim_instrument: 'AAPL', total_pnl_cents: 1 }] }));
    const svc = buildService(db); silence(svc);
    const out = await svc.querySlice({ dimX: 'analyst', dimY: 'instrument' });
    assert(out.truncated === false, 'truncated=false for small result');
    assert(out.rows.length === 1, 'one row pass-through');
    const sql = db.calls[0].sql;
    assert(!sql.includes('lateral'), 'no lateral for non-source slices');
  }

  console.log('\nqueryMySummary: currentMonth, byItem, history, topDecileItems all returned:');
  {
    let callIndex = 0;
    const db = new MockDb((_sql, _params, idx) => {
      callIndex = Math.max(callIndex, idx);
      if (idx === 0) return { data: [{ author_user_id: 'user-1', total_pnl_cents: 100 }] }; // current month
      if (idx === 1) return { data: [{ analyst_id: 'a1', instrument_id: 'AAPL' }] }; // byItem
      if (idx === 2) return { data: [{ year_month: '2026-04' }, { year_month: '2026-03' }] }; // history
      // queryGraduationCandidates internal call
      return {
        data: [
          { author_user_id: 'user-1', analyst_id: 'a1', instrument_id: 'AAPL', prediction_count: 30, hits_count: 20, total_pnl_cents: 500, avg_calibration_score: 0.6, analyst_item_id: null, analyst_item_kind: null, instrument_item_id: null, instrument_item_kind: null },
          { author_user_id: 'user-2', analyst_id: 'a2', instrument_id: 'MSFT', prediction_count: 30, hits_count: 10, total_pnl_cents: 100, avg_calibration_score: 0.1, analyst_item_id: null, analyst_item_kind: null, instrument_item_id: null, instrument_item_kind: null },
        ],
      };
    });
    const svc = buildService(db); silence(svc);
    const out = await svc.queryMySummary('user-1');
    assert(out.currentMonth !== null, 'currentMonth populated');
    assert(Array.isArray(out.byItem) && out.byItem.length === 1, 'byItem returned');
    assert(Array.isArray(out.history) && out.history.length === 2, 'history returned');
    assert(out.topDecileItems.length === 1, 'topDecileItems filtered to calling user');
    assert((out.topDecileItems[0] as Record<string, unknown>).authorUserId === 'user-1', 'topDecileItems only contains calling user');
    assert(db.calls.length >= 4, 'makes ≥ 4 DB calls (current, byItem, history, graduation)');
    const scopedCalls = db.calls.slice(0, 3);
    for (const c of scopedCalls) {
      assert((c.params as string[]).includes('user-1'), 'each scoped query passes userId as param');
    }
  }

  console.log('\nqueryMySummary: currentMonth null when no author_monthly row exists:');
  {
    const db = new MockDb((_sql, _params, idx) => {
      if (idx === 0) return { data: [] };
      if (idx === 1) return { data: [] };
      if (idx === 2) return { data: [] };
      return { data: [] };
    });
    const svc = buildService(db); silence(svc);
    const out = await svc.queryMySummary('user-999');
    assert(out.currentMonth === null, 'currentMonth is null on empty');
    assert(out.topDecileItems.length === 0, 'topDecileItems empty on empty');
  }

  console.log('\nqueryInstrument: base, byAuthor, topTriples returned with userOwned flag:');
  {
    const db = new MockDb((_sql, _params, idx) => {
      if (idx === 0) return { data: [{ instrument_id: 'AAPL', outcomes_count: 100, total_pnl_cents: 1000 }] };
      if (idx === 1) return {
        data: [
          { author_user_id: 'user-1', total_pnl_cents: 200 },
          { author_user_id: 'user-2', total_pnl_cents: 50 },
        ],
      };
      return {
        data: [
          { author_user_id: null, total_pnl_cents: 1000 },
          { author_user_id: 'user-1', total_pnl_cents: 200 },
        ],
      };
    });
    const svc = buildService(db); silence(svc);
    const out = await svc.queryInstrument('AAPL', 'user-1');
    assert(out.base !== null, 'base populated when author_user_id IS NULL row exists');
    assert(Array.isArray(out.byAuthor) && out.byAuthor.length === 2, 'byAuthor returned');
    const ba0 = out.byAuthor[0] as Record<string, unknown>;
    assert(ba0.userOwned === true, 'byAuthor user-1 tagged userOwned=true');
    const ba1 = out.byAuthor[1] as Record<string, unknown>;
    assert(ba1.userOwned === false, 'byAuthor user-2 tagged userOwned=false');
    assert(out.topTriples.length === 2, 'topTriples returned');
    const tt0 = out.topTriples[0] as Record<string, unknown>;
    assert(tt0.userOwned === false, 'top triple with null author_user_id is NOT userOwned');
  }

  console.log('\nqueryInstrument: callerUserId=null → userOwned=false everywhere:');
  {
    const db = new MockDb((_sql, _params, idx) => {
      if (idx === 0) return { data: [] };
      if (idx === 1) return { data: [{ author_user_id: 'user-1' }] };
      return { data: [{ author_user_id: 'user-1' }] };
    });
    const svc = buildService(db); silence(svc);
    const out = await svc.queryInstrument('AAPL', null);
    assert(out.base === null, 'base null when no NULL-author rows');
    const b0 = out.byAuthor[0] as Record<string, unknown>;
    assert(b0.userOwned === false, 'userOwned=false when callerUserId is null');
  }

  console.log('\nqueryPerTriple propagates DB error:');
  {
    const db = new MockDb(() => ({ error: { message: 'boom' } }));
    const svc = buildService(db); silence(svc);
    let caught: string | null = null;
    try { await svc.queryPerTriple({}); } catch (e) { caught = (e as Error).message; }
    assert(caught === 'boom', 'DB error surfaces to caller');
  }

  console.log('\nclampInt behavior (via pagination): invalid/negative/over-range inputs clamped:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db); silence(svc);
    await svc.queryPerTriple({ limit: -5 });
    assert(db.calls[0].sql.includes('limit 1'), 'limit clamped up to 1');
    const db2 = new MockDb(() => ({ data: [] }));
    const svc2 = buildService(db2); silence(svc2);
    await svc2.queryPerTriple({ limit: 9999 });
    assert(db2.calls[0].sql.includes('limit 1000'), 'limit clamped down to 1000');
    const db3 = new MockDb(() => ({ data: [] }));
    const svc3 = buildService(db3); silence(svc3);
    await svc3.queryPerTriple({ limit: 75 });
    assert(db3.calls[0].sql.includes('limit 75'), 'in-range limit preserved');
  }

  console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
