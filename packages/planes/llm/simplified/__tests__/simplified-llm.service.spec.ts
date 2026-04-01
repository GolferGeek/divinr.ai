import { Test, TestingModule } from '@nestjs/testing';
import { SimplifiedLLMService } from '../simplified-llm.service';
import { OpenRouterClient } from '../openrouter.client';
import { OllamaCloudClient } from '../ollama-cloud.client';
import { ModelRouter } from '../model-router';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { DATABASE_SERVICE } from '@/database';
import { ExecutionContext } from '@orchestrator-ai/transport-types';

const mockExecutionContext: ExecutionContext = {
  orgSlug: 'test-org',
  userId: 'user-1',
  conversationId: 'conv-1',
  agentSlug: 'test-agent',
  agentType: 'context',
  provider: 'openai',
  model: 'gpt-4o',
};

describe('SimplifiedLLMService', () => {
  let service: SimplifiedLLMService;
  let openRouterClient: OpenRouterClient;
  let ollamaCloudClient: OllamaCloudClient;
  let mockDb: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockDb = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimplifiedLLMService,
        {
          provide: OpenRouterClient,
          useValue: {
            chatCompletion: jest.fn(),
            imageGeneration: jest.fn(),
          },
        },
        {
          provide: OllamaCloudClient,
          useValue: {
            chatCompletion: jest.fn(),
          },
        },
        {
          provide: ModelRouter,
          useValue: new ModelRouter(),
        },
        {
          provide: ObservabilityEventsService,
          useValue: {
            push: jest.fn(),
          },
        },
        {
          provide: DATABASE_SERVICE,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<SimplifiedLLMService>(SimplifiedLLMService);
    openRouterClient = module.get<OpenRouterClient>(OpenRouterClient);
    ollamaCloudClient = module.get<OllamaCloudClient>(OllamaCloudClient);
  });

  describe('generateResponse', () => {
    it('throws without ExecutionContext', async () => {
      await expect(service.generateResponse('system', 'user')).rejects.toThrow(
        'ExecutionContext is required',
      );
    });

    it('routes commercial models to OpenRouter', async () => {
      (openRouterClient.chatCompletion as jest.Mock).mockResolvedValue({
        content: 'OpenRouter response',
        model: 'gpt-4o',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        cost: 0.0001,
        requestId: 'req-1',
      });

      const result = await service.generateResponse(
        'You are helpful',
        'Hello',
        { executionContext: mockExecutionContext },
      );

      expect(result).toBe('OpenRouter response');
      expect(openRouterClient.chatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'openai/gpt-4o' }),
      );
    });

    it('routes open-source models to Ollama Cloud', async () => {
      const ollamaContext = {
        ...mockExecutionContext,
        provider: 'ollama',
        model: 'llama-3.3-70b',
      };

      (ollamaCloudClient.chatCompletion as jest.Mock).mockResolvedValue({
        content: 'Ollama response',
        model: 'llama-3.3-70b',
        usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18 },
        requestId: 'req-2',
      });

      const result = await service.generateResponse(
        'You are helpful',
        'Hello',
        { executionContext: ollamaContext },
      );

      expect(result).toBe('Ollama response');
      expect(ollamaCloudClient.chatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'llama-3.3-70b' }),
      );
    });

    it('returns LLMResponse when includeMetadata is set', async () => {
      (openRouterClient.chatCompletion as jest.Mock).mockResolvedValue({
        content: 'With metadata',
        model: 'gpt-4o',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        cost: 0.0001,
        requestId: 'req-3',
      });

      const result = await service.generateResponse('system', 'user', {
        executionContext: mockExecutionContext,
        includeMetadata: true,
      });

      expect(typeof result).toBe('object');
      const response = result as unknown as {
        content: string;
        metadata: { provider: string };
      };
      expect(response.content).toBe('With metadata');
      expect(response.metadata).toBeDefined();
      expect(response.metadata.provider).toBe('openai');
    });

    it('records usage in llm_usage table', async () => {
      (openRouterClient.chatCompletion as jest.Mock).mockResolvedValue({
        content: 'Hello',
        model: 'gpt-4o',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        cost: 0.0001,
        requestId: 'req-4',
      });

      await service.generateResponse('system', 'user', {
        executionContext: mockExecutionContext,
      });

      expect(mockDb.from).toHaveBeenCalledWith(null, 'llm_usage');
      expect(mockDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o',
          input_tokens: 10,
          output_tokens: 5,
          status: 'completed',
        }),
      );
    });

    it('normalizes model aliases (dash to dot) for OpenRouter', async () => {
      const claudeContext = {
        ...mockExecutionContext,
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      };

      (openRouterClient.chatCompletion as jest.Mock).mockResolvedValue({
        content: 'Claude response',
        model: 'claude-sonnet-4.6',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        cost: 0.002,
        requestId: 'req-alias',
      });

      const result = await service.generateResponse(
        'You are helpful',
        'Hello',
        { executionContext: claudeContext },
      );

      expect(result).toBe('Claude response');
      // Should normalize claude-sonnet-4-6 → claude-sonnet-4.6
      expect(openRouterClient.chatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'anthropic/claude-sonnet-4.6' }),
      );
    });

    it('propagates errors from client', async () => {
      (openRouterClient.chatCompletion as jest.Mock).mockRejectedValue(
        new Error('API error'),
      );

      await expect(
        service.generateResponse('system', 'user', {
          executionContext: mockExecutionContext,
        }),
      ).rejects.toThrow('API error');
    });
  });

  describe('generateUnifiedResponse', () => {
    it('delegates to generateResponse', async () => {
      (openRouterClient.chatCompletion as jest.Mock).mockResolvedValue({
        content: 'Unified response',
        model: 'gpt-4o',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        cost: 0.0001,
        requestId: 'req-5',
      });

      const result = await service.generateUnifiedResponse({
        provider: 'openai',
        model: 'gpt-4o',
        systemPrompt: 'system',
        userMessage: 'user',
        options: { executionContext: mockExecutionContext },
      });

      expect(result).toBe('Unified response');
    });
  });

  describe('generateVideo', () => {
    it('throws unsupported error', async () => {
      await expect(
        service.generateVideo({
          provider: 'openai',
          model: 'sora',
          prompt: 'A sunset',
          executionContext: mockExecutionContext,
        }),
      ).rejects.toThrow(
        'Video generation is not supported in simplified LLM mode',
      );
    });
  });

  describe('pollVideoStatus', () => {
    it('throws unsupported error', async () => {
      await expect(
        service.pollVideoStatus({
          provider: 'openai',
          operationId: 'op-1',
          executionContext: mockExecutionContext,
        }),
      ).rejects.toThrow(
        'Video status polling is not supported in simplified LLM mode',
      );
    });
  });
});
