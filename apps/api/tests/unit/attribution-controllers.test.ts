/**
 * Unit tests for AdminAttributionController + AuthorAttributionController.
 * Verifies admin gating, auth requirement, endpoint→service wiring, and PRD
 * query-param handling (yearMonth/from/to/authorUserId/analystId/instrumentId/sourceKey/limit/offset,
 * window/top/minPredictions, dimX/dimY).
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AdminAttributionController } from '../../src/attribution/admin-attribution.controller';
import { AuthorAttributionController } from '../../src/attribution/author-attribution.controller';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface Call { method: string; args: unknown[] }

function makeDb(isAdmin: boolean) {
  return {
    async rawQuery(sql: string, _params: unknown[] = []) {
      if (sql.includes('rbac_user_roles')) {
        return { data: isAdmin ? [{ name: 'admin' }] : [] };
      }
      return { data: [] };
    },
  };
}

function makeQueryServiceSpy() {
  const calls: Call[] = [];
  const spy = new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      if (prop === 'then') return undefined;
      return async (...args: unknown[]) => {
        calls.push({ method: prop, args });
        return { rows: [], candidates: [], currentMonth: null, byItem: [], history: [], topDecileItems: [], truncated: false, base: null, byAuthor: [], topTriples: [] };
      };
    },
  });
  return { spy, calls };
}

function makeAggregationSpy() {
  const calls: Call[] = [];
  const spy = {
    async refreshViews() {
      calls.push({ method: 'refreshViews', args: [] });
      return { refreshed: 6, failed: [] };
    },
  };
  return { spy, calls };
}

async function expectThrows(fn: () => Promise<unknown>, expectedType: typeof Error): Promise<boolean> {
  try { await fn(); return false; }
  catch (err) { return err instanceof expectedType; }
}

async function main(): Promise<void> {
  console.log('\n=== Attribution Controllers Tests ===\n');

  console.log('AdminAttributionController: all 7 read endpoints reject non-admin users with ForbiddenException:');
  {
    const db = makeDb(false);
    const { spy: q } = makeQueryServiceSpy();
    const { spy: agg } = makeAggregationSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AdminAttributionController(db as any, q as any, agg as any);
    const req = { user: { id: 'non-admin' } };
    const endpoints: Array<[string, () => Promise<unknown>]> = [
      ['per-triple', () => ctl.perTriple(req, {})],
      ['per-analyst', () => ctl.perAnalyst(req, {})],
      ['per-instrument', () => ctl.perInstrument(req, {})],
      ['per-source', () => ctl.perSource(req, {})],
      ['per-author', () => ctl.perAuthor(req, {})],
      ['graduation-candidates', () => ctl.graduationCandidates(req, '30d')],
      ['slice', () => ctl.slice(req, 'analyst', 'instrument', {})],
      ['refresh-views', () => ctl.refreshViews(req)],
    ];
    for (const [name, fn] of endpoints) {
      assert(await expectThrows(fn, ForbiddenException), `${name} rejects non-admin`);
    }
  }

  console.log('\nAdminAttributionController: rejects unauthenticated requests with BadRequestException:');
  {
    const db = makeDb(true);
    const { spy: q } = makeQueryServiceSpy();
    const { spy: agg } = makeAggregationSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AdminAttributionController(db as any, q as any, agg as any);
    const req = {};
    assert(await expectThrows(() => ctl.perTriple(req, {}), BadRequestException), 'per-triple refuses missing user');
    assert(await expectThrows(() => ctl.refreshViews(req), BadRequestException), 'refresh-views refuses missing user');
  }

  console.log('\nAdminAttributionController: admin passes all PRD query params through to service:');
  {
    const db = makeDb(true);
    const { spy: q, calls } = makeQueryServiceSpy();
    const { spy: agg } = makeAggregationSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AdminAttributionController(db as any, q as any, agg as any);
    const req = { user: { id: 'admin-1' } };
    await ctl.perTriple(req, {
      yearMonth: '2026-04',
      authorUserId: 'u-1',
      analystId: 'china',
      instrumentId: 'AAPL',
      limit: '25',
      offset: '50',
    });
    const filters = calls[0].args[0] as Record<string, unknown>;
    assert(filters.yearMonth === '2026-04', 'yearMonth passed');
    assert(filters.authorUserId === 'u-1', 'authorUserId passed');
    assert(filters.analystId === 'china', 'analystId passed');
    assert(filters.instrumentId === 'AAPL', 'instrumentId passed');
    assert(filters.limit === 25, 'limit coerced to number');
    assert(filters.offset === 50, 'offset coerced to number');
  }

  console.log('\nAdminAttributionController: per-triple handles from/to range params:');
  {
    const db = makeDb(true);
    const { spy: q, calls } = makeQueryServiceSpy();
    const { spy: agg } = makeAggregationSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AdminAttributionController(db as any, q as any, agg as any);
    const req = { user: { id: 'admin-1' } };
    await ctl.perTriple(req, { from: '2026-01', to: '2026-04' });
    const filters = calls[0].args[0] as Record<string, unknown>;
    assert(filters.from === '2026-01' && filters.to === '2026-04', 'from/to range passed');
  }

  console.log('\nAdminAttributionController: per-source handles sourceKey filter:');
  {
    const db = makeDb(true);
    const { spy: q, calls } = makeQueryServiceSpy();
    const { spy: agg } = makeAggregationSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AdminAttributionController(db as any, q as any, agg as any);
    const req = { user: { id: 'admin-1' } };
    await ctl.perSource(req, { sourceKey: 'reuters' });
    const filters = calls[0].args[0] as Record<string, unknown>;
    assert(filters.sourceKey === 'reuters', 'sourceKey passed');
  }

  console.log('\nAdminAttributionController: graduation-candidates validates window and passes top/minPredictions:');
  {
    const db = makeDb(true);
    const { spy: q, calls } = makeQueryServiceSpy();
    const { spy: agg } = makeAggregationSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AdminAttributionController(db as any, q as any, agg as any);
    const req = { user: { id: 'admin-1' } };
    await ctl.graduationCandidates(req, '7d', '25', '10');
    const params = calls[0].args[0] as Record<string, unknown>;
    assert(params.window === '7d', 'window forwarded');
    assert(params.top === 25, 'top coerced to number');
    assert(params.minPredictions === 10, 'minPredictions coerced to number');

    assert(await expectThrows(() => ctl.graduationCandidates(req, '42d'), BadRequestException), 'invalid window rejected');
    assert(await expectThrows(() => ctl.graduationCandidates(req, ''), BadRequestException), 'empty window rejected');
  }

  console.log('\nAdminAttributionController: graduation-candidates defaults window to 30d when unset:');
  {
    const db = makeDb(true);
    const { spy: q, calls } = makeQueryServiceSpy();
    const { spy: agg } = makeAggregationSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AdminAttributionController(db as any, q as any, agg as any);
    const req = { user: { id: 'admin-1' } };
    await ctl.graduationCandidates(req);
    const params = calls[0].args[0] as Record<string, unknown>;
    assert(params.window === '30d', 'window defaults to 30d');
  }

  console.log('\nAdminAttributionController: slice validates dimensions and requires both:');
  {
    const db = makeDb(true);
    const { spy: q } = makeQueryServiceSpy();
    const { spy: agg } = makeAggregationSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AdminAttributionController(db as any, q as any, agg as any);
    const req = { user: { id: 'admin-1' } };
    assert(await expectThrows(() => ctl.slice(req, undefined, 'analyst', {}), BadRequestException), 'missing dimX rejected');
    assert(await expectThrows(() => ctl.slice(req, 'analyst', undefined, {}), BadRequestException), 'missing dimY rejected');
    assert(await expectThrows(() => ctl.slice(req, 'foo', 'analyst', {}), BadRequestException), 'invalid dimX rejected');
    assert(await expectThrows(() => ctl.slice(req, 'analyst', 'foo', {}), BadRequestException), 'invalid dimY rejected');
    assert(await expectThrows(() => ctl.slice(req, 'analyst', 'analyst', {}), BadRequestException), 'identical dims rejected');
  }

  console.log('\nAdminAttributionController: slice passes valid dims + filters to service:');
  {
    const db = makeDb(true);
    const { spy: q, calls } = makeQueryServiceSpy();
    const { spy: agg } = makeAggregationSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AdminAttributionController(db as any, q as any, agg as any);
    const req = { user: { id: 'admin-1' } };
    await ctl.slice(req, 'analyst', 'source', { authorUserId: 'u-1' });
    const arg = calls[0].args[0] as Record<string, unknown>;
    assert(arg.dimX === 'analyst' && arg.dimY === 'source', 'both dims forwarded');
    const filters = arg.filters as Record<string, unknown>;
    assert(filters.authorUserId === 'u-1', 'filters forwarded');
  }

  console.log('\nAdminAttributionController: refresh-views invokes aggregation service only for admin:');
  {
    const db = makeDb(true);
    const { spy: q } = makeQueryServiceSpy();
    const { spy: agg, calls } = makeAggregationSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AdminAttributionController(db as any, q as any, agg as any);
    const req = { user: { id: 'admin-1' } };
    const out = await ctl.refreshViews(req);
    assert(calls.length === 1 && calls[0].method === 'refreshViews', 'aggregation.refreshViews invoked');
    assert((out as { refreshed: number }).refreshed === 6, 'returns refresh result');
  }

  console.log('\nAuthorAttributionController: my-summary uses auth.user.id, never accepts caller-supplied userId:');
  {
    const { spy: q, calls } = makeQueryServiceSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AuthorAttributionController(q as any);
    const req = { user: { id: 'user-42' } };
    await ctl.mySummary(req);
    assert(calls.length === 1 && calls[0].method === 'queryMySummary', 'queryMySummary invoked');
    assert(calls[0].args[0] === 'user-42', 'uses authenticated user id');
  }

  console.log('\nAuthorAttributionController: my-summary rejects unauthenticated callers:');
  {
    const { spy: q } = makeQueryServiceSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AuthorAttributionController(q as any);
    const req = {};
    assert(await expectThrows(() => ctl.mySummary(req), BadRequestException), 'unauthenticated my-summary rejected');
  }

  console.log('\nAuthorAttributionController: instrument endpoint works for any authenticated user and passes callerUserId:');
  {
    const { spy: q, calls } = makeQueryServiceSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AuthorAttributionController(q as any);
    const req = { user: { id: 'user-77' } };
    await ctl.instrument(req, 'AAPL');
    assert(calls.length === 1 && calls[0].method === 'queryInstrument', 'queryInstrument invoked');
    assert(calls[0].args[0] === 'AAPL', 'instrumentId forwarded');
    assert(calls[0].args[1] === 'user-77', 'callerUserId forwarded for userOwned tagging');
  }

  console.log('\nAuthorAttributionController: instrument rejects missing id and unauthenticated users:');
  {
    const { spy: q } = makeQueryServiceSpy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = new AuthorAttributionController(q as any);
    const req = { user: { id: 'user-77' } };
    assert(await expectThrows(() => ctl.instrument(req, ''), BadRequestException), 'empty instrument id rejected');
    assert(await expectThrows(() => ctl.instrument({}, 'AAPL'), BadRequestException), 'unauthenticated instrument rejected');
  }

  console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
