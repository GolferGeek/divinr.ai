/**
 * Unit tests for LeaderboardService.
 * Verifies cross-actor master-detail summary + portfolio detail shape.
 */
import { LeaderboardService } from '../../src/markets/services/leaderboard.service';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
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

async function main(): Promise<void> {
  console.log('\n=== LeaderboardService Tests ===\n');

  // 1. getAllPortfoliosSummary returns one row per portfolio with computed fields
  console.log('Summary shape:');
  {
    const db = new MockDb(() => ({
      data: [
        {
          kind: 'analyst', id: 'a1', name: 'Alpha',
          current_balance: 1100000, initial_balance: 1000000,
          realized_pnl: 100000, unrealized_pnl: 5000,
          wins: 6, closed_count: 10, total_bailouts: 0, open_position_count: 2,
        },
        {
          kind: 'arbitrator', id: 'pf-portfolio-arbitrator', name: 'Arbitrator',
          current_balance: 1000000, initial_balance: 1000000,
          realized_pnl: 0, unrealized_pnl: 0,
          wins: 0, closed_count: 0, total_bailouts: 0, open_position_count: 0,
        },
        {
          kind: 'day_trader', id: 'pf-portfolio-momentum-breakout', name: 'momentum',
          current_balance: 950000, initial_balance: 1000000,
          realized_pnl: -50000, unrealized_pnl: 0,
          wins: 2, closed_count: 5, total_bailouts: 0, open_position_count: 0,
        },
        {
          kind: 'user', id: 'up-1', name: 'admin@alpha-capital.demo',
          current_balance: 1020000, initial_balance: 1000000,
          realized_pnl: 20000, unrealized_pnl: 0,
          wins: 3, closed_count: 4, total_bailouts: 0, open_position_count: 1,
        },
      ],
      error: null,
    }));
    const svc = new LeaderboardService(db as any);
    const rows = await svc.getAllPortfoliosSummary();

    assert(rows.length === 4, 'returns 4 rows');
    assert(rows.find(r => r.kind === 'arbitrator')!.id === 'pf-portfolio-arbitrator', 'arbitrator id preserved');
    assert(rows.find(r => r.kind === 'day_trader') !== undefined, 'day_trader present');
    assert(rows.find(r => r.kind === 'user')!.name === 'admin@alpha-capital.demo', 'user name from user_id');

    const alpha = rows.find(r => r.id === 'a1')!;
    assert(alpha.win_rate === 60, 'win_rate computed (6/10 = 60%)');
    assert(Math.round(alpha.total_return_pct * 100) / 100 === 10, 'total_return_pct = 10');

    const arb = rows.find(r => r.id === 'pf-portfolio-arbitrator')!;
    assert(arb.win_rate === null, 'win_rate null when no closed positions');
  }

  // 2. getPortfolioDetail rejects invalid kind
  console.log('\nDetail validation:');
  {
    const db = new MockDb(() => ({ data: [], error: null }));
    const svc = new LeaderboardService(db as any);
    let threw = false;
    try { await svc.getPortfolioDetail({ kind: 'bogus', id: 'x' }); }
    catch { threw = true; }
    assert(threw, 'invalid kind throws');
  }

  // 3. getPortfolioDetail returns positions ordered open-first then by opened_at
  console.log('\nDetail returns positions + snapshots:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('from prediction.analyst_portfolios')) {
        return { data: [{ id: 'pf-1', kind: 'analyst', current_balance: 1000000 }], error: null };
      }
      if (sql.includes('from prediction.analyst_positions')) {
        return { data: [{ id: 'pos-1', status: 'open' }, { id: 'pos-2', status: 'closed' }], error: null };
      }
      if (sql.includes('from prediction.daily_pnl_snapshot')) {
        return { data: [{ snapshot_date: '2026-04-01' }, { snapshot_date: '2026-04-02' }], error: null };
      }
      return { data: [], error: null };
    });
    const svc = new LeaderboardService(db as any);
    const result = await svc.getPortfolioDetail({ kind: 'analyst', id: 'pf-1' });
    assert(result.portfolio !== null, 'portfolio loaded');
    assert(result.positions.length === 2, 'positions returned');
    assert(result.snapshots.length === 2, 'snapshots returned');
    // verify the snapshots query used asc order
    const snapCall = db.calls.find(c => c.sql.includes('from prediction.daily_pnl_snapshot'))!;
    assert(snapCall.sql.includes('snapshot_date asc'), 'snapshots ordered ascending by date');
    assert(snapCall.params[0] === 'analyst' && snapCall.params[1] === 'pf-1', 'snapshot query keyed correctly');
  }

  // 4. user kind hits user_portfolios + user_positions
  console.log('\nDetail for user kind:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('from prediction.user_portfolios')) {
        return { data: [{ id: 'up-1' }], error: null };
      }
      if (sql.includes('from prediction.user_positions')) {
        return { data: [{ id: 'upos-1' }], error: null };
      }
      if (sql.includes('from prediction.daily_pnl_snapshot')) {
        return { data: [], error: null };
      }
      return { data: [], error: null };
    });
    const svc = new LeaderboardService(db as any);
    const result = await svc.getPortfolioDetail({ kind: 'user', id: 'up-1' });
    assert(result.positions.length === 1, 'user positions returned');
    const snapCall = db.calls.find(c => c.sql.includes('from prediction.daily_pnl_snapshot'))!;
    assert(snapCall.params[0] === 'user', 'snapshot kind = user');
  }

  // 5. detail throws when portfolio not found
  console.log('\nDetail not found:');
  {
    const db = new MockDb(() => ({ data: [], error: null }));
    const svc = new LeaderboardService(db as any);
    let threw = false;
    try { await svc.getPortfolioDetail({ kind: 'analyst', id: 'missing' }); }
    catch { threw = true; }
    assert(threw, 'not found throws');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
