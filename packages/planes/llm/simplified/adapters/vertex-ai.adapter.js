"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VertexAIAdapter = void 0;
class VertexAIAdapter {
    service;
    tier = 'commercial';
    constructor(service) {
        this.service = service;
    }
    async listModels() {
        const models = await this.service.listModels();
        return models.map((m) => ({
            id: m.id,
            name: m.name,
            providerName: m.providerName,
            modelType: m.modelType,
            contextWindow: m.contextWindow,
            maxOutputTokens: m.maxOutputTokens,
            pricing: m.pricing,
            isLocal: false,
        }));
    }
    async chatCompletion(params) {
        const result = await this.service.generateResponse(params.messages.find((m) => m.role === 'system')?.content ?? '', params.messages.find((m) => m.role === 'user')?.content ?? '', {
            temperature: params.temperature,
            max_tokens: params.max_tokens,
            executionContext: {
                orgSlug: 'system',
                userId: '00000000-0000-0000-0000-000000000000',
                conversationId: '00000000-0000-0000-0000-000000000000',
                agentSlug: 'system',
                agentType: 'system',
                provider: 'vertex_ai',
                model: params.model,
            },
        });
        const content = typeof result === 'string' ? result : result.content;
        return {
            content,
            model: params.model,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            cost: null,
            requestId: '',
        };
    }
}
exports.VertexAIAdapter = VertexAIAdapter;
