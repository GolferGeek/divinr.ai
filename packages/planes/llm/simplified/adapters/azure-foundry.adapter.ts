/**
 * Azure Foundry Adapter
 *
 * Wraps AzureFoundryLLMService to implement LLMClient for the commercial tier.
 * Used when COMMERCIAL_LLM_PROVIDER=azure_foundry.
 *
 * Note: This adapter delegates to the full LLMServiceProvider for chat,
 * but only exposes the LLMClient subset (listModels + chatCompletion).
 */
import {
  LLMClient,
  LLMClientModelEntry,
  LLMClientChatParams,
  LLMClientChatResult,
} from '../llm-client.interface';
import { AzureFoundryLLMService } from '../../azure-foundry/azure-foundry-llm.service';

export class AzureFoundryAdapter implements LLMClient {
  readonly tier = 'commercial' as const;

  constructor(private readonly service: AzureFoundryLLMService) {}

  async listModels(): Promise<LLMClientModelEntry[]> {
    const models = await this.service.listModels();
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      providerName: m.providerName,
      modelType: m.modelType,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      pricing: m.pricing,
      isLocal: false,
    }));
  }

  async chatCompletion(
    params: LLMClientChatParams,
  ): Promise<LLMClientChatResult> {
    // Build a minimal ExecutionContext for the underlying service.
    // The real ExecutionContext will be supplied by TwoTierLLMService
    // when it calls generateResponse() — this adapter is only used
    // for model listing in the two-tier service.
    // For direct chatCompletion, we construct a bare-bones context.
    const result = await this.service.generateResponse(
      params.messages.find((m) => m.role === 'system')?.content ?? '',
      params.messages.find((m) => m.role === 'user')?.content ?? '',
      {
        temperature: params.temperature,
        max_tokens: params.max_tokens,
        executionContext: {
          orgSlug: 'system',
          userId: '00000000-0000-0000-0000-000000000000',
          conversationId: '00000000-0000-0000-0000-000000000000',
          agentSlug: 'system',
          agentType: 'system',
          provider: 'azure_foundry',
          model: params.model,
        },
      },
    );

    const content = typeof result === 'string' ? result : result.content;
    return {
      content,
      model: params.model,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: null,
      requestId: '',
    };
  }
}
