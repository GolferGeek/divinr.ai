/**
 * Unit tests for ClubRankingService.snapshotDaily() — verifies SQL shape
 * (period_type = 'daily', YYYY-MM-DD label, upsert on conflict, public+ranked filter)
 * and env gating via a stubbed DatabaseService.
 */
import { ClubRankingService } from '../../src/clubs/club-ranking.service';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

interface MockCall { sql: string; params: unknown[] }
class StubSchema { async ensureSchema(): Promise<void> { /* no-op */ } }
class MockDb {
  public calls: MockCall[] = [];
  constructor(private readonly responder: (sql: string, params: unknown[]) => { data: unknown; error: null }) {}
  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    return this.responder(sql, params);
  }
}

async function testSnapshotShape(): Promise<void> {
  console.log('\nDaily snapshot SQL shape:');

  const returningRows = [{ id: 's1' }, { id: 's2' }];
  const responder = (sql: string): { data: unknown; error: null } => {
    if (sql.includes('INSERT INTO prediction.club_ranking_snapshots')) {
      return { data: returningRows, error: null };
    }
    return { data: [], error: null };
  };

  const db = new MockDb(responder);
  const svc = new ClubRankingService(db as any, new StubSchema() as any);

  const result = await svc.snapshotDaily();
  assert(result.snapshots === 2, 'Returns count of rows RETURNING-ed');

  const insert = db.calls.find(c => c.sql.includes('INSERT INTO prediction.club_ranking_snapshots'));
  assert(!!insert, 'Issues INSERT on club_ranking_snapshots');

  if (!insert) return;

  assert(insert.sql.includes("'daily'"), "period_type literal is 'daily' (widened CHECK accepts this)");
  assert(insert.sql.includes('ON CONFLICT (club_id, period_type, period_label)'),
    'Upserts on the existing unique constraint');
  assert(insert.sql.includes('DO UPDATE SET'),
    'Re-running same label updates instead of duplicating');
  assert(insert.sql.includes('c.is_public = true'),
    'Only public clubs are snapshotted');
  assert(insert.sql.includes('c.ranking_position IS NOT NULL'),
    'Clubs without a ranking_position are skipped');

  const label = insert.params[0];
  assert(typeof label === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(label as string),
    `period_label param is YYYY-MM-DD (got: ${String(label)})`);
}

async function testEnvGate(): Promise<void> {
  console.log('\nEnv gate short-circuits cron:');

  const prev = process.env.MARKETS_DISABLE_RANK_SNAPSHOTS;
  process.env.MARKETS_DISABLE_RANK_SNAPSHOTS = 'true';

  const db = new MockDb(() => ({ data: [], error: null }));
  const svc = new ClubRankingService(db as any, new StubSchema() as any);

  await svc.handleDailyRankSnapshotCron();
  assert(db.calls.length === 0, 'No DB calls issued when gate is true');

  if (prev === undefined) delete process.env.MARKETS_DISABLE_RANK_SNAPSHOTS;
  else process.env.MARKETS_DISABLE_RANK_SNAPSHOTS = prev;
}

async function main(): Promise<void> {
  console.log('\n=== Club Rank Snapshot (Daily) Tests ===');
  await testSnapshotShape();
  await testEnvGate();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
