import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as mssql from 'mssql';
import { SqlServerDatabaseService } from '../sqlserver-database.service';

jest.mock('mssql', () => {
  const actual = jest.requireActual('mssql');
  return {
    ...actual,
    ConnectionPool: jest.fn(),
  };
});

describe('SqlServerDatabaseService', () => {
  let service: SqlServerDatabaseService;
  let queryMock: jest.Mock;
  let inputMock: jest.Mock;
  let executeMock: jest.Mock;
  let requestMock: jest.Mock;

  const configValues: Record<string, string> = {
    SQLSERVER_HOST: 'test-sqlserver-host',
    SQLSERVER_PORT: '1433',
    SQLSERVER_DATABASE: 'orchestrator_ai',
    SQLSERVER_USER: 'sa',
    SQLSERVER_PASSWORD: 'password',
    SQLSERVER_ENCRYPT: 'true',
    SQLSERVER_TRUST_SERVER_CERT: 'false',
  };

  beforeEach(async () => {
    queryMock = jest.fn();
    inputMock = jest.fn();
    executeMock = jest.fn();
    requestMock = jest.fn(() => ({
      input: inputMock,
      query: queryMock,
      execute: executeMock,
    }));

    const connectMock = jest.fn(async () => ({
      request: requestMock,
      connected: true,
    }));

    (mssql.ConnectionPool as unknown as jest.Mock).mockImplementation(() => ({
      connect: connectMock,
      connected: false,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SqlServerDatabaseService,
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

    service = module.get(SqlServerDatabaseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('from() — SELECT queries', () => {
    it('should build a basic SELECT', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [{ id: 1, name: 'test' }] });

      const result = await service.from(null, 'users').select('*');

      expect(queryMock).toHaveBeenCalledWith('SELECT * FROM [dbo].[users]');
      expect(result.data).toEqual([{ id: 1, name: 'test' }]);
      expect(result.error).toBeNull();
    });

    it('should build SELECT with schema', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service.from('prediction', 'targets').select('id, name');

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT id, name FROM [prediction].[targets]',
      );
    });

    it('should build SELECT with eq filter', async () => {
      queryMock.mockResolvedValueOnce({
        recordset: [{ id: 'abc', status: 'active' }],
      });

      await service.from(null, 'agents').select('*').eq('status', 'active');

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[agents] WHERE [status] = @p0',
      );
      expect(inputMock).toHaveBeenCalledWith(
        'p0',
        mssql.NVarChar(mssql.MAX),
        'active',
      );
    });

    it('should build SELECT with multiple filters', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 'tasks')
        .select('*')
        .eq('user_id', 'u1')
        .eq('status', 'pending')
        .gte('priority', 5);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[tasks] WHERE [user_id] = @p0 AND [status] = @p1 AND [priority] >= @p2',
      );
    });

    it('should handle eq with null', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service.from(null, 'tasks').select('*').eq('deleted_at', null);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[tasks] WHERE [deleted_at] IS NULL',
      );
    });

    it('should build SELECT with ORDER BY', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 'events')
        .select('*')
        .order('created_at', { ascending: false });

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[events] ORDER BY [created_at] DESC',
      );
    });

    it('should build SELECT with ORDER BY + LIMIT', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 'events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[events] ORDER BY [created_at] DESC OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY',
      );
    });

    it('should build SELECT with TOP when no ORDER BY', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service.from(null, 'events').select('*').limit(5);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT TOP 5 * FROM [dbo].[events]',
      );
    });

    it('should build SELECT with range/pagination', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service.from(null, 'items').select('*').order('id').range(20, 29);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[items] ORDER BY [id] ASC OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY',
      );
    });

    it('should build SELECT with count', async () => {
      queryMock.mockResolvedValueOnce({
        recordset: [
          { id: 1, name: 'a', __total_count: 42 },
          { id: 2, name: 'b', __total_count: 42 },
        ],
      });

      const result = await service
        .from(null, 'users')
        .select('*', { count: 'exact' });

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT *, COUNT(*) OVER() AS [__total_count] FROM [dbo].[users]',
      );
      expect(result.count).toBe(42);
      // __total_count should be stripped from data
      expect((result.data as any[])[0].__total_count).toBeUndefined();
    });

    it('should build head-only count query', async () => {
      queryMock.mockResolvedValueOnce({
        recordset: [{ __count: 100 }],
      });

      const result = await service
        .from(null, 'users')
        .select('*', { count: 'exact', head: true });

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT COUNT(*) AS [__count] FROM [dbo].[users]',
      );
      expect(result.count).toBe(100);
      expect(result.data).toBeNull();
    });

    it('should handle single() with exactly one row', async () => {
      queryMock.mockResolvedValueOnce({
        recordset: [{ id: 'abc', name: 'test' }],
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
      queryMock.mockResolvedValueOnce({ recordset: [] });

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
      queryMock.mockResolvedValueOnce({ recordset: [] });

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
        recordset: [{ id: 'abc' }],
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
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service.from(null, 't').select('*').neq('status', 'deleted');

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[t] WHERE [status] <> @p0',
      );
    });

    it('should handle gt, gte, lt, lte', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 't')
        .select('*')
        .gt('score', 50)
        .gte('level', 3)
        .lt('attempts', 10)
        .lte('age', 100);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[t] WHERE [score] > @p0 AND [level] >= @p1 AND [attempts] < @p2 AND [age] <= @p3',
      );
    });

    it('should handle in filter', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 'users')
        .select('*')
        .in('status', ['active', 'pending']);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[users] WHERE [status] IN (@p0, @p1)',
      );
    });

    it('should handle empty in filter', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service.from(null, 'users').select('*').in('status', []);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[users] WHERE 1 = 0',
      );
    });

    it('should handle is(column, null)', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service.from(null, 't').select('*').is('deleted_at', null);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[t] WHERE [deleted_at] IS NULL',
      );
    });

    it('should handle is(column, true/false)', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service.from(null, 't').select('*').is('is_active', true);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[t] WHERE [is_active] = 1',
      );
    });

    it('should handle not(column, is, null)', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service.from(null, 't').select('*').not('rating', 'is', null);

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[t] WHERE [rating] IS NOT NULL',
      );
    });

    it('should handle not(column, eq, value)', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service.from(null, 't').select('*').not('status', 'eq', 'deleted');

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[t] WHERE NOT ([status] = @p0)',
      );
    });

    it('should handle ilike filter', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service.from(null, 'users').select('*').ilike('name', '%john%');

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[users] WHERE [name] LIKE @p0',
      );
    });

    it('should handle or() filter with PostgREST syntax', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 'data')
        .select('*')
        .or('is_test.eq.true,is_test_data.eq.true');

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[data] WHERE ([is_test] = 1 OR [is_test_data] = 1)',
      );
    });

    it('should handle or() with is.null', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 'data')
        .select('*')
        .or('is_test.is.null,is_test.eq.false');

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[data] WHERE ([is_test] IS NULL OR [is_test] = 0)',
      );
    });

    it('should handle or() with string values', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 'audit')
        .select('*')
        .or('actor_id.eq.user-123,target_user_id.eq.user-123');

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('([actor_id] = @p0 OR [target_user_id] = @p1)'),
      );
    });

    it('should handle or() with ilike', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 'providers')
        .select('*')
        .or('is_local.eq.true,name.ilike.ollama');

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('([is_local] = 1 OR [name] LIKE @p0)'),
      );
    });

    it('should handle contains() with object', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 'items')
        .select('*')
        .contains('metadata', { crawler_article_id: 'art-1' });

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining(
          "JSON_VALUE([metadata], '$.crawler_article_id') = @p0",
        ),
      );
    });

    it('should handle contains() with array', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 'models')
        .select('*')
        .contains('capabilities', ['reasoning']);

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining(
          'EXISTS (SELECT 1 FROM OPENJSON([capabilities]) WHERE [value] = @p0)',
        ),
      );
    });

    it('should handle overlaps()', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 'signals')
        .select('*')
        .overlaps('key_phrases', ['AI', 'machine learning']);

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining(
          'EXISTS (SELECT 1 FROM OPENJSON([key_phrases]) AS a INNER JOIN OPENJSON(@p0) AS b ON a.[value] = b.[value])',
        ),
      );
    });

    it('should handle match()', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 't')
        .select('*')
        .match({ status: 'active', type: 'agent' });

      expect(queryMock).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[t] WHERE [status] = @p0 AND [type] = @p1',
      );
    });
  });

  describe('from() — INSERT', () => {
    it('should build INSERT with returning', async () => {
      queryMock.mockResolvedValueOnce({
        recordset: [{ id: 'new-1', name: 'Test' }],
      });

      const result = await service
        .from(null, 'users')
        .insert({ name: 'Test', email: 'test@example.com' })
        .select('*')
        .single();

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO [dbo].[users]');
      expect(sql).toContain('[name]');
      expect(sql).toContain('[email]');
      expect(sql).toContain('OUTPUT inserted.*');
      expect(result.data).toEqual({ id: 'new-1', name: 'Test' });
    });

    it('should build INSERT without returning', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 'logs')
        .insert({ message: 'hello', level: 'info' });

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO [dbo].[logs]');
      expect(sql).not.toContain('OUTPUT');
    });

    it('should handle batch insert', async () => {
      queryMock.mockResolvedValueOnce({
        recordset: [{ id: '1' }, { id: '2' }],
      });

      await service
        .from(null, 'items')
        .insert([
          { name: 'A', value: 1 },
          { name: 'B', value: 2 },
        ])
        .select('*');

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO [dbo].[items]');
      expect(sql).toContain('OUTPUT inserted.*');
      // Two value groups
      expect(sql.match(/\(/g)!.length).toBeGreaterThanOrEqual(2);
    });

    it('should serialize objects as JSON in insert', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [{ id: '1' }] });

      await service
        .from(null, 'items')
        .insert({ name: 'test', metadata: { key: 'value' } })
        .select('*');

      // Verify the SQL includes metadata column and uses parameterized values
      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO [dbo].[items]');
      expect(sql).toContain('[name]');
      expect(sql).toContain('[metadata]');
      expect(sql).toContain('OUTPUT inserted.*');
      // Two params: @p0 for name, @p1 for metadata (JSON serialized)
      expect(sql).toContain('@p0');
      expect(sql).toContain('@p1');
    });
  });

  describe('from() — UPDATE', () => {
    it('should build UPDATE with WHERE', async () => {
      queryMock.mockResolvedValueOnce({
        recordset: [{ id: 'abc', status: 'done' }],
      });

      const result = await service
        .from(null, 'tasks')
        .update({ status: 'done' })
        .eq('id', 'abc')
        .select('*')
        .single();

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE [dbo].[tasks]');
      // eq('id', 'abc') is called first → @p0, update data → @p1
      expect(sql).toContain('SET [status] = @p1');
      expect(sql).toContain('OUTPUT inserted.*');
      expect(sql).toContain('WHERE [id] = @p0');
      expect(result.data).toEqual({ id: 'abc', status: 'done' });
    });
  });

  describe('from() — DELETE', () => {
    it('should build DELETE with WHERE', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service.from(null, 'sessions').delete().eq('user_id', 'u1');

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('DELETE FROM [dbo].[sessions]');
      expect(sql).toContain('WHERE [user_id] = @p0');
    });
  });

  describe('from() — UPSERT', () => {
    it('should build MERGE for upsert with onConflict', async () => {
      queryMock.mockResolvedValueOnce({
        recordset: [{ id: 'abc', value: 42 }],
      });

      const result = await service
        .from(null, 'settings')
        .upsert({ id: 'abc', key: 'theme', value: 42 }, { onConflict: 'id' })
        .select('*')
        .single();

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('MERGE [dbo].[settings] AS target');
      expect(sql).toContain('WHEN MATCHED THEN UPDATE SET');
      expect(sql).toContain('WHEN NOT MATCHED THEN INSERT');
      expect(sql).toContain('OUTPUT inserted.*');
      expect(result.data).toEqual({ id: 'abc', value: 42 });
    });

    it('should build MERGE with ignoreDuplicates', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [] });

      await service
        .from(null, 'items')
        .upsert(
          { id: 'abc', name: 'test' },
          { onConflict: 'id', ignoreDuplicates: true },
        );

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('MERGE');
      expect(sql).not.toContain('WHEN MATCHED THEN UPDATE');
      expect(sql).toContain('WHEN NOT MATCHED THEN INSERT');
    });
  });

  describe('rpc()', () => {
    it('should execute stored procedure', async () => {
      executeMock.mockResolvedValueOnce({
        recordset: [{ result: true }],
      });

      const result = await service.rpc('rbac_has_permission', {
        p_user_id: 'user-1',
        p_permission: 'admin',
      });

      expect(executeMock).toHaveBeenCalledWith('[dbo].[rbac_has_permission]');
      expect(inputMock).toHaveBeenCalledWith(
        'p_user_id',
        mssql.NVarChar(mssql.MAX),
        'user-1',
      );
      expect(result.data).toEqual([{ result: true }]);
    });

    it('should execute schema-qualified stored procedure', async () => {
      executeMock.mockResolvedValueOnce({
        recordset: [{ id: '1' }],
      });

      await service.rpc('get_active_learnings', { p_limit: 10 }, 'prediction');

      expect(executeMock).toHaveBeenCalledWith(
        '[prediction].[get_active_learnings]',
      );
    });

    it('should handle rpc error', async () => {
      executeMock.mockRejectedValueOnce(new Error('Procedure not found'));

      const result = await service.rpc('nonexistent');

      expect(result.data).toBeNull();
      expect(result.error?.message).toBe('Procedure not found');
    });
  });

  describe('checkConnection()', () => {
    it('should return ok on successful connection', async () => {
      queryMock.mockResolvedValueOnce({ recordset: [{ ok: 1 }] });

      const result = await service.checkConnection();

      expect(result.status).toBe('ok');
    });

    it('should return error on failed connection', async () => {
      queryMock.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await service.checkConnection();

      expect(result.status).toBe('error');
      expect(result.message).toBe('Connection refused');
    });
  });

  describe('getConfig()', () => {
    it('should return sqlserver config', () => {
      const config = service.getConfig();

      expect(config.provider).toBe('sqlserver');
      expect(config.url).toContain('test-sqlserver-host');
      expect(config.schemas).toContain('dbo');
      expect(config.schemas).toContain('prediction');
      expect(config.clientsAvailable.service).toBe(true);
      expect(config.clientsAvailable.anon).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should return error result on query failure', async () => {
      queryMock.mockRejectedValueOnce(new Error('Invalid object name'));

      const result = await service.from(null, 'nonexistent').select('*');

      expect(result.data).toBeNull();
      expect(result.error?.message).toBe('Invalid object name');
    });

    it('should throw on missing operation', async () => {
      const builder = service.from(null, 'users');
      // Awaiting without calling select/insert/update/delete
      const result = (await builder) as any;

      expect(result.data).toBeNull();
      expect(result.error?.message).toContain('No operation specified');
    });
  });
});
