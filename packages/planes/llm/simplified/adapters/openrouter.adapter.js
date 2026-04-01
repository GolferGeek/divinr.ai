"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenRouterAdapter = void 0;
class OpenRouterAdapter {
    client;
    tier = 'commercial';
    constructor(client) {
        this.client = client;
    }
    async listModels() {
        const orModels = await this.client.listModels();
        return orModels.map((m) => {
            const modalities = m.architecture?.output_modalities ?? [];
            let modelType = 'text-generation';
            if (modalities.includes('image'))
                modelType = 'image-generation';
            const slashIdx = m.id.indexOf('/');
            const realProvider = slashIdx > 0 ? m.id.substring(0, slashIdx) : 'openrouter';
            const modelName = slashIdx > 0 ? m.id.substring(slashIdx + 1) : m.id;
            return {
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
            };
        });
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
            cost: result.cost,
            requestId: result.requestId,
        };
    }
}
exports.OpenRouterAdapter = OpenRouterAdapter;
