import { Injectable } from '@nestjs/common';

/**
 * Typed model configuration schema (fail-fast, no fallbacks)
 */
export type ModelVariant =
  | 'default'
  | 'fast'
  | 'reasoning'
  | 'long_context'
  | 'multimodal';
export type EnvironmentName = 'development' | 'staging' | 'production';

export interface ModelConfiguration {
  provider: string; // e.g., 'openai' | 'anthropic' | 'google' | 'grok' | 'ollama'
  model: string; // e.g., 'gpt-4o', 'claude-3-5-sonnet-20241022'
  parameters?: Record<string, unknown>;
}

export interface AgentModelConfiguration {
  default: ModelConfiguration;
  fast?: ModelConfiguration;
  reasoning?: ModelConfiguration;
  long_context?: ModelConfiguration;
  multimodal?: ModelConfiguration;
}

export interface SystemModelConfiguration {
  agents: Record<string, AgentModelConfiguration>;
  environmentDefaults: Record<EnvironmentName, ModelConfiguration>;
}

@Injectable()
export class ModelConfigurationService {
  private readonly config?: SystemModelConfiguration;
  private readonly globalDefault?: ModelConfiguration;
  private readonly globalLocalOnly?: ModelConfiguration;
  private readonly mode: 'system' | 'global' | 'global_dual';

  constructor(
    configOrGlobal?:
      | SystemModelConfiguration
      | ModelConfiguration
      | { default: ModelConfiguration; localOnly?: ModelConfiguration },
  ) {
    // Accept:
    // - System model config (agents + environmentDefaults)
    // - Global single default (provider/model)
    // - Global dual config { default, localOnly }
    if (configOrGlobal && typeof configOrGlobal === 'object') {
      const anyCfg = configOrGlobal as Record<string, unknown>;
      if ('default' in anyCfg && !('provider' in anyCfg)) {
        this.mode = 'global_dual';
        this.globalDefault = anyCfg.default as ModelConfiguration;
        this.globalLocalOnly = anyCfg.localOnly as
          | ModelConfiguration
          | undefined;
        return;
      }
      if ('provider' in anyCfg) {
        this.mode = 'global';
        this.globalDefault = anyCfg as unknown as ModelConfiguration;
        return;
      }
    }

    this.mode = 'system';
    this.config = (configOrGlobal as SystemModelConfiguration) ?? {
      agents: {},
      environmentDefaults: {} as Record<string, ModelConfiguration>,
    };
  }

  /**
   * Validate the entire configuration upfront (can be called at startup)
   */
  public validateConfig(): void {
    if (this.mode === 'global') {
      if (!this.globalDefault) {
        throw new Error(
          'ModelConfigurationService: global default configuration is required',
        );
      }
      this.assertModel(this.globalDefault, 'global default');
      return;
    }
    if (this.mode === 'global_dual') {
      if (!this.globalDefault) {
        throw new Error(
          'ModelConfigurationService: global dual configuration requires a default model',
        );
      }
      this.assertModel(this.globalDefault, 'global dual default');
      if (this.globalLocalOnly) {
        this.assertModel(this.globalLocalOnly, 'global dual localOnly');
      }
      return;
    }
    // system mode
    if (!this.config) {
      throw new Error(
        'ModelConfigurationService: system configuration is required',
      );
    }
    if (!this.config.agents || typeof this.config.agents !== 'object') {
      throw new Error('ModelConfigurationService: agents map is required');
    }
    if (!this.config.environmentDefaults) {
      throw new Error(
        'ModelConfigurationService: environmentDefaults are required',
      );
    }
  }

  /**
   * Assert that a given agent + variant is configured; throw with actionable error if not.
   */
  public assertConfigured(
    agentType: string,
    variant: ModelVariant = 'default',
  ): void {
    if (this.mode !== 'system' || !this.config) {
      throw new Error(
        'ModelConfigurationService: agent variants are not available in global mode',
      );
    }
    const agent = this.config.agents[agentType];
    if (!agent) {
      const availableAgents =
        Object.keys(this.config.agents || {}).join(', ') || '(none)';
      throw new Error(
        `ModelConfigurationService: agent '${agentType}' not configured. Available agents: ${availableAgents}`,
      );
    }

    const entry = agent[variant];
    if (!entry) {
      const available = Object.keys(agent).join(', ');
      throw new Error(
        `ModelConfigurationService: variant '${variant}' for agent '${agentType}' is not configured. ` +
          `Available variants: ${available}`,
      );
    }

    this.assertModel(entry, `agent '${agentType}' variant '${variant}'`);
  }

  /**
   * Get agent model configuration for a specific variant (throws if missing)
   */
  public getAgentModel(
    agentType: string,
    variant: ModelVariant = 'default',
  ): ModelConfiguration {
    this.assertConfigured(agentType, variant);
    return (this.config!.agents[agentType] as AgentModelConfiguration)[
      variant
    ] as ModelConfiguration;
  }

  /**
   * Get environment default (throws if missing). Environment must be explicit to avoid silent fallbacks.
   */
  public getEnvironmentDefault(env: EnvironmentName): ModelConfiguration {
    if (this.mode !== 'system') {
      throw new Error(
        'ModelConfigurationService: environment defaults requested in global mode',
      );
    }
    const mc = this.config!.environmentDefaults[env];
    if (!mc) {
      const available =
        Object.keys(this.config!.environmentDefaults || {}).join(', ') ||
        '(none)';
      throw new Error(
        `ModelConfigurationService: environment default for '${env}' not configured. Available: ${available}`,
      );
    }
    this.assertModel(mc, `environment '${env}' default`);
    return mc;
  }

  /**
   * Get the single global default when running in global mode (no NODE_ENV required)
   */
  public getGlobalDefault(): ModelConfiguration {
    if (
      (this.mode === 'global' || this.mode === 'global_dual') &&
      this.globalDefault
    ) {
      this.assertModel(this.globalDefault, 'global default');
      return this.globalDefault;
    }
    throw new Error('ModelConfigurationService: global default not configured');
  }

  /**
   * Get the global local-only default if configured
   */
  public getGlobalLocalOnly(): ModelConfiguration | undefined {
    if (this.mode === 'global_dual') {
      return this.globalLocalOnly;
    }
    return undefined;
  }

  /** Indicate current configuration mode */
  public isGlobal(): boolean {
    return this.mode === 'global';
  }

  /**
   * Enumerate agents supported by configuration
   */
  public listAgents(): string[] {
    if (this.mode === 'global') return [];
    return Object.keys(this.config!.agents || {});
  }

  /**
   * Basic model shape validation (explicit provider/model)
   */
  private assertModel(mc: ModelConfiguration, context: string): void {
    if (!mc.provider) {
      throw new Error(
        `ModelConfigurationService: provider is required for ${context}`,
      );
    }
    if (!mc.model) {
      throw new Error(
        `ModelConfigurationService: model is required for ${context}`,
      );
    }
  }
}
