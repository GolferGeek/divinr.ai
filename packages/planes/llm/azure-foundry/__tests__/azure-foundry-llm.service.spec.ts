import { Test, TestingModule } from '@nestjs/testing';
import { AzureFoundryLLMService } from '../azure-foundry-llm.service';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { DATABASE_SERVICE } from '@/database';
import { ExecutionContext } from '@orchestrator-ai/transport-types';

// The @azure-rest/ai-inference and @azure/core-auth modules are mocked via
// apps/api/src/__mocks__/@azure-rest/ai-inference.js and @azure/core-auth.js
// They map to stubs via moduleNameMapper in jest.config.js.
jest.mock('@azure-rest/ai-inference');
jest.mock('@azure/core-auth');

const mockExecutionContext: ExecutionContext = {
  orgSlug: 'test-org',
  userId: 'user-1',
  conversationId: 'conv-1',
  agentSlug: 'test-agent',
  agentType: 'context',
  provider: 'azure',
  model: 'gpt-4o',
};

describe('AzureFoundryLLMService', () => {
  let service: AzureFoundryLLMService;
  let mockDb: Record<string, jest.Mock>;

  beforeEach(async () => {
    process.env.AZURE_AI_FOUNDRY_ENDPOINT = 'https://test.azure.com';
    process.env.AZURE_AI_FOUNDRY_KEY = 'test-key';

    mockDb = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AzureFoundryLLMService,
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

    service = module.get<AzureFoundryLLMService>(AzureFoundryLLMService);
  });

  afterEach(() => {
    delete process.env.AZURE_AI_FOUNDRY_ENDPOINT;
    delete process.env.AZURE_AI_FOUNDRY_KEY;
    jest.clearAllMocks();
  });

  describe('generateResponse', () => {
    it('throws without ExecutionContext', async () => {
      await expect(service.generateResponse('system', 'user')).rejects.toThrow(
        'ExecutionContext is required',
      );
    });

    it('calls Azure AI Foundry and returns content', async () => {
      const result = await service.generateResponse(
        'You are helpful',
        'Hello',
        { executionContext: mockExecutionContext },
      );

      expect(result).toBe('Azure response');
    });

    it('returns LLMResponse when includeMetadata is set', async () => {
      const result = await service.generateResponse('system', 'user', {
        executionContext: mockExecutionContext,
        includeMetadata: true,
      });

      expect(typeof result).toBe('object');
      const response = result as unknown as {
        content: string;
        metadata: { provider: string };
      };
      expect(response.content).toBe('Azure response');
      expect(response.metadata).toBeDefined();
      expect(response.metadata.provider).toBe('azure');
    });

    it('records usage in llm_usage table', async () => {
      await service.generateResponse('system', 'user', {
        executionContext: mockExecutionContext,
      });

      expect(mockDb.from).toHaveBeenCalledWith(null, 'llm_usage');
      expect(mockDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'azure',
          model: 'gpt-4o',
          input_tokens: 10,
          output_tokens: 5,
          status: 'completed',
        }),
      );
    });

    it('throws when AZURE_AI_FOUNDRY_ENDPOINT is missing', async () => {
      delete process.env.AZURE_AI_FOUNDRY_ENDPOINT;
      // Force re-initialization by clearing the cached client
      // @ts-expect-error accessing private for test
      service.client = null;

      await expect(
        service.generateResponse('system', 'user', {
          executionContext: mockExecutionContext,
        }),
      ).rejects.toThrow('AZURE_AI_FOUNDRY_ENDPOINT is required');
    });

    it('throws when AZURE_AI_FOUNDRY_KEY is missing', async () => {
      delete process.env.AZURE_AI_FOUNDRY_KEY;
      // @ts-expect-error accessing private for test
      service.client = null;

      await expect(
        service.generateResponse('system', 'user', {
          executionContext: mockExecutionContext,
        }),
      ).rejects.toThrow('AZURE_AI_FOUNDRY_KEY is required');
    });
  });

  describe('generateUnifiedResponse', () => {
    it('delegates to generateResponse', async () => {
      const result = await service.generateUnifiedResponse({
        provider: 'azure',
        model: 'gpt-4o',
        systemPrompt: 'system',
        userMessage: 'user',
        options: { executionContext: mockExecutionContext },
      });

      expect(result).toBe('Azure response');
    });
  });

  describe('generateImage', () => {
    it('throws not supported error', async () => {
      await expect(
        service.generateImage({
          provider: 'azure',
          model: 'dall-e-3',
          prompt: 'A sunset',
          executionContext: mockExecutionContext,
        }),
      ).rejects.toThrow(
        'Image generation is not supported via Azure AI Foundry',
      );
    });
  });

  describe('generateVideo', () => {
    it('throws not supported error', async () => {
      await expect(
        service.generateVideo({
          provider: 'azure',
          model: 'sora',
          prompt: 'A sunset',
          executionContext: mockExecutionContext,
        }),
      ).rejects.toThrow(
        'Video generation is not supported via Azure AI Foundry',
      );
    });
  });

  describe('pollVideoStatus', () => {
    it('throws not supported error', async () => {
      await expect(
        service.pollVideoStatus({
          provider: 'azure',
          operationId: 'op-1',
          executionContext: mockExecutionContext,
        }),
      ).rejects.toThrow(
        'Video status polling is not supported via Azure AI Foundry',
      );
    });
  });
});
