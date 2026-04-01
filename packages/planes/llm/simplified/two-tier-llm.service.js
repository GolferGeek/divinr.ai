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
var TwoTierLLMService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwoTierLLMService = void 0;
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
const common_1 = require("@nestjs/common");
const uuid_1 = require("uuid");
const observability_1 = require("@orchestratorai/planes/observability");
const database_1 = require("../../database");
const llm_client_interface_1 = require("./llm-client.interface");
const openrouter_client_1 = require("./openrouter.client");
const openrouter_adapter_1 = require("./adapters/openrouter.adapter");
let TwoTierLLMService = TwoTierLLMService_1 = class TwoTierLLMService {
    commercialClient;
    opensourceClient;
    openRouterClient;
    observabilityEventsService;
    db;
    logger = new common_1.Logger(TwoTierLLMService_1.name);
    modelsCache = null;
    cacheTtlMs = 5 * 60 * 1000; // 5 minutes
    /**
     * Maps model ID -> tier that owns it.
     * Built during listModels() and used by resolveBackend().
     */
    modelOwnership = new Map();
    /** Lazy-initialized OpenRouter adapter for fallback routing */
    openRouterFallback = null;
    constructor(commercialClient, opensourceClient, openRouterClient, observabilityEventsService, db) {
        this.commercialClient = commercialClient;
        this.opensourceClient = opensourceClient;
        this.openRouterClient = openRouterClient;
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
        this.modelOwnership.clear();
        // Fetch from commercial tier
        try {
            const commercialModels = await this.commercialClient.listModels();
            for (const m of commercialModels) {
                allModels.push({
                    id: m.id,
                    name: m.name,
                    providerName: m.providerName,
                    modelType: m.modelType || 'text-generation',
                    contextWindow: m.contextWindow,
                    maxOutputTokens: m.maxOutputTokens,
                    pricing: m.pricing,
                    isLocal: false,
                });
                this.modelOwnership.set(m.id, 'commercial');
            }
        }
        catch (error) {
            this.logger.warn(`Failed to fetch commercial models: ${error instanceof Error ? error.message : String(error)}`);
        }
        // Fetch from open source tier
        try {
            const opensourceModels = await this.opensourceClient.listModels();
            for (const m of opensourceModels) {
                allModels.push({
                    id: m.id,
                    name: m.name,
                    providerName: m.providerName,
                    modelType: m.modelType || 'text-generation',
                    contextWindow: m.contextWindow,
                    maxOutputTokens: m.maxOutputTokens,
                    pricing: m.pricing,
                    isLocal: true,
                });
                this.modelOwnership.set(m.id, 'opensource');
            }
        }
        catch (error) {
            this.logger.warn(`Failed to fetch opensource models: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.modelsCache = { data: allModels, timestamp: Date.now() };
        return this.applyFilters(allModels, filters);
    }
    /**
     * Derive providers dynamically from the cached model list.
     */
    async listProviders() {
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
        // Sort: local providers first (ollama, lm_studio), then alphabetical
        const localProviders = new Set(['ollama', 'lm_studio']);
        return [...seen.values()].sort((a, b) => {
            const aLocal = localProviders.has(a.name);
            const bLocal = localProviders.has(b.name);
            if (aLocal && !bLocal)
                return -1;
            if (!aLocal && bLocal)
                return 1;
            return a.name.localeCompare(b.name);
        });
    }
    formatProviderName(name) {
        const displayNames = {
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
     * Resolve which tier (client) to use for a given provider + model.
     *
     * Uses the modelOwnership map built during listModels().
     * For OpenRouter models, reconstructs the provider/model API format.
     */
    resolveBackend(provider, model, sovereignMode) {
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
            const isOpenRouter = this.commercialClient instanceof openrouter_client_1.OpenRouterClient;
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
        const isOpenRouter = this.commercialClient instanceof openrouter_client_1.OpenRouterClient;
        if (!isOpenRouter) {
            this.logger.debug(`Model "${model}" not in commercial catalog, falling back to OpenRouter`);
            if (!this.openRouterFallback) {
                this.openRouterFallback = new openrouter_adapter_1.OpenRouterAdapter(this.openRouterClient);
            }
            const apiModel = model.includes('/') ? model : `${provider}/${model}`;
            return { client: this.openRouterFallback, apiModel };
        }
        // Default to commercial (OpenRouter) — reconstruct provider/model format
        const apiModel = model.includes('/') ? model : `${provider}/${model}`;
        return { client: this.commercialClient, apiModel };
    }
    async generateResponse(systemPrompt, userMessage, options) {
        const executionContext = options?.executionContext;
        if (!executionContext) {
            throw new Error('ExecutionContext is required for generateResponse. Pass executionContext in options.');
        }
        const provider = executionContext.provider || options?.provider || 'openai';
        const model = executionContext.model || options?.model || 'gpt-4o';
        // Ensure ownership map is populated
        if (this.modelOwnership.size === 0) {
            await this.listModels();
        }
        const { client, apiModel } = this.resolveBackend(provider, model, executionContext.sovereignMode);
        this.logger.debug(`Two-tier LLM: provider=${provider} model=${model} -> ${client.tier} apiModel=${apiModel}`);
        // Emit started event
        this.emitLlmObservabilityEvent('agent.llm.started', executionContext, {
            provider,
            model,
            tier: client.tier,
            message: 'LLM call started (two-tier)',
        });
        const startTime = Date.now();
        const requestId = (0, uuid_1.v4)();
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
            // Track usage — record the original provider/model the user selected
            await this.recordUsage({
                requestId,
                provider,
                model,
                inputTokens: result.usage.promptTokens,
                outputTokens: result.usage.completionTokens,
                cost: result.cost ??
                    this.estimateCost(result.usage.promptTokens, result.usage.completionTokens),
                duration,
                status: 'completed',
                tier: client.tier,
                executionContext,
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
                const metadata = {
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
                };
                return { content: result.content, metadata };
            }
            return result.content;
        }
        catch (error) {
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
        // Image generation always goes through the commercial tier (OpenRouter)
        const apiModel = params.model.includes('/')
            ? params.model
            : `${params.provider}/${params.model}`;
        const startTime = Date.now();
        const requestId = (0, uuid_1.v4)();
        this.emitLlmObservabilityEvent('agent.llm.started', params.executionContext, {
            provider: params.provider,
            model: params.model,
            message: 'Image generation started (two-tier)',
            type: 'image-generation',
        });
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
            this.logger.debug(`Image result: imageBase64=${result.imageBase64 ? `${result.imageBase64.length} chars` : 'absent'}`);
            let imageData;
            if (result.imageBase64) {
                imageData = Buffer.from(result.imageBase64, 'base64');
            }
            else {
                throw new Error(`Image generation returned no image data. ` +
                    `imageBase64=${result.imageBase64 ? 'present' : 'absent'}`);
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
                message: 'Image generation completed (two-tier)',
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
                message: 'Image generation failed (two-tier)',
                error: error instanceof Error ? error.message : String(error),
                type: 'image-generation',
            });
            throw error;
        }
    }
    async generateVideo(_params) {
        await Promise.resolve();
        throw new Error('Video generation is not supported in two-tier LLM mode. ' +
            'Use LLM_PROVIDER=fine_control for video generation capabilities.');
    }
    async pollVideoStatus(_params) {
        await Promise.resolve();
        throw new Error('Video status polling is not supported in two-tier LLM mode. ' +
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
                tier: params.tier === 'opensource' ? 'local' : 'external',
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
        return (inputTokens / 1000) * 0.001 + (outputTokens / 1000) * 0.002;
    }
};
exports.TwoTierLLMService = TwoTierLLMService;
exports.TwoTierLLMService = TwoTierLLMService = TwoTierLLMService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(llm_client_interface_1.COMMERCIAL_CLIENT)),
    __param(1, (0, common_1.Inject)(llm_client_interface_1.OPENSOURCE_CLIENT)),
    __param(4, (0, common_1.Inject)(database_1.DATABASE_SERVICE)),
    __metadata("design:paramtypes", [Object, Object, openrouter_client_1.OpenRouterClient,
        observability_1.ObservabilityEventsService, Object])
], TwoTierLLMService);
