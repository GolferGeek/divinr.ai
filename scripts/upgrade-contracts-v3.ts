/**
 * Upgrade all 10 base analyst contracts to v3 — authored by Claude Opus 4.6.
 *
 * Reads contract markdown files from scripts/contracts-v3/<slug>.md and
 * creates new config version rows for each analyst.
 *
 * Usage: node_modules/.pnpm/node_modules/.bin/tsx scripts/upgrade-contracts-v3.ts
 *
 * Effort: day-trader-contracts (quality pass)
 */
import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: join(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }

const CONTRACTS_DIR = join(__dirname, 'contracts-v3');

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const files = readdirSync(CONTRACTS_DIR).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const slug = file.replace('.md', '');
      const contract = readFileSync(join(CONTRACTS_DIR, file), 'utf-8');

      const { rows: analysts } = await client.query(
        `SELECT ma.id, ma.current_config_version_id, ma.persona_prompt,
                acv.tier_instructions, acv.default_weight, acv.version_number
         FROM prediction.market_analysts ma
         JOIN prediction.analyst_config_versions acv ON acv.id = ma.current_config_version_id
         WHERE ma.slug = $1 AND ma.user_id IS NULL`,
        [slug],
      );
      if (analysts.length === 0) { console.log(`SKIP ${slug} — not found`); continue; }
      const a = analysts[0];

      const v3Id = randomUUID();
      const nextVersion = (a.version_number ?? 2) + 1;
      await client.query(
        `INSERT INTO prediction.analyst_config_versions
          (id, analyst_id, user_id, version_number, persona_prompt,
           tier_instructions, default_weight, config_overrides, context_markdown,
           source, change_reason, parent_version_id, is_active, created_by, created_at)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, '{}'::jsonb, $7,
                 'manual', 'Opus 4.6 authored contract (quality upgrade from local model)', $8, true, 'claude-opus-4.6', now())`,
        [v3Id, a.id, nextVersion, a.persona_prompt,
         JSON.stringify(a.tier_instructions), a.default_weight, contract, a.current_config_version_id],
      );
      await client.query(`UPDATE prediction.analyst_config_versions SET is_active = false WHERE id = $1`, [a.current_config_version_id]);
      await client.query(`UPDATE prediction.market_analysts SET current_config_version_id = $1 WHERE id = $2`, [v3Id, a.id]);
      console.log(`OK  ${slug} → v${nextVersion} (${v3Id}), ${contract.length} chars`);
    }

    const { rows: check } = await client.query(
      `SELECT ma.slug, acv.version_number, length(acv.context_markdown) as md_len, acv.created_by
       FROM prediction.market_analysts ma
       JOIN prediction.analyst_config_versions acv ON acv.id = ma.current_config_version_id
       WHERE ma.user_id IS NULL ORDER BY ma.slug`,
    );
    console.log(`\nVerification: ${check.length}/10`);
    for (const r of check) {
      const row = r as { slug: string; version_number: number; md_len: number; created_by: string };
      console.log(`  ${row.slug}: v${row.version_number}, ${row.md_len} chars, by ${row.created_by}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error('Failed:', err); process.exit(1); });
