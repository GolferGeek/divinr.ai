import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import { PostgresqlDatabaseService } from '../postgresql-database.service';

jest.mock('pg', () => {
  const mockClient: Partial<PoolClient> = {
    query: jest.fn(),
    release: jest.fn(),
  };
  const mockPool: Partial<Pool> = {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue(mockClient),
  };
  return {
    Pool: jest.fn().mockImplementation(() => mockPool),
  };
});

describe('PostgresqlDatabaseService', () => {
  let service: PostgresqlDatabaseService;
  let queryMock: jest.Mock;
  let releaseMock: jest.Mock;

  const configValues: Record<string, string> = {
    POSTGRESQL_URL:
      'postgresql://postgres:secret@test-db-host:5432/orchestrator_ai',
  };

  beforeEach(async () => {
    queryMock = jest.fn();
    releaseMock = jest.fn();

    const { Pool: MockPool } = jest.requireMock<typeof import('pg')>('pg');
    (MockPool as unknown as jest.Mock).mockImplementation(() => ({
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue({
        query: queryMock,
        release: releaseMock,
      }),
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostgresqlDatabaseService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: string) => {
              return configValues[key] ?? defaultVal;
            }),
            getOrThrow: jest.fn((key: string) => {
              const val = configValues[key];
              if (!val) throw new Error(`Missing ${key}`);
              return val;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(PostgresqlDatabaseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('from() — SELECT queries', () => {
    it('should build a basic SELECT', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 1, name: 'test' }],
        rowCount: 1,
      });

      const result = await service.from(null, 'users').select('*');

      expect(queryMock).toHaveBeenCalledWith('SELECT * FROM "users"', []);
      expect(result.data).toEqual([{ id: 1, name: 'test' }]);
      expect(result.error).toBeNull();
    });

    it('should build SELECT with schema', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.from('prediction', 'targets').select('id, name');

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT id, name FROM "prediction"."targets"',
        [],
      );
    });

    it('should build SELECT with eq filter', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 'abc', status: 'active' }],
        rowCount: 1,
      });

      await service.from(null, 'agents').select('*').eq('status', 'active');

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "agents" WHERE "status" = $1',
        ['active'],
      );
    });

    it('should build SELECT with multiple filters', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service
        .from(null, 'tasks')
        .select('*')
        .eq('user_id', 'u1')
        .eq('status', 'pending')
        .gte('priority', 5);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "tasks" WHERE "user_id" = $1 AND "status" = $2 AND "priority" >= $3',
        ['u1', 'pending', 5],
      );
    });

    it('should handle eq with null', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.from(null, 'tasks').select('*').eq('deleted_at', null);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "tasks" WHERE "deleted_at" IS NULL',
        [],
      );
    });

    it('should build SELECT with ORDER BY', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service
        .from(null, 'events')
        .select('*')
        .order('created_at', { ascending: false });

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "events" ORDER BY "created_at" DESC',
        [],
      );
    });

    it('should build SELECT with LIMIT', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service
        .from(null, 'events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "events" ORDER BY "created_at" DESC LIMIT 10',
        [],
      );
    });

    it('should build SELECT with range/pagination', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.from(null, 'items').select('*').order('id').range(20, 29);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "items" ORDER BY "id" ASC OFFSET 20 LIMIT 10',
        [],
      );
    });

    it('should build SELECT with count', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          { id: 1, name: 'a', __total_count: '42' },
          { id: 2, name: 'b', __total_count: '42' },
        ],
        rowCount: 2,
      });

      const result = await service
        .from(null, 'users')
        .select('*', { count: 'exact' });

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT *, COUNT(*) OVER() AS __total_count FROM "users"',
        [],
      );
      expect(result.count).toBe(42);
      expect((result.data as any[])[0].__total_count).toBeUndefined();
    });

    it('should build head-only count query', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ __count: '100' }],
        rowCount: 1,
      });

      const result = await service
        .from(null, 'users')
        .select('*', { count: 'exact', head: true });

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT COUNT(*) AS __count FROM "users"',
        [],
      );
      expect(result.count).toBe(100);
      expect(result.data).toBeNull();
    });

    it('should handle single() with exactly one row', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 'abc', name: 'test' }],
        rowCount: 1,
      });

      const result = await service
        .from(null, 'users')
        .select('*')
        .eq('id', 'abc')
        .single();

      expect(result.data).toEqual({ id: 'abc', name: 'test' });
      expect(result.error).toBeNull();
    });

    it('should handle single() with no rows', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service
        .from(null, 'users')
        .select('*')
        .eq('id', 'missing')
        .single();

      expect(result.data).toBeNull();
      expect(result.error).toEqual(
        expect.objectContaining({ message: 'Row not found' }),
      );
    });

    it('should handle maybeSingle() with no rows', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service
        .from(null, 'users')
        .select('*')
        .eq('id', 'missing')
        .maybeSingle();

      expect(result.data).toBeNull();
      expect(result.error).toBeNull();
    });

    it('should handle maybeSingle() with one row', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 'abc' }],
        rowCount: 1,
      });

      const result = await service
        .from(null, 'users')
        .select('*')
        .eq('id', 'abc')
        .maybeSingle();

      expect(result.data).toEqual({ id: 'abc' });
      expect(result.error).toBeNull();
    });
  });

  describe('from() — filter methods', () => {
    it('should handle neq filter', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.from(null, 't').select('*').neq('status', 'deleted');

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "t" WHERE "status" != $1',
        ['deleted'],
      );
    });

    it('should handle gt, gte, lt, lte', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service
        .from(null, 't')
        .select('*')
        .gt('score', 50)
        .gte('level', 3)
        .lt('attempts', 10)
        .lte('age', 100);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "t" WHERE "score" > $1 AND "level" >= $2 AND "attempts" < $3 AND "age" <= $4',
        [50, 3, 10, 100],
      );
    });

    it('should handle in filter', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service
        .from(null, 'users')
        .select('*')
        .in('status', ['active', 'pending']);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "users" WHERE "status" IN ($1, $2)',
        ['active', 'pending'],
      );
    });

    it('should handle empty in filter', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.from(null, 'users').select('*').in('status', []);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "users" WHERE 1 = 0',
        [],
      );
    });

    it('should handle is(column, null)', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.from(null, 't').select('*').is('deleted_at', null);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "t" WHERE "deleted_at" IS NULL',
        [],
      );
    });

    it('should handle not(column, is, null)', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.from(null, 't').select('*').not('rating', 'is', null);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "t" WHERE "rating" IS NOT NULL',
        [],
      );
    });

    it('should handle not(column, eq, value)', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.from(null, 't').select('*').not('status', 'eq', 'deleted');

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "t" WHERE NOT ("status" = $1)',
        ['deleted'],
      );
    });

    it('should handle ilike filter', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.from(null, 'users').select('*').ilike('name', '%john%');

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "users" WHERE "name" ILIKE $1',
        ['%john%'],
      );
    });

    it('should handle or() filter', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service
        .from(null, 'data')
        .select('*')
        .or('status.eq.active,status.eq.pending');

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "data" WHERE ("status" = $1 OR "status" = $2)',
        ['active', 'pending'],
      );
    });

    it('should handle or() with is.null', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service
        .from(null, 'data')
        .select('*')
        .or('deleted_at.is.null,deleted_at.eq.2025-01-01');

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('"deleted_at" IS NULL');
    });

    it('should handle match()', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service
        .from(null, 't')
        .select('*')
        .match({ status: 'active', type: 'agent' });

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM "t" WHERE "status" = $1 AND "type" = $2',
        ['active', 'agent'],
      );
    });
  });

  describe('from() — INSERT', () => {
    it('should build INSERT with returning', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 'new-1', name: 'Test' }],
        rowCount: 1,
      });

      const result = await service
        .from(null, 'users')
        .insert({ name: 'Test', email: 'test@example.com' })
        .select('*')
        .single();

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO "users"');
      expect(sql).toContain('"name"');
      expect(sql).toContain('"email"');
      expect(sql).toContain('RETURNING *');
      expect(result.data).toEqual({ id: 'new-1', name: 'Test' });
    });

    it('should build INSERT without returning', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service
        .from(null, 'logs')
        .insert({ message: 'hello', level: 'info' });

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO "logs"');
      expect(sql).not.toContain('RETURNING');
    });

    it('should handle batch insert', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: '1' }, { id: '2' }],
        rowCount: 2,
      });

      await service
        .from(null, 'items')
        .insert([
          { name: 'A', value: 1 },
          { name: 'B', value: 2 },
        ])
        .select('*');

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO "items"');
      expect(sql).toContain('RETURNING *');
    });

    it('should serialize objects as JSON in insert', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ id: '1' }], rowCount: 1 });

      await service
        .from(null, 'items')
        .insert({ name: 'test', metadata: { key: 'value' } })
        .select('*');

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO "items"');
      expect(sql).toContain('"name"');
      expect(sql).toContain('"metadata"');
      const params = queryMock.mock.calls[0][1] as unknown[];
      expect(params).toContain('{"key":"value"}');
    });
  });

  describe('from() — UPDATE', () => {
    it('should build UPDATE with WHERE', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 'abc', status: 'done' }],
        rowCount: 1,
      });

      const result = await service
        .from(null, 'tasks')
        .update({ status: 'done' })
        .eq('id', 'abc')
        .select('*')
        .single();

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE "tasks"');
      expect(sql).toContain('RETURNING *');
      expect(sql).toContain('"id" = $');
      expect(result.data).toEqual({ id: 'abc', status: 'done' });
    });
  });

  describe('from() — DELETE', () => {
    it('should build DELETE with WHERE', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.from(null, 'sessions').delete().eq('user_id', 'u1');

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('DELETE FROM "sessions"');
      expect(sql).toContain('"user_id" = $1');
    });
  });

  describe('from() — UPSERT', () => {
    it('should build INSERT ON CONFLICT DO UPDATE', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 'abc', value: 42 }],
        rowCount: 1,
      });

      const result = await service
        .from(null, 'settings')
        .upsert({ id: 'abc', key: 'theme', value: 42 }, { onConflict: 'id' })
        .select('*')
        .single();

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO "settings"');
      expect(sql).toContain('ON CONFLICT ("id") DO UPDATE SET');
      expect(sql).toContain('RETURNING *');
      expect(result.data).toEqual({ id: 'abc', value: 42 });
    });

    it('should build INSERT ON CONFLICT DO NOTHING with ignoreDuplicates', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service
        .from(null, 'items')
        .upsert(
          { id: 'abc', name: 'test' },
          { onConflict: 'id', ignoreDuplicates: true },
        );

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO "items"');
      expect(sql).toContain('ON CONFLICT ("id") DO NOTHING');
    });
  });

  describe('checkConnection()', () => {
    it('should return ok on successful connection', async () => {
      const { Pool: MockPool } = jest.requireMock<typeof import('pg')>('pg');
      const poolQueryMock = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ ok: 1 }] });
      (MockPool as unknown as jest.Mock).mockImplementation(() => ({
        query: poolQueryMock,
        connect: jest.fn().mockResolvedValue({
          query: queryMock,
          release: releaseMock,
        }),
      }));

      const testModule = await Test.createTestingModule({
        providers: [
          PostgresqlDatabaseService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => configValues[key]),
              getOrThrow: jest.fn((key: string) => configValues[key]),
            },
          },
        ],
      }).compile();

      const testService = testModule.get(PostgresqlDatabaseService);
      // Trigger pool creation via from() first
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await testService.from(null, 'test').select('*');

      poolQueryMock.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
      const result = await testService.checkConnection();

      expect(result.status).toBe('ok');
    });
  });

  describe('getConfig()', () => {
    it('should return postgresql config', () => {
      const config = service.getConfig();

      expect(config.provider).toBe('postgresql');
      expect(config.url).toContain('test-db-host');
      expect(config.schemas).toContain('public');
      expect(config.clientsAvailable.service).toBe(true);
      expect(config.clientsAvailable.anon).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should return error result on query failure', async () => {
      queryMock.mockRejectedValueOnce(new Error('relation does not exist'));

      const result = await service.from(null, 'nonexistent').select('*');

      expect(result.data).toBeNull();
      expect(result.error?.message).toBe('relation does not exist');
    });

    it('should return error on missing operation', async () => {
      const builder = service.from(null, 'users');
      const result = await (builder as any);

      expect(result.data).toBeNull();
      expect(result.error?.message).toContain('No operation specified');
    });
  });
});
