import { EnablementService } from '../../src/markets/services/enablement.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.error(`  \u2717 ${label}`);
  }
}

function createMockDb(responses: Record<string, any> = {}) {
  const queries: Array<{ sql: string; params: any[] }> = [];
  return {
    queries,
    rawQuery: async (sql: string, params: any[] = []) => {
      queries.push({ sql, params });
      for (const [key, value] of Object.entries(responses)) {
        if (sql.includes(key)) {
          return { data: typeof value === 'function' ? value(sql, params) : value };
        }
      }
      return { data: [] };
    },
  };
}

function createMockSchema() {
  return { ensureSchema: async () => {} };
}

function createService(dbResponses: Record<string, any> = {}) {
  const db = createMockDb(dbResponses);
  const schema = createMockSchema();
  const service = Object.create(EnablementService.prototype);
  (service as any).db = db;
  (service as any).schema = schema;
  return { service: service as EnablementService, db };
}

async function main(): Promise<void> {
  console.log('\n=== EnablementService Tests ===\n');

  // ─── listEnabledTriples ────────────────────────────────────
  {
    const rows = [
      {
        id: 't1',
        authorUserId: null,
        analystId: 'a1',
        analystName: 'Base Analyst',
        analystSlug: 'base-analyst',
        isAuthoredAnalyst: false,
        instrumentId: 'i1',
        instrumentSymbol: 'AAPL',
        instrumentName: 'Apple Inc.',
        isAuthoredInstrument: false,
        enabledAt: '2026-04-17T00:00:00Z',
      },
    ];
    const { service } = createService({
      'user_enabled_triples uet': rows,
    });
    const result = await service.listEnabledTriples('user-1');
    assert(result.length === 1, 'listEnabledTriples returns joined data with metadata');
    assert(result[0].analystName === 'Base Analyst', 'listEnabledTriples returns correct analyst name');
    assert(result[0].instrumentSymbol === 'AAPL', 'listEnabledTriples returns correct instrument symbol');
    assert(result[0].authorUserId === null, 'listEnabledTriples returns null authorUserId for base');
  }

  // ─── enableTriple (insert new) ─────────────────────────────
  {
    const insertedRow = {
      id: 't-new',
      authorUserId: null,
      analystId: 'a1',
      analystName: 'Base Analyst',
      analystSlug: 'base-analyst',
      isAuthoredAnalyst: false,
      instrumentId: 'i1',
      instrumentSymbol: 'AAPL',
      instrumentName: 'Apple Inc.',
      isAuthoredInstrument: false,
      enabledAt: '2026-04-17T00:00:00Z',
    };
    const { service, db } = createService({
      'INSERT INTO prediction.user_enabled_triples': [],
      'SELECT': [insertedRow],
    });
    const result = await service.enableTriple('user-1', 'a1', 'i1');
    assert(result !== undefined, 'enableTriple returns the enabled triple');
    assert(result.analystId === 'a1', 'enableTriple returns correct analystId');
    const insertQuery = db.queries.find(q => q.sql.includes('INSERT'));
    assert(insertQuery !== undefined, 'enableTriple executes an INSERT query');
    assert(insertQuery!.params[0] === 'user-1', 'enableTriple passes userId');
  }

  // ─── enableTriple (re-enable — ON CONFLICT) ───────────────
  {
    const { service, db } = createService({
      'INSERT INTO prediction.user_enabled_triples': [],
      'SELECT': [{
        id: 't-reenabled',
        authorUserId: null,
        analystId: 'a1',
        analystName: 'Base Analyst',
        analystSlug: 'base-analyst',
        isAuthoredAnalyst: false,
        instrumentId: 'i1',
        instrumentSymbol: 'AAPL',
        instrumentName: 'Apple Inc.',
        isAuthoredInstrument: false,
        enabledAt: '2026-04-17T01:00:00Z',
      }],
    });
    await service.enableTriple('user-1', 'a1', 'i1');
    const insertQuery = db.queries.find(q => q.sql.includes('ON CONFLICT'));
    assert(insertQuery !== undefined, 'enableTriple uses ON CONFLICT for re-enable');
    assert(insertQuery!.sql.includes('disabled_at = NULL'), 'ON CONFLICT clears disabled_at');
  }

  // ─── disableTriple ─────────────────────────────────────────
  {
    const { service, db } = createService({
      'UPDATE prediction.user_enabled_triples': [],
    });
    await service.disableTriple('user-1', 'a1', 'i1');
    const updateQuery = db.queries.find(q => q.sql.includes('UPDATE'));
    assert(updateQuery !== undefined, 'disableTriple executes an UPDATE query');
    assert(updateQuery!.sql.includes('disabled_at = now()'), 'disableTriple sets disabled_at');
    assert(updateQuery!.params[0] === 'user-1', 'disableTriple passes userId');
    assert(updateQuery!.params[1] === 'a1', 'disableTriple passes analystId');
    assert(updateQuery!.params[2] === 'i1', 'disableTriple passes instrumentId');
  }

  // ─── listAvailableTriples ─────────────────────────────────
  {
    const available = [
      {
        analystId: 'a1',
        analystName: 'Base Analyst',
        analystSlug: 'base-analyst',
        isAuthoredAnalyst: false,
        instrumentId: 'i1',
        instrumentSymbol: 'AAPL',
        instrumentName: 'Apple Inc.',
        isAuthoredInstrument: false,
        isEnabled: true,
        authorUserId: null,
      },
      {
        analystId: 'a2',
        analystName: 'Custom Analyst',
        analystSlug: 'custom',
        isAuthoredAnalyst: true,
        instrumentId: 'i2',
        instrumentSymbol: 'AAPL',
        instrumentName: 'AAPL China-Aware',
        isAuthoredInstrument: true,
        isEnabled: false,
        authorUserId: 'user-1',
      },
    ];
    const { service } = createService({
      'available': available,
    });
    const result = await service.listAvailableTriples('user-1');
    assert(result.length === 2, 'listAvailableTriples returns base + authored triples');
    assert(result[0].isEnabled === true, 'listAvailableTriples annotates enabled state');
    assert(result[1].isAuthoredAnalyst === true, 'listAvailableTriples marks authored analyst');
    assert(result[1].authorUserId === 'user-1', 'listAvailableTriples returns authorUserId');
  }

  // ─── listAvailableTriples with instrumentId filter ────────
  {
    const { service, db } = createService({
      'available': [],
    });
    await service.listAvailableTriples('user-1', 'i1');
    const query = db.queries.find(q => q.sql.includes('available'));
    assert(query !== undefined, 'listAvailableTriples executes query');
    assert(query!.params.includes('i1'), 'listAvailableTriples passes instrumentId filter');
    assert(query!.sql.includes('i.id = $2'), 'listAvailableTriples includes instrument filter clause');
  }

  // ─── seedStarterTriples (fires when zero rows) ────────────
  {
    const { service, db } = createService({
      'SELECT 1 FROM prediction.user_enabled_triples': [],
      'INSERT INTO prediction.user_enabled_triples': [],
    });
    await service.seedStarterTriples('user-1');
    const insertQuery = db.queries.find(q => q.sql.includes('CROSS JOIN'));
    assert(insertQuery !== undefined, 'seedStarterTriples inserts base analyst × top 5 instruments');
    assert(insertQuery!.sql.includes('LIMIT 5'), 'seedStarterTriples limits to 5 instruments');
  }

  // ─── seedStarterTriples (does NOT fire when rows exist) ───
  {
    const { service, db } = createService({
      'SELECT 1 FROM prediction.user_enabled_triples': [{ '?column?': 1 }],
    });
    await service.seedStarterTriples('user-1');
    const insertQuery = db.queries.find(q => q.sql.includes('CROSS JOIN'));
    assert(insertQuery === undefined, 'seedStarterTriples skips insert when user has existing rows');
  }

  // ─── Summary ───────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
