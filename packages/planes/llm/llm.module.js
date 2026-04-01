"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMPlaneModule = void 0;
/**
 * LLM Plane Module
 *
 * @Global() module providing LLM_SERVICE — the 7th provider plane.
 *
 * Selected by LLM_PROVIDER env var:
 *   - fine_control (default): Full provider routing via LLMService
 *   - simplified: Two-tier routing via configurable commercial + opensource backends
 *   - azure_foundry: Azure AI Foundry (MaaS) via @azure-rest/ai-inference
 *   - vertex_ai: Google Vertex AI (Gemini + Imagen) via @google-cloud/vertexai
 *
 * When LLM_PROVIDER=simplified, two additional env vars configure the backends:
 *   - COMMERCIAL_LLM_PROVIDER: openrouter (default) | azure_foundry | vertex_ai | none
 *   - OPENSOURCE_LLM_PROVIDER: ollama_cloud (default) | ollama_local | lm_studio | none
 *
 * The fine_control LLMModule (./fine-control/llm.module.ts) provides
 * all the internal services (generation, image, video, PII, etc.).
 */
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const llm_interface_1 = require("./llm.interface");
const simplified_llm_service_1 = require("./simplified/simplified-llm.service");
const openrouter_client_1 = require("./simplified/openrouter.client");
const ollama_cloud_client_1 = require("./simplified/ollama-cloud.client");
const model_router_1 = require("./simplified/model-router");
const two_tier_llm_service_1 = require("./simplified/two-tier-llm.service");
const llm_client_interface_1 = require("./simplified/llm-client.interface");
const openrouter_adapter_1 = require("./simplified/adapters/openrouter.adapter");
const ollama_cloud_adapter_1 = require("./simplified/adapters/ollama-cloud.adapter");
const ollama_local_adapter_1 = require("./simplified/adapters/ollama-local.adapter");
const lm_studio_adapter_1 = require("./simplified/adapters/lm-studio.adapter");
const azure_foundry_adapter_1 = require("./simplified/adapters/azure-foundry.adapter");
const vertex_ai_adapter_1 = require("./simplified/adapters/vertex-ai.adapter");
const null_adapter_1 = require("./simplified/adapters/null.adapter");
const azure_foundry_llm_service_1 = require("./azure-foundry/azure-foundry-llm.service");
const vertex_ai_llm_service_1 = require("./vertex-ai/vertex-ai-llm.service");
const observability_1 = require("@orchestratorai/planes/observability");
const logger = new common_1.Logger('LLMPlaneModule');
let LLMPlaneModule = class LLMPlaneModule {
};
exports.LLMPlaneModule = LLMPlaneModule;
exports.LLMPlaneModule = LLMPlaneModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [axios_1.HttpModule, observability_1.ObservabilityPlaneModule],
        providers: [
            // Simplified provider components (always registered, only used when selected)
            openrouter_client_1.OpenRouterClient,
            ollama_cloud_client_1.OllamaCloudClient,
            model_router_1.ModelRouter,
            simplified_llm_service_1.SimplifiedLLMService,
            two_tier_llm_service_1.TwoTierLLMService,
            // Cloud provider services (always registered, only used when selected)
            azure_foundry_llm_service_1.AzureFoundryLLMService,
            vertex_ai_llm_service_1.VertexAILLMService,
            // Two-tier client factories: commercial + opensource backends
            {
                provide: llm_client_interface_1.COMMERCIAL_CLIENT,
                useFactory: (openRouterClient, azureFoundryService, vertexAIService) => {
                    const provider = process.env.COMMERCIAL_LLM_PROVIDER || 'openrouter';
                    logger.log(`Commercial LLM provider: ${provider}`);
                    switch (provider) {
                        case 'openrouter':
                            return new openrouter_adapter_1.OpenRouterAdapter(openRouterClient);
                        case 'azure_foundry':
                            return new azure_foundry_adapter_1.AzureFoundryAdapter(azureFoundryService);
                        case 'vertex_ai':
                            return new vertex_ai_adapter_1.VertexAIAdapter(vertexAIService);
                        case 'none':
                            return new null_adapter_1.NullAdapter('commercial');
                        default:
                            throw new Error(`Unsupported COMMERCIAL_LLM_PROVIDER '${provider}'. ` +
                                `Expected: openrouter, azure_foundry, vertex_ai, none`);
                    }
                },
                inject: [openrouter_client_1.OpenRouterClient, azure_foundry_llm_service_1.AzureFoundryLLMService, vertex_ai_llm_service_1.VertexAILLMService],
            },
            {
                provide: llm_client_interface_1.OPENSOURCE_CLIENT,
                useFactory: (ollamaCloudClient, httpService) => {
                    const provider = process.env.OPENSOURCE_LLM_PROVIDER || 'ollama_cloud';
                    logger.log(`Open source LLM provider: ${provider}`);
                    switch (provider) {
                        case 'ollama_cloud':
                            return new ollama_cloud_adapter_1.OllamaCloudAdapter(ollamaCloudClient);
                        case 'ollama_local':
                            return new ollama_local_adapter_1.OllamaLocalAdapter(httpService);
                        case 'lm_studio':
                            return new lm_studio_adapter_1.LMStudioAdapter(httpService);
                        case 'none':
                            return new null_adapter_1.NullAdapter('opensource');
                        default:
                            throw new Error(`Unsupported OPENSOURCE_LLM_PROVIDER '${provider}'. ` +
                                `Expected: ollama_cloud, ollama_local, lm_studio, none`);
                    }
                },
                inject: [ollama_cloud_client_1.OllamaCloudClient, axios_1.HttpService],
            },
            // Factory: select LLM_SERVICE implementation based on LLM_PROVIDER env var
            {
                provide: llm_interface_1.LLM_SERVICE,
                useFactory: (twoTierService, azureFoundryService, vertexAIService) => {
                    const provider = process.env.LLM_PROVIDER || 'simplified';
                    logger.log(`LLM plane provider: ${provider}`);
                    switch (provider) {
                        case 'simplified':
                            return twoTierService;
                        case 'azure_foundry':
                            return azureFoundryService;
                        case 'vertex_ai':
                            return vertexAIService;
                        default:
                            throw new Error(`Unsupported LLM_PROVIDER '${provider}'. Expected: simplified, azure_foundry, vertex_ai`);
                    }
                },
                inject: [
                    two_tier_llm_service_1.TwoTierLLMService,
                    azure_foundry_llm_service_1.AzureFoundryLLMService,
                    vertex_ai_llm_service_1.VertexAILLMService,
                ],
            },
        ],
        exports: [llm_interface_1.LLM_SERVICE],
    })
], LLMPlaneModule);
