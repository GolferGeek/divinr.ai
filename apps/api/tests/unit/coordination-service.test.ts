/**
 * Unit tests for CoordinationService — correlation computation logic.
 * Tests agreement rate calculation, flag thresholds, pair ordering, and minimum sample filtering.
 */
import { CoordinationService } from '../../src/markets/services/coordination.service';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

function assertClose(actual: number, expected: number, tolerance: number, label: string): void {
  assert(Math.abs(actual - expected) <= tolerance, `${label} (got ${actual}, expected ~${expected})`);
}

interface MockCall { sql: string; params: unknown[] }
class MockDb {
  public calls: MockCall[] = [];
  constructor(private readonly script: (sql: string, params: unknown[]) => { data?: unknown; error?: { message: string } | null }) {}
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    return this.script(sql, params);
  }
}

class MockSchema {
  async ensureSchema() { /* no-op */ }
}

function buildService(db: MockDb): CoordinationService {
  return new (CoordinationService as unknown as {
    new (db: MockDb, schema: MockSchema): CoordinationService;
  })(db, new MockSchema());
}

async function main(): Promise<void> {
  console.log('\n=== CoordinationService Tests ===\n');

  // ─── periodToCutoff logic (tested via computeCorrelations SQL params) ───

  console.log('Correlation computation — period cutoff:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.computeCorrelations('30d');
    const call = db.calls[0];
    assert(call.params.length === 2, '30d period passes 2 params (cutoff + period)');
    assert(typeof call.params[0] === 'string', 'first param is cutoff ISO string');
    assert(call.params[1] === '30d', 'second param is period label');
  }

  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.computeCorrelations('all');
    const call = db.calls[0];
    assert(call.params.length === 1, 'all period passes 1 param (period only, no cutoff)');
    assert(call.params[0] === 'all', 'param is period label');
  }

  // ─── getCorrelations query building ───

  console.log('\nCorrelation retrieval — query filters:');
  {
    const db = new MockDb(() => ({
      data: [
        { analyst_a_id: 'a1', analyst_b_id: 'a2', agreement_rate: 0.95, flag: 'redundant',
          analyst_a_name: 'Alpha', analyst_b_name: 'Beta', sample_size: 20, period: '30d' },
      ],
    }));
    const svc = buildService(db);
    const rows = await svc.getCorrelations('30d');
    assert(rows.length === 1, 'returns rows from db');
    const call = db.calls[0];
    assert(call.params[0] === '30d', 'period param passed');
    assert(call.sql.includes('c.instrument_id is null'), 'aggregate mode when no instrumentId');
  }

  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.getCorrelations('90d', 'inst-1');
    const call = db.calls[0];
    assert(call.params.includes('inst-1'), 'instrument_id param passed');
    assert(call.sql.includes('c.instrument_id = $'), 'instrument filter applied');
  }

  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.getCorrelations('30d', undefined, true);
    const call = db.calls[0];
    assert(call.sql.includes('c.flag is not null'), 'flagOnly filter applied');
  }

  // ─── Flag threshold logic ───

  console.log('\nFlag thresholds (verified via SQL):');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.computeCorrelations('30d');
    const sql = db.calls[0].sql;
    assert(sql.includes('agreement_rate > 0.90'), 'redundant threshold is > 0.90');
    assert(sql.includes('agreement_rate < 0.20'), 'adversarial threshold is < 0.20');
  }

  // ─── Pair ordering enforcement ───

  console.log('\nPair ordering:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.computeCorrelations('30d');
    const sql = db.calls[0].sql;
    assert(sql.includes('e1.analyst_id < e2.analyst_id'), 'SQL enforces analyst_a < analyst_b via join');
  }

  // ─── Minimum sample size ───

  console.log('\nMinimum sample size:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.computeCorrelations('30d');
    const sql = db.calls[0].sql;
    assert(sql.includes('count(*) >= 5'), 'HAVING clause requires >= 5 shared predictions');
  }

  // ─── Error handling ───

  console.log('\nError handling:');
  {
    const db = new MockDb(() => ({ error: { message: 'connection refused' } }));
    const svc = buildService(db);
    let threw = false;
    try { await svc.computeCorrelations('30d'); }
    catch (e) { threw = true; assert((e as Error).message.includes('connection refused'), 'error message propagated'); }
    assert(threw, 'throws on db error');
  }

  // ─── Coverage Analysis ───

  console.log('\nCoverage computation — SQL structure:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.computeCoverage('30d');
    const sql = db.calls[0].sql;
    assert(sql.includes('avg_accuracy < 0.50'), 'gap threshold checks avg_accuracy < 0.50');
    assert(sql.includes('analyst_count < 2'), 'gap threshold checks analyst_count < 2');
    assert(sql.includes('analyst_coverage_gaps'), 'inserts into coverage gaps table');
  }

  console.log('\nCoverage retrieval:');
  {
    const db = new MockDb(() => ({
      data: [
        { instrument_id: 'i1', avg_accuracy: 0.35, is_gap: true, instrument_symbol: 'AAPL', analyst_count: 1 },
      ],
    }));
    const svc = buildService(db);
    const rows = await svc.getCoverage('30d');
    assert(rows.length === 1, 'returns coverage rows');
    assert(db.calls[0].sql.includes('order by g.avg_accuracy asc'), 'sorted by accuracy ascending');
  }

  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.getCoverage('30d', true);
    assert(db.calls[0].sql.includes('g.is_gap = true'), 'gapsOnly filter applied');
  }

  // ─── Contribution Scoring ───

  console.log('\nContribution scoring — majority vote simulation:');
  {
    // Simulate 3 runs: analyst "a1" participated in all, "a2" in 2, "a3" in all
    // Run 1: a1=up, a2=up, a3=down → actual=up → arb correct=true
    //   without a1: a2=up, a3=down → tie → flat ≠ up → incorrect
    //   without a2: a1=up, a3=down → tie → flat ≠ up → incorrect
    //   without a3: a1=up, a2=up → up = up → correct
    // Run 2: a1=down, a3=up → actual=down → arb correct=true
    //   without a1: a3=up → up ≠ down → incorrect
    //   without a3: a1=down → down = down → correct
    // Run 3: a1=up, a2=down, a3=up → actual=up → arb correct=true
    //   without a1: a2=down, a3=up → tie → flat ≠ up → incorrect
    //   without a2: a1=up, a3=up → up = up → correct
    //   without a3: a1=up, a2=down → tie → flat ≠ up → incorrect

    let callIdx = 0;
    const db = new MockDb((sql) => {
      callIdx++;
      // First call (ensureSchema): no-op
      // Second call (fetch runs):
      if (sql.includes('array_agg')) {
        return {
          data: [
            {
              run_id: 'r1', instrument_id: 'i1', arbitrator_correct: true, actual_direction: 'up',
              analyst_predictions: [
                { analyst_id: 'a1', direction: 'up' },
                { analyst_id: 'a2', direction: 'up' },
                { analyst_id: 'a3', direction: 'down' },
              ],
            },
            {
              run_id: 'r2', instrument_id: 'i1', arbitrator_correct: true, actual_direction: 'down',
              analyst_predictions: [
                { analyst_id: 'a1', direction: 'down' },
                { analyst_id: 'a3', direction: 'up' },
              ],
            },
            {
              run_id: 'r3', instrument_id: 'i1', arbitrator_correct: true, actual_direction: 'up',
              analyst_predictions: [
                { analyst_id: 'a1', direction: 'up' },
                { analyst_id: 'a2', direction: 'down' },
                { analyst_id: 'a3', direction: 'up' },
              ],
            },
          ],
        };
      }
      // Upsert calls:
      return { data: [] };
    });

    const svc = buildService(db);
    const count = await svc.computeContributions('30d');
    assert(count === 3, `upserted 3 analysts (got ${count})`);

    // Find upsert calls and verify values
    const upserts = db.calls.filter(c => c.sql.includes('analyst_contribution_scores'));

    // a1: 3 runs, arb correct = 3/3 = 1.0
    //   without a1: r1 tie→flat≠up (0), r2 a3=up≠down (0), r3 tie→flat≠up (0) → 0/3 = 0.0
    //   marginal = 1.0 - 0.0 = 1.0
    const a1Upsert = upserts.find(u => u.params[0] === 'a1');
    assert(!!a1Upsert, 'a1 upsert exists');
    if (a1Upsert) {
      assertClose(a1Upsert.params[2] as number, 1.0, 0.01, 'a1 composite_with = 1.0');
      assertClose(a1Upsert.params[3] as number, 0.0, 0.01, 'a1 composite_without = 0.0');
      assertClose(a1Upsert.params[4] as number, 1.0, 0.01, 'a1 marginal = 1.0');
    }

    // a2: 2 runs (r1, r3), arb correct = 2/2 = 1.0
    //   without a2: r1 a1=up,a3=down→tie→flat≠up (0), r3 a1=up,a3=up→up=up (1) → 1/2 = 0.5
    //   marginal = 1.0 - 0.5 = 0.5
    const a2Upsert = upserts.find(u => u.params[0] === 'a2');
    assert(!!a2Upsert, 'a2 upsert exists');
    if (a2Upsert) {
      assertClose(a2Upsert.params[4] as number, 0.5, 0.01, 'a2 marginal = 0.5');
      assert(a2Upsert.params[5] === 2, 'a2 prediction_count = 2');
    }

    // a3: 3 runs, arb correct = 3/3 = 1.0
    //   without a3: r1 a1=up,a2=up→up=up (1), r2 a1=down→down=down (1), r3 a1=up,a2=down→tie→flat≠up (0) → 2/3 ≈ 0.6667
    //   marginal = 1.0 - 0.6667 = 0.3333
    const a3Upsert = upserts.find(u => u.params[0] === 'a3');
    assert(!!a3Upsert, 'a3 upsert exists');
    if (a3Upsert) {
      assertClose(a3Upsert.params[4] as number, 0.3333, 0.01, 'a3 marginal ≈ 0.33');
    }
  }

  console.log('\nContribution retrieval:');
  {
    const db = new MockDb(() => ({
      data: [
        { analyst_id: 'a1', marginal_contribution: 0.15, analyst_name: 'Alpha' },
        { analyst_id: 'a2', marginal_contribution: -0.05, analyst_name: 'Beta' },
      ],
    }));
    const svc = buildService(db);
    const rows = await svc.getContributions('30d');
    assert(rows.length === 2, 'returns contribution rows');
    assert(db.calls[0].sql.includes('order by s.marginal_contribution desc'), 'sorted by contribution desc');
    assert(db.calls[0].sql.includes('s.instrument_id is null'), 'aggregate mode when no instrumentId');
  }

  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.getContributions('30d', 'inst-1');
    assert(db.calls[0].params.includes('inst-1'), 'instrumentId filter param passed');
  }

  // ─── Contribution with no data ───

  console.log('\nContribution scoring — empty data:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    const count = await svc.computeContributions('30d');
    assert(count === 0, 'returns 0 when no evaluated runs');
  }

  // ─── computeAll ───

  console.log('\ncomputeAll — runs all analyses for all periods:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    const result = await svc.computeAll();
    assert(result.status === 'completed', 'returns completed status');
    assert(typeof result.computed_at === 'string', 'returns computed_at ISO string');
    // 3 periods x 3 analyses = 9 compute calls, each hitting DB once for correlations/coverage,
    // and contributions doing 1 fetch + 0 upserts (no data) = 9 total
    // Actually, correlations=1 + coverage=1 + contributions=1(fetch) per period = 3 per period x 3 = 9
    assert(db.calls.length === 9, `9 DB calls for 3 periods x 3 analyses (got ${db.calls.length})`);
  }

  // ─── Cron guard ───

  console.log('\nCron guard:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    const origEnv = process.env.MARKETS_DISABLE_COORDINATION_CRON;
    process.env.MARKETS_DISABLE_COORDINATION_CRON = 'true';
    await svc.handleWeeklyCron();
    assert(db.calls.length === 0, 'cron skipped when env var set to true');
    process.env.MARKETS_DISABLE_COORDINATION_CRON = origEnv;
  }

  // ─── Summary ───

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
