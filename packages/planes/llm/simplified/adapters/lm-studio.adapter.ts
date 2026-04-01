/**
 * LM Studio Adapter
 *
 * Connects to a local LM Studio instance (http://localhost:1234).
 * LM Studio exposes an OpenAI-compatible API.
 * Used as the opensource tier backend when OPENSOURCE_LLM_PROVIDER=lm_studio.
 *
 * Env vars:
 *   LM_STUDIO_URL — base URL for LM Studio (default: http://localhost:1234)
 */
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  LLMClient,
  LLMClientModelEntry,
  LLMClientChatParams,
  LLMClientChatResult,
} from '../llm-client.interface';

export class LMStudioAdapter implements LLMClient {
  readonly tier = 'opensource' as const;

  constructor(private readonly httpService: HttpService) {}

  private getBaseUrl(): string {
    return (
      process.env.LM_STUDIO_URL?.replace(/\/+$/, '') || 'http://localhost:1234'
    );
  }

  async listModels(): Promise<LLMClientModelEntry[]> {
    const baseUrl = this.getBaseUrl();

    try {
      const response = await firstValueFrom(
        this.httpService.get<{
          data: Array<{ id: string; owned_by?: string }>;
        }>(`${baseUrl}/v1/models`, { timeout: 5_000 }),
      );
      return (response.data?.data ?? []).map((m) => ({
        id: m.id,
        name: m.id,
        providerName: 'lm_studio',
        modelType: 'text-generation',
        isLocal: true,
      }));
    } catch {
      // LM Studio not running — return empty list
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
          message: { content: string };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
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
        `LM Studio returned no choices for model ${params.model}`,
      );
    }

    return {
      content: data.choices[0]!.message.content ?? '',
      model: data.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      cost: null,
      requestId: data.id ?? '',
    };
  }
}
