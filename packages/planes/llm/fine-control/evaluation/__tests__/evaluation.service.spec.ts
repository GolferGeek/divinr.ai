import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { EvaluationService } from '../evaluation.service';
import { DATABASE_SERVICE, DatabaseService } from '@/database';

/**
 * Build a chainable query mock that terminates with a resolved value.
 *
 * All chaining methods (select, eq, not, order, gte, lte, in, limit, update, insert)
 * return `this` so that the chain can continue. The chain itself is a thenable
 * (has a `.then` method) so `await chain` resolves to `terminalResult`.
 * The `.single()` method also resolves to `terminalResult`.
 */
function makeQueryChain(terminalResult: { data: unknown; error: unknown }) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(terminalResult),
    // Make the chain itself thenable so `await chain` resolves
    then: jest.fn((resolve: (val: unknown) => void) => {
      resolve(terminalResult);
      return Promise.resolve(terminalResult);
    }),
    catch: jest.fn().mockReturnThis(),
    finally: jest.fn().mockReturnThis(),
  };
  return chain;
}

function makeDbService(options?: { fromMock?: jest.Mock }) {
  const defaultChain = makeQueryChain({ data: [], error: null });
  const fromMock = options?.fromMock ?? jest.fn().mockReturnValue(defaultChain);

  const dbService = {
    from: fromMock,
    rpc: jest.fn(),
    checkConnection: jest.fn(),
    getConfig: jest.fn(),
  } as unknown as DatabaseService;

  return { dbService, fromMock };
}

describe('EvaluationService', () => {
  let service: EvaluationService;

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('evaluateMessage', () => {
    it('should return null when message is not found', async () => {
      const notFoundChain = makeQueryChain({
        data: null,
        error: { code: 'PGRST116', message: 'not found' },
      });
      const { dbService } = makeDbService({
        fromMock: jest.fn().mockReturnValue(notFoundChain),
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EvaluationService,
          { provide: DATABASE_SERVICE, useValue: dbService },
        ],
      }).compile();
      module.useLogger(false);
      service = module.get<EvaluationService>(EvaluationService);

      const result = await service.evaluateMessage('user-1', 'msg-1', {
        userRating: 5,
      });

      expect(result).toBeNull();
    });

    it('should throw HttpException when update fails', async () => {
      // First query (select) succeeds, second query (update+single) fails
      const successChain = makeQueryChain({
        data: { id: 'msg-1', user_id: 'user-1' },
        error: null,
      });
      const failUpdateChain = makeQueryChain({
        data: null,
        error: { message: 'DB constraint violation' },
      });

      let callCount = 0;
      const fromMock = jest.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? successChain : failUpdateChain;
      });

      const { dbService } = makeDbService({ fromMock });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EvaluationService,
          { provide: DATABASE_SERVICE, useValue: dbService },
        ],
      }).compile();
      module.useLogger(false);
      service = module.get<EvaluationService>(EvaluationService);

      await expect(
        service.evaluateMessage('user-1', 'msg-1', { userRating: 4 }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('getMessageWithEvaluation', () => {
    it('should return null for PGRST116 (not found) error code', async () => {
      const notFoundChain = makeQueryChain({
        data: null,
        error: { code: 'PGRST116', message: 'not found' },
      });
      const { dbService } = makeDbService({
        fromMock: jest.fn().mockReturnValue(notFoundChain),
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EvaluationService,
          { provide: DATABASE_SERVICE, useValue: dbService },
        ],
      }).compile();
      module.useLogger(false);
      service = module.get<EvaluationService>(EvaluationService);

      const result = await service.getMessageWithEvaluation(
        'user-1',
        'msg-unknown',
      );
      expect(result).toBeNull();
    });

    it('should throw HttpException for non-PGRST116 errors', async () => {
      const errorChain = makeQueryChain({
        data: null,
        error: { code: 'OTHER', message: 'Database error' },
      });
      const { dbService } = makeDbService({
        fromMock: jest.fn().mockReturnValue(errorChain),
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EvaluationService,
          { provide: DATABASE_SERVICE, useValue: dbService },
        ],
      }).compile();
      module.useLogger(false);
      service = module.get<EvaluationService>(EvaluationService);

      await expect(
        service.getMessageWithEvaluation('user-1', 'msg-1'),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('compareModels', () => {
    it('should return empty comparison array when no evaluations exist', async () => {
      const emptyChain = makeQueryChain({ data: [], error: null });
      const { dbService } = makeDbService({
        fromMock: jest.fn().mockReturnValue(emptyChain),
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EvaluationService,
          { provide: DATABASE_SERVICE, useValue: dbService },
        ],
      }).compile();
      module.useLogger(false);
      service = module.get<EvaluationService>(EvaluationService);

      const result = await service.compareModels(
        'user-1',
        ['model-1', 'model-2'],
        {},
      );

      expect(result).toHaveProperty('comparison');
      expect(result).toHaveProperty('recommendations');
      expect(Array.isArray(result.comparison)).toBe(true);
    });

    it('should throw HttpException when database query fails', async () => {
      const errorChain = makeQueryChain({
        data: null,
        error: { message: 'Connection failed' },
      });

      const { dbService } = makeDbService({
        fromMock: jest.fn().mockReturnValue(errorChain),
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EvaluationService,
          { provide: DATABASE_SERVICE, useValue: dbService },
        ],
      }).compile();
      module.useLogger(false);
      service = module.get<EvaluationService>(EvaluationService);

      await expect(
        service.compareModels('user-1', ['model-1'], {}),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('exportUserFeedback', () => {
    it('should return an array for JSON format with no feedback', async () => {
      const emptyChain = makeQueryChain({ data: [], error: null });
      const { dbService } = makeDbService({
        fromMock: jest.fn().mockReturnValue(emptyChain),
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EvaluationService,
          { provide: DATABASE_SERVICE, useValue: dbService },
        ],
      }).compile();
      module.useLogger(false);
      service = module.get<EvaluationService>(EvaluationService);

      const result = await service.exportUserFeedback('user-1', {
        format: 'json',
        includeContent: false,
      });

      expect(Array.isArray(result)).toBe(true);
    });

    it('should return a string for CSV format', async () => {
      const emptyChain = makeQueryChain({ data: [], error: null });
      const { dbService } = makeDbService({
        fromMock: jest.fn().mockReturnValue(emptyChain),
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EvaluationService,
          { provide: DATABASE_SERVICE, useValue: dbService },
        ],
      }).compile();
      module.useLogger(false);
      service = module.get<EvaluationService>(EvaluationService);

      const result = await service.exportUserFeedback('user-1', {
        format: 'csv',
        includeContent: true,
      });

      expect(typeof result).toBe('string');
    });

    it('should throw HttpException when database query fails', async () => {
      const errorChain = makeQueryChain({
        data: null,
        error: { message: 'DB error' },
      });
      const { dbService } = makeDbService({
        fromMock: jest.fn().mockReturnValue(errorChain),
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EvaluationService,
          { provide: DATABASE_SERVICE, useValue: dbService },
        ],
      }).compile();
      module.useLogger(false);
      service = module.get<EvaluationService>(EvaluationService);

      await expect(
        service.exportUserFeedback('user-1', {
          format: 'json',
          includeContent: false,
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('updateMessageEvaluation', () => {
    it('should delegate to evaluateMessage and return null when not found', async () => {
      const notFoundChain = makeQueryChain({
        data: null,
        error: { code: 'PGRST116', message: 'not found' },
      });
      const { dbService } = makeDbService({
        fromMock: jest.fn().mockReturnValue(notFoundChain),
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EvaluationService,
          { provide: DATABASE_SERVICE, useValue: dbService },
        ],
      }).compile();
      module.useLogger(false);
      service = module.get<EvaluationService>(EvaluationService);

      const result = await service.updateMessageEvaluation('user-1', 'msg-1', {
        userRating: 3,
      });

      expect(result).toBeNull();
    });
  });
});
