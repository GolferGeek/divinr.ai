import { Test, TestingModule } from '@nestjs/testing';
import {
  ObservabilityEventsService,
  ObservabilityEventRecord,
} from './observability-events.service';
import { AUTH_SERVICE } from '../../auth/interfaces/auth-service.interface';
import { DATABASE_SERVICE } from '../../database';
import { createMockExecutionContext } from '@orchestrator-ai/transport-types';

describe('ObservabilityEventsService', () => {
  let service: ObservabilityEventsService;
  let authService: jest.Mocked<{ getUserProfile: jest.Mock }>;

  const TEST_USER_ID = '10000000-0000-4000-a000-000000000123';
  const TEST_CONV_ID = '20000000-0000-4000-a000-000000000123';
  // taskId was removed from ExecutionContext V2 — task_id in DB now equals conversationId
  const TEST_USER_ID_2 = '10000000-0000-4000-a000-000000000456';

  const mockContext = createMockExecutionContext({
    orgSlug: 'test-org',
    userId: TEST_USER_ID,
    conversationId: TEST_CONV_ID,
    agentSlug: 'test-agent',
  });

  const createMockEvent = (
    overrides: Partial<ObservabilityEventRecord> = {},
  ): ObservabilityEventRecord => ({
    context: mockContext,
    source_app: 'orchestrator-ai',
    hook_event_type: 'agent.started',
    status: 'started',
    message: 'Test event',
    progress: null,
    step: null,
    payload: {},
    timestamp: Date.now(),
    ...overrides,
  });

  let mockSupabaseClient: any;

  beforeEach(async () => {
    // Create mock query builder with proper chaining
    mockSupabaseClient = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest
        .fn()
        .mockResolvedValue({ data: { id: TEST_CONV_ID }, error: null }),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObservabilityEventsService,
        {
          provide: AUTH_SERVICE,
          useValue: {
            getUserProfile: jest.fn(),
          },
        },
        {
          provide: DATABASE_SERVICE,
          useValue: mockSupabaseClient,
        },
      ],
    }).compile();

    service = module.get<ObservabilityEventsService>(
      ObservabilityEventsService,
    );
    authService = module.get(AUTH_SERVICE);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('push', () => {
    it('should add event to buffer', async () => {
      const event = createMockEvent();

      await service.push(event);

      const snapshot = service.getSnapshot();
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0]).toEqual(event);
    });

    it('should emit event to subscribers', async () => {
      const event = createMockEvent();
      const receivedEvents: ObservabilityEventRecord[] = [];

      service.events$.subscribe((e) => receivedEvents.push(e));

      await service.push(event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toEqual(event);
    });

    it('should maintain FIFO buffer with configured size', async () => {
      // Default buffer size from env or 500
      const bufferSize = 500;

      // Push events exceeding buffer size
      for (let i = 0; i < bufferSize + 10; i++) {
        await service.push(
          createMockEvent({
            hook_event_type: `event-${i}`,
          }),
        );
      }

      const snapshot = service.getSnapshot();
      expect(snapshot).toHaveLength(bufferSize);
      // First event should be event-10 (first 10 were removed)
      expect(snapshot[0]?.hook_event_type).toBe('event-10');
      // Last event should be event-509
      expect(snapshot[bufferSize - 1]?.hook_event_type).toBe(
        `event-${bufferSize + 9}`,
      );
    });

    it('should enrich event with username from cache', async () => {
      const event = createMockEvent({
        payload: {},
      });

      // Cache username first
      service.cacheUsername(TEST_USER_ID, 'Test User');

      await service.push(event);

      const snapshot = service.getSnapshot();
      expect(snapshot[0]?.payload?.username).toBe('Test User');
    });

    it('should resolve username from database if not cached', async () => {
      const event = createMockEvent({
        payload: {},
      });

      authService.getUserProfile.mockResolvedValue({
        id: TEST_USER_ID,
        displayName: 'Database User',
        email: 'db@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        roles: ['user'],
      });

      await service.push(event);

      expect(authService.getUserProfile).toHaveBeenCalledWith(TEST_USER_ID);
      const snapshot = service.getSnapshot();
      expect(snapshot[0]?.payload?.username).toBe('Database User');
    });

    it('should use existing username from payload', async () => {
      const event = createMockEvent({
        payload: {
          username: 'Existing User',
        },
      });

      await service.push(event);

      // Should not call getUserProfile since username already exists
      expect(authService.getUserProfile).not.toHaveBeenCalled();
      const snapshot = service.getSnapshot();
      expect(snapshot[0]?.payload?.username).toBe('Existing User');
    });

    it('should cache username from payload', async () => {
      const event = createMockEvent({
        context: createMockExecutionContext({
          orgSlug: 'test-org',
          userId: TEST_USER_ID_2,
        }),
        payload: {
          username: 'Payload User',
        },
      });

      await service.push(event);

      // Username should be cached
      const cachedUsername = await service.resolveUsername(TEST_USER_ID_2);
      expect(cachedUsername).toBe('Payload User');
    });

    it('should persist event to database', async () => {
      const event = createMockEvent();

      await service.push(event);

      // Give it a moment for the async persistence
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSupabaseClient.from).toHaveBeenCalledWith(
        null,
        'observability_events',
      );
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          source_app: 'orchestrator-ai',
          hook_event_type: 'agent.started',
          user_id: TEST_USER_ID,
          conversation_id: TEST_CONV_ID,
          task_id: TEST_CONV_ID, // task_id falls back to conversationId since taskId removed from EC
          agent_slug: 'test-agent',
          organization_slug: 'test-org',
          status: 'started',
          message: 'Test event',
          progress: null,
          step: null,
        }),
      );
    });

    it('should handle database persistence failure gracefully', async () => {
      const event = createMockEvent();
      (mockSupabaseClient.insert as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(service.push(event)).resolves.not.toThrow();

      const snapshot = service.getSnapshot();
      expect(snapshot).toHaveLength(1);
    });

    it('should handle getUserProfile failure gracefully', async () => {
      const event = createMockEvent({
        payload: {},
      });

      authService.getUserProfile.mockRejectedValue(
        new Error('Auth service error'),
      );

      await expect(service.push(event)).resolves.not.toThrow();

      const snapshot = service.getSnapshot();
      expect(snapshot).toHaveLength(1);
    });
  });

  describe('getSnapshot', () => {
    it('should return copy of buffer', async () => {
      const event1 = createMockEvent({ hook_event_type: 'event-1' });
      const event2 = createMockEvent({ hook_event_type: 'event-2' });

      await service.push(event1);
      await service.push(event2);

      const snapshot = service.getSnapshot();
      expect(snapshot).toHaveLength(2);
      expect(snapshot[0]?.hook_event_type).toBe('event-1');
      expect(snapshot[1]?.hook_event_type).toBe('event-2');

      // Modifying snapshot should not affect buffer
      snapshot.pop();
      expect(service.getSnapshot()).toHaveLength(2);
    });

    it('should return empty array when buffer is empty', () => {
      const snapshot = service.getSnapshot();
      expect(snapshot).toEqual([]);
    });
  });

  describe('events$', () => {
    it('should be an observable stream', () => {
      expect(service.events$).toBeDefined();
      expect(typeof service.events$.subscribe).toBe('function');
    });

    it('should emit events to multiple subscribers', async () => {
      const subscriber1Events: ObservabilityEventRecord[] = [];
      const subscriber2Events: ObservabilityEventRecord[] = [];

      service.events$.subscribe((e) => subscriber1Events.push(e));
      service.events$.subscribe((e) => subscriber2Events.push(e));

      const event = createMockEvent();
      await service.push(event);

      expect(subscriber1Events).toHaveLength(1);
      expect(subscriber2Events).toHaveLength(1);
    });

    it('should not replay events to new subscribers', async () => {
      const event = createMockEvent();
      await service.push(event);

      const lateSubscriberEvents: ObservabilityEventRecord[] = [];
      service.events$.subscribe((e) => lateSubscriberEvents.push(e));

      // Late subscriber should not receive already-pushed event
      expect(lateSubscriberEvents).toHaveLength(0);

      // But should receive new events
      const newEvent = createMockEvent({ hook_event_type: 'new-event' });
      await service.push(newEvent);
      expect(lateSubscriberEvents).toHaveLength(1);
      expect(lateSubscriberEvents[0]?.hook_event_type).toBe('new-event');
    });
  });

  describe('resolveUsername', () => {
    it('should return cached username', async () => {
      service.cacheUsername('user-123', 'Cached User');

      const username = await service.resolveUsername('user-123');
      expect(username).toBe('Cached User');
      expect(authService.getUserProfile).not.toHaveBeenCalled();
    });

    it('should fetch from database and cache', async () => {
      authService.getUserProfile.mockResolvedValue({
        id: 'user-123',
        displayName: 'DB User',
        email: 'db@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        roles: ['user'],
      });

      const username = await service.resolveUsername('user-123');
      expect(username).toBe('DB User');

      // Second call should use cache
      const username2 = await service.resolveUsername('user-123');
      expect(username2).toBe('DB User');
      expect(authService.getUserProfile).toHaveBeenCalledTimes(1);
    });

    it('should use email if displayName not available', async () => {
      authService.getUserProfile.mockResolvedValue({
        id: 'user-123',
        displayName: '',
        email: 'user@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        roles: ['user'],
      });

      const username = await service.resolveUsername('user-123');
      expect(username).toBe('user@example.com');
    });

    it('should return undefined for empty userId', async () => {
      const username = await service.resolveUsername('');
      expect(username).toBeUndefined();
    });

    it('should return undefined if user profile not found', async () => {
      authService.getUserProfile.mockResolvedValue(null);

      const username = await service.resolveUsername('user-123');
      expect(username).toBeUndefined();
    });

    it('should return undefined on database error', async () => {
      authService.getUserProfile.mockRejectedValue(new Error('Database error'));

      const username = await service.resolveUsername('user-123');
      expect(username).toBeUndefined();
    });

    it('should not duplicate pending lookups', async () => {
      authService.getUserProfile.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  id: 'user-123',
                  displayName: 'User',
                  email: 'user@example.com',
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  roles: ['user'],
                }),
              100,
            ),
          ),
      );

      // Call multiple times before first resolves
      const promise1 = service.resolveUsername('user-123');
      const promise2 = service.resolveUsername('user-123');
      const promise3 = service.resolveUsername('user-123');

      await Promise.all([promise1, promise2, promise3]);

      // Should only call getUserProfile once
      expect(authService.getUserProfile).toHaveBeenCalledTimes(1);
    });
  });

  describe('cacheUsername', () => {
    it('should cache username', () => {
      service.cacheUsername('user-123', 'Test User');

      // Verify by resolving
      void service.resolveUsername('user-123').then((username) => {
        expect(username).toBe('Test User');
      });
    });

    it('should not cache if userId is empty', () => {
      service.cacheUsername('', 'Test User');

      // Cache should be empty
      void service.resolveUsername('').then((username) => {
        expect(username).toBeUndefined();
      });
    });

    it('should not cache if username equals userId', () => {
      service.cacheUsername('user-123', 'user-123');

      // Should fetch from DB next time
      authService.getUserProfile.mockResolvedValue({
        id: 'user-123',
        displayName: 'Real User',
        email: 'user@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        roles: ['user'],
      });

      void service.resolveUsername('user-123').then(() => {
        expect(authService.getUserProfile).toHaveBeenCalled();
      });
    });
  });

  describe('getHistoricalEvents', () => {
    it('should query events from database', async () => {
      const mockEvents = [
        {
          id: 'evt-1',
          conversation_id: 'conv-123',
          task_id: 'task-123',
          user_id: 'user-123',
          agent_slug: 'test-agent',
          organization_slug: 'test-org',
          source_app: 'orchestrator-ai',
          hook_event_type: 'agent.started',
          status: 'started',
          message: 'Test',
          progress: null,
          step: null,
          payload: {},
          username: 'Test User',
          mode: 'build',
          sequence: null,
          total_steps: null,
          timestamp: Date.now(),
          created_at: new Date().toISOString(),
        },
      ];

      (mockSupabaseClient.limit as jest.Mock).mockResolvedValue({
        data: mockEvents,
        error: null,
      });

      const since = Date.now() - 3600000; // 1 hour ago
      const events = await service.getHistoricalEvents(since, 100);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith(
        null,
        'observability_events',
      );
      expect(mockSupabaseClient.select).toHaveBeenCalledWith('*');
      expect(mockSupabaseClient.gte).toHaveBeenCalledWith('timestamp', since);
      expect(mockSupabaseClient.order).toHaveBeenCalledWith('timestamp', {
        ascending: false,
      });
      expect(mockSupabaseClient.limit).toHaveBeenCalledWith(100);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        source_app: 'orchestrator-ai',
        hook_event_type: 'agent.started',
      });
    });

    it('should support until parameter', async () => {
      (mockSupabaseClient.limit as jest.Mock).mockResolvedValue({
        data: [],
        error: null,
      });

      const since = Date.now() - 3600000;
      const until = Date.now();

      await service.getHistoricalEvents(since, 100, until);

      expect(mockSupabaseClient.lte).toHaveBeenCalledWith('timestamp', until);
    });

    it('should handle database errors gracefully', async () => {
      (mockSupabaseClient.limit as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const events = await service.getHistoricalEvents(Date.now() - 3600000);

      expect(events).toEqual([]);
    });

    it('should convert database rows to ObservabilityEventRecord format', async () => {
      const mockRow = {
        id: 'evt-1',
        conversation_id: 'conv-123',
        task_id: 'task-123',
        user_id: 'user-123',
        agent_slug: 'test-agent',
        organization_slug: 'test-org',
        source_app: 'orchestrator-ai',
        hook_event_type: 'agent.progress',
        status: 'in_progress',
        message: 'Processing...',
        progress: 50,
        step: 'validation',
        payload: { data: 'test' },
        username: 'Test User',
        mode: 'build',
        sequence: 2,
        total_steps: 5,
        timestamp: 1234567890,
        created_at: new Date().toISOString(),
      };

      (mockSupabaseClient.limit as jest.Mock).mockResolvedValue({
        data: [mockRow],
        error: null,
      });

      const events = await service.getHistoricalEvents(Date.now() - 3600000);

      expect(events[0]).toMatchObject({
        context: {
          conversationId: 'conv-123',
          userId: 'user-123',
          agentSlug: 'test-agent',
          orgSlug: 'test-org',
        },
        source_app: 'orchestrator-ai',
        hook_event_type: 'agent.progress',
        status: 'in_progress',
        message: 'Processing...',
        progress: 50,
        step: 'validation',
        payload: {
          data: 'test',
          username: 'Test User',
          mode: 'build',
          sequence: 2,
          totalSteps: 5,
        },
        timestamp: 1234567890,
      });
    });
  });
});
