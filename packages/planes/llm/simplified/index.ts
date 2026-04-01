/**
 * Simplified LLM Provider — public API
 *
 * Selected by LLM_PROVIDER=simplified
 * Routes through OpenRouter (commercial models) and Ollama Cloud (open-source models).
 */
export { SimplifiedLLMService } from './simplified-llm.service';
export { OpenRouterClient } from './openrouter.client';
export { OllamaCloudClient } from './ollama-cloud.client';
export { ModelRouter } from './model-router';
export type { RoutingTarget, RoutingResult } from './model-router';
export type {
  OpenRouterResult,
  OpenRouterRequestParams,
} from './openrouter.client';
export type {
  OllamaCloudResult,
  OllamaCloudRequestParams,
} from './ollama-cloud.client';
