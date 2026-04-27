import assert from 'node:assert/strict';
import { MarketsSchemaService } from '../../src/markets/schema/markets-schema.service';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => {
        passed++;
        console.log(`  ✓ ${name}`);
      }).catch((err) => {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(err);
      });
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

interface QueryCall {
  sql: string;
  params: unknown[];
}

class MockDb {
  public readonly calls: QueryCall[] = [];

  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });

    if (sql.includes('create table if not exists public.schema_bootstrap_state')) {
      return { data: [], error: null };
    }
    if (sql.includes('select 1 from public.schema_bootstrap_state')) {
      return { data: this.bootstrapComplete ? [{ ok: 1 }] : [], error: null };
    }
    if (sql.includes('insert into public.schema_bootstrap_state')) {
      this.bootstrapMarked = true;
      return { data: [], error: null };
    }
    if (sql.includes('from unnest($1::text[]) as rel_name')) {
      return { data: [{ present: this.signaturePresent ? 8 : 0 }], error: null };
    }
    if (sql.includes('join information_schema.columns c')) {
      return { data: [{ present: this.signaturePresent ? 6 : 0 }], error: null };
    }
    if (sql.includes('create schema if not exists prediction')) {
      this.ddlRan = true;
      return { data: [], error: null };
    }
    return { data: [], error: null };
  }

  constructor(
    private readonly bootstrapComplete: boolean,
    private readonly signaturePresent: boolean,
  ) {}

  public ddlRan = false;
  public bootstrapMarked = false;
}

async function main() {
  console.log('\n=== Markets Schema Bootstrap Tracking Tests ===\n');

  await test('ensureSchema skips prediction DDL when bootstrap marker exists', async () => {
    (MarketsSchemaService as any).schemaReady = false;
    (MarketsSchemaService as any).schemaReadyPromise = null;
    const db = new MockDb(true, false);
    const svc = new MarketsSchemaService(db as never);

    await svc.ensureSchema();

    assert.equal(db.ddlRan, false);
    assert.equal(db.bootstrapMarked, false);
  });

  await test('ensureSchema adopts existing schema signature without replaying DDL', async () => {
    (MarketsSchemaService as any).schemaReady = false;
    (MarketsSchemaService as any).schemaReadyPromise = null;
    const db = new MockDb(false, true);
    const svc = new MarketsSchemaService(db as never);

    await svc.ensureSchema();

    assert.equal(db.ddlRan, false);
    assert.equal(db.bootstrapMarked, true);
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
