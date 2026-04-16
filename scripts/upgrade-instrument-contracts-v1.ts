/**
 * Upgrade base instruments to v1 stage-keyed contracts.
 *
 * Reads markdown files from scripts/contracts-v4/instruments/<symbol>.md,
 * validates each against the instrument required-section policy
 * (validateContractSections(sections, 'instrument')) AND forbids `TODO:`
 * substrings, and inserts/activates a new instrument_config_versions row per
 * file.
 *
 * Transactional per instrument. Aborts the whole batch if any file fails
 * validation. Idempotent: skips an instrument whose active config already
 * parses to a non-empty articleProcessing section (i.e., this script ran
 * previously).
 *
 * Usage:
 *   tsx scripts/upgrade-instrument-contracts-v1.ts [--dry-run]
 *
 * Effort: instrument-contracts (Phase 2).
 */
import { randomUUID } from 'crypto';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import pg from 'pg';
import * as dotenv from 'dotenv';
import {
  parseContractMarkdown,
  validateContractSections,
} from '../apps/api/src/markets/utils/parse-contract-markdown';

dotenv.config({ path: join(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const CONTRACTS_DIR = join(__dirname, 'contracts-v4', 'instruments');
const DRY_RUN = process.argv.includes('--dry-run');

interface Draft {
  symbol: string;
  path: string;
  markdown: string;
}

interface InstrumentRow {
  id: string;
  symbol: string;
  current_config_version_id: string | null;
}

interface ActiveConfigRow {
  id: string;
  version_number: number;
  context_markdown: string | null;
}

function loadDrafts(): Draft[] {
  if (!existsSync(CONTRACTS_DIR)) {
    console.error(`No drafts directory at ${CONTRACTS_DIR} — run scripts/generate-instrument-contracts.ts first.`);
    process.exit(1);
  }
  const files = readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith('.md'));
  if (files.length === 0) {
    console.error(`No .md drafts in ${CONTRACTS_DIR} — run scripts/generate-instrument-contracts.ts first.`);
    process.exit(1);
  }
  return files.map((file) => {
    const symbol = file.replace(/\.md$/, '');
    const path = join(CONTRACTS_DIR, file);
    const markdown = readFileSync(path, 'utf8');
    return { symbol, path, markdown };
  });
}

function validateDraft(draft: Draft): void {
  // Gate 1: structural validation via the shared validator.
  const sections = parseContractMarkdown(draft.markdown);
  const result = validateContractSections(sections, 'instrument');
  if (!result.valid) {
    const parts: string[] = [];
    if (result.missingSections.length) parts.push(`missing=[${result.missingSections.join(', ')}]`);
    if (result.forbiddenPhrases.length) parts.push(`forbidden=[${result.forbiddenPhrases.join(', ')}]`);
    if (result.extraSections.length) parts.push(`extra=[${result.extraSections.join(', ')}]`);
    throw new Error(`[${draft.symbol}] invalid contract: ${parts.join(' ')}`);
  }
  // Gate 2: no TODO: placeholder text anywhere.
  if (/todo:/i.test(draft.markdown)) {
    throw new Error(`[${draft.symbol}] contains TODO: placeholder — review before upgrading`);
  }
}

async function findInstrumentBySymbol(client: pg.Client, symbol: string): Promise<InstrumentRow | null> {
  const res = await client.query<InstrumentRow>(
    `SELECT id, symbol, current_config_version_id
     FROM prediction.instruments
     WHERE symbol = $1 AND user_id IS NULL
     LIMIT 1`,
    [symbol],
  );
  return res.rows[0] ?? null;
}

async function findActiveConfig(client: pg.Client, instrumentId: string): Promise<ActiveConfigRow | null> {
  const res = await client.query<ActiveConfigRow>(
    `SELECT id, version_number, context_markdown
     FROM prediction.instrument_config_versions
     WHERE instrument_id = $1 AND is_active = true
     LIMIT 1`,
    [instrumentId],
  );
  return res.rows[0] ?? null;
}

async function main(): Promise<void> {
  const drafts = loadDrafts();
  console.log(`Found ${drafts.length} draft contracts in ${CONTRACTS_DIR}`);

  // ─── Pass 1: validate everything before touching the DB ──────
  console.log('\n--- Validation pass ---');
  for (const draft of drafts) {
    validateDraft(draft);
    console.log(`OK    ${draft.symbol} — passed validation`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] validation passed for all drafts; no DB writes.');
    return;
  }

  // ─── Pass 2: apply per-instrument ────────────────────────────
  console.log('\n--- Applying ---');
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    for (const draft of drafts) {
      const instrument = await findInstrumentBySymbol(client, draft.symbol);
      if (!instrument) {
        console.warn(`WARN  ${draft.symbol} — no matching instrument row; skipping`);
        continue;
      }

      const prior = await findActiveConfig(client, instrument.id);

      // Re-run safety: if the active config already has a non-empty
      // articleProcessing section, we've already upgraded this instrument.
      if (prior?.context_markdown) {
        const priorSections = parseContractMarkdown(prior.context_markdown);
        if (priorSections.stages.articleProcessing.trim().length > 0) {
          console.log(`SKIP  ${draft.symbol} — active config already v1 (has Article Processing)`);
          continue;
        }
      }

      const newId = randomUUID();
      const newVersionNumber = (prior?.version_number ?? 0) + 1;

      await client.query('BEGIN');
      try {
        if (prior) {
          await client.query(
            `UPDATE prediction.instrument_config_versions SET is_active = false WHERE id = $1`,
            [prior.id],
          );
        }
        await client.query(
          `INSERT INTO prediction.instrument_config_versions
             (id, instrument_id, version_number, context_markdown, source, change_reason, parent_version_id, is_active, created_by)
           VALUES ($1, $2, $3, $4, 'manual', 'instrument contract v1 bootstrap', $5, true, 'system')`,
          [newId, instrument.id, newVersionNumber, draft.markdown, prior?.id ?? null],
        );
        await client.query(
          `UPDATE prediction.instruments SET current_config_version_id = $1 WHERE id = $2`,
          [newId, instrument.id],
        );
        await client.query('COMMIT');
        console.log(`OK    ${draft.symbol} — inserted v${newVersionNumber} (${newId})`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.end();
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
