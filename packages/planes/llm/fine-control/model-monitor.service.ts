import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { LocalModelStatusService } from './local-model-status.service';
import { MemoryManagerService, MemoryStats } from './memory-manager.service';
import { DATABASE_SERVICE, DatabaseService } from '@/database';

export interface AlertThresholds {
  responseTime: number; // milliseconds
  errorRate: number; // percentage (0-1)
  memoryUsage: number; // percentage (0-1)
  modelUnavailableTime: number; // milliseconds
  consecutiveFailures: number;
}

export interface ModelHealthMetrics {
  modelName: string;
  tier: string;
  isAvailable: boolean;
  averageResponseTime: number;
  errorRate: number;
  consecutiveFailures: number;
  lastSuccessfulCheck: string;
  lastErrorMessage?: string;
  checksPerformed: number;
  totalErrors: number;
}

export interface SystemHealthMetrics {
  ollamaConnected: boolean;
  totalModels: number;
  healthyModels: number;
  unhealthyModels: number;
  memoryStats: MemoryStats;
  averageResponseTime: number;
  systemLoad: number;
  uptime: number;
}

export interface Alert {
  id: string;
  type:
    | 'model-unavailable'
    | 'slow-response'
    | 'high-error-rate'
    | 'memory-pressure'
    | 'system-error';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  modelName?: string;
  tier?: string;
  metrics?: Record<string, unknown>;
  timestamp: string;
  resolved: boolean;
  resolvedAt?: string;
}

@Injectable()
export class ModelMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModelMonitorService.name);
  private healthCheckInterval!: NodeJS.Timeout;
  private memoryCheckInterval!: NodeJS.Timeout;
  private systemCheckInterval!: NodeJS.Timeout;
  private startTime = Date.now();

  private alertThresholds: AlertThresholds = {
    responseTime: 10000, // 10 seconds
    errorRate: 0.1, // 10%
    memoryUsage: 0.9, // 90%
    modelUnavailableTime: 300000, // 5 minutes
    consecutiveFailures: 3,
  };

  private modelMetrics = new Map<string, ModelHealthMetrics>();
  private activeAlerts = new Map<string, Alert>();
  private alertHistory: Alert[] = [];
  private isMonitoring = false;

  constructor(
    private readonly localModelStatusService: LocalModelStatusService,
    private readonly memoryManagerService: MemoryManagerService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {
    this.logger.log('ModelMonitorService initialized');
  }

  onModuleInit() {
    // Load alert thresholds from environment or database
    this.loadAlertThresholds();

    // Skip automatic model metrics initialization and monitoring
    // Only initialize metrics when models are explicitly requested
    // await this.initializeModelMetrics();
    // this.startMonitoring();
  }

  onModuleDestroy() {
    this.stopMonitoring();
  }

  /**
   * Start all monitoring intervals
   */
  private startMonitoring(): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;

    // Model health checks every 2 minutes
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks().catch((error) => {
        this.logger.error('Health check failed', error);
      });
    }, 120000);

    // Memory checks every 1 minute
    this.memoryCheckInterval = setInterval(() => {
      this.checkMemoryHealth();
    }, 60000);

    // System checks every 5 minutes
    this.systemCheckInterval = setInterval(() => {
      this.checkSystemHealth().catch((error) => {
        this.logger.error('System health check failed', error);
      });
    }, 300000);

    this.logger.log('Monitoring started');
  }

  /**
   * Stop all monitoring intervals
   */
  private stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
    }
    if (this.systemCheckInterval) {
      clearInterval(this.systemCheckInterval);
    }

    this.isMonitoring = false;
    this.logger.log('Monitoring stopped');
  }

  /**
   * Load alert thresholds from configuration
   */
  private loadAlertThresholds(): void {
    try {
      // Override with environment variables if present
      this.alertThresholds = {
        responseTime: parseInt(
          process.env.ALERT_RESPONSE_TIME_MS || '10000',
          10,
        ),
        errorRate: parseFloat(process.env.ALERT_ERROR_RATE || '0.1'),
        memoryUsage: parseFloat(process.env.ALERT_MEMORY_USAGE || '0.9'),
        modelUnavailableTime: parseInt(
          process.env.ALERT_UNAVAILABLE_TIME_MS || '300000',
          10,
        ),
        consecutiveFailures: parseInt(
          process.env.ALERT_CONSECUTIVE_FAILURES || '3',
          10,
        ),
      };

      this.logger.debug('Alert thresholds loaded', this.alertThresholds);
    } catch (error) {
      this.logger.error('Failed to load alert thresholds', error);
    }
  }

  /**
   * Initialize model metrics for all local models
   */
  private async initializeModelMetrics(): Promise<void> {
    try {
      const models =
        await this.localModelStatusService.getLocalModelsFromDatabase();

      for (const model of models) {
        const metrics: ModelHealthMetrics = {
          modelName: model.modelName,
          tier: model.tier,
          isAvailable: false,
          averageResponseTime: 0,
          errorRate: 0,
          consecutiveFailures: 0,
          lastSuccessfulCheck: new Date().toISOString(),
          checksPerformed: 0,
          totalErrors: 0,
        };

        this.modelMetrics.set(model.modelName, metrics);
      }

      this.logger.debug(
        `Initialized metrics for ${this.modelMetrics.size} models`,
      );
    } catch (error) {
      this.logger.error('Failed to initialize model metrics', error);
    }
  }

  /**
   * Perform health checks on all models
   */
  async performHealthChecks(): Promise<void> {
    try {
      const models = Array.from(this.modelMetrics.keys());

      for (const modelName of models) {
        await this.checkModelHealth(modelName);
      }

      this.logger.debug(`Health checks completed for ${models.length} models`);
    } catch (error) {
      this.logger.error('Health checks failed', error);
    }
  }

  /**
   * Check health of a specific model
   */
  private async checkModelHealth(modelName: string): Promise<void> {
    const metrics = this.modelMetrics.get(modelName);
    if (!metrics) {
      return;
    }

    try {
      const health =
        await this.localModelStatusService.checkModelHealth(modelName);

      // Update metrics
      metrics.checksPerformed++;

      if (health.available) {
        metrics.isAvailable = true;
        metrics.consecutiveFailures = 0;
        metrics.lastSuccessfulCheck = new Date().toISOString();

        // Update average response time
        if (metrics.checksPerformed === 1) {
          metrics.averageResponseTime = health.responseTime;
        } else {
          metrics.averageResponseTime =
            metrics.averageResponseTime * 0.8 + health.responseTime * 0.2;
        }

        // Resolve availability alert if exists
        this.resolveAlert(`model-unavailable-${modelName}`);

        // Check for slow response
        if (health.responseTime > this.alertThresholds.responseTime) {
          this.createAlert({
            type: 'slow-response',
            severity: 'medium',
            modelName,
            tier: metrics.tier,
            message: `Model ${modelName} response time (${health.responseTime}ms) exceeds threshold (${this.alertThresholds.responseTime}ms)`,
            metrics: {
              responseTime: health.responseTime,
              threshold: this.alertThresholds.responseTime,
            },
          });
        }
      } else {
        metrics.isAvailable = false;
        metrics.consecutiveFailures++;
        metrics.totalErrors++;
        metrics.lastErrorMessage = health.errorMessage;

        // Update error rate
        metrics.errorRate = metrics.totalErrors / metrics.checksPerformed;

        // Check for consecutive failures
        if (
          metrics.consecutiveFailures >=
          this.alertThresholds.consecutiveFailures
        ) {
          this.createAlert({
            type: 'model-unavailable',
            severity: 'high',
            modelName,
            tier: metrics.tier,
            message: `Model ${modelName} has ${metrics.consecutiveFailures} consecutive failures`,
            metrics: {
              consecutiveFailures: metrics.consecutiveFailures,
              errorMessage: health.errorMessage,
            },
          });
        }

        // Check for high error rate
        if (
          metrics.errorRate > this.alertThresholds.errorRate &&
          metrics.checksPerformed >= 10
        ) {
          this.createAlert({
            type: 'high-error-rate',
            severity: 'medium',
            modelName,
            tier: metrics.tier,
            message: `Model ${modelName} error rate (${(metrics.errorRate * 100).toFixed(1)}%) exceeds threshold (${(this.alertThresholds.errorRate * 100).toFixed(1)}%)`,
            metrics: {
              errorRate: metrics.errorRate,
              threshold: this.alertThresholds.errorRate,
            },
          });
        }
      }

      this.modelMetrics.set(modelName, metrics);
    } catch (error) {
      this.logger.error(`Failed to check health for ${modelName}`, error);

      if (metrics) {
        metrics.consecutiveFailures++;
        metrics.totalErrors++;
        metrics.checksPerformed++;
        metrics.lastErrorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.modelMetrics.set(modelName, metrics);
      }
    }
  }

  /**
   * Check memory health and pressure
   */
  private checkMemoryHealth(): void {
    try {
      const memoryStats = this.memoryManagerService.getMemoryStats();
      const usageRatio = memoryStats.currentUsage / memoryStats.totalAllocated;

      if (usageRatio > this.alertThresholds.memoryUsage) {
        this.createAlert({
          type: 'memory-pressure',
          severity:
            memoryStats.memoryPressure === 'critical' ? 'critical' : 'high',
          message: `Memory usage (${(usageRatio * 100).toFixed(1)}%) exceeds threshold (${(this.alertThresholds.memoryUsage * 100).toFixed(1)}%)`,
          metrics: {
            usageRatio,
            threshold: this.alertThresholds.memoryUsage,
            memoryPressure: memoryStats.memoryPressure,
            currentUsageGB: memoryStats.currentUsage / 1024 / 1024 / 1024,
            totalAllocatedGB: memoryStats.totalAllocated / 1024 / 1024 / 1024,
          },
        });
      } else {
        // Resolve memory pressure alert if usage is back to normal
        this.resolveAlert('memory-pressure');
      }
    } catch (error) {
      this.logger.error('Memory health check failed', error);
    }
  }

  /**
   * Check overall system health
   */
  private async checkSystemHealth(): Promise<void> {
    try {
      const status = await this.localModelStatusService.getOllamaStatus();

      if (!status.connected) {
        this.createAlert({
          type: 'system-error',
          severity: 'critical',
          message: 'Ollama service is not connected',
          metrics: { errorMessage: status.errorMessage },
        });
      } else {
        this.resolveAlert('system-error-ollama');
      }
    } catch (error) {
      this.logger.error('System health check failed', error);

      this.createAlert({
        type: 'system-error',
        severity: 'high',
        message: `System health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metrics: {
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  /**
   * Create an alert
   */
  private createAlert(alertData: {
    type: Alert['type'];
    severity: Alert['severity'];
    message: string;
    modelName?: string;
    tier?: string;
    metrics?: Record<string, unknown>;
  }): void {
    const alertId = `${alertData.type}${alertData.modelName ? `-${alertData.modelName}` : ''}`;

    // Check if alert already exists and is not resolved
    const existingAlert = this.activeAlerts.get(alertId);
    if (existingAlert && !existingAlert.resolved) {
      return; // Don't create duplicate alerts
    }

    const alert: Alert = {
      id: alertId,
      type: alertData.type,
      severity: alertData.severity,
      message: alertData.message,
      modelName: alertData.modelName,
      tier: alertData.tier,
      metrics: alertData.metrics,
      timestamp: new Date().toISOString(),
      resolved: false,
    };

    this.activeAlerts.set(alertId, alert);
    this.alertHistory.push(alert);

    // Log based on severity
    switch (alertData.severity) {
      case 'critical':
        this.logger.error(`🚨 CRITICAL ALERT: ${alert.message}`, alert.metrics);
        break;
      case 'high':
        this.logger.error(`⚠️ HIGH ALERT: ${alert.message}`, alert.metrics);
        break;
      case 'medium':
        this.logger.warn(`⚡ MEDIUM ALERT: ${alert.message}`, alert.metrics);
        break;
      case 'low':
        this.logger.log(`ℹ️ LOW ALERT: ${alert.message}`, alert.metrics);
        break;
    }

    // Store alert in database (optional)
    this.storeAlert(alert).catch((error) => {
      this.logger.debug('Failed to store alert in database', error);
    });
  }

  /**
   * Resolve an alert
   */
  private resolveAlert(alertId: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = new Date().toISOString();

      this.logger.log(`✅ RESOLVED: ${alert.message}`);

      // Update in database
      this.updateAlertInDatabase(alert).catch((error) => {
        this.logger.debug('Failed to update resolved alert in database', error);
      });
    }
  }

  /**
   * Store alert in database
   */
  private async storeAlert(alert: Alert): Promise<void> {
    try {
      const { error } = await this.db.from(null, 'model_alerts').insert({
        alert_id: alert.id,
        alert_type: alert.type,
        severity: alert.severity,
        message: alert.message,
        model_name: alert.modelName,
        tier: alert.tier,
        metrics: alert.metrics,
        timestamp: alert.timestamp,
        resolved: alert.resolved,
        resolved_at: alert.resolvedAt,
      });

      if (error) {
        // Only log debug message for database errors to avoid spam
        this.logger.debug(
          'Alert storage failed (database may not be configured)',
          error,
        );
      }
    } catch (error) {
      // Fail silently if table doesn't exist
      this.logger.debug('Alert storage failed (table may not exist)', error);
    }
  }

  /**
   * Update alert in database
   */
  private async updateAlertInDatabase(alert: Alert): Promise<void> {
    try {
      const { error } = await this.db
        .from(null, 'model_alerts')
        .update({
          resolved: alert.resolved,
          resolved_at: alert.resolvedAt,
        })
        .eq('alert_id', alert.id);

      if (error) {
        this.logger.error('Failed to update alert', error);
      }
    } catch (error) {
      this.logger.debug('Alert update failed (table may not exist)', error);
    }
  }

  /**
   * Get current system health metrics
   */
  async getSystemHealthMetrics(): Promise<SystemHealthMetrics> {
    // Add timeout to prevent hanging on Ollama connection
    let status;
    try {
      status = await Promise.race([
        this.localModelStatusService.getOllamaStatus(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Ollama status timeout')), 5000),
        ),
      ]);
    } catch (error) {
      // Fallback status if Ollama is unavailable
      status = {
        connected: false,
        version: 'unknown',
        models: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const memoryStats = this.memoryManagerService.getMemoryStats();

    const healthyModels = Array.from(this.modelMetrics.values()).filter(
      (m) => m.isAvailable,
    ).length;

    const unhealthyModels = this.modelMetrics.size - healthyModels;

    const responseTimes = Array.from(this.modelMetrics.values())
      .filter((m) => m.averageResponseTime > 0)
      .map((m) => m.averageResponseTime);

    const averageResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

    return {
      ollamaConnected: status.connected,
      totalModels: this.modelMetrics.size,
      healthyModels,
      unhealthyModels,
      memoryStats,
      averageResponseTime: Math.round(averageResponseTime),
      systemLoad: 0, // Placeholder - could integrate with system monitoring
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Get model health metrics
   */
  getModelHealthMetrics(): ModelHealthMetrics[] {
    return Array.from(this.modelMetrics.values());
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).filter(
      (alert) => !alert.resolved,
    );
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit = 100): Alert[] {
    return this.alertHistory
      .slice(-limit)
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
  }

  /**
   * Update alert thresholds
   */
  updateAlertThresholds(thresholds: Partial<AlertThresholds>): void {
    this.alertThresholds = { ...this.alertThresholds, ...thresholds };
    this.logger.log('Alert thresholds updated', this.alertThresholds);
  }

  /**
   * Force a health check on all models
   */
  async forceHealthCheck(): Promise<void> {
    this.logger.log('Forcing health check on all models');
    await this.performHealthChecks();
    this.checkMemoryHealth();
    await this.checkSystemHealth();
  }

  /**
   * Clear alert history
   */
  clearAlertHistory(): void {
    this.alertHistory = [];
    this.logger.log('Alert history cleared');
  }

  /**
   * Get monitoring status
   */
  getMonitoringStatus(): {
    isMonitoring: boolean;
    startTime: string;
    uptime: number;
    alertsActive: number;
    alertsTotal: number;
    modelsMonitored: number;
  } {
    return {
      isMonitoring: this.isMonitoring,
      startTime: new Date(this.startTime).toISOString(),
      uptime: Date.now() - this.startTime,
      alertsActive: this.getActiveAlerts().length,
      alertsTotal: this.alertHistory.length,
      modelsMonitored: this.modelMetrics.size,
    };
  }
}
