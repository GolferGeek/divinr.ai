/**
 * Generate structured strategy specification contracts for day-trader analysts.
 *
 * Reads each strategy's source code and asks gemma4:26b to produce a
 * human-readable contract describing the algorithm's behavior.
 *
 * Idempotent — skips analysts whose active config version already has
 * non-null context_markdown.
 *
 * Usage: node_modules/.pnpm/node_modules/.bin/tsx scripts/generate-day-trader-contracts.ts
 *
 * Effort: day-trader-contracts
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: join(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }

const OLLAMA_URL = process.env.OLLAMA_LOCAL_URL || 'http://localhost:11434';
const MODEL = 'gemma4:26b';

const STRATEGIES = [
  {
    slug: 'gap-and-go',
    file: 'apps/api/src/markets/strategies/gap-and-go.strategy.ts',
    name: 'Gap and Go',
  },
  {
    slug: 'mean-reversion',
    file: 'apps/api/src/markets/strategies/mean-reversion.strategy.ts',
    name: 'Mean Reversion',
  },
  {
    slug: 'momentum-breakout',
    file: 'apps/api/src/markets/strategies/momentum-breakout.strategy.ts',
    name: 'Momentum Breakout',
  },
];

const CONVICTION_MODIFIER_DOC = `
Shared conviction modifier (used by all strategies):
- If no signal available → sizing multiplier = 1.0 (neutral)
- If signal direction is 'flat' AND confidence > 70% → VETO (no open, returns null)
- Otherwise: confidence 0..100 maps linearly to sizing multiplier 0.5..1.5
`;

const EOD_DOC = `
End-of-day behavior:
- At 22:00 UTC (last tick of session), ALL open day-trader positions are force-closed
  at the last cached price, regardless of strategy state.
- Strategies are NOT consulted during EOD forced close.
`;

const FORBIDDEN_PHRASES = [
  'as an ai', 'i cannot', 'i apologize', "i'm sorry",
  'advice', 'recommendation', 'recommend',
];

const LEGAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bfinancial advice\b/gi, 'financial analysis'],
  [/\binvestment advice\b/gi, 'investment analysis'],
  [/\badvice\b/gi, 'analysis'],
  [/\brecommendations?\b/gi, 'assessments'],
  [/\brecommends?\b/gi, 'assesses'],
  [/\brecommending\b/gi, 'assessing'],
];

async function callOllama(prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json() as { response: string };
  return data.response;
}

function buildPrompt(strategyName: string, sourceCode: string): string {
  return `You are generating a strategy specification document for an algorithmic day-trading strategy called "${strategyName}".

This document describes what the algorithm does — it is NOT an LLM prompt, it is a human-readable specification. The algorithm is hard-coded in TypeScript; this contract documents its behavior so a human can understand it without reading code.

IMPORTANT RULES:
- Use "analysis" and "signal", NEVER "advice" or "recommendation"
- Do NOT include phrases like "as an AI", "I cannot", "I apologize"
- Write in third person about the strategy (e.g., "This strategy enters when...")
- Be precise about the exact entry/exit conditions from the source code
- Include actual numeric thresholds and constants

STRATEGY SOURCE CODE:
"""
${sourceCode}
"""

${CONVICTION_MODIFIER_DOC}

${EOD_DOC}

Generate the document with EXACTLY this structure:

> v1 placeholder context, machine-authored, intended to be replaced by domain-expert review.

## General

[Write 2-3 paragraphs: what this strategy is, its risk philosophy, what market conditions it is designed for, how it fits into the broader system (reads signals from personality analysts for conviction, manages positions directly, force-closed at EOD). Note that this strategy produces signals and analysis, not financial advice.]

## Role: Day Trader

[Write 3-4 paragraphs with exact details:
- Entry conditions: exact trigger rules with numeric thresholds from the code
- Exit conditions: exact trigger rules
- Position sizing: how the conviction modifier affects sizing (0.5x-1.5x range)
- Signal veto: when a flat signal with >70% confidence prevents entry
- State management: what state persists between ticks
- EOD behavior: forced close at 22:00 UTC
- Key constants with their values]

## Adaptations

[Leave empty except: "Reserved for learning-engine adaptations."]

Output ONLY the markdown document.`;
}

function validate(contract: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!contract.includes('## General')) errors.push('Missing ## General');
  if (!/## Role: /.test(contract)) errors.push('Missing ## Role: section');
  if (!contract.includes('## Adaptations')) errors.push('Missing ## Adaptations');
  if (!contract.includes('> v1 placeholder')) errors.push('Missing placeholder header');
  const lower = contract.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (lower.includes(phrase)) errors.push(`Contains forbidden phrase: "${phrase}"`);
  }
  const generalMatch = contract.split('## General')[1];
  if (generalMatch) {
    const nextSection = generalMatch.indexOf('\n## ');
    const generalBody = nextSection >= 0 ? generalMatch.slice(0, nextSection) : generalMatch;
    if (generalBody.trim().length < 100) errors.push('## General too short');
  }
  return { ok: errors.length === 0, errors };
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    for (const strategy of STRATEGIES) {
      console.log(`\n── ${strategy.slug} ──`);

      // Read analyst
      const { rows: analysts } = await client.query(
        `SELECT ma.id, ma.current_config_version_id
         FROM prediction.market_analysts ma
         WHERE ma.slug = $1 AND ma.organization_slug = '__base__'`,
        [strategy.slug],
      );
      if (analysts.length === 0) { console.log('  SKIP — not found'); continue; }
      const analyst = analysts[0];

      // Check existing contract
      if (analyst.current_config_version_id) {
        const { rows: existing } = await client.query(
          `SELECT context_markdown FROM prediction.analyst_config_versions WHERE id = $1`,
          [analyst.current_config_version_id],
        );
        if (existing[0]?.context_markdown) {
          console.log('  SKIP — already has context_markdown');
          continue;
        }
      }

      // Read strategy source
      const sourcePath = join(__dirname, '..', strategy.file);
      const sourceCode = readFileSync(sourcePath, 'utf-8');
      console.log(`  Source: ${strategy.file} (${sourceCode.length} chars)`);
      console.log(`  Calling ${MODEL}...`);

      // Generate
      let contract = await callOllama(buildPrompt(strategy.name, sourceCode));

      // Post-process
      for (const [regex, replacement] of LEGAL_REPLACEMENTS) {
        contract = contract.replace(regex, replacement);
      }
      const HEADER = '> v1 placeholder context, machine-authored, intended to be replaced by domain-expert review.';
      contract = contract.replace(/^> v1 placeholder[^\n]*\n*/gm, '').trimStart();
      contract = HEADER + '\n\n' + contract;

      // Validate
      let { ok, errors } = validate(contract);
      if (!ok) {
        console.log(`  Validation failed: ${errors.join(', ')}. Retrying...`);
        contract = await callOllama(`Fix these issues: ${errors.join('; ')}.\n\n${buildPrompt(strategy.name, sourceCode)}`);
        for (const [regex, replacement] of LEGAL_REPLACEMENTS) {
          contract = contract.replace(regex, replacement);
        }
        contract = contract.replace(/^> v1 placeholder[^\n]*\n*/gm, '').trimStart();
        contract = HEADER + '\n\n' + contract;
        ({ ok, errors } = validate(contract));
        if (!ok) { console.error(`  FAIL: ${errors.join(', ')}`); continue; }
      }

      console.log('  Validation passed.');

      // Read v1 config
      const { rows: v1Rows } = await client.query(
        `SELECT id, persona_prompt, tier_instructions, default_weight
         FROM prediction.analyst_config_versions WHERE id = $1`,
        [analyst.current_config_version_id],
      );
      if (v1Rows.length === 0) { console.error('  FAIL — no v1 config'); continue; }
      const v1 = v1Rows[0];

      // Create v2
      const v2Id = randomUUID();
      await client.query(
        `INSERT INTO prediction.analyst_config_versions
          (id, analyst_id, organization_slug, version_number, persona_prompt,
           tier_instructions, default_weight, config_overrides, context_markdown,
           source, change_reason, parent_version_id, is_active, created_by, created_at)
         VALUES ($1, $2, '__base__',
           (SELECT COALESCE(MAX(version_number), 0) + 1 FROM prediction.analyst_config_versions WHERE analyst_id = $2),
           $3, $4, $5, '{}'::jsonb, $6,
           'manual', 'AI-scaffolded strategy specification', $7, true, 'system', now())`,
        [v2Id, analyst.id, v1.persona_prompt, JSON.stringify(v1.tier_instructions), v1.default_weight, contract, v1.id],
      );
      await client.query(`UPDATE prediction.analyst_config_versions SET is_active = false WHERE id = $1`, [v1.id]);
      await client.query(`UPDATE prediction.market_analysts SET current_config_version_id = $1 WHERE id = $2`, [v2Id, analyst.id]);

      console.log(`  OK — v2 created (${v2Id})`);
      console.log('\n--- CONTRACT ---');
      console.log(contract.slice(0, 600) + (contract.length > 600 ? '\n... [truncated]' : ''));
      console.log('--- END ---\n');
    }

    // Verify
    const { rows: check } = await client.query(
      `SELECT ma.slug, acv.version_number, length(acv.context_markdown) as md_len
       FROM prediction.market_analysts ma
       JOIN prediction.analyst_config_versions acv ON acv.id = ma.current_config_version_id
       WHERE ma.analyst_type = 'day_trader' ORDER BY ma.slug`,
    );
    console.log(`\nVerification: ${check.filter((r: { md_len: number | null }) => r.md_len && r.md_len > 0).length}/3 have context_markdown.`);
    for (const r of check) {
      const row = r as { slug: string; version_number: number; md_len: number | null };
      console.log(`  ${row.slug}: v${row.version_number}, ${row.md_len ?? 'NULL'} chars`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error('Failed:', err); process.exit(1); });
