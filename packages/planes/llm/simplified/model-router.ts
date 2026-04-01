/**
 * Model Router
 *
 * Config-driven routing that maps model names to either OpenRouter or Ollama Cloud.
 *
 * Default routing:
 *   - Commercial models (gpt-*, claude-*, gemini-*, grok-*) -> OpenRouter
 *   - Open-source models (llama-*, mistral-*, qwen-*, phi-*, deepseek-*) -> Ollama Cloud
 *
 * Sovereign mode: all models -> Ollama Cloud (no external API calls)
 *
 * Override via SIMPLIFIED_LLM_ROUTING env var (JSON):
 *   e.g. {"llama-3.3-70b": "openrouter", "gpt-4o": "ollama_cloud"}
 */
import { Injectable, Logger } from '@nestjs/common';

export type RoutingTarget = 'openrouter' | 'ollama_cloud';

export interface RoutingResult {
  target: RoutingTarget;
  model: string;
  reason: string;
}

const OPENROUTER_PREFIXES = ['gpt-', 'o1', 'o3', 'claude-', 'gemini-', 'grok-'];

const OLLAMA_CLOUD_PREFIXES = [
  'llama',
  'mistral',
  'qwen',
  'phi-',
  'deepseek',
  'codellama',
  'vicuna',
  'mixtral',
  'falcon',
  'yi-',
  'command-r',
];

@Injectable()
export class ModelRouter {
  private readonly logger = new Logger(ModelRouter.name);
  private overrides: Record<string, RoutingTarget> = {};

  constructor() {
    this.loadOverrides();
  }

  private loadOverrides(): void {
    const envOverrides = process.env.SIMPLIFIED_LLM_ROUTING;
    if (envOverrides) {
      try {
        this.overrides = JSON.parse(envOverrides) as Record<
          string,
          RoutingTarget
        >;
        this.logger.log(
          `Loaded ${Object.keys(this.overrides).length} routing overrides`,
        );
      } catch {
        this.logger.warn(
          'Failed to parse SIMPLIFIED_LLM_ROUTING env var — ignoring overrides',
        );
      }
    }
  }

  route(model: string, sovereignMode?: boolean): RoutingResult {
    const modelLower = model.toLowerCase();

    // Sovereign mode forces all traffic through Ollama Cloud (local/self-hosted)
    if (sovereignMode) {
      return {
        target: 'ollama_cloud',
        model,
        reason: 'sovereign_mode',
      };
    }

    // Check explicit overrides first
    if (this.overrides[model]) {
      return {
        target: this.overrides[model],
        model,
        reason: 'explicit_override',
      };
    }

    if (this.overrides[modelLower]) {
      return {
        target: this.overrides[modelLower],
        model,
        reason: 'explicit_override',
      };
    }

    // Route by prefix
    for (const prefix of OLLAMA_CLOUD_PREFIXES) {
      if (modelLower.startsWith(prefix)) {
        return {
          target: 'ollama_cloud',
          model,
          reason: `prefix_match:${prefix}`,
        };
      }
    }

    for (const prefix of OPENROUTER_PREFIXES) {
      if (modelLower.startsWith(prefix)) {
        return {
          target: 'openrouter',
          model,
          reason: `prefix_match:${prefix}`,
        };
      }
    }

    // Default: OpenRouter (has the broadest model catalog)
    return {
      target: 'openrouter',
      model,
      reason: 'default',
    };
  }
}
