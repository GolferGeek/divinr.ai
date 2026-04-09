/**
 * Simplified LLM Service
 *
 * Implements LLMServiceProvider for the simplified provider plane.
 * Routes requests through OpenRouter or Ollama Cloud via ModelRouter.
 * Tracks usage in llm_usage table via RunMetadataService.
 *
 * Selected by LLM_PROVIDER=simplified
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
import { OpenRouterClient } from './openrouter.client';
import { OllamaCloudClient } from './ollama-cloud.client';
import { ModelRouter } from './model-router';

@Injectable()
export class SimplifiedLLMService implements LLMServiceProvider {
  private readonly logger = new Logger(SimplifiedLLMService.name);
  private modelsCache: { data: LLMModelInfo[]; timestamp: number } | null =
    null;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(
    @Inject(OpenRouterClient) private readonly openRouterClient: OpenRouterClient,
    @Inject(OllamaCloudClient) private readonly ollamaCloudClient: OllamaCloudClient,
    @Inject(ModelRouter) private readonly modelRouter: ModelRouter,
    @Inject(ObservabilityEventsService) private readonly observabilityEventsService: ObservabilityEventsService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async listModels(filters?: {
    modelType?: string;
    sovereignMode?: boolean;
  }): Promise<LLMModelInfo[]> {
    // Return from cache if still valid
    if (
      this.modelsCache &&
      Date.now() - this.modelsCache.timestamp < this.cacheTtlMs
    ) {
      return this.applyFilters(this.modelsCache.data, filters);
    }

    const allModels: LLMModelInfo[] = [];

    // Fetch from OpenRouter — split "provider/model" IDs into real providers
    // e.g. "anthropic/claude-sonnet-4.6" → providerName="anthropic", id="claude-sonnet-4.6"
    try {
      const orModels = await this.openRouterClient.listModels();
      for (const m of orModels) {
        const modalities = m.architecture?.output_modalities ?? [];
        let modelType: LLMModelInfo['modelType'] = 'text-generation';
        if (modalities.includes('image')) modelType = 'image-generation';

        const slashIdx = m.id.indexOf('/');
        const realProvider =
          slashIdx > 0 ? m.id.substring(0, slashIdx) : 'openrouter';
        const modelName = slashIdx > 0 ? m.id.substring(slashIdx + 1) : m.id;

        allModels.push({
          id: modelName,
          name: m.name || m.id,
          providerName: realProvider,
          modelType,
          contextWindow: m.context_length,
          maxOutputTokens: m.top_provider?.max_completion_tokens,
          pricing: m.pricing
            ? {
                inputPer1M: m.pricing.prompt
                  ? parseFloat(m.pricing.prompt) * 1_000_000
                  : undefined,
                outputPer1M: m.pricing.completion
                  ? parseFloat(m.pricing.completion) * 1_000_000
                  : undefined,
              }
            : undefined,
          isLocal: false,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch OpenRouter models: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Fetch from Ollama Cloud — provider is "ollama", model is just the name
    try {
      const ollamaModels = await this.ollamaCloudClient.listModels();
      for (const m of ollamaModels) {
        allModels.push({
          id: m.id,
          name: m.name,
          providerName: 'ollama',
          modelType: 'text-generation',
          isLocal: true,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Ollama models: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.modelsCache = { data: allModels, timestamp: Date.now() };
    return this.applyFilters(allModels, filters);
  }

  /**
   * Derive providers dynamically from the cached model list.
   * Each unique providerName becomes a provider entry.
   */
  async listProviders(): Promise<LLMProviderInfo[]> {
    // Ensure models are loaded so we can derive providers
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

    // Sort: ollama first (local), then alphabetical
    return [...seen.values()].sort((a, b) => {
      if (a.name === 'ollama') return -1;
      if (b.name === 'ollama') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  private formatProviderName(name: string): string {
    const displayNames: Record<string, string> = {
      ollama: 'Ollama Cloud',
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      google: 'Google',
      'meta-llama': 'Meta',
      mistralai: 'Mistral AI',
      qwen: 'Qwen',
      deepseek: 'DeepSeek',
      cohere: 'Cohere',
      'x-ai': 'xAI',
    };
    return (
      displayNames[name] ??
      name
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    );
  }

  private applyFilters(
    models: LLMModelInfo[],
    filters?: { modelType?: string; sovereignMode?: boolean },
  ): LLMModelInfo[] {
    let result = models;
    if (filters?.modelType) {
      result = result.filter((m) => m.modelType === filters.modelType);
    }
    if (filters?.sovereignMode) {
      result = result.filter((m) => m.isLocal);
    }
    return result;
  }

  /**
   * Normalize shorthand model names to valid OpenRouter model IDs.
   *
   * Agent records may store model names with dashes (e.g., "claude-sonnet-4-6")
   * but OpenRouter uses dots for version numbers (e.g., "claude-sonnet-4.6").
   * This map handles the translation.
   */
  private static readonly MODEL_ALIASES: Record<string, string> = {
    // Claude 4.x family — dash-separated versions to dot-separated
    'claude-sonnet-4-6': 'claude-sonnet-4.6',
    'claude-opus-4-6': 'claude-opus-4.6',
    'claude-sonnet-4-5': 'claude-sonnet-4.5',
    'claude-opus-4-5': 'claude-opus-4.5',
    'claude-haiku-4-5': 'claude-haiku-4.5',
  };

  /**
   * Resolve separate provider + model into the backend target and API model ID.
   *
   * ExecutionContext carries provider="anthropic", model="claude-sonnet-4.6"
   *   → target=openrouter, apiModel="anthropic/claude-sonnet-4.6"
   *
   * ExecutionContext carries provider="ollama", model="deepseek-v3.2"
   *   → target=ollama_cloud, apiModel="deepseek-v3.2"
   */
  private resolveBackend(
    provider: string,
    model: string,
    sovereignMode?: boolean,
  ): { target: 'openrouter' | 'ollama_cloud'; apiModel: string } {
    // Normalize model name aliases before routing
    const normalizedModel = SimplifiedLLMService.MODEL_ALIASES[model] ?? model;

    // Sovereign mode forces everything through Ollama Cloud
    if (sovereignMode) {
      return { target: 'ollama_cloud', apiModel: normalizedModel };
    }

    // Ollama provider → Ollama Cloud
    if (provider === 'ollama') {
      return { target: 'ollama_cloud', apiModel: normalizedModel };
    }

    // Everything else → OpenRouter with provider/model format
    // If model already contains a slash, it's already in OpenRouter format
    const apiModel = normalizedModel.includes('/')
      ? normalizedModel
      : `${provider}/${normalizedModel}`;
    return { target: 'openrouter', apiModel };
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

    const provider = executionContext.provider || options?.provider || 'openai';
    const model = executionContext.model || options?.model || 'gpt-4o';
    const { target, apiModel } = this.resolveBackend(
      provider,
      model,
      executionContext.sovereignMode,
    );

    this.logger.debug(
      `Simplified LLM: provider=${provider} model=${model} -> ${target} apiModel=${apiModel}`,
    );

    // Emit started event
    this.emitLlmObservabilityEvent('agent.llm.started', executionContext, {
      provider: target,
      model: apiModel,
      message: 'LLM call started (simplified)',
    });

    const startTime = Date.now();
    const requestId = uuidv4();

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    try {
      let content: string;
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let cost: number | null = null;

      if (target === 'openrouter') {
        const result = await this.openRouterClient.chatCompletion({
          model: apiModel,
          messages,
          temperature: options?.temperature,
          max_tokens: options?.maxTokens ?? options?.max_tokens,
          top_p: options?.top_p,
        });
        content = result.content;
        usage = result.usage;
        cost = result.cost;
      } else {
        const result = await this.ollamaCloudClient.chatCompletion({
          model: apiModel,
          messages,
          temperature: options?.temperature,
          max_tokens: options?.maxTokens ?? options?.max_tokens,
          top_p: options?.top_p,
        });
        content = result.content;
        usage = result.usage;
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Track usage — record the original provider/model the user selected
      await this.recordUsage({
        requestId,
        provider,
        model,
        inputTokens: usage.promptTokens,
        outputTokens: usage.completionTokens,
        cost:
          cost ?? this.estimateCost(usage.promptTokens, usage.completionTokens),
        duration,
        status: 'completed',
        executionContext,
      });

      // Emit completed event
      this.emitLlmObservabilityEvent('agent.llm.completed', executionContext, {
        provider,
        model,
        message: 'LLM call completed (simplified)',
        responsePreview: content.substring(0, 500),
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
            cost: cost ?? undefined,
          },
          timing: { startTime, endTime, duration },
          tier: target === 'ollama_cloud' ? 'local' : 'external',
          status: 'completed',
        };
        return { content, metadata } as LLMResponse;
      }

      return content;
    } catch (error) {
      this.emitLlmObservabilityEvent('agent.llm.failed', executionContext, {
        provider,
        model,
        message: 'LLM call failed (simplified)',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    } as Parameters<SimplifiedLLMService['generateResponse']>[2]);
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
    const { apiModel } = this.resolveBackend(params.provider, params.model);
    const startTime = Date.now();
    const requestId = uuidv4();

    this.emitLlmObservabilityEvent(
      'agent.llm.started',
      params.executionContext,
      {
        provider: params.provider,
        model: params.model,
        message: 'Image generation started (simplified)',
        type: 'image-generation',
      },
    );

    try {
      const result = await this.openRouterClient.imageGeneration({
        model: apiModel,
        prompt: params.prompt,
        size: params.size,
      });

      const endTime = Date.now();

      // Record usage with original provider/model
      await this.recordUsage({
        requestId,
        provider: params.provider,
        model: params.model,
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
        cost: result.cost ?? 0,
        duration: endTime - startTime,
        status: 'completed',
        executionContext: params.executionContext,
      });

      // OpenRouter returns images as base64 data-URLs in message.images[]
      // The client extracts the raw base64 string for us
      this.logger.debug(
        `🖼️ [SIMPLIFIED] Image result: imageBase64=${result.imageBase64 ? `${result.imageBase64.length} chars` : 'absent'}, content length=${result.content?.length ?? 0}`,
      );

      let imageData: Buffer;
      if (result.imageBase64) {
        // Decode base64 image data to raw bytes
        imageData = Buffer.from(result.imageBase64, 'base64');
        this.logger.debug(
          `🖼️ [SIMPLIFIED] Decoded base64 image: ${imageData.length} bytes`,
        );
      } else {
        throw new Error(
          `OpenRouter image generation returned no image data. ` +
            `imageBase64=${result.imageBase64 ? 'present' : 'absent'}, ` +
            `content length=${result.content?.length ?? 0}`,
        );
      }

      const metadata: ResponseMetadata = {
        provider: params.provider,
        model: params.model,
        requestId,
        timestamp: new Date().toISOString(),
        usage: {
          inputTokens: result.usage.promptTokens,
          outputTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
          cost: result.cost ?? undefined,
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
          message: 'Image generation completed (simplified)',
          type: 'image-generation',
        },
      );

      return {
        images: [{ data: imageData }],
        metadata,
      };
    } catch (error) {
      this.emitLlmObservabilityEvent(
        'agent.llm.failed',
        params.executionContext,
        {
          provider: params.provider,
          model: params.model,
          message: 'Image generation failed (simplified)',
          error: error instanceof Error ? error.message : String(error),
          type: 'image-generation',
        },
      );
      throw error;
    }
  }

  async generateVideo(_params: {
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
    await Promise.resolve();
    throw new Error(
      'Video generation is not supported in simplified LLM mode. ' +
        'Use LLM_PROVIDER=fine_control for video generation capabilities.',
    );
  }

  async pollVideoStatus(_params: {
    provider: string;
    model?: string;
    operationId: string;
    executionContext: ExecutionContext;
  }): Promise<VideoGenerationResponse> {
    await Promise.resolve();
    throw new Error(
      'Video status polling is not supported in simplified LLM mode. ' +
        'Use LLM_PROVIDER=fine_control for video generation capabilities.',
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
        tier: params.provider === 'ollama' ? 'local' : 'external',
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
        organization_slug: params.executionContext.orgSlug,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record LLM usage: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private estimateCost(inputTokens: number, outputTokens: number): number {
    // Simple default: $0.001/1K input, $0.002/1K output
    return (inputTokens / 1000) * 0.001 + (outputTokens / 1000) * 0.002;
  }
}
