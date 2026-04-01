import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import {
  ExecutionContext,
  createMockExecutionContext,
} from '@orchestrator-ai/transport-types';
import { LLMService } from '../llm.service';
import { LLMGenerationService } from '../services/llm-generation.service';
import { LLMImageService } from '../services/llm-image.service';
import { LLMVideoService } from '../services/llm-video.service';
import { ModelConfigurationService } from '../config/model-configuration.service';
import { ObservabilityWebhookService, ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { LLMResponse } from '../services/llm-interfaces';
import { ModelsService } from '../models/models.service';
import { ProvidersService } from '../providers/providers.service';

describe('LLMService', () => {
  let service: LLMService;
  let llmGenerationService: jest.Mocked<LLMGenerationService>;
  let llmImageService: jest.Mocked<LLMImageService>;
  let llmVideoService: jest.Mocked<LLMVideoService>;
  let observabilityEventsService: jest.Mocked<ObservabilityEventsService>;

  const mockExecutionContext: ExecutionContext = createMockExecutionContext({
    orgSlug: 'test-org',
    userId: 'user-123',
    conversationId: 'conv-123',
    provider: 'openai',
    model: 'gpt-4',
  });

  const mockLLMResponse: LLMResponse = {
    content: 'Test response',
    metadata: {
      provider: 'openai',
      model: 'gpt-4',
      requestId: 'req-123',
      timestamp: new Date().toISOString(),
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cost: 0.001,
      },
      timing: {
        startTime: Date.now() - 100,
        endTime: Date.now(),
        duration: 100,
      },
      status: 'completed',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LLMService,
        {
          provide: LLMGenerationService,
          useValue: {
            generateResponse: jest.fn().mockResolvedValue(mockLLMResponse),
            generateUnifiedResponse: jest
              .fn()
              .mockResolvedValue(mockLLMResponse),
          },
        },
        {
          provide: LLMImageService,
          useValue: {
            generateImage: jest.fn().mockResolvedValue({
              images: [{ data: Buffer.from('test'), mimeType: 'image/png' }],
              metadata: {
                provider: 'openai',
                model: 'dall-e-3',
                requestId: 'req-img-123',
                timestamp: new Date().toISOString(),
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                timing: { startTime: 0, endTime: 100, duration: 100 },
                status: 'completed',
              },
            }),
          },
        },
        {
          provide: LLMVideoService,
          useValue: {
            generateVideo: jest.fn().mockResolvedValue({
              operationId: 'op-123',
              status: 'processing',
              metadata: {
                provider: 'openai',
                model: 'sora',
                requestId: 'req-vid-123',
                timestamp: new Date().toISOString(),
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                timing: { startTime: 0, endTime: 100, duration: 100 },
                status: 'started',
              },
            }),
            pollVideoStatus: jest.fn().mockResolvedValue({
              operationId: 'op-123',
              status: 'completed',
              videoData: Buffer.from('video'),
              metadata: {
                provider: 'openai',
                model: 'sora',
                requestId: 'req-vid-123',
                timestamp: new Date().toISOString(),
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                timing: { startTime: 0, endTime: 100, duration: 100 },
                status: 'completed',
              },
            }),
          },
        },
        {
          provide: ModelConfigurationService,
          useValue: {
            getModelConfig: jest.fn().mockReturnValue({
              provider: 'openai',
              model: 'gpt-4',
            }),
          },
        },
        {
          provide: ObservabilityWebhookService,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: ObservabilityEventsService,
          useValue: {
            push: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ModelsService,
          useValue: {
            findAll: jest.fn().mockResolvedValue([]),
            findAllNames: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ProvidersService,
          useValue: {
            findAll: jest.fn().mockResolvedValue([]),
            findAllNames: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    module.useLogger(false);

    service = module.get<LLMService>(LLMService);
    llmGenerationService = module.get(LLMGenerationService);
    llmImageService = module.get(LLMImageService);
    llmVideoService = module.get(LLMVideoService);
    observabilityEventsService = module.get(ObservabilityEventsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateResponse', () => {
    it('should delegate to LLMGenerationService', async () => {
      const result = await service.generateResponse(
        'You are helpful',
        'Hello',
        { executionContext: mockExecutionContext },
      );

      expect(llmGenerationService.generateResponse).toHaveBeenCalledWith(
        mockExecutionContext,
        'You are helpful',
        'Hello',
        { executionContext: mockExecutionContext },
      );
      expect(result).toEqual(mockLLMResponse);
    });

    it('should throw error when ExecutionContext is missing', async () => {
      await expect(
        service.generateResponse('You are helpful', 'Hello'),
      ).rejects.toThrow('ExecutionContext is required');
    });

    it('should emit observability events for started and completed', async () => {
      await service.generateResponse('You are helpful', 'Hello', {
        executionContext: mockExecutionContext,
      });

      // Check started event
      expect(observabilityEventsService.push).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_type: 'agent.llm.started',
          context: mockExecutionContext,
        }),
      );

      // Check completed event
      expect(observabilityEventsService.push).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_type: 'agent.llm.completed',
          context: mockExecutionContext,
        }),
      );
    });

    it('should emit failed event on error', async () => {
      llmGenerationService.generateResponse.mockRejectedValue(
        new Error('LLM error'),
      );

      await expect(
        service.generateResponse('You are helpful', 'Hello', {
          executionContext: mockExecutionContext,
        }),
      ).rejects.toThrow('LLM error');

      expect(observabilityEventsService.push).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_type: 'agent.llm.failed',
        }),
      );
    });
  });

  describe('generateUnifiedResponse', () => {
    it('should delegate to LLMGenerationService', async () => {
      const params = {
        provider: 'openai',
        model: 'gpt-4',
        systemPrompt: 'You are helpful',
        userMessage: 'Hello',
        options: { executionContext: mockExecutionContext },
      };

      const result = await service.generateUnifiedResponse(params);

      expect(llmGenerationService.generateUnifiedResponse).toHaveBeenCalledWith(
        mockExecutionContext,
        params,
      );
      expect(result).toEqual(mockLLMResponse);
    });

    it('should throw error when ExecutionContext is missing', async () => {
      await expect(
        service.generateUnifiedResponse({
          provider: 'openai',
          model: 'gpt-4',
          systemPrompt: 'System',
          userMessage: 'User',
        }),
      ).rejects.toThrow('ExecutionContext is required');
    });
  });

  describe('generateImage', () => {
    it('should delegate to LLMImageService', async () => {
      const params = {
        provider: 'openai',
        model: 'dall-e-3',
        prompt: 'A beautiful sunset',
        size: '1024x1024' as const,
        executionContext: mockExecutionContext,
      };

      const result = await service.generateImage(params);

      expect(llmImageService.generateImage).toHaveBeenCalledWith(
        mockExecutionContext,
        expect.objectContaining({
          prompt: 'A beautiful sunset',
          size: '1024x1024',
        }),
      );
      expect(result.images).toHaveLength(1);
    });

    it('should emit observability events for image generation', async () => {
      await service.generateImage({
        provider: 'openai',
        model: 'dall-e-3',
        prompt: 'A sunset',
        executionContext: mockExecutionContext,
      });

      expect(observabilityEventsService.push).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_type: 'agent.llm.started',
          payload: expect.objectContaining({
            type: 'image-generation',
          }),
        }),
      );
    });

    it('should emit failed event on image generation error', async () => {
      llmImageService.generateImage.mockRejectedValue(
        new Error('Image generation failed'),
      );

      await expect(
        service.generateImage({
          provider: 'openai',
          model: 'dall-e-3',
          prompt: 'A sunset',
          executionContext: mockExecutionContext,
        }),
      ).rejects.toThrow('Image generation failed');

      expect(observabilityEventsService.push).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_type: 'agent.llm.failed',
        }),
      );
    });
  });

  describe('generateVideo', () => {
    it('should delegate to LLMVideoService', async () => {
      const params = {
        provider: 'openai',
        model: 'sora',
        prompt: 'A cat playing',
        duration: 5,
        executionContext: mockExecutionContext,
      };

      const result = await service.generateVideo(params);

      expect(llmVideoService.generateVideo).toHaveBeenCalledWith(
        mockExecutionContext,
        expect.objectContaining({
          prompt: 'A cat playing',
          duration: 5,
        }),
      );
      expect(result.status).toBe('processing');
      expect(result.operationId).toBe('op-123');
    });

    it('should emit observability events for video generation', async () => {
      await service.generateVideo({
        provider: 'openai',
        model: 'sora',
        prompt: 'A video',
        executionContext: mockExecutionContext,
      });

      expect(observabilityEventsService.push).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_type: 'agent.llm.started',
          payload: expect.objectContaining({
            type: 'video-generation',
          }),
        }),
      );

      expect(observabilityEventsService.push).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_type: 'agent.llm.processing',
        }),
      );
    });
  });

  describe('pollVideoStatus', () => {
    it('should delegate to LLMVideoService', async () => {
      const params = {
        provider: 'openai',
        model: 'sora',
        operationId: 'op-123',
        executionContext: mockExecutionContext,
      };

      const result = await service.pollVideoStatus(params);

      expect(llmVideoService.pollVideoStatus).toHaveBeenCalledWith(
        mockExecutionContext,
        'op-123',
      );
      expect(result.status).toBe('completed');
    });

    it('should emit completed event when video is done', async () => {
      await service.pollVideoStatus({
        provider: 'openai',
        operationId: 'op-123',
        executionContext: mockExecutionContext,
      });

      expect(observabilityEventsService.push).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_type: 'agent.llm.completed',
          payload: expect.objectContaining({
            type: 'video-generation',
          }),
        }),
      );
    });

    it('should emit failed event when video generation fails', async () => {
      llmVideoService.pollVideoStatus.mockResolvedValue({
        operationId: 'op-123',
        status: 'failed',
        error: { code: 'ERROR', message: 'Video failed' },
        metadata: {
          provider: 'openai',
          model: 'sora',
          requestId: 'req-vid-123',
          timestamp: new Date().toISOString(),
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          timing: { startTime: 0, endTime: 100, duration: 100 },
          status: 'error',
        },
      });

      await service.pollVideoStatus({
        provider: 'openai',
        operationId: 'op-123',
        executionContext: mockExecutionContext,
      });

      expect(observabilityEventsService.push).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_type: 'agent.llm.failed',
        }),
      );
    });
  });

  describe('emitLlmObservabilityEvent', () => {
    it('should push event to observability service', () => {
      service.emitLlmObservabilityEvent(
        'agent.llm.custom',
        mockExecutionContext,
        { custom: 'data' },
      );

      expect(observabilityEventsService.push).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_type: 'agent.llm.custom',
          context: mockExecutionContext,
          payload: expect.objectContaining({ custom: 'data' }),
        }),
      );
    });

    it('should not throw when observability service fails', () => {
      observabilityEventsService.push.mockImplementation(() => {
        throw new Error('Push failed');
      });

      // Should not throw
      expect(() =>
        service.emitLlmObservabilityEvent(
          'agent.llm.test',
          mockExecutionContext,
        ),
      ).not.toThrow();
    });
  });

  describe('Sovereign Mode Enforcement', () => {
    it('should throw ForbiddenException when sovereignMode=true and provider is not ollama in generateResponse', async () => {
      const sovereignContext = createMockExecutionContext({
        provider: 'openai',
        model: 'gpt-4',
        sovereignMode: true,
      });

      await expect(
        service.generateResponse('System prompt', 'User message', {
          executionContext: sovereignContext,
        }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.generateResponse('System prompt', 'User message', {
          executionContext: sovereignContext,
        }),
      ).rejects.toThrow('Sovereign mode is active');
    });

    it('should allow execution when sovereignMode=true and provider is ollama in generateResponse', async () => {
      const sovereignContext = createMockExecutionContext({
        provider: 'ollama',
        model: 'llama3.2:1b',
        sovereignMode: true,
      });

      const result = await service.generateResponse(
        'System prompt',
        'User message',
        { executionContext: sovereignContext },
      );

      expect(result).toEqual(mockLLMResponse);
    });

    it('should allow any provider when sovereignMode=false in generateResponse', async () => {
      const context = createMockExecutionContext({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        sovereignMode: false,
      });

      const result = await service.generateResponse(
        'System prompt',
        'User message',
        { executionContext: context },
      );

      expect(result).toEqual(mockLLMResponse);
    });

    it('should allow any provider when sovereignMode is undefined', async () => {
      const context = createMockExecutionContext({
        provider: 'google',
        model: 'gemini-pro',
        // sovereignMode not set (undefined)
      });

      const result = await service.generateResponse(
        'System prompt',
        'User message',
        { executionContext: context },
      );

      expect(result).toEqual(mockLLMResponse);
    });

    it('should throw ForbiddenException when sovereignMode=true in generateUnifiedResponse', async () => {
      const sovereignContext = createMockExecutionContext({
        provider: 'openai',
        model: 'gpt-4',
        sovereignMode: true,
      });

      await expect(
        service.generateUnifiedResponse({
          provider: 'openai',
          model: 'gpt-4',
          systemPrompt: 'System',
          userMessage: 'User',
          options: { executionContext: sovereignContext },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow ollama provider in generateUnifiedResponse with sovereignMode=true', async () => {
      const sovereignContext = createMockExecutionContext({
        provider: 'ollama',
        model: 'llama3.2:1b',
        sovereignMode: true,
      });

      const result = await service.generateUnifiedResponse({
        provider: 'ollama',
        model: 'llama3.2:1b',
        systemPrompt: 'System',
        userMessage: 'User',
        options: { executionContext: sovereignContext },
      });

      expect(result).toEqual(mockLLMResponse);
    });
  });
});
