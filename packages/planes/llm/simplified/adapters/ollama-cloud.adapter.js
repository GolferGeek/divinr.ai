"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaCloudAdapter = void 0;
class OllamaCloudAdapter {
    client;
    tier = 'opensource';
    constructor(client) {
        this.client = client;
    }
    async listModels() {
        const models = await this.client.listModels();
        return models.map((m) => ({
            id: m.id,
            name: m.name,
            providerName: 'ollama',
            modelType: 'text-generation',
            isLocal: true,
        }));
    }
    async chatCompletion(params) {
        const result = await this.client.chatCompletion({
            model: params.model,
            messages: params.messages,
            temperature: params.temperature,
            max_tokens: params.max_tokens,
            top_p: params.top_p,
        });
        return {
            content: result.content,
            model: result.model,
            usage: result.usage,
            cost: null,
            requestId: result.requestId,
        };
    }
}
exports.OllamaCloudAdapter = OllamaCloudAdapter;
