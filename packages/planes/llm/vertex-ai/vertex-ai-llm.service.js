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
var VertexAILLMService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VertexAILLMService = void 0;
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
const common_1 = require("@nestjs/common");
const uuid_1 = require("uuid");
const observability_1 = require("@orchestratorai/planes/observability");
const database_1 = require("../../database");
let VertexAILLMService = VertexAILLMService_1 = class VertexAILLMService {
    observabilityEventsService;
    db;
    logger = new common_1.Logger(VertexAILLMService_1.name);
    vertexAI = null;
    modelsCache = null;
    cacheTtlMs = 5 * 60 * 1000; // 5 minutes
    constructor(observabilityEventsService, db) {
        this.observabilityEventsService = observabilityEventsService;
        this.db = db;
    }
    async listModels(filters) {
        if (filters?.sovereignMode) {
            return []; // Vertex AI has no local models
        }
        if (this.modelsCache &&
            Date.now() - this.modelsCache.timestamp < this.cacheTtlMs) {
            return filters?.modelType
                ? this.modelsCache.data.filter((m) => m.modelType === filters.modelType)
                : this.modelsCache.data;
        }
        const project = process.env.GCP_PROJECT_ID;
        if (!project) {
            this.logger.warn('GCP_PROJECT_ID not configured, returning empty model list');
            return [];
        }
        const location = process.env.GCP_REGION || 'us-central1';
        const allModels = [];
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GoogleAuth } = require('google-auth-library');
        const auth = new GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        });
        const client = await auth.getClient();
        // The Model Garden list endpoint is v1beta1 (not v1).
        // We filter to Gemini (text) and Imagen (image) model families.
        const geminiAndImagenPrefixes = ['gemini-', 'imagen-', 'veo-', 'gemma-'];
        let pageToken = null;
        const baseUrl = `https://${location}-aiplatform.googleapis.com/v1beta1/publishers/google/models`;
        do {
            const url = pageToken
                ? `${baseUrl}?pageSize=100&pageToken=${pageToken}`
                : `${baseUrl}?pageSize=100`;
            const rawResponse = await client.request({ url, timeout: 15_000 });
            const body = rawResponse.data;
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
            google: 'Google',
            anthropic: 'Anthropic',
            meta: 'Meta',
            mistralai: 'Mistral AI',
        };
        return (displayNames[name] ??
            name
                .split(/[-_]/)
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' '));
    }
    getVertexAI() {
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
        const { VertexAI } = require('@google-cloud/vertexai');
        this.vertexAI = new VertexAI({ project, location });
        return this.vertexAI;
    }
    async generateResponse(systemPrompt, userMessage, options) {
        const executionContext = options?.executionContext;
        if (!executionContext) {
            throw new Error('ExecutionContext is required for generateResponse. Pass executionContext in options.');
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
        const requestId = (0, uuid_1.v4)();
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
        const usageMetadata = result?.usageMetadata;
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
            return { content: String(content), metadata };
        }
        return String(content);
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
        const startTime = Date.now();
        const requestId = (0, uuid_1.v4)();
        this.emitLlmObservabilityEvent('agent.llm.started', params.executionContext, {
            provider: params.provider,
            model: params.model,
            message: 'Image generation started (vertex_ai)',
            type: 'image-generation',
        });
        const vertexAI = this.getVertexAI();
        const imagenModel = vertexAI.preview.getImageGenerationModel('imagen-3.0-generate-001');
        const imageCount = params.numberOfImages ?? 1;
        // Map size to aspectRatio
        const aspectRatio = this.sizeToAspectRatio(params.size);
        const imageResponse = await imagenModel.generateImages({
            prompt: params.prompt,
            numberOfImages: imageCount,
            aspectRatio: aspectRatio,
        });
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
        const metadata = {
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
        this.emitLlmObservabilityEvent('agent.llm.completed', params.executionContext, {
            provider: params.provider,
            model: params.model,
            message: 'Image generation completed (vertex_ai)',
            type: 'image-generation',
        });
        // Map Imagen response images to ImageGenerationResponse format
        const images = (imageResponse.images ?? []).map((img) => ({
            data: img.imageBytes
                ? Buffer.isBuffer(img.imageBytes)
                    ? img.imageBytes
                    : Buffer.from(img.imageBytes, 'base64')
                : Buffer.alloc(0),
        }));
        return { images, metadata };
    }
    generateVideo(_params) {
        return Promise.reject(new Error('Video generation is not supported via Vertex AI in this plane. ' +
            'Use LLM_PROVIDER=fine_control for video generation capabilities.'));
    }
    pollVideoStatus(_params) {
        return Promise.reject(new Error('Video status polling is not supported via Vertex AI in this plane. ' +
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
        // Gemini 1.5 Pro pricing estimate: $0.00125/1K input, $0.005/1K output
        return (inputTokens / 1000) * 0.00125 + (outputTokens / 1000) * 0.005;
    }
    sizeToAspectRatio(size) {
        switch (size) {
            case '1792x1024':
                return '16:9';
            case '1024x1792':
                return '9:16';
            default:
                return '1:1';
        }
    }
};
exports.VertexAILLMService = VertexAILLMService;
exports.VertexAILLMService = VertexAILLMService = VertexAILLMService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(database_1.DATABASE_SERVICE)),
    __metadata("design:paramtypes", [observability_1.ObservabilityEventsService, Object])
], VertexAILLMService);
