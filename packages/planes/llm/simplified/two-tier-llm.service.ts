/**
 * Two-Tier LLM Service
 *
 * Implements LLMServiceProvider with two independently configurable backend tiers:
 *   - Commercial (COMMERCIAL_LLM_PROVIDER): openrouter, azure_foundry, vertex_ai, or none
 *   - Open Source (OPENSOURCE_LLM_PROVIDER): ollama_cloud, ollama_local, lm_studio, or none
 *
 * Merges model catalogs from both tiers and routes requests to the correct backend
 * based on which tier originally provided the model.
 *
 * Selected by LLM_PROVIDER=simplified (replaces SimplifiedLLMService).
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
import {
  COMMERCIAL_CLIENT,
  OPENSOURCE_CLIENT,
  LLMClient,
} from './llm-client.interface';
import { OpenRouterClient } from './openrouter.client';
import { OpenRouterAdapter } from './adapters/openrouter.adapter';

@Injectable()
export class TwoTierLLMService implements LLMServiceProvider {
  private readonly logger = new Logger(TwoTierLLMService.name);
  private modelsCache: { data: LLMModelInfo[]; timestamp: number } | null =
    null;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  /**
   * Maps model ID -> tier that owns it.
   * Built during listModels() and used by resolveBackend().
   */
  private modelOwnership = new Map<string, 'commercial' | 'opensource'>();

  /** Lazy-initialized OpenRouter adapter for fallback routing */
  private openRouterFallback: LLMClient | null = null;

  constructor(
    @Inject(COMMERCIAL_CLIENT) private readonly commercialClient: LLMClient,
    @Inject(OPENSOURCE_CLIENT) private readonly opensourceClient: LLMClient,
    @Inject(OpenRouterClient) private readonly openRouterClient: OpenRouterClient,
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
    this.modelOwnership.clear();

    // Fetch from commercial tier
    try {
      const commercialModels = await this.commercialClient.listModels();
      for (const m of commercialModels) {
        allModels.push({
          id: m.id,
          name: m.name,
          providerName: m.providerName,
          modelType:
            (m.modelType as LLMModelInfo['modelType']) || 'text-generation',
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          pricing: m.pricing,
          isLocal: false,
        });
        this.modelOwnership.set(m.id, 'commercial');
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch commercial models: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Fetch from open source tier
    try {
      const opensourceModels = await this.opensourceClient.listModels();
      for (const m of opensourceModels) {
        allModels.push({
          id: m.id,
          name: m.name,
          providerName: m.providerName,
          modelType:
            (m.modelType as LLMModelInfo['modelType']) || 'text-generation',
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          pricing: m.pricing,
          isLocal: true,
        });
        this.modelOwnership.set(m.id, 'opensource');
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch opensource models: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.modelsCache = { data: allModels, timestamp: Date.now() };
    return this.applyFilters(allModels, filters);
  }

  /**
   * Derive providers dynamically from the cached model list.
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

    // Sort: local providers first (ollama, lm_studio), then alphabetical
    const localProviders = new Set(['ollama', 'lm_studio']);
    return [...seen.values()].sort((a, b) => {
      const aLocal = localProviders.has(a.name);
      const bLocal = localProviders.has(b.name);
      if (aLocal && !bLocal) return -1;
      if (!aLocal && bLocal) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  private formatProviderName(name: string): string {
    const displayNames: Record<string, string> = {
      ollama: 'Ollama',
      lm_studio: 'LM Studio',
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      google: 'Google',
      'meta-llama': 'Meta',
      mistralai: 'Mistral AI',
      qwen: 'Qwen',
      deepseek: 'DeepSeek',
      cohere: 'Cohere',
      'x-ai': 'xAI',
      azure_foundry: 'Azure AI Foundry',
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
   * Resolve which tier (client) to use for a given provider + model.
   *
   * Uses the modelOwnership map built during listModels().
   * For OpenRouter models, reconstructs the provider/model API format.
   */
  private resolveBackend(
    provider: string,
    model: string,
    sovereignMode?: boolean,
  ): { client: LLMClient; apiModel: string } {
    // Sovereign mode forces everything through the opensource tier
    if (sovereignMode) {
      return { client: this.opensourceClient, apiModel: model };
    }

    // Check ownership map
    const tier = this.modelOwnership.get(model);

    if (tier === 'opensource') {
      return { client: this.opensourceClient, apiModel: model };
    }

    if (tier === 'commercial') {
      // OpenRouter requires provider/model format; Vertex AI uses bare model ID
      const isOpenRouter = this.commercialClient instanceof OpenRouterClient;
      const apiModel = isOpenRouter
        ? model.includes('/')
          ? model
          : `${provider}/${model}`
        : model;
      return { client: this.commercialClient, apiModel };
    }

    // Model not in ownership map — use provider name as heuristic
    const localProviders = new Set(['ollama', 'lm_studio']);
    if (localProviders.has(provider)) {
      return { client: this.opensourceClient, apiModel: model };
    }

    // If the commercial client is NOT OpenRouter (e.g. Vertex AI, Azure Foundry),
    // unknown models won't be in its catalog. Fall back to OpenRouter for these.
    const isOpenRouter = this.commercialClient instanceof OpenRouterClient;
    if (!isOpenRouter) {
      this.logger.debug(
        `Model "${model}" not in commercial catalog, falling back to OpenRouter`,
      );
      if (!this.openRouterFallback) {
        this.openRouterFallback = new OpenRouterAdapter(this.openRouterClient);
      }
      const apiModel = model.includes('/') ? model : `${provider}/${model}`;
      return { client: this.openRouterFallback, apiModel };
    }

    // Default to commercial (OpenRouter) — reconstruct provider/model format
    const apiModel = model.includes('/') ? model : `${provider}/${model}`;
    return { client: this.commercialClient, apiModel };
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

    // Ensure ownership map is populated
    if (this.modelOwnership.size === 0) {
      await this.listModels();
    }

    const { client, apiModel } = this.resolveBackend(
      provider,
      model,
      executionContext.sovereignMode,
    );

    this.logger.debug(
      `Two-tier LLM: provider=${provider} model=${model} -> ${client.tier} apiModel=${apiModel}`,
    );

    // Emit started event
    this.emitLlmObservabilityEvent('agent.llm.started', executionContext, {
      provider,
      model,
      tier: client.tier,
      message: 'LLM call started (two-tier)',
    });

    const startTime = Date.now();
    const requestId = uuidv4();

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    try {
      const result = await client.chatCompletion({
        model: apiModel,
        messages,
        temperature: options?.temperature,
        max_tokens: options?.maxTokens ?? options?.max_tokens,
        top_p: options?.top_p,
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Capture reasoning content if the adapter surfaced it.
      // Truncate at 64KB so a runaway reasoning chain can't blow out a row.
      let reasoningContent: string | undefined = result.reasoning;
      let reasoningTruncated = false;
      const REASONING_MAX_BYTES = 65536;
      if (reasoningContent && reasoningContent.length > REASONING_MAX_BYTES) {
        this.logger.warn(
          `Reasoning content truncated for run_id=${requestId} (original length=${reasoningContent.length})`,
        );
        reasoningContent = reasoningContent.slice(0, REASONING_MAX_BYTES);
        reasoningTruncated = true;
      }

      // Track usage — record the original provider/model the user selected
      await this.recordUsage({
        requestId,
        provider,
        model,
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
        cost:
          result.cost ??
          this.estimateCost(
            result.usage.promptTokens,
            result.usage.completionTokens,
          ),
        duration,
        status: 'completed',
        tier: client.tier,
        executionContext,
        reasoningContent,
        reasoningTokens: result.usage.reasoningTokens,
        reasoningTruncated,
      });

      // Emit completed event
      this.emitLlmObservabilityEvent('agent.llm.completed', executionContext, {
        provider,
        model,
        tier: client.tier,
        message: 'LLM call completed (two-tier)',
        responsePreview: result.content.substring(0, 500),
      });

      if (options?.includeMetadata) {
        const metadata: ResponseMetadata = {
          provider,
          model,
          requestId,
          timestamp: new Date().toISOString(),
          usage: {
            inputTokens: result.usage.promptTokens,
            outputTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
            cost: result.cost ?? undefined,
          },
          timing: { startTime, endTime, duration },
          tier: client.tier === 'opensource' ? 'local' : 'external',
          status: 'completed',
          thinking: reasoningContent,
        };
        return { content: result.content, metadata } as LLMResponse;
      }

      return result.content;
    } catch (error) {
      this.emitLlmObservabilityEvent('agent.llm.failed', executionContext, {
        provider,
        model,
        tier: client.tier,
        message: 'LLM call failed (two-tier)',
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
    } as Parameters<TwoTierLLMService['generateResponse']>[2]);
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
    // Image generation always goes through the commercial tier (OpenRouter)
    const apiModel = params.model.includes('/')
      ? params.model
      : `${params.provider}/${params.model}`;
    const startTime = Date.now();
    const requestId = uuidv4();

    this.emitLlmObservabilityEvent(
      'agent.llm.started',
      params.executionContext,
      {
        provider: params.provider,
        model: params.model,
        message: 'Image generation started (two-tier)',
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

      await this.recordUsage({
        requestId,
        provider: params.provider,
        model: params.model,
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
        cost: result.cost ?? 0,
        duration: endTime - startTime,
        status: 'completed',
        tier: 'commercial',
        executionContext: params.executionContext,
      });

      this.logger.debug(
        `Image result: imageBase64=${result.imageBase64 ? `${result.imageBase64.length} chars` : 'absent'}`,
      );

      let imageData: Buffer;
      if (result.imageBase64) {
        imageData = Buffer.from(result.imageBase64, 'base64');
      } else {
        throw new Error(
          `Image generation returned no image data. ` +
            `imageBase64=${result.imageBase64 ? 'present' : 'absent'}`,
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
          message: 'Image generation completed (two-tier)',
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
          message: 'Image generation failed (two-tier)',
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
      'Video generation is not supported in two-tier LLM mode. ' +
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
      'Video status polling is not supported in two-tier LLM mode. ' +
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
    tier: 'commercial' | 'opensource';
    executionContext: ExecutionContext;
    reasoningContent?: string;
    reasoningTokens?: number;
    reasoningTruncated?: boolean;
  }): Promise<void> {
    try {
      await this.db.from(null, 'llm_usage').insert({
        run_id: params.requestId,
        provider: params.provider,
        model: params.model,
        tier: params.tier === 'opensource' ? 'local' : 'external',
        cost: params.cost,
        duration: params.duration,
        input_tokens: params.inputTokens,
        output_tokens: params.outputTokens,
        reasoning_content: params.reasoningContent ?? null,
        reasoning_tokens: params.reasoningTokens ?? null,
        reasoning_truncated: params.reasoningTruncated ?? false,
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
    return (inputTokens / 1000) * 0.001 + (outputTokens / 1000) * 0.002;
  }
}
