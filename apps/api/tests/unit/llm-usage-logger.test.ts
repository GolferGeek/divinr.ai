/**
 * Unit tests for LlmUsageLogger.
 * Uses an in-memory stub for DatabaseService to verify INSERT behavior.
 */
import type { LlmTextResult, LlmUsageContext } from '../../src/markets/services/markets-llm.service';
import { LlmUsageLogger } from '../../src/markets/services/llm-usage-logger.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

interface InsertedRow { sql: string; params: unknown[] }

const insertedRows: InsertedRow[] = [];
let rawQueryShouldThrow: Error | null = null;
let pricingRows: Array<{ model_name: string; provider_name: string; pricing_info_json: { input_per_1k: number; output_per_1k: number } | null }> = [];

function stubRawQuery(sql: string, params?: unknown[]) {
  const trimmed = sql.replace(/\s+/g, ' ').trim();

  if (trimmed.includes('FROM public.llm_models')) {
    return { data: pricingRows, error: null };
  }

  if (trimmed.startsWith('INSERT INTO prediction.llm_usage_log')) {
    if (rawQueryShouldThrow) throw rawQueryShouldThrow;
    insertedRows.push({ sql: trimmed, params: params ?? [] });
    return { data: null, error: null };
  }

  return { data: null, error: null };
}

const stubDb = { rawQuery: stubRawQuery } as any;

function createLogger(): InstanceType<typeof LlmUsageLogger> {
  const logger = Object.create(LlmUsageLogger.prototype);
  logger.db = stubDb;
  logger.logger = { error: () => {}, log: () => {}, warn: () => {} };
  logger.pricingCache = new Map();
  logger.cacheLoadedAt = 0;
  return logger;
}

async function main(): Promise<void> {
  console.log('\n=== LLM Usage Logger Tests ===\n');

  // Test 1: record() produces a well-formed INSERT
  console.log('INSERT shape:');
  {
    insertedRows.length = 0;
    rawQueryShouldThrow = null;
    pricingRows = [];

    const logger = createLogger();
    const result: LlmTextResult = { text: 'hello world', provider: 'anthropic', model: 'claude-sonnet-4-6' };
    const context: LlmUsageContext = {
      stage: 'prediction_generation',
      subStage: 'arbitrator_synthesis',
      instrumentId: 'inst-1',
      analystId: 'analyst-1',
      cycleId: 'cycle-1',
    };

    const id = await logger.record(result, context, 150, 'system\nuser prompt', 100, 50);
    assert(id !== null, 'record() returns a non-null ID');
    assert(insertedRows.length === 1, 'exactly one INSERT executed');

    const params = insertedRows[0].params;
    assert(params[7] === 'prediction_generation', 'stage is correct');
    assert(params[8] === 'arbitrator_synthesis', 'sub_stage is correct');
    assert(params[9] === 'claude-sonnet-4-6', 'model is correct');
    assert(params[10] === 'anthropic', 'provider is correct');
    assert(params[11] === false, 'via_byo_key is false');
    assert(params[12] === 100, 'tokens_in is correct');
    assert(params[13] === 50, 'tokens_out is correct');
    assert(typeof params[16] === 'string' && (params[16] as string).length === 64, 'prompt_hash is 64-char hex');
    assert(typeof params[17] === 'string' && (params[17] as string).length === 64, 'output_hash is 64-char hex');
    assert(params[18] === 'cycle-1', 'cycle_id is correct');
  }

  // Test 2: cost_cents is NULL when provider is ollama_local
  console.log('\nLocal provider cost:');
  {
    insertedRows.length = 0;
    rawQueryShouldThrow = null;
    pricingRows = [
      { model_name: 'gemma4:e4b', provider_name: 'ollama_local', pricing_info_json: { input_per_1k: 0.001, output_per_1k: 0.002 } },
    ];

    const logger = createLogger();
    const result: LlmTextResult = { text: 'local output', provider: 'ollama_local', model: 'gemma4:e4b' };
    const context: LlmUsageContext = { stage: 'article_processing' };

    await logger.record(result, context, 200, 'prompt', 500, 200);
    const params = insertedRows[0].params;
    assert(params[14] === null, 'cost_cents is NULL for ollama_local');
  }

  // Test 3: cost_cents is populated for commercial providers
  console.log('\nCommercial provider cost:');
  {
    insertedRows.length = 0;
    rawQueryShouldThrow = null;
    pricingRows = [
      { model_name: 'claude-sonnet-4-6', provider_name: 'anthropic', pricing_info_json: { input_per_1k: 0.003, output_per_1k: 0.015 } },
    ];

    const logger = createLogger();

    const result: LlmTextResult = { text: 'commercial output', provider: 'anthropic', model: 'claude-sonnet-4-6' };
    const context: LlmUsageContext = { stage: 'prediction_generation' };

    await logger.record(result, context, 300, 'prompt', 1000, 500);
    const params = insertedRows[0].params;
    assert(typeof params[14] === 'number' && (params[14] as number) > 0, 'cost_cents is populated for commercial provider');
  }

  // Test 4: Error calls record with error field
  console.log('\nError field:');
  {
    insertedRows.length = 0;
    rawQueryShouldThrow = null;
    pricingRows = [];

    const logger = createLogger();
    const result: LlmTextResult = { text: '', provider: 'anthropic', model: 'claude-sonnet-4-6' };
    const context: LlmUsageContext = { stage: 'risk_debate', subStage: 'blue' };

    await logger.record(result, context, 500, 'prompt', 0, 0, 'Connection timeout');
    const params = insertedRows[0].params;
    assert(params[19] === 'Connection timeout', 'error field is populated');
  }

  // Test 5: INSERT failure is caught and logged, not thrown
  console.log('\nINSERT failure resilience:');
  {
    insertedRows.length = 0;
    rawQueryShouldThrow = new Error('DB connection lost');
    pricingRows = [];

    const logger = createLogger();
    const result: LlmTextResult = { text: 'ok', provider: 'ollama_local', model: 'gemma4:e4b' };
    const context: LlmUsageContext = { stage: 'learning' };

    let threw = false;
    try {
      const id = await logger.record(result, context, 100, 'prompt', 50, 20);
      assert(id === null, 'returns null on INSERT failure');
    } catch {
      threw = true;
    }
    assert(!threw, 'INSERT failure does not throw');
    rawQueryShouldThrow = null;
  }

  // Summary
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
