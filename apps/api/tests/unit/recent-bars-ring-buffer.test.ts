/**
 * Verifies the recent_bars ring buffer behavior on
 * OutcomeTrackingService:
 *   - getRecentBars returns the last N bars from instruments.current_state.recent_bars
 *   - updateInstrumentPrice (exercised via runTracking → captureSnapshots is too
 *     wide) — instead we test the trim/append math by invoking the private
 *     method through a test seam: we write a sequence of jsonb states via the
 *     mock DB and assert getRecentBars truncates correctly.
 *
 * Append + cap-32 behavior is exercised by directly invoking the private
 * updateInstrumentPrice via bracket access, which keeps this test focused
 * and DB-free.
 */
import { OutcomeTrackingService, RECENT_BARS_CAP, type RecentBar } from '../../src/markets/services/outcome-tracking.service';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall { sql: string; params: unknown[] }
class MockDb {
  public calls: MockCall[] = [];
  public state: { recent_bars?: RecentBar[] } = {};
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    if (sql.includes('select current_state from prediction.instruments')) {
      return { data: [{ current_state: this.state }], error: null };
    }
    if (sql.startsWith('update prediction.instruments')) {
      // The 7th param is the JSON.stringified next bars array.
      const nextBarsJson = params[6] as string;
      this.state = { ...this.state, recent_bars: JSON.parse(nextBarsJson) };
      return { data: [], error: null };
    }
    return { data: [], error: null };
  }
}

const mockObservability: any = { push: async () => {} };
const mockStopLoss: any = { sweep: async () => ({ closed: 0, updated: 0, skipped: 0 }) };

async function main(): Promise<void> {
  console.log('\n=== recent_bars ring buffer ===\n');

  // 1. getRecentBars returns empty when no bars persisted
  console.log('getRecentBars empty state:');
  {
    const db = new MockDb();
    const svc = new OutcomeTrackingService(db as any, mockObservability, mockStopLoss);
    const bars = await svc.getRecentBars('inst-1', 20);
    assert(bars.length === 0, 'returns empty array');
  }

  // 2. getRecentBars returns last N bars when more are stored
  console.log('\ngetRecentBars trims to last N:');
  {
    const db = new MockDb();
    db.state = {
      recent_bars: Array.from({ length: 10 }, (_, i) => ({ t: `t${i}`, o: i, h: i, l: i, c: i, v: 0 })),
    };
    const svc = new OutcomeTrackingService(db as any, mockObservability, mockStopLoss);
    const bars = await svc.getRecentBars('inst-1', 5);
    assert(bars.length === 5, 'returns 5 bars');
    assert(bars[0].c === 5 && bars[4].c === 9, 'returns oldest-first slice of last 5');
  }

  // 3. Append behavior via private updateInstrumentPrice — cap at RECENT_BARS_CAP
  console.log('\nupdateInstrumentPrice appends and caps at RECENT_BARS_CAP:');
  {
    const db = new MockDb();
    const svc = new OutcomeTrackingService(db as any, mockObservability, mockStopLoss);
    // Seed with CAP-1 prior bars
    db.state = {
      recent_bars: Array.from({ length: RECENT_BARS_CAP - 1 }, (_, i) => ({ t: `t${i}`, o: 1, h: 1, l: 1, c: 1, v: 0 })),
    };
    const updateFn = (svc as any).updateInstrumentPrice.bind(svc);
    const bars1 = Array.from({ length: RECENT_BARS_CAP }, (_, i) => ({ t: `b${i}`, o: 42, h: 42, l: 42, c: 42, v: 0 }));
    await updateFn('inst-1', { price: 42, change: 1, changePercent: 1, bars: bars1 });
    assert(db.state.recent_bars!.length === RECENT_BARS_CAP, `length is exactly ${RECENT_BARS_CAP} after first append`);

    // Append again — should still be capped, oldest dropped
    const bars2 = [...bars1.slice(1), { t: 'bN', o: 99, h: 99, l: 99, c: 99, v: 0 }];
    await updateFn('inst-1', { price: 99, change: 2, changePercent: 2, bars: bars2 });
    assert(db.state.recent_bars!.length === RECENT_BARS_CAP, `length stays at ${RECENT_BARS_CAP} after another append`);
    const last = db.state.recent_bars![RECENT_BARS_CAP - 1];
    assert(last.c === 99, 'newest bar is at the end');
  }

  // 4. Append from empty
  console.log('\nupdateInstrumentPrice from empty state:');
  {
    const db = new MockDb();
    const svc = new OutcomeTrackingService(db as any, mockObservability, mockStopLoss);
    const updateFn = (svc as any).updateInstrumentPrice.bind(svc);
    await updateFn('inst-1', { price: 50, change: 0, changePercent: 0, bars: [{ t: 't0', o: 50, h: 50, l: 50, c: 50, v: 0 }] });
    assert(db.state.recent_bars!.length === 1, 'first append yields 1 bar');
    assert(db.state.recent_bars![0].o === 50 && db.state.recent_bars![0].c === 50, 'o=c=price for bar');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
