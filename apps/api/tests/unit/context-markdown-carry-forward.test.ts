/**
 * Tests that the context_markdown carry-forward subselect works correctly.
 * Executes real SQL against the dev database to verify the pattern used in
 * activatePaperMode, createMarketAnalyst, and updateMarketAnalyst.
 *
 * Effort: analyst-contracts.
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import * as dotenv from 'dotenv';
import { join } from 'path';
import { randomUUID } from 'crypto';

dotenv.config({ path: join(__dirname, '../../../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  // Use a synthetic analyst_id that won't collide with real data
  const testAnalystId = `test-carry-forward-${randomUUID()}`;
  const now = new Date().toISOString();

  try {
    // Setup: create a config version WITH context_markdown
    const v1Id = randomUUID();
    const testMarkdown = '## General\n\nTest contract.\n\n## Role: Analyst\n\nTest role.\n\n## Adaptations\n\nReserved.';
    await client.query(
      `INSERT INTO prediction.analyst_config_versions
        (id, analyst_id, organization_slug, version_number, persona_prompt,
         context_markdown, source, change_reason, is_active, created_by, created_at)
       VALUES ($1, $2, '__test__', 1, 'test prompt', $3, 'manual', 'test setup', true, 'test', $4)`,
      [v1Id, testAnalystId, testMarkdown, now],
    );

    // Test 1: carry-forward subselect (simulates updateMarketAnalyst / activatePaperMode)
    const v2Id = randomUUID();
    await client.query(
      `INSERT INTO prediction.analyst_config_versions
        (id, analyst_id, organization_slug, version_number, persona_prompt,
         context_markdown,
         source, change_reason, is_active, created_by, created_at)
       VALUES ($1, $2, '__test__', 2, 'updated prompt',
         (SELECT context_markdown FROM prediction.analyst_config_versions
          WHERE analyst_id = $2 AND context_markdown IS NOT NULL
          ORDER BY version_number DESC LIMIT 1),
         'tier1_auto', 'test carry-forward', false, 'test', $3)`,
      [v2Id, testAnalystId, now],
    );

    const { rows: v2Rows } = await client.query(
      `SELECT context_markdown FROM prediction.analyst_config_versions WHERE id = $1`,
      [v2Id],
    );
    assert.equal(v2Rows.length, 1);
    assert.equal(v2Rows[0].context_markdown, testMarkdown, 'v2 should carry forward context_markdown from v1');
    console.log('PASS  carry-forward subselect copies context_markdown from prior version');

    // Test 2: new analyst (no prior context_markdown) → NULL is correct
    const newAnalystId = `test-new-${randomUUID()}`;
    const v3Id = randomUUID();
    await client.query(
      `INSERT INTO prediction.analyst_config_versions
        (id, analyst_id, organization_slug, version_number, persona_prompt,
         context_markdown,
         source, change_reason, is_active, created_by, created_at)
       VALUES ($1, $2, '__test__', 1, 'new prompt',
         (SELECT context_markdown FROM prediction.analyst_config_versions
          WHERE analyst_id = $2 AND context_markdown IS NOT NULL
          ORDER BY version_number DESC LIMIT 1),
         'manual', 'new analyst', true, 'test', $3)`,
      [v3Id, newAnalystId, now],
    );

    const { rows: v3Rows } = await client.query(
      `SELECT context_markdown FROM prediction.analyst_config_versions WHERE id = $1`,
      [v3Id],
    );
    assert.equal(v3Rows.length, 1);
    assert.equal(v3Rows[0].context_markdown, null, 'new analyst with no prior versions should have NULL context_markdown');
    console.log('PASS  new analyst (no prior versions) gets NULL context_markdown');

    // Test 3: carry-forward skips versions with NULL context_markdown
    const v4Id = randomUUID();
    // Insert a version WITHOUT context_markdown between v1 and this one
    const v3MiddleId = randomUUID();
    await client.query(
      `INSERT INTO prediction.analyst_config_versions
        (id, analyst_id, organization_slug, version_number, persona_prompt,
         context_markdown, source, change_reason, is_active, created_by, created_at)
       VALUES ($1, $2, '__test__', 3, 'middle prompt', NULL, 'tier1_auto', 'no contract', false, 'test', $3)`,
      [v3MiddleId, testAnalystId, now],
    );
    await client.query(
      `INSERT INTO prediction.analyst_config_versions
        (id, analyst_id, organization_slug, version_number, persona_prompt,
         context_markdown,
         source, change_reason, is_active, created_by, created_at)
       VALUES ($1, $2, '__test__', 4, 'v4 prompt',
         (SELECT context_markdown FROM prediction.analyst_config_versions
          WHERE analyst_id = $2 AND context_markdown IS NOT NULL
          ORDER BY version_number DESC LIMIT 1),
         'tier1_auto', 'test skip null', false, 'test', $3)`,
      [v4Id, testAnalystId, now],
    );

    const { rows: v4Rows } = await client.query(
      `SELECT context_markdown FROM prediction.analyst_config_versions WHERE id = $1`,
      [v4Id],
    );
    assert.equal(v4Rows[0].context_markdown, testMarkdown, 'carry-forward should skip NULL versions and find the last non-null');
    console.log('PASS  carry-forward skips NULL versions and finds the last non-null');

    console.log('\nAll carry-forward tests passed.');
  } finally {
    // Cleanup test data
    await client.query(
      `DELETE FROM prediction.analyst_config_versions WHERE organization_slug = '__test__'`,
    );
    await client.end();
  }
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exitCode = 1;
});
