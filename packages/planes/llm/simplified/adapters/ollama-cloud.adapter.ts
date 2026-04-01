/**
 * Ollama Cloud Adapter
 *
 * Wraps the existing OllamaCloudClient to implement LLMClient.
 * Used as the opensource tier backend when OPENSOURCE_LLM_PROVIDER=ollama_cloud.
 */
import {
  LLMClient,
  LLMClientModelEntry,
  LLMClientChatParams,
  LLMClientChatResult,
} from '../llm-client.interface';
import { OllamaCloudClient } from '../ollama-cloud.client';

export class OllamaCloudAdapter implements LLMClient {
  readonly tier = 'opensource' as const;

  constructor(private readonly client: OllamaCloudClient) {}

  async listModels(): Promise<LLMClientModelEntry[]> {
    const models = await this.client.listModels();
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      providerName: 'ollama',
      modelType: 'text-generation',
      isLocal: true,
    }));
  }

  async chatCompletion(
    params: LLMClientChatParams,
  ): Promise<LLMClientChatResult> {
    const result = await this.client.chatCompletion({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.max_tokens,
      top_p: params.top_p,
    });
    return {
      content: result.content,
      model: result.model,
      usage: result.usage,
      cost: null,
      requestId: result.requestId,
    };
  }
}
