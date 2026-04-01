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
var AzureFoundryLLMService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureFoundryLLMService = void 0;
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
const common_1 = require("@nestjs/common");
const uuid_1 = require("uuid");
const observability_1 = require("@orchestratorai/planes/observability");
const database_1 = require("../../database");
let AzureFoundryLLMService = AzureFoundryLLMService_1 = class AzureFoundryLLMService {
    observabilityEventsService;
    db;
    logger = new common_1.Logger(AzureFoundryLLMService_1.name);
    client = null;
    modelsCache = null;
    cacheTtlMs = 5 * 60 * 1000; // 5 minutes
    constructor(observabilityEventsService, db) {
        this.observabilityEventsService = observabilityEventsService;
        this.db = db;
    }
    async listModels(filters) {
        if (filters?.sovereignMode) {
            return []; // Azure Foundry has no local models
        }
        if (this.modelsCache &&
            Date.now() - this.modelsCache.timestamp < this.cacheTtlMs) {
            return filters?.modelType
                ? this.modelsCache.data.filter((m) => m.modelType === filters.modelType)
                : this.modelsCache.data;
        }
        const endpoint = process.env.AZURE_AI_FOUNDRY_ENDPOINT;
        const key = process.env.AZURE_AI_FOUNDRY_KEY;
        if (!endpoint || !key) {
            this.logger.warn('Azure AI Foundry credentials not configured, returning empty model list');
            return [];
        }
        const allModels = [];
        let url = `${endpoint}/deployments?api-version=2024-04-01-preview`;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const axios = require('axios');
        while (url) {
            const response = await axios.get(url, {
                headers: { 'api-key': key },
                timeout: 15_000,
            });
            const body = response.data;
            for (const deployment of body.value ?? []) {
                // Use the publisher as providerName (e.g. "openai", "meta", "mistralai")
                // Falls back to "azure_foundry" if no publisher metadata
                const publisher = deployment.properties?.model?.publisher?.toLowerCase() ??
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
        return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    formatProviderName(name) {
        const displayNames = {
            azure_foundry: 'Azure AI Foundry',
            openai: 'OpenAI',
            meta: 'Meta',
            mistralai: 'Mistral AI',
            google: 'Google',
            cohere: 'Cohere',
            microsoft: 'Microsoft',
        };
        return (displayNames[name] ??
            name
                .split(/[-_]/)
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' '));
    }
    getClient() {
        if (this.client) {
            return this.client;
        }
        const endpoint = process.env.AZURE_AI_FOUNDRY_ENDPOINT;
        const key = process.env.AZURE_AI_FOUNDRY_KEY;
        if (!endpoint) {
            throw new Error('AZURE_AI_FOUNDRY_ENDPOINT is required for azure_foundry LLM provider.');
        }
        if (!key) {
            throw new Error('AZURE_AI_FOUNDRY_KEY is required for azure_foundry LLM provider.');
        }
        // Require the Azure REST SDK at call time
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { default: ModelClient, isUnexpected } = require('@azure-rest/ai-inference');
        const { AzureKeyCredential } = require('@azure/core-auth');
        /* eslint-enable @typescript-eslint/no-require-imports */
        this.client = ModelClient(endpoint, new AzureKeyCredential(key));
        // Store isUnexpected helper on client for later use
        this.client._isUnexpected = isUnexpected;
        return this.client;
    }
    async generateResponse(systemPrompt, userMessage, options) {
        const executionContext = options?.executionContext;
        if (!executionContext) {
            throw new Error('ExecutionContext is required for generateResponse. Pass executionContext in options.');
        }
        const provider = executionContext.provider || options?.provider || 'azure_foundry';
        const model = executionContext.model || options?.model || 'gpt-4o';
        this.logger.debug(`Azure Foundry LLM: provider=${provider} model=${model}`);
        this.emitLlmObservabilityEvent('agent.llm.started', executionContext, {
            provider,
            model,
            message: 'LLM call started (azure_foundry)',
        });
        const startTime = Date.now();
        const requestId = (0, uuid_1.v4)();
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
            const errorBody = response.body;
            const message = errorBody?.error?.message || 'Unknown Azure AI Foundry error';
            this.emitLlmObservabilityEvent('agent.llm.failed', executionContext, {
                provider,
                model,
                message: `LLM call failed (azure_foundry): ${message}`,
            });
            throw new Error(`Azure AI Foundry error: ${message}`);
        }
        const body = response.body;
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
            const metadata = {
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
            return { content, metadata };
        }
        return content;
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
    generateImage(_params) {
        return Promise.reject(new Error('Image generation is not supported via Azure AI Foundry. ' +
            'Use LLM_PROVIDER=fine_control for image generation capabilities.'));
    }
    generateVideo(_params) {
        return Promise.reject(new Error('Video generation is not supported via Azure AI Foundry. ' +
            'Use LLM_PROVIDER=fine_control for video generation capabilities.'));
    }
    pollVideoStatus(_params) {
        return Promise.reject(new Error('Video status polling is not supported via Azure AI Foundry. ' +
            'Use LLM_PROVIDER=fine_control for video generation capabilities.'));
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
        }
        catch (error) {
            this.logger.warn(`Failed to record LLM usage: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    estimateCost(inputTokens, outputTokens) {
        // Default estimate: $0.002/1K input, $0.008/1K output (GPT-4 class)
        return (inputTokens / 1000) * 0.002 + (outputTokens / 1000) * 0.008;
    }
};
exports.AzureFoundryLLMService = AzureFoundryLLMService;
exports.AzureFoundryLLMService = AzureFoundryLLMService = AzureFoundryLLMService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(database_1.DATABASE_SERVICE)),
    __metadata("design:paramtypes", [observability_1.ObservabilityEventsService, Object])
], AzureFoundryLLMService);
