import { Injectable, Inject, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '@/database';
import { getTableName } from '@orchestratorai/planes/database';

export interface ModelStatus {
  name: string;
  status: 'loaded' | 'loading' | 'error' | 'unavailable';
  size?: string;
  digest?: string;
  details?: {
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
  modifiedAt?: string;
  responseTime?: number;
  memoryUsage?: number;
  errorMessage?: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
  modified_at: string;
}

interface OllamaVersionResponse {
  version?: string;
}

interface OllamaLoadedModel {
  name: string;
  size: number;
  digest: string;
  details?: {
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
  expires_at?: string;
}

interface OllamaProcessResponse {
  models?: OllamaLoadedModel[];
}

interface OllamaTagsResponse {
  models?: OllamaModel[];
}

export interface ModelHealth {
  available: boolean;
  responseTime: number;
  lastCheck: string;
  errorMessage?: string;
}

export interface OllamaStatus {
  connected: boolean;
  version?: string;
  models: ModelStatus[];
  lastCheck: string;
  errorMessage?: string;
}

@Injectable()
export class LocalModelStatusService {
  private readonly logger = new Logger(LocalModelStatusService.name);
  private readonly ollamaBaseUrl: string;
  private readonly healthCache = new Map<string, ModelHealth>();
  private readonly cacheTimeout = 5000; // 5 seconds
  private ollamaStatus: OllamaStatus = {
    connected: false,
    models: [],
    lastCheck: new Date().toISOString(),
  };

  constructor(
    private readonly httpService: HttpService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {
    this.ollamaBaseUrl =
      process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

    // Don't perform initial health check - only check when explicitly requested
    // This prevents startup connection attempts to services that may not be running
    // Use 'ollama ps' to check only running models instead of proactive health checks
  }

  /**
   * Check if Ollama service is available
   */
  async checkOllamaConnection(): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<OllamaVersionResponse>(
          `${this.ollamaBaseUrl}/api/version`,
          {
            timeout: 5000,
          },
        ),
      );

      this.ollamaStatus.connected = true;
      this.ollamaStatus.version = response.data?.version || 'unknown';
      this.ollamaStatus.lastCheck = new Date().toISOString();
      this.ollamaStatus.errorMessage = undefined;

      return true;
    } catch (error) {
      this.ollamaStatus.connected = false;
      this.ollamaStatus.lastCheck = new Date().toISOString();
      this.ollamaStatus.errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.warn(
        `Ollama connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  /**
   * Get only currently loaded models from Ollama (faster - no health checks)
   */
  async getLoadedModels(): Promise<ModelStatus[]> {
    if (!(await this.checkOllamaConnection())) {
      return [];
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<OllamaProcessResponse>(
          `${this.ollamaBaseUrl}/api/ps`,
          {
            timeout: 5000,
          },
        ),
      );

      const loadedModels = response.data?.models || [];
      const modelStatuses: ModelStatus[] = loadedModels.map((model) => ({
        name: model.name,
        status: 'loaded' as const,
        size: this.formatBytes(model.size),
        digest: model.digest,
        details: model.details,
        modifiedAt: model.expires_at,
        responseTime: 0, // No health check needed - if it's in ps, it's loaded
      }));

      return modelStatuses;
    } catch (error) {
      this.logger.error(
        `Failed to get loaded models: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * Get list of available models from Ollama (with health checks - slower)
   */
  async getAvailableModels(): Promise<ModelStatus[]> {
    if (!(await this.checkOllamaConnection())) {
      return [];
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<OllamaTagsResponse>(
          `${this.ollamaBaseUrl}/api/tags`,
          {
            timeout: 10000,
          },
        ),
      );

      const models: OllamaModel[] = response.data?.models || [];
      const modelStatuses: ModelStatus[] = [];

      for (const model of models) {
        const status: ModelStatus = {
          name: model.name,
          status: 'loaded', // If it's in the list, it's loaded
          size: this.formatBytes(model.size),
          digest: model.digest,
          details: model.details as Record<string, unknown>,
          modifiedAt: model.modified_at,
        };

        // Check individual model health
        const health = await this.checkModelHealth(model.name);
        status.responseTime = health.responseTime;

        if (!health.available) {
          status.status = 'error';
          status.errorMessage = health.errorMessage;
        }

        modelStatuses.push(status);
      }

      this.ollamaStatus.models = modelStatuses;
      return modelStatuses;
    } catch (error) {
      this.logger.error(
        `Failed to get available models: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * Check health of a specific model
   */
  async checkModelHealth(modelName: string): Promise<ModelHealth> {
    const cacheKey = modelName;
    const cached = this.healthCache.get(cacheKey);

    // Return cached result if still valid
    if (
      cached &&
      Date.now() - new Date(cached.lastCheck).getTime() < this.cacheTimeout
    ) {
      return cached;
    }

    const startTime = Date.now();

    try {
      // Simple health check by making a minimal generate request
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.ollamaBaseUrl}/api/generate`,
          {
            model: modelName,
            prompt: 'test',
            stream: false,
            options: {
              num_predict: 1, // Minimal response
            },
          },
          {
            timeout: 30000,
          },
        ),
      );

      const responseTime = Date.now() - startTime;
      const health: ModelHealth = {
        available: !!response.data,
        responseTime,
        lastCheck: new Date().toISOString(),
      };

      this.healthCache.set(cacheKey, health);
      return health;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const health: ModelHealth = {
        available: false,
        responseTime,
        lastCheck: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };

      this.healthCache.set(cacheKey, health);
      return health;
    }
  }

  /**
   * Pull/download a model if not available
   */
  async pullModel(modelName: string): Promise<boolean> {
    if (!(await this.checkOllamaConnection())) {
      throw new Error('Ollama service is not available');
    }

    try {
      this.logger.log(`Pulling model: ${modelName}`);

      await firstValueFrom(
        this.httpService.post(
          `${this.ollamaBaseUrl}/api/pull`,
          {
            name: modelName,
          },
          {
            timeout: 300000, // 5 minutes for model download
          },
        ),
      );

      this.logger.log(`Successfully pulled model: ${modelName}`);

      // Clear cache to force refresh
      this.healthCache.delete(modelName);

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to pull model ${modelName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  /**
   * Ensure a model is loaded and available
   */
  async ensureModelLoaded(modelName: string): Promise<boolean> {
    // First check if model is already available
    const health = await this.checkModelHealth(modelName);
    if (health.available) {
      return true;
    }

    // Try to pull the model
    return await this.pullModel(modelName);
  }

  /**
   * Get models by tier from database
   */
  async getModelsByTier(tier: string): Promise<ModelStatus[]> {
    try {
      // Query database for models in the specified tier
      // Map routing tiers to speed_tier values
      const tierMapping: Record<string, string> = {
        'ultra-fast': 'very-fast',
        balanced: 'medium',
        'high-quality': 'slow',
        general: 'fast',
        'fast-thinking': 'medium',
      };
      const speedTier = tierMapping[tier] || tier;

      const { data: dbModels, error } = (await this.db
        .from(null, getTableName('llm_models'))
        .select(
          `
          model_name,
          display_name,
          model_tier,
          loading_priority,
          is_local,
          is_currently_loaded
        `,
        )
        .eq('is_local', true)
        .eq('speed_tier', speedTier)
        .eq('is_active', true)
        .order('loading_priority', {
          ascending: false,
        })) as QueryResult<unknown>;

      if (error) {
        this.logger.error(`Database query failed for tier ${tier}:`, error);
        return [];
      }

      const typedDbModels = (dbModels || []) as Array<{
        model_name: string;
        display_name: string;
        model_tier: string;
        loading_priority: number;
        is_local: boolean;
        is_currently_loaded: boolean;
      }>;
      if (typedDbModels.length === 0) {
        this.logger.warn(`No models found for tier: ${tier}`);
        return [];
      }

      // Check health status for each model
      const modelStatuses: ModelStatus[] = [];

      for (const dbModel of typedDbModels) {
        const health = await this.checkModelHealth(dbModel.model_name);

        const status: ModelStatus = {
          name: dbModel.model_name,
          status: health.available ? 'loaded' : 'unavailable',
          responseTime: health.responseTime,
          errorMessage: health.errorMessage,
        };

        modelStatuses.push(status);
      }

      return modelStatuses;
    } catch (error) {
      this.logger.error(`Failed to get models by tier ${tier}:`, error);
      return [];
    }
  }

  /**
   * Update model loading status in database
   */
  async updateModelLoadingStatus(
    modelName: string,
    isLoaded: boolean,
  ): Promise<boolean> {
    try {
      const { error } = await this.db
        .from(null, getTableName('llm_models'))
        .update({
          is_currently_loaded: isLoaded,
          updated_at: new Date().toISOString(),
        })
        .eq('model_name', modelName)
        .eq('is_local', true);

      if (error) {
        this.logger.error(
          `Failed to update loading status for ${modelName}:`,
          error,
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Error updating loading status for ${modelName}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Get all local models from database
   */
  async getLocalModelsFromDatabase(): Promise<
    Array<{
      modelName: string;
      displayName: string;
      tier: string;
      priority: number;
      isCurrentlyLoaded: boolean;
    }>
  > {
    try {
      const { data: models, error } = (await this.db
        .from(null, getTableName('llm_models'))
        .select(
          `
          model_name,
          display_name,
          model_tier,
          loading_priority,
          is_currently_loaded
        `,
        )
        .eq('is_local', true)
        .eq('is_active', true)
        .order('loading_priority', {
          ascending: false,
        })) as QueryResult<unknown>;

      if (error) {
        this.logger.error('Failed to get local models from database:', error);
        return [];
      }

      const typedModels = (models || []) as Array<{
        model_name: string;
        display_name: string;
        model_tier: string;
        loading_priority: number;
        is_currently_loaded: boolean;
      }>;
      return typedModels.map((model) => ({
        modelName: model.model_name,
        displayName: model.display_name || model.model_name,
        tier: model.model_tier || 'general',
        priority: model.loading_priority || 0,
        isCurrentlyLoaded: model.is_currently_loaded || false,
      }));
    } catch (error) {
      this.logger.error('Error getting local models from database:', error);
      return [];
    }
  }

  /**
   * Sync Ollama models with database
   */
  async syncWithDatabase(): Promise<void> {
    try {
      // Get models from Ollama
      const ollamaModels = await this.getAvailableModels();

      // Get models from database
      const dbModels = await this.getLocalModelsFromDatabase();

      // Update database with current loading status
      for (const ollamaModel of ollamaModels) {
        const isLoaded = ollamaModel.status === 'loaded';
        await this.updateModelLoadingStatus(ollamaModel.name, isLoaded);
      }

      // Mark models not in Ollama as not loaded
      for (const dbModel of dbModels) {
        const ollamaModel = ollamaModels.find(
          (m) => m.name === dbModel.modelName,
        );
        if (!ollamaModel && dbModel.isCurrentlyLoaded) {
          await this.updateModelLoadingStatus(dbModel.modelName, false);
        }
      }
    } catch (error) {
      this.logger.error('Failed to sync with database:', error);
    }
  }

  /**
   * Get overall Ollama status (fast - no health checks)
   * For system health dashboard, we just want to know if Ollama is running
   * and how many models are available/loaded
   */
  async getOllamaStatus(): Promise<OllamaStatus> {
    await this.checkOllamaConnection();

    if (this.ollamaStatus.connected) {
      // Get list of available models (fast - just metadata, no health checks)
      try {
        const response = await firstValueFrom(
          this.httpService.get<OllamaTagsResponse>(
            `${this.ollamaBaseUrl}/api/tags`,
            {
              timeout: 5000,
            },
          ),
        );

        const models: OllamaModel[] = response.data?.models || [];

        // Get currently loaded models for comparison
        const loadedResponse = await firstValueFrom(
          this.httpService.get<OllamaProcessResponse>(
            `${this.ollamaBaseUrl}/api/ps`,
            {
              timeout: 5000,
            },
          ),
        );

        const loadedModelNames = new Set(
          (loadedResponse.data?.models || []).map((m) => m.name),
        );

        // Mark models as loaded or available (no expensive health checks)
        this.ollamaStatus.models = models.map((model) => ({
          name: model.name,
          status: loadedModelNames.has(model.name)
            ? ('loaded' as const)
            : ('unavailable' as const),
          size: this.formatBytes(model.size),
          digest: model.digest,
          details: model.details as Record<string, unknown>,
          modifiedAt: model.modified_at,
        }));
      } catch (error) {
        this.logger.error(
          `Failed to get model list: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        this.ollamaStatus.models = [];
      }
    }

    return { ...this.ollamaStatus };
  }

  /**
   * Get model information for a specific model
   */
  async getModelInfo(modelName: string): Promise<ModelStatus | null> {
    const models = await this.getAvailableModels();
    return models.find((model) => model.name === modelName) || null;
  }

  /**
   * Delete/remove a model
   */
  async deleteModel(modelName: string): Promise<boolean> {
    if (!(await this.checkOllamaConnection())) {
      throw new Error('Ollama service is not available');
    }

    try {
      await firstValueFrom(
        this.httpService.delete(`${this.ollamaBaseUrl}/api/delete`, {
          data: { name: modelName },
          timeout: 30000,
        }),
      );

      this.logger.log(`Successfully deleted model: ${modelName}`);

      // Clear cache
      this.healthCache.delete(modelName);

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to delete model ${modelName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Clear health cache
   */
  clearCache(): void {
    this.healthCache.clear();
  }

  /**
   * Get service statistics
   */
  getStats(): {
    connected: boolean;
    totalModels: number;
    loadedModels: number;
    errorModels: number;
    cacheSize: number;
    avgResponseTime: number;
  } {
    const models = this.ollamaStatus.models;
    const loadedModels = models.filter((m) => m.status === 'loaded').length;
    const errorModels = models.filter((m) => m.status === 'error').length;

    const responseTimes = models
      .filter((m) => m.responseTime)
      .map((m) => m.responseTime!);

    const avgResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

    return {
      connected: this.ollamaStatus.connected,
      totalModels: models.length,
      loadedModels,
      errorModels,
      cacheSize: this.healthCache.size,
      avgResponseTime: Math.round(avgResponseTime),
    };
  }

  /**
   * Periodic health check for all models
   */
  async performHealthCheck(): Promise<void> {
    const models = await this.getAvailableModels();
    for (const model of models) {
      // This will update the cache
      await this.checkModelHealth(model.name);
    }
  }
}
