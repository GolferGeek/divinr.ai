/**
 * Unit tests for LlmUsageQueryService.
 * Verifies query construction and empty-result handling.
 */
import { LlmUsageQueryService } from '../../src/markets/services/llm-usage-query.service';

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

function buildService(db: MockDb): LlmUsageQueryService {
  return new (LlmUsageQueryService as unknown as {
    new (db: MockDb): LlmUsageQueryService;
  })(db);
}

async function main(): Promise<void> {
  console.log('\n=== LLM Usage Query Service Tests ===\n');

  console.log('getSummary:');
  {
    const db = new MockDb(() => ({ data: [{ total_calls: 42, total_tokens_in: 1000, total_tokens_out: 500, total_cost_cents: 150 }] }));
    const svc = buildService(db);
    const result = await svc.getSummary({ startDate: '2026-04-01', endDate: '2026-04-30' });
    assert(result.total_calls === 42, 'returns total_calls from DB');
    assert(db.calls[0].params.length === 2, 'passes 2 params for start/end date');
    assert(db.calls[0].sql.includes('prediction.llm_usage_log'), 'queries raw table');
  }

  console.log('\ngetSummary empty result:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    const result = await svc.getSummary({});
    assert(result.total_calls === 0, 'returns zero defaults on empty result');
  }

  console.log('\ngetByUser:');
  {
    const db = new MockDb(() => ({ data: [{ billed_user_id: 'u1', year_month: '2026-04', total_calls: 10, total_tokens_in: 200, total_tokens_out: 100, total_cost_cents: 50 }] }));
    const svc = buildService(db);
    const result = await svc.getByUser('2026-04-01', '2026-04-30');
    assert(Array.isArray(result), 'returns an array');
    assert(result.length === 1, 'returns one row');
    assert(db.calls[0].sql.includes('llm_usage_per_user_monthly'), 'queries materialized view');
  }

  console.log('\ngetByStage:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    const result = await svc.getByStage('2026-04-01', '2026-04-30');
    assert(Array.isArray(result), 'returns an array');
    assert(result.length === 0, 'returns empty on no data');
    assert(db.calls[0].sql.includes('llm_usage_per_stage_daily'), 'queries stage view');
  }

  console.log('\ngetByModel:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.getByModel('2026-04-01', '2026-04-30');
    assert(db.calls[0].sql.includes('llm_usage_per_model_daily'), 'queries model view');
  }

  console.log('\ngetByTriple:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.getByTriple('user-1', '2026-04-01', '2026-04-30');
    assert(db.calls[0].params[0] === 'user-1', 'passes userId as first param');
    assert(db.calls[0].sql.includes('llm_usage_per_triple_daily'), 'queries triple view');
  }

  console.log('\ngetBaseVsExtension:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.getBaseVsExtension('2026-04-01', '2026-04-30');
    assert(db.calls[0].sql.includes('llm_usage_base_vs_extension_daily'), 'queries base vs extension view');
  }

  console.log('\ngetMyUsage:');
  {
    const db = new MockDb(() => ({ data: [{ total_calls: 5, total_tokens_in: 100, total_tokens_out: 50, total_cost_cents: 10 }] }));
    const svc = buildService(db);
    const result = await svc.getMyUsage('user-1');
    assert(result.total_calls === 5, 'returns user total_calls');
    assert(db.calls[0].params[0] === 'user-1', 'passes userId');
    assert(db.calls[0].sql.includes('llm_usage_per_user_monthly'), 'queries user monthly view');
  }

  console.log('\ngetMyUsage empty:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    const result = await svc.getMyUsage('user-2');
    assert(result.total_calls === 0, 'returns zero defaults');
  }

  console.log('\nrefreshViews:');
  {
    const db = new MockDb(() => ({ data: null }));
    const svc = buildService(db);
    (svc as any).logger = { log: () => {}, warn: () => {} };
    await svc.refreshViews();
    assert(db.calls.length === 8, 'refreshes all 8 views');
    assert(db.calls[0].sql.includes('REFRESH MATERIALIZED VIEW'), 'uses REFRESH');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
