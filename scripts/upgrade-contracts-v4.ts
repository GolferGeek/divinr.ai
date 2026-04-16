/**
 * Upgrade 7 base analyst contracts to v4 (stage-keyed shape) — authored by Claude Opus 4.6.
 *
 * Reads contract markdown files from scripts/contracts-v4/<slug>.md, validates each
 * against per-analyst-type required-section policy, and (if --dry-run is not set)
 * inserts a new analyst_config_versions row for each analyst.
 *
 * Idempotent: skips an analyst whose active config already parses to at least one
 * `## Stage:` section.
 *
 * Usage:
 *   tsx scripts/upgrade-contracts-v4.ts [--dry-run]
 *
 * Effort: stage-keyed-analyst-contracts.
 */
import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import pg from 'pg';
import * as dotenv from 'dotenv';
import {
  parseContractMarkdown,
  validateContractSections,
  type AnalystType,
} from '../apps/api/src/markets/utils/parse-contract-markdown';

dotenv.config({ path: join(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const CONTRACTS_DIR = join(__dirname, 'contracts-v4');
const DRY_RUN = process.argv.includes('--dry-run');

/** Map DB analyst_type → validator AnalystType. Day-trader is out of scope. */
const TYPE_MAP: Record<string, AnalystType> = {
  personality: 'personality',
  arbitrator: 'arbitrator',
  portfolio_manager: 'portfolio_manager',
};

interface AnalystRow {
  id: string;
  slug: string;
  analyst_type: string;
  persona_prompt: string;
  current_config_version_id: string;
  paper_config_version_id: string | null;
  tier_instructions: unknown;
  default_weight: number | string;
  version_number: number | null;
  active_context_markdown: string | null;
}

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const files = readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith('.md'));
    console.log(`Found ${files.length} v4 contract files${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

    // 1. Validate every file up front — abort the whole batch on any failure.
    const validated: Array<{ slug: string; contract: string; analystType: AnalystType }> = [];
    for (const file of files) {
      const slug = file.replace(/\.md$/, '');
      const contract = readFileSync(join(CONTRACTS_DIR, file), 'utf-8');
      const sections = parseContractMarkdown(contract);

      const { rows } = await client.query<AnalystRow>(
        `SELECT ma.id, ma.slug, ma.analyst_type, ma.persona_prompt,
                ma.current_config_version_id, ma.paper_config_version_id,
                acv.tier_instructions, acv.default_weight, acv.version_number,
                acv.context_markdown AS active_context_markdown
         FROM prediction.market_analysts ma
         JOIN prediction.analyst_config_versions acv ON acv.id = ma.current_config_version_id
         WHERE ma.slug = $1 AND ma.user_id IS NULL`,
        [slug],
      );
      if (rows.length === 0) {
        console.log(`SKIP ${slug} — analyst row not found`);
        continue;
      }
      const analyst = rows[0];
      const analystType = TYPE_MAP[analyst.analyst_type];
      if (!analystType) {
        console.log(`SKIP ${slug} — analyst_type '${analyst.analyst_type}' out of scope for this effort`);
        continue;
      }

      const result = validateContractSections(sections, analystType);
      if (!result.valid) {
        console.error(`INVALID ${slug} (${analystType})`);
        console.error(`  missing:   ${JSON.stringify(result.missingSections)}`);
        console.error(`  forbidden: ${JSON.stringify(result.forbiddenPhrases)}`);
        console.error(`  extra:     ${JSON.stringify(result.extraSections)}`);
        console.error('\nAborting batch — no DB mutations performed.');
        process.exit(1);
      }
      validated.push({ slug, contract, analystType });
    }
    console.log(`All ${validated.length} files valid.\n`);

    // 2. Apply each validated file.
    for (const { slug, contract } of validated) {
      const { rows } = await client.query<AnalystRow>(
        `SELECT ma.id, ma.slug, ma.analyst_type, ma.persona_prompt,
                ma.current_config_version_id, ma.paper_config_version_id,
                acv.tier_instructions, acv.default_weight, acv.version_number,
                acv.context_markdown AS active_context_markdown
         FROM prediction.market_analysts ma
         JOIN prediction.analyst_config_versions acv ON acv.id = ma.current_config_version_id
         WHERE ma.slug = $1 AND ma.user_id IS NULL`,
        [slug],
      );
      const analyst = rows[0];

      // Idempotence: if active config already parses to any non-empty stage section, skip.
      const activeSections = parseContractMarkdown(analyst.active_context_markdown ?? '');
      const alreadyStageKeyed = Object.values(activeSections.stages).some((s) => s.trim().length > 0);
      if (alreadyStageKeyed) {
        console.log(`SKIP ${slug} — already stage-keyed (v${analyst.version_number})`);
        continue;
      }

      const v4Id = randomUUID();
      const nextVersion = (analyst.version_number ?? 3) + 1;

      if (DRY_RUN) {
        console.log(
          `DRY-RUN ${slug}: would create v${nextVersion} (${v4Id}), ${contract.length} chars, parent=${analyst.current_config_version_id}`,
        );
        continue;
      }

      await client.query(
        `INSERT INTO prediction.analyst_config_versions
          (id, analyst_id, version_number, persona_prompt,
           tier_instructions, default_weight, config_overrides, context_markdown,
           source, change_reason, parent_version_id, is_active, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7,
                 'manual', 'stage-keyed v4 bootstrap', $8, true, 'claude-opus-4.6', now())`,
        [
          v4Id,
          analyst.id,
          nextVersion,
          analyst.persona_prompt,
          JSON.stringify(analyst.tier_instructions ?? {}),
          analyst.default_weight,
          contract,
          analyst.current_config_version_id,
        ],
      );
      await client.query(
        `UPDATE prediction.analyst_config_versions SET is_active = false WHERE id = $1`,
        [analyst.current_config_version_id],
      );
      await client.query(
        `UPDATE prediction.market_analysts SET current_config_version_id = $1 WHERE id = $2`,
        [v4Id, analyst.id],
      );
      // Paper config: if it was the same as the prior active, point it at the new v4.
      if (analyst.paper_config_version_id === analyst.current_config_version_id) {
        await client.query(
          `UPDATE prediction.market_analysts SET paper_config_version_id = $1 WHERE id = $2`,
          [v4Id, analyst.id],
        );
      }
      console.log(`OK  ${slug} → v${nextVersion} (${v4Id}), ${contract.length} chars`);
    }

    // 3. Verification summary.
    const { rows: check } = await client.query<{
      slug: string;
      version_number: number;
      md_len: number;
      created_by: string;
      change_reason: string;
    }>(
      `SELECT ma.slug, acv.version_number, length(acv.context_markdown) AS md_len,
              acv.created_by, acv.change_reason
       FROM prediction.market_analysts ma
       JOIN prediction.analyst_config_versions acv ON acv.id = ma.current_config_version_id
       WHERE ma.user_id IS NULL
         AND ma.slug IN ('fundamentals-analyst','macro-strategist','momentum-analyst',
                         'sentiment-analyst','technical-analyst','arbitrator','portfolio-manager')
       ORDER BY ma.slug`,
    );
    console.log(`\nVerification: ${check.length}/7`);
    for (const r of check) {
      console.log(`  ${r.slug}: v${r.version_number}, ${r.md_len} chars, ${r.created_by}, "${r.change_reason}"`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
