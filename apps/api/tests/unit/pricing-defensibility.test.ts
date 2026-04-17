/**
 * Unit tests for PricingDefensibilityService.
 * Verifies fee/cost margin computation, under-priced and over-priced flags, env-var fallback.
 */
import { PricingDefensibilityService } from '../../src/cost-modeling/pricing-defensibility.service';

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

function buildService(db: MockDb): PricingDefensibilityService {
  return new (PricingDefensibilityService as unknown as {
    new (db: MockDb): PricingDefensibilityService;
  })(db);
}

async function main(): Promise<void> {
  console.log('\n=== Pricing Defensibility Service Tests ===\n');
  const ORIGINAL_ENV = { ...process.env };
  process.env.ANALYST_AUTHORSHIP_USD = '60';
  process.env.INSTRUMENT_AUTHORSHIP_USD = '20';
  process.env.CONTRACT_OVERRIDE_USD = '0';
  process.env.BYO_PLATFORM_FEE_USD = '10';

  console.log('summarizeByItemKind: empty items → env-var fallback fee:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    const rows = await svc.summarizeByItemKind();
    assert(rows.length === 5, '5 item kinds returned');
    const analyst = rows.find((r) => r.itemKind === 'custom_analyst')!;
    assert(analyst.currentMonthlyFeeCents === 6000, 'custom_analyst fee = $60 = 6000 cents');
    assert(analyst.avgMonthlyCostCents === 0, 'cost = 0 (no items)');
    assert(analyst.underPricedCount === 0, 'no under-priced items');
    assert(analyst.overPricedCount === 0, 'no over-priced items');
    const inst = rows.find((r) => r.itemKind === 'custom_instrument')!;
    assert(inst.currentMonthlyFeeCents === 2000, 'custom_instrument fee = $20 = 2000 cents');
  }

  console.log('\nsummarizeByItemKind: under-priced item flag fires when cost > fee:');
  {
    const db = new MockDb((sql, params) => {
      if (sql.includes('FROM billing.authored_items')) {
        if (params[0] === 'custom_analyst') {
          return { data: [{ user_id: 'author1', monthly_usd_cents: 6000 }] };
        }
        return { data: [] };
      }
      if (sql.includes('llm_usage_per_analyst_authorship_monthly')) {
        return { data: [{ total_cost_cents: 9000 }] }; // $90 cost vs $60 fee → under-priced
      }
      return { data: [] };
    });
    const svc = buildService(db);
    const rows = await svc.summarizeByItemKind();
    const analyst = rows.find((r) => r.itemKind === 'custom_analyst')!;
    assert(analyst.avgMonthlyCostCents === 9000, 'avg cost = 9000');
    assert(analyst.underPricedCount === 1, 'under-priced count = 1');
    assert(analyst.overPricedCount === 0, 'over-priced count = 0');
    assert(analyst.marginPct === -50, 'margin = (6000-9000)/6000 × 100 = -50');
  }

  console.log('\nsummarizeByItemKind: over-priced flag fires when fee > 2× cost:');
  {
    const db = new MockDb((sql, params) => {
      if (sql.includes('FROM billing.authored_items')) {
        if (params[0] === 'custom_instrument') {
          return { data: [{ user_id: 'author1', monthly_usd_cents: 2000 }] };
        }
        return { data: [] };
      }
      if (sql.includes('llm_usage_per_instrument_authorship_monthly')) {
        return { data: [{ total_cost_cents: 500 }] }; // $5 cost vs $20 fee → over-priced (fee > 2× cost = $10)
      }
      return { data: [] };
    });
    const svc = buildService(db);
    const rows = await svc.summarizeByItemKind();
    const inst = rows.find((r) => r.itemKind === 'custom_instrument')!;
    assert(inst.avgMonthlyCostCents === 500, 'avg cost = 500');
    assert(inst.overPricedCount === 1, 'over-priced count = 1');
    assert(inst.underPricedCount === 0, 'under-priced count = 0');
    assert(inst.marginPct === 75, 'margin = (2000-500)/2000 × 100 = 75');
  }

  console.log('\nsummarizeByItemKind: averages across multiple items:');
  {
    const db = new MockDb((sql, params) => {
      if (sql.includes('FROM billing.authored_items')) {
        if (params[0] === 'custom_analyst') {
          return { data: [
            { user_id: 'a1', monthly_usd_cents: 6000 },
            { user_id: 'a2', monthly_usd_cents: 6000 },
          ] };
        }
        return { data: [] };
      }
      if (sql.includes('llm_usage_per_analyst_authorship_monthly')) {
        const userId = params[0];
        return { data: [{ total_cost_cents: userId === 'a1' ? 4000 : 8000 }] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    const rows = await svc.summarizeByItemKind();
    const analyst = rows.find((r) => r.itemKind === 'custom_analyst')!;
    assert(analyst.avgMonthlyCostCents === 6000, 'avg of 4000 and 8000 = 6000');
    assert(analyst.currentMonthlyFeeCents === 6000, 'avg fee = 6000');
    assert(analyst.underPricedCount === 1, 'a2 is under-priced (8000 > 6000)');
    assert(analyst.overPricedCount === 0, 'neither is over-priced');
  }

  process.env = ORIGINAL_ENV;
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
