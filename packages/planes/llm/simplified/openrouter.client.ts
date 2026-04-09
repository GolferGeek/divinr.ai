/**
 * OpenRouter Client
 *
 * OpenAI-compatible HTTP client targeting openrouter.ai/api/v1/chat/completions.
 * Supports text generation and image generation (via modalities: ['image']).
 * Parses x-openrouter-cost response header for cost tracking.
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface OpenRouterModelEntry {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  top_provider?: { max_completion_tokens?: number };
  architecture?: { output_modalities?: string[] };
}

export interface OpenRouterRequestParams {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
}

export interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenRouterResult {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost: number | null;
  requestId: string;
}

@Injectable()
export class OpenRouterClient {
  private readonly logger = new Logger(OpenRouterClient.name);
  private readonly baseUrl = 'https://openrouter.ai/api/v1';

  constructor(@Inject(HttpService) private readonly httpService: HttpService) {}

  private getApiKey(): string {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error(
        'OPENROUTER_API_KEY is not set. Required for LLM_PROVIDER=simplified with OpenRouter.',
      );
    }
    return key;
  }

  async chatCompletion(
    params: OpenRouterRequestParams,
  ): Promise<OpenRouterResult> {
    const apiKey = this.getApiKey();

    const requestBody = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens,
      top_p: params.top_p,
    };

    this.logger.debug(
      `OpenRouter request: model=${params.model}, messages=${params.messages.length}`,
    );

    const response = await firstValueFrom(
      this.httpService.post<OpenRouterResponse>(
        `${this.baseUrl}/chat/completions`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer':
              process.env.OPENROUTER_SITE_URL || 'https://orchestratorai.io',
            'X-Title': process.env.OPENROUTER_SITE_NAME || 'Orchestrator AI',
          },
          timeout: 120_000,
        },
      ),
    );

    const data = response.data as {
      id?: string;
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const costHeader = (response.headers as Record<string, string>)[
      'x-openrouter-cost'
    ];
    const cost = costHeader ? parseFloat(String(costHeader)) : null;

    if (!data.choices?.length) {
      throw new Error(
        `OpenRouter returned no choices for model ${params.model}`,
      );
    }

    return {
      content: data.choices[0]!.message!.content ?? '',
      model: data.model ?? params.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      cost,
      requestId: data.id ?? '',
    };
  }

  async listModels(): Promise<OpenRouterModelEntry[]> {
    this.logger.debug('Fetching OpenRouter model catalog');

    const response = await firstValueFrom(
      this.httpService.get<{ data: OpenRouterModelEntry[] }>(
        `${this.baseUrl}/models`,
        { timeout: 30_000 },
      ),
    );

    return response.data?.data ?? [];
  }

  /**
   * Generate an image via OpenRouter's chat/completions with modalities: ['image'].
   *
   * OpenRouter returns images as base64 data-URLs in:
   *   choices[0].message.images[].image_url.url  → "data:image/png;base64,..."
   *
   * We extract the first image's base64 data and return it alongside
   * any text content the model produced.
   */
  async imageGeneration(params: {
    model: string;
    prompt: string;
    size?: string;
  }): Promise<OpenRouterResult & { imageBase64?: string }> {
    const apiKey = this.getApiKey();

    const requestBody = {
      model: params.model,
      messages: [{ role: 'user', content: params.prompt }],
      modalities: ['image'],
      ...(params.size && { image_size: params.size }),
    };

    this.logger.debug(`OpenRouter image request: model=${params.model}`);

    const response = await firstValueFrom(
      this.httpService.post(`${this.baseUrl}/chat/completions`, requestBody, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer':
            process.env.OPENROUTER_SITE_URL || 'https://orchestratorai.io',
          'X-Title': process.env.OPENROUTER_SITE_NAME || 'Orchestrator AI',
        },
        timeout: 120_000,
      }),
    );

    // OpenRouter image response shape — images live inside message.images[]
    const data = response.data as {
      id?: string;
      choices?: Array<{
        message?: {
          content?: string;
          images?: Array<{
            type: string;
            image_url: { url: string };
          }>;
        };
      }>;
      model?: string;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const message = data.choices?.[0]?.message;

    this.logger.debug(
      `🖼️ [OPENROUTER] Image response: keys=${Object.keys(data).join(',')}, ` +
        `images=${message?.images?.length ?? 0}, ` +
        `content type=${typeof message?.content}, ` +
        `content length=${typeof message?.content === 'string' ? message.content.length : 'N/A'}`,
    );

    const costHeader = (response.headers as Record<string, string>)[
      'x-openrouter-cost'
    ];
    const cost = costHeader ? parseFloat(String(costHeader)) : null;

    // Extract base64 image data from the first image in message.images[]
    let imageBase64: string | undefined;
    const firstImage = message?.images?.[0];
    if (firstImage?.image_url?.url) {
      const dataUrl = firstImage.image_url.url;
      // Strip "data:image/png;base64," prefix to get raw base64
      const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (base64Match) {
        imageBase64 = base64Match[1];
      } else if (dataUrl.startsWith('http')) {
        // Some models might return a URL instead of base64
        imageBase64 = undefined; // Will be handled as URL in caller
        this.logger.debug(`🖼️ [OPENROUTER] Image returned as URL, not base64`);
      }
    }

    // Text content (may be empty for image-only models)
    const textContent =
      typeof message?.content === 'string' ? message.content : '';

    return {
      content: textContent,
      model: data.model ?? params.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      cost,
      requestId: data.id ?? '',
      imageBase64,
    };
  }
}
