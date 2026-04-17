/**
 * Unit tests for RiskDebateService.resolveParticipants()
 * Tests viewer-scoped participant resolution for risk debates.
 */
import { RiskDebateService } from '../../src/markets/services/risk-debate.service';

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

interface QueryCall {
  sql: string;
  params: any[];
}

function createMockDb(responses: Record<string, any>) {
  const calls: QueryCall[] = [];
  return {
    calls,
    rawQuery: async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      for (const [key, value] of Object.entries(responses)) {
        if (sql.includes(key)) {
          return { data: value };
        }
      }
      return { data: [] };
    },
  };
}

function createService(dbResponses: Record<string, any> = {}) {
  const db = createMockDb(dbResponses);
  const service = Object.create(RiskDebateService.prototype);
  (service as any).db = db;
  (service as any).llmService = {};
  (service as any).observability = { push: async () => {} };
  (service as any).logger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return { service: service as RiskDebateService, db };
}

async function main(): Promise<void> {
  console.log('\n=== RiskDebateService resolveParticipants Tests ===\n');

  // ─── Base-only when viewerUserId is null ───────────────────
  {
    const baseAnalysts = [
      { id: 'b1', slug: 'fundamental', display_name: 'Fundamental Analyst' },
      { id: 'b2', slug: 'technical', display_name: 'Technical Analyst' },
    ];
    const { service } = createService({
      'user_id IS NULL': baseAnalysts,
    });
    const result = await service.resolveParticipants(null, 'inst-1');
    assert(result.baseAnalysts.length === 2, 'resolveParticipants returns base analysts when viewerUserId is null');
    assert(result.authoredAnalysts.length === 0, 'resolveParticipants returns empty authored when viewerUserId is null');
  }

  // ─── Includes authored analysts for authoring viewer ───────
  {
    const baseAnalysts = [
      { id: 'b1', slug: 'fundamental', display_name: 'Fundamental Analyst' },
    ];
    const authoredAnalysts = [
      { id: 'a1', slug: 'my-custom', display_name: 'My Custom Analyst' },
    ];
    const { service } = createService({
      'user_id IS NULL': baseAnalysts,
      'viewer_instrument_analyst_assignments': authoredAnalysts,
    });
    const result = await service.resolveParticipants('viewer-user-1', 'inst-1');
    assert(result.baseAnalysts.length === 1, 'resolveParticipants returns base analysts for viewer');
    assert(result.authoredAnalysts.length === 1, 'resolveParticipants includes authored analysts for authoring viewer');
    assert(result.authoredAnalysts[0].slug === 'my-custom', 'resolveParticipants returns correct authored analyst data');
  }

  // ─── No authored analysts wired → empty array ─────────────
  {
    const baseAnalysts = [
      { id: 'b1', slug: 'fundamental', display_name: 'Fundamental Analyst' },
    ];
    const { service } = createService({
      'user_id IS NULL': baseAnalysts,
    });
    const result = await service.resolveParticipants('viewer-user-1', 'inst-1');
    assert(result.baseAnalysts.length === 1, 'resolveParticipants returns base even when no authored wired');
    assert(result.authoredAnalysts.length === 0, 'resolveParticipants returns empty authored when none wired');
  }

  // ─── Verifies viewer_user_id is passed as param ────────────
  {
    const { service, db } = createService({
      'user_id IS NULL': [{ id: 'b1', slug: 'x', display_name: 'X' }],
    });
    await service.resolveParticipants('my-viewer-id', 'my-inst-id');
    const authoredCall = db.calls.find(c => c.sql.includes('viewer_instrument_analyst_assignments'));
    assert(!!authoredCall, 'resolveParticipants queries viewer_instrument_analyst_assignments');
    assert(authoredCall!.params[0] === 'my-viewer-id', 'resolveParticipants passes viewerUserId as first param');
    assert(authoredCall!.params[1] === 'my-inst-id', 'resolveParticipants passes instrumentId as second param');
  }

  // ─── Summary ───────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
