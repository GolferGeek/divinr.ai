/**
 * Unit tests for instrument-contract editor API methods on MarketsService.
 * Covers getInstrumentContract, validateInstrumentContract, saveInstrumentContract.
 */
import { MarketsService } from '../../src/markets/markets.service';
import { BadRequestException } from '@nestjs/common';

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

class MockSchema {
  async ensureSchema() {}
}

class MockRbac {
  async hasPermission() { return true; }
}

function makeService(db: MockDb): MarketsService {
  return new MarketsService(
    db as any,
    null as any,
    new MockRbac() as any,
    null as any,
    new MockSchema() as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
}

const FULL_CONTRACT_MD = `## General
AAPL is a mega-cap tech equity.

## Stage: Article Processing
Decoy filter: iPad stories without China context.

## Stage: Predictor Generation
Weigh China exposure.

## Stage: Risk Assessment — Reflection (3a)
Track services margin.

## Stage: Risk Assessment — Debate (3b)
Weight China-exposure arguments.

## Stage: Prediction Generation
Earnings cadence matters.

## Stage: Learning
Apply lessons from prior prints.

## Adaptations
No adaptations yet.`;

async function main(): Promise<void> {
  console.log('\n=== Instrument Contract Editor Tests ===\n');

  // 1. getInstrumentContract returns full response shape with v1 contract
  console.log('getInstrumentContract (with active contract):');
  {
    const db = new MockDb([
      {
        data: [{
          id: 'inst-aapl',
          symbol: 'AAPL',
          name: 'Apple',
          asset_type: 'stock',
          current_config_version_id: 'icv-1',
        }],
        error: null,
      },
      {
        data: [{
          id: 'icv-1',
          version_number: 1,
          source: 'manual',
          change_reason: 'instrument contract v1 bootstrap',
          created_by: 'system',
          created_at: '2026-04-10T00:00:00Z',
          is_active: true,
          context_markdown: FULL_CONTRACT_MD,
        }],
        error: null,
      },
    ]);

    const svc = makeService(db);
    const result = await svc.getInstrumentContract('inst-aapl', 'user-1');

    assert(result.instrumentId === 'inst-aapl', 'instrumentId returned');
    assert(result.symbol === 'AAPL', 'symbol returned');
    assert(result.assetType === 'stock', 'assetType returned');
    assert(result.activeVersionId === 'icv-1', 'activeVersionId returned');
    assert(Array.isArray(result.requiredSections) && result.requiredSections.length === 6, 'requiredSections has 6 stage keys');
    assert((result.requiredSections ?? []).includes('articleProcessing'), 'requiredSections includes articleProcessing');
    assert(result.contract !== null, 'contract is not null');
    assert(result.contract!.sections.stages.articleProcessing.includes('Decoy filter'), 'articleProcessing body parsed');
    assert(result.contract!.sections.general.includes('mega-cap'), 'general parsed');
    assert(result.versions.length === 1, 'returns 1 version');
    assert(result.versions[0].isActive === true, 'active version flagged');
  }

  // 2. getInstrumentContract returns contract: null when current_config_version_id is NULL
  console.log('\ngetInstrumentContract (no current_config_version_id):');
  {
    const db = new MockDb([
      {
        data: [{
          id: 'inst-x',
          symbol: 'X',
          name: 'X Corp',
          asset_type: 'stock',
          current_config_version_id: null,
        }],
        error: null,
      },
      { data: [], error: null },
    ]);

    const svc = makeService(db);
    const result = await svc.getInstrumentContract('inst-x', 'user-1');
    assert(result.contract === null, 'contract is null');
    assert(result.activeVersionId === null, 'activeVersionId is null');
    assert(result.versions.length === 0, 'no versions');
  }

  // 3. validateInstrumentContract returns valid=true for well-formed contract
  console.log('\nvalidateInstrumentContract (valid contract):');
  {
    const db = new MockDb([
      { data: [{ id: 'inst-aapl' }], error: null },
    ]);
    const svc = makeService(db);
    const result = await svc.validateInstrumentContract('inst-aapl', 'user-1', FULL_CONTRACT_MD);
    assert(result.valid === true, 'valid = true');
    assert(result.missingSections.length === 0, 'no missing sections');
    assert(result.forbiddenPhrases.length === 0, 'no forbidden phrases');
  }

  // 4. validateInstrumentContract surfaces missing Article Processing section
  console.log('\nvalidateInstrumentContract (missing Article Processing):');
  {
    const db = new MockDb([
      { data: [{ id: 'inst-aapl' }], error: null },
    ]);
    const svc = makeService(db);
    const partialMd = FULL_CONTRACT_MD.replace(
      /## Stage: Article Processing\nDecoy filter: iPad stories without China context\.\n\n/,
      '',
    );
    const result = await svc.validateInstrumentContract('inst-aapl', 'user-1', partialMd);
    assert(result.valid === false, 'valid = false');
    assert(
      result.missingSections.some(s => s.toLowerCase().includes('article processing')),
      'missingSections includes Article Processing label',
    );
  }

  // 5. validateInstrumentContract flags forbidden phrase "recommendation"
  console.log('\nvalidateInstrumentContract (forbidden phrase):');
  {
    const db = new MockDb([
      { data: [{ id: 'inst-aapl' }], error: null },
    ]);
    const svc = makeService(db);
    const badMd = FULL_CONTRACT_MD.replace(
      'AAPL is a mega-cap tech equity.',
      'AAPL is a mega-cap tech equity. Our recommendation is to hold.',
    );
    const result = await svc.validateInstrumentContract('inst-aapl', 'user-1', badMd);
    assert(result.valid === false, 'valid = false');
    assert(result.forbiddenPhrases.some(p => p.toLowerCase().includes('recommendation')), 'forbiddenPhrases includes "recommendation"');
  }

  // 6. saveInstrumentContract throws BadRequest when markdown invalid
  console.log('\nsaveInstrumentContract (invalid markdown → 400):');
  {
    const db = new MockDb([
      {
        data: [{
          id: 'inst-aapl',
          current_config_version_id: 'icv-1',
          version_number: 1,
        }],
        error: null,
      },
    ]);
    const svc = makeService(db);
    let caught: unknown = null;
    try {
      await svc.saveInstrumentContract({
        instrumentId: 'inst-aapl',
        userId: 'admin',
        markdown: '## General\nnothing else',
      });
    } catch (err) {
      caught = err;
    }
    assert(caught instanceof BadRequestException, 'throws BadRequestException');
    const response = (caught as BadRequestException | null)?.getResponse() as
      | { message?: string; missingSections?: string[]; forbiddenPhrases?: string[] }
      | undefined;
    assert(Array.isArray(response?.missingSections) && response!.missingSections!.length > 0, 'response includes missingSections');
  }

  // 7. saveInstrumentContract inserts new version, deactivates prior, flips pointer
  console.log('\nsaveInstrumentContract (happy path):');
  {
    const db = new MockDb([
      // 1. load instrument + active version
      {
        data: [{
          id: 'inst-aapl',
          current_config_version_id: 'icv-1',
          version_number: 1,
        }],
        error: null,
      },
      // 2. deactivate prior
      { data: [], error: null },
      // 3. insert new version
      { data: [], error: null },
      // 4. update instruments pointer
      { data: [], error: null },
      // 5–6. getInstrumentContract re-fetch
      {
        data: [{
          id: 'inst-aapl',
          symbol: 'AAPL',
          name: 'Apple',
          asset_type: 'stock',
          current_config_version_id: 'new-icv',
        }],
        error: null,
      },
      {
        data: [
          {
            id: 'new-icv',
            version_number: 2,
            source: 'manual',
            change_reason: 'manual edit',
            created_by: 'admin',
            created_at: '2026-04-11T00:00:00Z',
            is_active: true,
            context_markdown: FULL_CONTRACT_MD,
          },
          {
            id: 'icv-1',
            version_number: 1,
            source: 'manual',
            change_reason: 'bootstrap',
            created_by: 'system',
            created_at: '2026-04-10T00:00:00Z',
            is_active: false,
            context_markdown: FULL_CONTRACT_MD,
          },
        ],
        error: null,
      },
    ]);

    const svc = makeService(db);
    const result = await svc.saveInstrumentContract({
      instrumentId: 'inst-aapl',
      userId: 'admin',
      markdown: FULL_CONTRACT_MD,
      changeReason: 'manual edit',
    });

    assert(result.activeVersionId === 'new-icv', 'activeVersionId points to new version');
    assert(result.versions[0].versionNumber === 2, 'new version_number = prior + 1');
    assert(result.versions[0].isActive === true, 'new version active');
    assert(result.versions[1].isActive === false, 'prior deactivated');

    const deactivateCall = db.calls.find(c => c.sql.includes('is_active = false'));
    assert(deactivateCall !== undefined, 'deactivate query issued');
    assert(deactivateCall!.params[0] === 'icv-1', 'deactivated prior version');

    const insertCall = db.calls.find(c => c.sql.includes('INSERT INTO prediction.instrument_config_versions'));
    assert(insertCall !== undefined, 'insert query issued');
    assert(insertCall!.params.includes(FULL_CONTRACT_MD), 'new markdown passed to insert');
    assert(insertCall!.params.includes('icv-1'), 'parent_version_id = prior id');

    const flipCall = db.calls.find(c =>
      c.sql.includes('UPDATE prediction.instruments SET current_config_version_id'));
    assert(flipCall !== undefined, 'current_config_version_id flip issued');
  }

  // 8. saveInstrumentContract first version (no prior) sets version_number=1
  console.log('\nsaveInstrumentContract (first version, no prior):');
  {
    const db = new MockDb([
      {
        data: [{
          id: 'inst-new',
          current_config_version_id: null,
          version_number: null,
        }],
        error: null,
      },
      // no deactivate query expected because oldVersionId is null — skipped
      // 2. insert
      { data: [], error: null },
      // 3. flip pointer
      { data: [], error: null },
      // 4–5. re-fetch
      {
        data: [{
          id: 'inst-new',
          symbol: 'NEW',
          name: 'New',
          asset_type: 'stock',
          current_config_version_id: 'v1',
        }],
        error: null,
      },
      {
        data: [{
          id: 'v1',
          version_number: 1,
          source: 'manual',
          change_reason: 'Manual contract edit',
          created_by: 'admin',
          created_at: '2026-04-11T00:00:00Z',
          is_active: true,
          context_markdown: FULL_CONTRACT_MD,
        }],
        error: null,
      },
    ]);

    const svc = makeService(db);
    const result = await svc.saveInstrumentContract({
      instrumentId: 'inst-new',
      userId: 'admin',
      markdown: FULL_CONTRACT_MD,
    });

    assert(result.versions[0].versionNumber === 1, 'version_number starts at 1');
    const deactivateCall = db.calls.find(c => c.sql.includes('is_active = false'));
    assert(deactivateCall === undefined, 'no deactivate issued when no prior version');
    const insertCall = db.calls.find(c => c.sql.includes('INSERT INTO prediction.instrument_config_versions'));
    assert(insertCall !== undefined, 'insert query issued');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
