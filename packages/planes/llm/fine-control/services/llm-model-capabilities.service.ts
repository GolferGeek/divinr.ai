import { Logger } from '@nestjs/common';
import { LLMServiceConfig } from './llm-interfaces';

/**
 * Model-specific capability and restriction definitions
 */
interface ModelCapabilities {
  supportsTemperature: boolean;
  temperatureRange?: { min: number; max: number };
  defaultTemperature?: number;
  supportsMaxTokens: boolean;
  maxTokensLimit?: number;
  supportsStreaming: boolean;
  supportsFunctionCalling: boolean;
  supportsSystemMessages: boolean; // New capability for o1 models
  // Add more capabilities as needed
}

/**
 * Provider-specific model capabilities
 */
const MODEL_CAPABILITIES: Record<string, Record<string, ModelCapabilities>> = {
  openai: {
    // o1 series models - very restricted
    'o1-preview': {
      supportsTemperature: false,
      defaultTemperature: 1.0,
      supportsMaxTokens: true,
      maxTokensLimit: 32768,
      supportsStreaming: false,
      supportsFunctionCalling: false,
      supportsSystemMessages: false, // o1 models don't support system messages
    },
    'o1-mini': {
      supportsTemperature: false,
      defaultTemperature: 1.0,
      supportsMaxTokens: true,
      maxTokensLimit: 65536,
      supportsStreaming: false,
      supportsFunctionCalling: false,
      supportsSystemMessages: false, // o1 models don't support system messages
    },
    'o4-mini': {
      supportsTemperature: false,
      defaultTemperature: 1.0,
      supportsMaxTokens: true,
      maxTokensLimit: 65536,
      supportsStreaming: false,
      supportsFunctionCalling: false,
      supportsSystemMessages: false, // Assuming similar restrictions to o1
    },
    // GPT-4 series - full capabilities
    'gpt-4': {
      supportsTemperature: true,
      temperatureRange: { min: 0.0, max: 2.0 },
      defaultTemperature: 1.0,
      supportsMaxTokens: true,
      maxTokensLimit: 8192,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsSystemMessages: true,
    },
    'gpt-4-turbo': {
      supportsTemperature: true,
      temperatureRange: { min: 0.0, max: 2.0 },
      defaultTemperature: 1.0,
      supportsMaxTokens: true,
      maxTokensLimit: 4096,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsSystemMessages: true,
    },
    'gpt-4o': {
      supportsTemperature: true,
      temperatureRange: { min: 0.0, max: 2.0 },
      defaultTemperature: 1.0,
      supportsMaxTokens: true,
      maxTokensLimit: 4096,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsSystemMessages: true,
    },
    'gpt-4o-mini': {
      supportsTemperature: true,
      temperatureRange: { min: 0.0, max: 2.0 },
      defaultTemperature: 1.0,
      supportsMaxTokens: true,
      maxTokensLimit: 16384,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsSystemMessages: true,
    },
    // GPT-3.5 series
    'gpt-3.5-turbo': {
      supportsTemperature: true,
      temperatureRange: { min: 0.0, max: 2.0 },
      defaultTemperature: 1.0,
      supportsMaxTokens: true,
      maxTokensLimit: 4096,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsSystemMessages: true,
    },
  },
  anthropic: {
    // Claude models - generally support temperature
    'claude-3-5-sonnet-20241022': {
      supportsTemperature: true,
      temperatureRange: { min: 0.0, max: 1.0 },
      defaultTemperature: 1.0,
      supportsMaxTokens: true,
      maxTokensLimit: 8192,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsSystemMessages: true,
    },
    'claude-3-5-haiku-20241022': {
      supportsTemperature: true,
      temperatureRange: { min: 0.0, max: 1.0 },
      defaultTemperature: 1.0,
      supportsMaxTokens: true,
      maxTokensLimit: 8192,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsSystemMessages: true,
    },
  },
  ollama: {
    // Ollama models - generally support temperature
    default: {
      supportsTemperature: true,
      temperatureRange: { min: 0.0, max: 2.0 },
      defaultTemperature: 0.8,
      supportsMaxTokens: true,
      supportsStreaming: true,
      supportsFunctionCalling: false,
      supportsSystemMessages: true,
    },
  },
  google: {
    // Gemini models
    'gemini-pro': {
      supportsTemperature: true,
      temperatureRange: { min: 0.0, max: 1.0 },
      defaultTemperature: 0.9,
      supportsMaxTokens: true,
      maxTokensLimit: 2048,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsSystemMessages: true,
    },
  },
};

/**
 * Utility class for handling model-specific capabilities and parameter normalization
 * Static methods to avoid circular dependencies with LLMServiceFactory
 */
export class LLMModelCapabilities {
  private static readonly logger = new Logger(LLMModelCapabilities.name);

  /**
   * Get capabilities for a specific provider/model combination
   */
  static getModelCapabilities(
    provider: string,
    model: string,
  ): ModelCapabilities {
    const normalizedProvider = provider.toLowerCase();
    const providerCapabilities = MODEL_CAPABILITIES[normalizedProvider];

    if (!providerCapabilities) {
      this.logger.warn(
        `Unknown provider: ${provider}, using default capabilities`,
      );
      return this.getDefaultCapabilities();
    }

    // Try exact model match first
    if (providerCapabilities[model]) {
      return providerCapabilities[model];
    }

    // Try pattern matching for model families
    const modelKey = this.findModelPattern(providerCapabilities, model);
    if (modelKey && providerCapabilities[modelKey]) {
      return providerCapabilities[modelKey];
    }

    // Fall back to default for provider if available
    if (providerCapabilities['default']) {
      return providerCapabilities['default'];
    }

    this.logger.warn(
      `Unknown model: ${model} for provider: ${provider}, using default capabilities`,
    );
    return this.getDefaultCapabilities();
  }

  /**
   * Normalize and validate LLM configuration based on model capabilities
   */
  static normalizeConfig(config: LLMServiceConfig): LLMServiceConfig {
    const capabilities = this.getModelCapabilities(
      config.provider,
      config.model,
    );
    const normalizedConfig = { ...config };

    // Handle temperature restrictions
    if (!capabilities.supportsTemperature) {
      if (normalizedConfig.temperature !== undefined) {
        delete normalizedConfig.temperature;
      }
    } else if (normalizedConfig.temperature !== undefined) {
      // Validate temperature range
      if (capabilities.temperatureRange) {
        const { min, max } = capabilities.temperatureRange;
        if (
          normalizedConfig.temperature < min ||
          normalizedConfig.temperature > max
        ) {
          this.logger.warn(
            `Temperature ${normalizedConfig.temperature} out of range [${min}, ${max}] for ${config.model}, clamping`,
          );
          normalizedConfig.temperature = Math.max(
            min,
            Math.min(max, normalizedConfig.temperature),
          );
        }
      }
    }

    // Handle max tokens restrictions
    if (capabilities.maxTokensLimit && normalizedConfig.maxTokens) {
      if (normalizedConfig.maxTokens > capabilities.maxTokensLimit) {
        this.logger.warn(
          `MaxTokens ${normalizedConfig.maxTokens} exceeds limit ${capabilities.maxTokensLimit} for ${config.model}, clamping`,
        );
        normalizedConfig.maxTokens = capabilities.maxTokensLimit;
      }
    }

    return normalizedConfig;
  }

  /**
   * Check if a model supports a specific capability
   */
  static supportsCapability(
    provider: string,
    model: string,
    capability: keyof ModelCapabilities,
  ): boolean {
    const capabilities = this.getModelCapabilities(provider, model);
    return capabilities[capability] as boolean;
  }

  /**
   * Transform system and user messages for models that don't support system messages
   * For o1 models: combine system prompt with user message
   */
  static transformMessagesForModel(
    provider: string,
    model: string,
    systemPrompt: string,
    userMessage: string,
  ): { systemPrompt?: string; userMessage: string } {
    const capabilities = this.getModelCapabilities(provider, model);

    if (!capabilities.supportsSystemMessages) {
      // For models that don't support system messages, prepend system prompt to user message

      return {
        systemPrompt: undefined, // Remove system prompt
        userMessage: `${systemPrompt}\n\n${userMessage}`, // Combine into user message
      };
    }

    // For models that support system messages, return as-is
    return {
      systemPrompt,
      userMessage,
    };
  }

  /**
   * Get the default temperature for a model (if temperature is supported)
   */
  static getDefaultTemperature(
    provider: string,
    model: string,
  ): number | undefined {
    const capabilities = this.getModelCapabilities(provider, model);
    return capabilities.supportsTemperature
      ? capabilities.defaultTemperature
      : undefined;
  }

  /**
   * Find matching model pattern in provider capabilities
   */
  private static findModelPattern(
    providerCapabilities: Record<string, ModelCapabilities>,
    model: string,
  ): string | null {
    // Check for exact matches first
    if (providerCapabilities[model]) {
      return model;
    }

    // Special handling for o-series models (o1-*, o4-*, etc.) - assume temperature restrictions
    if (model.match(/^o\d+(-\w+)?$/)) {
      // If we have o1-mini config and this is another o-series model, use o1-mini as template
      if (providerCapabilities['o1-mini']) {
        return 'o1-mini';
      }
    }

    // Check for pattern matches (e.g., o1-* models)
    for (const pattern of Object.keys(providerCapabilities)) {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        if (regex.test(model)) {
          return pattern;
        }
      }

      // Check for prefix matches (e.g., gpt-4 matches gpt-4-0314)
      if (model.startsWith(pattern)) {
        return pattern;
      }
    }

    return null;
  }

  /**
   * Get default capabilities for unknown models
   */
  private static getDefaultCapabilities(): ModelCapabilities {
    return {
      supportsTemperature: true,
      temperatureRange: { min: 0.0, max: 2.0 },
      defaultTemperature: 1.0,
      supportsMaxTokens: true,
      supportsStreaming: true,
      supportsFunctionCalling: false,
      supportsSystemMessages: true, // Most models support system messages
    };
  }
}
