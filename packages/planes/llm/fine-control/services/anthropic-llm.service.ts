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
import Anthropic from '@anthropic-ai/sdk';
import { LLMErrorMapper } from './llm-error-handling';
import { anthropicMessageSchema } from '../types/provider-schemas';
import type { AnthropicMessageParsed } from '../types/provider-schemas';

/**
 * Anthropic-specific response metadata extension
 */
interface AnthropicResponseMetadata extends ResponseMetadata {
  providerSpecific: {
    stop_reason:
      | 'end_turn'
      | 'max_tokens'
      | 'stop_sequence'
      | 'tool_use'
      | null;
    stop_sequence?: string;
    model_version?: string;
    // Anthropic usage details
    input_tokens: number;
    output_tokens: number;
    // Anthropic-specific fields
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

/**
 * Anthropic LLM Service Implementation
 *
 * This example shows how to extend BaseLLMService for Anthropic Claude models
 * with provider-specific functionality and metadata handling.
 */
@Injectable()
export class AnthropicLLMService extends BaseLLMService {
  private anthropic: Anthropic;

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

    // Initialize Anthropic client
    this.anthropic = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
      baseURL: config.baseUrl,
    });
  }

  /**
   * Extract thinking from response content
   * Handles both <thinking> tags and structured JSON responses
   */
  private extractThinking(rawContent: string): {
    content: string;
    thinking?: string;
  } {
    let content = rawContent;
    let thinking: string | undefined;

    // Check for <thinking> tags
    if (content.includes('<thinking>') && content.includes('</thinking>')) {
      const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/);
      if (thinkingMatch && thinkingMatch[1]) {
        thinking = thinkingMatch[1].trim();
        // Remove thinking tags and their content from the response
        content = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
      }
    }

    // Check if response is JSON with thinking field
    if (
      !thinking &&
      content.startsWith('{') &&
      content.includes('"thinking"')
    ) {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        if (parsed.thinking) {
          thinking = parsed.thinking as string;
          // Extract the actual response content
          content =
            (parsed.response as string | undefined) ||
            (parsed.content as string | undefined) ||
            (parsed.answer as string | undefined) ||
            content;
        }
      } catch {
        // Not valid JSON or parsing failed, continue with raw content
      }
    }

    // Check for model-specific reasoning patterns
    if (!thinking) {
      let reasoningPatterns: RegExp[] = [];

      if (
        this.config?.model?.includes('claude-4') ||
        this.config?.model?.includes('claude-sonnet-4') ||
        this.config?.model?.includes('claude-opus-4')
      ) {
        // Claude 4 models - enhanced reasoning patterns
        reasoningPatterns = [
          /^Let me think[\s\S]*?(?=Now,|So,|Therefore,|The answer|In conclusion|Based on)/i,
          /^I need to[\s\S]*?(?=The solution|The answer|Based on|Here's)/i,
          /^First,? I'll[\s\S]*?(?=The result|The answer|So|Now)/i,
          /^To solve this[\s\S]*?(?=The answer|Therefore|So|Now)/i,
          /^Looking at this[\s\S]*?(?=The answer|Therefore|So|Now)/i,
        ];
      } else if (this.config?.model?.includes('claude-3-5-sonnet')) {
        // Sonnet-specific patterns
        reasoningPatterns = [
          /^Let me think[\s\S]*?(?=Now,|So,|Therefore,|The answer|In conclusion)/i,
          /^I need to[\s\S]*?(?=The solution|The answer|Based on)/i,
          /^First,? I'll[\s\S]*?(?=The result|The answer|So)/i,
        ];
      } else if (this.config?.model?.includes('claude-3-5-haiku')) {
        // Haiku-specific patterns - look for analytical sections that show reasoning
        reasoningPatterns = [
          /## 🔍[\s\S]*?### Key Observations/i, // Analysis sections
          /Based on the query results[\s\S]*?(?=###|##|$)/i, // Analysis based on data
          /### Key Observations[\s\S]*?(?=###|##|$)/i, // Key insights section
          /Analysis is based[\s\S]*?(?=###|##|Note:|$)/i, // Analysis disclaimers
        ];
      }

      for (const pattern of reasoningPatterns) {
        const match = content.match(pattern);
        if (match) {
          thinking = match[0].trim();
          // For Haiku, keep the content as is since thinking is part of the structured response
          if (!this.config?.model?.includes('claude-3-5-haiku')) {
            content = content.replace(pattern, '').trim();
          }
          break;
        }
      }
    }

    return { content, thinking };
  }

  /**
   * Implementation of the abstract generateResponse method for Anthropic
   */
  async generateResponse(
    context: ExecutionContext,
    params: GenerateResponseParams,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId('anthropic');

    try {
      // Validate configuration
      this.validateConfig(params.config);

      // Use LLM Service level PII pre-processing when provided
      const processedText = params.userMessage;
      const piiMetadata = params.options?.piiMetadata || null;
      if (!piiMetadata) {
        this.logger.warn(
          `⚠️ [PII-METADATA-DEBUG] AnthropicLLMService - No PII metadata from LLM Service, using raw message`,
        );
      }

      // Prepare Anthropic request - support multimodal content when images provided
      let userContent: Anthropic.Messages.ContentBlockParam[] | string =
        processedText;

      if (params.images?.length) {
        const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];
        for (const img of params.images) {
          contentBlocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mimeType as
                | 'image/jpeg'
                | 'image/png'
                | 'image/gif'
                | 'image/webp',
              data: img.base64,
            },
          });
        }
        contentBlocks.push({ type: 'text', text: processedText });
        userContent = contentBlocks;
      }

      const messages: Anthropic.Messages.MessageParam[] = [
        { role: 'user', content: userContent },
      ];

      // Make Anthropic API call
      const completion: AnthropicMessageParsed = anthropicMessageSchema.parse(
        await this.anthropic.messages.create({
          model: params.config.model,
          messages,
          system: params.systemPrompt,
          temperature:
            params.options?.temperature ?? params.config.temperature ?? 0.7,
          max_tokens:
            params.options?.maxTokens ?? params.config.maxTokens ?? 1000,
        }),
      );

      if (!completion.content || completion.content.length === 0) {
        throw new Error('No content in Anthropic response');
      }

      // Extract text content (Anthropic returns array of content blocks)
      const rawContent = completion.content
        .filter(
          (block) => block.type === 'text' && typeof block.text === 'string',
        )
        .map((block) => block.text ?? '')
        .join('');

      if (!rawContent) {
        throw new Error('No text content in Anthropic response');
      }

      // Extract thinking and clean the response
      const { content: textContent, thinking } =
        this.extractThinking(rawContent);

      // Do not reverse here; LLMService handles dictionary reversal consistently
      const finalContent = textContent;

      const endTime = Date.now();

      // Create Anthropic-specific metadata
      const metadata = this.createAnthropicMetadata(
        completion,
        params,
        startTime,
        endTime,
        requestId,
        thinking,
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

      const response: LLMResponse = {
        content: finalContent,
        metadata,
        piiMetadata: piiMetadata ?? undefined,
      };

      // Optional LangSmith integration
      const langsmithRunId = await this.integrateLangSmith(params, response);
      if (langsmithRunId) {
        response.metadata.langsmithRunId = langsmithRunId;
      }

      // Log request/response
      this.logRequestResponse(params, response, metadata.timing.duration);

      return response;
    } catch (error) {
      this.handleError(error, 'AnthropicLLMService.generateResponse');
    }
  }

  /**
   * Create Anthropic-specific metadata with provider-specific fields
   */
  private createAnthropicMetadata(
    completion: AnthropicMessageParsed,
    params: GenerateResponseParams,
    startTime: number,
    endTime: number,
    requestId: string,
    thinking?: string,
  ): AnthropicResponseMetadata {
    const usage = completion.usage ?? { input_tokens: 0, output_tokens: 0 };
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;

    return {
      provider: 'anthropic',
      model: completion.model,
      requestId,
      timestamp: new Date().toISOString(),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cost: this.calculateCost(
          'anthropic',
          completion.model,
          inputTokens,
          outputTokens,
        ),
      },
      timing: {
        startTime,
        endTime,
        duration: endTime - startTime,
      },
      tier: params.options?.preferLocal ? 'local' : 'external',
      status: 'completed',
      thinking,
      // Anthropic-specific fields
      providerSpecific: {
        stop_reason: completion.stop_reason ?? null,
        stop_sequence: undefined,
        model_version: completion.model,
        // Include actual token counts from Anthropic
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
      },
    };
  }

  /**
   * Override LangSmith integration for Anthropic-specific tracing
   */
  protected integrateLangSmith(
    _params: GenerateResponseParams,
    _response: LLMResponse,
  ): Promise<string | undefined> {
    // Example Anthropic-specific LangSmith integration
    if (
      process.env.LANGSMITH_API_KEY &&
      process.env.LANGSMITH_TRACING === 'true'
    ) {
      try {
        // This would integrate with LangSmith for Anthropic-specific tracing
        const runId = `anthropic-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        return Promise.resolve(runId);
      } catch (error) {
        this.logger.warn('LangSmith integration failed:', error);
      }
    }
    return Promise.resolve(undefined);
  }

  /**
   * Anthropic-specific configuration validation
   */
  protected validateConfig(config: LLMServiceConfig): void {
    super.validateConfig(config);

    if (config.provider !== 'anthropic') {
      throw new Error(
        'AnthropicLLMService requires provider to be "anthropic"',
      );
    }

    if (!config.apiKey && !process.env.ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key is required');
    }

    // Validate Anthropic-specific model names
    const validModels = [
      // Claude 4 models
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-opus-4-1-20250805',
      // Database aliases for Claude 4 models
      'claude-4-sonnet',
      'claude-4-opus',
      // Claude 3.7 models
      'claude-3-7-sonnet-20250219',
      // Claude 3.5 models
      'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-20240620',
      'claude-3-5-haiku-20241022',
      // Claude 3 models
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ];

    if (
      !validModels.some((model) =>
        config.model.includes(model.split('-').slice(0, 3).join('-')),
      )
    ) {
      this.logger.warn(
        `Unknown Anthropic model: ${config.model}. Proceeding anyway.`,
      );
    }
  }

  /**
   * Anthropic-specific error handling
   */
  protected handleError(error: unknown, context: string): never {
    // Map to standardized error and delegate to base handler
    try {
      const mapped = LLMErrorMapper.fromAnthropicError(
        error,
        'anthropic',
        this.config?.model,
      );
      super.handleError(mapped, context);
    } catch {
      super.handleError(error, context);
    }
  }
}

/**
 * Factory function to create Anthropic service instances
 */
export function createAnthropicService(
  config: LLMServiceConfig,
  dependencies: {
    piiService: PIIService;
    dictionaryPseudonymizerService: DictionaryPseudonymizerService;
    runMetadataService: RunMetadataService;
    providerConfigService: ProviderConfigService;
  },
): AnthropicLLMService {
  return new AnthropicLLMService(
    { ...config, provider: 'anthropic' },
    dependencies.piiService,
    dependencies.dictionaryPseudonymizerService,
    dependencies.runMetadataService,
    dependencies.providerConfigService,
  );
}

/**
 * Example usage and testing
 */
export async function testAnthropicService() {
  // This would be used in your tests to verify the Anthropic implementation
  const config: LLMServiceConfig = {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
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

  const service = createAnthropicService(config, mockDependencies);

  const mockContext = createMockExecutionContext();
  const params: GenerateResponseParams = {
    systemPrompt: 'You are Claude, an AI assistant created by Anthropic.',
    userMessage: 'Hello, how are you today?',
    config,
    options: {
      executionContext: mockContext,
    },
  };

  const response = await service.generateResponse(mockContext, params);
  return response;
}
