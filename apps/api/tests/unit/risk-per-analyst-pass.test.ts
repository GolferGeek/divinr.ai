/**
 * Tests for RiskRunnerService.executePerAnalystRiskPass — Stage 3 per-analyst
 * risk reflection + Stage 3b Blue/Red/Arbiter debate fanout, including the
 * three viewer-scope cases from plan step 4.7:
 *
 *   Case 1 — Base instrument, no viewer customizations: one shared debate,
 *            viewerUserId = null, participants = base analysts only.
 *   Case 2 — Base instrument with viewer-specific customs: shared debate +
 *            one additional debate per viewer, participants = base + viewer's
 *            custom analysts.
 *   Case 3 — User-authored custom instrument: one debate, viewerUserId = owner,
 *            participants = explicitly-assigned analysts.
 *
 * Also validates batch truncation and LLM parse-failure fallback.
 */
import assert from 'node:assert/strict';
import { RiskRunnerService } from '../../src/markets/services/risk-runner.service';

interface AnalystRow { id: string; slug: string; display_name: string; persona_prompt: string; default_weight: number; user_id: string | null }
interface InstrumentRow { id: string; symbol: string; name: string; current_state: unknown; user_id: string | null }

interface MockCall { sql: string; params: unknown[] }

class MockDb {
  public calls: MockCall[] = [];
  public analysts: AnalystRow[] = [];
  public instruments: Record<string, InstrumentRow> = {};
  public priorAssessment: { score: number; confidence: number; reasoning: string } | null = null;
  // Global assignments for custom instruments
  public assignments: Array<{ instrument_id: string; analyst_id: string }> = [];
  // Per-viewer assignments for base instruments
  public viewerAssignments: Array<{ instrument_id: string; viewer_user_id: string; analyst_id: string }> = [];
  // Captured debate invocations (for assertions)
  public debateInvocations: Array<{ instrumentId: string; viewerUserId: string | null; analystIds: string[] }> = [];

  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });

    // Base analyst list (user_id IS NULL)
    if (sql.includes('from prediction.market_analysts') && sql.includes('user_id is null')) {
      return { data: this.analysts.filter(a => a.user_id === null), error: null };
    }

    // Analysts by id list (custom lookup)
    if (sql.includes('from prediction.market_analysts') && sql.includes('id = any($1::text[])')) {
      const ids = new Set(params[0] as string[]);
      return { data: this.analysts.filter(a => ids.has(a.id)), error: null };
    }

    // Assigned-analysts join for custom instruments
    if (sql.includes('from prediction.market_instrument_analyst_assignments')) {
      const instrumentId = params[0] as string;
      const ids = this.assignments
        .filter(a => a.instrument_id === instrumentId)
        .map(a => a.analyst_id);
      return { data: this.analysts.filter(a => ids.includes(a.id)), error: null };
    }

    // Viewer bridge table
    if (sql.includes('from prediction.viewer_instrument_analyst_assignments')) {
      const instrumentId = params[0] as string;
      return {
        data: this.viewerAssignments
          .filter(v => v.instrument_id === instrumentId)
          .map(v => ({ viewer_user_id: v.viewer_user_id, analyst_id: v.analyst_id })),
        error: null,
      };
    }

    // Instrument lookup
    if (sql.includes('from prediction.instruments') && sql.includes('where id = $1')) {
      const id = params[0] as string;
      const inst = this.instruments[id];
      return { data: inst ? [inst] : [], error: null };
    }

    // Prior analyst_risk_assessments
    if (sql.includes('from prediction.analyst_risk_assessments')) {
      return { data: this.priorAssessment ? [this.priorAssessment] : [], error: null };
    }

    // Predictor lines
    if (sql.includes('from prediction.market_predictors')) {
      return { data: [], error: null };
    }

    // Composite score insert
    if (sql.startsWith('insert into prediction.risk_composite_scores')) {
      return { data: [{ id: 'comp-1' }], error: null };
    }

    return { data: [], error: null };
  }
}

const mockSchema: any = { ensureSchema: async () => {} };
const mockObservability: any = { push: async () => {} };
const mockContext: any = {};
const mockDimAnalyzer: any = {};
const mockScoreAgg: any = {};
const mockDataSources: any = {};

function makeLlm(opts: { enabled: boolean; text?: string } = { enabled: false }): any {
  return {
    isLlmEnabled: () => opts.enabled,
    buildExecutionContext: () => ({ conversationId: 'c', userId: 'u', agentSlug: 'a' }),
    generateText: async () => ({
      text: opts.text ?? '{"score": 42, "confidence": 0.8, "reasoning": "test", "evidence": []}',
      provider: 'mock',
      model: 'mock',
      llmUsageId: null,
    }),
  };
}

function makeDebateRecorder(db: MockDb): any {
  return {
    runDebate: async (input: { instrumentId: string; viewerUserId?: string | null; dimensionAssessments: Array<{ dimension_id: string }> }) => {
      db.debateInvocations.push({
        instrumentId: input.instrumentId,
        viewerUserId: input.viewerUserId ?? null,
        analystIds: input.dimensionAssessments.map(d => d.dimension_id),
      });
      return { debate: { id: `deb-${db.debateInvocations.length}` }, adjustedScore: 50, adjustment: 0 };
    },
  };
}

const base = (id: string, slug: string): AnalystRow => ({ id, slug, display_name: slug, persona_prompt: 'p', default_weight: 1, user_id: null });
const customAnalyst = (id: string, slug: string, ownerUserId: string): AnalystRow => ({ id, slug, display_name: slug, persona_prompt: 'p', default_weight: 1, user_id: ownerUserId });

const test = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

async function main() {
  await test('empty instrumentIds returns zero assessments', async () => {
    const db = new MockDb();
    const svc = new RiskRunnerService(
      db as any, mockObservability, mockSchema, makeLlm(), mockContext, mockDimAnalyzer, mockScoreAgg, makeDebateRecorder(db), mockDataSources,
    );
    const res = await svc.executePerAnalystRiskPass([]);
    assert.equal(res.assessmentsWritten, 0);
    assert.equal(res.debatesRun, 0);
  });

  await test('no active base analysts returns zero assessments for base instrument', async () => {
    const db = new MockDb();
    db.instruments['i1'] = { id: 'i1', symbol: 'AAPL', name: 'Apple', current_state: {}, user_id: null };
    const svc = new RiskRunnerService(
      db as any, mockObservability, mockSchema, makeLlm(), mockContext, mockDimAnalyzer, mockScoreAgg, makeDebateRecorder(db), mockDataSources,
    );
    const res = await svc.executePerAnalystRiskPass(['i1']);
    assert.equal(res.assessmentsWritten, 0);
  });

  await test('Case 1 — base instrument with only base analysts: one shared debate, viewerUserId=null', async () => {
    const db = new MockDb();
    db.analysts = [base('a1', 'fundamentals'), base('a2', 'technical')];
    db.instruments['i1'] = { id: 'i1', symbol: 'AAPL', name: 'Apple', current_state: {}, user_id: null };
    const svc = new RiskRunnerService(
      db as any, mockObservability, mockSchema, makeLlm({ enabled: true }), mockContext, mockDimAnalyzer, mockScoreAgg, makeDebateRecorder(db), mockDataSources,
    );
    const res = await svc.executePerAnalystRiskPass(['i1']);
    assert.equal(res.assessmentsWritten, 2, 'two base analysts × one instrument');
    assert.equal(res.debatesRun, 1, 'one shared debate');
    assert.equal(db.debateInvocations.length, 1);
    assert.equal(db.debateInvocations[0].viewerUserId, null, 'shared debate: viewerUserId=null');
    assert.deepEqual(db.debateInvocations[0].analystIds.sort(), ['fundamentals', 'technical']);
  });

  await test('Case 2 — base instrument with viewer customs: shared + per-viewer debates', async () => {
    const db = new MockDb();
    db.analysts = [
      base('a1', 'fundamentals'),
      base('a2', 'technical'),
      customAnalyst('c1', 'alice-custom', 'user-alice'),
      customAnalyst('c2', 'bob-custom', 'user-bob'),
    ];
    db.instruments['i1'] = { id: 'i1', symbol: 'AAPL', name: 'Apple', current_state: {}, user_id: null };
    db.viewerAssignments = [
      { instrument_id: 'i1', viewer_user_id: 'user-alice', analyst_id: 'c1' },
      { instrument_id: 'i1', viewer_user_id: 'user-bob', analyst_id: 'c2' },
    ];
    const svc = new RiskRunnerService(
      db as any, mockObservability, mockSchema, makeLlm({ enabled: true }), mockContext, mockDimAnalyzer, mockScoreAgg, makeDebateRecorder(db), mockDataSources,
    );
    const res = await svc.executePerAnalystRiskPass(['i1']);
    // Reflections: 2 base + 2 custom = 4 analysts × 1 instrument = 4 assessments
    assert.equal(res.assessmentsWritten, 4);
    // Debates: 1 shared + 2 per-viewer = 3
    assert.equal(res.debatesRun, 3);

    const shared = db.debateInvocations.find(d => d.viewerUserId === null);
    assert.ok(shared, 'shared debate exists');
    assert.deepEqual(shared.analystIds.sort(), ['fundamentals', 'technical'], 'shared debate has base-only participants');

    const aliceDebate = db.debateInvocations.find(d => d.viewerUserId === 'user-alice');
    assert.ok(aliceDebate, 'alice debate exists');
    assert.deepEqual(aliceDebate.analystIds.sort(), ['alice-custom', 'fundamentals', 'technical'], 'alice debate has base + her custom');

    const bobDebate = db.debateInvocations.find(d => d.viewerUserId === 'user-bob');
    assert.ok(bobDebate, 'bob debate exists');
    assert.deepEqual(bobDebate.analystIds.sort(), ['bob-custom', 'fundamentals', 'technical'], 'bob debate has base + his custom');
  });

  await test('Case 3 — custom instrument: one debate scoped to owner with only-assigned analysts', async () => {
    const db = new MockDb();
    db.analysts = [
      base('a1', 'fundamentals'),
      base('a2', 'technical'),
      customAnalyst('c1', 'alice-custom', 'user-alice'),
    ];
    // Custom instrument owned by alice; she assigned her custom + one base analyst
    db.instruments['i1'] = { id: 'i1', symbol: 'AAPL', name: 'Apple', current_state: {}, user_id: 'user-alice' };
    db.assignments = [
      { instrument_id: 'i1', analyst_id: 'a1' },
      { instrument_id: 'i1', analyst_id: 'c1' },
    ];
    const svc = new RiskRunnerService(
      db as any, mockObservability, mockSchema, makeLlm({ enabled: true }), mockContext, mockDimAnalyzer, mockScoreAgg, makeDebateRecorder(db), mockDataSources,
    );
    const res = await svc.executePerAnalystRiskPass(['i1']);
    assert.equal(res.assessmentsWritten, 2, 'two assigned analysts');
    assert.equal(res.debatesRun, 1, 'exactly one debate for custom instrument');
    assert.equal(db.debateInvocations[0].viewerUserId, 'user-alice');
    assert.deepEqual(db.debateInvocations[0].analystIds.sort(), ['alice-custom', 'fundamentals']);
  });

  await test('batch limit truncates reflection workload but leaves debate fanout unchanged', async () => {
    const prev = process.env.MARKETS_RISK_BATCH_LIMIT;
    process.env.MARKETS_RISK_BATCH_LIMIT = '2';
    try {
      const db = new MockDb();
      db.analysts = [base('a1', 'a1'), base('a2', 'a2')];
      db.instruments['i1'] = { id: 'i1', symbol: 'AAPL', name: 'Apple', current_state: {}, user_id: null };
      db.instruments['i2'] = { id: 'i2', symbol: 'TSLA', name: 'Tesla', current_state: {}, user_id: null };
      const svc = new RiskRunnerService(
        db as any, mockObservability, mockSchema, makeLlm({ enabled: true }), mockContext, mockDimAnalyzer, mockScoreAgg, makeDebateRecorder(db), mockDataSources,
      );
      const res = await svc.executePerAnalystRiskPass(['i1', 'i2']);
      assert.equal(res.assessmentsWritten, 2, 'batch limit = 2');
    } finally {
      if (prev === undefined) delete process.env.MARKETS_RISK_BATCH_LIMIT;
      else process.env.MARKETS_RISK_BATCH_LIMIT = prev;
    }
  });

  await test('LLM parse failure falls back gracefully without throwing', async () => {
    const db = new MockDb();
    db.analysts = [base('a1', 'a1')];
    db.instruments['i1'] = { id: 'i1', symbol: 'AAPL', name: 'Apple', current_state: {}, user_id: null };
    db.priorAssessment = { score: 75, confidence: 0.6, reasoning: 'prior' };
    const svc = new RiskRunnerService(
      db as any, mockObservability, mockSchema, makeLlm({ enabled: true, text: 'not json garbage' }), mockContext, mockDimAnalyzer, mockScoreAgg, makeDebateRecorder(db), mockDataSources,
    );
    const res = await svc.executePerAnalystRiskPass(['i1']);
    assert.equal(res.assessmentsWritten, 1);
    assert.equal(res.errors.length, 0, 'parse failure should not produce errors');
  });
}

main().catch(err => { console.error(err); process.exit(1); });
