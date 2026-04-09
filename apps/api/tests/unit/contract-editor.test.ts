/**
 * Unit tests for contract editor API methods on MarketsService.
 * Tests getAnalystContract and saveAnalystContract.
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
}

// Stub schema service — ensureSchema is a no-op in tests
class MockSchema {
  async ensureSchema() {}
}

// Stub RBAC — always allow
class MockRbac {
  async hasPermission() { return true; }
}

const CONTRACT_MD = `## General
You are Alpha, a fundamental analyst focused on value investing.

## Role: analyst
Evaluate companies based on intrinsic value, P/E ratios, and balance sheet strength.

## Adaptations
No adaptations yet.`;

async function main(): Promise<void> {
  console.log('\n=== Contract Editor Tests ===\n');

  // 1. getAnalystContract returns active contract with parsed sections and versions
  console.log('getAnalystContract:');
  {
    const db = new MockDb([
      // ensureSchema — no call needed, it's on MockSchema
      // 1st query: analyst metadata
      {
        data: [{
          id: 'ma-alpha',
          display_name: 'Alpha Analyst',
          current_config_version_id: 'cv-2',
        }],
        error: null,
      },
      // 2nd query: all config versions
      {
        data: [
          {
            id: 'cv-2', version_number: 2, source: 'manual',
            change_reason: 'Clarified rules', created_by: 'admin',
            created_at: '2026-04-08T10:00:00Z', is_active: true,
            context_markdown: CONTRACT_MD,
          },
          {
            id: 'cv-1', version_number: 1, source: 'manual',
            change_reason: 'Initial creation', created_by: 'admin',
            created_at: '2026-04-01T10:00:00Z', is_active: false,
            context_markdown: '## General\nOld version.',
          },
        ],
        error: null,
      },
    ]);

    const svc = new MarketsService(db as any, null as any, null as any, null as any, new MockSchema() as any, null as any, null as any, null as any, null as any, null as any, null as any);
    const result = await svc.getAnalystContract('ma-alpha', 'test-org');

    assert(result.analystId === 'ma-alpha', 'analystId returned');
    assert(result.displayName === 'Alpha Analyst', 'displayName returned');
    assert(result.activeVersionId === 'cv-2', 'activeVersionId returned');
    assert(result.contract !== null, 'contract is not null');
    assert(result.contract!.markdown === CONTRACT_MD, 'contract markdown matches');
    assert(result.contract!.sections.general.includes('value investing'), 'general section parsed');
    assert('analyst' in result.contract!.sections.roles, 'analyst role parsed');
    assert(result.contract!.sections.adaptations.includes('No adaptations'), 'adaptations parsed');
    assert(result.versions.length === 2, 'returns 2 versions');
    assert(result.versions[0].id === 'cv-2', 'first version is newest (DESC order)');
    assert(result.versions[0].isActive === true, 'active version flagged');
    assert(result.versions[1].isActive === false, 'old version not active');
    assert(result.versions[0].source === 'manual', 'source carried through');
    assert(result.versions[1].contextMarkdown === '## General\nOld version.', 'old version markdown returned');
  }

  // 2. getAnalystContract with no contract (null context_markdown)
  console.log('\ngetAnalystContract (no contract):');
  {
    const db = new MockDb([
      {
        data: [{ id: 'ma-empty', display_name: 'Empty', current_config_version_id: 'cv-x' }],
        error: null,
      },
      {
        data: [{
          id: 'cv-x', version_number: 1, source: 'manual',
          change_reason: null, created_by: null,
          created_at: '2026-04-01T10:00:00Z', is_active: true,
          context_markdown: null,
        }],
        error: null,
      },
    ]);

    const svc = new MarketsService(db as any, null as any, null as any, null as any, new MockSchema() as any, null as any, null as any, null as any, null as any, null as any, null as any);
    const result = await svc.getAnalystContract('ma-empty', 'test-org');

    assert(result.contract === null, 'contract is null when no context_markdown');
    assert(result.versions.length === 1, 'still returns versions');
    assert(result.versions[0].contextMarkdown === null, 'version contextMarkdown is null');
  }

  // 3. saveAnalystContract creates new version and returns updated data
  console.log('\nsaveAnalystContract:');
  {
    const newMd = '## General\nUpdated contract.\n\n## Adaptations\nNone.';
    const db = new MockDb([
      // ensureSchema no-op
      // 1st: requireWrite check (access service stub handles this, but rawQuery for the role check)
      // Actually, requireWrite uses the access service, not rawQuery. Let's trace the calls.
      // saveAnalystContract calls:
      //   1. ensureSchema (MockSchema)
      //   2. requireWrite (uses access service)
      //   3. rawQuery: load analyst + active version
      {
        data: [{
          id: 'ma-alpha', current_config_version_id: 'cv-2',
          persona_prompt: 'You are Alpha', tier_instructions: null,
          default_weight: 1.0, version_number: 2,
        }],
        error: null,
      },
      // 4. rawQuery: deactivate current version
      { data: [], error: null },
      // 5. rawQuery: insert new version
      { data: [], error: null },
      // 6. rawQuery: update market_analysts pointer
      { data: [], error: null },
      // 7–8. getAnalystContract re-fetch (analyst + versions)
      {
        data: [{ id: 'ma-alpha', display_name: 'Alpha Analyst', current_config_version_id: 'cv-new' }],
        error: null,
      },
      {
        data: [
          {
            id: 'cv-new', version_number: 3, source: 'manual',
            change_reason: 'Test save', created_by: 'admin',
            created_at: '2026-04-09T12:00:00Z', is_active: true,
            context_markdown: newMd,
          },
          {
            id: 'cv-2', version_number: 2, source: 'manual',
            change_reason: 'Prior edit', created_by: 'admin',
            created_at: '2026-04-08T10:00:00Z', is_active: false,
            context_markdown: CONTRACT_MD,
          },
        ],
        error: null,
      },
    ]);

    const svc = new MarketsService(db as any, null as any, new MockRbac() as any, null as any, new MockSchema() as any, null as any, null as any, null as any, null as any, null as any, null as any);
    const result = await svc.saveAnalystContract({
      analystId: 'ma-alpha',
      organizationSlug: 'test-org',
      userId: 'admin',
      markdown: newMd,
      changeReason: 'Test save',
    });

    assert(result.activeVersionId === 'cv-new', 'activeVersionId updated to new version');
    assert(result.contract !== null, 'contract returned');
    assert(result.contract!.markdown === newMd, 'contract markdown is the new edit');
    assert(result.versions.length === 2, 'version history returned');
    assert(result.versions[0].isActive === true, 'new version is active');
    assert(result.versions[1].isActive === false, 'old version deactivated');

    // Verify the SQL calls
    const deactivateCall = db.calls.find(c => c.sql.includes('is_active = false'));
    assert(deactivateCall !== undefined, 'deactivate query was called');
    assert(deactivateCall!.params[0] === 'cv-2', 'deactivated the correct version');

    const insertCall = db.calls.find(c => c.sql.includes('INSERT INTO prediction.analyst_config_versions'));
    assert(insertCall !== undefined, 'insert query was called');
    assert(insertCall!.params.includes(newMd), 'new markdown passed to insert');
    assert(insertCall!.params.includes('cv-2'), 'parent_version_id points to old version');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
