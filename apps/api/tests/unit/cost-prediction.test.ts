/**
 * Unit tests for CostPredictionService.
 * Verifies cold-start vs established-user paths, headroom application, override math.
 */
import { CostPredictionService } from '../../src/cost-modeling/cost-prediction.service';

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

interface FakeCalibration {
  rolling_avg_cost_cents_per_call: number | null;
  samples_count: number;
}

class FakeCalibrationService {
  constructor(
    private readonly all: FakeCalibration[] = [],
    private readonly perModel: Map<string, FakeCalibration> = new Map(),
  ) {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getCalibration(): Promise<any[]> { return this.all; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getCalibrationFor(model: string, provider: string): Promise<any | null> {
    return this.perModel.get(`${model}:${provider}`) ?? null;
  }
}

function buildService(db: MockDb, calibration?: FakeCalibrationService): CostPredictionService {
  const cal = calibration ?? new FakeCalibrationService();
  return new (CostPredictionService as unknown as {
    new (db: MockDb, calibration: FakeCalibrationService): CostPredictionService;
  })(db, cal);
}

async function main(): Promise<void> {
  console.log('\n=== Cost Prediction Service Tests ===\n');
  const ORIGINAL_ENV = { ...process.env };
  process.env.COST_PREDICTION_HEADROOM_PCT = '25';
  process.env.COST_PREDICTION_MIN_HISTORY_DAYS = '14';

  console.log('predictForUser: cold-start (no history) seeds from peer percentile:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('history_days')) {
        return { data: [{ history_days: 0, raw_total_cents: 0 }] };
      }
      if (sql.includes('count(*)::integer as count')) {
        return { data: [{ count: 2 }] }; // 2 enabled triples → bin 1-3
      }
      if (sql.includes('percentile_cont(0.75)')) {
        return { data: [{ p75: 800 }] }; // peer p75 = 800 cents
      }
      if (sql.includes('llm_usage_per_stage_daily')) {
        return { data: [
          { stage: 'predictor_generation', total_cost_cents: 600 },
          { stage: 'risk_debate', total_cost_cents: 200 },
        ] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    const result = await svc.predictForUser('user-cold');
    assert(result.confidence === 'low', 'confidence=low for cold-start');
    assert(result.basisDays === 0, 'basisDays=0');
    assert(result.predictedMonthlyCents === 1000, 'p75=800 × 1.25 headroom = 1000');
    assert(result.confidenceRange[0] === 500, 'low bound = predicted × 0.5 (cold-start wider range)');
    assert(result.confidenceRange[1] === 1500, 'high bound = predicted × 1.5');
    assert(result.breakdownByStage.length === 2, 'cold-start breakdown by stage from system proportions');
    assert(result.breakdownByTriple.length === 0, 'cold-start has empty triple breakdown');
  }

  console.log('\npredictForUser: established user (>=28 days) high confidence:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('history_days')) {
        return { data: [{ history_days: 30, raw_total_cents: 1200 }] };
      }
      if (sql.includes("GROUP BY stage")) {
        return { data: [
          { stage: 'predictor_generation', total_cost_cents: 800 },
          { stage: 'risk_debate', total_cost_cents: 400 },
        ] };
      }
      if (sql.includes('GROUP BY analyst_id, instrument_id')) {
        return { data: [
          { analyst_id: 'a1', instrument_id: 'i1', total_cost_cents: 600 },
          { analyst_id: 'a2', instrument_id: 'i2', total_cost_cents: 600 },
        ] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    const result = await svc.predictForUser('user-est');
    // raw 1200 cents over 30 days → scale 1, then × 1.25 headroom = 1500
    assert(result.confidence === 'high', 'confidence=high (>=28 days)');
    assert(result.basisDays === 30, 'basisDays=30');
    assert(result.predictedMonthlyCents === 1500, '1200 × 1.25 = 1500');
    assert(result.confidenceRange[0] === 1125, 'low bound = predicted × 0.75');
    assert(result.confidenceRange[1] === 1875, 'high bound = predicted × 1.25');
    assert(result.breakdownByStage.length === 2, 'breakdown has 2 stages');
    assert(result.breakdownByTriple.length === 2, 'breakdown has 2 triples');
  }

  console.log('\npredictForUser: 14-27 days history yields medium confidence:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('history_days')) {
        return { data: [{ history_days: 20, raw_total_cents: 800 }] };
      }
      if (sql.includes('GROUP BY')) return { data: [] };
      return { data: [] };
    });
    const svc = buildService(db);
    const result = await svc.predictForUser('user-mid');
    assert(result.confidence === 'medium', 'confidence=medium (between min and 28)');
    assert(result.basisDays === 20, 'basisDays=20');
    // raw 800 over 20 days → scale 1.5 → 1200 → × 1.25 = 1500
    assert(result.predictedMonthlyCents === 1500, '800 × (30/20) × 1.25 = 1500');
  }

  console.log('\npredictForUser: configurationOverride addTriples raises prediction:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('history_days')) {
        return { data: [{ history_days: 30, raw_total_cents: 1000 }] };
      }
      if (sql.includes("GROUP BY stage")) return { data: [] };
      if (sql.includes('GROUP BY analyst_id, instrument_id')) {
        return { data: [
          { analyst_id: 'a1', instrument_id: 'i1', total_cost_cents: 500 },
          { analyst_id: 'a2', instrument_id: 'i2', total_cost_cents: 500 },
        ] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    const baseline = await svc.predictForUser('user-base');
    const withAdd = await svc.predictForUser('user-base', {
      addTriples: [{ analystId: 'a3', instrumentId: 'i3' }],
    });
    assert(withAdd.predictedMonthlyCents > baseline.predictedMonthlyCents, 'addTriples raises prediction');
    // baseline 1000 × 1.25 = 1250, with add: per-triple avg = 500, +500 → 1500 × 1.25 = 1875
    assert(withAdd.predictedMonthlyCents === 1875, 'adds one per-triple-avg (500) and rescales');
  }

  console.log('\npredictForUser: configurationOverride removeTriples lowers prediction:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('history_days')) {
        return { data: [{ history_days: 30, raw_total_cents: 1000 }] };
      }
      if (sql.includes("GROUP BY stage")) return { data: [] };
      if (sql.includes('GROUP BY analyst_id, instrument_id')) {
        return { data: [
          { analyst_id: 'a1', instrument_id: 'i1', total_cost_cents: 500 },
          { analyst_id: 'a2', instrument_id: 'i2', total_cost_cents: 500 },
        ] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    const result = await svc.predictForUser('user-base', {
      removeTriples: [{ analystId: 'a1', instrumentId: 'i1' }],
    });
    // baseline 1000 → remove one (-500) = 500 → × 1.25 = 625
    assert(result.predictedMonthlyCents === 625, 'removes one per-triple-avg (500) and rescales');
  }

  console.log('\npredictForUser: configurationOverride modelOverride scales by model ratio:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('history_days')) {
        return { data: [{ history_days: 30, raw_total_cents: 1000 }] };
      }
      if (sql.includes("GROUP BY stage")) return { data: [] };
      if (sql.includes('GROUP BY analyst_id, instrument_id')) {
        return { data: [
          { analyst_id: 'a1', instrument_id: 'i1', total_cost_cents: 500 },
          { analyst_id: 'a2', instrument_id: 'i2', total_cost_cents: 500 },
        ] };
      }
      return { data: [] };
    });
    // Calibration: current global avg = 5 cents (single model), new model avg = 10 cents → 2x
    const cal = new FakeCalibrationService(
      [{ rolling_avg_cost_cents_per_call: 5, samples_count: 100 }],
      new Map([['expensive:provX', { rolling_avg_cost_cents_per_call: 10, samples_count: 100 }]]),
    );
    const svc = buildService(db, cal);
    const result = await svc.predictForUser('user-base', {
      modelOverrides: [{ analystId: 'a1', provider: 'provX', model: 'expensive' }],
    });
    // baseline 1000, override one of two triples to 2x cost: half of 1000 stays + half × 2 = 1500 → × 1.25 = 1875
    assert(result.predictedMonthlyCents === 1875, 'half of cost scaled 2x');
  }

  console.log('\npredictForUser: zero-cost user with tokens returns zero prediction:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('history_days')) {
        return { data: [{ history_days: 30, raw_total_cents: 0 }] };
      }
      if (sql.includes('GROUP BY')) return { data: [] };
      return { data: [] };
    });
    const svc = buildService(db);
    const result = await svc.predictForUser('user-free');
    assert(result.predictedMonthlyCents === 0, 'zero cost in → zero cost out');
    assert(result.confidence === 'high', 'confidence still high based on history');
  }

  console.log('\npredictForUser: cold-start with empty peer pool returns zero predicted, low confidence:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('history_days')) {
        return { data: [{ history_days: 0, raw_total_cents: 0 }] };
      }
      if (sql.includes('count(*)::integer as count')) {
        return { data: [{ count: 1 }] };
      }
      if (sql.includes('percentile_cont(0.75)')) {
        return { data: [{ p75: null }] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    const result = await svc.predictForUser('user-pioneer');
    assert(result.confidence === 'low', 'confidence=low');
    assert(result.predictedMonthlyCents === 0, 'no peer data → 0 prediction');
  }

  process.env = ORIGINAL_ENV;
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
