/**
 * Bootstrap initial analyst_config_versions rows for __base__ analysts.
 *
 * Creates v1 config version rows from the existing persona_prompt, tier_instructions,
 * and default_weight on each market_analysts row. Wires current_config_version_id.
 *
 * Idempotent — skips analysts that already have a current_config_version_id.
 *
 * Usage: npx tsx scripts/bootstrap-analyst-versions.ts
 *
 * Effort: analyst-contracts
 */
import { randomUUID } from 'crypto';
import pg from 'pg';
import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config({ path: join(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required in .env');
  process.exit(1);
}

const TARGET_SLUGS = [
  'fundamentals-analyst',
  'macro-strategist',
  'momentum-analyst',
  'sentiment-analyst',
  'technical-analyst',
  'arbitrator',
  'portfolio-manager',
  // Day traders (effort: day-trader-contracts)
  'gap-and-go',
  'mean-reversion',
  'momentum-breakout',
];

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    for (const slug of TARGET_SLUGS) {
      // Read analyst
      const { rows: analysts } = await client.query(
        `SELECT id, persona_prompt, tier_instructions, default_weight, current_config_version_id
         FROM prediction.market_analysts
         WHERE slug = $1 AND user_id IS NULL
         LIMIT 1`,
        [slug],
      );

      if (analysts.length === 0) {
        console.log(`  SKIP ${slug} — not found in market_analysts`);
        continue;
      }

      const analyst = analysts[0];
      if (analyst.current_config_version_id) {
        console.log(`  SKIP ${slug} — already has config version ${analyst.current_config_version_id}`);
        continue;
      }

      const versionId = randomUUID();
      const now = new Date().toISOString();

      // Create v1 config version
      await client.query(
        `INSERT INTO prediction.analyst_config_versions
          (id, analyst_id, user_id, version_number, persona_prompt,
           tier_instructions, default_weight, config_overrides,
           source, change_reason, is_active, created_by, created_at)
         VALUES ($1, $2, NULL, 1, $3, $4, $5, '{}'::jsonb,
                 'manual', 'Bootstrap initial config version', true, 'system', $6)`,
        [versionId, analyst.id, analyst.persona_prompt, JSON.stringify(analyst.tier_instructions), analyst.default_weight, now],
      );

      // Wire current_config_version_id
      await client.query(
        `UPDATE prediction.market_analysts SET current_config_version_id = $1 WHERE id = $2`,
        [versionId, analyst.id],
      );

      console.log(`  OK   ${slug} → config version ${versionId} (v1)`);
    }

    // Verify
    const { rows: check } = await client.query(
      `SELECT ma.slug, acv.id, acv.version_number
       FROM prediction.market_analysts ma
       JOIN prediction.analyst_config_versions acv ON acv.id = ma.current_config_version_id
       WHERE ma.user_id IS NULL AND ma.slug = ANY($1)
       ORDER BY ma.slug`,
      [TARGET_SLUGS],
    );
    console.log(`\nVerification: ${check.length}/7 analysts have config versions.`);
    for (const r of check) {
      console.log(`  ${r.slug}: v${r.version_number} (${r.id})`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
