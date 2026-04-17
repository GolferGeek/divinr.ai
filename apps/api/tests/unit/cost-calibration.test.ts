/**
 * Unit tests for CostCalibrationService.
 * Verifies sample-count gating, drift detection, and the upsert contract.
 */
import { CostCalibrationService } from '../../src/cost-modeling/cost-calibration.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall { sql: string; params: unknown[] }

class MockDb {
  public calls: MockCall[] = [];
  constructor(private readonly script: (sql: string, params: unknown[], callIndex: number) => { data?: unknown; error?: { message: string } | null }) {}
  async rawQuery(sql: string, params: unknown[] = []) {
    const idx = this.calls.length;
    this.calls.push({ sql, params });
    return this.script(sql, params, idx);
  }
}

function buildService(db: MockDb): CostCalibrationService {
  return new (CostCalibrationService as unknown as {
    new (db: MockDb): CostCalibrationService;
  })(db);
}

function silenceLogger(svc: CostCalibrationService): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).logger = { log: () => {}, warn: () => {}, error: () => {} };
}

async function main(): Promise<void> {
  console.log('\n=== Cost Calibration Service Tests ===\n');
  const ORIGINAL_ENV = { ...process.env };

  // Pin env so default values are deterministic across the suite.
  process.env.COST_CALIBRATION_MIN_SAMPLES = '50';
  process.env.COST_CALIBRATION_DRIFT_THRESHOLD = '20';
  process.env.COST_CALIBRATION_DRIFT_MIN_SAMPLES = '200';
  process.env.COST_CALIBRATION_WINDOW_DAYS = '28';

  console.log('recomputeForModel: skips when samples below minimum:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('count(*)::integer as samples_count')) {
        return { data: [{
          samples_count: 10, avg_cost_cents: 5, avg_tokens_in: 100, avg_tokens_out: 50,
          avg_latency_ms: 200, total_tokens_in: 1000, total_tokens_out: 500,
          total_cost_cents: 50, window_start: '2026-04-01', window_end: '2026-04-15',
        }] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silenceLogger(svc);
    const result = await svc.recomputeForModel('m1', 'p1');
    assert(result.updated === false, 'updated=false when samples below min');
    assert(result.samplesCount === 10, 'samplesCount returned');
    assert(result.alertRaised === false, 'no alert raised');
    assert(db.calls.length === 1, 'short-circuits without further queries');
  }

  console.log('\nrecomputeForModel: updates when samples meet minimum, no prior:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('count(*)::integer as samples_count')) {
        return { data: [{
          samples_count: 60, avg_cost_cents: 10, avg_tokens_in: 200, avg_tokens_out: 100,
          avg_latency_ms: 300, total_tokens_in: 12000, total_tokens_out: 6000,
          total_cost_cents: 600, window_start: '2026-04-01', window_end: '2026-04-15',
        }] };
      }
      if (sql.includes('SELECT rolling_avg_cost_cents_per_call')) {
        return { data: [] }; // no prior calibration
      }
      if (sql.includes('INSERT INTO prediction.model_pricing_calibration')) {
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silenceLogger(svc);
    const result = await svc.recomputeForModel('m2', 'p2');
    assert(result.updated === true, 'updated=true');
    assert(result.alertRaised === false, 'no alert (no prior data)');
    assert(db.calls.some((c) => c.sql.includes('INSERT INTO prediction.model_pricing_calibration')), 'inserts/upserts calibration row');
  }

  console.log('\nrecomputeForModel: drift below threshold does not alert:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('count(*)::integer as samples_count')) {
        return { data: [{
          samples_count: 250, avg_cost_cents: 11, avg_tokens_in: 200, avg_tokens_out: 100,
          avg_latency_ms: 300, total_tokens_in: 50000, total_tokens_out: 25000,
          total_cost_cents: 2750, window_start: '2026-04-01', window_end: '2026-04-15',
        }] };
      }
      if (sql.includes('SELECT rolling_avg_cost_cents_per_call')) {
        return { data: [{ rolling_avg_cost_cents_per_call: 10 }] }; // 10% drift
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silenceLogger(svc);
    const result = await svc.recomputeForModel('m3', 'p3');
    assert(result.updated === true, 'updated=true');
    assert(result.alertRaised === false, '10% drift (< 20% threshold) does not alert');
    assert(!db.calls.some((c) => c.sql.includes('INSERT INTO prediction.model_pricing_drift_alerts')), 'no drift alert row inserted');
  }

  console.log('\nrecomputeForModel: drift above threshold but below sample minimum does not alert:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('count(*)::integer as samples_count')) {
        return { data: [{
          samples_count: 100, avg_cost_cents: 14, avg_tokens_in: 200, avg_tokens_out: 100,
          avg_latency_ms: 300, total_tokens_in: 20000, total_tokens_out: 10000,
          total_cost_cents: 1400, window_start: '2026-04-01', window_end: '2026-04-15',
        }] };
      }
      if (sql.includes('SELECT rolling_avg_cost_cents_per_call')) {
        return { data: [{ rolling_avg_cost_cents_per_call: 10 }] }; // 40% drift
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silenceLogger(svc);
    const result = await svc.recomputeForModel('m4', 'p4');
    assert(result.updated === true, 'updated=true');
    assert(result.alertRaised === false, '40% drift but only 100 samples (< 200) does not alert');
    assert(!db.calls.some((c) => c.sql.includes('INSERT INTO prediction.model_pricing_drift_alerts')), 'no alert row inserted');
  }

  console.log('\nrecomputeForModel: drift above threshold AND sufficient samples raises alert:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('count(*)::integer as samples_count')) {
        return { data: [{
          samples_count: 300, avg_cost_cents: 15, avg_tokens_in: 200, avg_tokens_out: 100,
          avg_latency_ms: 300, total_tokens_in: 60000, total_tokens_out: 30000,
          total_cost_cents: 4500, window_start: '2026-04-01', window_end: '2026-04-15',
        }] };
      }
      if (sql.includes('SELECT rolling_avg_cost_cents_per_call')) {
        return { data: [{ rolling_avg_cost_cents_per_call: 10 }] }; // 50% drift
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silenceLogger(svc);
    const result = await svc.recomputeForModel('m5', 'p5');
    assert(result.updated === true, 'updated=true');
    assert(result.alertRaised === true, '50% drift with 300 samples raises alert');
    const alertInsert = db.calls.find((c) => c.sql.includes('INSERT INTO prediction.model_pricing_drift_alerts'));
    assert(alertInsert !== undefined, 'drift alert row inserted');
    assert(alertInsert!.params[4] === 50, 'drift_pct=50 written to alert');
  }

  console.log('\nrecomputeForModel: first-time calibration leaves drift_pct null and writes calibration row:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('count(*)::integer as samples_count')) {
        return { data: [{
          samples_count: 80, avg_cost_cents: 7, avg_tokens_in: 150, avg_tokens_out: 80,
          avg_latency_ms: 250, total_tokens_in: 12000, total_tokens_out: 6400,
          total_cost_cents: 560, window_start: '2026-04-01', window_end: '2026-04-15',
        }] };
      }
      if (sql.includes('SELECT rolling_avg_cost_cents_per_call')) return { data: [] };
      return { data: [] };
    });
    const svc = buildService(db);
    silenceLogger(svc);
    const result = await svc.recomputeForModel('m6', 'p6');
    assert(result.updated === true, 'updated=true');
    const insert = db.calls.find((c) => c.sql.includes('INSERT INTO prediction.model_pricing_calibration'));
    // Param order: model, provider, samplesCount, window_start, window_end, avgCostCents,
    // avgTokensIn, avgTokensOut, avgLatency, perMillionIn, perMillionOut, previousAvg, driftPct
    assert(insert!.params[12] === null, 'drift_pct null on first calibration');
    assert(insert!.params[11] === null, 'previous_avg null on first calibration');
  }

  console.log('\nrunWeeklyCalibration: aggregates per-model results:');
  {
    const db = new MockDb((sql, params) => {
      if (sql.includes('SELECT DISTINCT model, provider')) {
        return { data: [{ model: 'mA', provider: 'pA' }, { model: 'mB', provider: 'pB' }] };
      }
      if (sql.includes('count(*)::integer as samples_count')) {
        // mA → small (skipped); mB → large (updates).
        const samples = params[0] === 'mA' ? 10 : 100;
        return { data: [{
          samples_count: samples,
          avg_cost_cents: 5, avg_tokens_in: 100, avg_tokens_out: 50,
          avg_latency_ms: 200, total_tokens_in: 1000, total_tokens_out: 500,
          total_cost_cents: 50, window_start: '2026-04-01', window_end: '2026-04-15',
        }] };
      }
      if (sql.includes('SELECT rolling_avg_cost_cents_per_call')) return { data: [] };
      return { data: [] };
    });
    const svc = buildService(db);
    silenceLogger(svc);
    const summary = await svc.runWeeklyCalibration();
    assert(summary.refreshedModels === 1, 'one model refreshed (one had enough samples)');
    assert(summary.skippedModels === 1, 'one model skipped (insufficient samples)');
    assert(summary.alertsRaised === 0, 'no alerts raised');
    assert(summary.perModel.length === 2, 'returns per-model results');
  }

  console.log('\ngetCalibration: returns coerced numeric rows:');
  {
    const db = new MockDb(() => ({ data: [{
      model: 'm', provider: 'p', last_calibrated_at: '2026-04-15T00:00:00Z',
      samples_count: '50', window_start: '2026-04-01', window_end: '2026-04-15',
      rolling_avg_cost_cents_per_call: '10.5', rolling_avg_tokens_in: '100',
      rolling_avg_tokens_out: '50', rolling_avg_latency_ms: '200',
      per_million_tokens_in_usd: '1.5', per_million_tokens_out_usd: '3.0',
      previous_avg_cost_cents_per_call: null, drift_pct: null,
    }] }));
    const svc = buildService(db);
    const rows = await svc.getCalibration();
    assert(rows.length === 1, 'returns one row');
    assert(typeof rows[0].samples_count === 'number', 'samples_count coerced to number');
    assert(rows[0].samples_count === 50, 'samples_count=50');
    assert(rows[0].rolling_avg_cost_cents_per_call === 10.5, 'rolling avg cost coerced');
    assert(rows[0].previous_avg_cost_cents_per_call === null, 'null previous remains null');
  }

  console.log('\ngetDriftAlerts: only-unacknowledged adds where clause:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    await svc.getDriftAlerts({ onlyUnacknowledged: true });
    assert(db.calls[0].sql.includes('WHERE acknowledged_at IS NULL'), 'where clause present when only unacknowledged');
  }

  console.log('\nacknowledgeDriftAlert: returns null when alert not found:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const svc = buildService(db);
    const result = await svc.acknowledgeDriftAlert('nope', 'admin-user');
    assert(result === null, 'returns null when no row updated');
  }

  console.log('\nacknowledgeDriftAlert: returns acknowledged_at when row updated:');
  {
    const db = new MockDb(() => ({ data: [{ acknowledged_at: '2026-04-17T12:00:00Z' }] }));
    const svc = buildService(db);
    const result = await svc.acknowledgeDriftAlert('alert-1', 'admin-user');
    assert(result?.acknowledged_at === '2026-04-17T12:00:00Z', 'returns acknowledged_at');
    assert(db.calls[0].params[0] === 'alert-1', 'passes id');
    assert(db.calls[0].params[1] === 'admin-user', 'passes user id');
  }

  // Restore env
  process.env = ORIGINAL_ENV;

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
