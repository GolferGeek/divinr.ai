/**
 * Unit tests for user-authored content CRUD methods on MarketsService.
 * Tests ownership guards, soft deletion, listing, scaffold, and contract override stamping.
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
  from() { return this; }
}

class MockSchema { async ensureSchema() {} }
class MockRbac { async hasPermission() { return true; } }
class MockLlm {
  buildExecutionContext() { return {}; }
  async generateText() {
    return { text: '## General\nTest analyst.\n\n## Stage: Predictor Generation\nGenerate signals.\n\n## Stage: Risk Assessment\nAssess risk.\n\n## Stage: Prediction Generation\nPredict outcomes.\n\n## Stage: Learning\nLearn from results.\n\n## Adaptations\nNone yet.' };
  }
}

const noop = {} as any;

function buildService(responses: Array<{ data?: unknown; error?: { message: string } | null }>) {
  const db = new MockDb(responses);
  const svc = new MarketsService(
    db as any,
    noop,
    new MockRbac() as any,
    noop,
    new MockSchema() as any,
    noop,
    noop,
    new MockLlm() as any,
    noop,
  );
  return { db, svc };
}

async function main(): Promise<void> {
  console.log('\n=== Authorship Endpoints Tests ===\n');

  // 1. softDeleteAnalyst rejects when target is base (user_id IS NULL)
  console.log('softDeleteAnalyst:');
  {
    const { svc } = buildService([
      { data: [{ id: 'a1', user_id: null }], error: null },
    ]);
    try {
      await svc.softDeleteAnalyst('a1', 'user-a');
      assert(false, 'rejects base analyst');
    } catch (err: any) {
      assert(err.message.includes('immutable') || err.status === 403, 'rejects base analyst with 403');
    }
  }

  // 2. softDeleteAnalyst rejects when target is owned by another user
  {
    const { svc } = buildService([
      { data: [{ id: 'a2', user_id: 'user-b' }], error: null },
    ]);
    try {
      await svc.softDeleteAnalyst('a2', 'user-a');
      assert(false, 'rejects other user analyst');
    } catch (err: any) {
      assert(err.message.includes('owner') || err.status === 403, 'rejects other-user with 403');
    }
  }

  // 3. softDeleteAnalyst sets is_active=false when owner calls it
  {
    const { db, svc } = buildService([
      // assertOwnsAnalyst lookup
      { data: [{ id: 'a3', user_id: 'user-a' }], error: null },
      // UPDATE
      { data: [], error: null },
    ]);
    await svc.softDeleteAnalyst('a3', 'user-a');
    const updateSql = db.calls[1].sql;
    assert(
      updateSql.includes('is_active = false'),
      'sets is_active=false when owner calls it',
    );
  }

  // 4. listMyAnalysts returns only rows where user_id matches
  console.log('\nlistMyAnalysts:');
  {
    const analysts = [
      { id: 'a1', user_id: 'user-a', display_name: 'Alpha', is_active: true },
      { id: 'a2', user_id: 'user-a', display_name: 'Beta', is_active: true },
    ];
    const { db, svc } = buildService([
      { data: analysts, error: null },
    ]);
    const result = await svc.listMyAnalysts('user-a');
    assert(result.length === 2, 'returns user analysts');
    assert(
      db.calls[0].sql.includes('user_id = $1'),
      'filters by user_id',
    );
    assert(
      db.calls[0].params[0] === 'user-a',
      'passes userId as parameter',
    );
  }

  // 5. softDeleteInstrument rejects base content
  console.log('\nsoftDeleteInstrument:');
  {
    const { svc } = buildService([
      { data: [{ id: 'i1', user_id: null }], error: null },
    ]);
    try {
      await svc.softDeleteInstrument('i1', 'user-a');
      assert(false, 'rejects base instrument');
    } catch (err: any) {
      assert(err.message.includes('immutable') || err.status === 403, 'rejects base instrument with 403');
    }
  }

  // 6. scaffoldAnalystContract stamps author_user_id and creates version
  console.log('\nscaffoldAnalystContract:');
  {
    const { db, svc } = buildService([
      // assertOwnsAnalyst lookup
      { data: [{ id: 'a1', user_id: 'user-a' }], error: null },
      // analyst metadata lookup (display_name, analyst_type)
      { data: [{ display_name: 'Test Analyst', analyst_type: 'personality' }], error: null },
      // get current_config_version_id
      { data: [{ current_config_version_id: null }], error: null },
      // insert config version
      { data: [], error: null },
      // update analyst pointer
      { data: [], error: null },
    ]);
    const result = await svc.scaffoldAnalystContract('a1', 'user-a');
    assert(typeof result.versionId === 'string', 'returns versionId');
    assert(result.contextMarkdown.includes('## General'), 'returns markdown with stage sections');
    const insertSql = db.calls[3].sql;
    assert(
      insertSql.includes('author_user_id'),
      'config version insert includes author_user_id column',
    );
  }

  // 7. updateAnalystMetadata rejects base content
  console.log('\nupdateAnalystMetadata:');
  {
    const { svc } = buildService([
      { data: [{ id: 'a1', user_id: null }], error: null },
    ]);
    try {
      await svc.updateAnalystMetadata('a1', 'user-a', { displayName: 'New Name' });
      assert(false, 'rejects base analyst metadata update');
    } catch (err: any) {
      assert(err.message.includes('immutable') || err.status === 403, 'rejects base analyst with 403');
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
