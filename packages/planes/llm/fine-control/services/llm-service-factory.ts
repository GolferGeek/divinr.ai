import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { BaseLLMService } from './base-llm.service';
import { OpenAILLMService } from './openai-llm.service';
import { AnthropicLLMService } from './anthropic-llm.service';
import { GoogleLLMService } from './google-llm.service';
import { OllamaLLMService } from './ollama-llm.service';
import { GrokLLMService } from './grok-llm.service';
import { PIIService } from '../pii/pii.service';
import { DictionaryPseudonymizerService } from '../pii/dictionary-pseudonymizer.service';
import { RunMetadataService } from '../run-metadata.service';
import { ProviderConfigService } from '../provider-config.service';
import { LLMPricingService } from '../llm-pricing.service';
import {
  LLMServiceConfig,
  GenerateResponseParams,
  LLMResponse,
} from './llm-interfaces';
import { LLMRetryHandler, DEFAULT_RETRY_CONFIG } from './llm-error-handling';

/**
 * Supported LLM provider types
 */
export type SupportedProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'xai';

/**
 * Factory service for creating LLM provider instances
 *
 * This factory provides a centralized way to instantiate LLM services with:
 * - Proper dependency injection
 * - Provider validation
 * - Instance caching for performance
 * - Consistent error handling
 * - Support for all provider types
 * - Full metadata preservation (usage, timing, costs, provider-specific data)
 * - PII processing integration
 * - LangSmith tracing support
 */
@Injectable()
export class LLMServiceFactory implements OnModuleInit {
  private readonly logger = new Logger(LLMServiceFactory.name);
  private readonly serviceCache = new Map<string, BaseLLMService>();

  /**
   * Mapping of provider names to their service classes
   */
  private readonly providerMap = {
    openai: OpenAILLMService,
    anthropic: AnthropicLLMService,
    google: GoogleLLMService,
    ollama: OllamaLLMService,
    xai: GrokLLMService,
  } as const;

  constructor(
    @Inject(PIIService) private readonly piiService: PIIService,
    @Inject(DictionaryPseudonymizerService) private readonly dictionaryPseudonymizerService: DictionaryPseudonymizerService,
    @Inject(RunMetadataService) private readonly runMetadataService: RunMetadataService,
    @Inject(ProviderConfigService) private readonly providerConfigService: ProviderConfigService,
    @Inject(HttpService) private readonly httpService: HttpService,
    @Inject(LLMPricingService) private readonly llmPricingService: LLMPricingService,
  ) {
    this.logger.log('LLMServiceFactory initialized');
  }

  /**
   * Load pricing cache after all modules are initialized
   */
  onModuleInit(): void {
    // Preload pricing cache after Supabase is fully initialized (fire-and-forget)
    this.llmPricingService.loadPricingCache().catch((err) => {
      this.logger.warn('Failed to preload pricing cache:', err);
    });
  }

  /**
   * Create or retrieve a cached LLM service instance
   *
   * @param config - Configuration for the LLM service
   * @param useCache - Whether to use cached instances (default: true)
   * @returns Promise<BaseLLMService> - The LLM service instance
   * @throws Error if provider is not supported or configuration is invalid
   */
  async createService(
    config: LLMServiceConfig,
    useCache: boolean = true,
  ): Promise<BaseLLMService> {
    // Validate configuration
    this.validateConfig(config);

    // Normalize provider name
    const normalizedProvider = this.normalizeProviderName(config.provider);

    // Validate provider is supported
    this.validateProvider(normalizedProvider);

    // Generate cache key
    const cacheKey = this.generateCacheKey(config);

    // Return cached instance if available and caching is enabled
    if (useCache && this.serviceCache.has(cacheKey)) {
      this.logger.debug(
        `Returning cached service for provider: ${normalizedProvider}`,
      );
      return this.serviceCache.get(cacheKey)!;
    }

    // Create new service instance
    this.logger.log(
      `Creating new service instance for provider: ${normalizedProvider}`,
    );
    const service = await this.instantiateService(normalizedProvider, config);

    // Cache the instance if caching is enabled
    if (useCache) {
      this.serviceCache.set(cacheKey, service);
      this.logger.debug(`Cached service instance for key: ${cacheKey}`);
    }

    return service;
  }

  /**
   * Get a list of all supported providers
   *
   * @returns Array of supported provider names
   */
  getSupportedProviders(): SupportedProvider[] {
    return Object.keys(this.providerMap) as SupportedProvider[];
  }

  /**
   * Check if a provider is supported
   *
   * @param provider - Provider name to check
   * @returns boolean - True if provider is supported
   */
  isProviderSupported(provider: string): boolean {
    const normalized = this.normalizeProviderName(provider);
    return normalized in this.providerMap;
  }

  /**
   * Clear cached service instances
   *
   * @param provider - Optional provider to clear (clears all if not specified)
   */
  clearCache(provider?: string): void {
    if (provider) {
      const normalized = this.normalizeProviderName(provider);
      const keysToDelete = Array.from(this.serviceCache.keys()).filter((key) =>
        key.startsWith(`${normalized}:`),
      );
      keysToDelete.forEach((key) => this.serviceCache.delete(key));
      this.logger.log(`Cleared cache for provider: ${normalized}`);
    } else {
      this.serviceCache.clear();
      this.logger.log('Cleared all cached service instances');
    }
  }

  /**
   * Get cache statistics
   *
   * @returns Object with cache statistics
   */
  getCacheStats(): {
    totalCached: number;
    providerBreakdown: Record<string, number>;
  } {
    const providerBreakdown: Record<string, number> = {};

    for (const key of this.serviceCache.keys()) {
      const provider = key.split(':')[0];
      if (provider) {
        providerBreakdown[provider] = (providerBreakdown[provider] || 0) + 1;
      }
    }

    return {
      totalCached: this.serviceCache.size,
      providerBreakdown,
    };
  }

  /**
   * Create a service and generate a response with full metadata preservation
   *
   * This is a convenience method that combines service creation with response generation,
   * ensuring all metadata (usage, timing, costs, provider-specific data) flows through properly.
   *
   * @param config - Configuration for the LLM service
   * @param params - Parameters for response generation (must include options.executionContext)
   * @param useCache - Whether to use cached service instances (default: true)
   * @returns Promise<LLMResponse> - Complete response with full metadata
   */
  async generateResponse(
    config: LLMServiceConfig,
    params: GenerateResponseParams,
    useCache: boolean = true,
  ): Promise<LLMResponse> {
    // Create or get cached service
    const service = await this.createService(config, useCache);

    // ExecutionContext is required and comes from params.options
    const executionContext = params.options.executionContext;

    // Generate response with full metadata, with retry on transient errors only
    const response = await LLMRetryHandler.withRetry(
      () => service.generateResponse(executionContext, params),
      DEFAULT_RETRY_CONFIG,
      `LLMFactory:${config.provider}:${config.model}`,
    );

    this.logger.debug(
      `Generated response via factory for provider: ${config.provider}`,
      {
        provider: response.metadata.provider,
        model: response.metadata.model,
        requestId: response.metadata.requestId,
        usage: response.metadata.usage,
        timing: response.metadata.timing,
        hasPiiMetadata: !!response.piiMetadata,
      },
    );

    return response;
  }

  /**
   * Get service instance for direct use (preserves all metadata capabilities)
   *
   * Use this when you need direct access to the service for multiple operations
   * while maintaining full metadata tracking capabilities.
   *
   * @param config - Configuration for the LLM service
   * @param useCache - Whether to use cached instances (default: true)
   * @returns Promise<BaseLLMService> - Service instance with full metadata support
   */
  async getService(
    config: LLMServiceConfig,
    useCache: boolean = true,
  ): Promise<BaseLLMService> {
    return this.createService(config, useCache);
  }

  /**
   * Validate the LLM service configuration
   *
   * @private
   * @param config - Configuration to validate
   * @throws Error if configuration is invalid
   */
  private validateConfig(config: LLMServiceConfig): void {
    if (!config) {
      throw new Error('LLM service configuration is required');
    }

    if (!config.provider) {
      throw new Error('Provider is required in LLM service configuration');
    }

    if (!config.model) {
      throw new Error('Model is required in LLM service configuration');
    }

    // Validate optional numeric parameters
    if (config.temperature !== undefined) {
      if (
        typeof config.temperature !== 'number' ||
        config.temperature < 0 ||
        config.temperature > 2
      ) {
        throw new Error('Temperature must be a number between 0 and 2');
      }
    }

    if (config.maxTokens !== undefined) {
      if (typeof config.maxTokens !== 'number' || config.maxTokens <= 0) {
        throw new Error('Max tokens must be a positive number');
      }
    }

    if (config.timeout !== undefined) {
      if (typeof config.timeout !== 'number' || config.timeout <= 0) {
        throw new Error('Timeout must be a positive number');
      }
    }
  }

  /**
   * Normalize provider name to lowercase and map aliases
   *
   * @private
   * @param provider - Provider name to normalize
   * @returns Normalized provider name
   */
  private normalizeProviderName(provider: string): SupportedProvider {
    const normalized = provider.toLowerCase().trim();
    // Map ollama-cloud to ollama - the OllamaLLMService handles cloud mode
    // based on OLLAMA_CLOUD_API_KEY environment variable
    if (normalized === 'ollama-cloud') {
      return 'ollama';
    }
    return normalized as SupportedProvider;
  }

  /**
   * Validate that the provider is supported
   *
   * @private
   * @param provider - Normalized provider name
   * @throws Error if provider is not supported
   */
  private validateProvider(
    provider: string,
  ): asserts provider is SupportedProvider {
    if (!this.isProviderSupported(provider)) {
      const supportedProviders = this.getSupportedProviders().join(', ');
      throw new Error(
        `Unsupported provider: ${provider}. Supported providers: ${supportedProviders}`,
      );
    }
  }

  /**
   * Generate a cache key for the service configuration
   *
   * @private
   * @param config - LLM service configuration
   * @returns Cache key string
   */
  private generateCacheKey(config: LLMServiceConfig): string {
    const normalizedProvider = this.normalizeProviderName(config.provider);
    const keyParts = [
      normalizedProvider,
      config.model,
      config.temperature?.toString() || 'default',
      config.maxTokens?.toString() || 'default',
      config.baseUrl || 'default',
      config.timeout?.toString() || 'default',
    ];

    return keyParts.join(':');
  }

  /**
   * Instantiate a new service based on provider type
   *
   * @private
   * @param provider - Normalized provider name
   * @param config - LLM service configuration
   * @returns Promise<BaseLLMService> - New service instance
   * @throws Error if instantiation fails
   */
  private instantiateService(
    provider: SupportedProvider,
    config: LLMServiceConfig,
  ): Promise<BaseLLMService> {
    try {
      let serviceInstance: BaseLLMService;

      // Handle each provider with their specific constructor requirements
      switch (provider) {
        case 'openai':
          serviceInstance = new OpenAILLMService(
            config,
            this.piiService,
            this.dictionaryPseudonymizerService,
            this.runMetadataService,
            this.providerConfigService,
            this.llmPricingService,
          ) as unknown as BaseLLMService;
          break;

        case 'anthropic':
          serviceInstance = new AnthropicLLMService(
            config,
            this.piiService,
            this.dictionaryPseudonymizerService,
            this.runMetadataService,
            this.providerConfigService,
            this.llmPricingService,
          ) as unknown as BaseLLMService;
          break;

        case 'google':
          serviceInstance = new GoogleLLMService(
            config,
            this.piiService,
            this.dictionaryPseudonymizerService,
            this.runMetadataService,
            this.providerConfigService,
            this.llmPricingService,
          ) as unknown as BaseLLMService;
          break;

        case 'ollama':
          serviceInstance = new OllamaLLMService(
            config,
            this.piiService,
            this.dictionaryPseudonymizerService,
            this.runMetadataService,
            this.providerConfigService,
            this.httpService,
            this.llmPricingService,
          ) as unknown as BaseLLMService;
          break;

        case 'xai':
          serviceInstance = new GrokLLMService(
            config,
            this.piiService,
            this.dictionaryPseudonymizerService,
            this.runMetadataService,
            this.providerConfigService,
            this.llmPricingService,
          ) as unknown as BaseLLMService;
          break;

        default:
          throw new Error(`Unsupported provider: ${String(provider)}`);
      }

      this.logger.log(`Successfully instantiated ${provider} service`);
      return Promise.resolve(serviceInstance);
    } catch (error) {
      const errorMessage = `Failed to instantiate ${provider} service: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      this.logger.error(
        errorMessage,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(errorMessage);
    }
  }
}
