import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { LocalModelStatusService } from './local-model-status.service';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '@/database';
import { getTableName } from '@orchestratorai/planes/database';

export interface ModelMemoryInfo {
  name: string;
  estimatedSize: number; // in bytes
  lastUsed: number; // timestamp
  useCount: number;
  tier: string;
  priority: number;
  isThreeTier: boolean;
}

export interface MemoryConfig {
  maxMemoryUsage: number; // in bytes
  reservedMemory: number; // in bytes
  threeTierReserved: number; // in bytes
  unloadThreshold: number; // percentage (0-1)
  minFreeMemory: number; // in bytes
}

export interface MemoryStats {
  totalAllocated: number;
  currentUsage: number;
  availableMemory: number;
  loadedModels: number;
  threeTierModels: number;
  memoryPressure: 'low' | 'medium' | 'high' | 'critical';
}

@Injectable()
export class MemoryManagerService implements OnModuleInit {
  private readonly logger = new Logger(MemoryManagerService.name);
  private loadedModels = new Map<string, ModelMemoryInfo>();
  private memoryConfig!: MemoryConfig;
  private threeTierModels = new Set<string>();
  private isOptimizing = false;

  // Model size estimates (in GB, converted to bytes)
  private readonly modelSizeEstimates = new Map([
    ['llama3.2:latest', 2.0],
    ['qwen3:8b', 4.7],
    ['llama3.2:latest', 12.0],
    ['deepseek-r1:70b', 40.0],
    ['qwq:latest', 14.0],
    ['mistral:latest', 4.1],
    ['codellama:latest', 3.8],
    ['llama2:latest', 3.8],
  ]);

  constructor(
    @Inject(LocalModelStatusService) private readonly localModelStatusService: LocalModelStatusService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {
    // Initialize memory configuration based on system resources
    this.initializeMemoryConfig();
    this.logger.log('MemoryManagerService initialized');
  }

  async onModuleInit() {
    // Load model definitions from database (metadata only)
    await this.loadThreeTierModels();

    // Skip automatic sync and health checks - only load models when explicitly requested
    // await this.syncWithCurrentState();

    // Start periodic optimization (but only for already-loaded models)
    setInterval(() => {
      this.optimizeMemoryUsage().catch((error) => {
        this.logger.error('Periodic memory optimization failed', error);
      });
    }, 60000); // Every minute
  }

  /**
   * Initialize memory configuration based on available system resources
   */
  private initializeMemoryConfig(): void {
    const maxMemoryGB = parseInt(process.env.MAX_MODEL_MEMORY_GB || '24', 10);
    const maxMemoryBytes = maxMemoryGB * 1024 * 1024 * 1024;

    this.memoryConfig = {
      maxMemoryUsage: maxMemoryBytes,
      reservedMemory: maxMemoryBytes * 0.1, // 10% reserved for system
      threeTierReserved: maxMemoryBytes * 0.6, // 60% reserved for three-tier models
      unloadThreshold: 0.85, // Start unloading at 85% usage
      minFreeMemory: 2 * 1024 * 1024 * 1024, // 2GB minimum free
    };

    this.logger.log(
      `Memory configuration: ${maxMemoryGB}GB max, ${(this.memoryConfig.threeTierReserved / 1024 / 1024 / 1024).toFixed(1)}GB reserved for three-tier models`,
    );
  }

  /**
   * Load three-tier model names from database
   */
  private async loadThreeTierModels(): Promise<void> {
    try {
      const { data, error } = (await this.db
        .from(null, getTableName('llm_models'))
        .select('model_name')
        .eq('is_local', true)
        .eq('is_active', true)
        .in('speed_tier', [
          'ultra-fast',
          'fast',
          'medium',
        ])) as QueryResult<unknown>;

      if (error) {
        this.logger.error('Failed to load three-tier models', error);
        return;
      }

      this.threeTierModels.clear();
      const typedData = (data || []) as Array<{ model_name: string }>;
      typedData.forEach((model: { model_name: string }) => {
        if (typeof model.model_name === 'string') {
          this.threeTierModels.add(model.model_name);
        }
      });

      this.logger.debug(
        `Loaded ${this.threeTierModels.size} three-tier models: ${Array.from(this.threeTierModels).join(', ')}`,
      );
    } catch (error) {
      this.logger.error('Error loading three-tier models', error);
    }
  }

  /**
   * Sync with current Ollama state
   */
  private async syncWithCurrentState(): Promise<void> {
    try {
      // Use getLoadedModels() instead of getOllamaStatus() to avoid health checks
      const loadedModels = await this.localModelStatusService.getLoadedModels();

      // Update loaded models map
      for (const model of loadedModels) {
        const memoryInfo: ModelMemoryInfo = {
          name: model.name,
          estimatedSize: this.getModelSizeEstimate(model.name),
          lastUsed: Date.now(),
          useCount: this.loadedModels.get(model.name)?.useCount || 0,
          tier: await this.getModelTier(model.name),
          priority: await this.getModelPriority(model.name),
          isThreeTier: this.threeTierModels.has(model.name),
        };

        this.loadedModels.set(model.name, memoryInfo);
      }

      // Remove models that are no longer loaded
      const currentlyLoaded = new Set(loadedModels.map((m) => m.name));
      for (const [modelName] of this.loadedModels) {
        if (!currentlyLoaded.has(modelName)) {
          this.loadedModels.delete(modelName);
        }
      }

      this.logger.debug(
        `Synced with current state: ${this.loadedModels.size} models loaded`,
      );
    } catch (error) {
      this.logger.error('Failed to sync with current state', error);
    }
  }

  /**
   * Attempt to load a model, managing memory if necessary
   */
  async loadModel(modelName: string): Promise<{
    success: boolean;
    message?: string;
    memoryFreed?: number;
    modelsUnloaded?: string[];
  }> {
    const startTime = Date.now();

    try {
      // Check if model is already loaded
      if (this.loadedModels.has(modelName)) {
        this.recordModelUsage(modelName);
        return { success: true, message: 'Model already loaded' };
      }

      const modelSize = this.getModelSizeEstimate(modelName);
      const currentUsage = this.getCurrentMemoryUsage();
      const isThreeTier = this.threeTierModels.has(modelName);

      // Check if we need to free memory
      const availableMemory = this.memoryConfig.maxMemoryUsage - currentUsage;
      const needsMemoryManagement =
        availableMemory < modelSize + this.memoryConfig.minFreeMemory;

      let memoryFreed = 0;
      let modelsUnloaded: string[] = [];

      if (needsMemoryManagement) {
        this.logger.log(
          `Memory management needed for ${modelName} (${(modelSize / 1024 / 1024 / 1024).toFixed(1)}GB). Current usage: ${(currentUsage / 1024 / 1024 / 1024).toFixed(1)}GB`,
        );

        const freeResult = await this.freeMemoryForModel(
          modelName,
          modelSize,
          isThreeTier,
        );
        if (!freeResult.success) {
          return {
            success: false,
            message: `Insufficient memory: ${freeResult.message}`,
          };
        }

        memoryFreed = freeResult.memoryFreed || 0;
        modelsUnloaded = freeResult.modelsUnloaded || [];
      }

      // Attempt to load the model
      const loadResult =
        await this.localModelStatusService.ensureModelLoaded(modelName);

      if (loadResult) {
        // Track the loaded model
        const memoryInfo: ModelMemoryInfo = {
          name: modelName,
          estimatedSize: modelSize,
          lastUsed: Date.now(),
          useCount: 1,
          tier: await this.getModelTier(modelName),
          priority: await this.getModelPriority(modelName),
          isThreeTier,
        };

        this.loadedModels.set(modelName, memoryInfo);

        // Update database
        await this.localModelStatusService.updateModelLoadingStatus(
          modelName,
          true,
        );

        const loadTime = Date.now() - startTime;
        this.logger.log(
          `Successfully loaded ${modelName} in ${loadTime}ms${memoryFreed > 0 ? ` (freed ${(memoryFreed / 1024 / 1024 / 1024).toFixed(1)}GB)` : ''}`,
        );

        return {
          success: true,
          message: `Model loaded successfully`,
          memoryFreed,
          modelsUnloaded,
        };
      } else {
        return {
          success: false,
          message: 'Failed to load model via Ollama',
        };
      }
    } catch (error) {
      const loadTime = Date.now() - startTime;
      this.logger.error(
        `Failed to load model ${modelName} after ${loadTime}ms`,
        error,
      );

      return {
        success: false,
        message: `Loading failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Free memory for a model by unloading less important models
   */
  private async freeMemoryForModel(
    targetModel: string,
    requiredSize: number,
    isThreeTier: boolean,
  ): Promise<{
    success: boolean;
    message?: string;
    memoryFreed?: number;
    modelsUnloaded?: string[];
  }> {
    if (this.isOptimizing) {
      return {
        success: false,
        message: 'Memory optimization already in progress',
      };
    }

    this.isOptimizing = true;

    try {
      const modelsToUnload = this.selectModelsForUnloading(
        targetModel,
        requiredSize,
        isThreeTier,
      );

      if (modelsToUnload.length === 0) {
        return { success: false, message: 'No suitable models to unload' };
      }

      let totalFreed = 0;
      const unloadedModels: string[] = [];

      for (const model of modelsToUnload) {
        try {
          // Note: Ollama doesn't have explicit unload, but we can try to minimize memory by clearing context
          // For now, we'll simulate unloading by removing from our tracking
          const modelInfo = this.loadedModels.get(model.name);
          if (modelInfo) {
            totalFreed += modelInfo.estimatedSize;
            this.loadedModels.delete(model.name);
            unloadedModels.push(model.name);

            // Update database
            await this.localModelStatusService.updateModelLoadingStatus(
              model.name,
              false,
            );

            this.logger.log(
              `Unloaded ${model.name} (${(modelInfo.estimatedSize / 1024 / 1024 / 1024).toFixed(1)}GB)`,
            );
          }
        } catch (error) {
          this.logger.error(`Failed to unload ${model.name}`, error);
        }

        // Check if we've freed enough memory
        if (totalFreed >= requiredSize + this.memoryConfig.minFreeMemory) {
          break;
        }
      }

      const success = totalFreed >= requiredSize;
      return {
        success,
        message: success
          ? `Freed ${(totalFreed / 1024 / 1024 / 1024).toFixed(1)}GB`
          : 'Insufficient memory freed',
        memoryFreed: totalFreed,
        modelsUnloaded: unloadedModels,
      };
    } finally {
      this.isOptimizing = false;
    }
  }

  /**
   * Select models for unloading based on priority, usage, and tier
   */
  private selectModelsForUnloading(
    targetModel: string,
    requiredSize: number,
    targetIsThreeTier: boolean,
  ): ModelMemoryInfo[] {
    const candidates = Array.from(this.loadedModels.values())
      .filter((model) => {
        // Never unload the target model
        if (model.name === targetModel) return false;

        // Protect three-tier models if target is also three-tier
        if (targetIsThreeTier && model.isThreeTier) {
          // Only unload three-tier models if they have very low usage
          return model.useCount < 5 && Date.now() - model.lastUsed > 300000; // 5 minutes
        }

        // Don't unload three-tier models for non-three-tier targets unless absolutely necessary
        if (!targetIsThreeTier && model.isThreeTier) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Sort by unloading priority (least important first)

        // 1. Non-three-tier models first (if target is not three-tier)
        if (!targetIsThreeTier) {
          if (a.isThreeTier !== b.isThreeTier) {
            return a.isThreeTier ? 1 : -1;
          }
        }

        // 2. Least recently used
        const timeDiff = a.lastUsed - b.lastUsed;
        if (Math.abs(timeDiff) > 60000) {
          // More than 1 minute difference
          return timeDiff;
        }

        // 3. Lowest use count
        if (a.useCount !== b.useCount) {
          return a.useCount - b.useCount;
        }

        // 4. Lower priority models first
        const priorityOrder = { low: 0, medium: 1, high: 2 };
        return (
          priorityOrder[this.getPriorityLevel(a.priority)] -
          priorityOrder[this.getPriorityLevel(b.priority)]
        );
      });

    // Select models until we have enough memory
    const selected: ModelMemoryInfo[] = [];
    let totalSize = 0;

    for (const candidate of candidates) {
      selected.push(candidate);
      totalSize += candidate.estimatedSize;

      if (totalSize >= requiredSize + this.memoryConfig.minFreeMemory) {
        break;
      }
    }

    return selected;
  }

  /**
   * Record model usage for memory management decisions
   */
  recordModelUsage(modelName: string): void {
    const model = this.loadedModels.get(modelName);
    if (model) {
      model.lastUsed = Date.now();
      model.useCount++;
      this.loadedModels.set(modelName, model);
    }
  }

  /**
   * Get current memory usage estimate
   */
  getCurrentMemoryUsage(): number {
    return Array.from(this.loadedModels.values()).reduce(
      (total, model) => total + model.estimatedSize,
      0,
    );
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): MemoryStats {
    const currentUsage = this.getCurrentMemoryUsage();
    const availableMemory = this.memoryConfig.maxMemoryUsage - currentUsage;
    const usageRatio = currentUsage / this.memoryConfig.maxMemoryUsage;

    let memoryPressure: 'low' | 'medium' | 'high' | 'critical';
    if (usageRatio < 0.6) {
      memoryPressure = 'low';
    } else if (usageRatio < 0.8) {
      memoryPressure = 'medium';
    } else if (usageRatio < 0.95) {
      memoryPressure = 'high';
    } else {
      memoryPressure = 'critical';
    }

    const threeTierCount = Array.from(this.loadedModels.values()).filter(
      (model) => model.isThreeTier,
    ).length;

    return {
      totalAllocated: this.memoryConfig.maxMemoryUsage,
      currentUsage,
      availableMemory,
      loadedModels: this.loadedModels.size,
      threeTierModels: threeTierCount,
      memoryPressure,
    };
  }

  /**
   * Optimize memory usage by unloading underused models
   */
  async optimizeMemoryUsage(): Promise<void> {
    if (this.isOptimizing) {
      return;
    }

    const stats = this.getMemoryStats();

    // Only optimize if memory pressure is medium or higher
    if (stats.memoryPressure === 'low') {
      return;
    }

    this.logger.debug(
      `Optimizing memory usage (pressure: ${stats.memoryPressure})`,
    );

    try {
      this.isOptimizing = true;

      // Find models that haven't been used recently
      const now = Date.now();
      const staleThreshold = 10 * 60 * 1000; // 10 minutes

      const staleModels = Array.from(this.loadedModels.values())
        .filter((model) => {
          // Don't unload three-tier models unless they're very stale
          if (model.isThreeTier) {
            return now - model.lastUsed > staleThreshold * 3; // 30 minutes for three-tier
          }
          return now - model.lastUsed > staleThreshold;
        })
        .sort((a, b) => a.lastUsed - b.lastUsed); // Oldest first

      let memoryFreed = 0;
      const targetFreeMemory = this.memoryConfig.maxMemoryUsage * 0.3; // Free up to 30%

      for (const model of staleModels) {
        if (memoryFreed >= targetFreeMemory) {
          break;
        }

        try {
          this.loadedModels.delete(model.name);
          memoryFreed += model.estimatedSize;

          await this.localModelStatusService.updateModelLoadingStatus(
            model.name,
            false,
          );

          this.logger.log(
            `Optimized: unloaded ${model.name} (unused for ${Math.round((now - model.lastUsed) / 60000)}min)`,
          );
        } catch (error) {
          this.logger.error(`Failed to optimize-unload ${model.name}`, error);
        }
      }

      if (memoryFreed > 0) {
        this.logger.log(
          `Memory optimization freed ${(memoryFreed / 1024 / 1024 / 1024).toFixed(1)}GB`,
        );
      }
    } finally {
      this.isOptimizing = false;
    }
  }

  /**
   * Get model size estimate in bytes
   */
  private getModelSizeEstimate(modelName: string): number {
    const sizeGB = this.modelSizeEstimates.get(modelName) || 4.0; // Default 4GB
    return sizeGB * 1024 * 1024 * 1024;
  }

  /**
   * Get model tier from database
   */
  private async getModelTier(modelName: string): Promise<string> {
    try {
      const { data, error } = (await this.db
        .from(null, getTableName('llm_models'))
        .select('speed_tier')
        .eq('model_name', modelName)
        .eq('is_local', true)
        .single()) as QueryResult<unknown>;

      if (error || !data) {
        return 'general';
      }

      const typedData = data as { speed_tier?: string };
      return typedData.speed_tier || 'general';
    } catch {
      return 'general';
    }
  }

  /**
   * Get model priority from database
   */
  private async getModelPriority(modelName: string): Promise<number> {
    try {
      const { data, error } = (await this.db
        .from(null, getTableName('llm_models'))
        .select('loading_priority')
        .eq('model_name', modelName)
        .eq('is_local', true)
        .single()) as QueryResult<unknown>;

      if (error || !data) {
        return 50; // Default priority
      }

      const typedData = data as { loading_priority?: number };
      return typedData.loading_priority || 50;
    } catch {
      return 50;
    }
  }

  /**
   * Convert numeric priority to level
   */
  private getPriorityLevel(priority: number): 'high' | 'medium' | 'low' {
    if (priority >= 80) return 'high';
    if (priority >= 50) return 'medium';
    return 'low';
  }

  /**
   * Get loaded models summary
   */
  getLoadedModels(): Array<{
    name: string;
    size: string;
    tier: string;
    lastUsed: string;
    useCount: number;
    isThreeTier: boolean;
  }> {
    return Array.from(this.loadedModels.values()).map((model) => ({
      name: model.name,
      size: `${(model.estimatedSize / 1024 / 1024 / 1024).toFixed(1)}GB`,
      tier: model.tier,
      lastUsed: new Date(model.lastUsed).toISOString(),
      useCount: model.useCount,
      isThreeTier: model.isThreeTier,
    }));
  }

  /**
   * Force unload a specific model
   */
  async forceUnloadModel(modelName: string): Promise<boolean> {
    try {
      const model = this.loadedModels.get(modelName);
      if (!model) {
        return false; // Model not tracked as loaded
      }

      this.loadedModels.delete(modelName);
      await this.localModelStatusService.updateModelLoadingStatus(
        modelName,
        false,
      );

      this.logger.log(`Force unloaded ${modelName}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to force unload ${modelName}`, error);
      return false;
    }
  }

  /**
   * Preload three-tier models based on configuration
   */
  async preloadThreeTierModels(): Promise<void> {
    this.logger.log('Preloading three-tier models...');

    const threeTierModelsList = Array.from(this.threeTierModels);
    const stats = this.getMemoryStats();

    // Don't preload if memory pressure is already high
    if (
      stats.memoryPressure === 'high' ||
      stats.memoryPressure === 'critical'
    ) {
      this.logger.warn(
        'Skipping three-tier preload due to high memory pressure',
      );
      return;
    }

    for (const modelName of threeTierModelsList) {
      if (this.loadedModels.has(modelName)) {
        continue; // Already loaded
      }

      try {
        const result = await this.loadModel(modelName);
        if (result.success) {
          this.logger.log(`Preloaded three-tier model: ${modelName}`);
        } else {
          this.logger.warn(`Failed to preload ${modelName}: ${result.message}`);
        }
      } catch (error) {
        this.logger.error(`Error preloading ${modelName}`, error);
      }

      // Check memory pressure after each load
      const currentStats = this.getMemoryStats();
      if (currentStats.memoryPressure === 'high') {
        this.logger.log('Stopping preload due to high memory pressure');
        break;
      }
    }
  }
}
