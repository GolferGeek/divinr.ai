/**
 * Azure AI Foundry LLM Service
 *
 * Implements LLMServiceProvider for the azure_foundry provider plane.
 * Uses @azure-rest/ai-inference SDK for Azure AI Inference (MaaS endpoint).
 *
 * Selected by LLM_PROVIDER=azure_foundry
 *
 * Required env vars:
 *   AZURE_AI_FOUNDRY_ENDPOINT  — the Azure AI Foundry inference endpoint URL
 *   AZURE_AI_FOUNDRY_KEY       — the API key for authentication
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

// Lazy-loaded Azure client to allow the module to load even when
// @azure-rest/ai-inference is not available at import time.
// The actual require() happens inside getClient() at call time.
interface AzureInferenceResponse {
  status: string;
  body: {
    choices: Array<{ message: { content: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    error?: { message?: string };
  };
}
interface AzurePathClient {
  post(params: {
    body: Record<string, unknown>;
  }): Promise<AzureInferenceResponse>;
}
interface AzureModelClientInterface {
  path(route: string): AzurePathClient;
  _isUnexpected?: (response: AzureInferenceResponse) => boolean;
}
type AzureModelClient = AzureModelClientInterface;

@Injectable()
export class AzureFoundryLLMService implements LLMServiceProvider {
  private readonly logger = new Logger(AzureFoundryLLMService.name);
  private client: AzureModelClient | null = null;
  private modelsCache: { data: LLMModelInfo[]; timestamp: number } | null =
    null;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly observabilityEventsService: ObservabilityEventsService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async listModels(filters?: {
    modelType?: string;
    sovereignMode?: boolean;
  }): Promise<LLMModelInfo[]> {
    if (filters?.sovereignMode) {
      return []; // Azure Foundry has no local models
    }

    if (
      this.modelsCache &&
      Date.now() - this.modelsCache.timestamp < this.cacheTtlMs
    ) {
      return filters?.modelType
        ? this.modelsCache.data.filter((m) => m.modelType === filters.modelType)
        : this.modelsCache.data;
    }

    const endpoint = process.env.AZURE_AI_FOUNDRY_ENDPOINT;
    const key = process.env.AZURE_AI_FOUNDRY_KEY;
    if (!endpoint || !key) {
      this.logger.warn(
        'Azure AI Foundry credentials not configured, returning empty model list',
      );
      return [];
    }

    const allModels: LLMModelInfo[] = [];
    let url: string | null =
      `${endpoint}/deployments?api-version=2024-04-01-preview`;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const axios = require('axios') as {
      get(
        url: string,
        opts: { headers: Record<string, string>; timeout: number },
      ): Promise<{ data: unknown }>;
    };

    while (url) {
      const response = await axios.get(url, {
        headers: { 'api-key': key },
        timeout: 15_000,
      });

      const body = response.data as {
        value?: Array<{
          name: string;
          properties?: {
            model?: { name?: string; publisher?: string };
            capabilities?: Record<string, string>;
          };
        }>;
        nextLink?: string;
      };

      for (const deployment of body.value ?? []) {
        // Use the publisher as providerName (e.g. "openai", "meta", "mistralai")
        // Falls back to "azure_foundry" if no publisher metadata
        const publisher =
          deployment.properties?.model?.publisher?.toLowerCase() ??
          'azure_foundry';

        allModels.push({
          id: deployment.name,
          name: deployment.properties?.model?.name ?? deployment.name,
          providerName: publisher,
          modelType: 'text-generation',
          capabilities: deployment.properties?.capabilities
            ? Object.keys(deployment.properties.capabilities)
            : undefined,
          isLocal: false,
        });
      }

      url = body.nextLink ?? null;
    }

    this.modelsCache = { data: allModels, timestamp: Date.now() };
    return filters?.modelType
      ? allModels.filter((m) => m.modelType === filters.modelType)
      : allModels;
  }

  /**
   * Derive providers dynamically from the deployed model list.
   * Each unique publisher becomes a provider entry.
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
      azure_foundry: 'Azure AI Foundry',
      openai: 'OpenAI',
      meta: 'Meta',
      mistralai: 'Mistral AI',
      google: 'Google',
      cohere: 'Cohere',
      microsoft: 'Microsoft',
    };
    return (
      displayNames[name] ??
      name
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    );
  }

  private getClient(): AzureModelClient {
    if (this.client) {
      return this.client;
    }

    const endpoint = process.env.AZURE_AI_FOUNDRY_ENDPOINT;
    const key = process.env.AZURE_AI_FOUNDRY_KEY;

    if (!endpoint) {
      throw new Error(
        'AZURE_AI_FOUNDRY_ENDPOINT is required for azure_foundry LLM provider.',
      );
    }
    if (!key) {
      throw new Error(
        'AZURE_AI_FOUNDRY_KEY is required for azure_foundry LLM provider.',
      );
    }

    // Require the Azure REST SDK at call time
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { default: ModelClient, isUnexpected } =
      require('@azure-rest/ai-inference') as {
        default: (endpoint: string, cred: unknown) => AzureModelClientInterface;
        isUnexpected: (response: AzureInferenceResponse) => boolean;
      };

    const { AzureKeyCredential } = require('@azure/core-auth') as {
      AzureKeyCredential: new (key: string) => unknown;
    };
    /* eslint-enable @typescript-eslint/no-require-imports */

    this.client = ModelClient(endpoint, new AzureKeyCredential(key));
    // Store isUnexpected helper on client for later use
    this.client._isUnexpected = isUnexpected;
    return this.client;
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

    const provider =
      executionContext.provider || options?.provider || 'azure_foundry';
    const model = executionContext.model || options?.model || 'gpt-4o';

    this.logger.debug(`Azure Foundry LLM: provider=${provider} model=${model}`);

    this.emitLlmObservabilityEvent('agent.llm.started', executionContext, {
      provider,
      model,
      message: 'LLM call started (azure_foundry)',
    });

    const startTime = Date.now();
    const requestId = uuidv4();

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    const client = this.getClient();

    // Azure AI Foundry uses the deployment name (model) directly
    const response = await client.path('/chat/completions').post({
      body: {
        messages,
        model,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? options?.max_tokens,
      },
    });

    if (client._isUnexpected && client._isUnexpected(response)) {
      const errorBody = response.body as { error?: { message?: string } };
      const message =
        errorBody?.error?.message || 'Unknown Azure AI Foundry error';
      this.emitLlmObservabilityEvent('agent.llm.failed', executionContext, {
        provider,
        model,
        message: `LLM call failed (azure_foundry): ${message}`,
      });
      throw new Error(`Azure AI Foundry error: ${message}`);
    }

    const body = response.body as {
      choices: Array<{ message: { content: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const content = body.choices[0]?.message?.content ?? '';
    const usage = {
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
      totalTokens: body.usage?.total_tokens ?? 0,
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
      message: 'LLM call completed (azure_foundry)',
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
        },
        timing: { startTime, endTime, duration },
        tier: 'external',
        status: 'completed',
      };
      return { content, metadata } as LLMResponse;
    }

    return content;
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
    } as Parameters<AzureFoundryLLMService['generateResponse']>[2]);
  }

  generateImage(_params: {
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
    return Promise.reject(
      new Error(
        'Image generation is not supported via Azure AI Foundry. ' +
          'Use LLM_PROVIDER=fine_control for image generation capabilities.',
      ),
    );
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
        'Video generation is not supported via Azure AI Foundry. ' +
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
        'Video status polling is not supported via Azure AI Foundry. ' +
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
        organization_slug: params.executionContext.orgSlug,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record LLM usage: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private estimateCost(inputTokens: number, outputTokens: number): number {
    // Default estimate: $0.002/1K input, $0.008/1K output (GPT-4 class)
    return (inputTokens / 1000) * 0.002 + (outputTokens / 1000) * 0.008;
  }
}
