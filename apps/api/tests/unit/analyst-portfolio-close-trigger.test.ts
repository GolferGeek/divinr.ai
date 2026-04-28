/**
 * Verifies AnalystPortfolioService.closePosition writes the optional
 * triggerStrategy column on the close UPDATE, and stays backward
 * compatible when the parameter is omitted.
 */
import { AnalystPortfolioService } from '../../src/markets/services/analyst-portfolio.service';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall { sql: string; params: unknown[] }
class MockDb {
  public calls: MockCall[] = [];
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    if (sql.includes('select * from prediction.analyst_positions') && sql.includes("status = 'open'")) {
      return {
        data: [{
          id: 'pos-1',
          portfolio_id: 'pf-1',
          direction: 'long',
          entry_price: 100,
          quantity: 10,
          is_paper_only: false,
        }],
        error: null,
      };
    }
    if (sql.includes('select status, current_balance')) {
      return { data: [{ status: 'active', current_balance: 1_000_000 }], error: null };
    }
    return { data: [], error: null };
  }
}

const mockSchema: any = { ensureSchema: async () => {} };
const mockSizing: any = {
  calculatePnl: (_dir: string, entry: number, exit: number, qty: number) => (exit - entry) * qty,
};

async function main(): Promise<void> {
  console.log('\n=== AnalystPortfolioService.closePosition triggerStrategy ===\n');

  // 1. triggerStrategy provided alongside triggerReason
  console.log('triggerStrategy + triggerReason:');
  {
    const db = new MockDb();
    const svc = new AnalystPortfolioService(db as any, mockSchema, mockSizing);
    await svc.closePosition('pos-1', 110, 'strategy', 'momentum_breakout');
    const upd = db.calls.find(c => c.sql.includes("set status = 'closed'"));
    assert(upd !== undefined, 'close UPDATE issued');
    assert(upd!.sql.includes('trigger_strategy'), 'UPDATE references trigger_strategy column');
    assert(upd!.params.includes('momentum_breakout'), 'trigger_strategy param passed through');
    assert(upd!.params.includes('strategy'), 'trigger_reason param passed through');
    const cashUpdate = db.calls.find(c => c.sql.includes('update prediction.analyst_portfolios'));
    assert(cashUpdate !== undefined, 'portfolio cash update issued');
    assert(Number(cashUpdate!.params[0]) === 1100, 'long close credits sale proceeds');
  }

  // 2. triggerStrategy alone (no triggerReason)
  console.log('\ntriggerStrategy only:');
  {
    const db = new MockDb();
    const svc = new AnalystPortfolioService(db as any, mockSchema, mockSizing);
    await svc.closePosition('pos-1', 110, undefined, 'eod_flat');
    const upd = db.calls.find(c => c.sql.includes("set status = 'closed'"));
    assert(upd !== undefined, 'close UPDATE issued');
    assert(upd!.sql.includes('trigger_strategy'), 'UPDATE references trigger_strategy column');
    assert(upd!.params.includes('eod_flat'), 'trigger_strategy param passed through');
  }

  // 3. backward compatible — neither provided, no trigger_strategy value bound
  console.log('\nbackward compatible (neither):');
  {
    const db = new MockDb();
    const svc = new AnalystPortfolioService(db as any, mockSchema, mockSizing);
    await svc.closePosition('pos-1', 110);
    const upd = db.calls.find(c => c.sql.includes("set status = 'closed'"));
    assert(upd !== undefined, 'close UPDATE issued');
    // coalesce($N, trigger_strategy) keeps existing value when bound is null
    assert(upd!.params[upd!.params.length - 1] === null, 'trigger_strategy bound as null when omitted');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
