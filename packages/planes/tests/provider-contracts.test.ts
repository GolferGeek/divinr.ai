import { strict as assert } from 'node:assert';
import {
  resolveDatabaseProvider,
  type DatabaseProvider,
} from '../database/provider-selection';
import {
  resolveCommercialLlmProvider,
  resolveLlmProvider,
  resolveOpenSourceLlmProvider,
  type CommercialLlmProvider,
  type LlmProvider,
  type OpenSourceLlmProvider,
} from '../llm/provider-selection';

function expectDatabaseProvider(input: string | undefined, expected: DatabaseProvider): void {
  assert.equal(resolveDatabaseProvider(input), expected);
}

function expectLlmProvider(input: string | undefined, expected: LlmProvider): void {
  assert.equal(resolveLlmProvider(input), expected);
}

function expectCommercialProvider(
  input: string | undefined,
  expected: CommercialLlmProvider,
): void {
  assert.equal(resolveCommercialLlmProvider(input), expected);
}

function expectOpenSourceProvider(
  input: string | undefined,
  expected: OpenSourceLlmProvider,
): void {
  assert.equal(resolveOpenSourceLlmProvider(input), expected);
}

function run(): void {
  // DB provider contract
  expectDatabaseProvider(undefined, 'supabase');
  expectDatabaseProvider('supabase', 'supabase');
  expectDatabaseProvider('supabase_pg', 'supabase_pg');
  expectDatabaseProvider('sqlserver', 'sqlserver');
  expectDatabaseProvider('postgresql', 'postgresql');
  assert.throws(() => resolveDatabaseProvider('mysql'));

  // LLM provider contract
  expectLlmProvider(undefined, 'simplified');
  expectLlmProvider('simplified', 'simplified');
  expectLlmProvider('azure_foundry', 'azure_foundry');
  expectLlmProvider('vertex_ai', 'vertex_ai');
  assert.throws(() => resolveLlmProvider('openai'));

  // Commercial tier contract
  expectCommercialProvider(undefined, 'openrouter');
  expectCommercialProvider('openrouter', 'openrouter');
  expectCommercialProvider('azure_foundry', 'azure_foundry');
  expectCommercialProvider('vertex_ai', 'vertex_ai');
  expectCommercialProvider('none', 'none');
  assert.throws(() => resolveCommercialLlmProvider('anthropic'));

  // Open-source tier contract
  expectOpenSourceProvider(undefined, 'ollama_cloud');
  expectOpenSourceProvider('ollama_cloud', 'ollama_cloud');
  expectOpenSourceProvider('ollama_local', 'ollama_local');
  expectOpenSourceProvider('lm_studio', 'lm_studio');
  expectOpenSourceProvider('none', 'none');
  assert.throws(() => resolveOpenSourceLlmProvider('vllm'));

  // eslint-disable-next-line no-console
  console.log('planes provider contracts passed');
}

run();
