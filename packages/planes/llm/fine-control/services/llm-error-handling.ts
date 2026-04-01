/**
 * Comprehensive LLM Error Handling System
 *
 * This module provides standardized error types, codes, and handling mechanisms
 * across all LLM provider services to ensure consistent error reporting,
 * user-friendly messages, and proper retry logic.
 */

import { Logger } from '@nestjs/common';

/**
 * Standard LLM error types that map to common error scenarios
 * across all providers
 */
export enum LLMErrorType {
  // Authentication and authorization errors
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  API_KEY_INVALID = 'api_key_invalid',
  API_KEY_MISSING = 'api_key_missing',

  // Rate limiting and quota errors
  RATE_LIMIT = 'rate_limit',
  QUOTA_EXCEEDED = 'quota_exceeded',
  DAILY_LIMIT_EXCEEDED = 'daily_limit_exceeded',
  MONTHLY_LIMIT_EXCEEDED = 'monthly_limit_exceeded',

  // Request validation errors
  INVALID_REQUEST = 'invalid_request',
  MISSING_PARAMETERS = 'missing_parameters',
  INVALID_PARAMETERS = 'invalid_parameters',
  MALFORMED_REQUEST = 'malformed_request',

  // Model and provider errors
  MODEL_NOT_FOUND = 'model_not_found',
  MODEL_UNAVAILABLE = 'model_unavailable',
  UNSUPPORTED_MODEL = 'unsupported_model',
  PROVIDER_UNAVAILABLE = 'provider_unavailable',

  // Content and safety errors
  CONTENT_FILTER = 'content_filter',
  SAFETY_VIOLATION = 'safety_violation',
  INAPPROPRIATE_CONTENT = 'inappropriate_content',
  HARMFUL_CONTENT = 'harmful_content',

  // Context and token errors
  CONTEXT_LENGTH_EXCEEDED = 'context_length_exceeded',
  TOKEN_LIMIT_EXCEEDED = 'token_limit_exceeded',
  INPUT_TOO_LONG = 'input_too_long',
  OUTPUT_TOO_LONG = 'output_too_long',

  // Network and service errors
  NETWORK_ERROR = 'network_error',
  CONNECTION_TIMEOUT = 'connection_timeout',
  SERVICE_UNAVAILABLE = 'service_unavailable',
  SERVER_ERROR = 'server_error',
  GATEWAY_TIMEOUT = 'gateway_timeout',

  // Configuration errors
  CONFIGURATION_ERROR = 'configuration_error',
  INVALID_CONFIGURATION = 'invalid_configuration',
  MISSING_CONFIGURATION = 'missing_configuration',

  // Processing errors
  PROCESSING_ERROR = 'processing_error',
  PII_PROCESSING_ERROR = 'pii_processing_error',
  RESPONSE_PARSING_ERROR = 'response_parsing_error',

  // Generic errors
  UNKNOWN = 'unknown',
  INTERNAL_ERROR = 'internal_error',
}

/**
 * Error severity levels for prioritizing error handling
 */
export enum LLMErrorSeverity {
  LOW = 'low', // Minor issues, system can continue
  MEDIUM = 'medium', // Notable issues, may affect user experience
  HIGH = 'high', // Significant issues, likely to block user
  CRITICAL = 'critical', // System-level issues, requires immediate attention
}

/**
 * Error category for grouping related error types
 */
export enum LLMErrorCategory {
  CLIENT = 'client', // Client-side errors (4xx)
  SERVER = 'server', // Server-side errors (5xx)
  NETWORK = 'network', // Network connectivity issues
  CONFIGURATION = 'configuration', // Configuration problems
  VALIDATION = 'validation', // Input validation errors
  SECURITY = 'security', // Security and safety errors
  RESOURCE = 'resource', // Resource limits and availability
}

/**
 * Standardized LLM error class with rich metadata
 */
export class LLMError extends Error {
  public readonly type: LLMErrorType;
  public readonly code: string;
  public readonly provider: string;
  public readonly model?: string;
  public readonly severity: LLMErrorSeverity;
  public readonly category: LLMErrorCategory;
  public readonly retryable: boolean;
  public readonly retryAfterMs?: number;
  public readonly originalError?: unknown;
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: string;
  public readonly requestId?: string;

  constructor(
    message: string,
    type: LLMErrorType,
    provider: string,
    options: {
      model?: string;
      severity?: LLMErrorSeverity;
      category?: LLMErrorCategory;
      retryable?: boolean;
      retryAfterMs?: number;
      originalError?: unknown;
      context?: Record<string, unknown>;
      requestId?: string;
    } = {},
  ) {
    super(message);
    this.name = 'LLMError';
    this.type = type;
    this.code = this.generateErrorCode(type, provider);
    this.provider = provider;
    this.model = options.model;
    this.severity = options.severity || this.getDefaultSeverity(type);
    this.category = options.category || this.getDefaultCategory(type);
    this.retryable = options.retryable ?? this.getDefaultRetryable(type);
    this.retryAfterMs = options.retryAfterMs;
    this.originalError = options.originalError;
    this.context = options.context;
    this.timestamp = new Date().toISOString();
    this.requestId = options.requestId;
  }

  /**
   * Generate a unique error code based on type and provider
   */
  private generateErrorCode(type: LLMErrorType, provider: string): string {
    const providerPrefix = provider
      ? provider.toUpperCase().substring(0, 3)
      : 'UNK';
    const typeCode = type.toUpperCase().replace(/_/g, '');
    return `${providerPrefix}_${typeCode}`;
  }

  /**
   * Get default severity for error type
   */
  private getDefaultSeverity(type: LLMErrorType): LLMErrorSeverity {
    const severityMap: Record<LLMErrorType, LLMErrorSeverity> = {
      [LLMErrorType.AUTHENTICATION]: LLMErrorSeverity.HIGH,
      [LLMErrorType.AUTHORIZATION]: LLMErrorSeverity.HIGH,
      [LLMErrorType.API_KEY_INVALID]: LLMErrorSeverity.CRITICAL,
      [LLMErrorType.API_KEY_MISSING]: LLMErrorSeverity.CRITICAL,
      [LLMErrorType.RATE_LIMIT]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.QUOTA_EXCEEDED]: LLMErrorSeverity.HIGH,
      [LLMErrorType.DAILY_LIMIT_EXCEEDED]: LLMErrorSeverity.HIGH,
      [LLMErrorType.MONTHLY_LIMIT_EXCEEDED]: LLMErrorSeverity.CRITICAL,
      [LLMErrorType.INVALID_REQUEST]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.MISSING_PARAMETERS]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.INVALID_PARAMETERS]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.MALFORMED_REQUEST]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.MODEL_NOT_FOUND]: LLMErrorSeverity.HIGH,
      [LLMErrorType.MODEL_UNAVAILABLE]: LLMErrorSeverity.HIGH,
      [LLMErrorType.UNSUPPORTED_MODEL]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.PROVIDER_UNAVAILABLE]: LLMErrorSeverity.CRITICAL,
      [LLMErrorType.CONTENT_FILTER]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.SAFETY_VIOLATION]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.INAPPROPRIATE_CONTENT]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.HARMFUL_CONTENT]: LLMErrorSeverity.HIGH,
      [LLMErrorType.CONTEXT_LENGTH_EXCEEDED]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.TOKEN_LIMIT_EXCEEDED]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.INPUT_TOO_LONG]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.OUTPUT_TOO_LONG]: LLMErrorSeverity.LOW,
      [LLMErrorType.NETWORK_ERROR]: LLMErrorSeverity.HIGH,
      [LLMErrorType.CONNECTION_TIMEOUT]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.SERVICE_UNAVAILABLE]: LLMErrorSeverity.HIGH,
      [LLMErrorType.SERVER_ERROR]: LLMErrorSeverity.HIGH,
      [LLMErrorType.GATEWAY_TIMEOUT]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.CONFIGURATION_ERROR]: LLMErrorSeverity.CRITICAL,
      [LLMErrorType.INVALID_CONFIGURATION]: LLMErrorSeverity.CRITICAL,
      [LLMErrorType.MISSING_CONFIGURATION]: LLMErrorSeverity.CRITICAL,
      [LLMErrorType.PROCESSING_ERROR]: LLMErrorSeverity.HIGH,
      [LLMErrorType.PII_PROCESSING_ERROR]: LLMErrorSeverity.HIGH,
      [LLMErrorType.RESPONSE_PARSING_ERROR]: LLMErrorSeverity.HIGH,
      [LLMErrorType.UNKNOWN]: LLMErrorSeverity.MEDIUM,
      [LLMErrorType.INTERNAL_ERROR]: LLMErrorSeverity.HIGH,
    };

    return severityMap[type] || LLMErrorSeverity.MEDIUM;
  }

  /**
   * Get default category for error type
   */
  private getDefaultCategory(type: LLMErrorType): LLMErrorCategory {
    const categoryMap: Record<LLMErrorType, LLMErrorCategory> = {
      [LLMErrorType.AUTHENTICATION]: LLMErrorCategory.CLIENT,
      [LLMErrorType.AUTHORIZATION]: LLMErrorCategory.CLIENT,
      [LLMErrorType.API_KEY_INVALID]: LLMErrorCategory.CLIENT,
      [LLMErrorType.API_KEY_MISSING]: LLMErrorCategory.CLIENT,
      [LLMErrorType.RATE_LIMIT]: LLMErrorCategory.RESOURCE,
      [LLMErrorType.QUOTA_EXCEEDED]: LLMErrorCategory.RESOURCE,
      [LLMErrorType.DAILY_LIMIT_EXCEEDED]: LLMErrorCategory.RESOURCE,
      [LLMErrorType.MONTHLY_LIMIT_EXCEEDED]: LLMErrorCategory.RESOURCE,
      [LLMErrorType.INVALID_REQUEST]: LLMErrorCategory.VALIDATION,
      [LLMErrorType.MISSING_PARAMETERS]: LLMErrorCategory.VALIDATION,
      [LLMErrorType.INVALID_PARAMETERS]: LLMErrorCategory.VALIDATION,
      [LLMErrorType.MALFORMED_REQUEST]: LLMErrorCategory.VALIDATION,
      [LLMErrorType.MODEL_NOT_FOUND]: LLMErrorCategory.CLIENT,
      [LLMErrorType.MODEL_UNAVAILABLE]: LLMErrorCategory.SERVER,
      [LLMErrorType.UNSUPPORTED_MODEL]: LLMErrorCategory.CLIENT,
      [LLMErrorType.PROVIDER_UNAVAILABLE]: LLMErrorCategory.SERVER,
      [LLMErrorType.CONTENT_FILTER]: LLMErrorCategory.SECURITY,
      [LLMErrorType.SAFETY_VIOLATION]: LLMErrorCategory.SECURITY,
      [LLMErrorType.INAPPROPRIATE_CONTENT]: LLMErrorCategory.SECURITY,
      [LLMErrorType.HARMFUL_CONTENT]: LLMErrorCategory.SECURITY,
      [LLMErrorType.CONTEXT_LENGTH_EXCEEDED]: LLMErrorCategory.VALIDATION,
      [LLMErrorType.TOKEN_LIMIT_EXCEEDED]: LLMErrorCategory.VALIDATION,
      [LLMErrorType.INPUT_TOO_LONG]: LLMErrorCategory.VALIDATION,
      [LLMErrorType.OUTPUT_TOO_LONG]: LLMErrorCategory.VALIDATION,
      [LLMErrorType.NETWORK_ERROR]: LLMErrorCategory.NETWORK,
      [LLMErrorType.CONNECTION_TIMEOUT]: LLMErrorCategory.NETWORK,
      [LLMErrorType.SERVICE_UNAVAILABLE]: LLMErrorCategory.SERVER,
      [LLMErrorType.SERVER_ERROR]: LLMErrorCategory.SERVER,
      [LLMErrorType.GATEWAY_TIMEOUT]: LLMErrorCategory.NETWORK,
      [LLMErrorType.CONFIGURATION_ERROR]: LLMErrorCategory.CONFIGURATION,
      [LLMErrorType.INVALID_CONFIGURATION]: LLMErrorCategory.CONFIGURATION,
      [LLMErrorType.MISSING_CONFIGURATION]: LLMErrorCategory.CONFIGURATION,
      [LLMErrorType.PROCESSING_ERROR]: LLMErrorCategory.SERVER,
      [LLMErrorType.PII_PROCESSING_ERROR]: LLMErrorCategory.SERVER,
      [LLMErrorType.RESPONSE_PARSING_ERROR]: LLMErrorCategory.SERVER,
      [LLMErrorType.UNKNOWN]: LLMErrorCategory.SERVER,
      [LLMErrorType.INTERNAL_ERROR]: LLMErrorCategory.SERVER,
    };

    return categoryMap[type] || LLMErrorCategory.SERVER;
  }

  /**
   * Get default retryable status for error type
   */
  private getDefaultRetryable(type: LLMErrorType): boolean {
    const retryableTypes = new Set([
      LLMErrorType.RATE_LIMIT,
      LLMErrorType.CONNECTION_TIMEOUT,
      LLMErrorType.SERVICE_UNAVAILABLE,
      LLMErrorType.GATEWAY_TIMEOUT,
      LLMErrorType.NETWORK_ERROR,
      LLMErrorType.MODEL_UNAVAILABLE,
    ]);

    return retryableTypes.has(type);
  }

  /**
   * Get user-friendly error message
   */
  public getUserFriendlyMessage(): string {
    const messageMap: Record<LLMErrorType, string> = {
      [LLMErrorType.AUTHENTICATION]:
        'Authentication failed. Please check your API credentials.',
      [LLMErrorType.AUTHORIZATION]:
        'You are not authorized to use this service.',
      [LLMErrorType.API_KEY_INVALID]:
        'The API key is invalid. Please check your configuration. See docs/TROUBLESHOOTING.md for help.',
      [LLMErrorType.API_KEY_MISSING]:
        'API key is missing. Please configure your credentials in .env file. See GETTING_STARTED.md for setup instructions.',

      [LLMErrorType.RATE_LIMIT]:
        'The service is currently busy. Please try again in a moment.',
      [LLMErrorType.QUOTA_EXCEEDED]:
        'You have reached your usage limit for this service.',
      [LLMErrorType.DAILY_LIMIT_EXCEEDED]:
        'Daily usage limit exceeded. Please try again tomorrow.',
      [LLMErrorType.MONTHLY_LIMIT_EXCEEDED]:
        'Monthly usage limit exceeded. Please upgrade your plan.',

      [LLMErrorType.INVALID_REQUEST]:
        'The request is invalid. Please check your input.',
      [LLMErrorType.MISSING_PARAMETERS]:
        'Required parameters are missing from your request.',
      [LLMErrorType.INVALID_PARAMETERS]:
        'Some parameters in your request are invalid.',
      [LLMErrorType.MALFORMED_REQUEST]: 'The request format is incorrect.',

      [LLMErrorType.MODEL_NOT_FOUND]:
        'The requested model was not found. Please select a different model. For Ollama, ensure the model is pulled: `ollama pull <model-name>`. See docs/TROUBLESHOOTING.md',
      [LLMErrorType.MODEL_UNAVAILABLE]:
        'The model is temporarily unavailable. Please try again later. For Ollama, check if the service is running: `curl http://localhost:11434/api/tags`. See docs/TROUBLESHOOTING.md',
      [LLMErrorType.UNSUPPORTED_MODEL]:
        'This model is not supported by the selected provider.',
      [LLMErrorType.PROVIDER_UNAVAILABLE]:
        'The AI service is currently unavailable. Please try again later.',

      [LLMErrorType.CONTENT_FILTER]:
        'Your content was filtered by safety systems. Please modify your input.',
      [LLMErrorType.SAFETY_VIOLATION]:
        'Your request violates safety guidelines. Please revise your input.',
      [LLMErrorType.INAPPROPRIATE_CONTENT]:
        'The content is inappropriate. Please use different language.',
      [LLMErrorType.HARMFUL_CONTENT]:
        'The content may be harmful and cannot be processed.',

      [LLMErrorType.CONTEXT_LENGTH_EXCEEDED]:
        'Your input is too long for this model. Please shorten it or use a model with larger context.',
      [LLMErrorType.TOKEN_LIMIT_EXCEEDED]:
        'Token limit exceeded. Please reduce the length of your input.',
      [LLMErrorType.INPUT_TOO_LONG]:
        'Your input is too long. Please shorten it and try again.',
      [LLMErrorType.OUTPUT_TOO_LONG]:
        'The response was too long and was truncated.',

      [LLMErrorType.NETWORK_ERROR]:
        "Network connection failed. Please check your internet connection. For Ollama, verify it's running: `curl http://localhost:11434/api/tags`. See docs/TROUBLESHOOTING.md",
      [LLMErrorType.CONNECTION_TIMEOUT]:
        'The request timed out. Please try again. For Ollama, the model may be loading - wait a moment and retry. See docs/TROUBLESHOOTING.md',
      [LLMErrorType.SERVICE_UNAVAILABLE]:
        'The AI service is temporarily unavailable. Please try again later. Run `npm run diagnostics` to check service status. See docs/TROUBLESHOOTING.md',
      [LLMErrorType.SERVER_ERROR]:
        'A server error occurred. Please try again later.',
      [LLMErrorType.GATEWAY_TIMEOUT]:
        'The request timed out at the gateway. Please try again.',

      [LLMErrorType.CONFIGURATION_ERROR]:
        'There is a configuration error. Run `npm run diagnostics` to identify issues. See docs/TROUBLESHOOTING.md for help.',
      [LLMErrorType.INVALID_CONFIGURATION]:
        'The service configuration is invalid. Check your .env file and verify all required variables are set. See GETTING_STARTED.md',
      [LLMErrorType.MISSING_CONFIGURATION]:
        'Required configuration is missing. Check your .env file matches dev.env.example. See GETTING_STARTED.md for setup instructions.',

      [LLMErrorType.PROCESSING_ERROR]:
        'An error occurred while processing your request.',
      [LLMErrorType.PII_PROCESSING_ERROR]:
        'An error occurred while processing sensitive information.',
      [LLMErrorType.RESPONSE_PARSING_ERROR]:
        'Failed to parse the response from the AI service.',

      [LLMErrorType.UNKNOWN]:
        'An unknown error occurred. Please try again later.',
      [LLMErrorType.INTERNAL_ERROR]:
        'An internal error occurred. Please contact support if this persists.',
    };

    return (
      messageMap[this.type] ||
      'An error occurred while processing your request.'
    );
  }

  /**
   * Get technical details for developers/debugging
   */
  public getTechnicalDetails(): Record<string, unknown> {
    return {
      type: this.type,
      code: this.code,
      provider: this.provider,
      model: this.model,
      severity: this.severity,
      category: this.category,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
      timestamp: this.timestamp,
      requestId: this.requestId,
      context: this.context,
      originalError: this.originalError
        ? {
            message: (this.originalError as Record<string, unknown>).message,
            code: (this.originalError as Record<string, unknown>).code,
            status: (this.originalError as Record<string, unknown>).status,
            stack: (this.originalError as Record<string, unknown>).stack,
          }
        : undefined,
    };
  }

  /**
   * Convert to JSON for logging and API responses
   */
  public toJSON(): Record<string, unknown> {
    return {
      error: true,
      message: this.message,
      userMessage: this.getUserFriendlyMessage(),
      technical: this.getTechnicalDetails(),
    };
  }
}

/**
 * Error mapping utilities for each provider
 */
export class LLMErrorMapper {
  private static readonly logger = new Logger(LLMErrorMapper.name);

  /**
   * Map OpenAI errors to standardized LLMError
   */
  static fromOpenAIError(
    error: unknown,
    provider: string = 'openai',
    model?: string,
    requestId?: string,
  ): LLMError {
    const err = error as Record<string, unknown>;
    const rawStatus =
      (err.response as Record<string, unknown> | undefined)?.status ??
      err.status;
    const status =
      typeof rawStatus === 'number'
        ? rawStatus
        : rawStatus
          ? Number.parseInt(rawStatus as string, 10)
          : NaN;
    const errorType =
      (
        (
          (err.response as Record<string, unknown> | undefined)?.data as
            | Record<string, unknown>
            | undefined
        )?.error as Record<string, unknown> | undefined
      )?.type || err.type;
    const errorCode =
      (
        (
          (err.response as Record<string, unknown> | undefined)?.data as
            | Record<string, unknown>
            | undefined
        )?.error as Record<string, unknown> | undefined
      )?.code || err.code;

    // Authentication errors
    if (Number.isFinite(status) && status === 401) {
      return new LLMError(
        'Invalid OpenAI API key',
        LLMErrorType.API_KEY_INVALID,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Rate limiting
    if (Number.isFinite(status) && status === 429) {
      const retryAfter = (
        (err.response as Record<string, unknown> | undefined)?.headers as
          | Record<string, unknown>
          | undefined
      )?.['retry-after'];
      return new LLMError(
        'OpenAI rate limit exceeded',
        LLMErrorType.RATE_LIMIT,
        provider,
        {
          model,
          originalError: error,
          requestId,
          retryAfterMs: retryAfter
            ? parseInt(retryAfter as string) * 1000
            : 60000,
        },
      );
    }

    // Quota exceeded
    if (
      Number.isFinite(status) &&
      status === 429 &&
      errorType === 'insufficient_quota'
    ) {
      return new LLMError(
        'OpenAI quota exceeded',
        LLMErrorType.QUOTA_EXCEEDED,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Invalid request
    if (Number.isFinite(status) && status === 400) {
      if (errorCode === 'context_length_exceeded') {
        return new LLMError(
          'Context length exceeded for OpenAI model',
          LLMErrorType.CONTEXT_LENGTH_EXCEEDED,
          provider,
          { model, originalError: error, requestId },
        );
      }

      return new LLMError(
        `Invalid OpenAI request: ${String(err.message)}`,
        LLMErrorType.INVALID_REQUEST,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Model not found
    if (Number.isFinite(status) && status === 404) {
      return new LLMError(
        `OpenAI model not found: ${model}`,
        LLMErrorType.MODEL_NOT_FOUND,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Server errors
    if (Number.isFinite(status) && status >= 500) {
      return new LLMError(
        'OpenAI server error',
        LLMErrorType.SERVER_ERROR,
        provider,
        { model, originalError: error, requestId, retryable: true },
      );
    }

    // Network errors
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      return new LLMError(
        'Cannot connect to OpenAI service',
        LLMErrorType.NETWORK_ERROR,
        provider,
        { model, originalError: error, requestId },
      );
    }

    if (err.code === 'ETIMEDOUT') {
      return new LLMError(
        'OpenAI request timed out',
        LLMErrorType.CONNECTION_TIMEOUT,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Unknown error
    return new LLMError(
      `Unknown OpenAI error: ${String(err.message)}`,
      LLMErrorType.UNKNOWN,
      provider,
      { model, originalError: error, requestId },
    );
  }

  /**
   * Map Anthropic errors to standardized LLMError
   */
  static fromAnthropicError(
    error: unknown,
    provider: string = 'anthropic',
    model?: string,
    requestId?: string,
  ): LLMError {
    const err = error as Record<string, unknown>;
    const rawStatus = err.status;
    const status =
      typeof rawStatus === 'number'
        ? rawStatus
        : rawStatus
          ? Number.parseInt(rawStatus as string, 10)
          : NaN;
    const errorType = (err.error as Record<string, unknown> | undefined)?.type;

    // Authentication errors
    if (Number.isFinite(status) && status === 401) {
      return new LLMError(
        'Invalid Anthropic API key',
        LLMErrorType.API_KEY_INVALID,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Rate limiting
    if (Number.isFinite(status) && status === 429) {
      return new LLMError(
        'Anthropic rate limit exceeded',
        LLMErrorType.RATE_LIMIT,
        provider,
        { model, originalError: error, requestId, retryAfterMs: 60000 },
      );
    }

    // Invalid request
    if (Number.isFinite(status) && status === 400) {
      if (errorType === 'invalid_request_error') {
        return new LLMError(
          `Invalid Anthropic request: ${String((err.error as Record<string, unknown> | undefined)?.message)}`,
          LLMErrorType.INVALID_REQUEST,
          provider,
          { model, originalError: error, requestId },
        );
      }
    }

    // Server errors
    if (Number.isFinite(status) && status >= 500) {
      return new LLMError(
        'Anthropic server error',
        LLMErrorType.SERVER_ERROR,
        provider,
        { model, originalError: error, requestId, retryable: true },
      );
    }

    // Unknown error
    return new LLMError(
      `Unknown Anthropic error: ${String(err.message)}`,
      LLMErrorType.UNKNOWN,
      provider,
      { model, originalError: error, requestId },
    );
  }

  /**
   * Map Google errors to standardized LLMError
   */
  static fromGoogleError(
    error: unknown,
    provider: string = 'google',
    model?: string,
    requestId?: string,
  ): LLMError {
    const err = error as Record<string, unknown>;
    const message = (err.message as string | undefined) || '';

    // Authentication errors
    if (message.includes('API_KEY_INVALID')) {
      return new LLMError(
        'Invalid Google API key',
        LLMErrorType.API_KEY_INVALID,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Quota errors
    if (message.includes('QUOTA_EXCEEDED')) {
      return new LLMError(
        'Google API quota exceeded',
        LLMErrorType.QUOTA_EXCEEDED,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Service unavailable / overloaded errors (503)
    if (
      message.includes('503') ||
      message.includes('overloaded') ||
      message.includes('Service Unavailable')
    ) {
      return new LLMError(
        'Google model is overloaded. Will retry.',
        LLMErrorType.SERVICE_UNAVAILABLE,
        provider,
        { model, originalError: error, requestId, retryAfterMs: 5000 },
      );
    }

    // Rate limiting (429)
    if (message.includes('429') || message.includes('RATE_LIMIT')) {
      return new LLMError(
        'Google API rate limit exceeded',
        LLMErrorType.RATE_LIMIT,
        provider,
        { model, originalError: error, requestId, retryAfterMs: 60000 },
      );
    }

    // Safety errors
    if (message.includes('SAFETY')) {
      return new LLMError(
        'Content blocked by Google safety filters',
        LLMErrorType.CONTENT_FILTER,
        provider,
        { model, originalError: error, requestId },
      );
    }

    if (message.includes('RECITATION')) {
      return new LLMError(
        'Content blocked due to recitation concerns',
        LLMErrorType.CONTENT_FILTER,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Server errors (5xx)
    if (
      message.includes('500') ||
      message.includes('502') ||
      message.includes('504')
    ) {
      return new LLMError(
        'Google server error',
        LLMErrorType.SERVER_ERROR,
        provider,
        { model, originalError: error, requestId, retryable: true },
      );
    }

    // Unknown error
    return new LLMError(
      `Unknown Google error: ${String(err.message)}`,
      LLMErrorType.UNKNOWN,
      provider,
      { model, originalError: error, requestId },
    );
  }

  /**
   * Map Ollama errors to standardized LLMError
   */
  static fromOllamaError(
    error: unknown,
    provider: string = 'ollama',
    model?: string,
    requestId?: string,
  ): LLMError {
    const err = error as Record<string, unknown>;
    // Connection errors
    if (err.code === 'ECONNREFUSED') {
      return new LLMError(
        'Cannot connect to Ollama server. Is Ollama running?',
        LLMErrorType.NETWORK_ERROR,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Timeout errors
    if (err.code === 'ETIMEDOUT') {
      return new LLMError(
        'Ollama request timed out. Model may be loading.',
        LLMErrorType.CONNECTION_TIMEOUT,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Not found errors
    if ((err.response as Record<string, unknown> | undefined)?.status === 404) {
      return new LLMError(
        'Ollama endpoint not found. Check server configuration.',
        LLMErrorType.MODEL_NOT_FOUND,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Model not available
    if ((err.message as string | undefined)?.includes('model not found')) {
      return new LLMError(
        `Ollama model not available: ${model}`,
        LLMErrorType.MODEL_UNAVAILABLE,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Unknown error
    return new LLMError(
      `Unknown Ollama error: ${String(err.message)}`,
      LLMErrorType.UNKNOWN,
      provider,
      { model, originalError: error, requestId },
    );
  }

  /**
   * Map Grok errors to standardized LLMError
   */
  static fromGrokError(
    error: unknown,
    provider: string = 'grok',
    model?: string,
    requestId?: string,
  ): LLMError {
    const err = error as Record<string, unknown>;
    // Grok uses OpenAI-compatible API, so similar error handling
    const rawStatus =
      (err.response as Record<string, unknown> | undefined)?.status ??
      err.status;
    const status =
      typeof rawStatus === 'number'
        ? rawStatus
        : rawStatus
          ? Number.parseInt(rawStatus as string, 10)
          : NaN;

    // Authentication errors
    if (Number.isFinite(status) && status === 401) {
      return new LLMError(
        'Invalid Grok API key',
        LLMErrorType.API_KEY_INVALID,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Rate limiting
    if (Number.isFinite(status) && status === 429) {
      return new LLMError(
        'Grok rate limit exceeded',
        LLMErrorType.RATE_LIMIT,
        provider,
        { model, originalError: error, requestId, retryAfterMs: 60000 },
      );
    }

    // Invalid request
    if (Number.isFinite(status) && status === 400) {
      return new LLMError(
        `Invalid Grok request: ${String(err.message)}`,
        LLMErrorType.INVALID_REQUEST,
        provider,
        { model, originalError: error, requestId },
      );
    }

    // Server errors
    if (Number.isFinite(status) && status >= 500) {
      return new LLMError(
        'Grok server error',
        LLMErrorType.SERVER_ERROR,
        provider,
        { model, originalError: error, requestId, retryable: true },
      );
    }

    // Unknown error
    return new LLMError(
      `Unknown Grok error: ${String(err.message)}`,
      LLMErrorType.UNKNOWN,
      provider,
      { model, originalError: error, requestId },
    );
  }

  /**
   * Generic error mapper that attempts to determine provider from error
   */
  static fromGenericError(
    error: unknown,
    provider: string,
    model?: string,
    requestId?: string,
  ): LLMError {
    const err = error as Record<string, unknown>;
    switch (provider.toLowerCase()) {
      case 'openai':
        return this.fromOpenAIError(error, provider, model, requestId);
      case 'anthropic':
        return this.fromAnthropicError(error, provider, model, requestId);
      case 'google':
        return this.fromGoogleError(error, provider, model, requestId);
      case 'ollama':
        return this.fromOllamaError(error, provider, model, requestId);
      case 'grok':
      case 'xai':
        return this.fromGrokError(error, provider, model, requestId);
      default:
        return new LLMError(
          `Unknown error from ${provider}: ${String(err.message)}`,
          LLMErrorType.UNKNOWN,
          provider,
          { model, originalError: error, requestId },
        );
    }
  }
}

/**
 * Error statistics and monitoring interface
 */
export interface LLMErrorStats {
  provider: string;
  totalErrors: number;
  errorsByType: Record<LLMErrorType, number>;
  errorsBySeverity: Record<LLMErrorSeverity, number>;
  errorsByCategory: Record<LLMErrorCategory, number>;
  retryableErrors: number;
  timeWindow: {
    start: string;
    end: string;
  };
}

/**
 * Error monitoring service for tracking and analyzing LLM errors
 */
export class LLMErrorMonitor {
  private static readonly logger = new Logger(LLMErrorMonitor.name);
  private static errorHistory: LLMError[] = [];
  private static readonly maxHistorySize = 1000;

  /**
   * Record an error for monitoring and analysis
   */
  static recordError(error: LLMError): void {
    this.errorHistory.push(error);

    // Maintain history size limit
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
    }

    // Log error with full context
    this.logger.error(`LLM Error [${error.code}]`, {
      type: error.type,
      provider: error.provider,
      model: error.model,
      severity: error.severity,
      category: error.category,
      retryable: error.retryable,
      message: error.message,
      userMessage: error.getUserFriendlyMessage(),
      requestId: error.requestId,
      context: error.context,
    });

    // Alert on critical errors
    if (error.severity === LLMErrorSeverity.CRITICAL) {
      this.logger.error(
        `🚨 CRITICAL LLM ERROR: ${error.message}`,
        error.getTechnicalDetails(),
      );
    }
  }

  /**
   * Get error statistics for a provider
   */
  static getErrorStats(
    provider: string,
    timeWindowHours: number = 24,
  ): LLMErrorStats {
    const cutoffTime = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);
    const relevantErrors = this.errorHistory.filter(
      (error) =>
        error.provider === provider && new Date(error.timestamp) > cutoffTime,
    );

    const errorsByType: Record<LLMErrorType, number> = {} as Record<
      LLMErrorType,
      number
    >;
    const errorsBySeverity: Record<LLMErrorSeverity, number> = {} as Record<
      LLMErrorSeverity,
      number
    >;
    const errorsByCategory: Record<LLMErrorCategory, number> = {} as Record<
      LLMErrorCategory,
      number
    >;
    let retryableErrors = 0;

    relevantErrors.forEach((error) => {
      errorsByType[error.type] = (errorsByType[error.type] || 0) + 1;
      errorsBySeverity[error.severity] =
        (errorsBySeverity[error.severity] || 0) + 1;
      errorsByCategory[error.category] =
        (errorsByCategory[error.category] || 0) + 1;
      if (error.retryable) retryableErrors++;
    });

    return {
      provider,
      totalErrors: relevantErrors.length,
      errorsByType,
      errorsBySeverity,
      errorsByCategory,
      retryableErrors,
      timeWindow: {
        start: cutoffTime.toISOString(),
        end: new Date().toISOString(),
      },
    };
  }

  /**
   * Clear error history (useful for testing)
   */
  static clearHistory(): void {
    this.errorHistory = [];
    this.logger.log('Error history cleared');
  }
}

/**
 * Retry configuration interface
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrorTypes: LLMErrorType[];
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrorTypes: [
    LLMErrorType.RATE_LIMIT,
    LLMErrorType.CONNECTION_TIMEOUT,
    LLMErrorType.SERVICE_UNAVAILABLE,
    LLMErrorType.GATEWAY_TIMEOUT,
    LLMErrorType.NETWORK_ERROR,
    LLMErrorType.MODEL_UNAVAILABLE,
    LLMErrorType.SERVER_ERROR,
  ],
};

/**
 * Retry utility with exponential backoff
 */
export class LLMRetryHandler {
  private static readonly logger = new Logger(LLMRetryHandler.name);

  /**
   * Execute a function with retry logic for LLM errors
   */
  static async withRetry<T>(
    operation: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG,
    context: string = 'LLM operation',
  ): Promise<T> {
    let lastError: LLMError | undefined;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const result = await operation();

        // Log successful retry
        if (attempt > 0) {
          this.logger.log(`${context} succeeded after ${attempt} retries`);
        }

        return result;
      } catch (error) {
        // Convert to LLMError if not already
        const llmError =
          error instanceof LLMError
            ? error
            : new LLMError(
                (error as Error)?.message || 'Unknown error',
                LLMErrorType.UNKNOWN,
                'unknown',
                { originalError: error },
              );

        lastError = llmError;

        // Check if error is retryable
        if (
          !llmError.retryable ||
          !config.retryableErrorTypes.includes(llmError.type)
        ) {
          this.logger.error(
            `${context} failed with non-retryable error: ${llmError.message}`,
          );
          throw llmError;
        }

        // Check if we've exhausted retries
        if (attempt >= config.maxRetries) {
          this.logger.error(
            `${context} failed after ${config.maxRetries} retries: ${llmError.message}`,
          );
          throw llmError;
        }

        // Calculate delay for next retry
        const delay = Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
          config.maxDelayMs,
        );

        // Use retry-after header if available
        const actualDelay = llmError.retryAfterMs || delay;

        this.logger.warn(
          `${context} failed (attempt ${attempt + 1}/${config.maxRetries + 1}), retrying in ${actualDelay}ms: ${llmError.message}`,
        );

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, actualDelay));
      }
    }

    // This should never be reached, but TypeScript requires it
    throw (
      lastError ||
      new LLMError('Retry logic failed', LLMErrorType.INTERNAL_ERROR, 'unknown')
    );
  }
}

/**
 * Utility functions for error handling
 */
export class LLMErrorUtils {
  /**
   * Check if an error is retryable
   */
  static isRetryable(error: unknown): boolean {
    if (error instanceof LLMError) {
      return error.retryable;
    }

    // Check common retryable patterns
    const retryablePatterns = [
      /rate.?limit/i,
      /timeout/i,
      /unavailable/i,
      /server.?error/i,
      /5\d\d/,
    ];

    const errorMessage = error instanceof Error ? error.message : '';
    return retryablePatterns.some((pattern) => pattern.test(errorMessage));
  }

  /**
   * Extract retry delay from error
   */
  static getRetryDelay(error: unknown): number | undefined {
    if (error instanceof LLMError && error.retryAfterMs) {
      return error.retryAfterMs;
    }

    // Check for retry-after header
    if (
      error &&
      typeof error === 'object' &&
      'response' in error &&
      error.response &&
      typeof error.response === 'object' &&
      'headers' in error.response
    ) {
      const headers = error.response.headers as Record<string, unknown>;
      const retryAfter = headers['retry-after'];
      if (typeof retryAfter === 'string') {
        return parseInt(retryAfter) * 1000;
      }
    }

    return undefined;
  }

  /**
   * Sanitize error for client response (remove sensitive information)
   */
  static sanitizeForClient(error: LLMError): Record<string, unknown> {
    return {
      error: true,
      message: error.getUserFriendlyMessage(),
      code: error.code,
      type: error.type,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      timestamp: error.timestamp,
      requestId: error.requestId,
      // Don't include technical details or original error in client response
    };
  }
}
