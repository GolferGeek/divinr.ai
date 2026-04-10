/**
 * Vertex AI LLM Service
 *
 * Implements LLMServiceProvider for the vertex_ai provider plane.
 * Uses @google-cloud/vertexai SDK for Gemini and Imagen models.
 *
 * Selected by LLM_PROVIDER=vertex_ai
 *
 * Required env vars:
 *   GCP_PROJECT_ID — the Google Cloud project ID
 *   GCP_REGION     — the GCP region (defaults to 'us-central1')
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ExecutionContext } from '@orchestrator-ai/transport-types';
import {
  LLMServiceProvider,
  LLMModelInfo,
  LLMProviderInfo,
} from '../llm.interface';
import type {
  LLMResponse,
  LLMRequestOptions,
  UnifiedGenerateResponseParams,
  ImageGenerationResponse,
  VideoGenerationResponse,
  ResponseMetadata,
} from '../fine-control/services/llm-interfaces';
import {
  ObservabilityEventsService,
  type ObservabilityEventRecord,
} from '../../observability';
import { DATABASE_SERVICE, DatabaseService } from '../../database';

// Lazy-loaded Vertex AI client interfaces to allow the module to load even when
// @google-cloud/vertexai is not installed at import time.
interface VertexAIUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}
interface VertexAIContent {
  parts: Array<{ text?: string }>;
}
interface VertexAICandidate {
  content?: VertexAIContent;
}
interface VertexAIGenerateResponse {
  response?: {
    candidates?: VertexAICandidate[];
    usageMetadata?: VertexAIUsageMetadata;
  };
}
interface VertexAIGenerativeModel {
  generateContent(
    params: Record<string, unknown>,
  ): Promise<VertexAIGenerateResponse>;
}
interface ImageGenerationModel {
  generateImages(
    params: Record<string, unknown>,
  ): Promise<{ images?: Array<{ imageBytes?: Buffer | string }> }>;
}
interface VertexAIPreview {
  getImageGenerationModel(model: string): ImageGenerationModel;
}
interface VertexAIClient {
  getGenerativeModel(params: { model: string }): VertexAIGenerativeModel;
  preview: VertexAIPreview;
}

@Injectable()
export class VertexAILLMService implements LLMServiceProvider {
  private readonly logger = new Logger(VertexAILLMService.name);
  private vertexAI: VertexAIClient | null = null;
  private modelsCache: { data: LLMModelInfo[]; timestamp: number } | null =
    null;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(
    @Inject(ObservabilityEventsService) private readonly observabilityEventsService: ObservabilityEventsService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async listModels(filters?: {
    modelType?: string;
    sovereignMode?: boolean;
  }): Promise<LLMModelInfo[]> {
    if (filters?.sovereignMode) {
      return []; // Vertex AI has no local models
    }

    if (
      this.modelsCache &&
      Date.now() - this.modelsCache.timestamp < this.cacheTtlMs
    ) {
      return filters?.modelType
        ? this.modelsCache.data.filter((m) => m.modelType === filters.modelType)
        : this.modelsCache.data;
    }

    const project = process.env.GCP_PROJECT_ID;
    if (!project) {
      this.logger.warn(
        'GCP_PROJECT_ID not configured, returning empty model list',
      );
      return [];
    }

    const location = process.env.GCP_REGION || 'us-central1';
    const allModels: LLMModelInfo[] = [];

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GoogleAuth } = require('google-auth-library') as {
      GoogleAuth: new (opts: { scopes: string[] }) => {
        getClient(): Promise<{
          request(opts: {
            url: string;
            timeout?: number;
          }): Promise<{ data: unknown }>;
        }>;
      };
    };
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();

    // The Model Garden list endpoint is v1beta1 (not v1).
    // We filter to Gemini (text) and Imagen (image) model families.
    const geminiAndImagenPrefixes = ['gemini-', 'imagen-', 'veo-', 'gemma-'];

    let pageToken: string | null = null;
    const baseUrl = `https://${location}-aiplatform.googleapis.com/v1beta1/publishers/google/models`;

    do {
      const url = pageToken
        ? `${baseUrl}?pageSize=100&pageToken=${pageToken}`
        : `${baseUrl}?pageSize=100`;
      const rawResponse = await client.request({ url, timeout: 15_000 });
      const body = rawResponse.data as {
        publisherModels?: Array<{
          name: string;
          versionId?: string;
          launchStage?: string;
          openSourceCategory?: string;
        }>;
        nextPageToken?: string;
      };

      for (const model of body.publisherModels ?? []) {
        // Extract model ID: "publishers/google/models/gemini-2.0-flash" → "gemini-2.0-flash"
        const modelId = model.name.split('/').pop() ?? model.name;

        // Only include Gemini, Imagen, Veo, and Gemma models
        if (!geminiAndImagenPrefixes.some((p) => modelId.startsWith(p))) {
          continue;
        }

        const publisherMatch = model.name.match(/publishers\/([^/]+)\//);
        const publisher = publisherMatch?.[1]?.toLowerCase() ?? 'google';

        // Classify model type by prefix
        const modelType = modelId.startsWith('imagen-')
          ? 'image-generation'
          : modelId.startsWith('veo-')
            ? 'video-generation'
            : 'text-generation';

        allModels.push({
          id: modelId,
          name: modelId,
          providerName: publisher,
          modelType,
          isLocal: false,
        });
      }

      pageToken = body.nextPageToken ?? null;
    } while (pageToken);

    this.modelsCache = { data: allModels, timestamp: Date.now() };
    return filters?.modelType
      ? allModels.filter((m) => m.modelType === filters.modelType)
      : allModels;
  }

  /**
   * Derive providers dynamically from the model list.
   * On Vertex AI most models are published by Google, but third-party
   * publishers (e.g. Anthropic on Model Garden) get their own entry.
   */
  async listProviders(): Promise<LLMProviderInfo[]> {
    const models = await this.listModels();
    const seen = new Map<string, LLMProviderInfo>();

    for (const m of models) {
      if (!seen.has(m.providerName)) {
        seen.set(m.providerName, {
          name: m.providerName,
          displayName: this.formatProviderName(m.providerName),
          status: 'active' as const,
        });
      }
    }

    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private formatProviderName(name: string): string {
    const displayNames: Record<string, string> = {
      google: 'Google',
      anthropic: 'Anthropic',
      meta: 'Meta',
      mistralai: 'Mistral AI',
    };
    return (
      displayNames[name] ??
      name
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    );
  }

  private getVertexAI(): VertexAIClient {
    if (this.vertexAI) {
      return this.vertexAI;
    }

    const project = process.env.GCP_PROJECT_ID;
    if (!project) {
      throw new Error('GCP_PROJECT_ID is required for vertex_ai LLM provider.');
    }

    const location = process.env.GCP_REGION || 'us-central1';

    // Require the Vertex AI SDK at call time
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { VertexAI } = require('@google-cloud/vertexai') as {
      VertexAI: new (opts: {
        project: string;
        location: string;
      }) => VertexAIClient;
    };

    this.vertexAI = new VertexAI({ project, location });
    return this.vertexAI;
  }

  async generateResponse(
    systemPrompt: string,
    userMessage: string,
    options?: LLMRequestOptions & {
      provider?: string;
      cidafmOptions?: Record<string, unknown>;
      complexity?: 'simple' | 'medium' | 'complex' | 'reasoning';
      images?: Array<{ base64: string; mimeType: string }>;
    },
  ): Promise<string | LLMResponse> {
    const executionContext = options?.executionContext;
    if (!executionContext) {
      throw new Error(
        'ExecutionContext is required for generateResponse. Pass executionContext in options.',
      );
    }

    const provider = executionContext.provider || options?.provider || 'google';
    const model = executionContext.model || options?.model || 'gemini-1.5-pro';

    this.logger.debug(`Vertex AI LLM: provider=${provider} model=${model}`);

    this.emitLlmObservabilityEvent('agent.llm.started', executionContext, {
      provider,
      model,
      message: 'LLM call started (vertex_ai)',
    });

    const startTime = Date.now();
    const requestId = uuidv4();

    const vertexAI = this.getVertexAI();
    // Vertex AI SDK uses the model ID directly (e.g. "gemini-1.5-pro")
    const generativeModel = vertexAI.getGenerativeModel({ model });

    const response = await generativeModel.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: userMessage }],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
    });

    const result = response.response;
    const content = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    const usageMetadata: VertexAIUsageMetadata | undefined =
      result?.usageMetadata;
    const usage = {
      promptTokens: usageMetadata?.promptTokenCount ?? 0,
      completionTokens: usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: usageMetadata?.totalTokenCount ?? 0,
    };

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Record with original provider/model from ExecutionContext
    await this.recordUsage({
      requestId,
      provider,
      model,
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      cost: this.estimateCost(usage.promptTokens, usage.completionTokens),
      duration,
      status: 'completed',
      executionContext,
    });

    this.emitLlmObservabilityEvent('agent.llm.completed', executionContext, {
      provider,
      model,
      message: 'LLM call completed (vertex_ai)',
      responsePreview: String(content).substring(0, 500),
    });

    if (options?.includeMetadata) {
      const metadata: ResponseMetadata = {
        provider,
        model,
        requestId,
        timestamp: new Date().toISOString(),
        usage: {
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        },
        timing: { startTime, endTime, duration },
        tier: 'external',
        status: 'completed',
      };
      return { content: String(content), metadata } as LLMResponse;
    }

    return String(content);
  }

  async generateUnifiedResponse(
    params: UnifiedGenerateResponseParams,
  ): Promise<string | LLMResponse> {
    const options = params.options;
    if (!options?.executionContext) {
      throw new Error(
        'ExecutionContext is required in options for generateUnifiedResponse',
      );
    }
    return this.generateResponse(params.systemPrompt, params.userMessage, {
      ...options,
      provider: params.provider,
      model: params.model,
    } as Parameters<VertexAILLMService['generateResponse']>[2]);
  }

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
    const startTime = Date.now();
    const requestId = uuidv4();

    this.emitLlmObservabilityEvent(
      'agent.llm.started',
      params.executionContext,
      {
        provider: params.provider,
        model: params.model,
        message: 'Image generation started (vertex_ai)',
        type: 'image-generation',
      },
    );

    const vertexAI = this.getVertexAI();
    const imagenModel = vertexAI.preview.getImageGenerationModel(
      'imagen-3.0-generate-001',
    );

    const imageCount = params.numberOfImages ?? 1;

    // Map size to aspectRatio
    const aspectRatio = this.sizeToAspectRatio(params.size);

    const imageResponse = await imagenModel.generateImages({
      prompt: params.prompt as unknown,
      numberOfImages: imageCount as unknown,
      aspectRatio: aspectRatio as unknown,
    } as Record<string, unknown>);

    const endTime = Date.now();

    await this.recordUsage({
      requestId,
      provider: 'vertex_ai',
      model: params.model,
      inputTokens: 0,
      outputTokens: 0,
      // Imagen pricing is per image, not per token
      cost: imageCount * 0.02,
      duration: endTime - startTime,
      status: 'completed',
      executionContext: params.executionContext,
    });

    const metadata: ResponseMetadata = {
      provider: 'vertex_ai',
      model: params.model,
      requestId,
      timestamp: new Date().toISOString(),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      timing: {
        startTime,
        endTime,
        duration: endTime - startTime,
      },
      tier: 'external',
      status: 'completed',
    };

    this.emitLlmObservabilityEvent(
      'agent.llm.completed',
      params.executionContext,
      {
        provider: params.provider,
        model: params.model,
        message: 'Image generation completed (vertex_ai)',
        type: 'image-generation',
      },
    );

    // Map Imagen response images to ImageGenerationResponse format
    const images: Array<{ data: Buffer }> = (imageResponse.images ?? []).map(
      (img: { imageBytes?: Buffer | string }) => ({
        data: img.imageBytes
          ? Buffer.isBuffer(img.imageBytes)
            ? img.imageBytes
            : Buffer.from(img.imageBytes, 'base64')
          : Buffer.alloc(0),
      }),
    );

    return { images, metadata };
  }

  generateVideo(_params: {
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
    return Promise.reject(
      new Error(
        'Video generation is not supported via Vertex AI in this plane. ' +
          'Use LLM_PROVIDER=fine_control for video generation capabilities.',
      ),
    );
  }

  pollVideoStatus(_params: {
    provider: string;
    model?: string;
    operationId: string;
    executionContext: ExecutionContext;
  }): Promise<VideoGenerationResponse> {
    return Promise.reject(
      new Error(
        'Video status polling is not supported via Vertex AI in this plane. ' +
          'Use LLM_PROVIDER=fine_control for video generation capabilities.',
      ),
    );
  }

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
      this.logger.debug(
        `Failed to emit LLM observability event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async recordUsage(params: {
    requestId: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    duration: number;
    status: string;
    executionContext: ExecutionContext;
  }): Promise<void> {
    try {
      await this.db.from(null, 'llm_usage').insert({
        run_id: params.requestId,
        provider: params.provider,
        model: params.model,
        tier: 'external',
        cost: params.cost,
        duration: params.duration,
        input_tokens: params.inputTokens,
        output_tokens: params.outputTokens,
        status: params.status,
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
        user_id: params.executionContext.userId,
        caller_type: 'agent',
        caller_name: params.executionContext.agentSlug,
        conversation_id: params.executionContext.conversationId,
        organization_slug: null,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record LLM usage: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private estimateCost(inputTokens: number, outputTokens: number): number {
    // Gemini 1.5 Pro pricing estimate: $0.00125/1K input, $0.005/1K output
    return (inputTokens / 1000) * 0.00125 + (outputTokens / 1000) * 0.005;
  }

  private sizeToAspectRatio(
    size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792',
  ): string {
    switch (size) {
      case '1792x1024':
        return '16:9';
      case '1024x1792':
        return '9:16';
      default:
        return '1:1';
    }
  }
}
