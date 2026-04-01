import { Injectable } from '@nestjs/common';
import {
  ExecutionContext,
  createMockExecutionContext,
} from '@orchestrator-ai/transport-types';
import { BaseLLMService } from './base-llm.service';
import {
  GenerateResponseParams,
  LLMResponse,
  LLMServiceConfig,
  ResponseMetadata,
  ImageGenerationParams,
  ImageGenerationResponse,
  ImageMetadata,
  VideoGenerationParams,
  VideoGenerationResponse,
  VideoMetadata,
} from './llm-interfaces';
import { PIIService } from '../pii/pii.service';
import { DictionaryPseudonymizerService } from '../pii/dictionary-pseudonymizer.service';
import { RunMetadataService } from '../run-metadata.service';
import { ProviderConfigService } from '../provider-config.service';
import { LLMPricingService } from '../llm-pricing.service';
import OpenAI from 'openai';
import { getModelRestrictions } from '../config/model-restrictions.config';
import type { OpenAIChatCompletionRequest } from '../types/provider-payload.types';
import { openAIChatCompletionSchema } from '../types/provider-schemas';
import type { OpenAIChatCompletionParsed } from '../types/provider-schemas';

/**
 * OpenAI-specific response metadata extension
 */
interface OpenAIResponseMetadata extends ResponseMetadata {
  providerSpecific: {
    finish_reason:
      | 'stop'
      | 'length'
      | 'function_call'
      | 'content_filter'
      | 'tool_calls'
      | null;
    system_fingerprint?: string;
    model_version?: string;
    logprobs?: unknown;
    // OpenAI usage details
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * OpenAI LLM Service Implementation
 *
 * This example shows how to extend BaseLLMService for OpenAI-specific functionality
 * while maintaining compatibility with the standardized interface.
 */
@Injectable()
export class OpenAILLMService extends BaseLLMService {
  private openai: OpenAI;

  constructor(
    config: LLMServiceConfig,
    piiService: PIIService,
    dictionaryPseudonymizerService: DictionaryPseudonymizerService,
    runMetadataService: RunMetadataService,
    providerConfigService: ProviderConfigService,
    llmPricingService?: LLMPricingService,
  ) {
    super(
      config,
      piiService,
      dictionaryPseudonymizerService,
      runMetadataService,
      providerConfigService,
      llmPricingService,
    );

    // Initialize OpenAI client
    this.openai = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      baseURL: config.baseUrl,
    });
  }

  /**
   * Implementation of the abstract generateResponse method for OpenAI
   */
  async generateResponse(
    context: ExecutionContext,
    params: GenerateResponseParams,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId('openai');

    try {
      // Validate configuration
      this.validateConfig(params.config);

      // Handle PII in input - use what's already been processed at LLM Service level
      let piiResult;
      if (params.options?.piiMetadata) {
        // Use existing PII metadata from LLM Service level processing

        // The text has already been pseudonymized at LLM Service level
        piiResult = {
          processedText: params.userMessage, // Already processed
          piiMetadata: params.options.piiMetadata,
          dictionaryMappings: params.options?.dictionaryMappings || [], // Already applied at LLM Service level
        };
      } else {
        // Fallback - shouldn't happen if LLM Service is processing correctly
        this.logger.warn(
          `⚠️ [PII-METADATA-DEBUG] OpenAILLMService - No PII metadata from LLM Service, skipping PII processing`,
        );
        piiResult = {
          processedText: params.userMessage,
          piiMetadata: null,
          dictionaryMappings: [],
        };
      }

      // Normalize config for model-specific restrictions
      const normalizedConfig = this.normalizeConfigForModel(params.config);

      // Prepare OpenAI request with model-specific handling
      const messages = this.prepareMessagesForModel(
        normalizedConfig.model,
        params.systemPrompt,
        piiResult.processedText,
        params.images,
      );

      // Build API request parameters, respecting model restrictions
      const apiParams: OpenAIChatCompletionRequest = {
        model: normalizedConfig.model,
        messages,
        stream: false,
      };

      // Only add temperature if the normalized config includes it
      if (normalizedConfig.temperature !== undefined) {
        apiParams.temperature = normalizedConfig.temperature;
      }

      // Add max_tokens or max_completion_tokens based on model requirements
      if (params.options?.maxTokens ?? normalizedConfig.maxTokens) {
        let maxTokensValue =
          params.options?.maxTokens ?? normalizedConfig.maxTokens;

        // Check if model has a minimum token requirement
        const restrictions = getModelRestrictions(
          'openai',
          normalizedConfig.model,
        );
        if (
          restrictions?.minCompletionTokens &&
          maxTokensValue &&
          maxTokensValue < restrictions.minCompletionTokens
        ) {
          maxTokensValue = restrictions.minCompletionTokens;
        }

        // Check if model requires max_completion_tokens instead of max_tokens
        if (this.requiresMaxCompletionTokens(normalizedConfig.model)) {
          apiParams.max_completion_tokens = maxTokensValue;
        } else {
          apiParams.max_tokens = maxTokensValue;
        }
      }

      // Make OpenAI API call
      const completion: OpenAIChatCompletionParsed =
        openAIChatCompletionSchema.parse(
          await this.openai.chat.completions.create(apiParams),
        );

      const choice = completion.choices[0];
      if (!choice?.message?.content) {
        // Log the full response for debugging
        this.logger.warn(
          `OpenAI returned response without content for model ${normalizedConfig.model}:`,
          {
            choices: completion.choices,
            model: completion.model,
            usage: completion.usage,
          },
        );
        throw new Error('No content in OpenAI response');
      }

      // Don't reverse pseudonyms here - it will be done at LLM Service level
      const finalContent = choice.message.content;

      const endTime = Date.now();

      // Create OpenAI-specific metadata
      const metadata = this.createOpenAIMetadata(
        completion,
        params,
        startTime,
        endTime,
        requestId,
      );

      // Track usage with full metadata for database persistence
      await this.trackUsage(
        context,
        params.config.provider,
        params.config.model,
        metadata.usage.inputTokens,
        metadata.usage.outputTokens,
        metadata.usage.cost,
        {
          requestId,
          callerType: params.options?.callerType,
          callerName: params.options?.callerName,
          piiMetadata: (piiResult.piiMetadata ?? undefined) as unknown as
            | Record<string, unknown>
            | undefined,
          startTime,
          endTime,
        },
      );

      const response: LLMResponse = {
        content: finalContent,
        metadata,
        piiMetadata: piiResult.piiMetadata ?? undefined,
      };

      // Optional LangSmith integration
      const langsmithRunId = await this.integrateLangSmith(params, response);
      if (langsmithRunId) {
        response.metadata.langsmithRunId = langsmithRunId;
      }

      // Log request/response
      this.logRequestResponse(params, response, metadata.timing.duration);

      return response;
    } catch (error) {
      this.handleError(error, 'OpenAILLMService.generateResponse');
    }
  }

  /**
   * Generate images using OpenAI's image generation API
   *
   * Supports GPT Image 1.5, GPT Image 1, and DALL-E 3/2 models.
   * Uses ExecutionContext.conversationId as the request ID for observability.
   *
   * @param context - ExecutionContext with all context fields
   * @param params - Image generation parameters
   * @returns ImageGenerationResponse with generated image bytes
   *
   * @example
   * ```typescript
   * const response = await openaiService.generateImage(context, {
   *   prompt: 'A sunset over mountains',
   *   size: '1024x1024',
   *   quality: 'hd',
   *   numberOfImages: 1,
   * });
   * ```
   */
  async generateImage(
    context: ExecutionContext,
    params: ImageGenerationParams,
  ): Promise<ImageGenerationResponse> {
    const startTime = Date.now();
    // Use conversationId from context as the request ID - already unique, already tracked
    const requestId = context.conversationId;
    const model = context.model || this.config.model || 'gpt-image-1.5';

    this.logger.log(
      `🖼️ [OPENAI-IMAGE] generateImage() - model: ${model}, prompt: ${params.prompt.substring(0, 100)}...`,
    );

    try {
      // Map params to OpenAI API format
      const size = this.mapImageSize(params.size);
      const quality = params.quality || 'standard';
      const style = params.style || 'natural';
      const n = Math.min(params.numberOfImages || 1, 4); // OpenAI max is 4

      // Determine if using newer GPT Image model or legacy DALL-E
      const isGptImage = model.includes('gpt-image');
      const isDalle3 = model.includes('dall-e-3');
      const isDalle2 = model.includes('dall-e-2');

      // Build request options
      // Note: gpt-image-1 models always return b64_json and don't accept response_format
      // DALL-E models support response_format parameter
      const requestOptions: OpenAI.Images.ImageGenerateParams = {
        model,
        prompt: params.prompt,
        n,
        size: size as
          | '256x256'
          | '512x512'
          | '1024x1024'
          | '1792x1024'
          | '1024x1792',
      };

      // Only add response_format for DALL-E models (gpt-image models always return b64_json)
      if (isDalle2 || isDalle3) {
        requestOptions.response_format = 'b64_json';
      }

      // Add quality and style only for DALL-E 3 (gpt-image models don't support these)
      if (isDalle3) {
        requestOptions.quality = quality;
        requestOptions.style = style;
      }

      // Add background option for GPT Image models
      if (isGptImage && params.background) {
        (requestOptions as unknown as Record<string, unknown>).background =
          params.background;
      }

      this.logger.debug(`🖼️ [OPENAI-IMAGE] Request options:`, {
        model,
        size,
        quality,
        style,
        n,
      });

      // Make API call
      const response = await this.openai.images.generate(requestOptions);

      const endTime = Date.now();

      // Convert response to our format
      // gpt-image-1 models return b64_json directly
      // DALL-E models may return URL or b64_json depending on response_format
      const images = await Promise.all(
        (response.data ?? []).map(async (img) => {
          let buffer: Buffer;

          if (img.b64_json) {
            // Base64 encoded image data
            buffer = Buffer.from(img.b64_json, 'base64');
          } else if (img.url) {
            // URL - need to download the image
            this.logger.debug(
              `🖼️ [OPENAI-IMAGE] Downloading image from URL...`,
            );
            const fetchResponse = await fetch(img.url);
            if (!fetchResponse.ok) {
              throw new Error(
                `Failed to download image: ${fetchResponse.statusText}`,
              );
            }
            const arrayBuffer = await fetchResponse.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
          } else {
            throw new Error('No image data in response');
          }

          // Parse size dimensions
          const [width, height] = this.parseSizeDimensions(size);

          const metadata: ImageMetadata = {
            width,
            height,
            mimeType: 'image/png',
            sizeBytes: buffer.length,
            revisedPrompt: img.revised_prompt,
          };

          return {
            data: buffer,
            revisedPrompt: img.revised_prompt,
            metadata,
          };
        }),
      );

      this.logger.log(
        `🖼️ [OPENAI-IMAGE] Generated ${images.length} image(s), total bytes: ${images.reduce((sum, img) => sum + img.data.length, 0)}`,
      );

      // Build response metadata
      const responseMetadata: ResponseMetadata = {
        provider: 'openai',
        model,
        requestId,
        timestamp: new Date().toISOString(),
        usage: {
          // Image generation doesn't use tokens in traditional sense
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          // Cost is per-image based on model and size
          cost: this.calculateImageCost(model, size, quality, n),
        },
        timing: {
          startTime,
          endTime,
          duration: endTime - startTime,
        },
        tier: 'external',
        status: 'completed',
        providerSpecific: {
          imagesGenerated: images.length,
          size,
          quality,
          style,
        },
      };

      return {
        images,
        metadata: responseMetadata,
      };
    } catch (error) {
      const endTime = Date.now();

      this.logger.error(
        `🖼️ [OPENAI-IMAGE] Error: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Return error response
      return {
        images: [],
        metadata: {
          provider: 'openai',
          model,
          requestId,
          timestamp: new Date().toISOString(),
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          timing: { startTime, endTime, duration: endTime - startTime },
          tier: 'external',
          status: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
        },
        error: {
          code: 'OPENAI_IMAGE_GENERATION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
          details: error,
        },
      };
    }
  }

  /**
   * Map our size enum to OpenAI's size format
   */
  private mapImageSize(size?: ImageGenerationParams['size']): string {
    // Default to 1024x1024 if not specified
    return size || '1024x1024';
  }

  /**
   * Parse size string to width/height
   */
  private parseSizeDimensions(size: string): [number, number] {
    const parts = size.split('x');
    const width = parseInt(parts[0] ?? '1024', 10);
    const height = parseInt(parts[1] ?? '1024', 10);
    return [width, height];
  }

  /**
   * Calculate cost for image generation
   */
  private calculateImageCost(
    model: string,
    size: string,
    quality: string,
    count: number,
  ): number {
    // Base pricing (per image) - these are approximate and should be updated
    // from the database pricing table in production
    const pricing: Record<string, Record<string, number>> = {
      'gpt-image-1.5': {
        '1024x1024:standard': 0.04,
        '1024x1024:hd': 0.08,
        '1792x1024:standard': 0.08,
        '1792x1024:hd': 0.12,
        '1024x1792:standard': 0.08,
        '1024x1792:hd': 0.12,
      },
      'gpt-image-1': {
        '1024x1024:standard': 0.02,
        '1792x1024:standard': 0.04,
        '1024x1792:standard': 0.04,
      },
      'dall-e-3': {
        '1024x1024:standard': 0.04,
        '1024x1024:hd': 0.08,
        '1792x1024:standard': 0.08,
        '1792x1024:hd': 0.12,
        '1024x1792:standard': 0.08,
        '1024x1792:hd': 0.12,
      },
      'dall-e-2': {
        '1024x1024:standard': 0.02,
        '512x512:standard': 0.018,
        '256x256:standard': 0.016,
      },
    };

    const modelPricing = pricing[model] ??
      pricing['dall-e-3'] ?? { '1024x1024:standard': 0.04 };
    const priceKey = `${size}:${quality}`;
    const perImageCost =
      modelPricing[priceKey] ?? modelPricing['1024x1024:standard'] ?? 0.04;

    return perImageCost * count;
  }

  // =============================================================================
  // VIDEO GENERATION (Sora 2)
  // =============================================================================

  /**
   * Generate video using OpenAI Sora 2 API
   *
   * Video generation is async - this method starts the generation job and returns
   * an operationId. Use pollVideoStatus() to check completion and get the video.
   *
   * @param context - ExecutionContext for tracking
   * @param params - Video generation parameters
   * @returns VideoGenerationResponse with operationId for polling
   *
   * @example
   * ```typescript
   * const response = await openaiService.generateVideo(context, {
   *   prompt: 'A cat walking through a garden',
   *   duration: 8,
   *   aspectRatio: '16:9',
   * });
   * // Poll for completion
   * let status = await openaiService.pollVideoStatus(response.operationId, context);
   * while (status.status === 'processing') {
   *   await sleep(10000);
   *   status = await openaiService.pollVideoStatus(response.operationId, context);
   * }
   * ```
   */
  async generateVideo(
    context: ExecutionContext,
    params: VideoGenerationParams,
  ): Promise<VideoGenerationResponse> {
    const startTime = Date.now();
    const requestId = context.conversationId;
    const model = context.model || this.config.model || 'sora-2';

    this.logger.log(
      `🎬 [OPENAI-VIDEO] generateVideo() - model: ${model}, prompt: ${params.prompt.substring(0, 100)}...`,
    );

    try {
      // Map duration to Sora allowed values (4, 8, or 12 seconds)
      const seconds = this.mapVideoDuration(params.duration);

      // Map aspect ratio to size (Sora uses size instead of aspect_ratio)
      // Allowed values: 720x1280 (9:16), 1280x720 (16:9), 1024x1792, 1792x1024
      const size = this.mapVideoSize(params.aspectRatio, params.resolution);

      this.logger.debug(`🎬 [OPENAI-VIDEO] Request params:`, {
        model,
        seconds,
        size,
        hasFirstFrame: !!params.firstFrameImageUrl || !!params.firstFrameImage,
      });

      // Make POST /videos request using multipart/form-data
      // Reference: https://platform.openai.com/docs/api-reference/videos
      const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
      const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';

      // Build FormData for the request
      const formData = new FormData();
      formData.append('model', model);
      formData.append('prompt', params.prompt);
      formData.append('seconds', String(seconds));
      formData.append('size', size);

      // Add first frame image for image-to-video (Node.js compatible)
      if (params.firstFrameImage) {
        // Convert Buffer to Blob for FormData
        // Use type assertion to handle Node.js Buffer → Blob conversion
        const blob = new Blob([params.firstFrameImage as unknown as BlobPart], {
          type: 'image/png',
        });
        formData.append('input_reference', blob, 'first_frame.png');
      }
      // Note: URL-based input_reference not yet supported via form-data

      const response = await fetch(`${baseUrl}/videos`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          // Note: Don't set Content-Type for FormData, browser/node will set it with boundary
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sora API error: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as {
        id: string;
        status: string;
        progress?: number;
      };

      this.logger.log(
        `🎬 [OPENAI-VIDEO] Video generation started: id=${data.id}, status=${data.status}`,
      );

      const endTime = Date.now();

      // Return response with operation ID for polling
      return {
        operationId: data.id,
        status: this.mapVideoStatus(data.status),
        metadata: {
          provider: 'openai',
          model,
          requestId,
          timestamp: new Date().toISOString(),
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          timing: { startTime, endTime, duration: endTime - startTime },
          tier: 'external',
          status: 'started',
          providerSpecific: {
            soraJobId: data.id,
            requestedSeconds: seconds,
            size,
          },
        },
      };
    } catch (error) {
      const endTime = Date.now();

      this.logger.error(
        `🎬 [OPENAI-VIDEO] Error: ${error instanceof Error ? error.message : String(error)}`,
      );

      return {
        status: 'failed',
        metadata: {
          provider: 'openai',
          model,
          requestId,
          timestamp: new Date().toISOString(),
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          timing: { startTime, endTime, duration: endTime - startTime },
          tier: 'external',
          status: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
        },
        error: {
          code: 'OPENAI_VIDEO_GENERATION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
          details: error,
        },
      };
    }
  }

  /**
   * Poll video generation status
   *
   * Call this method periodically after generateVideo() to check completion.
   * When status is 'completed', the response will include videoUrl.
   *
   * @param operationId - The operation ID from generateVideo()
   * @param context - ExecutionContext for tracking
   * @returns VideoGenerationResponse with current status
   */
  async pollVideoStatus(
    operationId: string,
    context: ExecutionContext,
  ): Promise<VideoGenerationResponse> {
    const startTime = Date.now();
    const model = context.model || this.config.model || 'sora-2';

    this.logger.debug(
      `🎬 [OPENAI-VIDEO] pollVideoStatus() - id: ${operationId}`,
    );

    try {
      const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
      const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';

      const response = await fetch(`${baseUrl}/videos/${operationId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sora API error: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as {
        id: string;
        status: string;
        progress?: number;
        url?: string; // Some docs show this as 'url'
        video_url?: string; // Some docs show this as 'video_url'
        output_url?: string; // Some docs show this as 'output_url'
        error?: { message: string };
        duration_seconds?: number;
        seconds?: number; // Alternative field name
        aspect_ratio?: string;
        size?: string;
        resolution?: string;
      };

      this.logger.debug(
        `🎬 [OPENAI-VIDEO] Poll response data: ${JSON.stringify(data)}`,
      );

      const endTime = Date.now();
      const status = this.mapVideoStatus(data.status);
      const durationSeconds = data.duration_seconds || data.seconds || 4;

      // Build response
      const videoResponse: VideoGenerationResponse = {
        operationId: data.id,
        status,
        metadata: {
          provider: 'openai',
          model,
          requestId: context.conversationId,
          timestamp: new Date().toISOString(),
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            // Cost calculated when completed
            cost:
              status === 'completed'
                ? this.calculateVideoCost(model, durationSeconds)
                : undefined,
          },
          timing: { startTime, endTime, duration: endTime - startTime },
          tier: 'external',
          status: status === 'completed' ? 'completed' : 'started',
          providerSpecific: {
            soraJobId: data.id,
            progress: data.progress,
          },
        },
      };

      // If completed, download the video using the content endpoint
      if (status === 'completed') {
        this.logger.debug(
          `🎬 [OPENAI-VIDEO] Status is completed, attempting to download video...`,
        );
        // Try multiple URL sources (different docs show different field names)
        const videoUrl = data.url || data.video_url || data.output_url;

        if (videoUrl) {
          // If URL is provided in status response, download from there
          this.logger.debug(
            `🎬 [OPENAI-VIDEO] Video completed, downloading from URL: ${videoUrl}`,
          );
          const videoFetch = await fetch(videoUrl);
          if (videoFetch.ok) {
            const arrayBuffer = await videoFetch.arrayBuffer();
            videoResponse.videoData = Buffer.from(arrayBuffer);
            videoResponse.videoUrl = videoUrl;
          }
        } else {
          // Use the dedicated content endpoint (not /download)
          // Reference: https://platform.openai.com/docs/guides/video-generation
          const downloadUrl = `${baseUrl}/videos/${operationId}/content`;
          this.logger.debug(
            `🎬 [OPENAI-VIDEO] Video completed, using content endpoint: ${downloadUrl}`,
          );

          const downloadResponse = await fetch(downloadUrl, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          });

          this.logger.debug(
            `🎬 [OPENAI-VIDEO] Download response status: ${downloadResponse.status}, content-type: ${downloadResponse.headers.get('content-type')}`,
          );

          if (downloadResponse.ok) {
            const contentType = downloadResponse.headers.get('content-type');

            // Check if response is video/mp4 (actual video) or json (redirect/error)
            if (contentType?.includes('video/mp4')) {
              const arrayBuffer = await downloadResponse.arrayBuffer();
              videoResponse.videoData = Buffer.from(arrayBuffer);
              videoResponse.videoUrl = downloadUrl;
              this.logger.debug(
                `🎬 [OPENAI-VIDEO] Download successful: ${videoResponse.videoData.length} bytes`,
              );
            } else if (contentType?.includes('application/json')) {
              // Some APIs return a JSON with the actual download URL
              const jsonResponse = (await downloadResponse.json()) as {
                url?: string;
                download_url?: string;
              };
              this.logger.debug(
                `🎬 [OPENAI-VIDEO] Download returned JSON: ${JSON.stringify(jsonResponse)}`,
              );

              // Try to get the actual video URL from the JSON response
              const actualVideoUrl =
                jsonResponse.url || jsonResponse.download_url;
              if (actualVideoUrl) {
                const actualVideoFetch = await fetch(actualVideoUrl);
                if (actualVideoFetch.ok) {
                  const arrayBuffer = await actualVideoFetch.arrayBuffer();
                  videoResponse.videoData = Buffer.from(arrayBuffer);
                  videoResponse.videoUrl = actualVideoUrl;
                  this.logger.debug(
                    `🎬 [OPENAI-VIDEO] Downloaded from redirected URL: ${videoResponse.videoData.length} bytes`,
                  );
                }
              }
            }
          } else {
            const errorText = await downloadResponse.text();
            this.logger.warn(
              `🎬 [OPENAI-VIDEO] Download failed: ${downloadResponse.status} ${errorText}`,
            );
          }
        }

        // Add video metadata
        if (videoResponse.videoData) {
          videoResponse.videoMetadata = {
            durationSeconds,
            mimeType: 'video/mp4',
            sizeBytes: videoResponse.videoData.length,
            hasAudio: true, // Sora 2 generates synced audio
          } as VideoMetadata;
        }
      }

      // If failed, include error
      if (status === 'failed' && data.error) {
        videoResponse.error = {
          code: 'SORA_GENERATION_FAILED',
          message: data.error.message,
        };
      }

      return videoResponse;
    } catch (error) {
      const endTime = Date.now();

      return {
        operationId,
        status: 'failed',
        metadata: {
          provider: 'openai',
          model,
          requestId: context.conversationId,
          timestamp: new Date().toISOString(),
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          timing: { startTime, endTime, duration: endTime - startTime },
          tier: 'external',
          status: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
        },
        error: {
          code: 'OPENAI_VIDEO_POLL_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Map duration to Sora-supported values (4, 8, or 12 seconds)
   */
  private mapVideoDuration(duration?: number): number {
    if (!duration) return 4; // Default
    if (duration <= 4) return 4;
    if (duration <= 8) return 8;
    return 12; // Max
  }

  /**
   * Map aspect ratio and resolution to Sora size parameter
   *
   * Sora allowed sizes: 720x1280 (9:16), 1280x720 (16:9), 1024x1792, 1792x1024
   */
  private mapVideoSize(
    aspectRatio?: '16:9' | '9:16',
    resolution?: string,
  ): string {
    // If resolution is explicitly provided and matches allowed values, use it
    const allowedSizes = ['720x1280', '1280x720', '1024x1792', '1792x1024'];
    if (resolution && allowedSizes.includes(resolution)) {
      return resolution;
    }

    // Map aspect ratio to default size
    switch (aspectRatio) {
      case '9:16':
        return '720x1280'; // Portrait/vertical
      case '16:9':
      default:
        return '1280x720'; // Landscape/horizontal (default)
    }
  }

  /**
   * Map OpenAI video status to our standard status
   */
  private mapVideoStatus(
    status: string,
  ): 'pending' | 'processing' | 'completed' | 'failed' {
    switch (status.toLowerCase()) {
      case 'queued':
        return 'pending';
      case 'in_progress':
        return 'processing';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      default:
        return 'processing';
    }
  }

  /**
   * Calculate cost for video generation
   *
   * Sora 2 pricing is based on duration and model quality.
   * Reference: https://platform.openai.com/docs/models/sora-2
   */
  private calculateVideoCost(model: string, durationSeconds: number): number {
    // Sora 2 pricing per second (720p resolution)
    // Source: OpenAI pricing - $0.10/second for sora-2, more for pro
    const pricing: Record<string, number> = {
      'sora-2': 0.1,
      'sora-2-pro': 0.2,
    };

    const perSecondCost = pricing[model] ?? pricing['sora-2'] ?? 0.1;
    return perSecondCost * durationSeconds;
  }

  /**
   * Check if a model is part of the o1 series (with special restrictions)
   * @deprecated Use getModelRestrictions from model-restrictions.config instead
   */
  private isO1SeriesModel(model: string): boolean {
    const restrictions = getModelRestrictions('openai', model);
    return restrictions?.temperature?.supported === false;
  }

  /**
   * Check if a model requires max_completion_tokens instead of max_tokens
   */
  private requiresMaxCompletionTokens(model: string): boolean {
    const restrictions = getModelRestrictions('openai', model);
    return restrictions?.maxTokensField?.fieldName === 'max_completion_tokens';
  }

  /**
   * Normalize configuration for OpenAI model-specific restrictions
   */
  private normalizeConfigForModel(config: LLMServiceConfig): LLMServiceConfig {
    const restrictions = getModelRestrictions('openai', config.model);

    if (!restrictions) {
      // No restrictions defined, return config as-is
      return config;
    }

    const normalizedConfig = { ...config };

    // Handle temperature restrictions
    if (restrictions.temperature && !restrictions.temperature.supported) {
      if (normalizedConfig.temperature !== undefined) {
        delete normalizedConfig.temperature;
      }
    }

    return normalizedConfig;
  }

  /**
   * Prepare messages for OpenAI API based on model capabilities
   */
  private prepareMessagesForModel(
    model: string,
    systemPrompt: string,
    userMessage: string,
    images?: Array<{ base64: string; mimeType: string }>,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const restrictions = getModelRestrictions('openai', model);

    // Build multimodal user content when images are provided
    const buildMultimodalContent = (
      text: string,
      imgs: Array<{ base64: string; mimeType: string }>,
    ): OpenAI.Chat.Completions.ChatCompletionContentPart[] => [
      ...imgs.map(
        (img): OpenAI.Chat.Completions.ChatCompletionContentPartImage => ({
          type: 'image_url',
          image_url: {
            url: `data:${img.mimeType};base64,${img.base64}`,
          },
        }),
      ),
      { type: 'text', text },
    ];

    if (
      restrictions?.systemMessages &&
      !restrictions.systemMessages.supported
    ) {
      // Model doesn't support system messages
      if (restrictions.systemMessages.workaround === 'combine_with_user') {
        const combinedText = `${systemPrompt}\n\n${userMessage}`;
        return [
          {
            role: 'user' as const,
            content: images?.length
              ? buildMultimodalContent(combinedText, images)
              : combinedText,
          },
        ];
      }
    }

    // Standard models support system messages
    return [
      { role: 'system' as const, content: systemPrompt },
      {
        role: 'user' as const,
        content: images?.length
          ? buildMultimodalContent(userMessage, images)
          : userMessage,
      },
    ];
  }

  /**
   * Create OpenAI-specific metadata with provider-specific fields
   */
  private createOpenAIMetadata(
    completion: OpenAIChatCompletionParsed,
    params: GenerateResponseParams,
    startTime: number,
    endTime: number,
    requestId: string,
  ): OpenAIResponseMetadata {
    const choice = completion.choices[0];
    const usage = completion.usage;
    // Fallback estimation if usage is missing (not always present for some models)
    const estInput = this.estimateTokens(
      `${params.systemPrompt}${params.systemPrompt ? '\n\n' : ''}${params.userMessage}`,
    );
    const estOutput = this.estimateTokens(choice?.message?.content || '');
    const inputTokens = usage?.prompt_tokens ?? estInput;
    const outputTokens = usage?.completion_tokens ?? estOutput;

    return {
      provider: 'openai',
      model: completion.model,
      requestId,
      timestamp: new Date().toISOString(),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: (usage?.total_tokens ?? inputTokens + outputTokens) || 0,
        cost: this.calculateCost(
          'openai',
          completion.model,
          inputTokens,
          outputTokens,
        ),
      },
      timing: {
        startTime,
        endTime,
        duration: endTime - startTime,
      },
      tier: params.options?.preferLocal ? 'local' : 'external',
      status: 'completed',
      // OpenAI-specific fields
      providerSpecific: {
        finish_reason: choice?.finish_reason ?? null,
        system_fingerprint: completion.system_fingerprint ?? undefined,
        model_version: completion.model,
        logprobs: choice?.logprobs,
        // Include actual token counts from OpenAI
        prompt_tokens: usage?.prompt_tokens,
        completion_tokens: usage?.completion_tokens,
        total_tokens: usage?.total_tokens,
      },
    };
  }

  /**
   * Override LangSmith integration for OpenAI-specific tracing
   */
  protected integrateLangSmith(
    _params: GenerateResponseParams,
    _response: LLMResponse,
  ): Promise<string | undefined> {
    // Example OpenAI-specific LangSmith integration
    if (
      process.env.LANGSMITH_API_KEY &&
      process.env.LANGSMITH_TRACING === 'true'
    ) {
      try {
        // This would integrate with LangSmith for OpenAI-specific tracing
        const runId = `openai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        return Promise.resolve(runId);
      } catch (error) {
        this.logger.warn('LangSmith integration failed:', error);
      }
    }
    return Promise.resolve(undefined);
  }

  /**
   * OpenAI-specific configuration validation
   */
  protected validateConfig(config: LLMServiceConfig): void {
    super.validateConfig(config);

    if (config.provider !== 'openai') {
      throw new Error('OpenAILLMService requires provider to be "openai"');
    }

    if (!config.apiKey && !process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key is required');
    }

    // Validate OpenAI-specific model names
    const validModels = [
      'gpt-4',
      'gpt-4-turbo',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-16k',
    ];

    if (!validModels.some((model) => config.model.startsWith(model))) {
      this.logger.warn(
        `Unknown OpenAI model: ${config.model}. Proceeding anyway.`,
      );
    }
  }
}

/**
 * Factory function to create OpenAI service instances
 */
export function createOpenAIService(
  config: LLMServiceConfig,
  dependencies: {
    piiService: PIIService;
    dictionaryPseudonymizerService: DictionaryPseudonymizerService;
    runMetadataService: RunMetadataService;
    providerConfigService: ProviderConfigService;
  },
): OpenAILLMService {
  return new OpenAILLMService(
    { ...config, provider: 'openai' },
    dependencies.piiService,
    dependencies.dictionaryPseudonymizerService,
    dependencies.runMetadataService,
    dependencies.providerConfigService,
  );
}

/**
 * Example usage and testing
 */
export async function testOpenAIService() {
  // This would be used in your tests to verify the OpenAI implementation
  const config: LLMServiceConfig = {
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 1000,
  };

  // Mock dependencies for testing
  const mockDependencies = {
    piiService: {} as PIIService,
    dictionaryPseudonymizerService: {} as DictionaryPseudonymizerService,
    runMetadataService: {} as RunMetadataService,
    providerConfigService: {} as ProviderConfigService,
  };

  const service = createOpenAIService(config, mockDependencies);

  const mockContext = createMockExecutionContext();
  const params: GenerateResponseParams = {
    systemPrompt: 'You are a helpful assistant.',
    userMessage: 'Hello, how are you?',
    config,
    options: {
      executionContext: mockContext,
    },
  };

  const response = await service.generateResponse(mockContext, params);
  return response;
}
