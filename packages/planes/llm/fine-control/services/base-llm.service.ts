import { Injectable, Logger } from '@nestjs/common';
import { ExecutionContext } from '@orchestrator-ai/transport-types';
import { PIIService } from '../pii/pii.service';
import {
  DictionaryPseudonymizerService,
  DictionaryPseudonymMapping,
} from '../pii/dictionary-pseudonymizer.service';
import { RunMetadataService } from '../run-metadata.service';
import { ProviderConfigService } from '../provider-config.service';
import { LLMPricingService } from '../llm-pricing.service';
import {
  PIIProcessingMetadata,
  PIIDataType,
} from '../types/pii-metadata.types';
import {
  LLMError,
  LLMErrorMapper,
  LLMErrorMonitor,
  LLMErrorType,
} from './llm-error-handling';
import {
  LLMServiceConfig,
  GenerateResponseParams,
  LLMResponse,
  ResponseMetadata,
  PiiOptions,
  ImageGenerationParams,
  ImageGenerationResponse,
  VideoGenerationParams,
  VideoGenerationResponse,
} from './llm-interfaces';

/**
 * Abstract base class for all LLM service implementations
 *
 * This class provides a consistent interface and shared functionality
 * across all provider-specific LLM services, including:
 * - Standardized response format
 * - PII processing integration
 * - Logging and error handling
 * - Cost tracking hooks
 * - Metadata management
 */
@Injectable()
export abstract class BaseLLMService {
  protected readonly logger: Logger;

  constructor(
    protected readonly config: LLMServiceConfig,
    protected readonly piiService: PIIService,
    protected readonly dictionaryPseudonymizerService: DictionaryPseudonymizerService,
    protected readonly runMetadataService: RunMetadataService,
    protected readonly providerConfigService: ProviderConfigService,
    protected readonly llmPricingService?: LLMPricingService,
  ) {
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Abstract method that all provider services must implement
   * This is the core method for generating responses from the LLM
   */
  abstract generateResponse(
    context: ExecutionContext,
    params: GenerateResponseParams,
  ): Promise<LLMResponse>;

  /**
   * Optional method for image generation - providers implement if supported
   *
   * This method is optional because not all providers support image generation.
   * OpenAI (GPT Image, DALL-E) and Google (Imagen) implement this method.
   *
   * @param context - ExecutionContext with orgSlug, userId, conversationId, taskId, etc.
   * @param params - Image generation parameters (prompt, size, quality, etc.)
   * @returns ImageGenerationResponse with generated image bytes and metadata
   */
  generateImage?(
    context: ExecutionContext,
    params: ImageGenerationParams,
  ): Promise<ImageGenerationResponse>;

  /**
   * Optional method for video generation - providers implement if supported
   *
   * This method is optional because not all providers support video generation.
   * OpenAI (Sora 2) and Google (Veo 3) implement this method.
   *
   * Video generation is typically async - the initial call returns an operationId,
   * and the caller must poll for completion using pollVideoStatus().
   *
   * @param context - ExecutionContext with orgSlug, userId, conversationId, taskId, etc.
   * @param params - Video generation parameters (prompt, duration, aspectRatio, etc.)
   * @returns VideoGenerationResponse with status and optional video data
   */
  generateVideo?(
    context: ExecutionContext,
    params: VideoGenerationParams,
  ): Promise<VideoGenerationResponse>;

  /**
   * Optional method to poll video generation status - providers implement if supported
   *
   * Video generation is async, so after calling generateVideo(), the caller must
   * poll this method until status is 'completed' or 'failed'.
   *
   * @param operationId - The operation ID returned from generateVideo()
   * @param context - ExecutionContext for tracking
   * @returns VideoGenerationResponse with current status and video data when completed
   */
  pollVideoStatus?(
    operationId: string,
    context: ExecutionContext,
  ): Promise<VideoGenerationResponse>;

  /**
   * Create standardized metadata for responses
   */
  protected createMetadata(
    rawResponse: unknown,
    params: GenerateResponseParams,
    startTime: number,
    endTime: number,
    requestId: string,
  ): ResponseMetadata {
    const rawResp = rawResponse as Record<string, unknown>;
    const inputTokens = this.estimateTokens(
      params.systemPrompt + params.userMessage,
    );
    const outputTokens = this.estimateTokens(
      (rawResp.content as string | undefined) || '',
    );
    const totalTokens = inputTokens + outputTokens;

    return {
      provider: params.config.provider,
      model: params.config.model,
      requestId,
      timestamp: new Date().toISOString(),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
        cost: this.calculateCost(
          params.config.provider,
          params.config.model,
          inputTokens,
          outputTokens,
        ),
      },
      timing: {
        startTime,
        endTime,
        duration: endTime - startTime,
      },
      // Enhanced fields
      tier: params.options?.preferLocal ? 'local' : 'external',
      status: 'completed',
      // Provider-specific data can be added by subclasses
      providerSpecific:
        (rawResp.providerSpecific as Record<string, unknown> | undefined) ||
        ({} as Record<string, unknown>),
    };
  }

  /**
   * Handle PII processing for input text
   */
  protected async handlePiiInput(
    text: string,
    options: PiiOptions = {},
  ): Promise<{ processedText: string; piiMetadata?: PIIProcessingMetadata }> {
    try {
      if (!options.enablePseudonymization) {
        return { processedText: text };
      }

      // Use dictionary pseudonymizer if requested
      if (options.useDictionaryPseudonymizer) {
        const result =
          await this.dictionaryPseudonymizerService.pseudonymizeText(text);

        // Convert dictionary result to minimal PIIProcessingMetadata
        const piiMetadata: PIIProcessingMetadata = {
          piiDetected: result.mappings.length > 0,
          showstopperDetected: false,
          detectionResults: {
            totalMatches: result.mappings.length,
            flaggedMatches: result.mappings.map((mapping: unknown) => {
              const m = mapping as Record<string, unknown>;
              return {
                value: m.originalValue as string,
                dataType: m.dataType as PIIDataType,
                severity: 'info' as const,
                confidence: 1.0,
                startIndex: 0, // Dictionary doesn't track positions
                endIndex: 0,
                pattern: m.originalValue as string,
                pseudonym: m.pseudonym as string,
              };
            }),
            showstopperMatches: [],
            dataTypesSummary: {},
            severityBreakdown: {
              showstopper: 0,
              warning: 0,
              info: result.mappings.length,
            },
          },
          policyDecision: {
            allowed: result.mappings.length === 0,
            blocked: false,
            violations: [],
            reasoningPath: [
              result.mappings.length > 0
                ? 'Dictionary matches found'
                : 'No dictionary matches',
            ],
            appliedFor: 'external',
          },
          userMessage: {
            summary:
              result.mappings.length > 0
                ? `Applied ${result.mappings.length} dictionary pseudonym(s)`
                : 'No dictionary matches found',
            details: [
              `Dictionary pseudonymization: ${result.mappings.length} matches`,
            ],
            actionsTaken:
              result.mappings.length > 0 ? ['pseudonymization'] : [],
            isBlocked: false,
          },
          processingFlow: 'pseudonymized',
          processingSteps: [
            `Dictionary pseudonymization: ${result.mappings.length} matches`,
          ],
          timestamps: {
            detectionStart: Date.now() - result.processingTimeMs,
            pseudonymApplied: Date.now(),
          },
        };

        return {
          processedText: result.pseudonymizedText,
          piiMetadata,
        };
      }

      // Note: Pseudonymization is now handled at the LLM service level via DictionaryPseudonymizerService
      const result = { pseudonymizedText: text, mappings: [] }; // No-op since pattern-based pseudonymization is removed

      return {
        processedText: result.pseudonymizedText,
        // Note: Standard pseudonymizer doesn't directly provide PIIProcessingMetadata
        // This would need to be adapted based on actual requirements
      };
    } catch (error) {
      this.logger.error('PII processing failed:', error);
      // Return original text if PII processing fails
      return { processedText: text };
    }
  }

  /**
   * Handle PII processing for output text (pseudonym reversal)
   */
  protected async handlePiiOutput(
    text: string,
    requestId?: string,
    mappings?: Array<Record<string, unknown>>,
  ): Promise<string> {
    try {
      if (!requestId && !mappings) {
        return text;
      }

      // For dictionary pseudonymizer, use the mappings directly
      if (mappings && Array.isArray(mappings)) {
        const result =
          await this.dictionaryPseudonymizerService.reversePseudonyms(
            text,
            mappings as unknown as DictionaryPseudonymMapping[],
          );
        return result.originalText;
      }

      // For standard pseudonymizer, use the request ID
      if (requestId) {
        // Note: Pseudonym reversal is now handled at the LLM service level via DictionaryPseudonymizerService
        const result = { originalText: text }; // No-op since pattern-based pseudonymization is removed
        return result.originalText;
      }

      return text;
    } catch (error) {
      this.logger.error('PII output processing failed:', error);
      return text;
    }
  }

  /**
   * Track usage metrics and costs
   */
  protected async trackUsage(
    context: ExecutionContext,
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    cost?: number,
    requestMetadata?: {
      requestId?: string;
      piiMetadata?: Record<string, unknown>;
      startTime?: number;
      endTime?: number;
      callerType?: string;
      callerName?: string;
    },
  ): Promise<void> {
    try {
      // Start metadata tracking if we have the necessary info
      if (requestMetadata?.startTime && context.userId) {
        // Derive full pseudonym mappings from PII metadata when available
        const derivePseudonymMappings = (
          piiMeta: unknown,
        ): Array<{ original: string; pseudonym: string; dataType: string }> => {
          try {
            const piiMetaAny = piiMeta as Record<string, unknown>;
            // Prefer explicit pseudonymsApplied if present
            if (
              Array.isArray(piiMetaAny?.pseudonymsApplied) &&
              piiMetaAny.pseudonymsApplied.length > 0
            ) {
              return piiMetaAny.pseudonymsApplied
                .map((m: unknown) => {
                  const match = m as Record<string, unknown>;
                  return {
                    original: (match.original ??
                      match.value ??
                      match.source ??
                      '') as string,
                    pseudonym: (match.pseudonym ?? '') as string,
                    dataType: (match.type ??
                      match.dataType ??
                      'custom') as string,
                  };
                })
                .filter(
                  (m: {
                    original: string;
                    pseudonym: string;
                    dataType: string;
                  }) => m.original && m.pseudonym,
                );
            }
            // Fallback to processedMatches
            const piiMetaAny2 = piiMeta as Record<string, unknown>;
            const matches =
              (
                piiMetaAny2?.pseudonymResults as
                  | Record<string, unknown>
                  | undefined
              )?.processedMatches ||
              (
                piiMetaAny2?.pseudonymInstructions as
                  | Record<string, unknown>
                  | undefined
              )?.targetMatches ||
              [];
            return (matches as unknown[])
              .filter(
                (m: unknown) => !!(m as Record<string, unknown>)?.pseudonym,
              )
              .map((m: unknown) => {
                const match = m as Record<string, unknown>;
                return {
                  original: (match.value ?? '') as string,
                  pseudonym: (match.pseudonym ?? '') as string,
                  dataType: (match.dataType ?? 'custom') as string,
                };
              })
              .filter(
                (m: {
                  original: string;
                  pseudonym: string;
                  dataType: string;
                }) => m.original && m.pseudonym,
              );
          } catch {
            return [];
          }
        };

        const piiMeta = requestMetadata.piiMetadata;

        const enhancedMetrics = piiMeta
          ? {
              dataSanitizationApplied:
                (piiMeta.piiDetected as boolean | undefined) ||
                (
                  piiMeta.patternRedactionResults as
                    | Record<string, unknown>
                    | undefined
                )?.applied ||
                false,
              sanitizationLevel:
                (piiMeta.sanitizationLevel as string | undefined) || 'none',
              piiDetected:
                (piiMeta.piiDetected as boolean | undefined) || false,
              showstopperDetected:
                (piiMeta.showstopperDetected as boolean | undefined) || false,
              piiTypes: Object.keys(
                (
                  piiMeta.detectionResults as
                    | Record<string, unknown>
                    | undefined
                )?.dataTypesSummary || {},
              ),
              // Extract pseudonym information from pseudonymInstructions
              pseudonymsUsed:
                (
                  (
                    piiMeta.pseudonymInstructions as
                      | Record<string, unknown>
                      | undefined
                  )?.targetMatches as unknown[] | undefined
                )?.length || 0,
              pseudonymTypes:
                (
                  (
                    piiMeta.pseudonymInstructions as
                      | Record<string, unknown>
                      | undefined
                  )?.targetMatches as unknown[] | undefined
                )?.map(
                  (m: unknown) =>
                    (m as Record<string, unknown>).dataType as string,
                ) || [],
              pseudonymMappings: derivePseudonymMappings(piiMeta),
              // Pattern redaction information
              patternRedactionsApplied:
                (
                  piiMeta.patternRedactionResults as
                    | Record<string, unknown>
                    | undefined
                )?.redactionCount || 0,
              patternRedactionTypes: (
                (piiMeta.patternRedactionMappings as
                  | Array<Record<string, unknown>>
                  | undefined) || []
              )
                .map((m) => m.dataType as string)
                .filter((t): t is string => !!t),
              // Pattern redactions count (actual redactions applied)
              redactionsApplied:
                (
                  piiMeta.patternRedactionResults as
                    | Record<string, unknown>
                    | undefined
                )?.redactionCount ||
                (
                  (
                    piiMeta.detectionResults as
                      | Record<string, unknown>
                      | undefined
                  )?.flaggedMatches as unknown[] | undefined
                )?.length ||
                0,
              redactionTypes:
                (
                  (piiMeta.patternRedactionMappings as
                    | Array<Record<string, unknown>>
                    | undefined) || []
                )
                  .map((m) => m.dataType as string)
                  .filter((t): t is string => !!t) ||
                (
                  (
                    piiMeta.detectionResults as
                      | Record<string, unknown>
                      | undefined
                  )?.flaggedMatches as unknown[] | undefined
                )?.map(
                  (m: unknown) =>
                    (m as Record<string, unknown>).dataType as string,
                ) ||
                [],
            }
          : ({
              dataSanitizationApplied: false,
              sanitizationLevel:
                provider === 'ollama' ? 'local-bypass' : 'none',
              piiDetected: false,
              showstopperDetected: false,
              piiTypes: [],
              pseudonymsUsed: 0,
              pseudonymTypes: [],
              pseudonymMappings: [],
              redactionsApplied: 0,
              redactionTypes: [],
              patternRedactionsApplied: 0,
              patternRedactionTypes: [],
            } as Record<string, unknown>);

        await this.runMetadataService.insertCompletedUsage({
          provider,
          model,
          isLocal: provider === 'ollama',
          userId: context.userId,
          callerType: requestMetadata.callerType,
          callerName: requestMetadata.callerName,
          conversationId: context.conversationId,
          inputTokens,
          outputTokens,
          totalCost: cost,
          startTime: requestMetadata.startTime,
          endTime: requestMetadata.endTime,
          status: 'completed',
          enhancedMetrics,
          runId: requestMetadata.requestId,
        });
      }
    } catch (error) {
      this.logger.error('Usage tracking failed:', error);
    }
  }

  /**
   * Generate a unique request ID
   */
  protected generateRequestId(prefix: string = 'req'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Estimate token count for text (simple approximation)
   * TODO: Replace with actual tokenizer for each provider
   */
  protected estimateTokens(text: string): number {
    if (!text) return 0;
    // Rough approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate cost based on provider pricing from database.
   * Uses LLMPricingService with cached pricing data for performance.
   */
  protected calculateCost(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): number | undefined {
    try {
      // Use LLMPricingService for DB-driven pricing (synchronous for metadata creation)
      if (this.llmPricingService) {
        return this.llmPricingService.calculateCostSync(
          provider,
          model,
          inputTokens,
          outputTokens,
        );
      }

      // Fallback to default pricing if service not available
      this.logger.warn(
        `LLMPricingService not available, using default pricing for ${provider}/${model}`,
      );
      const defaultInputPer1k = 0.001;
      const defaultOutputPer1k = 0.002;
      return (
        (inputTokens / 1000) * defaultInputPer1k +
        (outputTokens / 1000) * defaultOutputPer1k
      );
    } catch (error) {
      this.logger.error('Cost calculation failed:', error);
      return undefined;
    }
  }

  /**
   * Handle errors consistently across all providers
   */
  protected handleError(error: unknown, context: string): never {
    try {
      const provider = this.config?.provider || 'unknown';
      const model = this.config?.model;
      const mappedError = LLMErrorMapper.fromGenericError(
        error,
        provider,
        model,
      );
      LLMErrorMonitor.recordError(mappedError);
      throw mappedError;
    } catch {
      const err = error as Record<string, unknown>;
      const fallback = new LLMError(
        `${context}: ${String(err?.message) || 'Unknown error occurred'}`,
        LLMErrorType.UNKNOWN,
        this.config?.provider || 'unknown',
        { model: this.config?.model, originalError: error },
      );
      LLMErrorMonitor.recordError(fallback);
      throw fallback;
    }
  }

  /**
   * Validate configuration before processing
   */
  protected validateConfig(config: LLMServiceConfig): void {
    if (!config.provider) {
      throw new Error('Provider must be specified in configuration');
    }

    if (!config.model) {
      throw new Error('Model must be specified in configuration');
    }

    // Additional provider-specific validation can be implemented in subclasses
  }

  /**
   * Optional LangSmith integration hook
   * Subclasses can override this to provide LangSmith integration
   */
  protected integrateLangSmith(
    _params: GenerateResponseParams,
    _response: LLMResponse,
  ): Promise<string | undefined> {
    // Default implementation returns undefined (no LangSmith integration)
    // Subclasses can override this method to provide actual integration
    return Promise.resolve(undefined);
  }

  /**
   * Log request/response for debugging and monitoring
   */
  protected logRequestResponse(
    _params: GenerateResponseParams,
    _response: LLMResponse,
    _duration: number,
  ): void {
    // Logging removed for performance
  }
}
