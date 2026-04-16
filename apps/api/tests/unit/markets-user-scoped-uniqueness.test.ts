/**
 * Unit tests for user-scoped uniqueness on market_analysts and instruments.
 * Validates that the ON CONFLICT (slug, (coalesce(user_id, 'base'))) upsert
 * allows two different users to author analysts with the same slug.
 */
import { MarketsService } from '../../src/markets/markets.service';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall { sql: string; params: unknown[] }

class MockDb {
  public calls: MockCall[] = [];
  private responses: Array<{ data?: unknown; error?: { message: string } | null }>;
  private callIndex = 0;
  constructor(responses: Array<{ data?: unknown; error?: { message: string } | null }>) {
    this.responses = responses;
  }
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    return this.responses[this.callIndex++] ?? { data: [], error: null };
  }
  from() {
    return this;
  }
}

class MockSchema {
  async ensureSchema() {}
}

class MockRbac {
  async hasPermission() { return true; }
}

const noop = {} as any;

function buildService(responses: Array<{ data?: unknown; error?: { message: string } | null }>) {
  const db = new MockDb(responses);
  const svc = new MarketsService(
    db as any,        // db
    noop,             // llm
    new MockRbac() as any, // rbac
    noop,             // observability
    new MockSchema() as any, // schema
    noop,             // riskRunner
    noop,             // predictionRunner
    noop,             // marketsLlm
    noop,             // positionSizing
  );
  return { db, svc };
}

async function main(): Promise<void> {
  console.log('\n=== User-Scoped Uniqueness Tests ===\n');

  // 1. createAnalyst includes user-scoped ON CONFLICT
  console.log('createAnalyst conflict target:');
  {
    const analystRow = {
      id: 'a1', user_id: 'user-a', slug: 'test', display_name: 'Test',
      persona_prompt: 'p', analyst_type: 'personality', is_active: true,
    };
    const { db, svc } = buildService([
      { data: [analystRow], error: null },   // insert returning
      { data: [], error: null },             // config version insert
      { data: [], error: null },             // update current_config_version_id
    ]);

    await svc.createAnalyst({
      userId: 'user-a',
      slug: 'test',
      displayName: 'Test',
      personaPrompt: 'p',
    });

    const insertSql = db.calls[0].sql;
    assert(
      insertSql.includes("coalesce(user_id, 'base')"),
      'createAnalyst SQL uses coalesce(user_id, \'base\') in ON CONFLICT',
    );
    assert(
      insertSql.includes('shared_with_clubs'),
      'createAnalyst SQL includes shared_with_clubs column',
    );
    assert(
      !insertSql.includes('on conflict (slug)'),
      'createAnalyst SQL does NOT use bare ON CONFLICT (slug)',
    );
  }

  // 2. createAnalyst passes user_id as $2 parameter
  console.log('\ncreateAnalyst user_id parameter:');
  {
    const analystRow = {
      id: 'a2', user_id: 'user-b', slug: 'test', display_name: 'Test',
      persona_prompt: 'p', analyst_type: 'personality', is_active: true,
    };
    const { db, svc } = buildService([
      { data: [analystRow], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]);

    await svc.createAnalyst({
      userId: 'user-b',
      slug: 'test',
      displayName: 'Test',
      personaPrompt: 'p',
    });

    assert(
      db.calls[0].params[1] === 'user-b',
      'user_id parameter is passed as $2',
    );
  }

  // 3. createInstrument uses rawQuery with user-scoped conflict
  console.log('\ncreateInstrument conflict target:');
  {
    const instrumentRow = {
      id: 'i1', user_id: 'user-a', symbol: 'TSLY', name: 'Tesla ETF',
      asset_type: 'etf', is_active: true,
    };
    const { db, svc } = buildService([
      { data: [instrumentRow], error: null },
    ]);

    await svc.createInstrument({
      userId: 'user-a',
      symbol: 'TSLY',
      name: 'Tesla ETF',
      assetType: 'etf',
    });

    const insertSql = db.calls[0].sql;
    assert(
      insertSql.includes("coalesce(user_id, 'base')"),
      'createInstrument SQL uses coalesce(user_id, \'base\') in ON CONFLICT',
    );
    assert(
      db.calls[0].params[1] === 'user-a',
      'createInstrument passes user_id as parameter',
    );
  }

  // 4. createAnalyst with null userId (base content) passes null as user_id
  console.log('\ncreateAnalyst base content (null userId):');
  {
    const analystRow = {
      id: 'a3', user_id: null, slug: 'base-macro', display_name: 'Macro',
      persona_prompt: 'p', analyst_type: 'personality', is_active: true,
    };
    const { db, svc } = buildService([
      { data: [analystRow], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]);

    await svc.createAnalyst({
      userId: null as any,
      slug: 'base-macro',
      displayName: 'Macro',
      personaPrompt: 'p',
    });

    assert(
      db.calls[0].params[1] === null,
      'user_id is null for base analyst creation',
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
