import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '@/database';
import { UsageStatsResponseDto } from '../dto/llm-evaluation.dto';
import { getTableName } from '@orchestratorai/planes/database';

interface UsageStatsOptions {
  startDate?: string;
  endDate?: string;
  providerId?: string;
  modelId?: string;
  includeDetails?: boolean;
  granularity?: 'daily' | 'weekly' | 'monthly';
}

interface CostSummaryOptions {
  startDate?: string;
  endDate?: string;
  groupBy: 'provider' | 'model' | 'date';
}

interface ModelPerformanceOptions {
  startDate?: string;
  endDate?: string;
  minUsage: number;
  sortBy: 'rating' | 'speed' | 'cost' | 'usage';
}

interface ExportOptions {
  format: 'json' | 'csv';
  startDate?: string;
  endDate?: string;
  includeDetails?: boolean;
}

interface LLMUsageMetadata {
  input_tokens?: number;
  output_tokens?: number;
}

interface LLMMetadata {
  usage?: LLMUsageMetadata;
  cost?: number;
  total_cost?: number;
  response_time_ms?: number;
  user_rating?: number;
  user_id?: string;
  provider?: string;
  model?: string;
  timestamp?: string;
}

interface TaskWithMetadata {
  llm_metadata?: LLMMetadata;
  started_at?: string;
  completed_at?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_cost?: number;
  user_rating?: number;
  provider?: { id?: string; [key: string]: unknown };
  model?: { id?: string; [key: string]: unknown };
  timestamp?: string;
}

interface ProviderGroup {
  provider: { id?: string; [key: string]: unknown } | undefined;
  requests: number;
  tokens: number;
  cost: number;
}

interface ModelGroup {
  model: { id?: string; [key: string]: unknown } | undefined;
  requests: number;
  tokens: number;
  cost: number;
  avg_rating: number;
}

interface DateGroup {
  date: string;
  requests: number;
  tokens: number;
  cost: number;
}

interface CurrentMonthBudget {
  spent: number;
  budget: number;
  percentageUsed: number;
  daysRemaining: number;
  projectedTotal: number;
}

@Injectable()
export class UsageService {
  constructor(@Inject(DATABASE_SERVICE) private readonly db: DatabaseService) {}

  async getUserStats(
    userId: string,
    options: UsageStatsOptions,
  ): Promise<UsageStatsResponseDto> {
    const startDate = options.startDate || this.getDateDaysAgo(30);
    const endDate =
      options.endDate || (new Date().toISOString().split('T')[0] as string);

    try {
      // Query tasks table for usage stats - tasks have llm_metadata with usage info
      const { data: tasks, error } = (await this.db
        .from(null, getTableName('tasks'))
        .select(
          `
          id,
          created_at,
          completed_at,
          started_at,
          llm_metadata,
          evaluation,
          status
        `,
        )
        .eq('user_id', userId)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .not('llm_metadata', 'is', null)) as QueryResult<unknown>;

      if (error) {
        throw new Error(`Failed to fetch usage stats: ${error.message}`);
      }

      // Calculate basic stats from tasks
      const typedTasks = (tasks || []) as Array<Record<string, unknown>>;
      const completedTasks = typedTasks.filter(
        (t: Record<string, unknown>) => t.status === 'completed',
      );
      const totalRequests = typedTasks.length;

      // Extract usage metrics from llm_metadata if available
      let totalTokens = 0;
      let totalCost = 0;
      let totalResponseTime = 0;
      let responseTimeCount = 0;

      completedTasks.forEach((task: Record<string, unknown>) => {
        const metadata = (task as TaskWithMetadata).llm_metadata;
        if (metadata) {
          // Extract token usage if available
          if (metadata.usage) {
            totalTokens +=
              (metadata.usage.input_tokens || 0) +
              (metadata.usage.output_tokens || 0);
          }
          // Extract cost if available
          if (metadata.cost) {
            totalCost += metadata.cost;
          }
          // Calculate response time from timestamps
          if (task.started_at && task.completed_at) {
            const startedAt = task.started_at as string | Date;
            const completedAt = task.completed_at as string | Date;
            if (
              typeof startedAt === 'string' &&
              typeof completedAt === 'string'
            ) {
              const responseTime =
                new Date(completedAt).getTime() - new Date(startedAt).getTime();
              totalResponseTime += responseTime;
              responseTimeCount++;
            }
          }
        }
      });

      const averageResponseTime =
        responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0;

      return {
        userId,
        dateRange: {
          startDate,
          endDate,
        },
        totalRequests,
        totalTokens,
        totalCost,
        averageResponseTime,
        averageUserRating: 0, // TODO: Extract from evaluation data
      };
    } catch {
      // Return empty stats on error
      return {
        userId,
        dateRange: {
          startDate,
          endDate,
        },
        totalRequests: 0,
        totalTokens: 0,
        totalCost: 0,
        averageResponseTime: 0,
        averageUserRating: 0,
      };
    }
  }

  async getCostSummary(
    userId: string,
    options: CostSummaryOptions,
  ): Promise<{
    totalCost: number;
    totalTokens: number;
    totalRequests: number;
    period: { startDate: string; endDate: string };
    breakdown: Array<{
      key: string;
      cost: number;
      tokens: number;
      requests: number;
      percentage: number;
    }>;
    trends: Array<{
      date: string;
      cost: number;
      tokens: number;
      requests: number;
    }>;
  }> {
    const endDate = options.endDate || new Date().toISOString().split('T')[0];
    const startDate = options.startDate || this.getDateDaysAgo(30);

    const stats = await this.getUserStats(userId, {
      startDate,
      endDate,
      includeDetails: true,
    });

    const breakdown = this.createBreakdown(stats, options.groupBy);
    const trends = this.createTrends(stats.dailyStats || []);

    return {
      totalCost: stats.totalCost,
      totalTokens: stats.totalTokens,
      totalRequests: stats.totalRequests,
      period: { startDate: startDate, endDate: endDate as string },
      breakdown: breakdown as unknown as Array<{
        key: string;
        cost: number;
        tokens: number;
        requests: number;
        percentage: number;
      }>,
      trends,
    };
  }

  async getModelPerformance(
    userId: string,
    options: ModelPerformanceOptions,
  ): Promise<
    Array<{
      model: string;
      metrics: {
        usageCount: number;
        avgUserRating: number;
        avgSpeedRating: number;
        avgAccuracyRating: number;
        avgResponseTimeMs: number;
        avgCostPerRequest: number;
        totalCost: number;
        totalTokens: number;
        costEfficiencyScore: number;
        performanceScore: number;
      };
      rank: number;
    }>
  > {
    const stats = await this.getUserStats(userId, {
      startDate: options.startDate,
      endDate: options.endDate,
      includeDetails: true,
    });

    const modelMetrics = (stats.byModel || [])
      .filter((model) => model.requests >= options.minUsage)
      .map((model) => {
        const modelGroup: ModelGroup = {
          model: model.model as unknown as {
            id?: string;
            [key: string]: unknown;
          },
          requests: model.requests,
          tokens: model.tokens,
          cost: model.cost,
          avg_rating: model.avgRating || 0,
        };

        return {
          model: model.model as unknown as string,
          metrics: {
            usageCount: model.requests,
            avgUserRating: model.avgRating || 0,
            avgSpeedRating: 0, // Would need to calculate from message data
            avgAccuracyRating: 0, // Would need to calculate from message data
            avgResponseTimeMs: 0, // Would need to calculate from message data
            avgCostPerRequest:
              model.requests > 0 ? model.cost / model.requests : 0,
            totalCost: model.cost,
            totalTokens: model.tokens,
            costEfficiencyScore: this.calculateCostEfficiency(modelGroup),
            performanceScore: this.calculatePerformanceScore(modelGroup),
          },
          rank: 0, // Will be assigned after sorting
        };
      });

    // Sort by specified metric
    modelMetrics.sort((a, b) => {
      switch (options.sortBy) {
        case 'rating':
          return b.metrics.avgUserRating - a.metrics.avgUserRating;
        case 'speed':
          return a.metrics.avgResponseTimeMs - b.metrics.avgResponseTimeMs;
        case 'cost':
          return a.metrics.avgCostPerRequest - b.metrics.avgCostPerRequest;
        case 'usage':
          return b.metrics.usageCount - a.metrics.usageCount;
        default:
          return b.metrics.performanceScore - a.metrics.performanceScore;
      }
    });

    // Assign ranks
    modelMetrics.forEach((metric, index) => {
      metric.rank = index + 1;
    });

    return modelMetrics;
  }

  async getSpendingInsights(
    userId: string,
    lookbackDays: number,
  ): Promise<{
    analysisPeriod: {
      startDate: string;
      endDate: string;
      days: number;
    };
    spendingSummary: {
      totalSpent: number;
      dailyAverage: number;
      projectedMonthly: number;
      mostExpensiveDay: string;
      mostExpensiveAmount: number;
    };
    usagePatterns: {
      peakHours: number[];
      busiestDayOfWeek: string;
      avgRequestsPerDay: number;
      avgTokensPerRequest: number;
    };
    modelInsights: {
      mostUsedModel: string;
      mostExpensiveModel: string;
      bestValueModel: string;
      underutilizedModels: string[];
    };
    recommendations: Array<{
      type: string;
      title: string;
      description: string;
      potentialSavings: number;
      priority: string;
    }>;
  }> {
    const endDate = new Date().toISOString().split('T')[0]!;
    const startDate = this.getDateDaysAgo(lookbackDays);

    const stats = await this.getUserStats(userId, {
      startDate,
      endDate,
      includeDetails: true,
    });

    const spendingSummary = this.calculateSpendingSummary(stats, lookbackDays);
    const usagePatterns = this.analyzeUsagePatterns(stats);
    const modelInsights = this.analyzeModelInsights(stats);
    const recommendations = this.generateRecommendations(
      stats,
      spendingSummary,
      modelInsights,
    );

    return {
      analysisPeriod: {
        startDate: startDate,
        endDate: endDate,
        days: lookbackDays,
      },
      spendingSummary: spendingSummary,
      usagePatterns: usagePatterns,
      modelInsights: modelInsights,
      recommendations,
    };
  }

  async exportUsageData(
    userId: string,
    options: ExportOptions,
  ): Promise<Record<string, unknown>[] | string> {
    const stats = await this.getUserStats(userId, {
      startDate: options.startDate,
      endDate: options.endDate,
      includeDetails: true,
    });

    const exportData = {
      summary: {
        totalRequests: stats.totalRequests,
        totalTokens: stats.totalTokens,
        totalCost: stats.totalCost,
        averageResponseTime: stats.averageResponseTime,
        averageUserRating: stats.averageUserRating,
      },
      byProvider: stats.byProvider,
      byModel: stats.byModel,
      dailyStats: stats.dailyStats,
    };

    if (options.format === 'csv') {
      return this.convertToCSV(exportData);
    }

    return [exportData];
  }

  async getBudgetStatus(
    userId: string,
    monthlyBudget?: number,
  ): Promise<{
    currentMonth: {
      spent: number;
      budget: number;
      percentageUsed: number;
      daysRemaining: number;
      projectedTotal: number;
    };
    alerts: Array<{
      level: 'info' | 'warning' | 'danger';
      message: string;
      threshold: number;
      currentValue: number;
    }>;
    recommendations: Array<{
      action: string;
      description: string;
      estimatedSavings: number;
    }>;
  }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .split('T')[0];

    const monthlyStats = await this.getUserStats(userId, {
      startDate: startOfMonth,
      endDate: endOfMonth,
    });

    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    const daysElapsed = now.getDate();
    const daysRemaining = daysInMonth - daysElapsed;

    const dailyAverage = monthlyStats.totalCost / daysElapsed;
    const projectedTotal = dailyAverage * daysInMonth;

    const budget = monthlyBudget || 100; // Default $100 budget
    const percentageUsed = (monthlyStats.totalCost / budget) * 100;

    const currentMonth = {
      spent: monthlyStats.totalCost,
      budget,
      percentageUsed: percentageUsed,
      daysRemaining: daysRemaining,
      projectedTotal: projectedTotal,
    };

    const alerts = this.generateBudgetAlerts(currentMonth);
    const recommendations = this.generateBudgetRecommendations(
      currentMonth,
      monthlyStats,
    );

    return {
      currentMonth: currentMonth,
      alerts,
      recommendations,
    };
  }

  // Helper methods
  private calculateStats(
    messages: TaskWithMetadata[],
    startDate: string,
    endDate: string,
  ): UsageStatsResponseDto {
    const totalRequests = messages.length;
    const totalTokens = messages.reduce(
      (sum, msg) => sum + (msg.input_tokens || 0) + (msg.output_tokens || 0),
      0,
    );
    const totalCost = messages.reduce(
      (sum, msg) => sum + (msg.total_cost || 0),
      0,
    );
    const avgResponseTime =
      messages.length > 0
        ? messages.reduce(
            (sum, msg) => sum + (msg.llm_metadata?.response_time_ms || 0),
            0,
          ) / messages.length
        : 0;
    const avgUserRating =
      messages.filter((msg) => msg.llm_metadata?.user_rating).length > 0
        ? messages.reduce(
            (sum, msg) => sum + (msg.llm_metadata?.user_rating || 0),
            0,
          ) / messages.filter((msg) => msg.llm_metadata?.user_rating).length
        : undefined;

    const firstMessage = messages[0];
    return {
      userId: firstMessage?.llm_metadata?.user_id || '',
      dateRange: { startDate: startDate, endDate: endDate },
      totalRequests: totalRequests,
      totalTokens: totalTokens,
      totalCost: totalCost,
      averageResponseTime: avgResponseTime,
      averageUserRating: avgUserRating,
    };
  }

  private groupByProvider(messages: TaskWithMetadata[]): ProviderGroup[] {
    const grouped = messages.reduce(
      (acc: Record<string, ProviderGroup>, msg) => {
        const providerId = msg.provider?.id || 'unknown';
        if (!acc[providerId]) {
          acc[providerId] = {
            provider: msg.provider,
            requests: 0,
            tokens: 0,
            cost: 0,
          };
        }
        acc[providerId].requests++;
        acc[providerId].tokens +=
          (msg.input_tokens || 0) + (msg.output_tokens || 0);
        acc[providerId].cost += msg.total_cost || 0;
        return acc;
      },
      {},
    );

    return Object.values(grouped);
  }

  private groupByModel(messages: TaskWithMetadata[]): ModelGroup[] {
    const grouped = messages.reduce((acc: Record<string, ModelGroup>, msg) => {
      const modelId = msg.model?.id || 'unknown';
      if (!acc[modelId]) {
        acc[modelId] = {
          model: msg.model,
          requests: 0,
          tokens: 0,
          cost: 0,
          avg_rating: 0,
        };
      }
      acc[modelId].requests++;
      acc[modelId].tokens += (msg.input_tokens || 0) + (msg.output_tokens || 0);
      acc[modelId].cost += msg.total_cost || 0;
      return acc;
    }, {});

    return Object.values(grouped);
  }

  private groupByDate(
    messages: TaskWithMetadata[],
    _granularity: string,
  ): DateGroup[] {
    const grouped = messages.reduce((acc: Record<string, DateGroup>, msg) => {
      const timestamp =
        msg.llm_metadata?.timestamp ||
        msg.timestamp ||
        new Date().toISOString();
      const date = new Date(timestamp).toISOString().split('T')[0]!;
      if (!acc[date]) {
        acc[date] = {
          date,
          requests: 0,
          tokens: 0,
          cost: 0,
        };
      }
      acc[date].requests++;
      acc[date].tokens += (msg.input_tokens || 0) + (msg.output_tokens || 0);
      acc[date].cost += msg.total_cost || 0;
      return acc;
    }, {});

    return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
  }

  private createBreakdown(
    _stats: UsageStatsResponseDto,
    _groupBy: string,
  ): Array<Record<string, unknown>> {
    // Implementation depends on groupBy parameter
    return [];
  }

  private createTrends(dailyStats: DateGroup[]): DateGroup[] {
    return dailyStats.map((day) => ({
      date: day.date,
      cost: day.cost,
      tokens: day.tokens,
      requests: day.requests,
    }));
  }

  private calculateCostEfficiency(model: ModelGroup | ProviderGroup): number {
    // Simple cost efficiency score based on cost per token
    return model.tokens > 0 ? 1 / (model.cost / model.tokens) : 0;
  }

  private calculatePerformanceScore(model: ModelGroup): number {
    // Composite score based on rating and cost efficiency
    return (
      (model.avg_rating || 0) * 0.7 + this.calculateCostEfficiency(model) * 0.3
    );
  }

  private calculateSpendingSummary(
    stats: UsageStatsResponseDto,
    days: number,
  ): {
    totalSpent: number;
    dailyAverage: number;
    projectedMonthly: number;
    mostExpensiveDay: string;
    mostExpensiveAmount: number;
  } {
    return {
      totalSpent: stats.totalCost,
      dailyAverage: stats.totalCost / days,
      projectedMonthly: (stats.totalCost / days) * 30,
      mostExpensiveDay: '',
      mostExpensiveAmount: 0,
    };
  }

  private analyzeUsagePatterns(stats: UsageStatsResponseDto): {
    peakHours: number[];
    busiestDayOfWeek: string;
    avgRequestsPerDay: number;
    avgTokensPerRequest: number;
  } {
    return {
      peakHours: [9, 10, 14, 15], // Mock data
      busiestDayOfWeek: 'Tuesday',
      avgRequestsPerDay: stats.totalRequests / 30,
      avgTokensPerRequest: stats.totalTokens / stats.totalRequests,
    };
  }

  private analyzeModelInsights(_stats: UsageStatsResponseDto): {
    mostUsedModel: string;
    mostExpensiveModel: string;
    bestValueModel: string;
    underutilizedModels: string[];
  } {
    return {
      mostUsedModel: 'GPT-4o',
      mostExpensiveModel: 'Claude 3 Opus',
      bestValueModel: 'GPT-4o Mini',
      underutilizedModels: [],
    };
  }

  private generateRecommendations(
    _stats: UsageStatsResponseDto,
    spending: {
      totalSpent: number;
      dailyAverage: number;
      projectedMonthly: number;
      mostExpensiveDay: string;
      mostExpensiveAmount: number;
    },
    _insights: {
      mostUsedModel: string;
      mostExpensiveModel: string;
      bestValueModel: string;
      underutilizedModels: string[];
    },
  ): Array<{
    type: string;
    title: string;
    description: string;
    potentialSavings: number;
    priority: string;
  }> {
    return [
      {
        type: 'cost_optimization',
        title: 'Consider using more cost-effective models',
        description:
          'Switch to GPT-4o Mini for simpler tasks to reduce costs by up to 80%',
        potentialSavings: spending.totalSpent * 0.3,
        priority: 'medium',
      },
    ];
  }

  private generateBudgetAlerts(currentMonth: CurrentMonthBudget): Array<{
    level: 'danger' | 'warning';
    message: string;
    threshold: number;
    currentValue: number;
  }> {
    const alerts: Array<{
      level: 'danger' | 'warning';
      message: string;
      threshold: number;
      currentValue: number;
    }> = [];

    if (currentMonth.percentageUsed > 90) {
      alerts.push({
        level: 'danger' as const,
        message: 'You have exceeded 90% of your monthly budget',
        threshold: 90,
        currentValue: currentMonth.percentageUsed,
      });
    } else if (currentMonth.percentageUsed > 75) {
      alerts.push({
        level: 'warning' as const,
        message: 'You have used 75% of your monthly budget',
        threshold: 75,
        currentValue: currentMonth.percentageUsed,
      });
    }

    if (currentMonth.projectedTotal > currentMonth.budget * 1.2) {
      alerts.push({
        level: 'warning' as const,
        message: 'Current spending pace will exceed budget by 20%',
        threshold: currentMonth.budget,
        currentValue: currentMonth.projectedTotal,
      });
    }

    return alerts;
  }

  private generateBudgetRecommendations(
    currentMonth: CurrentMonthBudget,
    _stats: UsageStatsResponseDto,
  ): Array<{ action: string; description: string; estimatedSavings: number }> {
    return [
      {
        action: 'switch_to_cheaper_models',
        description: 'Use more cost-effective models for routine tasks',
        estimatedSavings: currentMonth.spent * 0.2,
      },
    ];
  }

  private convertToCSV(data: unknown): string {
    // Simple CSV conversion - would need more sophisticated implementation
    return JSON.stringify(data);
  }

  private getDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    const dateString = date.toISOString().split('T')[0]!;
    return dateString;
  }
}
