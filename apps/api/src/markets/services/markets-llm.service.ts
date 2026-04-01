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
    organizationSlug: string,
    userId: string,
    runType: RunType | string,
  ): ExecutionContext {
    const config = this.getPreferredConfig();
    return {
      conversationId: randomUUID(),
      userId,
      orgSlug: organizationSlug,
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
      });
      const text =
        typeof response === 'string'
          ? response
          : response?.content || JSON.stringify(response);
      return { text, provider: config.provider, model: config.model };
    } catch (error) {
      if (!config.allowCommercialFallback) throw error;

      const response = await this.llm.generateResponse(systemPrompt, userPrompt, {
        provider: config.commercialFallbackProvider,
        executionContext: context,
      });
      const text =
        typeof response === 'string'
          ? response
          : response?.content || JSON.stringify(response);
      return {
        text,
        provider: config.commercialFallbackProvider,
        model: config.commercialFallbackModel,
      };
    }
  }
}
