import { Injectable, Inject, Logger, ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@orchestrator-ai/transport-types';
import { DATABASE_SERVICE, DatabaseService } from '@/database';
import { CIDAFMService } from '../cidafm/cidafm.service';
import { RunMetadataService } from '../run-metadata.service';
import { ProviderConfigService } from '../provider-config.service';
import { PIIService } from '../pii/pii.service';
import { DictionaryPseudonymizerService } from '../pii/dictionary-pseudonymizer.service';
import type { DictionaryPseudonymMapping } from '../pii/dictionary-pseudonymizer.service';
import { PatternRedactionService } from '../pii/pattern-redaction.service';
import type { PatternRedactionMapping } from '../pii/pattern-redaction.service';
import { LocalModelStatusService } from '../local-model-status.service';
import { LocalLLMService } from '../local-llm.service';
import { LLMServiceFactory } from './llm-service-factory';
import { ModelConfigurationService } from '../config/model-configuration.service';
import type { EnvironmentName } from '../config/model-configuration.service';
import {
  GenerateResponseParams,
  UnifiedGenerateResponseParams,
  LLMResponse,
  LLMServiceConfig,
  LLMRequestOptions,
} from './llm-interfaces';
import {
  CostCalculation,
  LLMUsageMetrics,
  CIDAFMOptions,
  SystemOperationType,
  UserLLMPreferences,
} from '../types/llm-evaluation';
import type {
  PIIProcessingMetadata,
  PIIMatch,
} from '../types/pii-metadata.types';
import {
  LLMError,
  LLMErrorMapper,
  LLMErrorMonitor,
  LLMErrorType,
} from './llm-error-handling';

type GenerateResponseOptions = LLMRequestOptions & {
  provider?: 'openai' | 'anthropic' | 'ollama' | 'google';
  cidafmOptions?: CIDAFMOptions;
  complexity?: 'simple' | 'medium' | 'complex' | 'reasoning';
  images?: Array<{ base64: string; mimeType: string }>;
};

/**
 * LLMGenerationService - Focused service for LLM text generation
 *
 * This service handles all text generation operations including:
 * - Simple LLM calls with system and user messages
 * - Conversation history support
 * - System operations (optimized configurations)
 * - User content generation with preferences
 * - Unified response generation
 *
 * All methods accept ExecutionContext as the first parameter to ensure
 * proper tracking, observability, and compliance with architectural patterns.
 *
 * Note: Compose does not use LangChain/LangGraph directly. All LLM calls
 * go through the LLMServiceFactory which uses the planes LLM abstraction.
 */
@Injectable()
export class LLMGenerationService {
  private readonly logger = new Logger(LLMGenerationService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    private readonly cidafmService: CIDAFMService,
    private readonly runMetadataService: RunMetadataService,
    private readonly providerConfigService: ProviderConfigService,
    private readonly piiService: PIIService,
    private readonly dictionaryPseudonymizerService: DictionaryPseudonymizerService,
    private readonly patternRedactionService: PatternRedactionService,
    private readonly localModelStatusService: LocalModelStatusService,
    private readonly localLLMService: LocalLLMService,
    private readonly llmServiceFactory: LLMServiceFactory,
    private readonly modelConfigurationService: ModelConfigurationService,
  ) {}

  /**
   * Simple LLM call with system and user messages
   *
   * @param executionContext - ExecutionContext (REQUIRED) - contains provider, model, and tracking info
   * @param systemPrompt - System prompt for the LLM
   * @param userMessage - User message to process
   * @param options - Optional parameters (temperature, maxTokens, etc.)
   * @returns Promise<string | LLMResponse> - String content or full response object
   */
  async generateResponse(
    executionContext: ExecutionContext,
    systemPrompt: string,
    userMessage: string,
    options?: GenerateResponseOptions,
  ): Promise<string | LLMResponse> {
    // Validate ExecutionContext is provided
    if (!executionContext) {
      throw new Error('ExecutionContext is required for generateResponse.');
    }

    // Defense-in-depth: Validate sovereign mode compliance
    this.validateSovereignModeProvider(executionContext);

    // Extract provider/model from ExecutionContext - it's the single source of truth
    const providerName = executionContext.provider;
    const modelName = executionContext.model;

    if (!providerName || !modelName) {
      throw new Error(
        'ExecutionContext must contain provider and model. These are required fields.',
      );
    }

    try {
      // === PII PROCESSING BEFORE FACTORY CALL ===
      let processedUserMessage = userMessage;
      let dictionaryMappings: DictionaryPseudonymMapping[] = [];
      let patternRedactionMappings: PatternRedactionMapping[] = [];
      let enhancedPiiMetadata: PIIProcessingMetadata | undefined =
        options?.piiMetadata ?? undefined;

      // Always apply dictionary pseudonymization for external providers (non-Ollama), unless quick bypass
      const skipPII = options?.quick === true;
      if (!skipPII && providerName.toLowerCase() !== 'ollama') {
        // Step 1: Apply dictionary pseudonymization
        const pseudonymResult =
          await this.dictionaryPseudonymizerService.pseudonymizeText(
            userMessage,
            {
              agentSlug: executionContext.agentSlug ?? null,
            },
          );
        processedUserMessage = pseudonymResult.pseudonymizedText;
        dictionaryMappings = pseudonymResult.mappings;

        // Step 2: Apply pattern-based redaction (after pseudonymization)
        const patternRedactionResult =
          await this.patternRedactionService.redactPatterns(
            processedUserMessage,
            {
              minConfidence: 0.8,
              maxMatches: 100,
              excludeShowstoppers: true, // Don't redact showstoppers - they should block
            },
          );
        processedUserMessage = patternRedactionResult.redactedText;
        patternRedactionMappings = patternRedactionResult.mappings;

        const requestId =
          executionContext.conversationId ||
          `pii-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const dictionaryMatches = pseudonymResult.mappings.map((m) => ({
          value: m.originalValue,
          dataType: m.dataType,
          severity: 'warning',
          confidence: 1.0,
          startIndex: -1,
          endIndex: -1,
          pattern: 'dictionary_match',
          pseudonym: m.pseudonym,
        }));

        if (enhancedPiiMetadata) {
          // Merge pseudonym info into existing metadata
          enhancedPiiMetadata = {
            ...enhancedPiiMetadata,
            flaggings:
              enhancedPiiMetadata.detectionResults?.flaggedMatches ||
              enhancedPiiMetadata.flaggings ||
              [],
            pseudonymsApplied: [
              ...(enhancedPiiMetadata.pseudonymsApplied || []),
              ...pseudonymResult.mappings.map((m) => ({
                original: m.originalValue,
                pseudonym: m.pseudonym,
                type: m.dataType,
              })),
            ],
            pseudonymInstructions: {
              shouldPseudonymize: true,
              targetMatches: [
                ...((enhancedPiiMetadata.pseudonymInstructions
                  ?.targetMatches as PIIMatch[]) || []),
                ...(dictionaryMatches as PIIMatch[]),
              ] as PIIMatch[],
              requestId:
                enhancedPiiMetadata.pseudonymInstructions?.requestId ||
                requestId,
              context:
                enhancedPiiMetadata.pseudonymInstructions?.context ||
                'llm-boundary',
            },
            pseudonymResults: {
              applied: true,
              processedMatches: [
                ...((enhancedPiiMetadata.pseudonymResults
                  ?.processedMatches as PIIMatch[]) || []),
                ...(dictionaryMatches as PIIMatch[]),
              ],
              mappingsCount:
                (enhancedPiiMetadata.pseudonymResults?.mappingsCount || 0) +
                pseudonymResult.mappings.length,
              processingTimeMs:
                (enhancedPiiMetadata.pseudonymResults?.processingTimeMs || 0) +
                pseudonymResult.processingTimeMs,
              reversalSuccess:
                enhancedPiiMetadata.pseudonymResults?.reversalSuccess,
              reversalMatches:
                enhancedPiiMetadata.pseudonymResults?.reversalMatches,
            },
            piiDetected: true,
            sanitizationLevel:
              pseudonymResult.mappings.length > 0 ||
              patternRedactionResult.redactionCount > 0
                ? 'standard'
                : enhancedPiiMetadata.sanitizationLevel || 'none',
            patternRedactionsApplied: patternRedactionResult.mappings.map(
              (m) => ({
                original: m.originalValue,
                redacted: m.redactedValue,
                dataType: m.dataType,
              }),
            ),
            patternRedactionMappings: patternRedactionResult.mappings,
            patternRedactionResults: {
              applied: patternRedactionResult.redactionCount > 0,
              redactionCount: patternRedactionResult.redactionCount,
              processingTimeMs: patternRedactionResult.processingTimeMs,
            },
          };
        } else {
          // No metadata provided – compute detection once, then attach pseudonym fields
          const piiPolicyResult = await this.piiService.checkPolicy(
            userMessage,
            {
              provider: providerName,
              providerName: providerName,
            },
          );

          enhancedPiiMetadata = {
            ...piiPolicyResult.metadata,
            pseudonymsApplied: pseudonymResult.mappings.map((m) => ({
              original: m.originalValue,
              pseudonym: m.pseudonym,
              type: m.dataType,
            })),
            flaggings:
              piiPolicyResult.metadata.detectionResults?.flaggedMatches || [],
            pseudonymInstructions: {
              shouldPseudonymize: pseudonymResult.mappings.length > 0,
              targetMatches: dictionaryMatches as unknown,
              requestId,
              context: 'llm-boundary',
            },
            pseudonymResults: {
              applied: pseudonymResult.mappings.length > 0,
              processedMatches: dictionaryMatches as unknown,
              mappingsCount: pseudonymResult.mappings.length,
              processingTimeMs: pseudonymResult.processingTimeMs,
            },
            piiDetected:
              piiPolicyResult.metadata.piiDetected ||
              pseudonymResult.mappings.length > 0 ||
              patternRedactionResult.redactionCount > 0,
            processingTimeMs:
              (piiPolicyResult.metadata.timestamps?.policyCheck || Date.now()) -
              (piiPolicyResult.metadata.timestamps?.detectionStart ||
                Date.now()) +
              pseudonymResult.processingTimeMs,
            sanitizationLevel:
              pseudonymResult.mappings.length > 0 ||
              patternRedactionResult.redactionCount > 0
                ? 'standard'
                : 'none',
            patternRedactionsApplied: patternRedactionResult.mappings.map(
              (m) => ({
                original: m.originalValue,
                redacted: m.redactedValue,
                dataType: m.dataType,
              }),
            ),
            patternRedactionMappings: patternRedactionResult.mappings,
            patternRedactionResults: {
              applied: patternRedactionResult.redactionCount > 0,
              redactionCount: patternRedactionResult.redactionCount,
              processingTimeMs: patternRedactionResult.processingTimeMs,
            },
          } as unknown as PIIProcessingMetadata;
        }
      } else {
        // Quick/local path – no pseudonymization or pattern redaction
        processedUserMessage = userMessage;
      }

      // Use the new unified LLM service factory approach
      const config: LLMServiceConfig = {
        provider: providerName,
        model: modelName,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      };

      const factoryParams: GenerateResponseParams = {
        systemPrompt,
        userMessage: processedUserMessage,
        images: options?.images,
        config,
        options: {
          callerType: options?.callerType,
          callerName: options?.callerName,
          authToken: options?.authToken,
          currentUser: options?.currentUser,
          dataClassification: options?.dataClassification,
          piiMetadata: enhancedPiiMetadata,
          dictionaryMappings: dictionaryMappings,
          routingDecision: options?.routingDecision,
          executionContext,
        },
      };

      const unifiedResult = await this.llmServiceFactory.generateResponse(
        config,
        factoryParams,
      );

      // Apply reverse processing: pattern redactions first, then pseudonyms
      if (unifiedResult.content) {
        let reversedContent = unifiedResult.content;

        // Step 1: Reverse pattern redactions first (to restore original values)
        if (patternRedactionMappings && patternRedactionMappings.length > 0) {
          const patternReverseResult =
            await this.patternRedactionService.reverseRedactions(
              reversedContent,
              patternRedactionMappings,
            );
          reversedContent = patternReverseResult.originalText;

          // Update metadata with reversal results
          if (enhancedPiiMetadata?.patternRedactionResults) {
            enhancedPiiMetadata.patternRedactionResults.reversalSuccess = true;
            enhancedPiiMetadata.patternRedactionResults.reversalCount =
              patternReverseResult.reversalCount;
          }
        }

        // Step 2: Reverse dictionary pseudonyms (to restore dictionary values)
        if (dictionaryMappings && dictionaryMappings.length > 0) {
          const pseudonymReverseResult =
            await this.dictionaryPseudonymizerService.reversePseudonyms(
              reversedContent,
              dictionaryMappings,
            );
          reversedContent = pseudonymReverseResult.originalText;

          // Update metadata with reversal results
          if (enhancedPiiMetadata?.pseudonymResults) {
            enhancedPiiMetadata.pseudonymResults.reversalSuccess = true;
            enhancedPiiMetadata.pseudonymResults.reversalMatches =
              enhancedPiiMetadata.pseudonymInstructions?.targetMatches;
          }
        }

        unifiedResult.content = reversedContent;
      }

      // Ensure PII metadata is included in response
      if (enhancedPiiMetadata) {
        unifiedResult.piiMetadata = enhancedPiiMetadata;
      }

      return unifiedResult;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`LLM service error: ${errorMessage}`);
    }
  }

  /**
   * Unified generateResponse method - the new entry point for all LLM requests
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @param params - Unified parameters including provider, model, and messages
   * @returns Promise<string | LLMResponse>
   */
  async generateUnifiedResponse(
    executionContext: ExecutionContext,
    params: UnifiedGenerateResponseParams,
  ): Promise<string | LLMResponse> {
    // Validate required parameters
    if (!executionContext) {
      throw new Error(
        'ExecutionContext is required in generateUnifiedResponse',
      );
    }

    // Defense-in-depth: Validate sovereign mode compliance
    this.validateSovereignModeProvider(executionContext);

    if (!params.provider) {
      throw new Error('Missing required parameter: provider is required');
    }
    if (!params.model) {
      throw new Error('Missing required parameter: model is required');
    }
    if (!params.systemPrompt) {
      throw new Error('Missing required parameter: systemPrompt is required');
    }
    if (!params.userMessage) {
      throw new Error('Missing required parameter: userMessage is required');
    }

    // Validate provider is supported
    const supportedProviders = [
      'openai',
      'anthropic',
      'google',
      'grok',
      'ollama',
      'ollama-cloud',
      'xai',
    ];
    if (!supportedProviders.includes(params.provider.toLowerCase())) {
      throw new Error(
        `Unsupported provider: ${params.provider}. Supported providers: ${supportedProviders.join(', ')}`,
      );
    }

    try {
      // === PII PROCESSING AT LLM SERVICE LEVEL ===
      let enhancedPiiMetadata = params.options?.piiMetadata;
      let processedUserMessage = params.userMessage;
      let dictionaryMappings: DictionaryPseudonymMapping[] = [];

      // Only process PII for non-Ollama providers
      if (params.provider.toLowerCase() !== 'ollama') {
        const pseudonymResult =
          await this.dictionaryPseudonymizerService.pseudonymizeText(
            params.userMessage,
          );
        processedUserMessage = pseudonymResult.pseudonymizedText;
        dictionaryMappings = pseudonymResult.mappings;

        const requestId =
          params.options?.conversationId ||
          params.options?.sessionId ||
          `pii-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const dictionaryMatches = pseudonymResult.mappings.map((m) => ({
          value: m.originalValue,
          dataType: m.dataType,
          severity: 'warning',
          confidence: 1.0,
          startIndex: -1,
          endIndex: -1,
          pattern: 'dictionary_match',
          pseudonym: m.pseudonym,
        }));

        if (!enhancedPiiMetadata) {
          const piiPolicyResult = await this.piiService.checkPolicy(
            params.userMessage,
            {
              provider: params.provider,
              providerName: params.provider,
            },
          );
          enhancedPiiMetadata = piiPolicyResult.metadata;
        }

        if (!enhancedPiiMetadata) {
          throw new Error('PII metadata unavailable after policy check');
        }

        enhancedPiiMetadata = {
          ...enhancedPiiMetadata,
          flaggings:
            enhancedPiiMetadata.detectionResults?.flaggedMatches ||
            enhancedPiiMetadata.flaggings ||
            [],
          pseudonymsApplied: [
            ...(enhancedPiiMetadata?.pseudonymsApplied || []),
            ...pseudonymResult.mappings.map((m) => ({
              original: m.originalValue,
              pseudonym: m.pseudonym,
              type: m.dataType,
            })),
          ],
          pseudonymInstructions: {
            shouldPseudonymize: true,
            targetMatches: [
              ...((enhancedPiiMetadata?.pseudonymInstructions
                ?.targetMatches as PIIMatch[]) || []),
              ...(dictionaryMatches as PIIMatch[]),
            ] as PIIMatch[],
            requestId:
              enhancedPiiMetadata?.pseudonymInstructions?.requestId ||
              requestId,
            context:
              enhancedPiiMetadata?.pseudonymInstructions?.context ||
              'llm-boundary',
          },
          pseudonymResults: {
            applied: true,
            processedMatches: [
              ...((enhancedPiiMetadata?.pseudonymResults
                ?.processedMatches as PIIMatch[]) || []),
              ...(dictionaryMatches as PIIMatch[]),
            ],
            mappingsCount:
              (enhancedPiiMetadata?.pseudonymResults?.mappingsCount || 0) +
              pseudonymResult.mappings.length,
            processingTimeMs:
              (enhancedPiiMetadata?.pseudonymResults?.processingTimeMs || 0) +
              pseudonymResult.processingTimeMs,
            reversalSuccess:
              enhancedPiiMetadata?.pseudonymResults?.reversalSuccess,
            reversalMatches:
              enhancedPiiMetadata?.pseudonymResults?.reversalMatches,
          },
          piiDetected: true,
          sanitizationLevel:
            pseudonymResult.mappings.length > 0
              ? 'standard'
              : enhancedPiiMetadata?.sanitizationLevel || 'none',
        };
      }

      // Create LLM service configuration
      const config: LLMServiceConfig = {
        provider: params.provider,
        model: params.model,
        temperature: params.options?.temperature,
        maxTokens: params.options?.maxTokens,
      };

      // Create GenerateResponseParams for the factory
      const factoryParams: GenerateResponseParams = {
        systemPrompt: params.systemPrompt,
        userMessage: processedUserMessage,
        config,
        options: {
          temperature: params.options?.temperature,
          maxTokens: params.options?.maxTokens,
          callerType: params.options?.callerType,
          callerName: params.options?.callerName,
          dataClassification: params.options?.dataClassification,
          authToken: params.options?.authToken,
          currentUser: params.options?.currentUser,
          conversationId: params.options?.conversationId,
          sessionId: params.options?.sessionId,
          userId: params.options?.userId,
          piiMetadata: enhancedPiiMetadata,
          dictionaryMappings: dictionaryMappings,
          routingDecision: params.options?.routingDecision,
          executionContext,
        },
      };

      // Use the LLMServiceFactory to generate the response
      const response = await this.llmServiceFactory.generateResponse(
        config,
        factoryParams,
      );

      // Apply reverse pseudonymization if we have mappings
      if (
        dictionaryMappings &&
        dictionaryMappings.length > 0 &&
        response.content
      ) {
        const reverseResult =
          await this.dictionaryPseudonymizerService.reversePseudonyms(
            response.content,
            dictionaryMappings,
          );
        response.content = reverseResult.originalText;
      }

      // Ensure PII metadata is included in response
      if (enhancedPiiMetadata) {
        response.piiMetadata = enhancedPiiMetadata;
      }

      // Return either string or full response based on includeMetadata flag
      return params.options?.includeMetadata ? response : response.content;
    } catch (error) {
      // Standardized error handling
      try {
        const mapped = LLMErrorMapper.fromGenericError(
          error,
          params.provider,
          params.model,
        );
        LLMErrorMonitor.recordError(mapped);
        this.logger.error(
          `[UNIFIED-LLM] Standardized error`,
          mapped.getTechnicalDetails(),
        );
        throw mapped;
      } catch {
        const fallback = new LLMError(
          `Unified LLM service error: ${error instanceof Error ? error.message : String(error)}`,
          LLMErrorType.UNKNOWN,
          params.provider,
          { model: params.model, originalError: error },
        );
        LLMErrorMonitor.recordError(fallback);
        this.logger.error(
          `[UNIFIED-LLM] Fallback error`,
          fallback.getTechnicalDetails(),
        );
        throw fallback;
      }
    }
  }

  /**
   * Enhanced LLM call with conversation history support.
   *
   * Uses the LLMServiceFactory (planes LLM abstraction) — no LangChain dependency.
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @param systemPrompt - System prompt for the LLM
   * @param conversationHistory - Array of conversation messages
   * @param currentMessage - Current user message
   * @returns Promise<string>
   */
  async generateResponseWithHistory(
    executionContext: ExecutionContext,
    systemPrompt: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    currentMessage: string,
  ): Promise<string> {
    if (!executionContext) {
      throw new Error(
        'ExecutionContext is required for generateResponseWithHistory',
      );
    }

    const providerName = executionContext.provider;
    const modelName = executionContext.model;

    if (!providerName || !modelName) {
      throw new Error(
        'ExecutionContext must contain provider and model. These are required fields.',
      );
    }

    // Build a single combined message from conversation history for providers
    // that don't natively support multi-turn via factory (the factory handles
    // the actual multi-turn formatting internally).
    const historyText = conversationHistory
      .map(
        (msg) =>
          `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`,
      )
      .join('\n');

    const combinedUserMessage = historyText
      ? `${historyText}\nUser: ${currentMessage}`
      : currentMessage;

    try {
      const config: LLMServiceConfig = {
        provider: providerName,
        model: modelName,
        temperature: 0.7,
        maxTokens: 2000,
      };

      const factoryParams: GenerateResponseParams = {
        systemPrompt,
        userMessage: combinedUserMessage,
        config,
        options: {
          callerType: 'service',
          callerName: 'llm-generation-service-history',
          executionContext,
        },
      };

      const result = await this.llmServiceFactory.generateResponse(
        config,
        factoryParams,
      );

      return (
        result.content ||
        'I apologize, but I was unable to generate a response.'
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`LLM service error: ${errorMessage}`);
    }
  }

  /**
   * Generate response for system operations using optimized configurations
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @param operationType - Type of system operation
   * @param systemPrompt - System prompt for the LLM
   * @param userMessage - User message to process
   * @returns Promise<string>
   */
  async generateSystemResponse(
    executionContext: ExecutionContext,
    operationType: SystemOperationType,
    systemPrompt: string,
    userMessage: string,
  ): Promise<string> {
    if (!executionContext) {
      throw new Error(
        'ExecutionContext is required for generateSystemResponse',
      );
    }

    try {
      // Resolve configuration from environment defaults
      const selectedDefault = this.modelConfigurationService.isGlobal()
        ? this.modelConfigurationService.getGlobalDefault()
        : this.modelConfigurationService.getEnvironmentDefault(
            this.resolveEnvironment(),
          );

      const config: LLMServiceConfig = {
        provider: selectedDefault.provider,
        model: selectedDefault.model,
        temperature: selectedDefault.parameters?.temperature as
          | number
          | undefined,
        maxTokens: selectedDefault.parameters?.maxTokens as number | undefined,
      };

      const factoryParams: GenerateResponseParams = {
        systemPrompt,
        userMessage,
        config,
        options: {
          callerType: 'service',
          callerName: `system-${operationType}`,
          executionContext,
        },
      };

      const result = await this.llmServiceFactory.generateResponse(
        config,
        factoryParams,
      );

      return (
        result.content ||
        'I apologize, but I was unable to generate a system response.'
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`System LLM operation error: ${errorMessage}`);
    }
  }

  /**
   * Generate response for user content using their preferences
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @param systemPrompt - System prompt for the LLM
   * @param userMessage - User message to process
   * @param userPreferences - User LLM preferences
   * @param authToken - Optional auth token
   * @param sessionId - Optional session ID
   * @returns Promise with content, usage, cost calculation, and metadata
   */
  async generateUserContentResponse(
    executionContext: ExecutionContext,
    systemPrompt: string,
    userMessage: string,
    userPreferences: UserLLMPreferences,
    authToken?: string,
    sessionId?: string,
  ): Promise<{
    content: string;
    usage: LLMUsageMetrics;
    costCalculation: CostCalculation;
    langsmithRunId?: string;
    processedPrompt: string;
    cidafmState?: Record<string, unknown>;
    llmMetadata?: {
      providerName: string;
      modelName: string;
      temperature?: number;
      maxTokens?: number;
      responseTimeMs?: number;
    };
  }> {
    if (!executionContext) {
      throw new Error(
        'ExecutionContext is required for generateUserContentResponse',
      );
    }

    // Validate user preferences
    if (!userPreferences.providerName) {
      throw new Error('User preferences must include a valid providerName');
    }
    if (!userPreferences.modelName) {
      throw new Error('User preferences must include a valid modelName');
    }

    try {
      // Use the unified response method
      const result = await this.generateUnifiedResponse(executionContext, {
        provider: userPreferences.providerName,
        model: userPreferences.modelName,
        systemPrompt,
        userMessage,
        options: {
          temperature: userPreferences.temperature,
          maxTokens: userPreferences.maxTokens,
          sessionId: sessionId,
          userId: authToken || 'user',
          includeMetadata: true,
          executionContext,
        },
      });

      // Convert the LLMResponse to the expected format
      if (typeof result === 'string') {
        throw new Error('Expected rich metadata from unified response');
      }

      return {
        content: result.content,
        usage: {
          provider: result.metadata.provider,
          model: result.metadata.model,
          inputTokens: result.metadata.usage.inputTokens,
          outputTokens: result.metadata.usage.outputTokens,
          totalTokens: result.metadata.usage.totalTokens,
          cost: result.metadata.usage.cost || 0,
          currency: 'USD',
          responseTimeMs: result.metadata.timing.duration,
          timestamp: result.metadata.timestamp,
          userId: authToken || 'user',
          sessionId: sessionId,
          callerType: 'user',
          callerName: 'user-content-response',
        } as LLMUsageMetrics,
        costCalculation: {
          inputTokens: result.metadata.usage.inputTokens,
          outputTokens: result.metadata.usage.outputTokens,
          inputCost: 0,
          outputCost: 0,
          totalCost: result.metadata.usage.cost || 0,
          currency: 'USD',
        } as CostCalculation,
        langsmithRunId: result.metadata.langsmithRunId,
        processedPrompt: userMessage,
        cidafmState: undefined,
        llmMetadata: {
          providerName: result.metadata.provider,
          modelName: result.metadata.model,
          temperature: userPreferences.temperature,
          maxTokens: userPreferences.maxTokens,
          responseTimeMs: result.metadata.timing.duration,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`User content LLM error: ${errorMessage}`);
    }
  }

  /**
   * Resolve environment name explicitly for configuration defaults
   */
  private resolveEnvironment(): EnvironmentName {
    const env = (process.env.NODE_ENV || '').toLowerCase();
    if (env === 'production' || env === 'staging' || env === 'development') {
      return env as EnvironmentName;
    }
    throw new Error(
      `Invalid NODE_ENV '${process.env.NODE_ENV}'. Expected one of 'development', 'staging', 'production'.`,
    );
  }

  /**
   * Defense-in-depth validation for sovereign mode.
   * When sovereignMode is active in the ExecutionContext, only local providers (Ollama) are allowed.
   *
   * @param context - The execution context containing provider and sovereignMode flag
   * @throws ForbiddenException if a non-local provider is used in sovereign mode
   */
  private validateSovereignModeProvider(context: ExecutionContext): void {
    const sovereignMode = context.sovereignMode;
    const provider = context.provider?.toLowerCase();

    // If sovereign mode is not active, allow any provider
    if (!sovereignMode) {
      return;
    }

    // In sovereign mode, only Ollama (local) provider is allowed
    if (provider && provider !== 'ollama') {
      this.logger.warn(
        `Sovereign mode violation in LLM Generation Service: Provider "${provider}" is not allowed. ` +
          `Only local providers (ollama) are permitted when sovereignMode is active.`,
      );
      throw new ForbiddenException(
        `Sovereign mode is active. Provider "${provider}" is not allowed. ` +
          `Only local providers (ollama) are permitted.`,
      );
    }
  }
}
