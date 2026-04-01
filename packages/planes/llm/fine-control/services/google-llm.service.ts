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
import { LLMErrorMapper } from './llm-error-handling';
import { PIIService } from '../pii/pii.service';
import { DictionaryPseudonymizerService } from '../pii/dictionary-pseudonymizer.service';
import { RunMetadataService } from '../run-metadata.service';
import { ProviderConfigService } from '../provider-config.service';
import { LLMPricingService } from '../llm-pricing.service';
import {
  GoogleGenerativeAI,
  FinishReason,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
import type {
  GoogleGenerateContentResult,
  GoogleGenerateContentResponse,
  GoogleGenerateContentCandidate,
  GoogleUsageMetadata,
  GoogleCitationSource,
} from '../types/provider-payload.types';

/**
 * Google-specific response metadata extension
 */
interface GoogleResponseMetadata extends ResponseMetadata {
  providerSpecific: {
    finish_reason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
    safety_ratings?: Array<{
      category: string;
      probability: string;
    }>;
    citation_metadata?: {
      citation_sources: Array<{
        start_index: number;
        end_index: number;
        uri: string;
        license: string;
      }>;
    };
    // Google-specific usage details
    prompt_token_count?: number;
    candidates_token_count?: number;
    total_token_count?: number;
    // Model version and capabilities
    model_version?: string;
    generation_config?: {
      temperature?: number;
      top_p?: number;
      top_k?: number;
      max_output_tokens?: number;
    };
  };
}

/**
 * Google Gemini LLM Service Implementation
 *
 * This example shows how to extend BaseLLMService for Google's Gemini models
 * with provider-specific functionality, safety settings, and metadata handling.
 */
@Injectable()
export class GoogleLLMService extends BaseLLMService {
  private genAI: GoogleGenerativeAI;

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

    const apiKey = config.apiKey || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('Google API key is required');
    }

    // Initialize Google Generative AI
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Implementation of the abstract generateResponse method for Google Gemini
   */
  async generateResponse(
    context: ExecutionContext,
    params: GenerateResponseParams,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId('google');

    try {
      // Validate configuration
      this.validateConfig(params.config);

      // Use LLM Service level PII pre-processing when provided
      const processedText = params.userMessage;
      const piiMetadata = params.options?.piiMetadata || null;
      const _dictionaryMappings = params.options?.dictionaryMappings || [];
      if (!piiMetadata) {
        this.logger.warn(
          `⚠️ [PII-METADATA-DEBUG] GoogleLLMService - No PII metadata from LLM Service, using raw message`,
        );
      }

      // Get the model
      const model = this.genAI.getGenerativeModel({
        model: params.config.model,
        generationConfig: {
          temperature:
            params.options?.temperature ?? params.config.temperature ?? 0.7,
          maxOutputTokens: params.options?.maxTokens ?? params.config.maxTokens,
          topP: 0.95,
          topK: 64,
        },
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
        ],
      });

      // Prepare the prompt (Google uses a different format)
      const prompt = `${params.systemPrompt}\n\nUser: ${processedText}\n\nAssistant:`;

      // Make Google API call
      const result: GoogleGenerateContentResult =
        await model.generateContent(prompt);
      const response: GoogleGenerateContentResponse = result.response;

      if (typeof response?.text !== 'function') {
        throw new Error('Unexpected Google response shape: missing text()');
      }

      const responseText = response.text();

      if (!responseText) {
        throw new Error('No content in Google response');
      }

      // Do not reverse here; LLMService handles dictionary reversal consistently
      const finalContent = responseText;

      const endTime = Date.now();

      // Create Google-specific metadata
      const metadata = this.createGoogleMetadata(
        result,
        response,
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
          piiMetadata: (piiMetadata ?? undefined) as unknown as
            | Record<string, unknown>
            | undefined,
          startTime,
          endTime,
        },
      );

      const llmResponse: LLMResponse = {
        content: finalContent,
        metadata,
        piiMetadata: piiMetadata ?? undefined,
      };

      // Optional LangSmith integration
      const langsmithRunId = await this.integrateLangSmith(params, llmResponse);
      if (langsmithRunId) {
        llmResponse.metadata.langsmithRunId = langsmithRunId;
      }

      // Log request/response
      this.logRequestResponse(params, llmResponse, metadata.timing.duration);

      return llmResponse;
    } catch (error) {
      this.handleError(error, 'GoogleLLMService.generateResponse');
    }
  }

  /**
   * Create Google-specific metadata with provider-specific fields
   */
  private createGoogleMetadata(
    result: GoogleGenerateContentResult,
    response: GoogleGenerateContentResponse,
    params: GenerateResponseParams,
    startTime: number,
    endTime: number,
    requestId: string,
  ): GoogleResponseMetadata {
    const usageMetadata: GoogleUsageMetadata | undefined =
      response.usageMetadata ?? result.response?.usageMetadata;
    const candidate: GoogleGenerateContentCandidate | undefined =
      response.candidates?.[0];

    const normalizedFinishReason = this.mapFinishReason(candidate);
    const citationMetadata = candidate?.citationMetadata;

    return {
      provider: 'google',
      model: params.config.model,
      requestId,
      timestamp: new Date().toISOString(),
      usage: {
        inputTokens: usageMetadata?.promptTokenCount || 0,
        outputTokens: usageMetadata?.candidatesTokenCount || 0,
        totalTokens: usageMetadata?.totalTokenCount || 0,
        cost: this.calculateCost(
          'google',
          params.config.model,
          usageMetadata?.promptTokenCount || 0,
          usageMetadata?.candidatesTokenCount || 0,
        ),
      },
      timing: {
        startTime,
        endTime,
        duration: endTime - startTime,
      },
      tier: params.options?.preferLocal ? 'local' : 'external',
      status: 'completed',
      // Google-specific fields
      providerSpecific: {
        finish_reason: normalizedFinishReason,
        safety_ratings: candidate?.safetyRatings?.map((rating) => ({
          category: rating.category,
          probability: rating.probability,
        })),
        citation_metadata: citationMetadata
          ? {
              citation_sources: (citationMetadata.citationSources || []).map(
                (source: GoogleCitationSource) => ({
                  start_index: source.startIndex ?? 0,
                  end_index: source.endIndex ?? 0,
                  uri: source.uri ?? '',
                  license: source.license ?? '',
                }),
              ),
            }
          : undefined,
        // Include actual token counts from Google
        prompt_token_count: usageMetadata?.promptTokenCount,
        candidates_token_count: usageMetadata?.candidatesTokenCount,
        total_token_count: usageMetadata?.totalTokenCount,
        model_version: params.config.model,
        generation_config: {
          temperature:
            params.options?.temperature ?? params.config.temperature ?? 0.7,
          top_p: 0.95,
          top_k: 64,
          max_output_tokens:
            params.options?.maxTokens ?? params.config.maxTokens,
        },
      },
    };
  }

  /**
   * Override LangSmith integration for Google-specific tracing
   */
  protected integrateLangSmith(
    _params: GenerateResponseParams,
    _response: LLMResponse,
  ): Promise<string | undefined> {
    // Example Google-specific LangSmith integration
    if (
      process.env.LANGSMITH_API_KEY &&
      process.env.LANGSMITH_TRACING === 'true'
    ) {
      try {
        // This would integrate with LangSmith for Google-specific tracing
        const runId = `google-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        return Promise.resolve(runId);
      } catch (error) {
        this.logger.warn('LangSmith integration failed:', error);
      }
    }
    return Promise.resolve(undefined);
  }

  private mapFinishReason(
    candidate?: GoogleGenerateContentCandidate,
  ): GoogleResponseMetadata['providerSpecific']['finish_reason'] {
    switch (candidate?.finishReason) {
      case FinishReason.STOP:
        return 'STOP';
      case FinishReason.MAX_TOKENS:
        return 'MAX_TOKENS';
      case FinishReason.SAFETY:
        return 'SAFETY';
      case FinishReason.RECITATION:
        return 'RECITATION';
      default:
        return 'OTHER';
    }
  }

  /**
   * Google-specific configuration validation
   */
  protected validateConfig(config: LLMServiceConfig): void {
    super.validateConfig(config);

    if (config.provider !== 'google') {
      throw new Error('GoogleLLMService requires provider to be "google"');
    }

    if (!config.apiKey && !process.env.GOOGLE_API_KEY) {
      throw new Error('Google API key is required');
    }

    // Validate Google-specific model names
    const validModels = [
      'gemini-1.5-pro',
      'gemini-1.5-pro-latest',
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-2.0-flash',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-3-flash-preview',
      'gemini-3-pro-preview',
      'gemini-1.0-pro',
      'gemini-pro',
      'gemini-pro-vision',
    ];

    if (!validModels.some((model) => config.model.includes(model))) {
      this.logger.warn(
        `Unknown Google model: ${config.model}. Proceeding anyway.`,
      );
    }
  }

  /**
   * Google-specific error handling
   */
  protected handleError(error: unknown, context: string): never {
    try {
      const mapped = LLMErrorMapper.fromGoogleError(
        error,
        'google',
        this.config?.model,
      );
      super.handleError(mapped, context);
    } catch {
      super.handleError(error, context);
    }
  }

  // Note: calculateCost is now inherited from BaseLLMService which uses
  // LLMPricingService for database-driven pricing lookups

  /**
   * Generate image using Google Imagen API
   *
   * Uses Vertex AI Imagen models (imagen-4.0-generate-001, imagen-4.0-fast-generate-001)
   * Returns base64-encoded image data.
   *
   * @param context - ExecutionContext for tracing and ownership
   * @param params - Image generation parameters
   * @returns ImageGenerationResponse with generated images
   */
  async generateImage(
    context: ExecutionContext,
    params: ImageGenerationParams,
  ): Promise<ImageGenerationResponse> {
    const startTime = Date.now();
    // Use conversationId as requestId - already unique, already tracked everywhere
    const requestId = context.conversationId || this.generateRequestId('google-image');

    try {
      // Get model from context or fall back to config
      const model =
        context.model || this.config.model || 'imagen-4.0-generate-001';

      this.logger.log(
        `🖼️ [GOOGLE-IMAGE] Generating image with model: ${model}, requestId: ${requestId}`,
      );

      // Google Imagen uses Vertex AI predict endpoint
      // For now, we use the REST API directly since @google/generative-ai doesn't support Imagen
      const projectId = process.env.GOOGLE_CLOUD_PROJECT;
      const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

      if (!projectId) {
        throw new Error(
          'GOOGLE_CLOUD_PROJECT environment variable is required for Imagen',
        );
      }

      // Map size to aspect ratio for Google Imagen
      const aspectRatio = this.mapSizeToAspectRatio(params.size);

      // Prepare request body for Vertex AI Imagen
      const requestBody = {
        instances: [
          {
            prompt: params.prompt,
          },
        ],
        parameters: {
          sampleCount: params.numberOfImages || 1,
          aspectRatio: aspectRatio,
          // Google Imagen safety settings
          safetySetting: 'block_some',
          // Add watermark for generated content
          addWatermark: true,
        },
      };

      // Make Vertex AI API call
      const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await this.getAccessToken()}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Imagen API error: ${response.status} - ${errorText}`);
      }

      const result = (await response.json()) as {
        predictions?: Array<{
          bytesBase64Encoded?: string;
          mimeType?: string;
        }>;
      };

      if (!result.predictions || result.predictions.length === 0) {
        throw new Error('No predictions returned from Imagen API');
      }

      const endTime = Date.now();

      // Parse dimensions from size param
      const dimensions = this.parseSizeDimensions(params.size);

      // Convert predictions to image data matching ImageGenerationResponse interface
      const images = result.predictions
        .filter((pred) => pred.bytesBase64Encoded)
        .map((pred) => {
          const imageData = Buffer.from(pred.bytesBase64Encoded!, 'base64');
          const mimeType = pred.mimeType || 'image/png';
          const imageMetadata: ImageMetadata = {
            width: dimensions.width,
            height: dimensions.height,
            mimeType,
            sizeBytes: imageData.length,
          };
          return {
            data: imageData,
            metadata: imageMetadata,
          };
        });

      if (images.length === 0) {
        throw new Error('No valid images in Imagen response');
      }

      // Calculate cost based on number of images
      const cost = this.calculateImageCost(model, images.length);

      // Track usage
      await this.trackUsage(
        context,
        'google',
        model,
        0, // No input tokens for image generation
        0, // No output tokens for image generation
        cost,
        {
          requestId,
          callerType: 'image-generation',
          callerName: 'GoogleLLMService.generateImage',
          startTime,
          endTime,
        },
      );

      this.logger.log(
        `🖼️ [GOOGLE-IMAGE] Generated ${images.length} image(s) in ${endTime - startTime}ms`,
      );

      return {
        images,
        metadata: {
          provider: 'google',
          model,
          requestId,
          timestamp: new Date().toISOString(),
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cost,
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
            aspectRatio,
            width: dimensions.width,
            height: dimensions.height,
          },
        },
      };
    } catch (error) {
      this.logger.error(
        `🖼️ [GOOGLE-IMAGE] Error generating image: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.handleError(error, 'GoogleLLMService.generateImage');
    }
  }

  /**
   * Get Google Cloud access token for Vertex AI API calls
   * NOTE: Vertex AI (Imagen) requires OAuth tokens, not API keys.
   * API keys only work for Generative AI API (Gemini), not Vertex AI.
   */
  private async getAccessToken(): Promise<string> {
    // Vertex AI requires Application Default Credentials (ADC)
    // API keys don't work for Vertex AI - they only work for Gemini via Generative AI API
    try {
      const { GoogleAuth } = await import('google-auth-library');
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const client = await auth.getClient();
      const token = await client.getAccessToken();
      if (!token.token) {
        throw new Error('No access token returned from GoogleAuth');
      }
      return token.token;
    } catch (error) {
      this.logger.error(
        `Failed to get Google Cloud access token: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new Error(
        'Failed to authenticate with Google Cloud. Run "gcloud auth application-default login" or set GOOGLE_APPLICATION_CREDENTIALS.',
      );
    }
  }

  /**
   * Map size parameter to Google Imagen aspect ratio
   */
  private mapSizeToAspectRatio(
    size?: string,
  ): '1:1' | '16:9' | '9:16' | '4:3' | '3:4' {
    switch (size) {
      case '1792x1024':
        return '16:9';
      case '1024x1792':
        return '9:16';
      case '1024x1024':
      default:
        return '1:1';
    }
  }

  /**
   * Parse size string to width/height dimensions
   */
  private parseSizeDimensions(size?: string): {
    width: number;
    height: number;
  } {
    const defaultSize = { width: 1024, height: 1024 };
    if (!size) return defaultSize;

    const parts = size.split('x');
    if (parts.length !== 2) return defaultSize;

    const width = parseInt(parts[0] ?? '1024', 10);
    const height = parseInt(parts[1] ?? '1024', 10);

    return {
      width: isNaN(width) ? 1024 : width,
      height: isNaN(height) ? 1024 : height,
    };
  }

  /**
   * Calculate cost for image generation
   */
  private calculateImageCost(model: string, imageCount: number): number {
    // Google Imagen pricing (approximate, check current pricing)
    const pricePerImage: Record<string, number> = {
      'imagen-4.0-generate-001': 0.04,
      'imagen-4.0-fast-generate-001': 0.02,
      'imagen-3.0-generate-001': 0.03,
    };

    const price = pricePerImage[model] ?? 0.04;
    return price * imageCount;
  }

  // =============================================================================
  // VIDEO GENERATION (Veo 3)
  // =============================================================================

  /**
   * Generate video using Google Veo 3 API
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
   * const response = await googleService.generateVideo(context, {
   *   prompt: 'A cat walking through a garden',
   *   duration: 8,
   *   aspectRatio: '16:9',
   * });
   * // Poll for completion
   * let status = await googleService.pollVideoStatus(response.operationId, context);
   * while (status.status === 'processing') {
   *   await sleep(10000);
   *   status = await googleService.pollVideoStatus(response.operationId, context);
   * }
   * ```
   */
  async generateVideo(
    context: ExecutionContext,
    params: VideoGenerationParams,
  ): Promise<VideoGenerationResponse> {
    const startTime = Date.now();
    const requestId = context.conversationId || this.generateRequestId('google-video');
    const model = context.model || this.config.model || 'veo-3-generate';

    this.logger.log(
      `🎬 [GOOGLE-VIDEO] generateVideo() - model: ${model}, prompt: ${params.prompt.substring(0, 100)}...`,
    );

    try {
      // Get Vertex AI project config
      const projectId = process.env.GOOGLE_CLOUD_PROJECT;
      const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

      if (!projectId) {
        throw new Error(
          'GOOGLE_CLOUD_PROJECT environment variable is required for Veo',
        );
      }

      // Map parameters to Veo format
      const durationSeconds = this.mapVideoDuration(params.duration);
      const aspectRatio = params.aspectRatio || '16:9';
      const resolution = params.resolution || '720p';

      // Build request body for Veo API
      // Reference: https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/veo-video-generation
      const requestBody: Record<string, unknown> = {
        instances: [
          {
            prompt: params.prompt,
          },
        ],
        parameters: {
          aspectRatio: aspectRatio,
          durationSeconds: durationSeconds,
          resolution: resolution,
          sampleCount: 1, // Veo generates one video at a time
          generateAudio: params.generateAudio ?? false,
        },
      };

      // Add first frame image for image-to-video
      if (params.firstFrameImageUrl) {
        const instances = requestBody.instances as Array<
          Record<string, unknown>
        >;
        if (instances[0]) {
          instances[0].referenceImages = [
            {
              referenceImage: params.firstFrameImageUrl,
              referenceType: 'FIRST_FRAME',
            },
          ];
        }
      } else if (params.firstFrameImage) {
        const instances = requestBody.instances as Array<
          Record<string, unknown>
        >;
        if (instances[0]) {
          const base64 = params.firstFrameImage.toString('base64');
          instances[0].referenceImages = [
            {
              referenceImage: `data:image/png;base64,${base64}`,
              referenceType: 'FIRST_FRAME',
            },
          ];
        }
      }

      // Add negative prompt if available
      if (params.prompt.includes('NOT:')) {
        // Parse negative prompt from main prompt
        const [positive, negative] = params.prompt.split('NOT:');
        const instances = requestBody.instances as Array<
          Record<string, unknown>
        >;
        if (instances[0] && positive) {
          instances[0].prompt = positive.trim();
        }
        (requestBody.parameters as Record<string, unknown>).negativePrompt =
          negative?.trim();
      }

      this.logger.debug(`🎬 [GOOGLE-VIDEO] Request body:`, {
        model,
        durationSeconds,
        aspectRatio,
        resolution,
        hasFirstFrame: !!params.firstFrameImageUrl || !!params.firstFrameImage,
      });

      // Make Vertex AI API call
      // Veo uses long-running operations pattern
      const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await this.getAccessToken()}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Veo API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as {
        name: string; // Operation ID
        metadata?: {
          state?: string;
        };
      };

      this.logger.log(
        `🎬 [GOOGLE-VIDEO] Video generation started: operationId=${data.name}`,
      );

      const endTime = Date.now();

      // Return response with operation ID for polling
      return {
        operationId: data.name,
        status: this.mapVeoStatus(data.metadata?.state),
        metadata: {
          provider: 'google',
          model,
          requestId,
          timestamp: new Date().toISOString(),
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          timing: { startTime, endTime, duration: endTime - startTime },
          tier: 'external',
          status: 'started',
          providerSpecific: {
            veoOperationId: data.name,
            requestedDuration: durationSeconds,
            aspectRatio,
            resolution,
          },
        },
      };
    } catch (error) {
      const endTime = Date.now();

      this.logger.error(
        `🎬 [GOOGLE-VIDEO] Error: ${error instanceof Error ? error.message : String(error)}`,
      );

      return {
        status: 'failed',
        metadata: {
          provider: 'google',
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
          code: 'GOOGLE_VIDEO_GENERATION_FAILED',
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
   * When status is 'completed', the response will include videoUrl and videoData.
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
    const model = context.model || this.config.model || 'veo-3-generate';

    this.logger.debug(
      `🎬 [GOOGLE-VIDEO] pollVideoStatus() - operationId: ${operationId}`,
    );

    try {
      const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

      // Poll the operation status
      // operationId format: projects/{project}/locations/{location}/operations/{operation_id}
      const endpoint = `https://${location}-aiplatform.googleapis.com/v1/${operationId}`;

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${await this.getAccessToken()}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Veo API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as {
        name: string;
        done?: boolean;
        metadata?: {
          state?: string;
          progress?: number;
        };
        response?: {
          predictions?: Array<{
            videoUri?: string;
            durationSeconds?: number;
            aspectRatio?: string;
          }>;
        };
        error?: {
          message: string;
          code?: number;
        };
      };

      const endTime = Date.now();
      const status = data.done
        ? data.error
          ? 'failed'
          : 'completed'
        : this.mapVeoStatus(data.metadata?.state);

      // Build response
      const videoResponse: VideoGenerationResponse = {
        operationId: data.name,
        status,
        metadata: {
          provider: 'google',
          model,
          requestId: context.conversationId,
          timestamp: new Date().toISOString(),
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            // Cost calculated when completed
            cost:
              status === 'completed' &&
              data.response?.predictions?.[0]?.durationSeconds
                ? this.calculateVideoCost(
                    model,
                    data.response.predictions[0].durationSeconds,
                  )
                : undefined,
          },
          timing: { startTime, endTime, duration: endTime - startTime },
          tier: 'external',
          status: status === 'completed' ? 'completed' : 'started',
          providerSpecific: {
            veoOperationId: data.name,
            progress: data.metadata?.progress,
          },
        },
      };

      // If completed, get the video
      if (status === 'completed' && data.response?.predictions?.[0]?.videoUri) {
        const prediction = data.response.predictions[0];
        const videoUri = prediction.videoUri!; // Safe: checked above

        this.logger.log(
          `🎬 [GOOGLE-VIDEO] Video completed, downloading from ${videoUri}...`,
        );

        // Download video bytes
        // For Vertex AI, videos are typically stored in GCS
        // The videoUri might be a gs:// URI that needs conversion to HTTPS
        let downloadUrl: string = videoUri;
        if (videoUri.startsWith('gs://')) {
          // Convert gs:// to https://storage.googleapis.com/
          const [bucket, ...pathParts] = videoUri
            .replace('gs://', '')
            .split('/');
          downloadUrl = `https://storage.googleapis.com/${bucket}/${pathParts.join('/')}`;
        }

        const videoFetch = await fetch(downloadUrl, {
          headers: {
            Authorization: `Bearer ${await this.getAccessToken()}`,
          },
        });

        if (videoFetch.ok) {
          const arrayBuffer = await videoFetch.arrayBuffer();
          videoResponse.videoData = Buffer.from(arrayBuffer);
          videoResponse.videoUrl = videoUri;

          // Add video metadata
          videoResponse.videoMetadata = {
            durationSeconds: prediction.durationSeconds,
            mimeType: 'video/mp4',
            sizeBytes: videoResponse.videoData.length,
            hasAudio: true, // Veo 3 generates with audio
          } as VideoMetadata;
        }
      }

      // If failed, include error
      if (status === 'failed' && data.error) {
        videoResponse.error = {
          code: `VEO_ERROR_${data.error.code || 'UNKNOWN'}`,
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
          provider: 'google',
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
          code: 'GOOGLE_VIDEO_POLL_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Map duration to Veo-supported values (up to 8 seconds for Veo 3)
   */
  private mapVideoDuration(duration?: number): number {
    if (!duration) return 4; // Default
    // Veo 3 supports up to 8 seconds
    return Math.min(Math.max(duration, 1), 8);
  }

  /**
   * Map Veo operation state to our standard status
   */
  private mapVeoStatus(
    state?: string,
  ): 'pending' | 'processing' | 'completed' | 'failed' {
    switch (state?.toUpperCase()) {
      case 'PENDING':
      case 'QUEUED':
        return 'pending';
      case 'RUNNING':
      case 'IN_PROGRESS':
        return 'processing';
      case 'SUCCEEDED':
      case 'COMPLETED':
        return 'completed';
      case 'FAILED':
      case 'CANCELLED':
        return 'failed';
      default:
        return 'processing';
    }
  }

  /**
   * Calculate cost for video generation
   *
   * Veo 3 pricing is based on duration.
   */
  private calculateVideoCost(model: string, durationSeconds: number): number {
    // Approximate pricing (should come from database in production)
    // Veo 3 pricing: ~$0.25 per second
    const pricing: Record<string, number> = {
      'veo-3-generate': 0.25,
      'veo-3-fast-generate': 0.15,
      'veo-3.1-generate-preview': 0.3,
    };

    const perSecondCost = pricing[model] ?? pricing['veo-3-generate'] ?? 0.25;
    return perSecondCost * durationSeconds;
  }

  /**
   * Check if content was blocked by safety filters
   */
  private checkSafetyBlocking(response: unknown): {
    blocked: boolean;
    reason?: string;
  } {
    const r = response as {
      candidates?: Array<{ finishReason?: string; safetyRatings?: unknown[] }>;
    };
    const candidate = r.candidates?.[0];

    if (candidate?.finishReason === 'SAFETY') {
      const safetyRatings = candidate.safetyRatings || [];
      const blockedRatings = safetyRatings.filter((rating: unknown) => {
        const rat = rating as { probability?: string };
        return rat.probability === 'HIGH' || rat.probability === 'MEDIUM';
      });

      if (blockedRatings.length > 0) {
        return {
          blocked: true,
          reason: `Content blocked due to: ${blockedRatings.map((r: unknown) => (r as { category?: string }).category).join(', ')}`,
        };
      }
    }

    return { blocked: false };
  }
}

/**
 * Factory function to create Google service instances
 */
export function createGoogleService(
  config: LLMServiceConfig,
  dependencies: {
    piiService: PIIService;
    dictionaryPseudonymizerService: DictionaryPseudonymizerService;
    runMetadataService: RunMetadataService;
    providerConfigService: ProviderConfigService;
  },
): GoogleLLMService {
  return new GoogleLLMService(
    { ...config, provider: 'google' },
    dependencies.piiService,
    dependencies.dictionaryPseudonymizerService,
    dependencies.runMetadataService,
    dependencies.providerConfigService,
  );
}

/**
 * Example usage and testing
 */
export async function testGoogleService() {
  // This would be used in your tests to verify the Google implementation
  const config: LLMServiceConfig = {
    provider: 'google',
    model: 'gemini-1.5-flash',
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

  const service = createGoogleService(config, mockDependencies);

  const mockContext = createMockExecutionContext();
  const params: GenerateResponseParams = {
    systemPrompt: 'You are a helpful AI assistant powered by Google Gemini.',
    userMessage: 'Explain the benefits of multimodal AI models.',
    config,
    options: {
      executionContext: mockContext,
    },
  };

  const response = await service.generateResponse(mockContext, params);
  return response;
}
