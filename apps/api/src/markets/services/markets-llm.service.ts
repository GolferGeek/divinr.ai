import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@orchestrator-ai/transport-types';
import { LLM_SERVICE, type LLMServiceProvider } from '@orchestratorai/planes/llm';
import type { RunType } from '../markets.types';
import { LlmUsageLogger } from './llm-usage-logger.service';

export interface LlmConfig {
  provider: string;
  model: string;
  commercialFallbackProvider: string;
  commercialFallbackModel: string;
  allowCommercialFallback: boolean;
}

export interface LlmUsageContext {
  stage: string;
  subStage?: string;
  articleId?: string;
  instrumentId?: string;
  analystId?: string;
  billedUserId?: string;
  analystAuthorUserId?: string;
  instrumentAuthorUserId?: string;
  cycleId?: string;
}

export interface LlmTextResult {
  text: string;
  provider: string;
  model: string;
  /** Captured thinking/reasoning content from reasoning-capable models. Undefined when the provider returned none. */
  reasoning?: string;
  /** Primary key (uuid) of the llm_usage row written for this call. Stamp this onto any analysis row produced from the call. */
  llmUsageId?: string;
  promptTokens?: number;
  completionTokens?: number;
}

/**
 * Shared LLM helper used by all markets services (risk-runner, prediction-runner, etc.)
 * Centralizes LLM config, execution context building, and text generation with fallback.
 */
@Injectable()
export class MarketsLlmService {
  private readonly logger = new Logger(MarketsLlmService.name);

  constructor(
    @Inject(LLM_SERVICE) private readonly llm: LLMServiceProvider,
    @Inject(LlmUsageLogger) private readonly usageLogger: LlmUsageLogger,
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
    analystConfig?: { llmProvider?: string; llmModel?: string; byoCredentialId?: string },
    usageContext?: LlmUsageContext,
  ): Promise<LlmTextResult> {
    if (analystConfig?.byoCredentialId) {
      this.logger.log(
        `BYO credential routing: would use credential ${analystConfig.byoCredentialId} ` +
        `with provider=${analystConfig.llmProvider} model=${analystConfig.llmModel} (not yet implemented)`,
      );
    }

    const config = this.getPreferredConfig();
    const startMs = Date.now();
    const promptText = systemPrompt + '\n' + userPrompt;

    try {
      const response = await this.llm.generateResponse(systemPrompt, userPrompt, {
        provider: config.provider,
        executionContext: context,
        includeMetadata: true,
      });
      const result = this.unwrapResponse(response, config.provider, config.model);
      const meta = this.extractMetadata(response);
      await this.recordUsage(result, usageContext, startMs, promptText, meta);
      return result;
    } catch (error) {
      if (!config.allowCommercialFallback) {
        await this.recordUsageError(config.provider, config.model, usageContext, startMs, promptText, error);
        throw error;
      }

      try {
        const response = await this.llm.generateResponse(systemPrompt, userPrompt, {
          provider: config.commercialFallbackProvider,
          executionContext: context,
          includeMetadata: true,
        });
        const result = this.unwrapResponse(
          response,
          config.commercialFallbackProvider,
          config.commercialFallbackModel,
        );
        const meta = this.extractMetadata(response);
        await this.recordUsage(result, usageContext, startMs, promptText, meta);
        return result;
      } catch (fallbackError) {
        await this.recordUsageError(
          config.commercialFallbackProvider, config.commercialFallbackModel,
          usageContext, startMs, promptText, fallbackError,
        );
        throw fallbackError;
      }
    }
  }

  private unwrapResponse(
    response: string | { content?: string; metadata?: { requestId?: string; thinking?: string } },
    provider: string,
    model: string,
  ): LlmTextResult {
    const metadata = this.extractMetadata(response);
    if (typeof response === 'string') {
      return { text: response, provider, model, promptTokens: metadata.tokensIn, completionTokens: metadata.tokensOut };
    }
    return {
      text: response?.content || JSON.stringify(response),
      provider,
      model,
      reasoning: response?.metadata?.thinking,
      llmUsageId: response?.metadata?.requestId,
      promptTokens: metadata.tokensIn,
      completionTokens: metadata.tokensOut,
    };
  }

  private extractMetadata(
    response: unknown,
  ): { tokensIn: number; tokensOut: number } {
    const meta = (response as { metadata?: { usage?: { inputTokens?: number; outputTokens?: number } } })?.metadata;
    return {
      tokensIn: meta?.usage?.inputTokens ?? 0,
      tokensOut: meta?.usage?.outputTokens ?? 0,
    };
  }

  private async recordUsage(
    result: LlmTextResult,
    usageContext: LlmUsageContext | undefined,
    startMs: number,
    promptText: string,
    meta: { tokensIn: number; tokensOut: number },
  ): Promise<void> {
    if (!usageContext) return;
    const usageId = await this.usageLogger.record(
      result, usageContext, Date.now() - startMs,
      promptText, meta.tokensIn, meta.tokensOut,
    );
    if (usageId) {
      result.llmUsageId = usageId;
    }
  }

  private async recordUsageError(
    provider: string,
    model: string,
    usageContext: LlmUsageContext | undefined,
    startMs: number,
    promptText: string,
    error: unknown,
  ): Promise<void> {
    if (!usageContext) return;
    const errorResult: LlmTextResult = { text: '', provider, model };
    const errorMsg = error instanceof Error ? error.message : String(error);
    await this.usageLogger.record(
      errorResult, usageContext, Date.now() - startMs,
      promptText, 0, 0, errorMsg,
    );
  }
}
