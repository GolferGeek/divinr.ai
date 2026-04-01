/**
 * LLM Service Interfaces
 *
 * This file contains all standardized interfaces for LLM service implementations.
 * These interfaces ensure consistent behavior and metadata handling across all
 * provider-specific services.
 */

import { PIIProcessingMetadata } from '../types/pii-metadata.types';
import { LLMUsageMetrics, CIDAFMOptions } from '../types/llm-evaluation';
import type { DictionaryPseudonymMapping } from '../pii/dictionary-pseudonymizer.service';
import { ExecutionContext } from '@orchestrator-ai/transport-types';

/**
 * Configuration interface for LLM services
 */
export interface LLMServiceConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
}

/**
 * Standardized parameters for LLM response generation
 */
export type LLMCallerType = 'agent' | 'api' | 'user' | 'system' | 'service';

export interface LLMCurrentUserContext extends Record<string, unknown> {
  id?: string;
  email?: string;
  name?: string;
  roles?: string[];
}

export type LLMRequestHeaders = Record<
  string,
  string | number | boolean | string[] | undefined
>;

export interface LLMRequestOptions extends Record<string, unknown> {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  preferLocal?: boolean;
  maxComplexity?: 'simple' | 'medium' | 'complex' | 'reasoning';
  authToken?: string;
  currentUser?: LLMCurrentUserContext;
  callerType?: string;
  callerName?: string;
  organizationSlug?: string | null;
  organizationId?: string;
  agentSlug?: string | null;
  conversationId?: string;
  sessionId?: string;
  taskId?: string;
  userId?: string;
  dataClassification?: string;
  dataClass?: string;
  policyProfile?: string;
  sovereignMode?: string;
  noTrain?: boolean;
  noRetain?: boolean;
  includeMetadata?: boolean;
  quick?: boolean;
  providerName?: string;
  modelName?: string;
  provider?: string;
  model?: string;
  max_tokens?: number;
  top_p?: number;
  top_k?: number;
  requestId?: string;
  context?: string;
  dataTypes?: string[];
  dictionaryMappings?: DictionaryPseudonymMapping[];
  piiMetadata?: PIIProcessingMetadata;
  routingDecision?: RoutingDecision;
  cidafmOptions?: CIDAFMOptions;
  /** ExecutionContext for observability - flows from endpoint through to LLM. REQUIRED. */
  executionContext: ExecutionContext;
}

export interface GenerateResponseParams {
  systemPrompt: string;
  userMessage: string;
  images?: Array<{ base64: string; mimeType: string }>;
  config: LLMServiceConfig;
  headers?: LLMRequestHeaders;
  options: LLMRequestOptions; // Required - must include executionContext
}

/**
 * Parameters for the unified generateResponse method
 */
export interface UnifiedGenerateResponseParams {
  provider: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  options?: LLMRequestOptions;
}

/**
 * Response metadata structure
 */
export interface ResponseMetadata {
  provider: string;
  model: string;
  requestId: string;
  timestamp: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost?: number;
  };
  timing: {
    startTime: number;
    endTime: number;
    duration: number;
  };
  // Additional fields from existing implementations
  tier?: 'local' | 'centralized' | 'external';
  status: 'started' | 'completed' | 'error';
  errorMessage?: string;
  enhancedMetrics?: LLMUsageMetrics;
  langsmithRunId?: string;
  thinking?: string; // Optional thinking/reasoning process from the model
  // Provider-specific fields (e.g., from LocalLLMResponse)
  providerSpecific?: Record<string, unknown>;
}

/**
 * Standardized response format for all LLM providers
 */
export interface LLMResponse {
  content: string;
  metadata: ResponseMetadata;
  piiMetadata?: PIIProcessingMetadata | null;
  sanitizationMetadata?: Record<string, unknown> | null;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const isLLMResponse = (value: unknown): value is LLMResponse => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<LLMResponse>;
  return (
    typeof candidate.content === 'string' &&
    typeof candidate.metadata === 'object' &&
    candidate.metadata !== null
  );
};

/**
 * Options for PII processing
 */
export interface PiiOptions {
  enablePseudonymization?: boolean;
  useDictionaryPseudonymizer?: boolean;
  preserveOriginalNames?: boolean;
  customPseudonyms?: Record<string, string>;
}

/**
 * Provider-specific extension interface
 * Providers can extend this to add their own specific metadata
 */
export type ProviderSpecificMetadata = Record<string, unknown>;

/**
 * Extended response metadata for providers that need additional fields
 */
export interface ExtendedResponseMetadata extends ResponseMetadata {
  providerSpecific: ProviderSpecificMetadata;
}

/**
 * Message interface for chat-based interactions
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

/**
 * Tool call interface for function calling
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Extended parameters for chat-based LLM interactions
 */
export interface ChatGenerateResponseParams extends Omit<
  GenerateResponseParams,
  'systemPrompt' | 'userMessage'
> {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?:
    | 'auto'
    | 'none'
    | { type: 'function'; function: { name: string } };
}

/**
 * Tool definition interface for function calling
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/**
 * Streaming response interface
 */
export interface StreamingLLMResponse {
  content: AsyncIterable<string>;
  metadata: Promise<ResponseMetadata>;
  piiMetadata?: PIIProcessingMetadata;
}

/**
 * Batch processing interface
 */
export interface BatchGenerateResponseParams {
  requests: GenerateResponseParams[];
  batchId?: string;
  maxConcurrency?: number;
}

/**
 * Batch response interface
 */
export interface BatchLLMResponse {
  responses: LLMResponse[];
  batchMetadata: {
    batchId: string;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalDuration: number;
    averageDuration: number;
  };
}

/**
 * Health check interface for provider services
 */
export interface ProviderHealthStatus {
  provider: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency?: number;
  lastChecked: string;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Provider capabilities interface
 */
export interface ProviderCapabilities {
  provider: string;
  supportedModels: string[];
  supportsStreaming: boolean;
  supportsFunctionCalling: boolean;
  supportsSystemMessages: boolean;
  maxTokens: number;
  maxContextLength: number;
  supportedFeatures: string[];
}

/**
 * Cost calculation interface
 */
export interface CostCalculation {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
  pricingModel: 'per-token' | 'per-request' | 'per-minute';
  breakdown?: {
    inputTokens: number;
    outputTokens: number;
    inputRate: number;
    outputRate: number;
  };
}

/**
 * Usage tracking interface
 */
export interface UsageMetrics {
  provider: string;
  model: string;
  requestCount: number;
  totalTokens: number;
  totalCost: number;
  averageLatency: number;
  errorRate: number;
  timeWindow: {
    start: string;
    end: string;
  };
}

/**
 * Routing decision interface (from existing CentralizedRoutingService)
 */
export interface RoutingDecision {
  provider: string;
  model: string;
  tier: 'local' | 'centralized' | 'external';
  reason: string;
  confidence: number;
  alternatives?: Array<{
    provider: string;
    model: string;
    score: number;
  }>;
}

/**
 * Legacy compatibility interface for existing LLMService
 */
export interface LegacyLLMResponse {
  content: string;
  runMetadata: {
    runId: string;
    provider: string;
    model: string;
    tier: 'local' | 'centralized' | 'external';
    cost: number;
    duration: number;
    timestamp: string;
    inputTokens?: number;
    outputTokens?: number;
    status: 'started' | 'completed' | 'error';
    errorMessage?: string;
    enhancedMetrics?: LLMUsageMetrics;
  };
  routingDecision: RoutingDecision;
  piiMetadata?: PIIProcessingMetadata;
}

/**
 * Source blinding configuration interface
 */
export interface SourceBlindingConfig {
  policyProfile?: string;
  dataClass?: string;
  sovereignMode?: string;
  noTrain?: boolean;
  noRetain?: boolean;
}

/**
 * Blinded LLM configuration interface
 */
export interface BlindedLLMConfig {
  provider: 'openai' | 'anthropic' | 'google';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  sourceBlindingOptions?: SourceBlindingConfig;
}

/**
 * Local LLM request interface (for Ollama)
 */
export interface LocalLLMRequest {
  model: string;
  prompt: string;
  system?: string;
  options?: {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    top_k?: number;
  };
}

/**
 * Local LLM response interface (from Ollama)
 */
export interface LocalLLMResponse {
  response: string;
  model: string;
  created_at: string;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

// =============================================================================
// IMAGE GENERATION INTERFACES
// =============================================================================

/**
 * Parameters for image generation
 */
export interface ImageGenerationParams {
  /** Text prompt describing the image to generate */
  prompt: string;
  /** Image dimensions */
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
  /** Quality level (OpenAI) */
  quality?: 'standard' | 'hd';
  /** Style preference (OpenAI) */
  style?: 'natural' | 'vivid';
  /** Number of images to generate (1-4) */
  numberOfImages?: number;
  /** Reference image URL for editing operations */
  referenceImageUrl?: string;
  /** Reference image data as Buffer for editing operations */
  referenceImage?: Buffer;
  /** Mask image for inpainting (transparent areas indicate where to edit) */
  mask?: Buffer;
  /** Aspect ratio (Google Imagen) */
  aspectRatio?: '1:1' | '3:4' | '4:3' | '16:9' | '9:16';
  /** Enable prompt enhancement (Google Imagen) */
  enhancePrompt?: boolean;
  /** Background transparency (OpenAI GPT Image) */
  background?: 'transparent' | 'opaque' | 'auto';
}

/**
 * Metadata for a generated image
 */
export interface ImageMetadata {
  /** Image width in pixels */
  width?: number;
  /** Image height in pixels */
  height?: number;
  /** MIME type (e.g., 'image/png') */
  mimeType: string;
  /** File size in bytes */
  sizeBytes?: number;
  /** Provider-revised prompt (if applicable) */
  revisedPrompt?: string;
}

/**
 * Response from image generation
 */
export interface ImageGenerationResponse {
  /** Array of generated images */
  images: Array<{
    /** Raw image bytes */
    data: Buffer;
    /** Provider-revised prompt for this image */
    revisedPrompt?: string;
    /** Image metadata */
    metadata?: ImageMetadata;
  }>;
  /** Standard response metadata (reuses existing ResponseMetadata) */
  metadata: ResponseMetadata;
  /** PII metadata if prompt was processed */
  piiMetadata?: PIIProcessingMetadata | null;
  /** Error information if generation failed */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Type guard for ImageGenerationResponse
 */
export const isImageGenerationResponse = (
  value: unknown,
): value is ImageGenerationResponse => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ImageGenerationResponse>;
  return (
    Array.isArray(candidate.images) &&
    typeof candidate.metadata === 'object' &&
    candidate.metadata !== null
  );
};

// =============================================================================
// VIDEO GENERATION INTERFACES
// =============================================================================

/**
 * Parameters for video generation
 */
export interface VideoGenerationParams {
  /** Text prompt describing the video to generate */
  prompt: string;
  /** Video duration in seconds */
  duration?: number;
  /** Video aspect ratio */
  aspectRatio?: '16:9' | '9:16';
  /** Resolution */
  resolution?: '720p' | '1080p' | '4k';
  /** First frame image URL (for image-to-video) */
  firstFrameImageUrl?: string;
  /** First frame image data as Buffer */
  firstFrameImage?: Buffer;
  /** Last frame image URL (for controlled endings) */
  lastFrameImageUrl?: string;
  /** Last frame image data as Buffer */
  lastFrameImage?: Buffer;
  /** Video to extend (for video extension) */
  extendVideoUrl?: string;
  /** Generate audio with video */
  generateAudio?: boolean;
  /** Style reference images (up to 3) */
  styleImages?: Buffer[];
}

/**
 * Metadata for a generated video
 */
export interface VideoMetadata {
  /** Video width in pixels */
  width?: number;
  /** Video height in pixels */
  height?: number;
  /** Duration in seconds */
  durationSeconds?: number;
  /** Frame rate */
  frameRate?: number;
  /** MIME type (e.g., 'video/mp4') */
  mimeType: string;
  /** File size in bytes */
  sizeBytes?: number;
  /** Whether audio is included */
  hasAudio?: boolean;
}

/**
 * Status of an async video generation operation
 */
export type VideoGenerationStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

/**
 * Response from video generation (may be async)
 */
export interface VideoGenerationResponse {
  /** Operation ID for polling (async operations) */
  operationId?: string;
  /** Current status of the generation */
  status: VideoGenerationStatus;
  /** Video data when completed */
  videoData?: Buffer;
  /** Video URL when completed (if stored externally) */
  videoUrl?: string;
  /** Video metadata */
  videoMetadata?: VideoMetadata;
  /** Standard response metadata */
  metadata: ResponseMetadata;
  /** Error information if generation failed */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Type guard for VideoGenerationResponse
 */
export const isVideoGenerationResponse = (
  value: unknown,
): value is VideoGenerationResponse => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<VideoGenerationResponse>;
  return (
    typeof candidate.status === 'string' &&
    ['pending', 'processing', 'completed', 'failed'].includes(
      candidate.status,
    ) &&
    typeof candidate.metadata === 'object' &&
    candidate.metadata !== null
  );
};

// =============================================================================
// MEDIA STORAGE INTERFACES
// =============================================================================

/**
 * Parameters for storing generated media
 */
export interface MediaStorageParams {
  /** Raw media bytes */
  data: Buffer;
  /** MIME type */
  mimeType: string;
  /** Execution context for ownership and linking */
  context: ExecutionContext;
  /** Media-specific metadata */
  metadata: {
    prompt: string;
    provider: string;
    model: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
    /** Parent asset ID if this is an edit/variation */
    parentAssetId?: string;
  };
}

/**
 * Result of storing media
 */
export interface StoredMediaAsset {
  /** Our internal asset UUID */
  assetId: string;
  /** Public URL to access the media */
  url: string;
  /** Storage path within bucket */
  storagePath: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
}
