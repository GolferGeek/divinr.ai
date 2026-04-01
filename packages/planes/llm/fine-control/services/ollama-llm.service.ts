import { Injectable } from '@nestjs/common';
import {
  ExecutionContext,
  createMockExecutionContext,
} from '@orchestrator-ai/transport-types';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BaseLLMService } from './base-llm.service';
import {
  GenerateResponseParams,
  LLMResponse,
  LLMServiceConfig,
  ResponseMetadata,
  LocalLLMRequest,
} from './llm-interfaces';
import { PIIService } from '../pii/pii.service';
import { DictionaryPseudonymizerService } from '../pii/dictionary-pseudonymizer.service';
import { RunMetadataService } from '../run-metadata.service';
import { ProviderConfigService } from '../provider-config.service';
import { LLMPricingService } from '../llm-pricing.service';
import { LLMErrorMapper } from './llm-error-handling';
import { ollamaResponseSchema } from '../types/provider-schemas';
import type { OllamaResponseParsed } from '../types/provider-schemas';

/**
 * Ollama-specific response metadata extension
 */
interface OllamaResponseMetadata extends ResponseMetadata {
  providerSpecific: {
    // Ollama-specific timing and performance metrics
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
    // Model loading information
    model_loaded: boolean;
    load_time_ms?: number;
    // Local model status
    model_status: 'loaded' | 'loading' | 'unloaded' | 'error';
  };
}

/**
 * Ollama LLM Service Implementation
 *
 * This service supports both local Ollama and Ollama Cloud:
 * - Local mode: No API key required, connects to localhost:11434
 * - Cloud mode: Requires OLLAMA_CLOUD_API_KEY, connects to ollama.com
 *
 * Cloud mode is automatically activated when OLLAMA_CLOUD_API_KEY is set.
 * This enables running large models without requiring powerful local hardware.
 *
 * NOTE for production deployments: Consider enabling PII pseudonymization
 * for cloud mode since data leaves the local machine. Currently disabled
 * for simplicity in development/learning environments.
 */
@Injectable()
export class OllamaLLMService extends BaseLLMService {
  private readonly ollamaBaseUrl: string;
  private readonly loadedModels = new Set<string>();
  private readonly isCloudMode: boolean;
  private readonly ollamaApiKey: string | undefined;

  constructor(
    config: LLMServiceConfig,
    piiService: PIIService,
    dictionaryPseudonymizerService: DictionaryPseudonymizerService,
    runMetadataService: RunMetadataService,
    providerConfigService: ProviderConfigService,
    private readonly httpService: HttpService,
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

    // Simple: cloud mode only if provider is explicitly 'ollama-cloud'
    this.isCloudMode = config.provider === 'ollama-cloud';

    if (this.isCloudMode) {
      // Cloud mode: use cloud URL and API key
      this.ollamaBaseUrl =
        config.baseUrl ||
        process.env.OLLAMA_CLOUD_BASE_URL ||
        'https://ollama.com';
      this.ollamaApiKey = config.apiKey || process.env.OLLAMA_CLOUD_API_KEY;
      this.logger.log(
        `Ollama service initialized in CLOUD mode (${this.ollamaBaseUrl})`,
      );
    } else {
      // Local mode: use local URL, no API key needed
      this.ollamaBaseUrl =
        config.baseUrl ||
        process.env.OLLAMA_BASE_URL ||
        'http://localhost:11434';
      this.ollamaApiKey = undefined;
      this.logger.log(
        `Ollama service initialized in LOCAL mode (${this.ollamaBaseUrl})`,
      );
    }
  }

  /**
   * Implementation of the abstract generateResponse method for Ollama
   */
  async generateResponse(
    context: ExecutionContext,
    params: GenerateResponseParams,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId('ollama');

    try {
      // Validate configuration
      this.validateConfig(params.config);

      // Skip PII processing for both local and cloud modes
      // NOTE: For production cloud deployments, consider enabling PII pseudonymization
      // since data leaves the local machine when using Ollama Cloud
      const piiResult = await this.handlePiiInput(params.userMessage, {
        enablePseudonymization: false,
        useDictionaryPseudonymizer: false,
      });

      // Ensure model is loaded (skip for cloud mode - cloud handles model availability)
      let modelLoadResult: {
        success: boolean;
        message?: string;
        loadTime?: number;
      } = {
        success: true,
      };
      if (!this.isCloudMode) {
        modelLoadResult = await this.ensureModelLoaded(params.config.model);
        if (!modelLoadResult.success) {
          throw new Error(
            `Failed to load model ${params.config.model}: ${modelLoadResult.message}`,
          );
        }
      }

      // Prepare Ollama request
      const ollamaRequest: LocalLLMRequest = {
        model: params.config.model,
        prompt: piiResult.processedText,
        system: params.systemPrompt,
        options: {
          temperature:
            params.options?.temperature ?? params.config.temperature ?? 0.7,
          max_tokens:
            params.options?.maxTokens ?? params.config.maxTokens ?? 2000,
          top_p: 0.9,
          top_k: 40,
        },
      };

      // Build request headers (add auth for cloud mode)
      const requestHeaders: Record<string, string> = {};
      if (this.isCloudMode && this.ollamaApiKey) {
        requestHeaders['Authorization'] = `Bearer ${this.ollamaApiKey}`;
      }

      // Make Ollama API call
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.ollamaBaseUrl}/api/generate`,
          {
            ...ollamaRequest,
            stream: false,
            ...(params.options?.responseFormat === 'json'
              ? { format: 'json' }
              : {}),
            options: {
              temperature: ollamaRequest.options?.temperature,
              num_predict: ollamaRequest.options?.max_tokens,
              top_p: ollamaRequest.options?.top_p,
              top_k: ollamaRequest.options?.top_k,
            },
          },
          {
            timeout: 300000, // 5 minutes - no timeouts in production
            headers: requestHeaders,
          },
        ),
      );

      const parsedResponse: OllamaResponseParsed = ollamaResponseSchema.parse(
        response.data,
      );

      // Thinking models (qwen3, etc.) may put content in `thinking` with empty `response`
      const responseText =
        parsedResponse.response || parsedResponse.thinking || '';
      if (!responseText) {
        throw new Error('No response from Ollama model');
      }

      // Handle PII in output (usually not needed for local models)
      const finalContent = await this.handlePiiOutput(responseText, requestId);

      const endTime = Date.now();

      // Create Ollama-specific metadata
      const metadata = this.createOllamaMetadata(
        parsedResponse,
        params,
        startTime,
        endTime,
        requestId,
        modelLoadResult,
      );

      // Track usage with full metadata for database persistence
      // Cloud models may have costs in the future; local models are free
      const estimatedCost = this.isCloudMode ? 0 : 0; // Placeholder: update when Ollama Cloud pricing is available
      await this.trackUsage(
        context,
        params.config.provider,
        params.config.model,
        metadata.usage.inputTokens,
        metadata.usage.outputTokens,
        estimatedCost,
        {
          requestId,
          callerType: params.options?.callerType,
          callerName: params.options?.callerName,
          piiMetadata: (piiResult.piiMetadata ?? undefined) as unknown as
            | Record<string, unknown>
            | undefined,
          startTime,
          endTime,
        },
      );

      const llmResponse: LLMResponse = {
        content: finalContent,
        metadata,
        piiMetadata: piiResult.piiMetadata ?? undefined,
      };

      // Log request/response
      this.logRequestResponse(params, llmResponse, metadata.timing.duration);

      return llmResponse;
    } catch (error) {
      this.handleError(error, 'OllamaLLMService.generateResponse');
    }
  }

  /**
   * Ensure the model is loaded and ready for use
   */
  private async ensureModelLoaded(
    model: string,
  ): Promise<{ success: boolean; message?: string; loadTime?: number }> {
    const loadStartTime = Date.now();

    try {
      // Check if model is already loaded
      if (this.loadedModels.has(model)) {
        return { success: true };
      }

      // Check if model exists
      const modelsResponse = await firstValueFrom(
        this.httpService.get(`${this.ollamaBaseUrl}/api/tags`),
      );

      const availableModels =
        (modelsResponse.data as Record<string, unknown>).models || [];
      const modelExists = (
        availableModels as Array<Record<string, unknown>>
      ).some((m: Record<string, unknown>) => m.name === model);

      if (!modelExists) {
        const modelNames = (
          availableModels as Array<Record<string, unknown>>
        ).map((m: Record<string, unknown>) => (m as { name: string }).name);
        return {
          success: false,
          message: `Model ${model} not found. Available models: ${modelNames.join(', ')}`,
        };
      }

      // Load the model by making a small request
      await firstValueFrom(
        this.httpService.post(
          `${this.ollamaBaseUrl}/api/generate`,
          {
            model,
            prompt: 'test',
            stream: false,
            options: { num_predict: 1 },
          },
          { timeout: 300000 }, // 5 minutes - no timeouts in production
        ),
      );

      const loadTime = Date.now() - loadStartTime;
      this.loadedModels.add(model);

      return { success: true, loadTime };
    } catch (error) {
      const loadTime = Date.now() - loadStartTime;
      this.logger.error(
        `Failed to load model ${model} after ${loadTime}ms:`,
        error,
      );
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        loadTime,
      };
    }
  }

  /**
   * Create Ollama-specific metadata with performance metrics
   */
  private createOllamaMetadata(
    ollamaResponse: OllamaResponseParsed,
    params: GenerateResponseParams,
    startTime: number,
    endTime: number,
    requestId: string,
    modelLoadResult: { success: boolean; loadTime?: number },
  ): OllamaResponseMetadata {
    // Estimate tokens (Ollama doesn't always provide exact counts)
    const inputTokens =
      ollamaResponse.prompt_eval_count ||
      this.estimateTokens(params.systemPrompt + params.userMessage);
    const outputTokens =
      ollamaResponse.eval_count || this.estimateTokens(ollamaResponse.response);

    return {
      provider: 'ollama',
      model: ollamaResponse.model,
      requestId,
      timestamp: new Date().toISOString(),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cost: 0, // Placeholder: update when Ollama Cloud pricing is available
      },
      timing: {
        startTime,
        endTime,
        duration: endTime - startTime,
      },
      tier: this.isCloudMode ? 'external' : 'local', // 'external' for cloud, 'local' for local Ollama
      status: 'completed',
      // Ollama-specific performance metrics
      providerSpecific: {
        total_duration: ollamaResponse.total_duration,
        load_duration: ollamaResponse.load_duration,
        prompt_eval_count: ollamaResponse.prompt_eval_count,
        prompt_eval_duration: ollamaResponse.prompt_eval_duration,
        eval_count: ollamaResponse.eval_count,
        eval_duration: ollamaResponse.eval_duration,
        model_loaded: modelLoadResult.success,
        load_time_ms: modelLoadResult.loadTime,
        model_status: modelLoadResult.success ? 'loaded' : 'error',
      },
    };
  }

  /**
   * Ollama-specific configuration validation
   */
  protected validateConfig(config: LLMServiceConfig): void {
    super.validateConfig(config);

    // Accept both 'ollama' (local) and 'ollama-cloud' (cloud) providers
    const validProviders = ['ollama', 'ollama-cloud'];
    if (!validProviders.includes(config.provider)) {
      throw new Error(
        `OllamaLLMService requires provider to be "ollama" or "ollama-cloud"`,
      );
    }

    // Validate Ollama connection
    if (!this.ollamaBaseUrl) {
      throw new Error('Ollama base URL is required');
    }
  }

  /**
   * Ollama-specific error handling
   */
  protected handleError(error: unknown, context: string): never {
    try {
      const mapped = LLMErrorMapper.fromOllamaError(
        error,
        'ollama',
        this.config?.model,
      );
      super.handleError(mapped, context);
    } catch {
      super.handleError(error, context);
    }
  }

  /**
   * Get HTTP request config with auth headers for cloud mode
   */
  private getHttpConfig(): { headers?: Record<string, string> } {
    if (this.isCloudMode && this.ollamaApiKey) {
      return {
        headers: {
          Authorization: `Bearer ${this.ollamaApiKey}`,
        },
      };
    }
    return {};
  }

  /**
   * Get available models from Ollama (local or cloud)
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ollamaBaseUrl}/api/tags`,
          this.getHttpConfig(),
        ),
      );
      const models = (response.data as Record<string, unknown>).models as
        | Array<{ name: string }>
        | undefined;
      return models?.map((model) => model.name) || [];
    } catch (error) {
      this.logger.error('Failed to get available models:', error);
      return [];
    }
  }

  /**
   * Check Ollama server health (local or cloud)
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    version?: string;
    models?: string[];
    isCloudMode?: boolean;
  }> {
    try {
      const httpConfig = this.getHttpConfig();
      const [versionResponse, modelsResponse] = await Promise.all([
        firstValueFrom(
          this.httpService.get(`${this.ollamaBaseUrl}/api/version`, httpConfig),
        ),
        firstValueFrom(
          this.httpService.get(`${this.ollamaBaseUrl}/api/tags`, httpConfig),
        ),
      ]);

      const models = (modelsResponse.data as Record<string, unknown>).models as
        | Array<{ name: string }>
        | undefined;
      return {
        healthy: true,
        version: (versionResponse.data as Record<string, unknown>).version as
          | string
          | undefined,
        models: models?.map((m) => m.name) || [],
        isCloudMode: this.isCloudMode,
      };
    } catch {
      return { healthy: false, isCloudMode: this.isCloudMode };
    }
  }
}

/**
 * Factory function to create Ollama service instances
 */
export function createOllamaService(
  config: LLMServiceConfig,
  dependencies: {
    piiService: PIIService;
    dictionaryPseudonymizerService: DictionaryPseudonymizerService;
    runMetadataService: RunMetadataService;
    providerConfigService: ProviderConfigService;
    httpService: HttpService;
  },
): OllamaLLMService {
  return new OllamaLLMService(
    { ...config, provider: 'ollama' },
    dependencies.piiService,
    dependencies.dictionaryPseudonymizerService,
    dependencies.runMetadataService,
    dependencies.providerConfigService,
    dependencies.httpService,
  );
}

/**
 * Example usage and testing
 */
export async function testOllamaService() {
  // This would be used in your tests to verify the Ollama implementation
  const config: LLMServiceConfig = {
    provider: 'ollama',
    model: 'llama3.2:3b', // Popular small model for testing
    temperature: 0.7,
    maxTokens: 1000,
    baseUrl: 'http://localhost:11434',
  };

  // Mock dependencies for testing
  const mockDependencies = {
    piiService: {} as PIIService,
    dictionaryPseudonymizerService: {} as DictionaryPseudonymizerService,
    runMetadataService: {} as RunMetadataService,
    providerConfigService: {} as ProviderConfigService,
    httpService: {} as HttpService,
  };

  const service = createOllamaService(config, mockDependencies);

  // Check health first
  const health = await service.checkHealth();

  if (!health.healthy) {
    throw new Error('Ollama server is not healthy');
  }

  const mockContext = createMockExecutionContext({
    conversationId: 'test-conversation',
  });

  const params: GenerateResponseParams = {
    systemPrompt: 'You are a helpful AI assistant running locally.',
    userMessage: 'Hello, tell me about yourself.',
    config,
    options: {
      preferLocal: true, // This will set tier to 'local'
      executionContext: mockContext,
    },
  };

  return service.generateResponse(mockContext, params);
}
