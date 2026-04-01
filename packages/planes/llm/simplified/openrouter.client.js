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
var OpenRouterClient_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenRouterClient = void 0;
/**
 * OpenRouter Client
 *
 * OpenAI-compatible HTTP client targeting openrouter.ai/api/v1/chat/completions.
 * Supports text generation and image generation (via modalities: ['image']).
 * Parses x-openrouter-cost response header for cost tracking.
 */
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const rxjs_1 = require("rxjs");
let OpenRouterClient = OpenRouterClient_1 = class OpenRouterClient {
    httpService;
    logger = new common_1.Logger(OpenRouterClient_1.name);
    baseUrl = 'https://openrouter.ai/api/v1';
    constructor(httpService) {
        this.httpService = httpService;
    }
    getApiKey() {
        const key = process.env.OPENROUTER_API_KEY;
        if (!key) {
            throw new Error('OPENROUTER_API_KEY is not set. Required for LLM_PROVIDER=simplified with OpenRouter.');
        }
        return key;
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
        this.logger.debug(`OpenRouter request: model=${params.model}, messages=${params.messages.length}`);
        const response = await (0, rxjs_1.firstValueFrom)(this.httpService.post(`${this.baseUrl}/chat/completions`, requestBody, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://orchestratorai.io',
                'X-Title': process.env.OPENROUTER_SITE_NAME || 'Orchestrator AI',
            },
            timeout: 120_000,
        }));
        const data = response.data;
        const costHeader = response.headers['x-openrouter-cost'];
        const cost = costHeader ? parseFloat(String(costHeader)) : null;
        if (!data.choices?.length) {
            throw new Error(`OpenRouter returned no choices for model ${params.model}`);
        }
        return {
            content: data.choices[0].message.content ?? '',
            model: data.model ?? params.model,
            usage: {
                promptTokens: data.usage?.prompt_tokens ?? 0,
                completionTokens: data.usage?.completion_tokens ?? 0,
                totalTokens: data.usage?.total_tokens ?? 0,
            },
            cost,
            requestId: data.id ?? '',
        };
    }
    async listModels() {
        this.logger.debug('Fetching OpenRouter model catalog');
        const response = await (0, rxjs_1.firstValueFrom)(this.httpService.get(`${this.baseUrl}/models`, { timeout: 30_000 }));
        return response.data?.data ?? [];
    }
    /**
     * Generate an image via OpenRouter's chat/completions with modalities: ['image'].
     *
     * OpenRouter returns images as base64 data-URLs in:
     *   choices[0].message.images[].image_url.url  → "data:image/png;base64,..."
     *
     * We extract the first image's base64 data and return it alongside
     * any text content the model produced.
     */
    async imageGeneration(params) {
        const apiKey = this.getApiKey();
        const requestBody = {
            model: params.model,
            messages: [{ role: 'user', content: params.prompt }],
            modalities: ['image'],
            ...(params.size && { image_size: params.size }),
        };
        this.logger.debug(`OpenRouter image request: model=${params.model}`);
        const response = await (0, rxjs_1.firstValueFrom)(this.httpService.post(`${this.baseUrl}/chat/completions`, requestBody, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://orchestratorai.io',
                'X-Title': process.env.OPENROUTER_SITE_NAME || 'Orchestrator AI',
            },
            timeout: 120_000,
        }));
        // OpenRouter image response shape — images live inside message.images[]
        const data = response.data;
        const message = data.choices?.[0]?.message;
        this.logger.debug(`🖼️ [OPENROUTER] Image response: keys=${Object.keys(data).join(',')}, ` +
            `images=${message?.images?.length ?? 0}, ` +
            `content type=${typeof message?.content}, ` +
            `content length=${typeof message?.content === 'string' ? message.content.length : 'N/A'}`);
        const costHeader = response.headers['x-openrouter-cost'];
        const cost = costHeader ? parseFloat(String(costHeader)) : null;
        // Extract base64 image data from the first image in message.images[]
        let imageBase64;
        const firstImage = message?.images?.[0];
        if (firstImage?.image_url?.url) {
            const dataUrl = firstImage.image_url.url;
            // Strip "data:image/png;base64," prefix to get raw base64
            const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
            if (base64Match) {
                imageBase64 = base64Match[1];
            }
            else if (dataUrl.startsWith('http')) {
                // Some models might return a URL instead of base64
                imageBase64 = undefined; // Will be handled as URL in caller
                this.logger.debug(`🖼️ [OPENROUTER] Image returned as URL, not base64`);
            }
        }
        // Text content (may be empty for image-only models)
        const textContent = typeof message?.content === 'string' ? message.content : '';
        return {
            content: textContent,
            model: data.model ?? params.model,
            usage: {
                promptTokens: data.usage?.prompt_tokens ?? 0,
                completionTokens: data.usage?.completion_tokens ?? 0,
                totalTokens: data.usage?.total_tokens ?? 0,
            },
            cost,
            requestId: data.id ?? '',
            imageBase64,
        };
    }
};
exports.OpenRouterClient = OpenRouterClient;
exports.OpenRouterClient = OpenRouterClient = OpenRouterClient_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [axios_1.HttpService])
], OpenRouterClient);
