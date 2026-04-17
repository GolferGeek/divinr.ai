/**
 * Unit tests for CostExperimentationService.
 * Verifies async create, serial execution, status transitions, partial-failure handling.
 */
import { CostExperimentationService } from '../../src/cost-modeling/cost-experimentation.service';

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

class FakeLlm {
  public callTimestamps: Array<{ start: number; end: number; provider: string; model: string }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildExecutionContext(_userId: string, _runType: string): any { return { userId: 'admin' }; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async generateText(_ctx: any, _systemPrompt: string, _userPrompt: string, analystConfig?: any, _usageContext?: any): Promise<any> {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 25));
    const end = Date.now();
    const provider = analystConfig?.llmProvider ?? 'p';
    const model = analystConfig?.llmModel ?? 'm';
    this.callTimestamps.push({ start, end, provider, model });
    if (model === 'fail-me') throw new Error(`mock failure for ${model}`);
    return { text: `output from ${model}`, provider, model };
  }
}

function buildService(db: MockDb, llm: FakeLlm): CostExperimentationService {
  return new (CostExperimentationService as unknown as {
    new (db: MockDb, llm: FakeLlm): CostExperimentationService;
  })(db, llm);
}

function silenceLogger(svc: CostExperimentationService): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).logger = { log: () => {}, warn: () => {}, error: () => {} };
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timed out');
}

async function main(): Promise<void> {
  console.log('\n=== Cost Experimentation Service Tests ===\n');

  console.log('createExperiment: validates min 2 models:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const llm = new FakeLlm();
    const svc = buildService(db, llm);
    let threw = false;
    try {
      await svc.createExperiment({
        name: 'test', stage: 'experiment',
        inputPayload: { systemPrompt: 's', userPrompt: 'u' },
        models: [{ provider: 'p', model: 'm' }],
        userId: 'admin',
      });
    } catch { threw = true; }
    assert(threw, 'rejects experiment with <2 models');
  }

  console.log('\ncreateExperiment: validates inputPayload shape:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const llm = new FakeLlm();
    const svc = buildService(db, llm);
    let threw = false;
    try {
      await svc.createExperiment({
        name: 'test', stage: 'experiment',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputPayload: { foo: 'bar' } as any,
        models: [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }],
        userId: 'admin',
      });
    } catch { threw = true; }
    assert(threw, 'rejects when systemPrompt or userPrompt missing');
  }

  console.log('\ncreateExperiment: returns pending status immediately, schedules background work:');
  {
    let runIdsAssigned = 0;
    const runs = [
      { id: 'run-1', provider: 'p1', model: 'm1' },
      { id: 'run-2', provider: 'p2', model: 'm2' },
    ];
    const expId = 'exp-1';
    const status = { current: 'pending' as string };
    const completed = new Set<string>();

    const db = new MockDb((sql, params) => {
      if (sql.includes('INSERT INTO prediction.cost_experiments')) {
        return { data: [{ id: expId }] };
      }
      if (sql.includes('INSERT INTO prediction.cost_experiment_runs')) {
        runIdsAssigned += 1;
        return { data: [] };
      }
      if (sql.includes("UPDATE prediction.cost_experiments SET status = 'running'")) {
        status.current = 'running';
        return { data: [] };
      }
      if (sql.includes("UPDATE prediction.cost_experiments SET status = $2")) {
        status.current = params[1] as string;
        return { data: [] };
      }
      if (sql.includes("SELECT id, input_payload FROM prediction.cost_experiments")) {
        return { data: [{ id: expId, input_payload: { systemPrompt: 's', userPrompt: 'u' } }] };
      }
      if (sql.includes('SELECT id, provider, model FROM prediction.cost_experiment_runs')) {
        return { data: runs };
      }
      if (sql.includes('FROM prediction.llm_usage_log')) {
        return { data: [{ id: 'log-' + (params[0] as string), cost_cents: 100, tokens_in: 10, tokens_out: 5, latency_ms: 25 }] };
      }
      if (sql.includes('UPDATE prediction.cost_experiment_runs')) {
        completed.add(params[0] as string);
        return { data: [] };
      }
      return { data: [] };
    });
    const llm = new FakeLlm();
    const svc = buildService(db, llm);
    silenceLogger(svc);

    const created = await svc.createExperiment({
      name: 'test', stage: 'experiment',
      inputPayload: { systemPrompt: 's', userPrompt: 'u' },
      models: [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }],
      userId: 'admin',
    });

    assert(created.experimentId === expId, 'returns experimentId');
    assert(created.status === 'pending', 'returns status=pending');
    assert(runIdsAssigned === 2, 'inserts one run row per model');

    await waitFor(() => status.current === 'complete' || status.current === 'failed');
    assert(status.current === 'complete', 'background run completes');
    assert(completed.has('run-1') && completed.has('run-2'), 'both runs marked completed');
    assert(llm.callTimestamps.length === 2, 'LLM called twice');
    assert(
      llm.callTimestamps[0].end <= llm.callTimestamps[1].start,
      'serial execution (run 2 starts after run 1 ends)',
    );
  }

  console.log('\ncreateExperiment: partial failure leaves complete status, error captured on failed run:');
  {
    const expId = 'exp-2';
    const status = { current: 'pending' as string };
    const errorRows: Record<string, string> = {};

    const db = new MockDb((sql, params) => {
      if (sql.includes('INSERT INTO prediction.cost_experiments')) return { data: [{ id: expId }] };
      if (sql.includes('INSERT INTO prediction.cost_experiment_runs')) return { data: [] };
      if (sql.includes("UPDATE prediction.cost_experiments SET status = 'running'")) {
        status.current = 'running';
        return { data: [] };
      }
      if (sql.includes("UPDATE prediction.cost_experiments SET status = $2")) {
        status.current = params[1] as string;
        return { data: [] };
      }
      if (sql.includes("SELECT id, input_payload FROM prediction.cost_experiments")) {
        return { data: [{ id: expId, input_payload: { systemPrompt: 's', userPrompt: 'u' } }] };
      }
      if (sql.includes('SELECT id, provider, model FROM prediction.cost_experiment_runs')) {
        return { data: [
          { id: 'run-A', provider: 'p', model: 'good' },
          { id: 'run-B', provider: 'p', model: 'fail-me' },
        ] };
      }
      if (sql.includes('FROM prediction.llm_usage_log')) {
        return { data: [{ id: 'log-x', cost_cents: 50, tokens_in: 5, tokens_out: 5, latency_ms: 20 }] };
      }
      if (sql.includes('UPDATE prediction.cost_experiment_runs')) {
        const runId = params[0] as string;
        const errParam = params[params.length - 1];
        if (typeof errParam === 'string' && params.length === 2) errorRows[runId] = errParam;
        return { data: [] };
      }
      return { data: [] };
    });
    const llm = new FakeLlm();
    const svc = buildService(db, llm);
    silenceLogger(svc);

    await svc.createExperiment({
      name: 'partial', stage: 'experiment',
      inputPayload: { systemPrompt: 's', userPrompt: 'u' },
      models: [{ provider: 'p', model: 'good' }, { provider: 'p', model: 'fail-me' }],
      userId: 'admin',
    });
    await waitFor(() => status.current === 'complete' || status.current === 'failed');
    assert(status.current === 'complete', 'one success → status=complete');
    assert(errorRows['run-B'] && errorRows['run-B'].includes('fail-me'), 'failed run got error message');
  }

  console.log('\ncreateExperiment: all-fail experiment ends with status=failed:');
  {
    const expId = 'exp-3';
    const status = { current: 'pending' as string };

    const db = new MockDb((sql) => {
      if (sql.includes('INSERT INTO prediction.cost_experiments')) return { data: [{ id: expId }] };
      if (sql.includes('INSERT INTO prediction.cost_experiment_runs')) return { data: [] };
      if (sql.includes("UPDATE prediction.cost_experiments SET status = 'running'")) {
        status.current = 'running';
        return { data: [] };
      }
      if (sql.includes("UPDATE prediction.cost_experiments SET status = $2")) {
        // Capture both running → failed transitions
        // The second update sets the final status from background runner.
        return { data: [] };
      }
      if (sql.includes("SELECT id, input_payload FROM prediction.cost_experiments")) {
        return { data: [{ id: expId, input_payload: { systemPrompt: 's', userPrompt: 'u' } }] };
      }
      if (sql.includes('SELECT id, provider, model FROM prediction.cost_experiment_runs')) {
        return { data: [
          { id: 'run-X', provider: 'p', model: 'fail-me' },
          { id: 'run-Y', provider: 'p', model: 'fail-me' },
        ] };
      }
      if (sql.includes('UPDATE prediction.cost_experiment_runs')) return { data: [] };
      return { data: [] };
    });
    const llm = new FakeLlm();
    const svc = buildService(db, llm);
    silenceLogger(svc);

    await svc.createExperiment({
      name: 'all-fail', stage: 'experiment',
      inputPayload: { systemPrompt: 's', userPrompt: 'u' },
      models: [{ provider: 'p', model: 'fail-me' }, { provider: 'p', model: 'fail-me' }],
      userId: 'admin',
    });
    // Wait for the background worker to flush its final UPDATE.
    await waitFor(() => db.calls.some((c) => c.sql.includes("UPDATE prediction.cost_experiments SET status = $2") && c.params[1] === 'failed'));
    assert(true, 'all-fail experiment writes status=failed');
  }

  console.log('\ngetExperiments: maps row JSON shape:');
  {
    const db = new MockDb(() => ({ data: [{
      id: 'e1', created_at: '2026-04-17T00:00:00Z', created_by_user_id: 'u', name: 'exp',
      stage: 'experiment',
      input_payload: '{"systemPrompt":"s","userPrompt":"u"}',
      models: '[{"provider":"p","model":"m"}]',
      status: 'complete', notes: null, runs_count: '1',
    }] }));
    const llm = new FakeLlm();
    const svc = buildService(db, llm);
    const rows = await svc.getExperiments();
    assert(rows.length === 1, 'returns one experiment');
    assert(typeof rows[0].input_payload === 'object', 'parses input_payload JSON string');
    assert(Array.isArray(rows[0].models), 'parses models JSON string');
    assert(rows[0].runs_count === 1, 'coerces runs_count to number');
  }

  console.log('\ngetExperimentDetail: returns null when not found:');
  {
    const db = new MockDb(() => ({ data: [] }));
    const llm = new FakeLlm();
    const svc = buildService(db, llm);
    const result = await svc.getExperimentDetail('nope');
    assert(result === null, 'returns null when no row');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
