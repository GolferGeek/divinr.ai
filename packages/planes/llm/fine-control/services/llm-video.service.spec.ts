import { Test, TestingModule } from '@nestjs/testing';
import { LLMVideoService } from './llm-video.service';
import { LLMServiceFactory } from './llm-service-factory';
import { ExecutionContext } from '@orchestrator-ai/transport-types';

describe('LLMVideoService', () => {
  let service: LLMVideoService;
  let llmServiceFactory: jest.Mocked<LLMServiceFactory>;

  const mockExecutionContext: ExecutionContext = {
    userId: 'user-123',
    conversationId: 'conv-123',
    agentSlug: 'test-agent',
    agentType: 'api',
    provider: 'openai',
    model: 'sora-2',
  };

  const mockVideoResponse = {
    operationId: 'op-123',
    status: 'processing' as const,
    metadata: {
      provider: 'openai',
      model: 'sora-2',
      requestId: 'req-123',
      timestamp: new Date().toISOString(),
      usage: {
        inputTokens: 20,
        outputTokens: 0,
        totalTokens: 20,
        cost: 0.5,
      },
      timing: {
        startTime: Date.now(),
        endTime: Date.now() + 30000,
        duration: 30000,
      },
      status: 'completed' as const,
    },
  };

  const mockCompletedVideoResponse = {
    ...mockVideoResponse,
    status: 'completed' as const,
    videoData: Buffer.from('fake-video-data'),
    videoUrl: 'https://example.com/video.mp4',
    videoMetadata: {
      width: 1920,
      height: 1080,
      durationSeconds: 8,
      frameRate: 30,
      mimeType: 'video/mp4',
      sizeBytes: 10240,
      hasAudio: true,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LLMVideoService,
        {
          provide: LLMServiceFactory,
          useValue: {
            createService: jest.fn().mockResolvedValue({
              generateVideo: jest.fn().mockResolvedValue(mockVideoResponse),
              pollVideoStatus: jest
                .fn()
                .mockResolvedValue(mockCompletedVideoResponse),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LLMVideoService>(LLMVideoService);
    llmServiceFactory = module.get(LLMServiceFactory);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateVideo', () => {
    it('should require ExecutionContext', async () => {
      await expect(
        service.generateVideo(null as any, { prompt: 'test' }),
      ).rejects.toThrow('ExecutionContext is required');
    });

    it('should require provider and model in ExecutionContext', async () => {
      const invalidContext = { ...mockExecutionContext, provider: null };
      await expect(
        service.generateVideo(invalidContext as any, { prompt: 'test' }),
      ).rejects.toThrow('ExecutionContext must contain provider and model');
    });

    it('should validate provider supports video generation', async () => {
      const invalidContext = {
        ...mockExecutionContext,
        provider: 'anthropic',
      };

      await expect(
        service.generateVideo(invalidContext, {
          prompt: 'test',
        }),
      ).rejects.toThrow('Video generation not supported for provider');
    });

    it('should generate video with valid parameters', async () => {
      const result = await service.generateVideo(mockExecutionContext, {
        prompt: 'A cat walking through a garden',
        duration: 8,
        aspectRatio: '16:9',
        resolution: '1080p',
      });

      expect(result.status).toBe('processing');
      expect(result.operationId).toBe('op-123');
      expect(llmServiceFactory.createService).toHaveBeenCalledWith({
        provider: 'openai',
        model: 'sora-2',
      });
    });

    it('should handle service errors gracefully', async () => {
      llmServiceFactory.createService.mockResolvedValueOnce({
        generateVideo: jest.fn().mockRejectedValue(new Error('Service error')),
      } as any);

      const result = await service.generateVideo(mockExecutionContext, {
        prompt: 'test',
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Service error');
      expect(result.status).toBe('failed');
    });

    it('should support different aspect ratios', async () => {
      const aspectRatios: Array<'16:9' | '9:16'> = ['16:9', '9:16'];

      for (const aspectRatio of aspectRatios) {
        const mockService = {
          generateVideo: jest.fn().mockResolvedValue(mockVideoResponse),
        };
        llmServiceFactory.createService.mockResolvedValueOnce(
          mockService as any,
        );

        await service.generateVideo(mockExecutionContext, {
          prompt: 'test',
          aspectRatio,
        });

        expect(mockService.generateVideo).toHaveBeenCalledWith(
          mockExecutionContext,
          expect.objectContaining({ aspectRatio }),
        );
      }
    });

    it('should support different resolutions', async () => {
      const resolutions: Array<'720p' | '1080p' | '4k'> = [
        '720p',
        '1080p',
        '4k',
      ];

      for (const resolution of resolutions) {
        const mockService = {
          generateVideo: jest.fn().mockResolvedValue(mockVideoResponse),
        };
        llmServiceFactory.createService.mockResolvedValueOnce(
          mockService as any,
        );

        await service.generateVideo(mockExecutionContext, {
          prompt: 'test',
          resolution,
        });

        expect(mockService.generateVideo).toHaveBeenCalledWith(
          mockExecutionContext,
          expect.objectContaining({ resolution }),
        );
      }
    });

    it('should support audio generation', async () => {
      const mockService = {
        generateVideo: jest.fn().mockResolvedValue(mockVideoResponse),
      };
      llmServiceFactory.createService.mockResolvedValueOnce(mockService as any);

      await service.generateVideo(mockExecutionContext, {
        prompt: 'test',
        generateAudio: true,
      });

      expect(mockService.generateVideo).toHaveBeenCalledWith(
        mockExecutionContext,
        expect.objectContaining({ generateAudio: true }),
      );
    });
  });

  describe('pollVideoStatus', () => {
    it('should require ExecutionContext', async () => {
      await expect(
        service.pollVideoStatus(null as any, 'op-123'),
      ).rejects.toThrow('ExecutionContext is required');
    });

    it('should poll video status with operation ID', async () => {
      const result = await service.pollVideoStatus(
        mockExecutionContext,
        'op-123',
      );

      expect(result.status).toBe('completed');
      expect(result.videoData).toBeDefined();
      expect(result.videoUrl).toBe('https://example.com/video.mp4');
    });

    it('should handle polling errors gracefully', async () => {
      llmServiceFactory.createService.mockResolvedValueOnce({
        pollVideoStatus: jest
          .fn()
          .mockRejectedValue(new Error('Polling error')),
      } as any);

      const result = await service.pollVideoStatus(
        mockExecutionContext,
        'op-123',
      );

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('VIDEO_POLL_FAILED');
      expect(result.status).toBe('failed');
    });

    it('should use default model if not provided', async () => {
      const contextWithoutModel = { ...mockExecutionContext, model: '' };
      await service.pollVideoStatus(contextWithoutModel, 'op-123');

      expect(llmServiceFactory.createService).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'sora-2', // Default for OpenAI
        }),
      );
    });
  });

  describe('generateVideoFromImage', () => {
    it('should require ExecutionContext', async () => {
      await expect(
        service.generateVideoFromImage(null as any, {
          prompt: 'test',
          firstFrameImage: Buffer.from('test'),
        }),
      ).rejects.toThrow('ExecutionContext is required');
    });

    it('should generate video from image', async () => {
      const mockService = {
        generateVideo: jest.fn().mockResolvedValue(mockVideoResponse),
      };
      llmServiceFactory.createService.mockResolvedValueOnce(mockService as any);

      const result = await service.generateVideoFromImage(
        mockExecutionContext,
        {
          prompt: 'Make the scene come alive',
          firstFrameImage: Buffer.from('image-data'),
          duration: 8,
        },
      );

      expect(result.status).toBe('processing');
      expect(mockService.generateVideo).toHaveBeenCalledWith(
        mockExecutionContext,
        expect.objectContaining({
          prompt: 'Make the scene come alive',
          firstFrameImage: expect.any(Buffer),
          duration: 8,
        }),
      );
    });
  });

  describe('extendVideo', () => {
    it('should require ExecutionContext', async () => {
      await expect(
        service.extendVideo(null as any, {
          prompt: 'test',
          videoUrl: 'https://example.com/video.mp4',
        }),
      ).rejects.toThrow('ExecutionContext is required');
    });

    it('should extend existing video', async () => {
      const mockService = {
        generateVideo: jest.fn().mockResolvedValue(mockVideoResponse),
      };
      llmServiceFactory.createService.mockResolvedValueOnce(mockService as any);

      const result = await service.extendVideo(mockExecutionContext, {
        prompt: 'Continue the scene',
        videoUrl: 'https://example.com/video.mp4',
        duration: 8,
      });

      expect(result.status).toBe('processing');
      expect(mockService.generateVideo).toHaveBeenCalledWith(
        mockExecutionContext,
        expect.objectContaining({
          prompt: 'Continue the scene',
          extendVideoUrl: 'https://example.com/video.mp4',
          duration: 8,
        }),
      );
    });

    it('should handle extension errors gracefully', async () => {
      llmServiceFactory.createService.mockResolvedValueOnce({
        generateVideo: jest
          .fn()
          .mockRejectedValue(new Error('Extension error')),
      } as any);

      const result = await service.extendVideo(mockExecutionContext, {
        prompt: 'test',
        videoUrl: 'https://example.com/video.mp4',
      });

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('VIDEO_EXTENSION_FAILED');
    });
  });

  describe('capability checks', () => {
    it('should check if provider supports video generation', () => {
      expect(service.supportsVideoGeneration(mockExecutionContext)).toBe(true);

      const anthropicContext = {
        ...mockExecutionContext,
        provider: 'anthropic',
      };
      expect(service.supportsVideoGeneration(anthropicContext)).toBe(false);

      const googleContext = { ...mockExecutionContext, provider: 'google' };
      expect(service.supportsVideoGeneration(googleContext)).toBe(true);
    });

    it('should check if provider supports image-to-video', () => {
      expect(service.supportsImageToVideo(mockExecutionContext)).toBe(true);

      const googleContext = { ...mockExecutionContext, provider: 'google' };
      expect(service.supportsImageToVideo(googleContext)).toBe(true);
    });

    it('should check if provider supports video extension', () => {
      expect(service.supportsVideoExtension(mockExecutionContext)).toBe(true);

      const googleContext = { ...mockExecutionContext, provider: 'google' };
      expect(service.supportsVideoExtension(googleContext)).toBe(false);
    });

    it('should check if provider supports audio generation', () => {
      expect(service.supportsAudioGeneration(mockExecutionContext)).toBe(true);

      const googleContext = { ...mockExecutionContext, provider: 'google' };
      expect(service.supportsAudioGeneration(googleContext)).toBe(false);
    });

    it('should handle null ExecutionContext in capability checks', () => {
      expect(service.supportsVideoGeneration(null as any)).toBe(false);
      expect(service.supportsImageToVideo(null as any)).toBe(false);
      expect(service.supportsVideoExtension(null as any)).toBe(false);
      expect(service.supportsAudioGeneration(null as any)).toBe(false);
    });
  });
});
