/**
 * Per-scenario seed/cleanup helpers for the markets integration test runner.
 *
 * Each scenario has its own user_id so cleanup is scoped per test user.
 *
 * The seed creates: instrument, three personality analysts (Macro Strategist,
 * Technical Analyst, Sentiment Analyst — display names match the LLM stub
 * keys), explicit instrument↔analyst assignments (so the runner takes the
 * "explicit assignment" branch in PredictionRunnerService.getAnalystsForRun
 * and never picks up __base__ analysts), and one source assignment per
 * analyst pointing at a fixture key that exists on disk.
 */

import type { DatabaseService } from '@orchestratorai/planes/database';
import type { MarketsService } from '../../../src/markets/markets.service';

export type ScenarioName = 'bullish' | 'bearish' | 'split' | 'partial-failure';

export interface ScenarioSpec {
  name: ScenarioName;
  symbol: 'AAPL' | 'TSLA' | 'NVDA' | 'MSFT';
  description: string;
}

export const SCENARIOS: ScenarioSpec[] = [
  { name: 'bullish',         symbol: 'AAPL', description: 'all three analysts agree UP' },
  { name: 'bearish',         symbol: 'TSLA', description: 'all three analysts agree DOWN' },
  { name: 'split',           symbol: 'NVDA', description: 'analysts disagree, arbitrator FLAT' },
  { name: 'partial-failure', symbol: 'MSFT', description: 'Macro Strategist throws, runner records partial failure' },
];

export interface SeedResult {
  userId: string;
  instrumentId: string;
  analystIds: { macro: string; technical: string; sentiment: string };
}

const TEST_USER_ID = '00000000-0000-4000-8000-00000000beef';

// Display names MUST match the keys in
// apps/api/tests/fixtures/markets/llm/responses.json — see StubLlmService.
// Source assignment dataTypes MUST sort to a key that matches a fixture file
// under apps/api/tests/fixtures/markets/<provider>/.
const ANALYST_SOURCE_PLAN: Array<{
  slug: string;
  displayName: string;
  persona: string;
  sourceId: string;
  dataTypes: string[];
}> = [
  {
    slug: 'macro-strategist',
    displayName: 'Macro Strategist',
    persona: 'Top-down macro view focused on rates, inflation, and growth.',
    sourceId: 'ds-fred',
    dataTypes: ['cpi', 'yield-curve'],
  },
  {
    slug: 'technical-analyst',
    displayName: 'Technical Analyst',
    persona: 'Pure technical analysis on momentum and trend indicators.',
    sourceId: 'ds-twelve-data',
    dataTypes: ['rsi', 'macd'],
  },
  {
    slug: 'sentiment-analyst',
    displayName: 'Sentiment Analyst',
    persona: 'Reads social and news sentiment for narrative momentum.',
    sourceId: 'ds-reddit',
    dataTypes: ['sentiment'],
  },
];

export async function seedScenario(
  service: MarketsService,
  db: DatabaseService,
  scenario: ScenarioSpec,
): Promise<SeedResult> {
  const scenarioSlug = `integration-test-${scenario.name}`;
  const userId = TEST_USER_ID;

  // Wipe any leftover state from a previous interrupted run for this scenario.
  await cleanupScenario(db, scenarioSlug);

  const instrument = await service.createInstrument({
    userId,
    symbol: scenario.symbol,
    name: scenario.symbol,
    assetType: 'stock',
  });

  const analystIds: SeedResult['analystIds'] = { macro: '', technical: '', sentiment: '' };

  for (const plan of ANALYST_SOURCE_PLAN) {
    const analyst = await service.createAnalyst({
      userId,
      slug: plan.slug,
      displayName: plan.displayName,
      personaPrompt: plan.persona,
    });
    await service.assignAnalystToInstrument({
      userId,
      instrumentId: instrument.id,
      analystId: analyst.id,
    });

    // Insert one source assignment with a dataTypes array that maps directly
    // to a captured fixture file. This bypasses the __base__ default
    // assignments, which use broader dataTypes that don't match captured keys.
    const insertAssignment = await db.rawQuery(
      `insert into prediction.analyst_source_assignments
         (id, analyst_id, source_id, data_types, priority)
       values (gen_random_uuid()::text, $1, $2, $3, 1)
       on conflict (analyst_id, source_id) do update
         set data_types = excluded.data_types`,
      [analyst.id, plan.sourceId, plan.dataTypes],
    );
    if (insertAssignment.error) {
      throw new Error(`seed source assignment for ${plan.slug}: ${insertAssignment.error.message}`);
    }

    if (plan.slug === 'macro-strategist') analystIds.macro = analyst.id;
    if (plan.slug === 'technical-analyst') analystIds.technical = analyst.id;
    if (plan.slug === 'sentiment-analyst') analystIds.sentiment = analyst.id;
  }

  return { userId, instrumentId: instrument.id, analystIds };
}

/**
 * Delete every markets row owned by this scenario user. Order matches FK
 * dependencies — children first.
 */
export async function cleanupScenario(db: DatabaseService, _scenarioSlug: string): Promise<void> {
  const userId = '00000000-0000-4000-8000-00000000beef';
  const tables = [
    'prediction.trade_recommendations',
    'prediction.market_predictions',
    'prediction.market_run_artifacts',
    'prediction.orchestration_runs',
    'prediction.market_instrument_analyst_assignments',
    'prediction.analyst_config_versions',
    'prediction.market_analysts',
    'prediction.instruments',
  ];
  for (const table of tables) {
    const result = await db.rawQuery(`delete from ${table} where user_id = $1`, [userId]);
    if (result.error && !/does not exist/.test(result.error.message) && !/column "user_id" does not exist/.test(result.error.message)) {
      throw new Error(`cleanup ${table}: ${result.error.message}`);
    }
  }
  // analyst_source_assignments is keyed by analyst_id, not org — but the
  // analyst rows are gone above, and the FK cascades.
}
