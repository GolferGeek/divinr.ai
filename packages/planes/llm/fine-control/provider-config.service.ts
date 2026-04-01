import { Injectable, Logger } from '@nestjs/common';

export interface ProviderConfig {
  name: string;
  baseUrl?: string;
  apiKey?: string;
  defaultHeaders: Record<string, string>;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  rateLimits?: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
  features: {
    supportsStreaming: boolean;
    supportsNoTrain: boolean;
    supportsNoRetain: boolean;
    supportsFunctions: boolean;
  };
}

export interface ModelConfig {
  name: string;
  providerId: string;
  maxTokens: number;
  contextWindow: number;
  costPer1kInput: number;
  costPer1kOutput: number;
  isLocal: boolean;
  tier?: string;
  capabilities: string[];
}

export interface RequestHeaders {
  'X-Policy-Profile': string;
  'X-Data-Class': string;
  'X-Sovereign-Mode': string;
  'X-No-Train'?: string;
  'X-No-Retain'?: string;
  [key: string]: string | undefined;
}

/**
 * Provider Configuration Service
 *
 * Manages LLM provider configurations and model settings.
 *
 * Responsibilities:
 * - Validates provider configurations (API keys, base URLs)
 * - Provides provider-specific settings (timeouts, rate limits, features)
 * - Manages model configurations and capabilities
 * - Handles local vs cloud provider detection
 *
 * Key Methods:
 * - getProviderConfig(): Get configuration for a provider
 * - validateProviderConfig(): Validate provider setup
 * - getModelConfig(): Get model-specific configuration
 *
 * @see docs/TROUBLESHOOTING.md for configuration help
 * @see GETTING_STARTED.md for initial setup
 */
@Injectable()
export class ProviderConfigService {
  private readonly logger = new Logger(ProviderConfigService.name);
  private readonly providerConfigs = new Map<string, ProviderConfig>();
  private readonly modelConfigs = new Map<string, ModelConfig>();

  constructor() {
    this.initializeProviderConfigs();
    this.logger.log('ProviderConfigService initialized');
  }

  /**
   * Initialize default provider configurations
   */
  private initializeProviderConfigs(): void {
    // OpenAI Configuration
    this.providerConfigs.set('openai', {
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      defaultHeaders: {
        'User-Agent': 'OrchestratorAI/1.0',
        'X-No-Train': 'true', // OpenAI no-train header
      },
      timeout: 300000, // 5 minutes - no timeouts in production
      retryAttempts: 3,
      retryDelay: 1000,
      rateLimits: {
        requestsPerMinute: 3500,
        tokensPerMinute: 90000,
      },
      features: {
        supportsStreaming: true,
        supportsNoTrain: true,
        supportsNoRetain: false,
        supportsFunctions: true,
      },
    });

    // Anthropic Configuration
    this.providerConfigs.set('anthropic', {
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      defaultHeaders: {
        'User-Agent': 'OrchestratorAI/1.0',
        'anthropic-version': '2023-06-01',
      },
      timeout: 300000, // 5 minutes - no timeouts in production
      retryAttempts: 3,
      retryDelay: 1500,
      rateLimits: {
        requestsPerMinute: 1000,
        tokensPerMinute: 40000,
      },
      features: {
        supportsStreaming: true,
        supportsNoTrain: false,
        supportsNoRetain: false,
        supportsFunctions: false,
      },
    });

    // Ollama Local Configuration
    // Provider 'ollama' = local mode (localhost:11434, no API key)
    this.providerConfigs.set('ollama', {
      name: 'Ollama',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      apiKey: undefined, // Local mode never needs API key
      defaultHeaders: {
        'User-Agent': 'OrchestratorAI/1.0',
      },
      timeout: 300000, // 5 minutes - no timeouts in production
      retryAttempts: 2,
      retryDelay: 2000,
      rateLimits: undefined, // Local has no rate limits
      features: {
        supportsStreaming: true,
        supportsNoTrain: true, // Local: data stays local
        supportsNoRetain: true, // Local: data stays local
        supportsFunctions: false,
      },
    });

    // Ollama Cloud Configuration
    // Provider 'ollama-cloud' = cloud mode (ollama.com, requires API key)
    this.providerConfigs.set('ollama-cloud', {
      name: 'Ollama Cloud',
      baseUrl: process.env.OLLAMA_CLOUD_BASE_URL || 'https://ollama.com',
      apiKey: process.env.OLLAMA_CLOUD_API_KEY,
      defaultHeaders: {
        'User-Agent': 'OrchestratorAI/1.0',
      },
      timeout: 300000, // 5 minutes - no timeouts in production
      retryAttempts: 3,
      retryDelay: 1000,
      rateLimits: {
        requestsPerMinute: 500, // Estimated cloud rate limits
        tokensPerMinute: 100000,
      },
      features: {
        supportsStreaming: true,
        supportsNoTrain: false, // Cloud: may train on data
        supportsNoRetain: false, // Cloud: may retain data
        supportsFunctions: false,
      },
    });

    // Google Configuration
    this.providerConfigs.set('google', {
      name: 'Google',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      defaultHeaders: {
        'User-Agent': 'OrchestratorAI/1.0',
      },
      timeout: 300000, // 5 minutes - no timeouts in production
      retryAttempts: 3,
      retryDelay: 1000,
      features: {
        supportsStreaming: true,
        supportsNoTrain: false,
        supportsNoRetain: false,
        supportsFunctions: true,
      },
    });

    // xAI (Grok) Configuration
    this.providerConfigs.set('xai', {
      name: 'xAI',
      baseUrl: 'https://api.x.ai/v1',
      defaultHeaders: {
        'User-Agent': 'OrchestratorAI/1.0',
      },
      timeout: 300000, // 5 minutes - no timeouts in production
      retryAttempts: 3,
      retryDelay: 1000,
      rateLimits: {
        requestsPerMinute: 1000,
        tokensPerMinute: 100000,
      },
      features: {
        supportsStreaming: true,
        supportsNoTrain: false,
        supportsNoRetain: false,
        supportsFunctions: true,
      },
    });
  }

  /**
   * Get provider configuration by name
   */
  getProviderConfig(providerName: string): ProviderConfig | null {
    return this.providerConfigs.get(providerName.toLowerCase()) || null;
  }

  /**
   * Get model configuration by name
   */
  getModelConfig(modelName: string): ModelConfig | null {
    return this.modelConfigs.get(modelName.toLowerCase()) || null;
  }

  /**
   * Generate default headers for a request
   */
  getDefaultHeaders(
    providerName: string,
    options: {
      policyProfile?: string;
      dataClass?: string;
      sovereignMode?: string;
      noTrain?: boolean;
      noRetain?: boolean;
      customHeaders?: Record<string, string>;
    } = {},
  ): RequestHeaders {
    const provider = this.getProviderConfig(providerName);
    const defaultHeaders = provider?.defaultHeaders || {};

    const headers: RequestHeaders = {
      'X-Policy-Profile': options.policyProfile || 'standard',
      'X-Data-Class': options.dataClass || 'public',
      'X-Sovereign-Mode': options.sovereignMode || 'false',
      ...defaultHeaders,
    };

    // Add no-train/no-retain headers if supported and requested
    if (provider?.features.supportsNoTrain && options.noTrain !== false) {
      headers['X-No-Train'] = 'true';
    }

    if (provider?.features.supportsNoRetain && options.noRetain) {
      headers['X-No-Retain'] = 'true';
    }

    // Merge custom headers
    if (options.customHeaders) {
      Object.assign(headers, options.customHeaders);
    }

    return headers;
  }

  /**
   * Get timeout configuration for a provider
   */
  getTimeout(providerName: string): number {
    const provider = this.getProviderConfig(providerName);
    return provider?.timeout || 30000; // Default 30 seconds
  }

  /**
   * Get retry configuration for a provider
   */
  getRetryConfig(providerName: string): { attempts: number; delay: number } {
    const provider = this.getProviderConfig(providerName);
    return {
      attempts: provider?.retryAttempts || 3,
      delay: provider?.retryDelay || 1000,
    };
  }

  /**
   * Check if provider supports a specific feature
   */
  supportsFeature(
    providerName: string,
    feature: keyof ProviderConfig['features'],
  ): boolean {
    const provider = this.getProviderConfig(providerName);
    return provider?.features[feature] || false;
  }

  /**
   * Get rate limit information for a provider
   */
  getRateLimits(
    providerName: string,
  ): { requestsPerMinute: number; tokensPerMinute: number } | null {
    const provider = this.getProviderConfig(providerName);
    return provider?.rateLimits || null;
  }

  /**
   * Update provider configuration (for dynamic configuration)
   */
  updateProviderConfig(
    providerName: string,
    updates: Partial<ProviderConfig>,
  ): void {
    const existing = this.getProviderConfig(providerName);
    if (existing) {
      const updated = { ...existing, ...updates };
      this.providerConfigs.set(providerName.toLowerCase(), updated);
      this.logger.log(`Updated configuration for provider: ${providerName}`);
    } else {
      this.logger.warn(
        `Attempted to update non-existent provider: ${providerName}`,
      );
    }
  }

  /**
   * Add or update model configuration
   */
  setModelConfig(modelName: string, config: ModelConfig): void {
    this.modelConfigs.set(modelName.toLowerCase(), config);
    this.logger.debug(`Set configuration for model: ${modelName}`);
  }

  /**
   * Get all available providers
   */
  getAvailableProviders(): string[] {
    return Array.from(this.providerConfigs.keys());
  }

  /**
   * Get provider configuration with environment variable overrides
   */
  getEnhancedProviderConfig(providerName: string): ProviderConfig | null {
    const baseConfig = this.getProviderConfig(providerName);
    if (!baseConfig) return null;

    // Apply environment variable overrides
    const envPrefix = providerName.toUpperCase();
    const enhanced = { ...baseConfig };

    // Override API key from environment
    const envApiKey = process.env[`${envPrefix}_API_KEY`];
    if (envApiKey) {
      enhanced.apiKey = envApiKey;
    }

    // Override base URL from environment
    const envBaseUrl = process.env[`${envPrefix}_BASE_URL`];
    if (envBaseUrl) {
      enhanced.baseUrl = envBaseUrl;
    }

    // Override timeout from environment
    const envTimeout = process.env[`${envPrefix}_TIMEOUT`];
    if (envTimeout) {
      enhanced.timeout = parseInt(envTimeout, 10);
    }

    return enhanced;
  }

  /**
   * Validate provider configuration
   *
   * Checks that all required configuration is present and valid.
   * Throws clear errors with actionable guidance.
   *
   * @param providerName - Name of the provider to validate
   * @returns Validation result with errors array
   *
   * @example
   * ```typescript
   * const result = providerConfigService.validateProviderConfig('ollama');
   * if (!result.valid) {
   *   console.error('Configuration errors:', result.errors);
   *   // Errors include actionable guidance
   * }
   * ```
   *
   * @see docs/TROUBLESHOOTING.md for common configuration issues
   * @see GETTING_STARTED.md for initial setup
   */
  validateProviderConfig(providerName: string): {
    valid: boolean;
    errors: string[];
  } {
    const config = this.getEnhancedProviderConfig(providerName);
    const errors: string[] = [];

    if (!config) {
      errors.push(
        `Provider '${providerName}' not found. ` +
          `Available providers: ${this.getAvailableProviders().join(', ')}. ` +
          `See GETTING_STARTED.md for configuration help.`,
      );
      return { valid: false, errors };
    }

    // Check required fields
    if (!config.baseUrl) {
      errors.push(
        `Base URL is required for provider '${providerName}'. ` +
          `Set ${providerName.toUpperCase()}_BASE_URL in your .env file. ` +
          `See GETTING_STARTED.md for setup instructions.`,
      );
    }

    // API key validation: required for external providers and Ollama Cloud
    if (providerName === 'ollama') {
      // Ollama local: no API key needed, but verify it's accessible
      // This check happens at runtime, not here
    } else if (providerName === 'ollama-cloud') {
      // Ollama cloud: API key required
      if (!config.apiKey) {
        errors.push(
          `API key is required for Ollama Cloud mode. ` +
            `Set OLLAMA_CLOUD_API_KEY in your .env file. ` +
            `Get your API key at https://ollama.com`,
        );
      }
    } else if (!config.apiKey) {
      // Other providers: always require API key
      const envVarName = `${providerName.toUpperCase()}_API_KEY`;
      errors.push(
        `API key is required for provider '${providerName}'. ` +
          `Set ${envVarName} in your .env file. ` +
          `See GETTING_STARTED.md for API key configuration. ` +
          `Run 'npm run diagnostics' to check your configuration.`,
      );
    }

    if (config.timeout < 1000) {
      errors.push(
        `Timeout must be at least 1000ms for provider '${providerName}'. ` +
          `Current: ${config.timeout}ms. ` +
          `Update ${providerName.toUpperCase()}_TIMEOUT in .env if needed.`,
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get service statistics
   */
  getStats(): {
    totalProviders: number;
    totalModels: number;
    localProviders: number;
    externalProviders: number;
  } {
    const providers = Array.from(this.providerConfigs.values());
    // Local providers: only 'Ollama' (not 'Ollama Cloud')
    const localProviderNames = ['Ollama'];

    return {
      totalProviders: providers.length,
      totalModels: this.modelConfigs.size,
      localProviders: providers.filter((p) =>
        localProviderNames.includes(p.name),
      ).length,
      externalProviders: providers.filter(
        (p) => !localProviderNames.includes(p.name),
      ).length,
    };
  }

  /**
   * Check if a provider is cloud mode
   * @param providerName The provider name to check
   * @returns true if provider is 'ollama-cloud', false otherwise
   */
  isOllamaCloudMode(providerName?: string): boolean {
    return providerName === 'ollama-cloud';
  }
}
