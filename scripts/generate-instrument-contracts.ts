/**
 * Generate v1 stage-keyed instrument contracts for base instruments.
 *
 * For each base instrument (user_id IS NULL AND is_active = true) without an
 * existing scripts/contracts-v4/instruments/<symbol>.md file, calls gemma4:26b
 * via Ollama to generate a draft contract with the 8 sections defined by the
 * instrument-contracts PRD §4.1. Writes the draft to disk for human review.
 *
 * Idempotent — skips symbols whose draft file already exists.
 * Serial execution — Ollama is single-tenant on this machine.
 *
 * Usage:
 *   tsx scripts/generate-instrument-contracts.ts
 *
 * Effort: instrument-contracts (Phase 2).
 */
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: join(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const OLLAMA_URL = process.env.OLLAMA_LOCAL_URL || 'http://localhost:11434';
const MODEL = process.env.INSTRUMENT_CONTRACT_MODEL || 'gemma4:26b';

const OUT_DIR = join(__dirname, 'contracts-v4', 'instruments');

interface InstrumentRow {
  id: string;
  symbol: string;
  name: string;
  asset_type: string;
  universe_slug: string;
}

async function callOllama(prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { response: string };
  return data.response;
}

function buildPrompt(instrument: InstrumentRow): string {
  return `You are authoring a v1 operating contract for the financial instrument ${instrument.symbol} (${instrument.name}, asset_type=${instrument.asset_type}, universe=${instrument.universe_slug}).

This contract is how our pipeline reasons about ${instrument.symbol} at every stage. It describes what ${instrument.symbol} specifically cares about — sector context, peer dynamics, regulatory sensitivities, decision criteria for article relevance, prediction framing — everything that differentiates ${instrument.symbol} from any other stock.

STRICT RULES:
- Use "analysis" and "signal", NEVER "advice" or "recommendation".
- Do NOT include phrases "as an AI", "I cannot", "I apologize", "I'm sorry".
- Write in third person about the instrument (e.g., "${instrument.symbol} is...").
- Each section body must be non-empty. If a stage genuinely needs no instrument-specific framing, write: "Apply General rules unchanged at this stage; no instrument-specific adaptations." DO NOT leave any section empty.
- Output PLAIN MARKDOWN only. No preamble, no code fences, no commentary.
- The output MUST start with "## General" and include EXACTLY these 8 section headings in order:
  ## General
  ## Stage: Article Processing
  ## Stage: Predictor Generation
  ## Stage: Risk Assessment — Reflection (3a)
  ## Stage: Risk Assessment — Debate (3b)
  ## Stage: Prediction Generation
  ## Stage: Learning
  ## Adaptations

SECTION GUIDANCE:

## General
2-4 paragraphs. Sector, peer set, what makes ${instrument.symbol} tick, major structural factors (regulatory, geopolitical, supply chain, etc.). This applies to EVERY stage.

## Stage: Article Processing
This is UNIQUE to instrument contracts. Decision criteria for "is this article relevant to me?"
- What keywords/topics signal genuine relevance to ${instrument.symbol}?
- What topics LOOK related but are decoys (e.g., unrelated companies sharing words, sector noise)?
- What articles matter for ${instrument.symbol} even without explicit mention of the ticker?
Write this section as concrete, actionable decision rules.

## Stage: Predictor Generation
Instrument-specific framing for extracting predictors from relevant articles. Which article dimensions matter most for ${instrument.symbol}? Earnings, product cycles, regulatory filings, competitor moves, macro factors?

## Stage: Risk Assessment — Reflection (3a)
Instrument-specific risk dimensions to track when reflecting on new predictors for ${instrument.symbol}. What uncertainties matter most? What risks are unique to this instrument?

## Stage: Risk Assessment — Debate (3b)
Instrument-specific framing for the Red/Blue/Arbiter debate about ${instrument.symbol}. What arguments should be weighted heavily? What should be discounted?

## Stage: Prediction Generation
Instrument-specific framing for issuing directional predictions on ${instrument.symbol}. Volatility regime, earnings cadence, sector beta, typical reaction windows.

## Stage: Learning
Instrument-specific lessons to internalize from prediction outcomes. What patterns are worth watching for in ${instrument.symbol}? What historical episodes should inform future predictions?

## Adaptations
Leave this section with the seed text: "No adaptations yet. The learning loop will append entries here after predictions resolve."

Output the full markdown now, starting with "## General":
`;
}

function assertRequiredHeadings(md: string, symbol: string): void {
  const required = [
    '## General',
    '## Stage: Article Processing',
    '## Stage: Predictor Generation',
    '## Stage: Risk Assessment',
    '## Stage: Prediction Generation',
    '## Stage: Learning',
    '## Adaptations',
  ];
  for (const r of required) {
    if (!md.includes(r)) {
      throw new Error(`[${symbol}] generated contract missing heading: ${r}`);
    }
  }
}

async function getBaseInstruments(client: pg.Client): Promise<InstrumentRow[]> {
  const res = await client.query<InstrumentRow>(
    `SELECT id, symbol, name, asset_type, universe_slug
     FROM prediction.instruments
     WHERE user_id IS NULL AND is_active = true
     ORDER BY symbol`,
  );
  return res.rows;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const instruments = await getBaseInstruments(client);
    console.log(`Found ${instruments.length} base instruments`);

    for (const instrument of instruments) {
      const outPath = join(OUT_DIR, `${instrument.symbol}.md`);
      if (existsSync(outPath)) {
        console.log(`SKIP  ${instrument.symbol} — draft already exists at ${outPath}`);
        continue;
      }

      console.log(`GEN   ${instrument.symbol} (${instrument.name}) — calling ${MODEL}…`);
      const started = Date.now();
      let draft: string;
      try {
        draft = await callOllama(buildPrompt(instrument));
      } catch (err) {
        console.error(`FAIL  ${instrument.symbol} — Ollama error: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);

      // Strip any preamble before the first "## General".
      const generalIdx = draft.indexOf('## General');
      const cleaned = generalIdx >= 0 ? draft.slice(generalIdx).trim() + '\n' : draft.trim() + '\n';

      try {
        assertRequiredHeadings(cleaned, instrument.symbol);
      } catch (err) {
        console.error(`FAIL  ${instrument.symbol} — ${err instanceof Error ? err.message : String(err)}`);
        writeFileSync(outPath + '.rejected', cleaned, 'utf8');
        console.error(`      raw output saved to ${outPath}.rejected for inspection`);
        continue;
      }

      writeFileSync(outPath, cleaned, 'utf8');
      console.log(`OK    ${instrument.symbol} — ${cleaned.length} chars in ${elapsed}s → ${outPath}`);
    }
  } finally {
    await client.end();
  }

  console.log('\nDone. Review each file under scripts/contracts-v4/instruments/ before running upgrade-instrument-contracts-v1.ts.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
