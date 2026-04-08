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
          sharpe_30d: 1.42, max_drawdown_30d: -0.084,
          longest_win_streak: 4, calibration_score: 0.78,
        },
        {
          kind: 'arbitrator', id: 'pf-portfolio-arbitrator', name: 'Arbitrator',
          current_balance: 1000000, initial_balance: 1000000,
          realized_pnl: 0, unrealized_pnl: 0,
          wins: 0, closed_count: 0, total_bailouts: 0, open_position_count: 0,
          sharpe_30d: null, max_drawdown_30d: null,
          longest_win_streak: 0, calibration_score: null,
        },
        {
          kind: 'day_trader', id: 'pf-portfolio-momentum-breakout', name: 'momentum',
          current_balance: 950000, initial_balance: 1000000,
          realized_pnl: -50000, unrealized_pnl: 0,
          wins: 2, closed_count: 5, total_bailouts: 0, open_position_count: 0,
          sharpe_30d: -0.31, max_drawdown_30d: -0.12,
          longest_win_streak: 1, calibration_score: null,
        },
        {
          kind: 'user', id: 'up-1', name: 'admin@alpha-capital.demo',
          current_balance: 1020000, initial_balance: 1000000,
          realized_pnl: 20000, unrealized_pnl: 0,
          wins: 3, closed_count: 4, total_bailouts: 0, open_position_count: 1,
          sharpe_30d: null, max_drawdown_30d: null,
          longest_win_streak: 2, calibration_score: null,
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

    assert(alpha.sharpe_30d === 1.42, 'sharpe_30d carried through');
    assert(alpha.max_drawdown_30d === -0.084, 'max_drawdown_30d carried through');
    assert(alpha.longest_win_streak === 4, 'longest_win_streak carried through');
    assert(alpha.calibration_score === 0.78, 'calibration_score carried for analyst');

    const dt = rows.find(r => r.kind === 'day_trader')!;
    assert(dt.calibration_score === null, 'calibration null for day_trader');
    assert(arb.sharpe_30d === null, 'sharpe null when no snapshots');
    assert(arb.longest_win_streak === 0, 'streak defaults to 0');
  }

  // Calibration buckets
  console.log('\nCalibration computation:');
  {
    // 25 evaluations spread across the 5 buckets at boundaries 50/60/70/80/90.
    const fixture: Array<{ conf: number; hit: number }> = [];
    const push = (conf: number, hits: number, total: number) => {
      for (let i = 0; i < total; i++) fixture.push({ conf, hit: i < hits ? 1 : 0 });
    };
    push(55, 2, 5); // 50–60: 40% realized
    push(65, 3, 5); // 60–70: 60%
    push(75, 4, 5); // 70–80: 80%
    push(85, 4, 5); // 80–90: 80%
    push(95, 5, 5); // 90+: 100%

    const db = new MockDb(() => ({ data: fixture, error: null }));
    const svc = new LeaderboardService(db as any);
    const cal = await svc.computeCalibration('analyst-1');
    assert(cal.buckets.length === 5, 'returns 5 buckets');
    assert(cal.buckets[0].count === 5 && cal.buckets[0].realized_rate === 40, 'bucket 50-60 realized 40%');
    assert(cal.buckets[4].count === 5 && cal.buckets[4].realized_rate === 100, 'bucket 90+ realized 100%');
    assert(cal.score !== null && cal.score > 0 && cal.score < 1, 'score computed (≥ 20 sample)');

    // Sub-threshold: only 19 samples → score null but buckets still present.
    const small = fixture.slice(0, 19);
    const db2 = new MockDb(() => ({ data: small, error: null }));
    const svc2 = new LeaderboardService(db2 as any);
    const cal2 = await svc2.computeCalibration('analyst-2');
    assert(cal2.score === null, 'score null below 20 sample threshold');
    assert(cal2.buckets.length === 5, 'buckets still returned below threshold');
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
