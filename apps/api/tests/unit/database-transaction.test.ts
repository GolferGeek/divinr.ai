import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import {
  isRetryableTransactionError,
  PostgresqlDatabaseService,
  runSerializableTransaction,
  SupabaseDatabaseService,
} from '@orchestratorai/planes/database';
import type {
  DatabaseService,
  DatabaseTransaction,
} from '@orchestrator-ai/transport-types';

interface FakeClient {
  events: string[];
  query(sql: string): Promise<{ rows: unknown[]; rowCount: number }>;
  release(): void;
}

function fakeClient(): FakeClient {
  const events: string[] = [];
  return {
    events,
    async query(sql) {
      events.push(sql);
      return { rows: [{ ok: true }], rowCount: 1 };
    },
    release() {
      events.push('RELEASE');
    },
  };
}

async function providerTransaction(
  kind: 'postgresql' | 'supabase',
  callback: (transaction: DatabaseTransaction) => Promise<unknown>,
) {
  const client = fakeClient();
  const pool = { connect: async () => client };
  if (kind === 'postgresql') {
    const service = new PostgresqlDatabaseService(new ConfigService());
    (service as unknown as { pool: unknown }).pool = pool;
    await service.withTransaction(callback, { isolationLevel: 'serializable' });
  } else {
    const service = new SupabaseDatabaseService(
      {} as never,
      new ConfigService(),
    );
    (service as unknown as { pool: unknown }).pool = pool;
    await service.withTransaction(callback, { isolationLevel: 'serializable' });
  }
  return client.events;
}

async function main() {
  for (const provider of ['postgresql', 'supabase'] as const) {
    const committed = await providerTransaction(provider, async (transaction) => {
      const query = await transaction.rawQuery('SELECT 1');
      assert.equal(query.error, null);
      return 'ok';
    });
    assert.deepEqual(committed, [
      'BEGIN',
      'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
      'SELECT 1',
      'COMMIT',
      'RELEASE',
    ]);

    const client = fakeClient();
    const pool = { connect: async () => client };
    const service = provider === 'postgresql'
      ? new PostgresqlDatabaseService(new ConfigService())
      : new SupabaseDatabaseService({} as never, new ConfigService());
    (service as unknown as { pool: unknown }).pool = pool;
    await assert.rejects(
      service.withTransaction(async () => {
        throw new Error('stop');
      }),
      /stop/,
    );
    assert.deepEqual(client.events, [
      'BEGIN',
      'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
      'ROLLBACK',
      'RELEASE',
    ]);
  }

  let attempts = 0;
  const delays: number[] = [];
  const database = {
    async withTransaction<T>(
      work: (transaction: DatabaseTransaction) => Promise<T>,
    ): Promise<T> {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error('serialization failure') as Error & { code: string };
        error.code = '40001';
        throw error;
      }
      return work({ rawQuery: async () => ({ data: [], error: null }) });
    },
  } as DatabaseService;
  const result = await runSerializableTransaction(
    database,
    async () => 'committed',
    {
      maxAttempts: 3,
      baseDelayMs: 10,
      random: () => 0.5,
      sleep: async (delay) => { delays.push(delay); },
    },
  );
  assert.equal(result, 'committed');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.equal(isRetryableTransactionError({ code: '40P01' }), true);
  assert.equal(isRetryableTransactionError(new Error('permission denied')), false);

  let exhaustedAttempts = 0;
  const exhaustedDatabase = {
    async withTransaction(): Promise<never> {
      exhaustedAttempts += 1;
      const error = new Error('deadlock victim') as Error & { code: string };
      error.code = '40P01';
      throw error;
    },
  } as DatabaseService;
  await assert.rejects(
    runSerializableTransaction(
      exhaustedDatabase,
      async () => 'unreachable',
      {
        maxAttempts: 2,
        sleep: async () => undefined,
      },
    ),
    /deadlock victim/,
  );
  assert.equal(exhaustedAttempts, 2);

  console.log('PASS  database transaction providers and retry policy');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
