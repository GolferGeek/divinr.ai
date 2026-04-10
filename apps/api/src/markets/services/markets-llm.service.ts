import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@orchestrator-ai/transport-types';
import { LLM_SERVICE, type LLMServiceProvider } from '@orchestratorai/planes/llm';
import type { RunType } from '../markets.types';

export interface LlmConfig {
  provider: string;
  model: string;
  commercialFallbackProvider: string;
  commercialFallbackModel: string;
  allowCommercialFallback: boolean;
}

export interface LlmTextResult {
  text: string;
  provider: string;
  model: string;
  /** Captured thinking/reasoning content from reasoning-capable models. Undefined when the provider returned none. */
  reasoning?: string;
  /** Primary key (uuid) of the llm_usage row written for this call. Stamp this onto any analysis row produced from the call. */
  llmUsageId?: string;
}

/**
 * Shared LLM helper used by all markets services (risk-runner, prediction-runner, etc.)
 * Centralizes LLM config, execution context building, and text generation with fallback.
 */
@Injectable()
export class MarketsLlmService {
  constructor(
    @Inject(LLM_SERVICE) private readonly llm: LLMServiceProvider,
  ) {}

  isLlmEnabled(): boolean {
    return (
      process.env.MARKETS_ENABLE_LLM === 'true' ||
      process.env.PHASE1_ENABLE_LLM === 'true'
    );
  }

  getPreferredConfig(): LlmConfig {
    return {
      provider: process.env.OPENSOURCE_LLM_PROVIDER || 'ollama_local',
      model:
        process.env.DEFAULT_OPENSOURCE_MODEL ||
        process.env.OLLAMA_DEFAULT_MODEL ||
        'qwen3:8b',
      commercialFallbackProvider: process.env.COMMERCIAL_LLM_PROVIDER || 'openrouter',
      commercialFallbackModel: process.env.DEFAULT_COMMERCIAL_MODEL || 'gpt-4o-mini',
      allowCommercialFallback: process.env.MARKETS_ALLOW_COMMERCIAL_FALLBACK === 'true',
    };
  }

  buildExecutionContext(
    userId: string,
    runType: RunType | string,
  ): ExecutionContext {
    const config = this.getPreferredConfig();
    return {
      conversationId: randomUUID(),
      userId,
      agentSlug: `markets-${runType}-orchestrator`,
      agentType: 'system',
      provider: config.provider,
      model: config.model,
      sovereignMode: false,
    };
  }

  async generateText(
    context: ExecutionContext,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LlmTextResult> {
    const config = this.getPreferredConfig();

    try {
      const response = await this.llm.generateResponse(systemPrompt, userPrompt, {
        provider: config.provider,
        executionContext: context,
        includeMetadata: true,
      });
      return this.unwrapResponse(response, config.provider, config.model);
    } catch (error) {
      if (!config.allowCommercialFallback) throw error;

      const response = await this.llm.generateResponse(systemPrompt, userPrompt, {
        provider: config.commercialFallbackProvider,
        executionContext: context,
        includeMetadata: true,
      });
      return this.unwrapResponse(
        response,
        config.commercialFallbackProvider,
        config.commercialFallbackModel,
      );
    }
  }

  private unwrapResponse(
    response: string | { content?: string; metadata?: { requestId?: string; thinking?: string } },
    provider: string,
    model: string,
  ): LlmTextResult {
    if (typeof response === 'string') {
      return { text: response, provider, model };
    }
    return {
      text: response?.content || JSON.stringify(response),
      provider,
      model,
      reasoning: response?.metadata?.thinking,
      llmUsageId: response?.metadata?.requestId,
    };
  }
}
