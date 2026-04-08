/**
 * Unit test for the Ollama local adapter's reasoning capture.
 *
 * Verifies that the adapter:
 *   - Returns reasoning as a separate field when the provider exposes
 *     message.reasoning natively (Ollama qwen3 path).
 *   - Falls back to parsing inline <think>...</think> tags when reasoning
 *     is not in a separate field but is embedded in content.
 *   - Returns reasoning=undefined for content-only responses.
 *
 * Effort: llm-reasoning-capture (Phase 1)
 */

import { of } from 'rxjs';
import { OllamaLocalAdapter } from '../../../../packages/planes/llm/simplified/adapters/ollama-local.adapter';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

interface FakeResponse {
  data: {
    id?: string;
    model: string;
    choices: Array<{ message: { content: string; reasoning?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
}

function stubHttpService(response: FakeResponse): { post: (...args: unknown[]) => unknown } {
  return {
    post: () => of(response),
  };
}

async function main(): Promise<void> {
  console.log('\nFixture 1 — content-only:');
  {
    const http = stubHttpService({
      data: {
        model: 'qwen3:8b',
        choices: [{ message: { content: 'the answer is 391' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = new OllamaLocalAdapter(http as any);
    const result = await adapter.chatCompletion({
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'what is 17 * 23?' }],
    });
    assert(result.content === 'the answer is 391', 'content survives');
    assert(result.reasoning === undefined, 'reasoning is undefined');
    assert(result.usage.promptTokens === 10, 'promptTokens propagates');
    assert(result.usage.completionTokens === 5, 'completionTokens propagates');
    assert(result.usage.reasoningTokens === undefined, 'reasoningTokens undefined when absent');
  }

  console.log('\nFixture 2 — native reasoning field:');
  {
    const http = stubHttpService({
      data: {
        model: 'qwen3:8b',
        choices: [
          {
            message: {
              content: 'the answer is 391',
              reasoning: 'let me think... 17 * 23 = 17 * (20 + 3) = 340 + 51 = 391',
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = new OllamaLocalAdapter(http as any);
    const result = await adapter.chatCompletion({
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'what is 17 * 23?' }],
    });
    assert(result.content === 'the answer is 391', 'content kept separate');
    assert(
      result.reasoning === 'let me think... 17 * 23 = 17 * (20 + 3) = 340 + 51 = 391',
      'reasoning captured from native field',
    );
  }

  console.log('\nFixture 3 — inline <think> fallback:');
  {
    const http = stubHttpService({
      data: {
        model: 'deepseek-r1:latest',
        choices: [
          {
            message: {
              content: '<think>let me think... 391</think>the answer is 391',
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 30, total_tokens: 40 },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = new OllamaLocalAdapter(http as any);
    const result = await adapter.chatCompletion({
      model: 'deepseek-r1:latest',
      messages: [{ role: 'user', content: 'what is 17 * 23?' }],
    });
    assert(result.content === 'the answer is 391', 'content stripped of <think> block');
    assert(result.reasoning === 'let me think... 391', 'reasoning extracted from <think> block');
  }

  console.log('\nFixture 4 — reasoning_tokens from completion_tokens_details:');
  {
    const http = stubHttpService({
      data: {
        model: 'qwen3:8b',
        choices: [{ message: { content: 'x', reasoning: 'y' } }],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 100,
          total_tokens: 101,
          completion_tokens_details: { reasoning_tokens: 80 },
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = new OllamaLocalAdapter(http as any);
    const result = await adapter.chatCompletion({
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'q' }],
    });
    assert(result.usage.reasoningTokens === 80, 'reasoningTokens read from completion_tokens_details');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
