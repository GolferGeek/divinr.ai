import { Injectable, Logger } from '@nestjs/common';
import { ExecutionContext } from '@orchestrator-ai/transport-types';
import { LLMServiceFactory } from './llm-service-factory';
import { LLMServiceConfig, VideoGenerationResponse } from './llm-interfaces';

/**
 * LLMVideoService - Focused service for LLM video generation
 *
 * This service handles all video generation operations including:
 * - Text-to-video generation
 * - Image-to-video generation
 * - Video extension
 * - Async video generation with polling
 * - Provider-specific video features (OpenAI Sora 2, Google Veo 3)
 *
 * All methods accept ExecutionContext as the first parameter to ensure
 * proper tracking, observability, and compliance with architectural patterns.
 */
@Injectable()
export class LLMVideoService {
  private readonly logger = new Logger(LLMVideoService.name);

  constructor(private readonly llmServiceFactory: LLMServiceFactory) {}

  /**
   * Generate video using provider-specific video generation APIs
   *
   * Routes to the appropriate provider (OpenAI Sora 2, Google Veo 3) based on ExecutionContext.
   * Video generation is async - returns an operationId for polling.
   *
   * @param executionContext - ExecutionContext (REQUIRED) - contains provider, model, tracking info
   * @param params - Video generation parameters including prompt, duration, aspectRatio
   * @returns VideoGenerationResponse with operationId for polling
   *
   * @example
   * ```typescript
   * const response = await llmVideoService.generateVideo(
   *   executionContext,
   *   {
   *     prompt: 'A cat walking through a garden',
   *     duration: 8,
   *     aspectRatio: '16:9',
   *   }
   * );
   * // Poll for completion
   * let status = await llmVideoService.pollVideoStatus(
   *   executionContext,
   *   response.operationId!,
   * );
   * ```
   */
  async generateVideo(
    executionContext: ExecutionContext,
    params: {
      prompt: string;
      duration?: number;
      aspectRatio?: '16:9' | '9:16';
      resolution?: '720p' | '1080p' | '4k';
      firstFrameImageUrl?: string;
      firstFrameImage?: Buffer;
      lastFrameImageUrl?: string;
      lastFrameImage?: Buffer;
      generateAudio?: boolean;
    },
  ): Promise<VideoGenerationResponse> {
    // Validate ExecutionContext
    if (!executionContext) {
      throw new Error('ExecutionContext is required for generateVideo');
    }

    const provider = executionContext.provider;
    const model = executionContext.model;

    if (!provider || !model) {
      throw new Error(
        'ExecutionContext must contain provider and model for video generation',
      );
    }

    // Validate provider supports video generation
    const supportedVideoProviders = ['openai', 'google'];
    if (!supportedVideoProviders.includes(provider.toLowerCase())) {
      throw new Error(
        `Video generation not supported for provider: ${provider}. Supported providers: ${supportedVideoProviders.join(', ')}`,
      );
    }

    try {
      // Create service configuration
      const config: LLMServiceConfig = {
        provider,
        model,
      };

      // Get the service from factory
      const service = await this.llmServiceFactory.createService(config);

      // Check if the service supports video generation
      if (!service.generateVideo) {
        throw new Error(
          `Provider ${provider} service does not implement video generation`,
        );
      }

      // Call the service's generateVideo method
      const response = await service.generateVideo(executionContext, params);

      return response;
    } catch (error) {
      // Return error response
      return {
        status: 'failed',
        metadata: {
          provider,
          model,
          requestId: executionContext.conversationId,
          timestamp: new Date().toISOString(),
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          timing: { startTime: Date.now(), endTime: Date.now(), duration: 0 },
          status: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
        },
        error: {
          code: 'VIDEO_GENERATION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Poll video generation status
   *
   * Call this method periodically after generateVideo() to check completion.
   * When status is 'completed', the response will include videoData and videoUrl.
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @param operationId - Operation ID returned from generateVideo()
   * @returns VideoGenerationResponse with current status
   *
   * @example
   * ```typescript
   * let status = await llmVideoService.pollVideoStatus(
   *   executionContext,
   *   'operation-123',
   * );
   * while (status.status === 'processing') {
   *   await new Promise(resolve => setTimeout(resolve, 5000));
   *   status = await llmVideoService.pollVideoStatus(
   *     executionContext,
   *     'operation-123',
   *   );
   * }
   * ```
   */
  async pollVideoStatus(
    executionContext: ExecutionContext,
    operationId: string,
  ): Promise<VideoGenerationResponse> {
    // Validate ExecutionContext
    if (!executionContext) {
      throw new Error('ExecutionContext is required for pollVideoStatus');
    }

    const provider = executionContext.provider;
    const model = executionContext.model;

    if (!provider) {
      throw new Error(
        'ExecutionContext must contain provider for video polling',
      );
    }

    try {
      // Create service configuration
      const config: LLMServiceConfig = {
        provider,
        model: model || (provider === 'openai' ? 'sora-2' : 'veo-3-generate'),
      };

      // Get the service from factory
      const service = await this.llmServiceFactory.createService(config);

      // Check if the service supports video polling
      if (!service.pollVideoStatus) {
        throw new Error(
          `Provider ${provider} service does not implement video status polling`,
        );
      }

      // Call the service's pollVideoStatus method
      const response = await service.pollVideoStatus(
        operationId,
        executionContext,
      );

      return response;
    } catch (error) {
      return {
        operationId,
        status: 'failed',
        metadata: {
          provider,
          model: model || 'unknown',
          requestId: executionContext.conversationId,
          timestamp: new Date().toISOString(),
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          timing: { startTime: Date.now(), endTime: Date.now(), duration: 0 },
          status: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
        },
        error: {
          code: 'VIDEO_POLL_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Generate video from image (image-to-video)
   *
   * Creates a video starting from a provided image, animating it according to the prompt.
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @param params - Image-to-video parameters
   * @returns VideoGenerationResponse with operationId for polling
   *
   * @example
   * ```typescript
   * const response = await llmVideoService.generateVideoFromImage(
   *   executionContext,
   *   {
   *     prompt: 'Make the scene come alive',
   *     firstFrameImage: imageBuffer,
   *     duration: 8,
   *   }
   * );
   * ```
   */
  async generateVideoFromImage(
    executionContext: ExecutionContext,
    params: {
      prompt: string;
      firstFrameImage: Buffer;
      duration?: number;
      aspectRatio?: '16:9' | '9:16';
      resolution?: '720p' | '1080p' | '4k';
      generateAudio?: boolean;
    },
  ): Promise<VideoGenerationResponse> {
    // Validate ExecutionContext
    if (!executionContext) {
      throw new Error(
        'ExecutionContext is required for generateVideoFromImage',
      );
    }

    // Delegate to generateVideo with firstFrameImage parameter
    return this.generateVideo(executionContext, {
      prompt: params.prompt,
      firstFrameImage: params.firstFrameImage,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      generateAudio: params.generateAudio,
    });
  }

  /**
   * Extend an existing video
   *
   * Creates a continuation of an existing video based on a prompt.
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @param params - Video extension parameters
   * @returns VideoGenerationResponse with operationId for polling
   *
   * @example
   * ```typescript
   * const response = await llmVideoService.extendVideo(
   *   executionContext,
   *   {
   *     prompt: 'Continue the scene with the cat entering a house',
   *     videoUrl: 'https://...',
   *     duration: 8,
   *   }
   * );
   * ```
   */
  async extendVideo(
    executionContext: ExecutionContext,
    params: {
      prompt: string;
      videoUrl: string;
      duration?: number;
      generateAudio?: boolean;
    },
  ): Promise<VideoGenerationResponse> {
    // Validate ExecutionContext
    if (!executionContext) {
      throw new Error('ExecutionContext is required for extendVideo');
    }

    const provider = executionContext.provider;
    const model = executionContext.model;

    if (!provider || !model) {
      throw new Error(
        'ExecutionContext must contain provider and model for video extension',
      );
    }

    try {
      const config: LLMServiceConfig = {
        provider,
        model,
      };

      const service = await this.llmServiceFactory.createService(config);

      if (!service.generateVideo) {
        throw new Error(
          `Provider ${provider} service does not implement video generation`,
        );
      }

      // Call with extendVideoUrl parameter
      const response = await service.generateVideo(executionContext, {
        prompt: params.prompt,
        extendVideoUrl: params.videoUrl,
        duration: params.duration,
        generateAudio: params.generateAudio,
      });

      return response;
    } catch (error) {
      return {
        status: 'failed',
        metadata: {
          provider,
          model,
          requestId: executionContext.conversationId,
          timestamp: new Date().toISOString(),
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          timing: { startTime: Date.now(), endTime: Date.now(), duration: 0 },
          status: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
        },
        error: {
          code: 'VIDEO_EXTENSION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Check if a provider supports video generation
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @returns boolean indicating if provider supports video generation
   */
  supportsVideoGeneration(executionContext: ExecutionContext): boolean {
    if (!executionContext || !executionContext.provider) {
      return false;
    }

    const supportedProviders = ['openai', 'google'];
    return supportedProviders.includes(executionContext.provider.toLowerCase());
  }

  /**
   * Check if a provider supports image-to-video
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @returns boolean indicating if provider supports image-to-video
   */
  supportsImageToVideo(executionContext: ExecutionContext): boolean {
    if (!executionContext || !executionContext.provider) {
      return false;
    }

    // Both OpenAI Sora 2 and Google Veo 3 support image-to-video
    const supportedProviders = ['openai', 'google'];
    return supportedProviders.includes(executionContext.provider.toLowerCase());
  }

  /**
   * Check if a provider supports video extension
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @returns boolean indicating if provider supports video extension
   */
  supportsVideoExtension(executionContext: ExecutionContext): boolean {
    if (!executionContext || !executionContext.provider) {
      return false;
    }

    // OpenAI Sora 2 supports video extension
    return executionContext.provider.toLowerCase() === 'openai';
  }

  /**
   * Check if a provider supports audio generation with video
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @returns boolean indicating if provider supports audio generation
   */
  supportsAudioGeneration(executionContext: ExecutionContext): boolean {
    if (!executionContext || !executionContext.provider) {
      return false;
    }

    // OpenAI Sora 2 supports audio generation
    return executionContext.provider.toLowerCase() === 'openai';
  }
}
