import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { AGENT_COMMERCE_RELATIONS } from '../../src/agent-commerce/agent-commerce-schema.constants';
import { AgentCommerceSchemaService } from '../../src/agent-commerce/agent-commerce-schema.service';

const enabled = process.env.AGENT_COMMERCE_DB_TESTS === 'true';
if (!enabled) {
  console.log('agent-commerce migration integration test skipped (set AGENT_COMMERCE_DB_TESTS=true)');
  process.exit(0);
}

const connectionString = process.env.AGENT_COMMERCE_TEST_DATABASE_URL
  ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'AGENT_COMMERCE_TEST_DATABASE_URL or DATABASE_URL is required for migration integration tests',
  );
}

const migrationNames = [
  '2026-07-24-agent-commerce-identities.sql',
  '2026-07-24-agent-commerce-tasks-ap2.sql',
  '2026-07-24-agent-commerce-payments-delivery.sql',
];

async function main(): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  const schema = `agent_commerce_test_${process.pid}`;
  const loadUnmodifiedMigrations = () => migrationNames.map((name) =>
    readFileSync(join(process.cwd(), 'db', 'migrations', name), 'utf8')
      .replace(/^BEGIN;\s*/m, '')
      .replace(/\s*COMMIT;\s*$/m, ''));
  const loadMigrations = () => migrationNames.map((name) =>
    readFileSync(join(process.cwd(), 'db', 'migrations', name), 'utf8')
      .replace(/^BEGIN;\s*/m, '')
      .replace(/\s*COMMIT;\s*$/m, '')
      .replaceAll('agent_commerce', schema));
  let rolledBack = false;
  try {
    const existingNamespace = await client.query<{ schema_name: string | null }>(
      `SELECT to_regnamespace('agent_commerce')::text AS schema_name`,
    );
    if (existingNamespace.rows[0].schema_name === null) {
      await client.query('BEGIN');
      for (const source of loadUnmodifiedMigrations()) {
        await client.query(source);
      }
      const transaction = {
        rawQuery: async (sql: string, params: unknown[] = []) => {
          try {
            const result = await client.query(sql, params);
            return { data: result.rows, error: null, count: result.rowCount };
          } catch (error) {
            return {
              data: null,
              error: {
                message: error instanceof Error ? error.message : String(error),
                code: (
                  error && typeof error === 'object' && 'code' in error
                    ? String(error.code)
                    : undefined
                ),
              },
            };
          }
        },
      };
      const database = {
        ...transaction,
        withTransaction: async <T>(
          work: (tx: typeof transaction) => Promise<T>,
        ): Promise<T> => work(transaction),
      };
      await new AgentCommerceSchemaService(database as never).bootstrap();
      const seeded = await client.query<{ clients: number; products: number }>(
        `SELECT
           (SELECT count(*)::integer FROM agent_commerce.oauth_clients
             WHERE client_id = 'apple-assistant-native-v1') AS clients,
           (SELECT count(*)::integer FROM agent_commerce.a2a_products
             WHERE product_version = 2 AND status = 'active') AS products`,
      );
      assert.deepEqual(seeded.rows[0], { clients: 1, products: 7 });
      await client.query('ROLLBACK');
      const absentAfterBootstrap = await client.query<{ schema_name: string | null }>(
        `SELECT to_regnamespace('agent_commerce')::text AS schema_name`,
      );
      assert.equal(absentAfterBootstrap.rows[0].schema_name, null);
    }

    await client.query('BEGIN');
    for (const source of loadMigrations()) {
      await client.query(source);
    }
    const relations = await client.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
      [schema],
    );
    assert.deepEqual(
      relations.rows.map((row) => row.table_name),
      [...AGENT_COMMERCE_RELATIONS].sort(),
    );

    const rls = await client.query<{ count: string }>(
      `SELECT count(*)::text
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relrowsecurity`,
      [schema],
    );
    assert.equal(Number(rls.rows[0].count), 27);

    const ownerPolicies = await client.query<{ count: string }>(
      `SELECT count(*)::text
         FROM pg_policies
        WHERE schemaname = $1
          AND (qual LIKE '%request.jwt.claim.sub%' OR with_check LIKE '%request.jwt.claim.sub%')`,
      [schema],
    );
    assert.equal(Number(ownerPolicies.rows[0].count), 27);

    await assert.rejects(
      () => client.query(
        `INSERT INTO ${schema}.ap2_counters (
           counter_id, user_id, authority_id, merchant_id, product_id,
           constraint_id, window_start, window_end, asset, unit,
           limit_amount, reserved_amount, committed_amount,
           limit_count, reserved_count, committed_count
         ) VALUES (
           'bad', gen_random_uuid(), 'authority', 'merchant', 'product',
           'constraint', now(), now() + interval '1 hour', 'BTC-REGTEST', 'msat',
           100, 101, 0, 1, 0, 0
         )`,
      ),
      /check constraint/i,
    );
    await client.query('ROLLBACK');
    rolledBack = true;
    const absent = await client.query<{ schema_name: string | null }>(
      'SELECT to_regnamespace($1)::text AS schema_name',
      [schema],
    );
    assert.equal(absent.rows[0].schema_name, null);

    // Reapply to a committed, isolated schema to exercise two concurrent
    // reservations against the same one-call counter.
    for (const source of loadMigrations()) {
      await client.query(source);
    }
    for (let index = 0; index < 4; index += 1) {
      await client.query(
        `INSERT INTO ${schema}.dpop_nonces (
           user_id, nonce_hash, dpop_jkt, purpose, issued_at, expires_at
         ) VALUES (
           '20000000-0000-0000-0000-000000000001', $1, 'test-jkt',
           'resource', now(), now() + interval '5 minutes'
         )`,
        [`nonce-${index}`],
      );
    }
    await assert.rejects(
      () => client.query(
        `INSERT INTO ${schema}.dpop_nonces (
           user_id, nonce_hash, dpop_jkt, purpose, issued_at, expires_at
         ) VALUES (
           '20000000-0000-0000-0000-000000000001', 'nonce-5', 'test-jkt',
           'resource', now(), now() + interval '5 minutes'
         )`,
      ),
      /maximum active DPoP nonces exceeded/,
    );
    const counterId = '50000000-0000-0000-0000-000000000001';
    await client.query(
      `INSERT INTO ${schema}.ap2_counters (
         id, counter_id, user_id, authority_id, merchant_id, product_id,
         constraint_id, window_start, window_end, asset, unit,
         limit_amount, limit_count
       ) VALUES (
         $1, 'race-counter', '20000000-0000-0000-0000-000000000001',
         'authority', 'merchant', 'product', 'count.max_cumulative',
         now() - interval '1 minute', now() + interval '1 hour',
         'BTC-REGTEST', 'msat', 100000, 1
       )`,
      [counterId],
    );
    const contender = new Client({ connectionString });
    await contender.connect();
    try {
      await client.query('BEGIN');
      await contender.query('BEGIN');
      const reserveSql = `UPDATE ${schema}.ap2_counters
         SET reserved_count = reserved_count + 1,
             reserved_amount = reserved_amount + 10000,
             lock_version = lock_version + 1
       WHERE id = $1
         AND reserved_count + committed_count + 1 <= limit_count
         AND reserved_amount + committed_amount + 10000 <= limit_amount
       RETURNING id`;
      const first = await client.query(reserveSql, [counterId]);
      const secondPromise = contender.query(reserveSql, [counterId]);
      await client.query('COMMIT');
      const second = await secondPromise;
      await contender.query('COMMIT');
      assert.equal(first.rowCount, 1);
      assert.equal(second.rowCount, 0);
    } finally {
      await contender.query('ROLLBACK').catch(() => undefined);
      await contender.end();
    }
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
  assert.equal(rolledBack, true);
  console.log('agent-commerce migration integration tests passed');
}

void main();
