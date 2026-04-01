import { Injectable, Logger } from '@nestjs/common';
import { ExecutionContext } from '@orchestrator-ai/transport-types';
import { LLMServiceFactory } from './llm-service-factory';
import { LLMServiceConfig, ImageGenerationResponse } from './llm-interfaces';

/**
 * LLMImageService - Focused service for LLM image generation
 *
 * This service handles all image generation operations including:
 * - Text-to-image generation
 * - Image editing with masks
 * - Image variations
 * - Provider-specific image features (OpenAI GPT Image, DALL-E, Google Imagen)
 *
 * All methods accept ExecutionContext as the first parameter to ensure
 * proper tracking, observability, and compliance with architectural patterns.
 */
@Injectable()
export class LLMImageService {
  private readonly logger = new Logger(LLMImageService.name);

  constructor(private readonly llmServiceFactory: LLMServiceFactory) {}

  /**
   * Generate image using provider-specific image generation APIs
   *
   * Routes to the appropriate provider (OpenAI, Google) based on ExecutionContext.
   * Uses provider/model from context, which must be image generation models.
   *
   * @param executionContext - ExecutionContext (REQUIRED) - contains provider, model, tracking info
   * @param params - Image generation parameters including prompt, size, quality
   * @returns ImageGenerationResponse with generated image bytes and metadata
   *
   * @example
   * ```typescript
   * const response = await llmImageService.generateImage(
   *   executionContext,
   *   {
   *     prompt: 'A sunset over mountains',
   *     size: '1024x1024',
   *     quality: 'hd',
   *   }
   * );
   * ```
   */
  async generateImage(
    executionContext: ExecutionContext,
    params: {
      prompt: string;
      size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
      quality?: 'standard' | 'hd';
      style?: 'natural' | 'vivid';
      numberOfImages?: number;
      referenceImageUrl?: string;
      background?: 'transparent' | 'opaque' | 'auto';
    },
  ): Promise<ImageGenerationResponse> {
    // Validate ExecutionContext
    if (!executionContext) {
      throw new Error('ExecutionContext is required for generateImage');
    }

    const provider = executionContext.provider;
    const model = executionContext.model;

    if (!provider || !model) {
      throw new Error(
        'ExecutionContext must contain provider and model for image generation',
      );
    }

    // Validate provider supports image generation
    const supportedImageProviders = ['openai', 'google'];
    if (!supportedImageProviders.includes(provider.toLowerCase())) {
      throw new Error(
        `Image generation not supported for provider: ${provider}. Supported providers: ${supportedImageProviders.join(', ')}`,
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

      // Check if the service supports image generation
      if (!service.generateImage) {
        throw new Error(
          `Provider ${provider} service does not implement image generation`,
        );
      }

      // Call the service's generateImage method
      const response = await service.generateImage(executionContext, params);

      return response;
    } catch (error) {
      // Return error response
      return {
        images: [],
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
          code: 'IMAGE_GENERATION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Generate image with editing capabilities (inpainting)
   *
   * This method allows you to edit an existing image by providing a mask
   * that indicates which areas should be regenerated based on the prompt.
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @param params - Image editing parameters
   * @returns ImageGenerationResponse with edited image
   *
   * @example
   * ```typescript
   * const response = await llmImageService.generateImageEdit(
   *   executionContext,
   *   {
   *     prompt: 'Add a cat to the scene',
   *     referenceImage: imageBuffer,
   *     mask: maskBuffer, // Transparent areas indicate where to edit
   *   }
   * );
   * ```
   */
  async generateImageEdit(
    executionContext: ExecutionContext,
    params: {
      prompt: string;
      referenceImage: Buffer;
      mask?: Buffer;
      size?: '256x256' | '512x512' | '1024x1024';
      numberOfImages?: number;
    },
  ): Promise<ImageGenerationResponse> {
    // Validate ExecutionContext
    if (!executionContext) {
      throw new Error('ExecutionContext is required for generateImageEdit');
    }

    const provider = executionContext.provider;
    const model = executionContext.model;

    if (!provider || !model) {
      throw new Error(
        'ExecutionContext must contain provider and model for image editing',
      );
    }

    // Only OpenAI supports image editing currently
    if (provider.toLowerCase() !== 'openai') {
      throw new Error(
        `Image editing is only supported for OpenAI. Current provider: ${provider}`,
      );
    }

    try {
      const config: LLMServiceConfig = {
        provider,
        model,
      };

      const service = await this.llmServiceFactory.createService(config);

      if (!service.generateImage) {
        throw new Error(
          `Provider ${provider} service does not implement image generation`,
        );
      }

      // OpenAI image editing uses the same generateImage method with different parameters
      const response = await service.generateImage(executionContext, {
        prompt: params.prompt,
        referenceImage: params.referenceImage,
        mask: params.mask,
        size: params.size,
        numberOfImages: params.numberOfImages,
      });

      return response;
    } catch (error) {
      return {
        images: [],
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
          code: 'IMAGE_EDIT_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Generate variations of an existing image
   *
   * This method creates variations of a given image, maintaining the style
   * and content but with slight differences.
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @param params - Image variation parameters
   * @returns ImageGenerationResponse with image variations
   *
   * @example
   * ```typescript
   * const response = await llmImageService.generateImageVariation(
   *   executionContext,
   *   {
   *     referenceImage: imageBuffer,
   *     numberOfImages: 4,
   *   }
   * );
   * ```
   */
  async generateImageVariation(
    executionContext: ExecutionContext,
    params: {
      referenceImage: Buffer;
      size?: '256x256' | '512x512' | '1024x1024';
      numberOfImages?: number;
    },
  ): Promise<ImageGenerationResponse> {
    // Validate ExecutionContext
    if (!executionContext) {
      throw new Error(
        'ExecutionContext is required for generateImageVariation',
      );
    }

    const provider = executionContext.provider;
    const model = executionContext.model;

    if (!provider || !model) {
      throw new Error(
        'ExecutionContext must contain provider and model for image variation',
      );
    }

    // Only OpenAI supports image variations currently
    if (provider.toLowerCase() !== 'openai') {
      throw new Error(
        `Image variations are only supported for OpenAI. Current provider: ${provider}`,
      );
    }

    try {
      const config: LLMServiceConfig = {
        provider,
        model,
      };

      const service = await this.llmServiceFactory.createService(config);

      if (!service.generateImage) {
        throw new Error(
          `Provider ${provider} service does not implement image generation`,
        );
      }

      // OpenAI variations use the same generateImage method with empty prompt
      const response = await service.generateImage(executionContext, {
        prompt: '', // Empty prompt for variations
        referenceImage: params.referenceImage,
        size: params.size,
        numberOfImages: params.numberOfImages,
      });

      return response;
    } catch (error) {
      return {
        images: [],
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
          code: 'IMAGE_VARIATION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Check if a provider supports image generation
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @returns boolean indicating if provider supports image generation
   */
  supportsImageGeneration(executionContext: ExecutionContext): boolean {
    if (!executionContext || !executionContext.provider) {
      return false;
    }

    const supportedProviders = ['openai', 'google'];
    return supportedProviders.includes(executionContext.provider.toLowerCase());
  }

  /**
   * Check if a provider supports image editing
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @returns boolean indicating if provider supports image editing
   */
  supportsImageEditing(executionContext: ExecutionContext): boolean {
    if (!executionContext || !executionContext.provider) {
      return false;
    }

    // Currently only OpenAI supports image editing
    return executionContext.provider.toLowerCase() === 'openai';
  }

  /**
   * Check if a provider supports image variations
   *
   * @param executionContext - ExecutionContext (REQUIRED)
   * @returns boolean indicating if provider supports image variations
   */
  supportsImageVariations(executionContext: ExecutionContext): boolean {
    if (!executionContext || !executionContext.provider) {
      return false;
    }

    // Currently only OpenAI supports image variations
    return executionContext.provider.toLowerCase() === 'openai';
  }
}
