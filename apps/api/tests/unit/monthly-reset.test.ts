/**
 * Unit tests for MonthlyResetService.
 * Verifies idempotency, ledger writes, balance reset, and the books-balance invariant.
 */
import { MonthlyResetService } from '../../src/markets/services/monthly-reset.service';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall { sql: string; params: unknown[] }

/**
 * In-memory DB stub modeling just enough state for the reset path.
 */
class FakeDb {
  public calls: MockCall[] = [];
  public analystPortfolios: Array<{ id: string; current_balance: number }> = [];
  public userPortfolios: Array<{ id: string; user_id: string; current_balance: number }> = [];
  public ledger: Array<{ kind: string; id: string; reset_date: string; balance_before: number; topup: number; cumulative: number }> = [];
  public closedAnalystPositions: string[] = [];
  public closedUserPositions: string[] = [];

  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });

    // ── instruments price snapshot ──
    if (sql.includes('from prediction.instruments') && sql.includes('is_active')) {
      return { data: [], error: null };
    }

    // ── analyst portfolios list ──
    if (sql.includes('from prediction.analyst_portfolios') && !sql.includes('where id =')) {
      return { data: this.analystPortfolios, error: null };
    }
    if (sql.includes('from prediction.analyst_portfolios') && sql.includes('where id =')) {
      const id = params[0] as string;
      const ap = this.analystPortfolios.find(p => p.id === id);
      return { data: ap ? [{ current_balance: ap.current_balance }] : [], error: null };
    }

    // ── analyst open positions list ──
    if (sql.includes("from prediction.analyst_positions where portfolio_id") && sql.includes("'open'")) {
      return { data: [], error: null };
    }

    // ── user portfolios list ──
    if (sql.includes('from prediction.user_portfolios') && !sql.includes('where id =')) {
      return { data: this.userPortfolios, error: null };
    }
    if (sql.includes('from prediction.user_portfolios') && sql.includes('where id =')) {
      const id = params[0] as string;
      const up = this.userPortfolios.find(p => p.id === id);
      return { data: up ? [{ current_balance: up.current_balance }] : [], error: null };
    }

    // ── user open positions list ──
    if (sql.includes("from prediction.user_positions where portfolio_id") && sql.includes("'open'")) {
      return { data: [], error: null };
    }

    // ── cumulative bailouts query ──
    if (sql.includes('coalesce(sum(topup_amount)') && sql.includes('bailout_ledger')) {
      const kind = params[0] as string;
      const id = params[1] as string;
      const total = this.ledger
        .filter(l => l.kind === kind && l.id === id)
        .reduce((acc, l) => acc + l.topup, 0);
      return { data: [{ total }], error: null };
    }

    // ── insert into bailout_ledger ──
    if (sql.includes('insert into prediction.bailout_ledger')) {
      const kind = params[1] as string;
      const id = params[2] as string;
      const today = new Date().toISOString().slice(0, 10);
      const dup = this.ledger.find(l => l.kind === kind && l.id === id && l.reset_date === today);
      if (dup) return { data: [], error: null };
      this.ledger.push({
        kind, id, reset_date: today,
        balance_before: Number(params[3]), topup: Number(params[4]), cumulative: Number(params[5]),
      });
      return { data: [{ id: 'inserted' }], error: null };
    }

    // ── update balance ──
    if (sql.includes('update prediction.analyst_portfolios') && sql.includes('current_balance')) {
      const newBal = Number(params[0]);
      const id = params[1] as string;
      const ap = this.analystPortfolios.find(p => p.id === id);
      if (ap) ap.current_balance = newBal;
      return { data: [], error: null };
    }
    if (sql.includes('update prediction.user_portfolios') && sql.includes('current_balance')) {
      const newBal = Number(params[0]);
      const id = params[1] as string;
      const up = this.userPortfolios.find(p => p.id === id);
      if (up) up.current_balance = newBal;
      return { data: [], error: null };
    }

    return { data: [], error: null };
  }
}

async function main(): Promise<void> {
  console.log('\n=== MonthlyResetService Tests ===\n');

  // 0. Cron is opt-in. Manual admin reset remains available, but scheduled
  // resets should not close normal user holdings unless explicitly enabled.
  console.log('Cron gate:');
  {
    const previous = process.env.MARKETS_ENABLE_MONTHLY_RESET;
    delete process.env.MARKETS_ENABLE_MONTHLY_RESET;
    const db = new FakeDb();
    const svc = new MonthlyResetService(db as any, {} as any, {} as any);
    let called = false;
    (svc as unknown as { runReset: MonthlyResetService['runReset'] }).runReset = async () => {
      called = true;
      return { ledgerRowsWritten: 0, alreadyResetCount: 0, portfoliosProcessed: 0, errors: [] };
    };
    await svc.handleCron();
    assert(called === false, 'scheduled reset is disabled unless MARKETS_ENABLE_MONTHLY_RESET=true');
    if (previous === undefined) delete process.env.MARKETS_ENABLE_MONTHLY_RESET;
    else process.env.MARKETS_ENABLE_MONTHLY_RESET = previous;
  }

  // 1. Writes one ledger row per portfolio + resets balance
  console.log('First reset:');
  {
    const db = new FakeDb();
    db.analystPortfolios.push(
      { id: 'pf-a', current_balance: 800_000 },
      { id: 'pf-b', current_balance: 1_050_000 },
    );
    db.userPortfolios.push({ id: 'up-1', user_id: 'user-1', current_balance: 950_000 });

    const svc = new MonthlyResetService(db as any, {} as any, {} as any);
    const result = await svc.runReset({ manual: true });

    assert(result.ledgerRowsWritten === 3, '3 ledger rows written');
    assert(result.alreadyResetCount === 0, 'no idempotent skips on first run');
    assert(result.portfoliosProcessed === 3, '3 portfolios processed');
    assert(db.ledger.length === 3, 'ledger has 3 rows');
    assert(db.ledger.find(l => l.id === 'pf-a')!.topup === 200_000, 'pf-a top-up = 200k');
    assert(db.ledger.find(l => l.id === 'pf-b')!.topup === 0, 'pf-b top-up = 0 (already over $1M)');
    assert(db.analystPortfolios.find(p => p.id === 'pf-a')!.current_balance === 1_000_000, 'pf-a reset to $1M');
    assert(db.analystPortfolios.find(p => p.id === 'pf-b')!.current_balance === 1_000_000, 'pf-b reset to $1M (capped)');
    assert(db.userPortfolios[0].current_balance === 1_000_000, 'user portfolio reset to $1M');
  }

  // 2. Second invocation in same month writes zero rows (idempotency)
  console.log('\nIdempotent re-run:');
  {
    const db = new FakeDb();
    db.analystPortfolios.push({ id: 'pf-a', current_balance: 800_000 });
    const svc = new MonthlyResetService(db as any, {} as any, {} as any);

    const first = await svc.runReset({ manual: true });
    assert(first.ledgerRowsWritten === 1, 'first run wrote 1 row');
    const balanceAfterFirst = db.analystPortfolios[0].current_balance;
    assert(balanceAfterFirst === 1_000_000, 'balance reset to $1M');

    // Simulate some loss after the reset
    db.analystPortfolios[0].current_balance = 900_000;

    const second = await svc.runReset({ manual: true });
    assert(second.ledgerRowsWritten === 0, 'second run wrote 0 rows (idempotent)');
    assert(second.alreadyResetCount === 1, 'second run reports already-reset');
    assert(db.analystPortfolios[0].current_balance === 900_000, 'balance NOT touched on idempotent re-run');
  }

  // 3. Books-balance invariant: initial + cumulative_bailouts == ending + Σ(realized losses)
  // Simplified: with no positions and no realized PnL, ending == initial + topup, and topup == cumulative.
  console.log('\nBooks-balance invariant:');
  {
    const db = new FakeDb();
    db.analystPortfolios.push({ id: 'pf-x', current_balance: 600_000 });
    const svc = new MonthlyResetService(db as any, {} as any, {} as any);

    await svc.runReset({ manual: true });
    const ledgerRow = db.ledger[0];
    const portfolio = db.analystPortfolios[0];

    // Invariant: balance_before + topup == ending_balance ($1M target)
    assert(ledgerRow.balance_before + ledgerRow.topup === portfolio.current_balance, 'balance_before + topup == ending balance');
    // Cumulative starts at this run's topup
    assert(ledgerRow.cumulative === ledgerRow.topup, 'cumulative == topup on first reset');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
