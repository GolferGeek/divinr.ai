import { RunMetadataService } from '../run-metadata.service';
import { DatabaseService } from '@/database';

function makeService(dbOverrides?: Partial<DatabaseService>) {
  const mockDb = {
    from: jest.fn(),
  } as unknown as DatabaseService;

  if (dbOverrides) {
    Object.assign(mockDb, dbOverrides);
  }

  const service = new RunMetadataService(mockDb);
  return { service, mockDb };
}

describe('RunMetadataService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startRequest', () => {
    it('should create a MetadataContext with correct fields for external provider', async () => {
      const { service } = makeService();

      const context = await service.startRequest(
        {
          provider: 'openai',
          model: 'gpt-4o',
          isLocal: false,
          modelTier: 'premium',
          fallbackUsed: false,
          complexityLevel: 'high',
          complexityScore: 0.9,
          routingReason: 'user preference',
        },
        {
          userId: 'user-abc',
          callerType: 'agent',
          callerName: 'test-agent',
          conversationId: 'conv-xyz',
          dataClassification: 'public',
        },
      );

      expect(context.provider).toBe('openai');
      expect(context.model).toBe('gpt-4o');
      expect(context.tier).toBe('external');
      expect(context.isLocal).toBe(false);
      expect(context.userId).toBe('user-abc');
      expect(context.callerType).toBe('agent');
      expect(context.callerName).toBe('test-agent');
      expect(context.conversationId).toBe('conv-xyz');
      expect(context.complexityLevel).toBe('high');
      expect(context.complexityScore).toBe(0.9);
      expect(context.routingReason).toBe('user preference');
      expect(context.runId).toBeDefined();
      expect(typeof context.runId).toBe('string');
      expect(context.startTime).toBeGreaterThan(0);
    });

    it('should set tier to local for local provider', async () => {
      const { service } = makeService();

      const context = await service.startRequest({
        provider: 'ollama',
        model: 'llama3.2:3b',
        isLocal: true,
      });

      expect(context.tier).toBe('local');
      expect(context.isLocal).toBe(true);
    });

    it('should generate a unique runId for each request', async () => {
      const { service } = makeService();

      const ctx1 = await service.startRequest({
        provider: 'openai',
        model: 'gpt-4o',
        isLocal: false,
      });
      const ctx2 = await service.startRequest({
        provider: 'openai',
        model: 'gpt-4o',
        isLocal: false,
      });

      expect(ctx1.runId).not.toBe(ctx2.runId);
    });

    it('should set fallbackUsed to false when not provided', async () => {
      const { service } = makeService();

      const context = await service.startRequest({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        isLocal: false,
      });

      expect(context.fallbackUsed).toBe(false);
    });
  });

  describe('completeRequest', () => {
    it('should return RunMetadata with completed status and calculated cost', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      const mockSingle = jest
        .fn()
        .mockResolvedValue({ data: { id: 'user-abc' }, error: null });
      const mockEqUser = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelectUser = jest.fn().mockReturnValue({ eq: mockEqUser });
      const mockFromUsers = jest
        .fn()
        .mockReturnValue({ select: mockSelectUser });

      const mockSingleConv = jest
        .fn()
        .mockResolvedValue({ data: { id: 'conv-xyz' }, error: null });
      const mockEqConv = jest.fn().mockReturnValue({ single: mockSingleConv });
      const mockSelectConv = jest.fn().mockReturnValue({ eq: mockEqConv });
      const mockFromConvs = jest
        .fn()
        .mockReturnValue({ select: mockSelectConv });

      const mockFromUsage = jest.fn().mockReturnValue({ insert: mockInsert });

      const mockFrom = jest.fn((_schema: unknown, table: string) => {
        if (table.includes('users')) return mockFromUsers(table);
        if (table.includes('conversations')) return mockFromConvs(table);
        return mockFromUsage(table);
      });

      const { service } = makeService({
        from: mockFrom,
      } as unknown as DatabaseService);

      const context = await service.startRequest(
        {
          provider: 'openai',
          model: 'gpt-4o',
          isLocal: false,
        },
        {
          userId: '550e8400-e29b-41d4-a716-446655440000',
          conversationId: '550e8400-e29b-41d4-a716-446655440001',
        },
      );

      const metadata = await service.completeRequest(context, {
        content: 'Test response content',
        inputTokens: 100,
        outputTokens: 50,
      });

      expect(metadata.status).toBe('completed');
      expect(metadata.provider).toBe('openai');
      expect(metadata.model).toBe('gpt-4o');
      expect(metadata.runId).toBe(context.runId);
      expect(metadata.duration).toBeGreaterThanOrEqual(0);
      expect(metadata.inputTokens).toBe(100);
      expect(metadata.outputTokens).toBe(50);
      expect(metadata.cost).toBeGreaterThan(0);
    });
  });

  describe('completeRequestWithError', () => {
    it('should return RunMetadata with error status and zero cost', async () => {
      const mockUpdate = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'not found', code: 'PGRST116' },
            }),
          }),
        }),
      });
      const mockFrom = jest.fn().mockReturnValue({ update: mockUpdate });

      const { service } = makeService({
        from: mockFrom,
      } as unknown as DatabaseService);

      const context = await service.startRequest({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        isLocal: false,
      });

      const error = new Error('LLM API timeout');
      const metadata = await service.completeRequestWithError(context, error);

      expect(metadata.status).toBe('error');
      expect(metadata.errorMessage).toBe('LLM API timeout');
      expect(metadata.cost).toBe(0);
      expect(metadata.provider).toBe('anthropic');
      expect(metadata.model).toBe('claude-sonnet-4');
      expect(metadata.runId).toBe(context.runId);
    });
  });

  describe('insertCompletedUsage', () => {
    it('should skip userId when not a valid UUID', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      const mockFromUsage = jest.fn().mockReturnValue({ insert: mockInsert });
      const mockFrom = jest.fn((_schema: unknown, table: string) => {
        if (table.includes('users'))
          throw new Error('Should not query users for invalid userId');
        return mockFromUsage(table);
      });

      const { service } = makeService({
        from: mockFrom,
      } as unknown as DatabaseService);

      // Should not throw for invalid userId
      await expect(
        service.insertCompletedUsage({
          provider: 'openai',
          model: 'gpt-4o',
          userId: 'not-a-valid-uuid',
          inputTokens: 100,
          outputTokens: 50,
        }),
      ).resolves.toBeUndefined();
    });

    it('should skip conversationId when it is a NIL UUID', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      const mockSingle = jest
        .fn()
        .mockResolvedValue({ data: { id: 'user' }, error: null });
      const mockEqUser = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelectUser = jest.fn().mockReturnValue({ eq: mockEqUser });
      const mockFromUsers = jest
        .fn()
        .mockReturnValue({ select: mockSelectUser });
      const mockFromUsage = jest.fn().mockReturnValue({ insert: mockInsert });

      const mockFrom = jest.fn((_schema: unknown, table: string) => {
        if (table.includes('users')) return mockFromUsers(table);
        if (table.includes('conversations'))
          throw new Error('Should not query conversations for NIL UUID');
        return mockFromUsage(table);
      });

      const { service } = makeService({
        from: mockFrom,
      } as unknown as DatabaseService);

      await service.insertCompletedUsage({
        provider: 'openai',
        model: 'gpt-4o',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '00000000-0000-0000-0000-000000000000', // NIL UUID
        inputTokens: 100,
        outputTokens: 50,
      });

      // conversationId should be null in the insert, not queried
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: null,
        }),
      );
    });

    it('should compute cost when totalCost is not provided', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });

      const { service } = makeService({
        from: mockFrom,
      } as unknown as DatabaseService);

      await service.insertCompletedUsage({
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 1000,
        outputTokens: 500,
        // no totalCost
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          input_tokens: 1000,
          output_tokens: 500,
          total_cost: expect.any(Number),
        }),
      );
      // gpt-4o cost: (1000/1000)*0.005 + (500/1000)*0.015 = 0.005 + 0.0075 = 0.0125
      const callArgs = mockInsert.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.total_cost as number).toBeCloseTo(0.0125, 5);
    });

    it('should use provided totalCost when given', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });

      const { service } = makeService({
        from: mockFrom,
      } as unknown as DatabaseService);

      await service.insertCompletedUsage({
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
        totalCost: 0.042,
      });

      const callArgs = mockInsert.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.total_cost as number).toBeCloseTo(0.042, 5);
    });
  });

  describe('getRunMetadata', () => {
    it('should return null for unknown runId', () => {
      const { service } = makeService();
      const result = service.getRunMetadata('nonexistent-run-id');
      expect(result).toBeNull();
    });
  });

  describe('getActiveRuns', () => {
    it('should return an empty array initially', () => {
      const { service } = makeService();
      const runs = service.getActiveRuns();
      expect(Array.isArray(runs)).toBe(true);
      expect(runs).toHaveLength(0);
    });
  });

  describe('cleanupStaleRuns', () => {
    it('should not throw when there are no stale runs', () => {
      const { service } = makeService();
      expect(() => service.cleanupStaleRuns()).not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should return stats with zero values when no completed runs exist', async () => {
      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            gte: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });

      const { service } = makeService({
        from: mockFrom,
      } as unknown as DatabaseService);

      const stats = await service.getStats();

      expect(stats.activeRuns).toBe(0);
      expect(stats.totalRunsToday).toBe(0);
      expect(stats.avgDuration).toBe(0);
      expect(stats.avgCost).toBe(0);
    });

    it('should calculate averages from completed run data', async () => {
      const fakeRuns = [
        { duration_ms: 1000, input_cost: 0.01, output_cost: 0.02 },
        { duration_ms: 2000, input_cost: 0.02, output_cost: 0.04 },
      ];
      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            gte: jest.fn().mockResolvedValue({ data: fakeRuns, error: null }),
          }),
        }),
      });

      const { service } = makeService({
        from: mockFrom,
      } as unknown as DatabaseService);

      const stats = await service.getStats();

      expect(stats.totalRunsToday).toBe(2);
      expect(stats.avgDuration).toBe(1500); // (1000 + 2000) / 2
      expect(stats.avgCost).toBeCloseTo(0.045, 5); // ((0.01+0.02) + (0.02+0.04)) / 2
    });
  });
});
