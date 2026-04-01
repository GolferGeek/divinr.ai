import { Test, TestingModule } from '@nestjs/testing';
import { VertexAILLMService } from '../vertex-ai-llm.service';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { DATABASE_SERVICE } from '@/database';
import { ExecutionContext } from '@orchestrator-ai/transport-types';

// The @google-cloud/vertexai module is mocked via
// apps/api/src/__mocks__/@google-cloud/vertexai.js
// It maps to a stub via moduleNameMapper in jest.config.js.
jest.mock('@google-cloud/vertexai');

const mockExecutionContext: ExecutionContext = {
  orgSlug: 'test-org',
  userId: 'user-1',
  conversationId: 'conv-1',
  agentSlug: 'test-agent',
  agentType: 'context',
  provider: 'google',
  model: 'gemini-1.5-pro',
};

describe('VertexAILLMService', () => {
  let service: VertexAILLMService;
  let mockDb: Record<string, jest.Mock>;

  beforeEach(async () => {
    process.env.GCP_PROJECT_ID = 'test-project';
    process.env.GCP_REGION = 'us-central1';

    mockDb = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VertexAILLMService,
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

    service = module.get<VertexAILLMService>(VertexAILLMService);
  });

  afterEach(() => {
    delete process.env.GCP_PROJECT_ID;
    delete process.env.GCP_REGION;
    jest.clearAllMocks();
  });

  describe('generateResponse', () => {
    it('throws without ExecutionContext', async () => {
      await expect(service.generateResponse('system', 'user')).rejects.toThrow(
        'ExecutionContext is required',
      );
    });

    it('calls Vertex AI and returns content', async () => {
      const result = await service.generateResponse(
        'You are helpful',
        'Hello',
        { executionContext: mockExecutionContext },
      );

      expect(result).toBe('Vertex AI response');
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
      expect(response.content).toBe('Vertex AI response');
      expect(response.metadata).toBeDefined();
      expect(response.metadata.provider).toBe('google');
    });

    it('records usage in llm_usage table', async () => {
      await service.generateResponse('system', 'user', {
        executionContext: mockExecutionContext,
      });

      expect(mockDb.from).toHaveBeenCalledWith(null, 'llm_usage');
      expect(mockDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          model: 'gemini-1.5-pro',
          input_tokens: 12,
          output_tokens: 8,
          status: 'completed',
        }),
      );
    });

    it('throws when GCP_PROJECT_ID is missing', async () => {
      delete process.env.GCP_PROJECT_ID;
      // @ts-expect-error accessing private for test
      service.vertexAI = null;

      await expect(
        service.generateResponse('system', 'user', {
          executionContext: mockExecutionContext,
        }),
      ).rejects.toThrow('GCP_PROJECT_ID is required');
    });
  });

  describe('generateUnifiedResponse', () => {
    it('delegates to generateResponse', async () => {
      const result = await service.generateUnifiedResponse({
        provider: 'google',
        model: 'gemini-1.5-pro',
        systemPrompt: 'system',
        userMessage: 'user',
        options: { executionContext: mockExecutionContext },
      });

      expect(result).toBe('Vertex AI response');
    });
  });

  describe('generateImage', () => {
    it('calls Imagen and returns ImageGenerationResponse', async () => {
      const result = await service.generateImage({
        provider: 'google',
        model: 'imagen-3.0-generate-001',
        prompt: 'A beautiful sunset',
        numberOfImages: 1,
        executionContext: mockExecutionContext,
      });

      expect(result).toBeDefined();
      expect(result.images).toHaveLength(1);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.provider).toBe('vertex_ai');
    });
  });

  describe('generateVideo', () => {
    it('throws not supported error', async () => {
      await expect(
        service.generateVideo({
          provider: 'google',
          model: 'video-model',
          prompt: 'A sunset',
          executionContext: mockExecutionContext,
        }),
      ).rejects.toThrow('Video generation is not supported via Vertex AI');
    });
  });

  describe('pollVideoStatus', () => {
    it('throws not supported error', async () => {
      await expect(
        service.pollVideoStatus({
          provider: 'google',
          operationId: 'op-1',
          executionContext: mockExecutionContext,
        }),
      ).rejects.toThrow('Video status polling is not supported via Vertex AI');
    });
  });
});
