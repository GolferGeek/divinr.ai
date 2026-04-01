/**
 * LLM Plane Interface
 *
 * Defines the public contract for the LLM provider plane.
 * Selected by LLM_PROVIDER env var at deploy time:
 *   - fine_control (default): Full provider routing, PII, sovereign mode
 *   - openrouter: Simplified OpenRouter proxy (Phase 5)
 *   - ollama_cloud: Simplified Ollama Cloud proxy (Phase 5)
 *
 * Consumers inject LLM_SERVICE and get the active implementation.
 */
import { ExecutionContext } from '@orchestrator-ai/transport-types';
import type {
  LLMResponse,
  LLMRequestOptions,
  UnifiedGenerateResponseParams,
  ImageGenerationResponse,
  VideoGenerationResponse,
} from './llm.types';

export const LLM_SERVICE = Symbol('LLM_SERVICE');

/**
 * Normalized model info returned by listModels() across all provider planes.
 */
export interface LLMModelInfo {
  id: string;
  name: string;
  providerName: string;
  modelType:
    | 'text-generation'
    | 'image-generation'
    | 'video-generation'
    | 'reasoning';
  contextWindow?: number;
  maxOutputTokens?: number;
  pricing?: { inputPer1M?: number; outputPer1M?: number };
  capabilities?: string[];
  isLocal?: boolean;
}

/**
 * Normalized provider info returned by listProviders() across all provider planes.
 */
export interface LLMProviderInfo {
  name: string;
  displayName: string;
  status: 'active';
}

/**
 * LLMServiceProvider — the public contract for all LLM plane implementations.
 *
 * Methods mirror LLMService's public API. New code should inject LLM_SERVICE
 * instead of LLMService directly for provider-plane portability.
 */
export interface LLMServiceProvider {
  /**
   * List available models from the active provider plane.
   */
  listModels(filters?: {
    modelType?: string;
    sovereignMode?: boolean;
  }): Promise<LLMModelInfo[]>;

  /**
   * List available providers from the active provider plane.
   */
  listProviders(): Promise<LLMProviderInfo[]>;
  /**
   * Simple LLM call with system and user messages.
   * Returns string for backward compat, or LLMResponse when includeMetadata is set.
   */
  generateResponse(
    systemPrompt: string,
    userMessage: string,
    options?: LLMRequestOptions & {
      provider?: string;
      cidafmOptions?: Record<string, unknown>;
      complexity?: 'simple' | 'medium' | 'complex' | 'reasoning';
      images?: Array<{ base64: string; mimeType: string }>;
    },
  ): Promise<string | LLMResponse>;

  /**
   * Unified entry point — provider + model are explicit params.
   */
  generateUnifiedResponse(
    params: UnifiedGenerateResponseParams,
  ): Promise<string | LLMResponse>;

  /**
   * Generate image using provider-specific APIs.
   */
  generateImage(params: {
    provider: string;
    model: string;
    prompt: string;
    size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd';
    style?: 'natural' | 'vivid';
    numberOfImages?: number;
    referenceImageUrl?: string;
    background?: 'transparent' | 'opaque' | 'auto';
    executionContext: ExecutionContext;
  }): Promise<ImageGenerationResponse>;

  /**
   * Generate video using provider-specific APIs.
   */
  generateVideo(params: {
    provider: string;
    model: string;
    prompt: string;
    duration?: number;
    aspectRatio?: '16:9' | '9:16';
    resolution?: '720p' | '1080p' | '4k';
    firstFrameImageUrl?: string;
    firstFrameImage?: Buffer;
    lastFrameImageUrl?: string;
    lastFrameImage?: Buffer;
    generateAudio?: boolean;
    executionContext: ExecutionContext;
  }): Promise<VideoGenerationResponse>;

  /**
   * Poll async video generation status.
   */
  pollVideoStatus(params: {
    provider: string;
    model?: string;
    operationId: string;
    executionContext: ExecutionContext;
  }): Promise<VideoGenerationResponse>;

  /**
   * Emit observability event for LLM lifecycle tracking.
   */
  emitLlmObservabilityEvent(
    hook_event_type: string,
    executionContext: ExecutionContext,
    payload?: Record<string, unknown>,
  ): void;
}
