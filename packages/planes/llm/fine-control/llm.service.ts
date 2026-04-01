import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@orchestrator-ai/transport-types';
import OpenAI from 'openai';
import {
  UnifiedGenerateResponseParams,
  LLMResponse,
  LLMRequestOptions,
  ImageGenerationResponse,
  VideoGenerationResponse,
} from './services/llm-interfaces';
import { CIDAFMOptions, SystemLLMConfigs } from './types/llm-evaluation';
import { ModelConfigurationService } from './config/model-configuration.service';
import {
  ObservabilityWebhookService,
  ObservabilityEventsService,
  type ObservabilityEventRecord,
} from '@orchestratorai/planes/observability';
import { LLMGenerationService } from './services/llm-generation.service';
import { LLMImageService } from './services/llm-image.service';
import { LLMVideoService } from './services/llm-video.service';
import { ModelsService } from './models/models.service';
import { ProvidersService } from './providers/providers.service';
import type { LLMModelInfo, LLMProviderInfo } from '@orchestratorai/planes/llm';

type GenerateResponseOptions = LLMRequestOptions & {
  provider?: 'openai' | 'anthropic' | 'ollama' | 'google';
  cidafmOptions?: CIDAFMOptions;
  complexity?: 'simple' | 'medium' | 'complex' | 'reasoning';
  images?: Array<{ base64: string; mimeType: string }>;
};

// Explicitly set LangSmith environment variables for automatic tracing
const langsmithEnabled =
  process.env.LANGSMITH_TRACING === 'true' ||
  process.env.LANGSMITH_ENABLED === 'true';
const langsmithApiKey = process.env.LANGSMITH_API_KEY;
const langsmithProject =
  process.env.LANGSMITH_PROJECT ||
  process.env.LANGSMITH_PROJECT_NAME ||
  'orchestrator-ai';

if (langsmithEnabled && langsmithApiKey) {
  process.env.LANGCHAIN_TRACING_V2 = 'true';
  process.env.LANGCHAIN_API_KEY = langsmithApiKey;
  process.env.LANGCHAIN_PROJECT = langsmithProject;
  if (process.env.LANGSMITH_ENDPOINT) {
    process.env.LANGCHAIN_ENDPOINT = process.env.LANGSMITH_ENDPOINT;
  }
}

/**
 * LLMService - Orchestrator service for all LLM operations
 *
 * This service has been refactored to delegate to focused services:
 * - LLMGenerationService: Text generation operations
 * - LLMImageService: Image generation operations
 * - LLMVideoService: Video generation operations
 *
 * All methods maintain backward compatibility while delegating to the
 * appropriate focused service. The service is now under 500 lines.
 */
@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);
  private openai: OpenAI | null = null;
  public readonly systemLLMConfigs: SystemLLMConfigs;
  private readonly debugEnabled: boolean;

  constructor(
    private readonly llmGenerationService: LLMGenerationService,
    private readonly llmImageService: LLMImageService,
    private readonly llmVideoService: LLMVideoService,
    private readonly modelConfigurationService: ModelConfigurationService,
    private readonly observabilityService: ObservabilityWebhookService,
    private readonly observabilityEventsService: ObservabilityEventsService,
    private readonly modelsService: ModelsService,
    private readonly providersService: ProvidersService,
  ) {
    // Initialize OpenAI client only if API key is available
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }

    // Initialize empty system configs (deprecated - using ModelConfigurationService)
    this.systemLLMConfigs = {} as SystemLLMConfigs;

    // Disable verbose debug logs by default
    this.debugEnabled = false;
  }

  // =============================================================================
  // TEXT GENERATION - Delegated to LLMGenerationService
  // =============================================================================

  /**
   * Simple LLM call with system and user messages
   *
   * @deprecated Use LLMGenerationService.generateResponse directly for new code.
   *             This method is maintained for backward compatibility.
   */
  async generateResponse(
    systemPrompt: string,
    userMessage: string,
    options?: GenerateResponseOptions,
  ): Promise<string | LLMResponse> {
    const executionContext = options?.executionContext;

    // ExecutionContext is required
    if (!executionContext) {
      throw new Error(
        'ExecutionContext is required for generateResponse. Pass executionContext in options.',
      );
    }

    // Defense-in-depth: Validate sovereign mode compliance
    this.validateSovereignModeProvider(executionContext);

    // Emit LLM started event
    this.emitLlmObservabilityEvent('agent.llm.started', executionContext, {
      provider: executionContext.provider,
      model: executionContext.model,
      message: 'LLM call started',
      systemPromptPreview: systemPrompt.substring(0, 500),
      userMessagePreview: userMessage.substring(0, 500),
    });

    try {
      const result = await this.llmGenerationService.generateResponse(
        executionContext,
        systemPrompt,
        userMessage,
        options,
      );

      // Emit LLM completed event
      this.emitLlmObservabilityEvent('agent.llm.completed', executionContext, {
        provider: executionContext.provider,
        model: executionContext.model,
        message: 'LLM call completed',
        responsePreview:
          typeof result === 'string'
            ? result.substring(0, 500)
            : result.content?.substring(0, 500),
      });

      return result;
    } catch (error) {
      // Emit LLM failed event
      this.emitLlmObservabilityEvent('agent.llm.failed', executionContext, {
        provider: executionContext.provider,
        model: executionContext.model,
        message: 'LLM call failed',
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Unified generateResponse method - the new entry point for all LLM requests
   *
   * @deprecated Use LLMGenerationService.generateUnifiedResponse directly for new code.
   *             This method is maintained for backward compatibility.
   */
  async generateUnifiedResponse(
    params: UnifiedGenerateResponseParams,
  ): Promise<string | LLMResponse> {
    const executionContext = params.options?.executionContext;

    // Emit LLM started event
    if (executionContext) {
      this.emitLlmObservabilityEvent('agent.llm.started', executionContext, {
        provider: params.provider,
        model: params.model,
        message: 'LLM call started',
        systemPromptPreview: params.systemPrompt.substring(0, 500),
        userMessagePreview: params.userMessage.substring(0, 500),
      });
    }

    try {
      if (!executionContext) {
        throw new Error(
          'ExecutionContext is required in options for generateUnifiedResponse',
        );
      }

      // Defense-in-depth: Validate sovereign mode compliance
      this.validateSovereignModeProvider(executionContext);

      const result = await this.llmGenerationService.generateUnifiedResponse(
        executionContext,
        params,
      );

      // Emit LLM completed event
      if (executionContext) {
        this.emitLlmObservabilityEvent(
          'agent.llm.completed',
          executionContext,
          {
            provider: params.provider,
            model: params.model,
            message: 'LLM call completed',
            responsePreview:
              typeof result === 'string'
                ? result.substring(0, 500)
                : result.content?.substring(0, 500),
          },
        );
      }

      return result;
    } catch (error) {
      // Emit LLM failed event
      if (executionContext) {
        this.emitLlmObservabilityEvent('agent.llm.failed', executionContext, {
          provider: params.provider,
          model: params.model,
          message: 'LLM call failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      throw error;
    }
  }

  // =============================================================================
  // IMAGE GENERATION - Delegated to LLMImageService
  // =============================================================================

  /**
   * Generate image using provider-specific image generation APIs
   *
   * @deprecated Use LLMImageService.generateImage directly for new code.
   *             This method is maintained for backward compatibility.
   */
  async generateImage(params: {
    provider: string;
    model: string;
    prompt: string;
    size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd';
    style?: 'natural' | 'vivid';
    numberOfImages?: number;
    referenceImageUrl?: string;
    background?: 'transparent' | 'opaque' | 'auto';
    executionContext: ExecutionContext;
  }): Promise<ImageGenerationResponse> {
    const { executionContext, ...imageParams } = params;

    // Emit observability event
    this.emitLlmObservabilityEvent('agent.llm.started', executionContext, {
      provider: params.provider,
      model: params.model,
      message: 'Image generation started',
      promptPreview: imageParams.prompt.substring(0, 500),
      type: 'image-generation',
    });

    try {
      const response = await this.llmImageService.generateImage(
        executionContext,
        imageParams,
      );

      // Emit completion event
      this.emitLlmObservabilityEvent('agent.llm.completed', executionContext, {
        provider: params.provider,
        model: params.model,
        message: 'Image generation completed',
        imagesGenerated: response.images.length,
        type: 'image-generation',
      });

      return response;
    } catch (error) {
      // Emit error event
      this.emitLlmObservabilityEvent('agent.llm.failed', executionContext, {
        provider: params.provider,
        model: params.model,
        message: 'Image generation failed',
        error: error instanceof Error ? error.message : String(error),
        type: 'image-generation',
      });

      throw error;
    }
  }

  // =============================================================================
  // VIDEO GENERATION - Delegated to LLMVideoService
  // =============================================================================

  /**
   * Generate video using provider-specific video generation APIs
   *
   * @deprecated Use LLMVideoService.generateVideo directly for new code.
   *             This method is maintained for backward compatibility.
   */
  async generateVideo(params: {
    provider: string;
    model: string;
    prompt: string;
    duration?: number;
    aspectRatio?: '16:9' | '9:16';
    resolution?: '720p' | '1080p' | '4k';
    firstFrameImageUrl?: string;
    firstFrameImage?: Buffer;
    lastFrameImageUrl?: string;
    lastFrameImage?: Buffer;
    generateAudio?: boolean;
    executionContext: ExecutionContext;
  }): Promise<VideoGenerationResponse> {
    const { executionContext, ...videoParams } = params;

    // Emit observability event
    this.emitLlmObservabilityEvent('agent.llm.started', executionContext, {
      provider: params.provider,
      model: params.model,
      message: 'Video generation started',
      promptPreview: videoParams.prompt.substring(0, 500),
      type: 'video-generation',
    });

    try {
      const response = await this.llmVideoService.generateVideo(
        executionContext,
        videoParams,
      );

      // Emit processing event (video generation is async)
      this.emitLlmObservabilityEvent('agent.llm.processing', executionContext, {
        provider: params.provider,
        model: params.model,
        message: 'Video generation in progress',
        operationId: response.operationId,
        type: 'video-generation',
      });

      return response;
    } catch (error) {
      // Emit error event
      this.emitLlmObservabilityEvent('agent.llm.failed', executionContext, {
        provider: params.provider,
        model: params.model,
        message: 'Video generation failed',
        error: error instanceof Error ? error.message : String(error),
        type: 'video-generation',
      });

      throw error;
    }
  }

  /**
   * Poll video generation status
   *
   * @deprecated Use LLMVideoService.pollVideoStatus directly for new code.
   *             This method is maintained for backward compatibility.
   */
  async pollVideoStatus(params: {
    provider: string;
    model?: string;
    operationId: string;
    executionContext: ExecutionContext;
  }): Promise<VideoGenerationResponse> {
    const { executionContext, operationId } = params;

    try {
      const response = await this.llmVideoService.pollVideoStatus(
        executionContext,
        operationId,
      );

      // Emit completion event if video is done
      if (response.status === 'completed') {
        this.emitLlmObservabilityEvent(
          'agent.llm.completed',
          executionContext,
          {
            provider: params.provider,
            model: params.model || 'unknown',
            message: 'Video generation completed',
            operationId,
            type: 'video-generation',
          },
        );
      } else if (response.status === 'failed') {
        this.emitLlmObservabilityEvent('agent.llm.failed', executionContext, {
          provider: params.provider,
          model: params.model || 'unknown',
          message: 'Video generation failed',
          operationId,
          error: response.error?.message,
          type: 'video-generation',
        });
      }

      return response;
    } catch (error) {
      this.logger.error('Failed to poll video status:', error);
      throw error;
    }
  }

  // =============================================================================
  // MODEL CATALOG - Delegates to DB-backed services (fine_control mode)
  // =============================================================================

  async listModels(filters?: {
    modelType?: string;
    sovereignMode?: boolean;
  }): Promise<LLMModelInfo[]> {
    const dbModels = await this.modelsService.findAll({
      modelType: filters?.modelType as
        | 'text-generation'
        | 'image-generation'
        | 'video-generation'
        | 'reasoning'
        | 'code-generation'
        | undefined,
      sovereignMode: filters?.sovereignMode,
    });

    return dbModels.map((m) => ({
      id: m.modelName,
      name: m.name || m.modelName,
      providerName: m.providerName,
      modelType: 'text-generation' as const,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxTokens,
      pricing:
        m.pricingInputPer1k || m.pricingOutputPer1k
          ? {
              inputPer1M: m.pricingInputPer1k
                ? m.pricingInputPer1k * 1000
                : undefined,
              outputPer1M: m.pricingOutputPer1k
                ? m.pricingOutputPer1k * 1000
                : undefined,
            }
          : undefined,
      capabilities: m.supportsThinking ? ['reasoning'] : [],
      isLocal: m.providerName?.toLowerCase() === 'ollama',
    }));
  }

  async listProviders(): Promise<LLMProviderInfo[]> {
    const dbProviders = await this.providersService.findAll('active');

    return dbProviders.map((p) => ({
      name: p.name,
      displayName: p.name,
      status: 'active' as const,
    }));
  }

  // =============================================================================
  // OBSERVABILITY - Shared utilities
  // =============================================================================

  /**
   * Emit observability event for LLM lifecycle
   */
  emitLlmObservabilityEvent(
    hook_event_type: string,
    executionContext: ExecutionContext,
    payload?: Record<string, unknown>,
  ): void {
    try {
      const event: ObservabilityEventRecord = {
        context: executionContext,
        source_app: 'orchestrator-ai',
        hook_event_type,
        status: hook_event_type,
        message: (payload?.message as string | null) ?? null,
        progress: null,
        step: 'llm',
        payload: payload ?? {},
        timestamp: Date.now(),
      };

      void this.observabilityEventsService.push(event);
    } catch (error) {
      // Silently ignore observability errors to avoid disrupting main flow
      this.logger.debug(
        `Failed to emit LLM observability event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
        `Sovereign mode violation in LLM Service: Provider "${provider}" is not allowed. ` +
          `Only local providers (ollama) are permitted when sovereignMode is active.`,
      );
      throw new ForbiddenException(
        `Sovereign mode is active. Provider "${provider}" is not allowed. ` +
          `Only local providers (ollama) are permitted.`,
      );
    }
  }
}
