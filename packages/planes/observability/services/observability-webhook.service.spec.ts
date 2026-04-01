import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { ObservabilityWebhookService } from './observability-webhook.service';
import { AUTH_SERVICE } from '../../auth/interfaces/auth-service.interface';
import { createMockExecutionContext } from '@orchestrator-ai/transport-types';

describe('ObservabilityWebhookService', () => {
  let service: ObservabilityWebhookService;
  let httpService: jest.Mocked<HttpService>;

  let authService: any;

  const mockContext = createMockExecutionContext({
    orgSlug: 'test-org',
    userId: 'user-123',
    conversationId: 'conv-123',
    agentSlug: 'test-agent',
  });

  const mockConfigValues: Record<string, string> = {
    API_PORT: '8080',
    API_HOST: 'test-api-host',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObservabilityWebhookService,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
          },
        },
        {
          provide: AUTH_SERVICE,
          useValue: {
            getUserProfile: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => mockConfigValues[key]),
          },
        },
      ],
    }).compile();

    service = module.get<ObservabilityWebhookService>(
      ObservabilityWebhookService,
    );
    httpService = module.get(HttpService);
    authService = module.get(AUTH_SERVICE);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constructor', () => {
    it('should throw error if API_PORT and OBSERVABILITY_SERVER_URL are missing', () => {
      const emptyConfig = {
        get: jest.fn(() => undefined),
      } as unknown as ConfigService;

      expect(() => {
        new ObservabilityWebhookService(
          httpService,
          authService as never,
          emptyConfig,
        );
      }).toThrow(
        'Either API_PORT or OBSERVABILITY_SERVER_URL environment variable is required',
      );
    });

    it('should use OBSERVABILITY_SERVER_URL if provided', () => {
      const configWithUrl = {
        get: jest.fn((key: string) => {
          if (key === 'OBSERVABILITY_SERVER_URL')
            return 'http://custom-server:8080';
          return undefined;
        }),
      } as unknown as ConfigService;

      const customService = new ObservabilityWebhookService(
        httpService,
        authService,
        configWithUrl,
      );
      expect(customService).toBeDefined();
    });

    it('should use API_PORT to construct URL', () => {
      const configWithPort = {
        get: jest.fn((key: string) => {
          if (key === 'API_PORT') return '9090';
          if (key === 'API_HOST') return 'my-api-host';
          return undefined;
        }),
      } as unknown as ConfigService;

      const customService = new ObservabilityWebhookService(
        httpService,
        authService,
        configWithPort,
      );
      expect(customService).toBeDefined();
    });
  });

  describe('sendEvent', () => {
    it('should send event to observability server', async () => {
      const mockResponse = { data: { success: true } };
      httpService.post.mockReturnValue(of(mockResponse) as any);

      await service.sendEvent({
        source_app: 'orchestrator-ai',
        session_id: 'session-123',
        hook_event_type: 'agent.started',
        userId: 'user-123',
        conversationId: 'conv-123',
        payload: {},
      });

      expect(httpService.post).toHaveBeenCalledWith(
        'http://test-api-host:8080/webhooks/status',
        expect.objectContaining({
          conversationId: 'conv-123',
          status: 'agent.started',
          userId: 'user-123',
        }),
        expect.objectContaining({
          timeout: 2000,
          validateStatus: expect.any(Function),
        }),
      );
    });

    it('should resolve username if userId provided but username missing', async () => {
      const mockResponse = { data: { success: true } };
      httpService.post.mockReturnValue(of(mockResponse) as any);
      authService.getUserProfile.mockResolvedValue({
        id: 'user-123',
        displayName: 'Test User',
        email: 'test@example.com',
        roles: ['user'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.sendEvent({
        source_app: 'orchestrator-ai',
        session_id: 'session-123',
        hook_event_type: 'agent.started',
        userId: 'user-123',
        payload: {},
      });

      expect(authService.getUserProfile).toHaveBeenCalledWith('user-123');
      expect(httpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          username: 'Test User',
        }),
        expect.any(Object),
      );
    });

    it('should use email if displayName not available', async () => {
      const mockResponse = { data: { success: true } };
      httpService.post.mockReturnValue(of(mockResponse) as any);
      authService.getUserProfile.mockResolvedValue({
        id: 'user-123',
        displayName: '',
        email: 'test@example.com',
        roles: ['user'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.sendEvent({
        source_app: 'orchestrator-ai',
        session_id: 'session-123',
        hook_event_type: 'agent.started',
        userId: 'user-123',
        payload: {},
      });

      expect(httpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          username: 'test@example.com',
        }),
        expect.any(Object),
      );
    });

    it('should cache username lookups', async () => {
      const mockResponse = { data: { success: true } };
      httpService.post.mockReturnValue(of(mockResponse) as any);
      authService.getUserProfile.mockResolvedValue({
        id: 'user-123',
        displayName: 'Test User',
        email: 'test@example.com',
        roles: ['user'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // First call
      await service.sendEvent({
        source_app: 'orchestrator-ai',
        session_id: 'session-123',
        hook_event_type: 'agent.started',
        userId: 'user-123',
        payload: {},
      });

      // Second call - should use cache
      await service.sendEvent({
        source_app: 'orchestrator-ai',
        session_id: 'session-456',
        hook_event_type: 'agent.progress',
        userId: 'user-123',
        payload: {},
      });

      // Should only call getUserProfile once
      expect(authService.getUserProfile).toHaveBeenCalledTimes(1);
    });

    it('should add timestamp if not provided', async () => {
      const mockResponse = { data: { success: true } };
      httpService.post.mockReturnValue(of(mockResponse) as any);

      const beforeTimestamp = Date.now();
      await service.sendEvent({
        source_app: 'orchestrator-ai',
        session_id: 'session-123',
        hook_event_type: 'agent.started',
        payload: {},
      });
      const afterTimestamp = Date.now();

      const callArgs = httpService.post.mock.calls[0]?.[1] as any;
      const timestamp = new Date(callArgs.timestamp).getTime();

      expect(timestamp).toBeGreaterThanOrEqual(beforeTimestamp);
      expect(timestamp).toBeLessThanOrEqual(afterTimestamp);
    });

    it('should not throw on HTTP error (non-blocking)', async () => {
      httpService.post.mockReturnValue(
        throwError(() => new Error('Network error')),
      );

      await expect(
        service.sendEvent({
          source_app: 'orchestrator-ai',
          session_id: 'session-123',
          hook_event_type: 'agent.started',
          payload: {},
        }),
      ).resolves.not.toThrow();
    });

    it('should handle getUserProfile failure gracefully', async () => {
      const mockResponse = { data: { success: true } };
      httpService.post.mockReturnValue(of(mockResponse) as any);
      authService.getUserProfile.mockRejectedValue(new Error('Database error'));

      await expect(
        service.sendEvent({
          source_app: 'orchestrator-ai',
          session_id: 'session-123',
          hook_event_type: 'agent.started',
          userId: 'user-123',
          payload: {},
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('convenience methods with ExecutionContext', () => {
    beforeEach(() => {
      const mockResponse = { data: { success: true } };
      httpService.post.mockReturnValue(of(mockResponse) as any);
    });

    describe('emitAgentStartedWithContext', () => {
      it('should emit agent started event with ExecutionContext', async () => {
        await service.emitAgentStartedWithContext(mockContext, {
          mode: 'build',
          payload: { test: 'data' },
        });

        expect(httpService.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            status: 'agent.started',
            userId: 'user-123',
            conversationId: 'conv-123',
            agentSlug: 'test-agent',
            organizationSlug: 'test-org',
            mode: 'build',
          }),
          expect.any(Object),
        );
      });

      it('should handle missing optional fields in ExecutionContext', async () => {
        const minimalContext = createMockExecutionContext({
          orgSlug: 'test-org',
          userId: 'user-123',
          conversationId: undefined as any, // Simulate missing conversationId
          agentSlug: undefined as any, // Simulate missing agentSlug
        });

        await service.emitAgentStartedWithContext(minimalContext, {
          mode: 'converse',
        });

        expect(httpService.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            status: 'agent.started',
            conversationId: 'unknown',
          }),
          expect.any(Object),
        );
      });
    });

    describe('emitAgentCompletedWithContext', () => {
      it('should emit success event', async () => {
        await service.emitAgentCompletedWithContext(mockContext, {
          mode: 'build',
          success: true,
          result: { output: 'test' },
          duration: 1500,
        });

        expect(httpService.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            status: 'agent.completed',
            userId: 'user-123',
            data: expect.objectContaining({
              success: true,
              result: { output: 'test' },
              duration: 1500,
            }),
          }),
          expect.any(Object),
        );
      });

      it('should emit failure event when success is false', async () => {
        await service.emitAgentCompletedWithContext(mockContext, {
          mode: 'plan',
          success: false,
          error: 'Test error',
        });

        expect(httpService.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            status: 'agent.failed',
            data: expect.objectContaining({
              success: false,
              error: 'Test error',
            }),
          }),
          expect.any(Object),
        );
      });
    });

    describe('emitAgentProgressWithContext', () => {
      it('should emit progress event', async () => {
        await service.emitAgentProgressWithContext(mockContext, {
          mode: 'build',
          message: 'Processing step 1',
          progress: 50,
          step: 'validation',
          metadata: { stepId: 'step-1' },
        });

        expect(httpService.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            status: 'agent.progress',
            message: 'Processing step 1',
            step: 'validation',
            data: expect.objectContaining({
              progress: 50,
              step: 'validation',
              stepId: 'step-1',
            }),
          }),
          expect.any(Object),
        );
      });
    });
  });

  describe('legacy convenience methods', () => {
    beforeEach(() => {
      const mockResponse = { data: { success: true } };
      httpService.post.mockReturnValue(of(mockResponse) as any);
    });

    describe('emitAgentStarted', () => {
      it('should emit agent started event', async () => {
        await service.emitAgentStarted({
          userId: 'user-123',
          conversationId: 'conv-123',
          agentSlug: 'test-agent',
          organizationSlug: 'test-org',
          mode: 'build',
        });

        expect(httpService.post).toHaveBeenCalled();
      });
    });

    describe('emitAgentCompleted', () => {
      it('should emit agent completed event', async () => {
        await service.emitAgentCompleted({
          userId: 'user-123',
          conversationId: 'conv-123',
          agentSlug: 'test-agent',
          organizationSlug: 'test-org',
          mode: 'build',
          success: true,
        });

        expect(httpService.post).toHaveBeenCalled();
      });
    });

    describe('emitAgentProgress', () => {
      it('should emit agent progress event', async () => {
        await service.emitAgentProgress({
          userId: 'user-123',
          conversationId: 'conv-123',
          agentSlug: 'test-agent',
          organizationSlug: 'test-org',
          mode: 'build',
          message: 'Processing...',
          progress: 50,
        });

        expect(httpService.post).toHaveBeenCalled();
      });
    });

    describe('emitOrchestrationStep', () => {
      it('should emit orchestration step event', async () => {
        await service.emitOrchestrationStep({
          userId: 'user-123',
          conversationId: 'conv-123',
          orchestrationRunId: 'run-123',
          stepId: 'step-1',
          stepName: 'Validation',
          status: 'completed',
          agentSlug: 'test-agent',
          duration: 1000,
        });

        expect(httpService.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            status: 'orchestration.step.completed',
          }),
          expect.any(Object),
        );
      });
    });
  });

  describe('buildWebhookPayload', () => {
    it('should build proper webhook payload structure', async () => {
      const mockResponse = { data: { success: true } };
      httpService.post.mockReturnValue(of(mockResponse) as any);

      await service.sendEvent({
        source_app: 'orchestrator-ai',
        session_id: 'session-123',
        hook_event_type: 'agent.progress',
        userId: 'user-123',
        conversationId: 'conv-123',
        agentSlug: 'test-agent',
        organizationSlug: 'test-org',
        mode: 'build',
        message: 'Test message',
        progress: 75,
        step: 'processing',
        sequence: 2,
        totalSteps: 5,
        payload: {
          additionalData: 'test',
        },
      });

      const payload = httpService.post.mock.calls[0]?.[1] as any;
      expect(payload).toEqual(
        expect.objectContaining({
          conversationId: 'conv-123',
          status: 'agent.progress',
          userId: 'user-123',
          agentSlug: 'test-agent',
          organizationSlug: 'test-org',
          mode: 'build',
          message: 'Test message',
          percent: 75,
          step: 'processing',
          sequence: 2,
          totalSteps: 5,
          data: expect.objectContaining({
            additionalData: 'test',
            hook_event_type: 'agent.progress',
            source_app: 'orchestrator-ai',
          }),
        }),
      );
    });

    it('should fallback to payload fields when top-level fields missing', async () => {
      const mockResponse = { data: { success: true } };
      httpService.post.mockReturnValue(of(mockResponse) as any);

      await service.sendEvent({
        source_app: 'orchestrator-ai',
        session_id: 'session-123',
        hook_event_type: 'agent.progress',
        payload: {
          conversationId: 'conv-from-payload',
          userId: 'user-from-payload',
          agentSlug: 'agent-from-payload',
        },
      });

      const payload = httpService.post.mock.calls[0]?.[1] as any;
      expect(payload).toEqual(
        expect.objectContaining({
          conversationId: 'conv-from-payload',
          userId: 'user-from-payload',
          agentSlug: 'agent-from-payload',
        }),
      );
    });

    it('should use "unknown" as default conversationId if not provided', async () => {
      const mockResponse = { data: { success: true } };
      httpService.post.mockReturnValue(of(mockResponse) as any);

      await service.sendEvent({
        source_app: 'orchestrator-ai',
        session_id: 'session-123',
        hook_event_type: 'agent.started',
        payload: {},
      });

      const payload = httpService.post.mock.calls[0]?.[1] as any;
      expect(payload.conversationId).toBe('unknown');
    });
  });
});
