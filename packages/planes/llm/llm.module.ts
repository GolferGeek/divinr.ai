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
import { Module, Global, Logger } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { LLM_SERVICE } from './llm.interface';
import { SimplifiedLLMService } from './simplified/simplified-llm.service';
import { OpenRouterClient } from './simplified/openrouter.client';
import { OllamaCloudClient } from './simplified/ollama-cloud.client';
import { ModelRouter } from './simplified/model-router';
import { TwoTierLLMService } from './simplified/two-tier-llm.service';
import {
  COMMERCIAL_CLIENT,
  OPENSOURCE_CLIENT,
} from './simplified/llm-client.interface';
import { OpenRouterAdapter } from './simplified/adapters/openrouter.adapter';
import { OllamaCloudAdapter } from './simplified/adapters/ollama-cloud.adapter';
import { OllamaLocalAdapter } from './simplified/adapters/ollama-local.adapter';
import { LMStudioAdapter } from './simplified/adapters/lm-studio.adapter';
import { AzureFoundryAdapter } from './simplified/adapters/azure-foundry.adapter';
import { VertexAIAdapter } from './simplified/adapters/vertex-ai.adapter';
import { NullAdapter } from './simplified/adapters/null.adapter';
import { AzureFoundryLLMService } from './azure-foundry/azure-foundry-llm.service';
import { VertexAILLMService } from './vertex-ai/vertex-ai-llm.service';
import { ObservabilityPlaneModule } from '../observability';
import {
  resolveCommercialLlmProvider,
  resolveLlmProvider,
  resolveOpenSourceLlmProvider,
} from './provider-selection';

const logger = new Logger('LLMPlaneModule');

@Global()
@Module({
  imports: [HttpModule, ObservabilityPlaneModule],
  providers: [
    // Simplified provider components (always registered, only used when selected)
    OpenRouterClient,
    OllamaCloudClient,
    ModelRouter,
    SimplifiedLLMService,
    TwoTierLLMService,
    // Cloud provider services (always registered, only used when selected)
    AzureFoundryLLMService,
    VertexAILLMService,
    // Two-tier client factories: commercial + opensource backends
    {
      provide: COMMERCIAL_CLIENT,
      useFactory: (
        openRouterClient: OpenRouterClient,
        azureFoundryService: AzureFoundryLLMService,
        vertexAIService: VertexAILLMService,
      ) => {
        const provider = resolveCommercialLlmProvider(
          process.env.COMMERCIAL_LLM_PROVIDER,
        );
        logger.log(`Commercial LLM provider: ${provider}`);
        switch (provider) {
          case 'openrouter':
            return new OpenRouterAdapter(openRouterClient);
          case 'azure_foundry':
            return new AzureFoundryAdapter(azureFoundryService);
          case 'vertex_ai':
            return new VertexAIAdapter(vertexAIService);
          case 'none':
            return new NullAdapter('commercial');
        }
      },
      inject: [OpenRouterClient, AzureFoundryLLMService, VertexAILLMService],
    },
    {
      provide: OPENSOURCE_CLIENT,
      useFactory: (
        ollamaCloudClient: OllamaCloudClient,
        httpService: HttpService,
      ) => {
        const provider = resolveOpenSourceLlmProvider(
          process.env.OPENSOURCE_LLM_PROVIDER,
        );
        logger.log(`Open source LLM provider: ${provider}`);
        switch (provider) {
          case 'ollama_cloud':
            return new OllamaCloudAdapter(ollamaCloudClient);
          case 'ollama_local':
            return new OllamaLocalAdapter(httpService);
          case 'lm_studio':
            return new LMStudioAdapter(httpService);
          case 'none':
            return new NullAdapter('opensource');
        }
      },
      inject: [OllamaCloudClient, HttpService],
    },
    // Factory: select LLM_SERVICE implementation based on LLM_PROVIDER env var
    {
      provide: LLM_SERVICE,
      useFactory: (
        twoTierService: TwoTierLLMService,
        azureFoundryService: AzureFoundryLLMService,
        vertexAIService: VertexAILLMService,
      ) => {
        const provider = resolveLlmProvider(process.env.LLM_PROVIDER);
        logger.log(`LLM plane provider: ${provider}`);
        switch (provider) {
          case 'simplified':
            return twoTierService;
          case 'azure_foundry':
            return azureFoundryService;
          case 'vertex_ai':
            return vertexAIService;
        }
      },
      inject: [
        TwoTierLLMService,
        AzureFoundryLLMService,
        VertexAILLMService,
      ],
    },
  ],
  exports: [LLM_SERVICE],
})
export class LLMPlaneModule {}
