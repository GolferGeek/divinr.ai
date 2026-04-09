/**
 * Ollama Cloud Client
 *
 * OpenAI-compatible HTTP client targeting Ollama Cloud API.
 * Supports text generation via chat completions endpoint.
 * Handles auth and token counting.
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface OllamaModelEntry {
  id: string;
  name: string;
  isLocal: boolean;
}

export interface OllamaCloudRequestParams {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
}

export interface OllamaCloudResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string; reasoning?: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OllamaCloudResult {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  requestId: string;
}

@Injectable()
export class OllamaCloudClient {
  private readonly logger = new Logger(OllamaCloudClient.name);

  constructor(@Inject(HttpService) private readonly httpService: HttpService) {}

  private getBaseUrl(): string {
    return process.env.OLLAMA_CLOUD_BASE_URL || 'https://api.ollama.com/v1';
  }

  /**
   * Resolve the OpenAI-compatible base URL (ensuring /v1 suffix).
   *
   * Users may set OLLAMA_CLOUD_BASE_URL to "https://ollama.com" (no /v1).
   * The chat/completions endpoint lives at /v1/chat/completions, so we
   * must ensure the base URL ends with /v1.
   */
  private getV1Url(): string {
    const raw = this.getBaseUrl().replace(/\/+$/, '');
    return raw.endsWith('/v1') ? raw : `${raw}/v1`;
  }

  private getApiKey(): string | undefined {
    return process.env.OLLAMA_CLOUD_API_KEY;
  }

  async listModels(): Promise<OllamaModelEntry[]> {
    const apiKey = this.getApiKey();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    this.logger.debug('Fetching Ollama model catalog');

    // Try OpenAI-compat endpoint first (/v1/models), fall back to native (/api/tags)
    try {
      const v1Url = this.getV1Url();
      const response = await firstValueFrom(
        this.httpService.get<{
          data: Array<{ id: string; created?: number; owned_by?: string }>;
        }>(`${v1Url}/models`, { headers, timeout: 10_000 }),
      );
      return (response.data?.data ?? []).map((m) => ({
        id: m.id,
        name: m.id,
        isLocal: true,
      }));
    } catch {
      this.logger.debug('OpenAI-compat /v1/models failed, trying /api/tags');
    }

    // Native Ollama endpoint
    const nativeBase = this.getBaseUrl()
      .replace(/\/+$/, '')
      .replace(/\/v1\/?$/, '');
    const response = await firstValueFrom(
      this.httpService.get<{
        models: Array<{
          name: string;
          size?: number;
          details?: { family?: string; parameter_size?: string };
        }>;
      }>(`${nativeBase}/api/tags`, { headers, timeout: 10_000 }),
    );
    return (response.data?.models ?? []).map((m) => ({
      id: m.name,
      name: m.name,
      isLocal: true,
    }));
  }

  async chatCompletion(
    params: OllamaCloudRequestParams,
  ): Promise<OllamaCloudResult> {
    const apiKey = this.getApiKey();

    const requestBody = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens,
      top_p: params.top_p,
    };

    this.logger.debug(
      `Ollama Cloud request: model=${params.model}, messages=${params.messages.length}`,
    );

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const v1Url = this.getV1Url();
    const response = await firstValueFrom(
      this.httpService.post<OllamaCloudResponse>(
        `${v1Url}/chat/completions`,
        requestBody,
        {
          headers,
          timeout: 120_000,
        },
      ),
    );

    const data = response.data;

    if (!data.choices?.length) {
      throw new Error(
        `Ollama Cloud returned no choices for model ${params.model}`,
      );
    }

    const msg = data.choices[0]!.message;
    // Reasoning models (e.g. qwen3-next) may return content="" with reasoning in a separate field
    const content = msg.content || msg.reasoning || '';

    return {
      content,
      model: data.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      requestId: data.id ?? '',
    };
  }
}
