/**
 * Generate structured markdown contract documents for __base__ analysts.
 *
 * For each analyst, reads the existing persona_prompt + sample resolved
 * predictions, calls gemma4:e4b via Ollama to generate a structured contract
 * (## General, ## Role: X, ## Adaptations), validates structurally, and
 * creates a v2 config version row with context_markdown populated.
 *
 * Idempotent — skips analysts whose active config version already has
 * non-null context_markdown.
 *
 * Usage: node_modules/.pnpm/node_modules/.bin/tsx scripts/generate-analyst-contracts.ts
 *
 * Effort: analyst-contracts
 */
import { randomUUID } from 'crypto';
import pg from 'pg';
import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config({ path: join(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }

const OLLAMA_URL = process.env.OLLAMA_LOCAL_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_DEFAULT_MODEL || 'gemma4:e4b';

const TARGET_SLUGS = [
  'fundamentals-analyst',
  'macro-strategist',
  'momentum-analyst',
  'sentiment-analyst',
  'technical-analyst',
  'arbitrator',
  'portfolio-manager',
];

const ROLE_MAP: Record<string, string> = {
  personality: 'Analyst',
  arbitrator: 'Arbitrator',
  portfolio_manager: 'Portfolio Manager',
};

const FORBIDDEN_PHRASES = [
  'as an ai',
  'i cannot',
  'i apologize',
  "i'm sorry",
  'advice',
  'recommendation',
  'recommend',
];

interface AnalystRow {
  id: string;
  slug: string;
  analyst_type: string;
  persona_prompt: string;
  tier_instructions: Record<string, string> | null;
  current_config_version_id: string | null;
}

interface PredictionSample {
  rationale: string;
  predicted_direction: string;
  confidence: number;
  actual_direction: string;
  was_correct: boolean;
  change_percent: number | null;
}

// ─── LLM Call ───────────────────────────────────────────────────

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

// ─── Prompt Builder ─────────────────────────────────────────────

function buildPrompt(
  analyst: AnalystRow,
  roleName: string,
  samples: PredictionSample[],
): string {
  let prompt = `You are generating a structured context document for a financial market analyst named "${analyst.slug}".

This document will be used as the analyst's operating contract — it defines what the analyst does, how it makes decisions, and what it should avoid.

IMPORTANT RULES:
- Use "analysis" and "signal", NEVER "advice" or "recommendation"
- Do NOT include phrases like "as an AI", "I cannot", "I apologize"
- Write in third person about the analyst (e.g., "This analyst focuses on...")
- Be concrete and specific, not generic

The analyst's current persona description is:
"""
${analyst.persona_prompt}
"""
`;

  if (analyst.tier_instructions && Object.keys(analyst.tier_instructions).length > 0) {
    prompt += `\nTier instructions (analysis depth by subscription tier):\n`;
    for (const [tier, instruction] of Object.entries(analyst.tier_instructions)) {
      prompt += `- ${tier}: ${instruction}\n`;
    }
  }

  if (samples.length > 0) {
    prompt += `\nHere are ${samples.length} recent prediction examples with outcomes:\n`;
    for (const s of samples) {
      const outcome = s.was_correct ? 'CORRECT' : 'WRONG';
      const delta = s.change_percent !== null && s.change_percent !== undefined ? ` (Δ ${Number(s.change_percent).toFixed(2)}%)` : '';
      prompt += `- Predicted ${s.predicted_direction} (conf ${s.confidence}%) → Actual ${s.actual_direction} [${outcome}]${delta}\n  Rationale: ${s.rationale.slice(0, 300)}...\n\n`;
    }
  } else {
    prompt += `\nNo prediction samples are available for this analyst. Generate the contract from the persona description alone.\n`;
  }

  prompt += `
Generate the document with EXACTLY this structure:

> v1 placeholder context, machine-authored, intended to be replaced by domain-expert review.

## General

[Write 2-4 paragraphs about the analyst's worldview, analytical philosophy, what it prioritizes, language and tone constraints. Include: "This analyst produces analysis and signals, not financial advice or recommendations." Include known failure modes or blind spots if apparent from the examples.]

## Role: ${roleName}

[Write 2-3 paragraphs about how this analyst performs its specific role. What data does it weigh? What patterns does it look for? What are examples of good vs poor reasoning in this role? What should it avoid?]

## Adaptations

[Leave this section empty except for the text: "Reserved for learning-engine adaptations."]

Output ONLY the markdown document. Do not include any preamble or explanation outside the document.`;

  return prompt;
}

// ─── Validation ─────────────────────────────────────────────────

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

  // Check General section has substance
  const generalMatch = contract.split('## General')[1];
  if (generalMatch) {
    const nextSection = generalMatch.indexOf('\n## ');
    const generalBody = nextSection >= 0 ? generalMatch.slice(0, nextSection) : generalMatch;
    if (generalBody.trim().length < 100) errors.push('## General section is too short (<100 chars)');
  }

  return { ok: errors.length === 0, errors };
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    for (const slug of TARGET_SLUGS) {
      console.log(`\n── ${slug} ──`);

      // Read analyst
      const { rows: analysts } = await client.query(
        `SELECT ma.id, ma.slug, ma.analyst_type, ma.persona_prompt, ma.tier_instructions,
                ma.current_config_version_id
         FROM prediction.market_analysts ma
         WHERE ma.slug = $1 AND ma.user_id IS NULL
         LIMIT 1`,
        [slug],
      );
      if (analysts.length === 0) { console.log('  SKIP — not found'); continue; }
      const analyst = analysts[0] as AnalystRow;

      // Check if already has context_markdown
      if (analyst.current_config_version_id) {
        const { rows: existing } = await client.query(
          `SELECT context_markdown FROM prediction.analyst_config_versions WHERE id = $1`,
          [analyst.current_config_version_id],
        );
        if (existing.length > 0 && existing[0].context_markdown) {
          console.log('  SKIP — already has context_markdown');
          continue;
        }
      }

      // Get prediction samples (personality analysts only)
      let samples: PredictionSample[] = [];
      const roleName = ROLE_MAP[analyst.analyst_type] || 'Analyst';
      if (analyst.analyst_type === 'personality') {
        const { rows: preds } = await client.query(
          `SELECT mp.rationale, mp.predicted_direction, mp.confidence,
                  phe.actual_direction, phe.was_correct,
                  (phe.actual_outcome_data->>'changePercent')::numeric as change_percent
           FROM prediction.prediction_horizon_evaluations phe
           JOIN prediction.market_predictions mp ON mp.id = phe.prediction_id
           WHERE phe.analyst_id = $1 AND phe.user_id IS NULL
           ORDER BY phe.evaluation_date DESC LIMIT 10`,
          [analyst.id],
        );
        samples = preds as PredictionSample[];
      }

      console.log(`  Role: ${roleName}, Samples: ${samples.length}`);
      console.log(`  Calling ${MODEL}...`);

      // Generate contract
      const prompt = buildPrompt(analyst, roleName, samples);
      let contract = await callOllama(prompt);

      // Post-process: replace forbidden financial language that local models
      // stubbornly generate despite being told not to. The legal-language rule
      // is "analysis/signal, never advice/recommendation."
      contract = contract
        .replace(/\bfinancial advice\b/gi, 'financial analysis')
        .replace(/\binvestment advice\b/gi, 'investment analysis')
        .replace(/\btrading advice\b/gi, 'trading analysis')
        .replace(/\bprovide advice\b/gi, 'provide analysis')
        .replace(/\bgive advice\b/gi, 'provide analysis')
        .replace(/\boffer advice\b/gi, 'provide analysis')
        .replace(/\badvice\b/gi, 'analysis')
        .replace(/\brecommendations?\b/gi, 'assessments')
        .replace(/\brecommends?\b/gi, 'assesses')
        .replace(/\brecommending\b/gi, 'assessing');

      // Ensure placeholder header is present exactly once (local models often
      // omit it, but sometimes include it — deduplicate to avoid double headers).
      const HEADER = '> v1 placeholder context, machine-authored, intended to be replaced by domain-expert review.';
      // Strip any existing header lines the model generated
      contract = contract.replace(/^> v1 placeholder[^\n]*\n*/gm, '').trimStart();
      // Prepend the canonical header exactly once
      contract = HEADER + '\n\n' + contract;

      // Validate
      let { ok, errors } = validate(contract);
      if (!ok) {
        console.log(`  Validation failed (attempt 1): ${errors.join(', ')}`);
        console.log('  Retrying with correction...');
        const correctionPrompt = `The previous output had these problems: ${errors.join('; ')}.\n\nPlease fix them and regenerate the document. Remember:\n- Start with "> v1 placeholder context, machine-authored, intended to be replaced by domain-expert review."\n- Include ## General, ## Role: ${roleName}, and ## Adaptations sections\n- Never use "advice", "recommendation", "as an AI", "I cannot", "I apologize"\n\nOriginal prompt:\n${prompt}`;
        contract = await callOllama(correctionPrompt);
        ({ ok, errors } = validate(contract));
        if (!ok) {
          console.error(`  FAIL — validation failed after retry: ${errors.join(', ')}`);
          continue;
        }
      }

      console.log('  Validation passed.');

      // Read v1 config to carry forward persona_prompt etc.
      const { rows: v1Rows } = await client.query(
        `SELECT id, persona_prompt, tier_instructions, default_weight
         FROM prediction.analyst_config_versions WHERE id = $1`,
        [analyst.current_config_version_id],
      );
      if (v1Rows.length === 0) {
        console.error('  FAIL — no current config version found (run bootstrap first)');
        continue;
      }
      const v1 = v1Rows[0];

      // Create v2
      const v2Id = randomUUID();
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO prediction.analyst_config_versions
          (id, analyst_id, user_id, version_number, persona_prompt,
           tier_instructions, default_weight, config_overrides, context_markdown,
           source, change_reason, parent_version_id, is_active, created_by, created_at)
         VALUES ($1, $2, NULL,
           (SELECT COALESCE(MAX(version_number), 0) + 1 FROM prediction.analyst_config_versions WHERE analyst_id = $2),
           $3, $4, $5, '{}'::jsonb, $6,
           'manual', 'AI-scaffolded structured contract', $7, true, 'system', $8)`,
        [v2Id, analyst.id, v1.persona_prompt, JSON.stringify(v1.tier_instructions), v1.default_weight, contract, v1.id, now],
      );

      // Deactivate v1
      await client.query(
        `UPDATE prediction.analyst_config_versions SET is_active = false WHERE id = $1`,
        [v1.id],
      );

      // Wire v2
      await client.query(
        `UPDATE prediction.market_analysts SET current_config_version_id = $1 WHERE id = $2`,
        [v2Id, analyst.id],
      );

      console.log(`  OK — v2 created (${v2Id}), v1 deactivated, current wired.`);
      console.log('\n--- CONTRACT ---');
      console.log(contract.slice(0, 500) + (contract.length > 500 ? '\n... [truncated]' : ''));
      console.log('--- END ---\n');
    }

    // Final verification
    const { rows: check } = await client.query(
      `SELECT ma.slug, acv.version_number, length(acv.context_markdown) as md_len
       FROM prediction.market_analysts ma
       JOIN prediction.analyst_config_versions acv ON acv.id = ma.current_config_version_id
       WHERE ma.user_id IS NULL AND ma.slug = ANY($1)
       ORDER BY ma.slug`,
      [TARGET_SLUGS],
    );
    console.log(`\nVerification: ${check.filter((r: { md_len: number | null }) => r.md_len && r.md_len > 0).length}/7 have context_markdown.`);
    for (const r of check) {
      const row = r as { slug: string; version_number: number; md_len: number | null };
      console.log(`  ${row.slug}: v${row.version_number}, context_markdown=${row.md_len ?? 'NULL'} chars`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Generation failed:', err);
  process.exit(1);
});
