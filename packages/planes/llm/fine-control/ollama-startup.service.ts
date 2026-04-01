import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaDiscoveryService } from './ollama-discovery.service';
import {
  LocalModelStatusService,
  ModelStatus,
} from './local-model-status.service';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '@/database';
import { getTableName } from '@orchestratorai/planes/database';

export interface StartupSyncResult {
  success: boolean;
  ollamaUrl: string | null;
  ollamaVersion?: string;
  models: string[];
  globalConfig: {
    provider: string;
    model: string;
  };
  warnings: string[];
}

/**
 * Model RAM requirements for recommendations.
 */
export interface ModelRecommendation {
  name: string;
  sizeGB: number;
  minRamGB: number;
  tier: 'economy' | 'standard' | 'premium' | 'cloud';
  description: string;
  isInstalled?: boolean;
  isRecommended?: boolean;
}

const MODEL_RAM_REQUIREMENTS: ModelRecommendation[] = [
  {
    name: 'llama3.2:1b',
    sizeGB: 1.3,
    minRamGB: 8,
    tier: 'economy',
    description: 'Fast responses, simple tasks',
  },
  {
    name: 'llama3.2:3b',
    sizeGB: 2.0,
    minRamGB: 16,
    tier: 'standard',
    description: 'General purpose, balanced',
  },
  {
    name: 'qwen3:8b',
    sizeGB: 4.7,
    minRamGB: 32,
    tier: 'standard',
    description: 'Code generation, reasoning',
  },
  {
    name: 'qwen3:14b',
    sizeGB: 8.9,
    minRamGB: 48,
    tier: 'premium',
    description: 'Complex tasks, better quality',
  },
  {
    name: 'qwen3-coder:30b',
    sizeGB: 18,
    minRamGB: 64,
    tier: 'premium',
    description: 'Specialized code generation, large context',
  },
  {
    name: 'deepseek-r1:32b',
    sizeGB: 19,
    minRamGB: 64,
    tier: 'premium',
    description: 'Advanced reasoning',
  },
  {
    name: 'deepseek-r1:70b',
    sizeGB: 40,
    minRamGB: 96,
    tier: 'cloud',
    description: 'Maximum capability',
  },
];

/**
 * Service that syncs Ollama models with the database on API startup.
 *
 * Features:
 * - Uses discovery service with retry logic
 * - On success: syncs models with database
 * - On failure: logs warning and continues gracefully
 * - Updates global config if current model unavailable
 * - Logs summary of available models and default
 */
@Injectable()
export class OllamaStartupService implements OnModuleInit {
  private readonly logger = new Logger(OllamaStartupService.name);

  constructor(
    private readonly discoveryService: OllamaDiscoveryService,
    private readonly localModelStatusService: LocalModelStatusService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Skip Ollama sync when not using fine_control LLM plane
    // (simplified, azure_foundry, vertex_ai don't need local Ollama)
    const llmProvider = this.configService.get<string>('LLM_PROVIDER');
    if (llmProvider && llmProvider !== 'fine_control') {
      this.logger.log(
        `Skipping Ollama startup sync (LLM_PROVIDER=${llmProvider})`,
      );
      return;
    }

    if (process.env.SKIP_OLLAMA_SYNC === 'true') {
      this.logger.warn('Skipping Ollama startup sync (SKIP_OLLAMA_SYNC=true)');
      return;
    }
    await this.performStartupSync();
  }

  /**
   * Perform the startup sync process.
   */
  async performStartupSync(): Promise<StartupSyncResult> {
    const warnings: string[] = [];

    // Step 1: Discover Ollama
    this.logger.debug('[SYNC] Step 1: Starting Ollama discovery...');
    const discovery = await this.discoveryService.discover();
    this.logger.debug(
      `[SYNC] Step 1 complete: connected=${discovery.connected}`,
    );

    if (!discovery.connected) {
      this.logger.warn(
        `Ollama not available: ${discovery.error}. Local models will be unavailable.`,
      );
      return {
        success: false,
        ollamaUrl: null,
        models: [],
        globalConfig: await this.getGlobalConfig(),
        warnings: [`Ollama not available: ${discovery.error}`],
      };
    }

    this.logger.log(
      `Ollama connected at ${discovery.url} (v${discovery.version || 'unknown'})`,
    );

    // Step 2: Get available models from Ollama (fast - no health checks)
    this.logger.debug('[SYNC] Step 2: Getting available models...');
    const ollamaModels = await this.localModelStatusService.getLoadedModels();
    this.logger.debug(`[SYNC] Step 2 complete: ${ollamaModels.length} models`);
    const modelNames = ollamaModels.map((m) => m.name);

    this.logger.log(`Available models: ${modelNames.join(', ') || 'none'}`);

    // Skip database sync at startup - models are synced on-demand when needed
    // This dramatically speeds up API startup time
    this.logger.debug(
      '[SYNC] Startup sync complete (database sync skipped for speed)',
    );

    return {
      success: true,
      ollamaUrl: discovery.url,
      ollamaVersion: discovery.version,
      models: modelNames,
      globalConfig: {
        provider: 'ollama',
        model: modelNames[0] || 'llama3.2:1b',
      },
      warnings,
    };
  }

  /**
   * Sync Ollama models to database.
   */
  private async syncModelsToDatabase(models: ModelStatus[]): Promise<void> {
    try {
      // Update is_currently_loaded status for all models
      await this.localModelStatusService.syncWithDatabase();

      // Insert any new models that aren't in the database yet
      for (const model of models) {
        await this.insertMissingModel(model);
      }
    } catch (error) {
      this.logger.error('Failed to sync models to database:', error);
    }
  }

  /**
   * Insert a model into the database if it doesn't exist.
   */
  private async insertMissingModel(model: ModelStatus): Promise<void> {
    try {
      // Check if model already exists
      const { data: existing } = (await this.db
        .from(null, getTableName('llm_models'))
        .select('model_name')
        .eq('model_name', model.name)
        .eq('provider_name', 'ollama')
        .single()) as QueryResult<unknown>;

      if (existing) {
        return; // Model already exists
      }

      // Get model details from RAM requirements or use defaults
      const modelBaseName = model.name.split(':')[0] || model.name;
      const modelInfo = MODEL_RAM_REQUIREMENTS.find((m) =>
        m.name.startsWith(modelBaseName),
      );

      // Insert new model
      const { error } = await this.db
        .from(null, getTableName('llm_models'))
        .insert({
          model_name: model.name,
          provider_name: 'ollama',
          display_name: model.name,
          model_type: 'text-generation',
          context_window: 4096,
          max_output_tokens: 2048,
          model_tier: modelInfo?.tier || 'standard',
          speed_tier: modelInfo?.tier === 'economy' ? 'very-fast' : 'medium',
          is_local: true,
          is_currently_loaded: model.status === 'loaded',
          is_active: true,
          loading_priority: this.getPriorityForModel(model.name),
        });

      if (error) {
        this.logger.debug(
          `Could not insert model ${model.name}: ${error.message}`,
        );
      } else {
        this.logger.log(`Added new local model to database: ${model.name}`);
      }
    } catch (error) {
      this.logger.debug(`Error inserting model ${model.name}:`, error);
    }
  }

  /**
   * Get priority for a model based on its name.
   */
  private getPriorityForModel(modelName: string): number {
    // Higher priority for smaller, faster models
    if (modelName.includes(':1b')) return 10;
    if (modelName.includes(':3b')) return 8;
    if (modelName.includes(':8b')) return 6;
    if (modelName.includes(':14b')) return 4;
    if (modelName.includes(':32b')) return 2;
    if (modelName.includes(':70b')) return 1;
    return 5;
  }

  /**
   * Select the best available model for default use.
   * Prefers smaller, faster models for responsiveness.
   */
  private selectBestAvailableModel(models: string[]): string {
    // Priority order: prefer smaller models for default
    const priorities = [
      'llama3.2:1b',
      'llama3.2:3b',
      'llama3.2:latest',
      'qwen3:8b',
      'qwen3:14b',
    ];

    for (const preferred of priorities) {
      if (models.includes(preferred)) {
        return preferred;
      }
    }

    // Return first available model (or default if none)
    return models[0] || 'llama3.2:1b';
  }

  /**
   * Get current global model configuration.
   */
  async getGlobalConfig(): Promise<{ provider: string; model: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { data: rawData, error } = await this.db.rpc(
        'get_global_model_config',
      );

      if (error || !rawData) {
        return {
          provider: process.env.DEFAULT_LLM_PROVIDER || 'ollama',
          model: process.env.DEFAULT_LLM_MODEL || 'llama3.2:1b',
        };
      }

      // SQL Server rpc returns recordset array; Supabase returns scalar directly
      let configValue: unknown = rawData;
      if (Array.isArray(rawData) && rawData.length > 0) {
        const firstRow = rawData[0] as Record<string, unknown>;
        const values = Object.values(firstRow);
        if (values.length === 1) configValue = values[0];
      }
      const parsed =
        typeof configValue === 'string'
          ? (JSON.parse(configValue) as Record<string, unknown>)
          : configValue;
      const config = parsed as { provider?: string; model?: string };

      return {
        provider: config.provider || 'ollama',
        model: config.model || 'llama3.2:1b',
      };
    } catch {
      return {
        provider: process.env.DEFAULT_LLM_PROVIDER || 'ollama',
        model: process.env.DEFAULT_LLM_MODEL || 'llama3.2:1b',
      };
    }
  }

  /**
   * Update global model configuration.
   */
  async updateGlobalConfig(modelName: string): Promise<void> {
    try {
      await this.db.from(null, getTableName('system_settings')).upsert(
        {
          key: 'model_config_global',
          value: {
            provider: 'ollama',
            model: modelName,
            parameters: {
              temperature: 0.7,
              maxTokens: 8000,
            },
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      );
    } catch (error) {
      this.logger.error('Failed to update global config:', error);
    }
  }

  /**
   * Get recommended models for a given RAM size.
   */
  getRecommendedModelsForRAM(ramGB: number): ModelRecommendation[] {
    return MODEL_RAM_REQUIREMENTS.filter((m) => ramGB >= m.minRamGB).map(
      (m) => ({
        ...m,
        isRecommended: true,
      }),
    );
  }

  /**
   * Get all model RAM requirements.
   */
  getAllModelRequirements(): ModelRecommendation[] {
    return MODEL_RAM_REQUIREMENTS;
  }

  /**
   * Trigger a manual sync.
   */
  async triggerSync(): Promise<StartupSyncResult> {
    return this.performStartupSync();
  }
}
