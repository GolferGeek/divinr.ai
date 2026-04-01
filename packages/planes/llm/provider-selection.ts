export type LlmProvider = 'simplified' | 'azure_foundry' | 'vertex_ai';
export type CommercialLlmProvider =
  | 'openrouter'
  | 'azure_foundry'
  | 'vertex_ai'
  | 'none';
export type OpenSourceLlmProvider =
  | 'ollama_cloud'
  | 'ollama_local'
  | 'lm_studio'
  | 'none';

export function resolveLlmProvider(value?: string): LlmProvider {
  const provider = value || 'simplified';
  switch (provider) {
    case 'simplified':
    case 'azure_foundry':
    case 'vertex_ai':
      return provider;
    default:
      throw new Error(
        `Unsupported LLM_PROVIDER '${provider}'. Expected: simplified, azure_foundry, vertex_ai`,
      );
  }
}

export function resolveCommercialLlmProvider(value?: string): CommercialLlmProvider {
  const provider = value || 'openrouter';
  switch (provider) {
    case 'openrouter':
    case 'azure_foundry':
    case 'vertex_ai':
    case 'none':
      return provider;
    default:
      throw new Error(
        `Unsupported COMMERCIAL_LLM_PROVIDER '${provider}'. Expected: openrouter, azure_foundry, vertex_ai, none`,
      );
  }
}

export function resolveOpenSourceLlmProvider(value?: string): OpenSourceLlmProvider {
  const provider = value || 'ollama_cloud';
  switch (provider) {
    case 'ollama_cloud':
    case 'ollama_local':
    case 'lm_studio':
    case 'none':
      return provider;
    default:
      throw new Error(
        `Unsupported OPENSOURCE_LLM_PROVIDER '${provider}'. Expected: ollama_cloud, ollama_local, lm_studio, none`,
      );
  }
}
