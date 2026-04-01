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
var OllamaCloudClient_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaCloudClient = void 0;
/**
 * Ollama Cloud Client
 *
 * OpenAI-compatible HTTP client targeting Ollama Cloud API.
 * Supports text generation via chat completions endpoint.
 * Handles auth and token counting.
 */
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const rxjs_1 = require("rxjs");
let OllamaCloudClient = OllamaCloudClient_1 = class OllamaCloudClient {
    httpService;
    logger = new common_1.Logger(OllamaCloudClient_1.name);
    constructor(httpService) {
        this.httpService = httpService;
    }
    getBaseUrl() {
        return process.env.OLLAMA_CLOUD_BASE_URL || 'https://api.ollama.com/v1';
    }
    /**
     * Resolve the OpenAI-compatible base URL (ensuring /v1 suffix).
     *
     * Users may set OLLAMA_CLOUD_BASE_URL to "https://ollama.com" (no /v1).
     * The chat/completions endpoint lives at /v1/chat/completions, so we
     * must ensure the base URL ends with /v1.
     */
    getV1Url() {
        const raw = this.getBaseUrl().replace(/\/+$/, '');
        return raw.endsWith('/v1') ? raw : `${raw}/v1`;
    }
    getApiKey() {
        return process.env.OLLAMA_CLOUD_API_KEY;
    }
    async listModels() {
        const apiKey = this.getApiKey();
        const headers = {
            'Content-Type': 'application/json',
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        this.logger.debug('Fetching Ollama model catalog');
        // Try OpenAI-compat endpoint first (/v1/models), fall back to native (/api/tags)
        try {
            const v1Url = this.getV1Url();
            const response = await (0, rxjs_1.firstValueFrom)(this.httpService.get(`${v1Url}/models`, { headers, timeout: 10_000 }));
            return (response.data?.data ?? []).map((m) => ({
                id: m.id,
                name: m.id,
                isLocal: true,
            }));
        }
        catch {
            this.logger.debug('OpenAI-compat /v1/models failed, trying /api/tags');
        }
        // Native Ollama endpoint
        const nativeBase = this.getBaseUrl()
            .replace(/\/+$/, '')
            .replace(/\/v1\/?$/, '');
        const response = await (0, rxjs_1.firstValueFrom)(this.httpService.get(`${nativeBase}/api/tags`, { headers, timeout: 10_000 }));
        return (response.data?.models ?? []).map((m) => ({
            id: m.name,
            name: m.name,
            isLocal: true,
        }));
    }
    async chatCompletion(params) {
        const apiKey = this.getApiKey();
        const requestBody = {
            model: params.model,
            messages: params.messages,
            temperature: params.temperature ?? 0.7,
            max_tokens: params.max_tokens,
            top_p: params.top_p,
        };
        this.logger.debug(`Ollama Cloud request: model=${params.model}, messages=${params.messages.length}`);
        const headers = {
            'Content-Type': 'application/json',
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        const v1Url = this.getV1Url();
        const response = await (0, rxjs_1.firstValueFrom)(this.httpService.post(`${v1Url}/chat/completions`, requestBody, {
            headers,
            timeout: 120_000,
        }));
        const data = response.data;
        if (!data.choices?.length) {
            throw new Error(`Ollama Cloud returned no choices for model ${params.model}`);
        }
        const msg = data.choices[0].message;
        // Reasoning models (e.g. qwen3-next) may return content="" with reasoning in a separate field
        const content = msg.content || msg.reasoning || '';
        return {
            content,
            model: data.model,
            usage: {
                promptTokens: data.usage?.prompt_tokens ?? 0,
                completionTokens: data.usage?.completion_tokens ?? 0,
                totalTokens: data.usage?.total_tokens ?? 0,
            },
            requestId: data.id ?? '',
        };
    }
};
exports.OllamaCloudClient = OllamaCloudClient;
exports.OllamaCloudClient = OllamaCloudClient = OllamaCloudClient_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [axios_1.HttpService])
], OllamaCloudClient);
