/**
 * Unit tests for ActiveAuthorshipService
 * Tests pre-billing author activation and authored analyst/instrument listing.
 */
import { ActiveAuthorshipService } from '../../src/markets/services/active-authorship.service';

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

// ─── Mock DB ──────────────────────────────────────────────────

function createMockDb(responses: Record<string, any>) {
  return {
    rawQuery: async (sql: string, params: any[] = []) => {
      for (const [key, value] of Object.entries(responses)) {
        if (sql.includes(key)) {
          return { data: value };
        }
      }
      return { data: [] };
    },
  };
}

function createMockSchema() {
  return {
    ensureSchema: async () => {},
  };
}

function createService(dbResponses: Record<string, any> = {}) {
  const db = createMockDb(dbResponses);
  const schema = createMockSchema();
  const service = Object.create(ActiveAuthorshipService.prototype);
  (service as any).db = db;
  (service as any).schema = schema;
  (service as any).logger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return { service: service as ActiveAuthorshipService, db };
}

async function main(): Promise<void> {
  console.log('\n=== ActiveAuthorshipService Tests ===\n');

  // ─── isAuthorActive ────────────────────────────────────────
  {
    const { service } = createService();
    const result = await service.isAuthorActive('user-123');
    assert(result === true, 'isAuthorActive returns true for any userId (pre-billing)');
  }

  {
    const { service } = createService();
    const result = await service.isAuthorActive(null as any);
    assert(result === false, 'isAuthorActive returns false for null userId');
  }

  {
    const { service } = createService();
    const result = await service.isAuthorActive(undefined as any);
    assert(result === false, 'isAuthorActive returns false for undefined userId');
  }

  // ─── listActiveAuthoredAnalysts ────────────────────────────
  {
    const wiredAnalysts = [
      { id: 'a1', slug: 'my-analyst', display_name: 'My Analyst', user_id: 'author-1', current_config_version_id: 'v1', viewer_user_id: 'viewer-1' },
      { id: 'a2', slug: 'other-analyst', display_name: 'Other', user_id: 'author-2', current_config_version_id: 'v2', viewer_user_id: 'viewer-2' },
    ];
    const { service } = createService({
      'viewer_instrument_analyst_assignments': wiredAnalysts,
    });
    const result = await service.listActiveAuthoredAnalysts('inst-1');
    assert(result.length === 2, 'listActiveAuthoredAnalysts returns wired authored analysts');
    assert(result[0].slug === 'my-analyst', 'listActiveAuthoredAnalysts returns correct analyst data');
  }

  {
    const { service } = createService({});
    const result = await service.listActiveAuthoredAnalysts('inst-1');
    assert(result.length === 0, 'listActiveAuthoredAnalysts returns empty array when none wired');
  }

  // ─── listActiveAuthoredInstruments ─────────────────────────
  {
    const instruments = [
      { id: 'i1', symbol: 'CUSTOM1', name: 'Custom One', asset_type: 'stock', user_id: 'author-1' },
    ];
    const { service } = createService({
      'user_id IS NOT NULL': instruments,
    });
    const result = await service.listActiveAuthoredInstruments();
    assert(result.length === 1, 'listActiveAuthoredInstruments returns authored instruments');
    assert(result[0].symbol === 'CUSTOM1', 'listActiveAuthoredInstruments returns correct data');
  }

  // ─── Summary ───────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
