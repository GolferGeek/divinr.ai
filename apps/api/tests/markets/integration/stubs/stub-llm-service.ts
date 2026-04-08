/**
 * Test double for the LLM_SERVICE token.
 *
 * Production behavior (the real LLMServiceProvider) is fully replaced during
 * the integration test by .overrideProvider(LLM_SERVICE).useValue(new StubLlmService()).
 * The fake satisfies the LLMServiceProvider interface but throws on every
 * method except generateResponse — which is the only thing MarketsLlmService
 * actually calls.
 *
 * generateResponse is keyed by extracting the instrument symbol from the user
 * prompt and the analyst display_name from the system prompt:
 *
 *   - PredictionRunnerService.buildAnalystUserPrompt() emits "Assess AAPL (Apple Inc.) for prediction."
 *   - PredictionRunnerService.buildAnalystSystemPrompt() emits "You are Macro Strategist. ..."
 *   - PredictionRunnerService.buildArbitratorPrompts() emits a system prompt that starts with
 *     "You are the chief arbitrator synthesizing multiple analyst assessments for AAPL."
 *
 * The fake reads canned JSON-string responses from
 * apps/api/tests/fixtures/markets/llm/responses.json with flat keys:
 *
 *   "AAPL|Macro Strategist", "AAPL|Technical Analyst", "AAPL|_arbitrator"
 *   ...for each of the four scenario symbols.
 *
 * If a key has the special value "__THROW__", the fake throws — used to force
 * the partial-failure code path in PredictionRunnerService.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  LLMServiceProvider,
  LLMModelInfo,
  LLMProviderInfo,
} from '@orchestratorai/planes/llm';

const RESPONSES_PATH = join(__dirname, '..', '..', '..', 'fixtures', 'markets', 'llm', 'responses.json');

const ANALYST_PROMPT_SYMBOL_RE = /^Assess (\S+) \(/m;
const ANALYST_PROMPT_NAME_RE = /^You are ([^.]+)\./;
const ARBITRATOR_PROMPT_RE = /^You are the chief arbitrator .* for ([A-Za-z0-9.-]+?)\./;

type ResponseMap = Record<string, string>;

export class StubLlmService implements LLMServiceProvider {
  private readonly responses: ResponseMap;

  constructor() {
    const raw = readFileSync(RESPONSES_PATH, 'utf8');
    this.responses = JSON.parse(raw) as ResponseMap;
  }

  async generateResponse(
    systemPrompt: string,
    userMessage: string,
    _options?: unknown,
  ): Promise<string> {
    const arbitratorMatch = systemPrompt.match(ARBITRATOR_PROMPT_RE);
    let key: string;
    if (arbitratorMatch) {
      key = `${arbitratorMatch[1]}|_arbitrator`;
    } else {
      const symbolMatch = userMessage.match(ANALYST_PROMPT_SYMBOL_RE);
      const nameMatch = systemPrompt.match(ANALYST_PROMPT_NAME_RE);
      if (!symbolMatch || !nameMatch) {
        throw new Error(
          `StubLlmService could not extract (symbol, analyst) from prompts.\n` +
          `system head: ${systemPrompt.slice(0, 80)}\n` +
          `user head:   ${userMessage.slice(0, 80)}`,
        );
      }
      key = `${symbolMatch[1]}|${nameMatch[1].trim()}`;
    }

    if (!(key in this.responses)) {
      throw new Error(
        `StubLlmService has no canned response for key "${key}". ` +
        `Add it to ${RESPONSES_PATH} or update the seed config so the analyst names match.`,
      );
    }

    const value = this.responses[key];
    if (value === '__THROW__') {
      throw new Error(`StubLlmService intentional failure for key "${key}" (partial-failure scenario)`);
    }
    return value;
  }

  // ─── unused interface methods ─────────────────────────────────────
  // The integration test only ever calls generateResponse via MarketsLlmService.
  // Every other method throws so any future drift surfaces immediately.

  async listModels(): Promise<LLMModelInfo[]> {
    throw new Error('StubLlmService.listModels not implemented');
  }
  async listProviders(): Promise<LLMProviderInfo[]> {
    throw new Error('StubLlmService.listProviders not implemented');
  }
  async generateUnifiedResponse(): Promise<string> {
    throw new Error('StubLlmService.generateUnifiedResponse not implemented');
  }
  async generateImage(): Promise<never> {
    throw new Error('StubLlmService.generateImage not implemented');
  }
  async generateVideo(): Promise<never> {
    throw new Error('StubLlmService.generateVideo not implemented');
  }
  async pollVideoStatus(): Promise<never> {
    throw new Error('StubLlmService.pollVideoStatus not implemented');
  }
  emitLlmObservabilityEvent(): void {
    // No-op: observability events are not exercised by the integration test.
  }
}
