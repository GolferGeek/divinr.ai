import { Injectable } from '@nestjs/common';
import {
  ExecutionContext,
  createMockExecutionContext,
} from '@orchestrator-ai/transport-types';
import { BaseLLMService } from './base-llm.service';
import {
  GenerateResponseParams,
  LLMResponse,
  LLMServiceConfig,
  ResponseMetadata,
} from './llm-interfaces';
import { PIIService } from '../pii/pii.service';
import { DictionaryPseudonymizerService } from '../pii/dictionary-pseudonymizer.service';
import { RunMetadataService } from '../run-metadata.service';
import { ProviderConfigService } from '../provider-config.service';
import { LLMPricingService } from '../llm-pricing.service';

/**
 * Grok-specific response metadata extension
 */
interface GrokResponseMetadata extends ResponseMetadata {
  providerSpecific: {
    finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls';
    system_fingerprint?: string;
    model_version?: string;
    // Grok-specific fields
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    // xAI specific features
    reasoning_tokens?: number;
    cached_tokens?: number;
  };
}

/**
 * Grok (xAI) LLM Service Implementation
 *
 * This example shows how to extend BaseLLMService for xAI's Grok models
 * with provider-specific functionality and metadata handling.
 */
@Injectable()
export class GrokLLMService extends BaseLLMService {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    config: LLMServiceConfig,
    piiService: PIIService,
    dictionaryPseudonymizerService: DictionaryPseudonymizerService,
    runMetadataService: RunMetadataService,
    providerConfigService: ProviderConfigService,
    llmPricingService?: LLMPricingService,
  ) {
    super(
      config,
      piiService,
      dictionaryPseudonymizerService,
      runMetadataService,
      providerConfigService,
      llmPricingService,
    );

    const apiKey = config.apiKey || process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error('Grok API key is required');
    }

    this.apiKey = apiKey;
    this.baseUrl = config.baseUrl || 'https://api.x.ai/v1';
  }

  /**
   * Implementation of the abstract generateResponse method for Grok
   */
  async generateResponse(
    context: ExecutionContext,
    params: GenerateResponseParams,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId('grok');

    try {
      // Validate configuration
      this.validateConfig(params.config);

      // Use PII pre-processing from LLM Service level when available (unified architecture)
      const processedText = params.userMessage;
      const piiMetadata = params.options?.piiMetadata || null;
      if (!piiMetadata) {
        this.logger.warn(
          `⚠️ [PII-METADATA-DEBUG] GrokLLMService - No PII metadata from LLM Service, using raw message`,
        );
      }

      // Prepare Grok request (OpenAI-compatible API)
      const messages = [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: processedText },
      ];

      const requestBody = {
        model: params.config.model,
        messages,
        temperature:
          params.options?.temperature ?? params.config.temperature ?? 0.7,
        max_tokens: params.options?.maxTokens ?? params.config.maxTokens,
        stream: false,
      };

      // Make Grok API call
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Grok API error (${response.status}): ${errorText}`);
      }

      const completion = (await response.json()) as Record<string, unknown>;
      const choice = (completion.choices as unknown[] | undefined)?.[0] as
        | Record<string, unknown>
        | undefined;

      if (
        !choice ||
        !(choice.message as Record<string, unknown> | undefined)?.content
      ) {
        throw new Error('No content in Grok response');
      }
      // Do not reverse here; LLMService handles dictionary reversal consistently
      const finalContent = (choice.message as Record<string, unknown>)
        .content as string;

      const endTime = Date.now();

      // Create Grok-specific metadata
      const metadata = this.createGrokMetadata(
        completion,
        params,
        startTime,
        endTime,
        requestId,
      );

      // Track usage with full metadata for database persistence
      await this.trackUsage(
        context,
        params.config.provider,
        params.config.model,
        metadata.usage.inputTokens,
        metadata.usage.outputTokens,
        metadata.usage.cost,
        {
          requestId,
          callerType: params.options?.callerType,
          callerName: params.options?.callerName,
          piiMetadata: (piiMetadata ?? undefined) as unknown as
            | Record<string, unknown>
            | undefined,
          startTime,
          endTime,
        },
      );

      const llmResponse: LLMResponse = {
        content: finalContent,
        metadata,
        piiMetadata: piiMetadata ?? undefined,
      };

      // Optional LangSmith integration
      const langsmithRunId = await this.integrateLangSmith(params, llmResponse);
      if (langsmithRunId) {
        llmResponse.metadata.langsmithRunId = langsmithRunId;
      }

      // Log request/response
      this.logRequestResponse(params, llmResponse, metadata.timing.duration);

      return llmResponse;
    } catch (error) {
      this.handleError(error, 'GrokLLMService.generateResponse');
    }
  }

  /**
   * Create Grok-specific metadata with provider-specific fields
   */
  private createGrokMetadata(
    completion: Record<string, unknown>,
    params: GenerateResponseParams,
    startTime: number,
    endTime: number,
    requestId: string,
  ): GrokResponseMetadata {
    const choice = (completion.choices as unknown[] | undefined)?.[0] as
      | Record<string, unknown>
      | undefined;
    const usage = completion.usage as Record<string, unknown> | undefined;

    return {
      provider: 'grok',
      model: completion.model as string,
      requestId,
      timestamp: new Date().toISOString(),
      usage: {
        inputTokens: (usage?.prompt_tokens as number | undefined) || 0,
        outputTokens: (usage?.completion_tokens as number | undefined) || 0,
        totalTokens: (usage?.total_tokens as number | undefined) || 0,
        cost: this.calculateCost(
          'grok',
          completion.model as string,
          (usage?.prompt_tokens as number | undefined) || 0,
          (usage?.completion_tokens as number | undefined) || 0,
        ),
      },
      timing: {
        startTime,
        endTime,
        duration: endTime - startTime,
      },
      tier: params.options?.preferLocal ? 'local' : 'external',
      status: 'completed',
      // Grok-specific fields
      providerSpecific: {
        finish_reason: choice?.finish_reason as
          | 'stop'
          | 'length'
          | 'content_filter'
          | 'tool_calls',
        system_fingerprint: completion.system_fingerprint as string | undefined,
        model_version: completion.model as string | undefined,
        // Include actual token counts from Grok
        prompt_tokens: usage?.prompt_tokens as number | undefined,
        completion_tokens: usage?.completion_tokens as number | undefined,
        total_tokens: usage?.total_tokens as number | undefined,
        // Grok may have additional fields
        reasoning_tokens: usage?.reasoning_tokens as number | undefined,
        cached_tokens: usage?.cached_tokens as number | undefined,
      },
    };
  }

  /**
   * Override LangSmith integration for Grok-specific tracing
   */
  protected integrateLangSmith(
    _params: GenerateResponseParams,
    _response: LLMResponse,
  ): Promise<string | undefined> {
    // Example Grok-specific LangSmith integration
    if (
      process.env.LANGSMITH_API_KEY &&
      process.env.LANGSMITH_TRACING === 'true'
    ) {
      try {
        // This would integrate with LangSmith for Grok-specific tracing
        const runId = `grok-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        return Promise.resolve(runId);
      } catch (error) {
        this.logger.warn('LangSmith integration failed:', error);
      }
    }
    return Promise.resolve(undefined);
  }

  /**
   * Grok-specific configuration validation
   */
  protected validateConfig(config: LLMServiceConfig): void {
    super.validateConfig(config);

    if (config.provider !== 'grok' && config.provider !== 'xai') {
      throw new Error('GrokLLMService requires provider to be "grok" or "xai"');
    }

    if (!config.apiKey && !process.env.XAI_API_KEY) {
      throw new Error('Grok (xAI) API key is required');
    }

    // Validate Grok-specific model names
    const validModels = ['grok-beta', 'grok-vision-beta'];

    if (!validModels.some((model) => config.model.includes(model))) {
      this.logger.warn(
        `Unknown Grok model: ${config.model}. Proceeding anyway.`,
      );
    }
  }

  /**
   * Grok-specific error handling
   */
  protected handleError(error: unknown, context: string): never {
    // Handle Grok-specific errors
    const errorObj = error as Record<string, unknown> | undefined;
    if ((errorObj?.message as string | undefined)?.includes('401')) {
      throw new Error(`${context}: Invalid Grok API key`);
    } else if ((errorObj?.message as string | undefined)?.includes('429')) {
      throw new Error(`${context}: Rate limit exceeded for Grok API`);
    } else if ((errorObj?.message as string | undefined)?.includes('400')) {
      throw new Error(`${context}: Invalid request to Grok API`);
    }

    // Fall back to base error handling
    super.handleError(error, context);
  }

  // Note: calculateCost is now inherited from BaseLLMService which uses
  // LLMPricingService for database-driven pricing lookups
}

/**
 * Factory function to create Grok service instances
 */
export function createGrokService(
  config: LLMServiceConfig,
  dependencies: {
    piiService: PIIService;
    dictionaryPseudonymizerService: DictionaryPseudonymizerService;
    runMetadataService: RunMetadataService;
    providerConfigService: ProviderConfigService;
  },
): GrokLLMService {
  return new GrokLLMService(
    { ...config, provider: 'grok' },
    dependencies.piiService,
    dependencies.dictionaryPseudonymizerService,
    dependencies.runMetadataService,
    dependencies.providerConfigService,
  );
}

/**
 * Example usage and testing
 */
export async function testGrokService() {
  // This would be used in your tests to verify the Grok implementation
  const config: LLMServiceConfig = {
    provider: 'grok',
    model: 'grok-beta',
    temperature: 0.7,
    maxTokens: 1000,
  };

  // Mock dependencies for testing
  const mockDependencies = {
    piiService: {} as PIIService,
    dictionaryPseudonymizerService: {} as DictionaryPseudonymizerService,
    runMetadataService: {} as RunMetadataService,
    providerConfigService: {} as ProviderConfigService,
  };

  const service = createGrokService(config, mockDependencies);

  const mockContext = createMockExecutionContext();
  const params: GenerateResponseParams = {
    systemPrompt: 'You are Grok, a witty and helpful AI assistant.',
    userMessage: 'Tell me something interesting about space exploration.',
    config,
    options: {
      executionContext: mockContext,
    },
  };

  const response = await service.generateResponse(mockContext, params);
  return response;
}
