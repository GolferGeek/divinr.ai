import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages/messages';
import type {
  GenerateContentRequest,
  GenerateContentResult,
  EnhancedGenerateContentResponse,
  GenerateContentCandidate,
  UsageMetadata,
  CitationSource,
  HarmBlockThreshold,
  HarmCategory,
} from '@google/generative-ai';

/**
 * Narrow wrappers around SDK request/response types so we can reference them
 * across the codebase without sprinkling direct imports in every service.
 */
export type OpenAIChatCompletionRequest =
  ChatCompletionCreateParamsNonStreaming;
export type OpenAIChatCompletionResponse = ChatCompletion;

export type AnthropicMessageCreateRequest = MessageCreateParamsNonStreaming;
export type AnthropicMessageResponse = Message;

export type GoogleGenerateContentRequest = GenerateContentRequest;
export type GoogleGenerateContentResult = GenerateContentResult;
export type GoogleGenerateContentResponse = EnhancedGenerateContentResponse;
export type GoogleGenerateContentCandidate = GenerateContentCandidate;
export type GoogleUsageMetadata = UsageMetadata;
export type GoogleCitationSource = CitationSource;
export type GoogleHarmCategory = HarmCategory;
export type GoogleHarmBlockThreshold = HarmBlockThreshold;

export interface OllamaGenerateRequestOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
}

export interface OllamaGenerateRequestPayload {
  model: string;
  prompt: string;
  system?: string;
  stream?: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
    top_p?: number;
    top_k?: number;
  };
}

export interface OllamaGenerateResponsePayload {
  model: string;
  response: string;
  done: boolean;
  created_at: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}
