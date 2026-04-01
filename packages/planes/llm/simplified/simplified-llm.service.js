"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var SimplifiedLLMService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimplifiedLLMService = void 0;
/**
 * Simplified LLM Service
 *
 * Implements LLMServiceProvider for the simplified provider plane.
 * Routes requests through OpenRouter or Ollama Cloud via ModelRouter.
 * Tracks usage in llm_usage table via RunMetadataService.
 *
 * Selected by LLM_PROVIDER=simplified
 */
const common_1 = require("@nestjs/common");
const uuid_1 = require("uuid");
const observability_1 = require("@orchestratorai/planes/observability");
const database_1 = require("../../database");
const openrouter_client_1 = require("./openrouter.client");
const ollama_cloud_client_1 = require("./ollama-cloud.client");
const model_router_1 = require("./model-router");
let SimplifiedLLMService = class SimplifiedLLMService {
    static { SimplifiedLLMService_1 = this; }
    openRouterClient;
    ollamaCloudClient;
    modelRouter;
    observabilityEventsService;
    db;
    logger = new common_1.Logger(SimplifiedLLMService_1.name);
    modelsCache = null;
    cacheTtlMs = 5 * 60 * 1000; // 5 minutes
    constructor(openRouterClient, ollamaCloudClient, modelRouter, observabilityEventsService, db) {
        this.openRouterClient = openRouterClient;
        this.ollamaCloudClient = ollamaCloudClient;
        this.modelRouter = modelRouter;
        this.observabilityEventsService = observabilityEventsService;
        this.db = db;
    }
    async listModels(filters) {
        // Return from cache if still valid
        if (this.modelsCache &&
            Date.now() - this.modelsCache.timestamp < this.cacheTtlMs) {
            return this.applyFilters(this.modelsCache.data, filters);
        }
        const allModels = [];
        // Fetch from OpenRouter — split "provider/model" IDs into real providers
        // e.g. "anthropic/claude-sonnet-4.6" → providerName="anthropic", id="claude-sonnet-4.6"
        try {
            const orModels = await this.openRouterClient.listModels();
            for (const m of orModels) {
                const modalities = m.architecture?.output_modalities ?? [];
                let modelType = 'text-generation';
                if (modalities.includes('image'))
                    modelType = 'image-generation';
                const slashIdx = m.id.indexOf('/');
                const realProvider = slashIdx > 0 ? m.id.substring(0, slashIdx) : 'openrouter';
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
        }
        catch (error) {
            this.logger.warn(`Failed to fetch OpenRouter models: ${error instanceof Error ? error.message : String(error)}`);
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
        }
        catch (error) {
            this.logger.warn(`Failed to fetch Ollama models: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.modelsCache = { data: allModels, timestamp: Date.now() };
        return this.applyFilters(allModels, filters);
    }
    /**
     * Derive providers dynamically from the cached model list.
     * Each unique providerName becomes a provider entry.
     */
    async listProviders() {
        // Ensure models are loaded so we can derive providers
        const models = await this.listModels();
        const seen = new Map();
        for (const m of models) {
            if (!seen.has(m.providerName)) {
                seen.set(m.providerName, {
                    name: m.providerName,
                    displayName: this.formatProviderName(m.providerName),
                    status: 'active',
                });
            }
        }
        // Sort: ollama first (local), then alphabetical
        return [...seen.values()].sort((a, b) => {
            if (a.name === 'ollama')
                return -1;
            if (b.name === 'ollama')
                return 1;
            return a.name.localeCompare(b.name);
        });
    }
    formatProviderName(name) {
        const displayNames = {
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
        return (displayNames[name] ??
            name
                .split('-')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' '));
    }
    applyFilters(models, filters) {
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
    static MODEL_ALIASES = {
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
    resolveBackend(provider, model, sovereignMode) {
        // Normalize model name aliases before routing
        const normalizedModel = SimplifiedLLMService_1.MODEL_ALIASES[model] ?? model;
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
    async generateResponse(systemPrompt, userMessage, options) {
        const executionContext = options?.executionContext;
        if (!executionContext) {
            throw new Error('ExecutionContext is required for generateResponse. Pass executionContext in options.');
        }
        const provider = executionContext.provider || options?.provider || 'openai';
        const model = executionContext.model || options?.model || 'gpt-4o';
        const { target, apiModel } = this.resolveBackend(provider, model, executionContext.sovereignMode);
        this.logger.debug(`Simplified LLM: provider=${provider} model=${model} -> ${target} apiModel=${apiModel}`);
        // Emit started event
        this.emitLlmObservabilityEvent('agent.llm.started', executionContext, {
            provider: target,
            model: apiModel,
            message: 'LLM call started (simplified)',
        });
        const startTime = Date.now();
        const requestId = (0, uuid_1.v4)();
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
        ];
        try {
            let content;
            let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
            let cost = null;
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
            }
            else {
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
                cost: cost ?? this.estimateCost(usage.promptTokens, usage.completionTokens),
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
                const metadata = {
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
                return { content, metadata };
            }
            return content;
        }
        catch (error) {
            this.emitLlmObservabilityEvent('agent.llm.failed', executionContext, {
                provider,
                model,
                message: 'LLM call failed (simplified)',
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    async generateUnifiedResponse(params) {
        const options = params.options;
        if (!options?.executionContext) {
            throw new Error('ExecutionContext is required in options for generateUnifiedResponse');
        }
        return this.generateResponse(params.systemPrompt, params.userMessage, {
            ...options,
            provider: params.provider,
            model: params.model,
        });
    }
    async generateImage(params) {
        const { apiModel } = this.resolveBackend(params.provider, params.model);
        const startTime = Date.now();
        const requestId = (0, uuid_1.v4)();
        this.emitLlmObservabilityEvent('agent.llm.started', params.executionContext, {
            provider: params.provider,
            model: params.model,
            message: 'Image generation started (simplified)',
            type: 'image-generation',
        });
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
            this.logger.debug(`🖼️ [SIMPLIFIED] Image result: imageBase64=${result.imageBase64 ? `${result.imageBase64.length} chars` : 'absent'}, content length=${result.content?.length ?? 0}`);
            let imageData;
            if (result.imageBase64) {
                // Decode base64 image data to raw bytes
                imageData = Buffer.from(result.imageBase64, 'base64');
                this.logger.debug(`🖼️ [SIMPLIFIED] Decoded base64 image: ${imageData.length} bytes`);
            }
            else {
                throw new Error(`OpenRouter image generation returned no image data. ` +
                    `imageBase64=${result.imageBase64 ? 'present' : 'absent'}, ` +
                    `content length=${result.content?.length ?? 0}`);
            }
            const metadata = {
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
            this.emitLlmObservabilityEvent('agent.llm.completed', params.executionContext, {
                provider: params.provider,
                model: params.model,
                message: 'Image generation completed (simplified)',
                type: 'image-generation',
            });
            return {
                images: [{ data: imageData }],
                metadata,
            };
        }
        catch (error) {
            this.emitLlmObservabilityEvent('agent.llm.failed', params.executionContext, {
                provider: params.provider,
                model: params.model,
                message: 'Image generation failed (simplified)',
                error: error instanceof Error ? error.message : String(error),
                type: 'image-generation',
            });
            throw error;
        }
    }
    async generateVideo(_params) {
        await Promise.resolve();
        throw new Error('Video generation is not supported in simplified LLM mode. ' +
            'Use LLM_PROVIDER=fine_control for video generation capabilities.');
    }
    async pollVideoStatus(_params) {
        await Promise.resolve();
        throw new Error('Video status polling is not supported in simplified LLM mode. ' +
            'Use LLM_PROVIDER=fine_control for video generation capabilities.');
    }
    emitLlmObservabilityEvent(hook_event_type, executionContext, payload) {
        try {
            const event = {
                context: executionContext,
                source_app: 'orchestrator-ai',
                hook_event_type,
                status: hook_event_type,
                message: payload?.message ?? null,
                progress: null,
                step: 'llm',
                payload: payload ?? {},
                timestamp: Date.now(),
            };
            void this.observabilityEventsService.push(event);
        }
        catch (error) {
            this.logger.debug(`Failed to emit LLM observability event: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async recordUsage(params) {
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
        }
        catch (error) {
            this.logger.warn(`Failed to record LLM usage: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    estimateCost(inputTokens, outputTokens) {
        // Simple default: $0.001/1K input, $0.002/1K output
        return (inputTokens / 1000) * 0.001 + (outputTokens / 1000) * 0.002;
    }
};
exports.SimplifiedLLMService = SimplifiedLLMService;
exports.SimplifiedLLMService = SimplifiedLLMService = SimplifiedLLMService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(4, (0, common_1.Inject)(database_1.DATABASE_SERVICE)),
    __metadata("design:paramtypes", [openrouter_client_1.OpenRouterClient,
        ollama_cloud_client_1.OllamaCloudClient,
        model_router_1.ModelRouter,
        observability_1.ObservabilityEventsService, Object])
], SimplifiedLLMService);
