/**
 * Ollama Local Adapter
 *
 * Connects to a local Ollama instance (http://localhost:11434).
 * Used as the opensource tier backend when OPENSOURCE_LLM_PROVIDER=ollama_local.
 *
 * Env vars:
 *   OLLAMA_LOCAL_URL — base URL for local Ollama (default: http://localhost:11434)
 */
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  LLMClient,
  LLMClientModelEntry,
  LLMClientChatParams,
  LLMClientChatResult,
} from '../llm-client.interface';

export class OllamaLocalAdapter implements LLMClient {
  readonly tier = 'opensource' as const;

  constructor(private readonly httpService: HttpService) {}

  private getBaseUrl(): string {
    return (
      process.env.OLLAMA_LOCAL_URL?.replace(/\/+$/, '') ||
      'http://localhost:11434'
    );
  }

  async listModels(): Promise<LLMClientModelEntry[]> {
    const baseUrl = this.getBaseUrl();

    // Try OpenAI-compat /v1/models first
    try {
      const response = await firstValueFrom(
        this.httpService.get<{
          data: Array<{ id: string; created?: number; owned_by?: string }>;
        }>(`${baseUrl}/v1/models`, { timeout: 5_000 }),
      );
      return (response.data?.data ?? []).map((m) => ({
        id: m.id,
        name: m.id,
        providerName: 'ollama',
        modelType: 'text-generation',
        isLocal: true,
      }));
    } catch {
      // Fall through to native endpoint
    }

    // Native Ollama /api/tags
    try {
      const response = await firstValueFrom(
        this.httpService.get<{
          models: Array<{
            name: string;
            size?: number;
            details?: { family?: string; parameter_size?: string };
          }>;
        }>(`${baseUrl}/api/tags`, { timeout: 5_000 }),
      );
      return (response.data?.models ?? []).map((m) => ({
        id: m.name,
        name: m.name,
        providerName: 'ollama',
        modelType: 'text-generation',
        isLocal: true,
      }));
    } catch {
      // Local Ollama not running — return empty list
      return [];
    }
  }

  async chatCompletion(
    params: LLMClientChatParams,
  ): Promise<LLMClientChatResult> {
    const baseUrl = this.getBaseUrl();

    const response = await firstValueFrom(
      this.httpService.post<{
        id?: string;
        model: string;
        choices: Array<{
          message: { content: string; reasoning?: string };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          completion_tokens_details?: {
            reasoning_tokens?: number;
          };
        };
      }>(
        `${baseUrl}/v1/chat/completions`,
        {
          model: params.model,
          messages: params.messages,
          temperature: params.temperature ?? 0.7,
          max_tokens: params.max_tokens,
          top_p: params.top_p,
        },
        { timeout: 120_000 },
      ),
    );

    const data = response.data;
    if (!data.choices?.length) {
      throw new Error(
        `Local Ollama returned no choices for model ${params.model}`,
      );
    }

    const msg = data.choices[0]!.message;
    let content = msg.content || '';
    let reasoning: string | undefined =
      msg.reasoning && msg.reasoning !== content ? msg.reasoning : undefined;

    // Inline <think>...</think> fallback for providers that embed reasoning in content
    if (!reasoning && content) {
      const m = content.match(/^\s*<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/);
      if (m) {
        reasoning = m[1];
        content = (m[2] ?? '').trim();
      }
    }

    return {
      content,
      reasoning,
      model: data.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      cost: null,
      requestId: data.id ?? '',
    };
  }
}
