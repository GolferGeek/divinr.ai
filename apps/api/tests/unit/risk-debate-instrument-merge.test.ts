/**
 * Phase 4 integration test: RiskDebateService merges instrument contract's
 * `Stage: Risk Assessment — Debate (3b)` fragment into each participant's
 * system prompt (Blue, Red, Arbiter).
 *
 * Effort: instrument-contracts (Phase 4).
 */
import assert from 'node:assert/strict';
import { RiskDebateService } from '../../src/markets/services/risk-debate.service';

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve(fn())
    .then(() => console.log(`PASS  ${name}`))
    .catch((err) => {
      console.error(`FAIL  ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

const INSTRUMENT_CONTRACT_MD = `## General

MSFT general.

## Stage: Article Processing

MSFT article processing.

## Stage: Predictor Generation

MSFT predictor.

## Stage: Risk Assessment — Reflection (3a)

MSFT reflection.

## Stage: Risk Assessment — Debate (3b)

TOKEN-INSTRUMENT-3B MSFT debate framing.

## Stage: Prediction Generation

MSFT prediction.

## Stage: Learning

MSFT learning.

## Adaptations

MSFT adaptations.
`;

interface PlannedQuery {
  match: RegExp | string;
  rows?: unknown[];
}

class PlannedDb {
  public calls: Array<{ sql: string; params: unknown[] }> = [];
  constructor(private plans: PlannedQuery[]) {}
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, ' ').trim();
    for (const plan of this.plans) {
      const matched =
        typeof plan.match === 'string' ? normalized.includes(plan.match) : plan.match.test(normalized);
      if (matched) {
        return { data: plan.rows ?? [], error: null };
      }
    }
    return { data: [], error: null };
  }
}

class StubObservability {
  public pushed: Array<Record<string, unknown>> = [];
  async push(evt: Record<string, unknown>) {
    this.pushed.push(evt);
  }
}

class StubLlm {
  public systemPrompts: string[] = [];
  public roleSequence = ['blue', 'red', 'arbiter'];
  private callIdx = 0;
  isLlmEnabled() {
    return true;
  }
  async generateText(_ctx: unknown, systemPrompt: string, _userPrompt: string) {
    this.systemPrompts.push(systemPrompt);
    const role = this.roleSequence[this.callIdx++] ?? 'unknown';
    const text =
      role === 'blue'
        ? JSON.stringify({ summary: 'defense', key_findings: [], evidence_cited: [], confidence_explanation: '' })
        : role === 'red'
          ? JSON.stringify({ challenges: [], blind_spots: [], overstated_risks: [], understated_risks: [] })
          : JSON.stringify({ final_assessment: 'synth', accepted_challenges: [], rejected_challenges: [], adjustment_reasoning: '', recommended_adjustment: 0 });
    return { text, provider: 'stub', model: 'stub', llmUsageId: `usage-${role}` };
  }
}

function makeSvc(db: PlannedDb, obs: StubObservability, llm: StubLlm): RiskDebateService {
  return new RiskDebateService(db as never, llm as never, obs as never);
}

async function run() {
  console.log('\n=== Risk Debate × Instrument Contract Merge Tests ===\n');

  await test('runDebate merges instrument Debate-3b fragment into all three participant prompts', async () => {
    const db = new PlannedDb([
      // insert into risk_debates
      { match: 'insert into prediction.risk_debates', rows: [] },
      // loadDebatePrompt for blue/red/arbiter — blue/red use hardcoded defaults
      { match: /from prediction.risk_debate_contexts/, rows: [] },
      // arbitrator analyst lookup for arbiter contract (returns no arbitrator → uses default)
      { match: 'from prediction.market_analysts', rows: [] },
      // Instrument contract loader
      { match: 'JOIN prediction.instrument_config_versions', rows: [{ config_id: 'instr-cfg-1', context_markdown: INSTRUMENT_CONTRACT_MD }] },
      // update risk_debates at the end
      { match: 'update prediction.risk_debates', rows: [] },
    ]);
    const obs = new StubObservability();
    const llm = new StubLlm();
    const svc = makeSvc(db, obs, llm);

    await svc.runDebate({
      context: { conversationId: 'test', userId: 'system' } as never,
      runId: 'run-1',
      instrumentId: 'instr-msft',
      instrumentSymbol: 'MSFT',
      compositeScoreId: 'score-1',
      overallScore: 55,
      dimensionAssessments: [
        { id: 'd1', run_id: 'run-1', instrument_id: 'instr-msft', dimension_id: 'macro', score: 55, confidence: 0.7, reasoning: 'r', evidence: [], signals: [], model_provider: 'stub', model_name: 'stub', llm_usage_id: null, created_at: new Date().toISOString() } as never,
      ],
      viewerUserId: null,
    });

    assert.equal(llm.systemPrompts.length, 3, 'three LLM calls (blue, red, arbiter)');
    for (const [idx, slug] of (['blue', 'red', 'arbiter'] as const).entries()) {
      const p = llm.systemPrompts[idx];
      assert.ok(p.includes('TOKEN-INSTRUMENT-3B'), `${slug} prompt contains instrument debate token`);
      assert.ok(p.includes('[Instrument: MSFT]'), `${slug} prompt contains instrument label`);
      assert.ok(p.includes(`[Analyst: ${slug}]`), `${slug} prompt contains role label`);
    }
  });

  await test('runDebate falls back to original hardcoded prompts when instrument has no contract', async () => {
    const db = new PlannedDb([
      { match: 'insert into prediction.risk_debates', rows: [] },
      { match: /from prediction.risk_debate_contexts/, rows: [] },
      { match: 'from prediction.market_analysts', rows: [] },
      // Instrument loader returns no rows → fallback
      { match: 'JOIN prediction.instrument_config_versions', rows: [] },
      { match: 'update prediction.risk_debates', rows: [] },
    ]);
    const obs = new StubObservability();
    const llm = new StubLlm();
    const svc = makeSvc(db, obs, llm);

    await svc.runDebate({
      context: { conversationId: 'test', userId: 'system' } as never,
      runId: 'run-1',
      instrumentId: 'instr-msft',
      instrumentSymbol: 'MSFT',
      compositeScoreId: 'score-1',
      overallScore: 55,
      dimensionAssessments: [
        { id: 'd1', run_id: 'run-1', instrument_id: 'instr-msft', dimension_id: 'macro', score: 55, confidence: 0.7, reasoning: 'r', evidence: [], signals: [], model_provider: 'stub', model_name: 'stub', llm_usage_id: null, created_at: new Date().toISOString() } as never,
      ],
      viewerUserId: null,
    });

    assert.equal(llm.systemPrompts.length, 3);
    for (const p of llm.systemPrompts) {
      assert.ok(!p.includes('[Instrument:'), 'no instrument label on fallback');
      assert.ok(!p.includes('[Analyst:'), 'no analyst label on fallback');
    }
  });

  console.log('\nRisk debate × instrument contract merge tests complete.');
}

run();
