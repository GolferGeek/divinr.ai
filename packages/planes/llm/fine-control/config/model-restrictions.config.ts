/**
 * Model-specific restrictions and quirks configuration
 *
 * This configuration defines known restrictions, limitations, and special handling
 * requirements for different LLM models. This approach keeps model-specific logic
 * centralized and easily maintainable.
 */

export interface ModelRestriction {
  temperature?: {
    supported: boolean;
    default?: number;
    min?: number;
    max?: number;
    reason?: string;
  };
  systemMessages?: {
    supported: boolean;
    workaround?: 'combine_with_user' | 'prepend_to_user' | 'none';
    reason?: string;
  };
  maxTokensField?: {
    fieldName: 'max_tokens' | 'max_completion_tokens' | 'maxOutputTokens';
    reason?: string;
  };
  streaming?: {
    supported: boolean;
    reason?: string;
  };
  functionCalling?: {
    supported: boolean;
    reason?: string;
  };
  minCompletionTokens?: number; // Minimum tokens required for model to generate response
  // Add more restrictions as needed
}

export interface ModelConfig {
  provider: string;
  models: {
    [modelName: string]: ModelRestriction;
  };
}

/**
 * OpenAI Model Configurations
 */
const openAIConfig: ModelConfig = {
  provider: 'openai',
  models: {
    // GPT-5 series (requires higher token minimums)
    'gpt-5': {
      temperature: {
        supported: false,
        default: 1.0,
        reason: 'GPT-5 models do not support temperature parameter',
      },
      systemMessages: {
        supported: false,
        workaround: 'combine_with_user',
        reason: 'GPT-5 models do not support system role messages',
      },
      maxTokensField: {
        fieldName: 'max_completion_tokens',
        reason: 'Uses max_completion_tokens instead of max_tokens',
      },
      // GPT-5 seems to require a minimum number of completion tokens
      minCompletionTokens: 4000,
    },

    // o1 series models
    'o1-preview': {
      temperature: {
        supported: false,
        default: 1.0,
        reason: 'o1 models do not support temperature parameter',
      },
      systemMessages: {
        supported: false,
        workaround: 'combine_with_user',
        reason: 'o1 models do not support system role messages',
      },
      maxTokensField: {
        fieldName: 'max_completion_tokens',
        reason: 'Uses max_completion_tokens instead of max_tokens',
      },
      streaming: {
        supported: false,
        reason: 'o1 models do not support streaming',
      },
    },

    'o1-mini': {
      temperature: {
        supported: false,
        default: 1.0,
        reason: 'o1 models do not support temperature parameter',
      },
      systemMessages: {
        supported: false,
        workaround: 'combine_with_user',
        reason: 'o1 models do not support system role messages',
      },
      maxTokensField: {
        fieldName: 'max_completion_tokens',
        reason: 'Uses max_completion_tokens instead of max_tokens',
      },
      streaming: {
        supported: false,
        reason: 'o1 models do not support streaming',
      },
    },

    // o4 series (hypothetical)
    'o4-mini': {
      temperature: {
        supported: false,
        default: 1.0,
        reason: 'o4 models do not support temperature parameter',
      },
      systemMessages: {
        supported: false,
        workaround: 'combine_with_user',
        reason: 'o4 models do not support system role messages',
      },
      maxTokensField: {
        fieldName: 'max_completion_tokens',
        reason: 'Uses max_completion_tokens instead of max_tokens',
      },
    },

    // GPT-4 series - standard models with full support
    'gpt-4': {
      temperature: {
        supported: true,
        min: 0,
        max: 2,
        default: 0.7,
      },
      systemMessages: {
        supported: true,
      },
      maxTokensField: {
        fieldName: 'max_tokens',
      },
      functionCalling: {
        supported: true,
      },
    },

    'gpt-4-turbo': {
      temperature: {
        supported: true,
        min: 0,
        max: 2,
        default: 0.7,
      },
      systemMessages: {
        supported: true,
      },
      maxTokensField: {
        fieldName: 'max_tokens',
      },
      functionCalling: {
        supported: true,
      },
    },

    'gpt-4o': {
      temperature: {
        supported: true,
        min: 0,
        max: 2,
        default: 0.7,
      },
      systemMessages: {
        supported: true,
      },
      maxTokensField: {
        fieldName: 'max_tokens',
      },
      functionCalling: {
        supported: true,
      },
    },

    'gpt-4o-mini': {
      temperature: {
        supported: true,
        min: 0,
        max: 2,
        default: 0.7,
      },
      systemMessages: {
        supported: true,
      },
      maxTokensField: {
        fieldName: 'max_tokens',
      },
      functionCalling: {
        supported: true,
      },
    },

    // ChatGPT latest
    'chatgpt-4o-latest': {
      temperature: {
        supported: true,
        min: 0,
        max: 2,
        default: 0.7,
      },
      systemMessages: {
        supported: true,
      },
      maxTokensField: {
        fieldName: 'max_completion_tokens',
        reason: 'Latest ChatGPT models use max_completion_tokens',
      },
      functionCalling: {
        supported: true,
      },
    },

    // GPT-3.5 series
    'gpt-3.5-turbo': {
      temperature: {
        supported: true,
        min: 0,
        max: 2,
        default: 0.7,
      },
      systemMessages: {
        supported: true,
      },
      maxTokensField: {
        fieldName: 'max_tokens',
      },
      functionCalling: {
        supported: true,
      },
    },
  },
};

/**
 * Anthropic Model Configurations
 */
const anthropicConfig: ModelConfig = {
  provider: 'anthropic',
  models: {
    // Claude 4.5 series (Latest - October 2025)
    'claude-opus-4-5-20251101': {
      temperature: {
        supported: true,
        min: 0,
        max: 1,
        default: 0.3,
      },
      systemMessages: {
        supported: true,
      },
      maxTokensField: {
        fieldName: 'max_tokens',
      },
    },
    'claude-sonnet-4-5-20250929': {
      temperature: {
        supported: true,
        min: 0,
        max: 1,
        default: 0.3,
      },
      systemMessages: {
        supported: true,
      },
      maxTokensField: {
        fieldName: 'max_tokens',
      },
    },
    // Claude 4 series
    'claude-opus-4-1-20250805': {
      temperature: {
        supported: true,
        min: 0,
        max: 1,
        default: 0.3,
      },
      systemMessages: {
        supported: true,
      },
      maxTokensField: {
        fieldName: 'max_tokens',
      },
    },
    'claude-sonnet-4-20250514': {
      temperature: {
        supported: true,
        min: 0,
        max: 1,
        default: 0.3,
      },
      systemMessages: {
        supported: true,
      },
      maxTokensField: {
        fieldName: 'max_tokens',
      },
    },
    'claude-3-5-sonnet-20241022': {
      temperature: {
        supported: true,
        min: 0,
        max: 1,
        default: 0.3,
      },
      systemMessages: {
        supported: true,
      },
      maxTokensField: {
        fieldName: 'max_tokens',
      },
    },
    'claude-3-5-haiku-20241022': {
      temperature: {
        supported: true,
        min: 0,
        max: 1,
        default: 0.3,
      },
      systemMessages: {
        supported: true,
      },
      maxTokensField: {
        fieldName: 'max_tokens',
      },
    },
  },
};

/**
 * Model Restrictions Registry
 * Add new providers and their model configurations here
 */
export const MODEL_RESTRICTIONS: ModelConfig[] = [
  openAIConfig,
  anthropicConfig,
  // Add more providers as needed
];

/**
 * Helper function to get restrictions for a specific model
 */
export function getModelRestrictions(
  provider: string,
  modelName: string,
): ModelRestriction | null {
  const providerConfig = MODEL_RESTRICTIONS.find(
    (config) => config.provider === provider,
  );
  if (!providerConfig) {
    return null;
  }

  // Check for exact match
  if (providerConfig.models[modelName]) {
    return providerConfig.models[modelName];
  }

  // Check for partial match (e.g., 'gpt-5' matches 'gpt-5-turbo')
  const modelKey = Object.keys(providerConfig.models).find((key) =>
    modelName.startsWith(key),
  );
  if (modelKey) {
    return providerConfig.models[modelKey] || null;
  }

  return null;
}

/**
 * Helper function to check if a model supports a specific feature
 */
export function modelSupports(
  provider: string,
  modelName: string,
  feature: keyof ModelRestriction,
): boolean {
  const restrictions = getModelRestrictions(provider, modelName);
  if (!restrictions || !restrictions[feature]) {
    // If no restrictions defined, assume full support
    return true;
  }

  const featureConfig = restrictions[feature];
  // Type guard to check if the feature has a 'supported' property
  if (
    featureConfig &&
    typeof featureConfig === 'object' &&
    'supported' in featureConfig
  ) {
    return featureConfig.supported !== false;
  }

  // For features without explicit 'supported' field, assume they're supported
  return true;
}

/**
 * Helper function to apply model restrictions to config
 */
export function applyModelRestrictions(
  provider: string,
  modelName: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const restrictions = getModelRestrictions(provider, modelName);
  if (!restrictions) {
    return config;
  }

  const adjustedConfig = { ...config };

  // Handle temperature restrictions
  if (restrictions.temperature && !restrictions.temperature.supported) {
    delete adjustedConfig.temperature;
  } else if (
    restrictions.temperature &&
    adjustedConfig.temperature !== undefined &&
    adjustedConfig.temperature !== null
  ) {
    // Clamp temperature to valid range
    const min = restrictions.temperature.min ?? 0;
    const max = restrictions.temperature.max ?? 2;
    adjustedConfig.temperature = Math.max(
      min,
      Math.min(max, adjustedConfig.temperature as number),
    );
  }

  // Add more restriction handling as needed

  return adjustedConfig;
}
