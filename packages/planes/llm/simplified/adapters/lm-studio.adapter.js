"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LMStudioAdapter = void 0;
const rxjs_1 = require("rxjs");
class LMStudioAdapter {
    httpService;
    tier = 'opensource';
    constructor(httpService) {
        this.httpService = httpService;
    }
    getBaseUrl() {
        return (process.env.LM_STUDIO_URL?.replace(/\/+$/, '') || 'http://localhost:1234');
    }
    async listModels() {
        const baseUrl = this.getBaseUrl();
        try {
            const response = await (0, rxjs_1.firstValueFrom)(this.httpService.get(`${baseUrl}/v1/models`, { timeout: 5_000 }));
            return (response.data?.data ?? []).map((m) => ({
                id: m.id,
                name: m.id,
                providerName: 'lm_studio',
                modelType: 'text-generation',
                isLocal: true,
            }));
        }
        catch {
            // LM Studio not running — return empty list
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
            throw new Error(`LM Studio returned no choices for model ${params.model}`);
        }
        return {
            content: data.choices[0].message.content ?? '',
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
exports.LMStudioAdapter = LMStudioAdapter;
