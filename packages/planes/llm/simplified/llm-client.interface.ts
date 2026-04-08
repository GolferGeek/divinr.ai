/**
 * LLM Client Interface
 *
 * Common interface for all two-tier LLM backend clients.
 * Each adapter wraps a specific backend (OpenRouter, Ollama Cloud, local Ollama, etc.)
 * and implements this interface for uniform access from TwoTierLLMService.
 */

export const COMMERCIAL_CLIENT = Symbol('COMMERCIAL_CLIENT');
export const OPENSOURCE_CLIENT = Symbol('OPENSOURCE_CLIENT');

export interface LLMClientModelEntry {
  id: string;
  name: string;
  isLocal: boolean;
  providerName: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  pricing?: { inputPer1M?: number; outputPer1M?: number };
  modelType?: string;
}

export interface LLMClientChatParams {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

export interface LLMClientChatResult {
  content: string;
  reasoning?: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens?: number;
    totalTokens: number;
  };
  cost: number | null;
  requestId: string;
}

export interface LLMClient {
  readonly tier: 'commercial' | 'opensource';
  listModels(): Promise<LLMClientModelEntry[]>;
  chatCompletion(params: LLMClientChatParams): Promise<LLMClientChatResult>;
}
