import assert from 'node:assert/strict';
import { AnalysisPreferencesService } from '../../src/markets/services/analysis-preferences.service';

interface Call {
  sql: string;
  params: unknown[];
}

class MockDb {
  calls: Call[] = [];
  prefs: Array<{ preference_type: string; target_id: string }> = [];
  priority = 'balanced';
  analysts = new Set(['analyst-a', 'analyst-b']);
  instruments = new Set(['inst-a', 'inst-b']);

  async rawQuery(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    if (sql.includes('from prediction.user_analysis_preferences')) {
      return { data: this.prefs, error: null };
    }
    if (sql.includes('from prediction.user_dashboard_preferences')) {
      return { data: [{ priority_mode: this.priority }], error: null };
    }
    if (sql.includes('delete from prediction.user_analysis_preferences')) {
      this.prefs = [];
      return { data: [], error: null };
    }
    if (sql.includes('insert into prediction.user_analysis_preferences')) {
      this.prefs.push({ preference_type: String(params[1]), target_id: String(params[2]) });
      return { data: [], error: null };
    }
    if (sql.includes('insert into prediction.user_dashboard_preferences')) {
      this.priority = String(params[1]);
      return { data: [], error: null };
    }
    if (sql.includes('from prediction.market_analysts')) {
      const ids = params[0] as string[];
      return { data: ids.filter(id => this.analysts.has(id)).map(id => ({ id })), error: null };
    }
    if (sql.includes('from prediction.instruments')) {
      const ids = params[0] as string[];
      return { data: ids.filter(id => this.instruments.has(id)).map(id => ({ id })), error: null };
    }
    return { data: [], error: null };
  }
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

void test('getPreferences returns defaults when no rows exist', async () => {
  const svc = new AnalysisPreferencesService(new MockDb() as any);
  const result = await svc.getPreferences('user-a');
  assert.deepEqual(result, {
    followed_analyst_ids: [],
    watched_instrument_ids: [],
    muted_instrument_ids: [],
    priority_mode: 'balanced',
  });
});

void test('replacePreferences dedupes ids and persists priority mode', async () => {
  const db = new MockDb();
  const svc = new AnalysisPreferencesService(db as any);
  const result = await svc.replacePreferences('user-a', {
    followed_analyst_ids: ['analyst-a', 'analyst-a'],
    watched_instrument_ids: ['inst-a'],
    muted_instrument_ids: ['inst-b'],
    priority_mode: 'portfolio_first',
  });
  assert.deepEqual(result.followed_analyst_ids, ['analyst-a']);
  assert.deepEqual(result.watched_instrument_ids, ['inst-a']);
  assert.deepEqual(result.muted_instrument_ids, ['inst-b']);
  assert.equal(result.priority_mode, 'portfolio_first');
  assert(db.calls.some(call => call.sql.includes('delete from prediction.user_analysis_preferences')));
});

void test('replacePreferences rejects invalid priority mode', async () => {
  const svc = new AnalysisPreferencesService(new MockDb() as any);
  await assert.rejects(
    () => svc.replacePreferences('user-a', {
      followed_analyst_ids: [],
      watched_instrument_ids: [],
      muted_instrument_ids: [],
      priority_mode: 'fast' as any,
    }),
    /priority_mode/,
  );
});

void test('replacePreferences rejects unknown target ids', async () => {
  const svc = new AnalysisPreferencesService(new MockDb() as any);
  await assert.rejects(
    () => svc.replacePreferences('user-a', {
      followed_analyst_ids: ['missing-analyst'],
      watched_instrument_ids: [],
      muted_instrument_ids: [],
      priority_mode: 'balanced',
    }),
    /Unknown followed_analyst/,
  );
});
