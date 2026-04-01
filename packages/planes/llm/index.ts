/**
 * LLM Plane — public API
 *
 * Usage:
 *   import { LLM_SERVICE, LLMServiceProvider } from '@orchestratorai/planes/llm';
 *
 *   @Inject(LLM_SERVICE) private readonly llm: LLMServiceProvider
 */
export {
  LLM_SERVICE,
  type LLMServiceProvider,
  type LLMModelInfo,
  type LLMProviderInfo,
} from './llm.interface';
export { LLMPlaneModule } from './llm.module';
export type {
  LLMResponse,
  LLMRequestOptions,
  LLMServiceConfig,
  GenerateResponseParams,
  UnifiedGenerateResponseParams,
  ResponseMetadata,
  ImageGenerationParams,
  ImageGenerationResponse,
  VideoGenerationParams,
  VideoGenerationResponse,
  StreamingLLMResponse,
  ChatMessage,
  ChatGenerateResponseParams,
  RoutingDecision,
  ProviderCapabilities,
  ProviderHealthStatus,
  CostCalculation,
  UsageMetrics,
  PiiOptions,
  MediaStorageParams,
  StoredMediaAsset,
} from './llm.types';
