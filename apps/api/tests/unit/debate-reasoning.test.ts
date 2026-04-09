/**
 * Unit tests for getDebateReasoning on MarketsService.
 */
import { MarketsService } from '../../src/markets/markets.service';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall { sql: string; params: unknown[] }

class MockDb {
  public calls: MockCall[] = [];
  private responses: Array<{ data?: unknown; error?: { message: string } | null }>;
  private callIndex = 0;
  constructor(responses: Array<{ data?: unknown; error?: { message: string } | null }>) {
    this.responses = responses;
  }
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    return this.responses[this.callIndex++] ?? { data: [], error: null };
  }
}

class MockSchema { async ensureSchema() {} }

function makeSvc(db: MockDb): MarketsService {
  return new MarketsService(
    db as any, null as any, null as any, null as any,
    new MockSchema() as any, null as any, null as any,
    null as any, null as any, null as any, null as any,
  );
}

async function main(): Promise<void> {
  console.log('\n=== Debate Reasoning Tests ===\n');

  // 1. All 3 agents have reasoning
  console.log('All agents with reasoning:');
  {
    const db = new MockDb([
      // debate row
      {
        data: [{
          id: 'debate-1',
          transcript: [
            { role: 'blue', content: '...', llm_usage_id: 'lu-blue' },
            { role: 'red', content: '...', llm_usage_id: 'lu-red' },
            { role: 'arbiter', content: '...', llm_usage_id: 'lu-arbiter' },
          ],
        }],
        error: null,
      },
      // llm_usage rows
      {
        data: [
          {
            run_id: 'lu-blue', provider: 'ollama_local', model: 'gemma4:26b',
            input_tokens: 500, output_tokens: 200, reasoning_tokens: 150,
            reasoning_content: 'Blue thinking...', reasoning_truncated: false,
          },
          {
            run_id: 'lu-red', provider: 'ollama_local', model: 'gemma4:26b',
            input_tokens: 600, output_tokens: 250, reasoning_tokens: 180,
            reasoning_content: 'Red thinking...', reasoning_truncated: false,
          },
          {
            run_id: 'lu-arbiter', provider: 'ollama_local', model: 'gemma4:26b',
            input_tokens: 800, output_tokens: 300, reasoning_tokens: 220,
            reasoning_content: 'Arbiter thinking...', reasoning_truncated: true,
          },
        ],
        error: null,
      },
    ]);

    const svc = makeSvc(db);
    const result = await svc.getDebateReasoning('debate-1', 'test-org');

    assert(result.blue !== null, 'blue reasoning returned');
    assert(result.blue!.provider === 'ollama_local', 'blue provider');
    assert(result.blue!.model === 'gemma4:26b', 'blue model');
    assert(result.blue!.inputTokens === 500, 'blue input tokens');
    assert(result.blue!.reasoningContent === 'Blue thinking...', 'blue reasoning content');
    assert(result.blue!.reasoningTruncated === false, 'blue not truncated');

    assert(result.red !== null, 'red reasoning returned');
    assert(result.red!.reasoningContent === 'Red thinking...', 'red reasoning content');
    assert(result.red!.reasoningTokens === 180, 'red reasoning tokens');

    assert(result.arbiter !== null, 'arbiter reasoning returned');
    assert(result.arbiter!.reasoningContent === 'Arbiter thinking...', 'arbiter reasoning content');
    assert(result.arbiter!.reasoningTruncated === true, 'arbiter truncated');
  }

  // 2. Empty transcript — all null
  console.log('\nEmpty transcript:');
  {
    const db = new MockDb([
      { data: [{ id: 'debate-2', transcript: [] }], error: null },
    ]);

    const svc = makeSvc(db);
    const result = await svc.getDebateReasoning('debate-2', 'test-org');

    assert(result.blue === null, 'blue null for empty transcript');
    assert(result.red === null, 'red null for empty transcript');
    assert(result.arbiter === null, 'arbiter null for empty transcript');
    // Should NOT have made a second query (no usage IDs to look up)
    assert(db.calls.length === 1, 'only 1 DB call (no llm_usage query needed)');
  }

  // 3. Reasoning content null on matched row
  console.log('\nNull reasoning content:');
  {
    const db = new MockDb([
      {
        data: [{
          id: 'debate-3',
          transcript: [
            { role: 'blue', content: '...', llm_usage_id: 'lu-old' },
          ],
        }],
        error: null,
      },
      {
        data: [{
          run_id: 'lu-old', provider: 'openai', model: 'gpt-4o',
          input_tokens: 400, output_tokens: 100,
          reasoning_tokens: null, reasoning_content: null, reasoning_truncated: false,
        }],
        error: null,
      },
    ]);

    const svc = makeSvc(db);
    const result = await svc.getDebateReasoning('debate-3', 'test-org');

    assert(result.blue !== null, 'blue returned (row exists)');
    assert(result.blue!.reasoningContent === null, 'reasoningContent is null');
    assert(result.blue!.provider === 'openai', 'provider still returned');
    assert(result.blue!.model === 'gpt-4o', 'model still returned');
    assert(result.red === null, 'red null (not in transcript)');
    assert(result.arbiter === null, 'arbiter null (not in transcript)');
  }

  // 4. Transcript with null llm_usage_id
  console.log('\nTranscript with null llm_usage_id:');
  {
    const db = new MockDb([
      {
        data: [{
          id: 'debate-4',
          transcript: [
            { role: 'blue', content: '...', llm_usage_id: null },
            { role: 'red', content: '...', llm_usage_id: 'lu-red-only' },
          ],
        }],
        error: null,
      },
      {
        data: [{
          run_id: 'lu-red-only', provider: 'ollama_local', model: 'gemma4:e4b',
          input_tokens: 300, output_tokens: 80,
          reasoning_tokens: 50, reasoning_content: 'Red only', reasoning_truncated: false,
        }],
        error: null,
      },
    ]);

    const svc = makeSvc(db);
    const result = await svc.getDebateReasoning('debate-4', 'test-org');

    assert(result.blue === null, 'blue null (null llm_usage_id)');
    assert(result.red !== null, 'red returned');
    assert(result.red!.reasoningContent === 'Red only', 'red reasoning content');
    assert(result.arbiter === null, 'arbiter null (not in transcript)');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
