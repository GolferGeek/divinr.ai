"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaLocalAdapter = void 0;
const rxjs_1 = require("rxjs");
class OllamaLocalAdapter {
    httpService;
    tier = 'opensource';
    constructor(httpService) {
        this.httpService = httpService;
    }
    getBaseUrl() {
        return (process.env.OLLAMA_LOCAL_URL?.replace(/\/+$/, '') ||
            'http://localhost:11434');
    }
    async listModels() {
        const baseUrl = this.getBaseUrl();
        // Try OpenAI-compat /v1/models first
        try {
            const response = await (0, rxjs_1.firstValueFrom)(this.httpService.get(`${baseUrl}/v1/models`, { timeout: 5_000 }));
            return (response.data?.data ?? []).map((m) => ({
                id: m.id,
                name: m.id,
                providerName: 'ollama',
                modelType: 'text-generation',
                isLocal: true,
            }));
        }
        catch {
            // Fall through to native endpoint
        }
        // Native Ollama /api/tags
        try {
            const response = await (0, rxjs_1.firstValueFrom)(this.httpService.get(`${baseUrl}/api/tags`, { timeout: 5_000 }));
            return (response.data?.models ?? []).map((m) => ({
                id: m.name,
                name: m.name,
                providerName: 'ollama',
                modelType: 'text-generation',
                isLocal: true,
            }));
        }
        catch {
            // Local Ollama not running — return empty list
            return [];
        }
    }
    async chatCompletion(params) {
        const baseUrl = this.getBaseUrl();
        const response = await (0, rxjs_1.firstValueFrom)(this.httpService.post(`${baseUrl}/v1/chat/completions`, {
            model: params.model,
            messages: params.messages,
            temperature: params.temperature ?? 0.7,
            max_tokens: params.max_tokens,
            top_p: params.top_p,
        }, { timeout: 120_000 }));
        const data = response.data;
        if (!data.choices?.length) {
            throw new Error(`Local Ollama returned no choices for model ${params.model}`);
        }
        const msg = data.choices[0].message;
        const content = msg.content || msg.reasoning || '';
        return {
            content,
            model: data.model,
            usage: {
                promptTokens: data.usage?.prompt_tokens ?? 0,
                completionTokens: data.usage?.completion_tokens ?? 0,
                totalTokens: data.usage?.total_tokens ?? 0,
            },
            cost: null,
            requestId: data.id ?? '',
        };
    }
}
exports.OllamaLocalAdapter = OllamaLocalAdapter;
