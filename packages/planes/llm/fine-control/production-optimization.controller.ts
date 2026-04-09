import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Logger,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { MemoryManagerService, MemoryStats } from './memory-manager.service';
import {
  ModelMonitorService,
  SystemHealthMetrics,
  ModelHealthMetrics,
  Alert,
  AlertThresholds,
} from './model-monitor.service';

@Controller('llm/production')
export class ProductionOptimizationController {
  private readonly logger = new Logger(ProductionOptimizationController.name);

  constructor(
    @Inject(MemoryManagerService) private readonly memoryManagerService: MemoryManagerService,
    @Inject(ModelMonitorService) private readonly modelMonitorService: ModelMonitorService,
  ) {}

  /**
   * Get current memory statistics
   */
  @Get('memory/stats')
  @HttpCode(HttpStatus.OK)
  getMemoryStats(): MemoryStats {
    return this.memoryManagerService.getMemoryStats();
  }

  /**
   * Get loaded models summary
   */
  @Get('memory/models')
  @HttpCode(HttpStatus.OK)
  getLoadedModels() {
    return {
      models: this.memoryManagerService.getLoadedModels(),
      stats: this.memoryManagerService.getMemoryStats(),
    };
  }

  /**
   * Load a specific model with memory management
   */
  @Post('memory/load/:modelName')
  @HttpCode(HttpStatus.OK)
  async loadModel(@Param('modelName') modelName: string) {
    try {
      const result = await this.memoryManagerService.loadModel(modelName);

      return {
        success: result.success,
        message: result.message,
        memoryFreed: result.memoryFreed
          ? `${(result.memoryFreed / 1024 / 1024 / 1024).toFixed(1)}GB`
          : undefined,
        modelsUnloaded: result.modelsUnloaded,
        memoryStats: this.memoryManagerService.getMemoryStats(),
      };
    } catch (error) {
      this.logger.error(`Failed to load model ${modelName}`, error);
      throw error;
    }
  }

  /**
   * Unload a specific model
   */
  @Delete('memory/unload/:modelName')
  @HttpCode(HttpStatus.OK)
  async unloadModel(@Param('modelName') modelName: string) {
    try {
      const result =
        await this.memoryManagerService.forceUnloadModel(modelName);
      return {
        success: result,
        message: result
          ? 'Model unloaded successfully'
          : 'Model was not loaded or unload failed',
        memoryStats: this.memoryManagerService.getMemoryStats(),
      };
    } catch (error) {
      this.logger.error(`Failed to unload model ${modelName}`, error);
      throw error;
    }
  }

  /**
   * Trigger memory optimization
   */
  @Post('memory/optimize')
  @HttpCode(HttpStatus.OK)
  async optimizeMemory() {
    try {
      await this.memoryManagerService.optimizeMemoryUsage();
      return {
        success: true,
        message: 'Memory optimization completed',
        memoryStats: this.memoryManagerService.getMemoryStats(),
      };
    } catch (error) {
      this.logger.error('Memory optimization failed', error);
      throw error;
    }
  }

  /**
   * Preload three-tier models
   */
  @Post('memory/preload-three-tier')
  @HttpCode(HttpStatus.OK)
  async preloadThreeTierModels() {
    try {
      await this.memoryManagerService.preloadThreeTierModels();
      return {
        success: true,
        message: 'Three-tier models preload completed',
        memoryStats: this.memoryManagerService.getMemoryStats(),
        loadedModels: this.memoryManagerService.getLoadedModels(),
      };
    } catch (error) {
      this.logger.error('Three-tier preload failed', error);
      throw error;
    }
  }

  // ===== MONITORING ENDPOINTS =====

  /**
   * Get system health metrics
   */
  @Get('monitoring/health')
  @HttpCode(HttpStatus.OK)
  async getSystemHealth(): Promise<SystemHealthMetrics> {
    return await this.modelMonitorService.getSystemHealthMetrics();
  }

  /**
   * Get system health metrics (frontend path)
   */
  @Get('health/system')
  @HttpCode(HttpStatus.OK)
  getSystemHealthFrontend(): Promise<SystemHealthMetrics> {
    // Return immediate fallback data to avoid hanging
    const memoryStats = this.memoryManagerService.getMemoryStats();
    return Promise.resolve({
      ollamaConnected: false,
      totalModels: 0,
      healthyModels: 0,
      unhealthyModels: 0,
      averageResponseTime: 0,
      memoryStats: memoryStats,
      systemLoad: 0,
      uptime: process.uptime() * 1000,
    });
  }

  /**
   * Get model health metrics
   */
  @Get('monitoring/models')
  @HttpCode(HttpStatus.OK)
  getModelHealth(): ModelHealthMetrics[] {
    return this.modelMonitorService.getModelHealthMetrics();
  }

  /**
   * Get model health metrics (frontend path)
   */
  @Get('health/models')
  @HttpCode(HttpStatus.OK)
  getModelHealthFrontend(): ModelHealthMetrics[] {
    return this.modelMonitorService.getModelHealthMetrics();
  }

  /**
   * Get active alerts
   */
  @Get('monitoring/alerts')
  @HttpCode(HttpStatus.OK)
  getActiveAlerts(): Alert[] {
    return this.modelMonitorService.getActiveAlerts();
  }

  /**
   * Get alert history
   */
  @Get('monitoring/alerts/history')
  @HttpCode(HttpStatus.OK)
  getAlertHistory(@Query('limit') limit?: string): Alert[] {
    const limitNum = limit ? parseInt(limit, 10) : 100;
    return this.modelMonitorService.getAlertHistory(limitNum);
  }

  /**
   * Get monitoring status
   */
  @Get('monitoring/status')
  @HttpCode(HttpStatus.OK)
  getMonitoringStatus() {
    return this.modelMonitorService.getMonitoringStatus();
  }

  /**
   * Force health check on all models
   */
  @Post('monitoring/health-check')
  @HttpCode(HttpStatus.OK)
  async forceHealthCheck() {
    try {
      await this.modelMonitorService.forceHealthCheck();
      return {
        success: true,
        message: 'Health check completed',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Forced health check failed', error);
      throw error;
    }
  }

  /**
   * Update alert thresholds
   */
  @Put('monitoring/alerts/thresholds')
  @HttpCode(HttpStatus.OK)
  updateAlertThresholds(@Body() thresholds: Partial<AlertThresholds>) {
    try {
      this.modelMonitorService.updateAlertThresholds(thresholds);
      return {
        success: true,
        message: 'Alert thresholds updated',
        thresholds,
      };
    } catch (error) {
      this.logger.error('Failed to update alert thresholds', error);
      throw error;
    }
  }

  /**
   * Clear alert history
   */
  @Delete('monitoring/alerts/history')
  @HttpCode(HttpStatus.OK)
  clearAlertHistory() {
    try {
      this.modelMonitorService.clearAlertHistory();
      return {
        success: true,
        message: 'Alert history cleared',
      };
    } catch (error) {
      this.logger.error('Failed to clear alert history', error);
      throw error;
    }
  }

  // ===== OPERATIONAL RUNBOOKS =====

  /**
   * Get operational status overview
   */
  @Get('operations/status')
  @HttpCode(HttpStatus.OK)
  getOperationalStatus() {
    // Return immediate fallback data to avoid hanging
    const memoryStats = this.memoryManagerService.getMemoryStats();
    return Promise.resolve({
      timestamp: new Date().toISOString(),
      system: {
        healthy: false,
        ollamaConnected: false,
        modelsTotal: 0,
        modelsHealthy: 0,
        modelsUnhealthy: 0,
        averageResponseTime: 0,
        uptime: process.uptime() * 1000,
      },
      memory: {
        healthy:
          memoryStats.memoryPressure === 'low' ||
          memoryStats.memoryPressure === 'medium',
        pressure: memoryStats.memoryPressure,
        usagePercent: Math.round(
          (memoryStats.currentUsage / memoryStats.totalAllocated) * 100,
        ),
        currentUsageGB:
          Math.round((memoryStats.currentUsage / 1024 / 1024 / 1024) * 10) / 10,
        totalAllocatedGB:
          Math.round((memoryStats.totalAllocated / 1024 / 1024 / 1024) * 10) /
          10,
        loadedModels: memoryStats.loadedModels,
        threeTierModels: memoryStats.threeTierModels,
      },
      monitoring: {
        active: false,
        activeAlerts: 0,
        totalAlerts: 0,
        modelsMonitored: 0,
        uptime: 0,
      },
      loadedModels: this.memoryManagerService.getLoadedModels(),
      activeAlerts: [],
    });
  }

  /**
   * Emergency restart procedure
   */
  @Post('operations/emergency-restart')
  @HttpCode(HttpStatus.OK)
  async emergencyRestart() {
    try {
      this.logger.warn('🚨 EMERGENCY RESTART INITIATED');

      // Step 1: Clear all loaded models from memory manager
      const loadedModels = this.memoryManagerService.getLoadedModels();
      for (const model of loadedModels) {
        await this.memoryManagerService.forceUnloadModel(model.name);
      }

      // Step 2: Force health check to refresh status
      await this.modelMonitorService.forceHealthCheck();

      // Step 3: Preload three-tier models
      await this.memoryManagerService.preloadThreeTierModels();

      const finalStatus = await this.getOperationalStatus();

      this.logger.log('✅ Emergency restart completed');

      return {
        success: true,
        message: 'Emergency restart completed successfully',
        timestamp: new Date().toISOString(),
        finalStatus,
      };
    } catch (error) {
      this.logger.error('❌ Emergency restart failed', error);
      throw error;
    }
  }

  /**
   * Troubleshooting diagnostics
   */
  @Get('operations/diagnostics')
  @HttpCode(HttpStatus.OK)
  async getDiagnostics() {
    try {
      const systemHealth =
        await this.modelMonitorService.getSystemHealthMetrics();
      const memoryStats = this.memoryManagerService.getMemoryStats();
      const modelHealth = this.modelMonitorService.getModelHealthMetrics();
      const activeAlerts = this.modelMonitorService.getActiveAlerts();

      // Analyze common issues
      const diagnostics = {
        timestamp: new Date().toISOString(),
        overallHealth: 'healthy' as 'healthy' | 'degraded' | 'critical',
        issues: [] as string[],
        recommendations: [] as string[],
        systemHealth,
        memoryStats,
        modelHealth,
        activeAlerts,
      };

      // Check for critical issues
      if (!systemHealth.ollamaConnected) {
        diagnostics.overallHealth = 'critical';
        diagnostics.issues.push('Ollama service is not connected');
        diagnostics.recommendations.push(
          'Check if Ollama is running: ollama list',
        );
      }

      if (systemHealth.unhealthyModels > 0) {
        diagnostics.overallHealth =
          diagnostics.overallHealth === 'critical' ? 'critical' : 'degraded';
        diagnostics.issues.push(
          `${systemHealth.unhealthyModels} models are unhealthy`,
        );
        diagnostics.recommendations.push(
          'Check model health and consider restarting unhealthy models',
        );
      }

      if (memoryStats.memoryPressure === 'critical') {
        diagnostics.overallHealth = 'critical';
        diagnostics.issues.push('Critical memory pressure detected');
        diagnostics.recommendations.push(
          'Run memory optimization or unload unused models',
        );
      } else if (memoryStats.memoryPressure === 'high') {
        diagnostics.overallHealth =
          diagnostics.overallHealth === 'critical' ? 'critical' : 'degraded';
        diagnostics.issues.push('High memory pressure detected');
        diagnostics.recommendations.push('Consider optimizing memory usage');
      }

      if (systemHealth.averageResponseTime > 10000) {
        diagnostics.overallHealth =
          diagnostics.overallHealth === 'critical' ? 'critical' : 'degraded';
        diagnostics.issues.push(
          `High average response time: ${systemHealth.averageResponseTime}ms`,
        );
        diagnostics.recommendations.push(
          'Check system resources and model loading status',
        );
      }

      if (activeAlerts.filter((a) => a.severity === 'critical').length > 0) {
        diagnostics.overallHealth = 'critical';
        diagnostics.issues.push('Critical alerts are active');
        diagnostics.recommendations.push('Address critical alerts immediately');
      }

      return diagnostics;
    } catch (error) {
      this.logger.error('Diagnostics failed', error);
      throw error;
    }
  }
}
