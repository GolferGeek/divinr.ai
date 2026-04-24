/**
 * Unit tests for StudentBillingService.
 * Verifies floor application, projection, my-summary structure.
 */
import { StudentBillingService } from '../../src/cost-modeling/student-billing.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
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

function buildService(db: MockDb): StudentBillingService {
  return new (StudentBillingService as unknown as {
    new (db: MockDb): StudentBillingService;
  })(db);
}

async function main(): Promise<void> {
  console.log('\n=== Student Billing Service Tests ===\n');
  const ORIGINAL_ENV = { ...process.env };
  // STUDENT_FLOOR_USD retired in stripe-integration effort — student billing
  // is now flat 10% of regular per-item Prices via Stripe. This service
  // remains for the informational compute-cost dashboard only.

  console.log('getUserCostCentsThisMonth: returns raw monthly cost in cents:');
  {
    const db = new MockDb(() => ({ data: [{ total_cost_cents: 200 }] })); // $2 raw
    const svc = buildService(db);
    const result = await svc.getUserCostCentsThisMonth('user-1');
    assert(result.rawCostCents === 200, 'rawCostCents = 200');
    assert(!('withFloorCents' in result), 'withFloorCents field removed');
  }

  console.log('\ngetUserCostCentsThisMonth: surfaces full raw amount:');
  {
    const db = new MockDb(() => ({ data: [{ total_cost_cents: 5000 }] })); // $50 raw
    const svc = buildService(db);
    const result = await svc.getUserCostCentsThisMonth('user-2');
    assert(result.rawCostCents === 5000, 'rawCostCents = 5000');
  }

  console.log('\ngetUserCostCentsThisMonth: zero when no usage row:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    const result = await svc.getUserCostCentsThisMonth('user-3');
    assert(result.rawCostCents === 0, 'rawCostCents = 0');
  }

  console.log('\ngetStudentAccrual: includes triple breakdown and projection:');
  {
    let usageCallSeen = false;
    let tripleCallSeen = false;
    let subCallSeen = false;
    const db = new MockDb((sql) => {
      if (sql.includes('llm_usage_per_user_monthly')) {
        usageCallSeen = true;
        return { data: [{ total_cost_cents: 600 }] };
      }
      if (sql.includes('billing.subscriptions')) {
        subCallSeen = true;
        return { data: [{ status: 'trial', trial_ends_at: null }] };
      }
      if (sql.includes('llm_usage_per_triple_daily')) {
        tripleCallSeen = true;
        return { data: [
          { analyst_id: 'a1', instrument_id: 'i1', cost_cents: 400, calls: 10 },
          { analyst_id: 'a2', instrument_id: 'i2', cost_cents: 200, calls: 5 },
        ] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    const result = await svc.getStudentAccrual('user-1');
    assert(usageCallSeen, 'queried monthly view');
    assert(subCallSeen, 'queried subscriptions for student tier');
    assert(tripleCallSeen, 'queried triple daily view');
    assert(result.isStudent === true, 'isStudent=true for trial subscription');
    assert(result.breakdownByTriple.length === 2, '2 triples in breakdown');
    assert(result.breakdownByTriple[0].costCents === 400, 'first triple cost = 400');
    assert(result.daysIntoPeriod >= 1, 'daysIntoPeriod >= 1');
    assert(result.projectedMonthlyCents > 0, 'projectedMonthlyCents derived from raw and days');
  }

  console.log('\ngetStudentAccrual: isStudent=false when no subscription:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('llm_usage_per_user_monthly')) return { data: [{ total_cost_cents: 0 }] };
      if (sql.includes('billing.subscriptions')) return { data: [] };
      return { data: [] };
    });
    const svc = buildService(db);
    const result = await svc.getStudentAccrual('user-x');
    assert(result.isStudent === false, 'isStudent=false when no subscription row');
  }

  console.log('\ngetStudentAccrual: isStudent=false for non-trial subscription:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('llm_usage_per_user_monthly')) return { data: [{ total_cost_cents: 0 }] };
      if (sql.includes('billing.subscriptions')) return { data: [{ status: 'active', trial_ends_at: null }] };
      return { data: [] };
    });
    const svc = buildService(db);
    const result = await svc.getStudentAccrual('user-paid');
    assert(result.isStudent === false, 'isStudent=false for active (non-trial) subscription');
  }

  console.log('\ngetMySummary: returns current and prior month plus three breakdowns:');
  {
    const db = new MockDb((sql, params) => {
      if (sql.includes('llm_usage_per_user_monthly')) {
        const ym = params[1] as string;
        return { data: [{
          total_calls: ym === '2026-04' ? 100 : 50,
          total_cost_cents: ym === '2026-04' ? 2000 : 1000,
        }] };
      }
      if (sql.includes('GROUP BY stage, sub_stage')) {
        return { data: [
          { stage: 'predictor_generation', sub_stage: null, cost_cents: 1500, calls: 60 },
          { stage: 'risk_debate', sub_stage: 'red', cost_cents: 500, calls: 40 },
        ] };
      }
      if (sql.includes('GROUP BY analyst_id, instrument_id')) {
        return { data: [{ analyst_id: 'a1', instrument_id: 'i1', cost_cents: 2000, calls: 100 }] };
      }
      if (sql.includes('GROUP BY model, provider')) {
        return { data: [{ model: 'gpt-4o-mini', provider: 'openai', cost_cents: 2000, calls: 100 }] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    const result = await svc.getMySummary('user-1', '2026-04');
    assert(result.yearMonth === '2026-04', 'yearMonth set');
    assert(result.totalCallsThisMonth === 100, 'totalCallsThisMonth=100');
    assert(result.totalCostCentsThisMonth === 2000, 'totalCostCentsThisMonth=2000');
    assert(result.byStage.length === 2, 'byStage 2 rows');
    assert(result.byStage[0].subStage === null, 'predictor_generation sub_stage null');
    assert(result.byStage[1].subStage === 'red', 'risk_debate sub_stage red');
    assert(result.byTriple.length === 1, 'byTriple 1 row');
    assert(result.byModel.length === 1, 'byModel 1 row');
    assert(result.priorMonth.totalCostCentsThisMonth === 1000, 'prior month totals queried');
  }

  process.env = ORIGINAL_ENV;
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
