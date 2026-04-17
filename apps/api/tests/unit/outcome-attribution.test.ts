/**
 * Unit tests for OutcomeAttributionService.
 * Verifies cutoff filtering, calibration scoring, position vs calibration method,
 * predictor lookback window, source_keys derivation, and idempotency wiring.
 */
import { OutcomeAttributionService } from '../../src/attribution/outcome-attribution.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall { sql: string; params: unknown[] }

type Script = (sql: string, params: unknown[], callIndex: number) => { data?: unknown; error?: { message: string } | null };

class MockDb {
  public calls: MockCall[] = [];
  constructor(private readonly script: Script) {}
  async rawQuery(sql: string, params: unknown[] = []) {
    const idx = this.calls.length;
    this.calls.push({ sql, params });
    return this.script(sql, params, idx);
  }
}

function buildService(db: MockDb): OutcomeAttributionService {
  return new (OutcomeAttributionService as unknown as {
    new (db: MockDb): OutcomeAttributionService;
  })(db);
}

function silence(svc: OutcomeAttributionService): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).logger = { log: () => {}, warn: () => {}, error: () => {} };
}

function makeEvalRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    eval_id: 'eval-1',
    prediction_id: 'pred-1',
    run_id: 'run-1',
    analyst_id: 'analyst-1',
    instrument_id: 'inst-1',
    horizon_window: 1,
    prediction_date: '2026-04-20T10:00:00Z',
    evaluation_date: '2026-04-21T10:00:00Z',
    predicted_direction: 'up',
    actual_direction: 'up',
    was_correct: true,
    confidence_at_prediction: 0.8,
    author_user_id: null,
    pred_author_user_id: null,
    pred_analyst_id: 'analyst-1',
    config_version_id: 'cfg-v1',
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log('\n=== Outcome Attribution Service Tests ===\n');
  const ORIGINAL_ENV = { ...process.env };
  process.env.ATTRIBUTION_CUTOFF_DATE = '2026-04-19';
  process.env.ATTRIBUTION_PREDICTOR_LOOKBACK_HOURS = '24';

  console.log('cutoff: evaluations before cutoff are excluded from scan:');
  {
    let capturedSince: string | undefined;
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        capturedSince = params[0] as string;
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    // Pass a runStartedAt BEFORE cutoff — the scan should clamp to the cutoff.
    await svc.recordOutcomesForEvaluationRun(new Date('2026-04-01T00:00:00Z'));
    const since = new Date(capturedSince ?? '');
    assert(since.toISOString() === new Date('2026-04-19').toISOString(), 'scan since-date clamped to cutoff');
    assert(db.calls[0].params[1] === new Date('2026-04-19').toISOString(), 'evaluation_date threshold = cutoff');
  }

  console.log('\ncutoff: cutoff respected when runStartedAt is after cutoff:');
  {
    let capturedSince: string | undefined;
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        capturedSince = params[0] as string;
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    const runStart = new Date('2026-05-01T00:00:00Z');
    await svc.recordOutcomesForEvaluationRun(runStart);
    assert(capturedSince === runStart.toISOString(), 'scan since = runStart when post-cutoff');
  }

  console.log('\ncalibration: score is +confidence when was_correct=true:');
  {
    const inserts: unknown[] = [];
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow({ was_correct: true, confidence_at_prediction: 0.75 })] };
      }
      if (sql.includes('from prediction.analyst_positions')) return { data: [] };
      if (sql.includes('from prediction.market_predictors')) return { data: [] };
      if (sql.includes('insert into prediction.outcome_records')) {
        inserts.push(params);
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    const res = await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    assert(res.inserted === 1, 'one outcome inserted');
    const params = inserts[0] as unknown[];
    assert(params[17] === 0.75, 'calibration_score = +0.75');
    assert(params[15] === 'calibration', 'attribution_method = calibration');
    assert(params[16] === 0, 'attributable_pnl_cents = 0 for calibration method');
    assert(params[14] === 'paper', 'pnl_type = paper by default');
  }

  console.log('\ncalibration: score is -confidence when was_correct=false:');
  {
    const inserts: unknown[] = [];
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow({ was_correct: false, confidence_at_prediction: 0.6 })] };
      }
      if (sql.includes('from prediction.analyst_positions')) return { data: [] };
      if (sql.includes('from prediction.market_predictors')) return { data: [] };
      if (sql.includes('insert into prediction.outcome_records')) {
        inserts.push(params);
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    const params = inserts[0] as unknown[];
    assert(params[17] === -0.6, 'calibration_score = -0.6');
  }

  console.log('\ncalibration: confidence null → normalized to 0:');
  {
    const inserts: unknown[] = [];
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow({ confidence_at_prediction: null })] };
      }
      if (sql.includes('from prediction.analyst_positions')) return { data: [] };
      if (sql.includes('from prediction.market_predictors')) return { data: [] };
      if (sql.includes('insert into prediction.outcome_records')) {
        inserts.push(params);
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    const params = inserts[0] as unknown[];
    assert(params[17] === 0, 'null confidence → calibration_score = 0');
  }

  console.log('\nposition: method=position and pnl_cents populated when analyst_positions row exists:');
  {
    const inserts: unknown[] = [];
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow()] };
      }
      if (sql.includes('from prediction.analyst_positions')) {
        return { data: [{ realized_pnl: 42.5, status: 'closed' }] };
      }
      if (sql.includes('from prediction.market_predictors')) return { data: [] };
      if (sql.includes('insert into prediction.outcome_records')) {
        inserts.push(params);
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    const params = inserts[0] as unknown[];
    assert(params[15] === 'position', 'attribution_method = position');
    assert(params[16] === 4250, 'attributable_pnl_cents = round(42.5 * 100)');
  }

  console.log('\nposition: union of analyst + user positions summed:');
  {
    const inserts: unknown[] = [];
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow()] };
      }
      if (sql.includes('from prediction.analyst_positions')) {
        return { data: [
          { realized_pnl: 10, status: 'closed' },
          { realized_pnl: -3.5, status: 'closed' },
        ] };
      }
      if (sql.includes('from prediction.market_predictors')) return { data: [] };
      if (sql.includes('insert into prediction.outcome_records')) {
        inserts.push(params);
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    const params = inserts[0] as unknown[];
    assert(params[15] === 'position', 'method=position when multiple closed positions exist');
    assert(params[16] === 650, 'pnl_cents sums all closed positions (10 + -3.5 = 6.5 → 650)');
  }

  console.log('\npredictors: populate arrays + method=lookback_window:');
  {
    const inserts: unknown[] = [];
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow()] };
      }
      if (sql.includes('from prediction.analyst_positions')) return { data: [] };
      if (sql.includes('from prediction.market_predictors')) {
        return { data: [
          { id: 'predictor-1', article_id: 'art-1', external_source_slug: 'reuters' },
          { id: 'predictor-2', article_id: 'art-1', external_source_slug: 'reuters' },
          { id: 'predictor-3', article_id: 'art-2', external_source_slug: 'benzinga' },
          { id: 'predictor-4', article_id: 'art-3', external_source_slug: null },
        ] };
      }
      if (sql.includes('insert into prediction.outcome_records')) {
        inserts.push(params);
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    const params = inserts[0] as unknown[];
    const predictorIds = JSON.parse(params[18] as string);
    const articleIds = JSON.parse(params[19] as string);
    const sourceKeys = JSON.parse(params[20] as string);
    assert(predictorIds.length === 4, 'predictor_ids captures all predictors');
    assert(articleIds.length === 3, 'article_ids dedupes to 3 unique');
    assert(sourceKeys.length === 2, 'source_keys dedupes to 2 (drops null)');
    assert(sourceKeys.includes('reuters') && sourceKeys.includes('benzinga'), 'source_keys content correct');
    assert(params[21] === 'lookback_window', 'predictor_attribution_method = lookback_window');
  }

  console.log('\npredictors: no predictors → method=none, empty arrays:');
  {
    const inserts: unknown[] = [];
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow()] };
      }
      if (sql.includes('from prediction.analyst_positions')) return { data: [] };
      if (sql.includes('from prediction.market_predictors')) return { data: [] };
      if (sql.includes('insert into prediction.outcome_records')) {
        inserts.push(params);
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    const params = inserts[0] as unknown[];
    assert(JSON.parse(params[18] as string).length === 0, 'predictor_ids empty');
    assert(JSON.parse(params[19] as string).length === 0, 'article_ids empty');
    assert(JSON.parse(params[20] as string).length === 0, 'source_keys empty');
    assert(params[21] === 'none', 'predictor_attribution_method = none');
  }

  console.log('\npredictors: lookback hours passed to query:');
  {
    process.env.ATTRIBUTION_PREDICTOR_LOOKBACK_HOURS = '48';
    let lookbackParam: unknown;
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow()] };
      }
      if (sql.includes('from prediction.analyst_positions')) return { data: [] };
      if (sql.includes('from prediction.market_predictors')) {
        lookbackParam = params[4];
        return { data: [] };
      }
      if (sql.includes('insert into prediction.outcome_records')) return { data: [] };
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    assert(lookbackParam === 48, 'lookback hours param = 48 from env');
    process.env.ATTRIBUTION_PREDICTOR_LOOKBACK_HOURS = '24';
  }

  console.log('\nidempotency: insert uses ON CONFLICT DO NOTHING keyed on evaluation_id:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow()] };
      }
      if (sql.includes('from prediction.analyst_positions')) return { data: [] };
      if (sql.includes('from prediction.market_predictors')) return { data: [] };
      if (sql.includes('insert into prediction.outcome_records')) return { data: [] };
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    const insertCall = db.calls.find((c) => c.sql.includes('insert into prediction.outcome_records'));
    assert(!!insertCall, 'insert call issued');
    assert(insertCall!.sql.includes('on conflict (evaluation_id) do nothing'), 'uses ON CONFLICT (evaluation_id) DO NOTHING');
  }

  console.log('\nidempotency: scan excludes evaluations already having outcome_records:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        assert(sql.includes('not exists') && sql.includes('prediction.outcome_records'), 'scan uses NOT EXISTS against outcome_records');
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
  }

  console.log('\nanalyst-less predictions: skip (no analyst means not attributable):');
  {
    const inserts: unknown[] = [];
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow({ analyst_id: null, pred_analyst_id: null })] };
      }
      if (sql.includes('from prediction.analyst_positions')) return { data: [] };
      if (sql.includes('from prediction.market_predictors')) return { data: [] };
      if (sql.includes('insert into prediction.outcome_records')) {
        inserts.push(params);
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    const res = await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    assert(res.inserted === 1, 'counter still increments (scanned + attempted)');
    assert(inserts.length === 0, 'no insert call issued for analyst-less prediction');
  }

  console.log('\nauthor fallback: phe.author_user_id trumps mp.author_user_id:');
  {
    const inserts: unknown[] = [];
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow({ author_user_id: 'user-A', pred_author_user_id: 'user-B' })] };
      }
      if (sql.includes('from prediction.analyst_positions')) return { data: [] };
      if (sql.includes('from prediction.market_predictors')) return { data: [] };
      if (sql.includes('insert into prediction.outcome_records')) {
        inserts.push(params);
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    const params = inserts[0] as unknown[];
    assert(params[4] === 'user-A', 'author_user_id pulled from phe first');
  }

  console.log('\nauthor fallback: uses prediction author when phe.author_user_id null:');
  {
    const inserts: unknown[] = [];
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow({ author_user_id: null, pred_author_user_id: 'user-B' })] };
      }
      if (sql.includes('from prediction.analyst_positions')) return { data: [] };
      if (sql.includes('from prediction.market_predictors')) return { data: [] };
      if (sql.includes('insert into prediction.outcome_records')) {
        inserts.push(params);
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    const params = inserts[0] as unknown[];
    assert(params[4] === 'user-B', 'falls back to mp.author_user_id');
  }

  console.log('\nerror handling: scan DB error returns zero counts without throwing:');
  {
    const db = new MockDb(() => ({ error: { message: 'boom' } }));
    const svc = buildService(db);
    silence(svc);
    const res = await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    assert(res.scanned === 0, 'scanned=0 on error');
    assert(res.inserted === 0, 'inserted=0 on error');
  }

  console.log('\nerror handling: per-row insert error increments errors counter:');
  {
    const db = new MockDb((sql) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow(), makeEvalRow({ eval_id: 'eval-2', prediction_id: 'pred-2' })] };
      }
      if (sql.includes('from prediction.analyst_positions')) return { data: [] };
      if (sql.includes('from prediction.market_predictors')) return { data: [] };
      if (sql.includes('insert into prediction.outcome_records')) {
        return { error: { message: 'unique violation maybe' } };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    const res = await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    assert(res.scanned === 2, 'scanned=2');
    assert(res.errors === 2, 'both rows counted as errors');
    assert(res.inserted === 0, 'none inserted');
  }

  console.log('\nenv: invalid cutoff falls back to 2026-04-19 default:');
  {
    process.env.ATTRIBUTION_CUTOFF_DATE = 'not-a-date';
    let capturedCutoff: string | undefined;
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        capturedCutoff = params[1] as string;
        return { data: [] };
      }
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    assert(capturedCutoff === new Date('2026-04-19').toISOString(), 'invalid env → default cutoff');
    process.env.ATTRIBUTION_CUTOFF_DATE = '2026-04-19';
  }

  console.log('\nenv: invalid lookback hours falls back to 24:');
  {
    process.env.ATTRIBUTION_PREDICTOR_LOOKBACK_HOURS = 'abc';
    let lookback: unknown;
    const db = new MockDb((sql, params) => {
      if (sql.includes('from prediction.prediction_horizon_evaluations')) {
        return { data: [makeEvalRow()] };
      }
      if (sql.includes('from prediction.analyst_positions')) return { data: [] };
      if (sql.includes('from prediction.market_predictors')) {
        lookback = params[4];
        return { data: [] };
      }
      if (sql.includes('insert into prediction.outcome_records')) return { data: [] };
      return { data: [] };
    });
    const svc = buildService(db);
    silence(svc);
    await svc.recordOutcomesForEvaluationRun(new Date('2026-05-01'));
    assert(lookback === 24, 'invalid env → default 24h');
    process.env.ATTRIBUTION_PREDICTOR_LOOKBACK_HOURS = '24';
  }

  // Restore env
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }

  console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
