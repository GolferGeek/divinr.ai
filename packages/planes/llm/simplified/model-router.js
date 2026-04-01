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
var ModelRouter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelRouter = void 0;
/**
 * Model Router
 *
 * Config-driven routing that maps model names to either OpenRouter or Ollama Cloud.
 *
 * Default routing:
 *   - Commercial models (gpt-*, claude-*, gemini-*, grok-*) -> OpenRouter
 *   - Open-source models (llama-*, mistral-*, qwen-*, phi-*, deepseek-*) -> Ollama Cloud
 *
 * Sovereign mode: all models -> Ollama Cloud (no external API calls)
 *
 * Override via SIMPLIFIED_LLM_ROUTING env var (JSON):
 *   e.g. {"llama-3.3-70b": "openrouter", "gpt-4o": "ollama_cloud"}
 */
const common_1 = require("@nestjs/common");
const OPENROUTER_PREFIXES = ['gpt-', 'o1', 'o3', 'claude-', 'gemini-', 'grok-'];
const OLLAMA_CLOUD_PREFIXES = [
    'llama',
    'mistral',
    'qwen',
    'phi-',
    'deepseek',
    'codellama',
    'vicuna',
    'mixtral',
    'falcon',
    'yi-',
    'command-r',
];
let ModelRouter = ModelRouter_1 = class ModelRouter {
    logger = new common_1.Logger(ModelRouter_1.name);
    overrides = {};
    constructor() {
        this.loadOverrides();
    }
    loadOverrides() {
        const envOverrides = process.env.SIMPLIFIED_LLM_ROUTING;
        if (envOverrides) {
            try {
                this.overrides = JSON.parse(envOverrides);
                this.logger.log(`Loaded ${Object.keys(this.overrides).length} routing overrides`);
            }
            catch {
                this.logger.warn('Failed to parse SIMPLIFIED_LLM_ROUTING env var — ignoring overrides');
            }
        }
    }
    route(model, sovereignMode) {
        const modelLower = model.toLowerCase();
        // Sovereign mode forces all traffic through Ollama Cloud (local/self-hosted)
        if (sovereignMode) {
            return {
                target: 'ollama_cloud',
                model,
                reason: 'sovereign_mode',
            };
        }
        // Check explicit overrides first
        if (this.overrides[model]) {
            return {
                target: this.overrides[model],
                model,
                reason: 'explicit_override',
            };
        }
        if (this.overrides[modelLower]) {
            return {
                target: this.overrides[modelLower],
                model,
                reason: 'explicit_override',
            };
        }
        // Route by prefix
        for (const prefix of OLLAMA_CLOUD_PREFIXES) {
            if (modelLower.startsWith(prefix)) {
                return {
                    target: 'ollama_cloud',
                    model,
                    reason: `prefix_match:${prefix}`,
                };
            }
        }
        for (const prefix of OPENROUTER_PREFIXES) {
            if (modelLower.startsWith(prefix)) {
                return {
                    target: 'openrouter',
                    model,
                    reason: `prefix_match:${prefix}`,
                };
            }
        }
        // Default: OpenRouter (has the broadest model catalog)
        return {
            target: 'openrouter',
            model,
            reason: 'default',
        };
    }
};
exports.ModelRouter = ModelRouter;
exports.ModelRouter = ModelRouter = ModelRouter_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], ModelRouter);
