import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
} from '@nestjs/common';
import { DATABASE_SERVICE, DatabaseService } from '@/database';
import {
  MessageEvaluationDto,
  EnhancedMessageResponseDto,
  ModelResponseDto,
} from '../dto/llm-evaluation.dto';
import {
  mapLLMProviderFromDb,
  mapLLMModelFromDb,
  snakeToCamel,
} from '@/utils/case-converter';
import {
  EnhancedEvaluationMetadataDto,
  AdminEvaluationFiltersDto,
  EvaluationAnalyticsDto,
  EvaluationUserDto,
  EvaluationDataDto,
  EvaluationTaskDto,
  WorkflowTrackingDto,
  LLMConstraintsDto,
  EnhancedLLMInfoDto,
  WorkflowStepDto,
  AgentLLMRecommendationDto,
} from '../dto/enhanced-evaluation.dto';
import {
  enhancedMessageResponseSchema,
  enhancedMessageResponseArraySchema,
  evaluationStatsRowsSchema,
  modelComparisonRowsSchema,
  taskRecordArraySchema,
} from '../types/evaluation.schemas';
import type {
  EvaluationFilters,
  EvaluationStatsFilters,
  ModelComparisonFilters,
  FeedbackExportOptions,
  AllUserEvaluationsFilters,
  EvaluationStatsRow,
  ModelComparisonMessageRow,
  TaskRecord,
  MessageRecord,
  UserProfileRecord,
} from '../types/evaluation.types';
import type { Provider, UserRatingScale } from '../types/llm-evaluation';

/**
 * Database record type for profiles table
 */
interface ProfileDbRecord {
  id: string;
  email?: string;
  display_name?: string;
  roles?: string[];
}

/**
 * Database record type for llm_providers table
 */
interface LLMProviderDbRecord {
  id: string;
  [key: string]: unknown;
}

/**
 * Database record type for llm_models table
 */
interface LLMModelDbRecord {
  id: string;
  [key: string]: unknown;
}

/**
 * Format agent names for display by converting from database format to human-readable format
 */
function formatAgentNameForDisplay(agentName: string): string {
  if (!agentName) return 'AI Assistant';

  // Handle already formatted names
  if (agentName.includes(' ') && agentName !== 'Process Agent') {
    return agentName;
  }

  // Convert snake_case or lowercase names to Title Case
  return (
    agentName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (l: string) => l.toUpperCase())
      .replace(/\s+Agent$/, '') // Remove trailing "Agent" if present
      .trim() + ' Agent'
  );
}

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(@Inject(DATABASE_SERVICE) private readonly db: DatabaseService) {}

  private parseEnhancedMessage(row: unknown): EnhancedMessageResponseDto {
    return enhancedMessageResponseSchema.parse(row);
  }

  private parseEnhancedMessages(rows: unknown[]): EnhancedMessageResponseDto[] {
    return enhancedMessageResponseArraySchema.parse(rows);
  }

  async evaluateMessage(
    userId: string,
    messageId: string,
    evaluationDto: MessageEvaluationDto,
  ): Promise<EnhancedMessageResponseDto | null> {
    const client = this.db;

    // Verify message exists and belongs to user
    const { data: message, error: messageError } = (await client
      .from(null, 'messages')
      .select('*')
      .eq('id', messageId)
      .eq('user_id', userId)
      .single()) as { data: unknown; error: unknown };

    if (messageError || !message) {
      return null;
    }

    // Update message with evaluation data
    const { data: updatedMessage, error: updateError } = (await client
      .from(null, 'messages')
      .update({
        user_rating: evaluationDto.userRating,
        speed_rating: evaluationDto.speedRating,
        accuracy_rating: evaluationDto.accuracyRating,
        user_notes: evaluationDto.userNotes,
        evaluation_details: evaluationDto.evaluationDetails,
        evaluation_timestamp: new Date().toISOString(),
      })
      .eq('id', messageId)
      .eq('user_id', userId)
      .select(
        `
        *,
        provider:llm_providers(*),
        model:llm_models(*)
      `,
      )
      .single()) as { data: unknown; error: unknown };

    if (updateError) {
      const err = updateError as Record<string, unknown>;
      throw new HttpException(
        `Failed to save evaluation: ${String(err.message)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Note: Usage statistics tracking removed during database cleanup
    // User rating is stored in the message evaluation data

    return this.parseEnhancedMessage(updatedMessage);
  }

  async getMessageWithEvaluation(
    userId: string,
    messageId: string,
  ): Promise<EnhancedMessageResponseDto | null> {
    const client = this.db;

    const { data: message, error } = (await client
      .from(null, 'messages')
      .select(
        `
        *,
        provider:llm_providers(*),
        model:llm_models(*)
      `,
      )
      .eq('id', messageId)
      .eq('user_id', userId)
      .single()) as {
      data: unknown;
      error: { code?: string; message: string } | null;
    };

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw new HttpException(
        `Failed to fetch message: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return this.parseEnhancedMessage(message);
  }

  async getSessionEvaluations(
    userId: string,
    sessionId: string,
    filters: EvaluationFilters = {},
  ): Promise<EnhancedMessageResponseDto[]> {
    const client = this.db;

    let query = client
      .from(null, 'messages')
      .select(
        `
        *,
        provider:llm_providers(*),
        model:llm_models(*)
      `,
      )
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .not('user_rating', 'is', null)
      .order('timestamp');

    if (filters.minRating) {
      query = query.gte('user_rating', filters.minRating);
    }

    if (filters.hasNotes) {
      query = query.not('user_notes', 'is', null);
    }

    const { data: messages, error } = (await query) as {
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    };

    if (error) {
      throw new HttpException(
        `Failed to fetch session evaluations: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (!messages) {
      return [];
    }

    return this.parseEnhancedMessages(messages);
  }

  async getEvaluationStats(
    userId: string,
    filters: EvaluationStatsFilters = {},
  ): Promise<{
    totalEvaluations: number;
    averageOverallRating: number;
    averageSpeedRating: number;
    averageAccuracyRating: number;
    evaluationDistribution: Record<string, number>;
    modelPerformance: Array<{
      model: string;
      avgRating: number;
      evaluationCount: number;
    }>;
  }> {
    const client = this.db;

    // Build base query
    let query = client
      .from(null, 'messages')
      .select(
        `
        user_rating,
        speed_rating,
        accuracy_rating,
        provider_id,
        model_id,
        model:llm_models(*),
        timestamp
      `,
      )
      .eq('user_id', userId)
      .not('user_rating', 'is', null);

    if (filters.startDate) {
      query = query.gte('timestamp', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('timestamp', filters.endDate);
    }

    if (filters.providerId) {
      query = query.eq('provider_id', filters.providerId);
    }

    if (filters.modelId) {
      query = query.eq('model_id', filters.modelId);
    }

    const { data: evaluations, error } = (await query) as {
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    };

    if (error) {
      throw new HttpException(
        `Failed to fetch evaluation stats: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const evaluationRows = evaluations
      ? evaluationStatsRowsSchema.parse(evaluations)
      : [];

    const stats = this.calculateEvaluationStats(evaluationRows);
    const modelPerformance = this.calculateModelPerformance(evaluationRows);

    return {
      ...stats,
      modelPerformance: modelPerformance.map((perf) => ({
        model:
          perf.model?.id ??
          perf.model?.name ??
          perf.model?.model_name ??
          'unknown',
        avgRating: perf.avgRating,
        evaluationCount: perf.evaluationCount,
      })),
    };
  }

  async updateMessageEvaluation(
    userId: string,
    messageId: string,
    evaluationDto: MessageEvaluationDto,
  ): Promise<EnhancedMessageResponseDto | null> {
    // Same as evaluateMessage but for updates
    return this.evaluateMessage(userId, messageId, evaluationDto);
  }

  async exportUserFeedback(
    userId: string,
    options: FeedbackExportOptions,
  ): Promise<Record<string, unknown>[] | string> {
    const client = this.db;

    const selectFields = [
      'id',
      'timestamp',
      options.includeContent ? 'content' : null,
      'user_rating',
      'speed_rating',
      'accuracy_rating',
      'user_notes',
      'evaluation_timestamp',
      'total_cost',
      'input_tokens',
      'output_tokens',
      'response_time_ms',
      'provider:llm_providers(name)',
      'model:llm_models(name, model_id)',
    ]
      .filter(Boolean)
      .join(', ');

    let query = client
      .from(null, 'messages')
      .select(selectFields)
      .eq('user_id', userId)
      .not('user_rating', 'is', null)
      .order('timestamp');

    if (options.startDate) {
      query = query.gte('timestamp', options.startDate);
    }

    if (options.endDate) {
      query = query.lte('timestamp', options.endDate);
    }

    const { data: feedback, error } = (await query) as {
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    };

    if (error) {
      throw new HttpException(
        `Failed to export feedback: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (options.format === 'csv') {
      return this.convertFeedbackToCSV(feedback || []);
    }

    return (feedback as unknown as Record<string, unknown>[] | null) || [];
  }

  async compareModels(
    userId: string,
    modelIds: string[],
    filters: ModelComparisonFilters = {},
  ): Promise<{
    comparison: Array<{
      model: string;
      metrics: {
        avgOverallRating: number;
        avgSpeedRating: number;
        avgAccuracyRating: number;
        avgResponseTimeMs: number;
        avgCost: number;
        evaluationCount: number;
      };
    }>;
    recommendations: string[];
  }> {
    const client = this.db;

    let query = client
      .from(null, 'messages')
      .select(
        `
        user_rating,
        speed_rating,
        accuracy_rating,
        response_time_ms,
        total_cost,
        model:llm_models(*),
        timestamp
      `,
      )
      .eq('user_id', userId)
      .in('model_id', modelIds)
      .not('user_rating', 'is', null);

    if (filters.startDate) {
      query = query.gte('timestamp', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('timestamp', filters.endDate);
    }

    const { data: messages, error } = (await query) as {
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    };

    if (error) {
      throw new HttpException(
        `Failed to fetch model comparison data: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const comparisonRows = messages
      ? modelComparisonRowsSchema.parse(messages)
      : [];

    const comparison = this.calculateModelComparison(comparisonRows);
    const recommendations = this.generateModelRecommendations(comparison);

    return {
      comparison: comparison.map((comp) => ({
        model:
          comp.model?.id ??
          comp.model?.name ??
          comp.model?.model_name ??
          'unknown',
        metrics: comp.metrics,
      })),
      recommendations,
    };
  }

  async getAgentLLMRecommendations(
    agentIdentifier: string,
    minRating: number = 3,
  ): Promise<AgentLLMRecommendationDto[]> {
    const normalizedTarget = this.normalizeAgentIdentifier(agentIdentifier);
    if (!normalizedTarget) {
      return [];
    }

    interface AggregateEntry {
      providerId?: string;
      providerName?: string;
      modelId?: string;
      modelName?: string;
      totalRating: number;
      evaluationCount: number;
      lastEvaluatedAt?: string;
    }

    const aggregates = new Map<string, AggregateEntry>();
    const providerIds = new Set<string>();
    const modelIds = new Set<string>();

    const client = this.db;

    const [
      { data: tasksData, error: taskError },
      { data: messagesData, error: messageError },
    ] = await Promise.all([
      client
        .from(null, 'tasks')
        .select('*')
        .not('evaluation', 'is', null)
        .not('llm_metadata', 'is', null) as unknown as Promise<{
        data: TaskRecord[] | null;
        error: unknown;
      }>,
      client
        .from(null, 'messages')
        .select(
          `
            *,
            provider:llm_providers(*),
            model:llm_models(*)
          `,
        )
        .not('user_rating', 'is', null) as unknown as Promise<{
        data: MessageRecord[] | null;
        error: unknown;
      }>,
    ]);

    if (taskError) {
      const taskErrorMsg =
        taskError && typeof taskError === 'object' && 'message' in taskError
          ? (taskError as Error).message
          : typeof taskError === 'string'
            ? taskError
            : JSON.stringify(taskError);
      this.logger.warn(
        `[EvaluationService] Failed to fetch task evaluations for agent ${agentIdentifier}: ${taskErrorMsg}`,
      );
    }

    const effectiveMessages = messagesData || [];

    if (messageError) {
      const messageErrorMsg =
        messageError &&
        typeof messageError === 'object' &&
        'message' in messageError
          ? (messageError as Error).message
          : typeof messageError === 'string'
            ? messageError
            : JSON.stringify(messageError);
      this.logger.warn(
        `[EvaluationService] Failed to fetch message evaluations for agent ${agentIdentifier}: ${messageErrorMsg}`,
      );
    }

    const relevantTasks = (tasksData || []).filter((task) =>
      this.recordMatchesAgent(task, normalizedTarget),
    );

    const relevantMessages = (effectiveMessages || []).filter((message) =>
      this.recordMatchesAgent(message, normalizedTarget),
    );

    if (relevantTasks.length === 0 && relevantMessages.length === 0) {
      return [];
    }

    const accumulateSample = (
      info: {
        rating: number;
        providerId?: string;
        providerName?: string;
        modelId?: string;
        modelName?: string;
        timestamp?: string;
      } | null,
    ) => {
      if (
        !info ||
        typeof info.rating !== 'number' ||
        Number.isNaN(info.rating)
      ) {
        return;
      }

      const {
        rating,
        providerId,
        providerName,
        modelId,
        modelName,
        timestamp,
      } = info;

      if (providerId) {
        providerIds.add(providerId);
      }
      if (modelId) {
        modelIds.add(modelId);
      }

      const aggregateKey = this.buildRecommendationKey(
        providerId,
        providerName,
        modelId,
        modelName,
      );

      let entry = aggregates.get(aggregateKey);
      if (!entry) {
        entry = {
          providerId,
          providerName,
          modelId,
          modelName,
          totalRating: 0,
          evaluationCount: 0,
        };
        aggregates.set(aggregateKey, entry);
      }

      if (providerName && !entry.providerName) {
        entry.providerName = providerName;
      }
      if (modelName && !entry.modelName) {
        entry.modelName = modelName;
      }
      if (providerId && !entry.providerId) {
        entry.providerId = providerId;
      }
      if (modelId && !entry.modelId) {
        entry.modelId = modelId;
      }

      entry.totalRating += rating;
      entry.evaluationCount += 1;

      if (timestamp) {
        const currentTimestamp = entry.lastEvaluatedAt
          ? new Date(entry.lastEvaluatedAt).getTime()
          : 0;
        const candidateTimestamp = new Date(timestamp).getTime();
        if (candidateTimestamp > currentTimestamp) {
          entry.lastEvaluatedAt = new Date(timestamp).toISOString();
        }
      }
    };

    relevantTasks.forEach((task) => {
      const rating = task.evaluation?.user_rating;
      if (typeof rating !== 'number' || Number.isNaN(rating)) {
        return;
      }
      const providerModelInfo = this.extractProviderModelInfo(task);
      if (!providerModelInfo) {
        return;
      }

      accumulateSample({
        rating,
        providerId: providerModelInfo.providerId,
        providerName: providerModelInfo.providerName,
        modelId: providerModelInfo.modelId,
        modelName: providerModelInfo.modelName,
        timestamp:
          task.evaluation?.evaluation_timestamp ||
          task.completed_at ||
          task.updated_at ||
          task.created_at ||
          undefined,
      });
    });

    relevantMessages.forEach((message) => {
      const rating = message.user_rating;
      if (typeof rating !== 'number' || Number.isNaN(rating)) {
        return;
      }
      const providerModelInfo = this.extractProviderModelInfo(message);
      if (!providerModelInfo) {
        return;
      }

      accumulateSample({
        rating,
        providerId: providerModelInfo.providerId,
        providerName: providerModelInfo.providerName,
        modelId: providerModelInfo.modelId,
        modelName: providerModelInfo.modelName,
        timestamp:
          message.evaluation_timestamp ||
          message.timestamp ||
          message.updated_at ||
          message.created_at ||
          undefined,
      });
    });

    if (aggregates.size === 0) {
      return [];
    }

    const sanitizedMinRating = Math.min(Math.max(minRating || 0, 0), 5);

    const [providersMap, modelsMap] = await Promise.all([
      this.fetchProvidersMap(Array.from(providerIds)),
      this.fetchModelsMap(Array.from(modelIds)),
    ]);

    const recommendations = Array.from(aggregates.values())
      .map((entry) => {
        const averageRating = entry.totalRating / entry.evaluationCount;
        if (averageRating < sanitizedMinRating) {
          return null;
        }

        const provider = entry.providerId
          ? providersMap.get(entry.providerId)
          : undefined;
        const model = entry.modelId ? modelsMap.get(entry.modelId) : undefined;

        return {
          providerId: entry.providerId,
          providerName:
            provider?.name || entry.providerName || 'Unknown Provider',
          modelId: entry.modelId,
          modelName:
            model?.modelName ||
            model?.name ||
            entry.modelName ||
            'Unknown Model',
          averageRating: Number(averageRating.toFixed(2)),
          evaluationCount: entry.evaluationCount,
          lastEvaluatedAt: entry.lastEvaluatedAt,
        } as AgentLLMRecommendationDto;
      })
      .filter((rec): rec is AgentLLMRecommendationDto => rec !== null)
      .sort((a, b) => {
        if (b.averageRating !== a.averageRating) {
          return b.averageRating - a.averageRating;
        }
        if (b.evaluationCount !== a.evaluationCount) {
          return b.evaluationCount - a.evaluationCount;
        }

        const aTime = a.lastEvaluatedAt
          ? new Date(a.lastEvaluatedAt).getTime()
          : 0;
        const bTime = b.lastEvaluatedAt
          ? new Date(b.lastEvaluatedAt).getTime()
          : 0;
        return bTime - aTime;
      });

    return recommendations;
  }

  // Helper methods

  private calculateEvaluationStats(evaluations: EvaluationStatsRow[]): {
    totalEvaluations: number;
    averageOverallRating: number;
    averageSpeedRating: number;
    averageAccuracyRating: number;
    evaluationDistribution: Record<string, number>;
  } {
    const totalEvaluations = evaluations.length;

    const avgOverallRating =
      totalEvaluations > 0
        ? evaluations.reduce(
            (sum, evaluation) => sum + (evaluation.user_rating || 0),
            0,
          ) / totalEvaluations
        : 0;

    const avgSpeedRating =
      evaluations.filter((e) => e.speed_rating).length > 0
        ? evaluations.reduce(
            (sum, evaluation) => sum + (evaluation.speed_rating || 0),
            0,
          ) / evaluations.filter((e) => e.speed_rating).length
        : 0;

    const avgAccuracyRating =
      evaluations.filter((e) => e.accuracy_rating).length > 0
        ? evaluations.reduce(
            (sum, evaluation) => sum + (evaluation.accuracy_rating || 0),
            0,
          ) / evaluations.filter((e) => e.accuracy_rating).length
        : 0;

    // Calculate rating distribution
    const distribution: Record<string, number> = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
    };
    evaluations.forEach((evaluation) => {
      if (evaluation.user_rating) {
        const ratingKey = evaluation.user_rating.toString();
        if (distribution[ratingKey] !== undefined) {
          distribution[ratingKey]++;
        }
      }
    });

    return {
      totalEvaluations: totalEvaluations,
      averageOverallRating: avgOverallRating,
      averageSpeedRating: avgSpeedRating,
      averageAccuracyRating: avgAccuracyRating,
      evaluationDistribution: distribution,
    };
  }

  private calculateModelPerformance(evaluations: EvaluationStatsRow[]): Array<{
    model: EvaluationStatsRow['model'];
    avgRating: number;
    evaluationCount: number;
  }> {
    const groups = new Map<
      string,
      { model: EvaluationStatsRow['model']; ratings: number[] }
    >();

    evaluations.forEach((evaluation) => {
      const modelId = evaluation.model?.id ?? 'unknown';
      const group =
        groups.get(modelId) ??
        groups
          .set(modelId, { model: evaluation.model ?? null, ratings: [] })
          .get(modelId)!;

      if (typeof evaluation.user_rating === 'number') {
        group.ratings.push(evaluation.user_rating);
      }
    });

    return Array.from(groups.values())
      .filter((group) => group.model?.id && group.ratings.length > 0)
      .map((group) => ({
        model: group.model,
        avgRating:
          group.ratings.reduce((sum, rating) => sum + rating, 0) /
          group.ratings.length,
        evaluationCount: group.ratings.length,
      }))
      .sort((a, b) => b.avgRating - a.avgRating);
  }

  private calculateModelComparison(
    messages: ModelComparisonMessageRow[],
  ): Array<{
    model: ModelComparisonMessageRow['model'];
    metrics: {
      avgOverallRating: number;
      avgSpeedRating: number;
      avgAccuracyRating: number;
      avgResponseTimeMs: number;
      avgCost: number;
      evaluationCount: number;
    };
  }> {
    const groups = new Map<
      string,
      {
        model: ModelComparisonMessageRow['model'];
        overall: number[];
        speed: number[];
        accuracy: number[];
        responseTimes: number[];
        costs: number[];
      }
    >();

    messages.forEach((message) => {
      const modelId = message.model?.id ?? 'unknown';
      const group =
        groups.get(modelId) ??
        groups
          .set(modelId, {
            model: message.model ?? null,
            overall: [],
            speed: [],
            accuracy: [],
            responseTimes: [],
            costs: [],
          })
          .get(modelId)!;

      if (typeof message.user_rating === 'number') {
        group.overall.push(message.user_rating);
      }
      if (typeof message.speed_rating === 'number') {
        group.speed.push(message.speed_rating);
      }
      if (typeof message.accuracy_rating === 'number') {
        group.accuracy.push(message.accuracy_rating);
      }
      if (typeof message.response_time_ms === 'number') {
        group.responseTimes.push(message.response_time_ms);
      }
      if (typeof message.total_cost === 'number') {
        group.costs.push(message.total_cost);
      }
    });

    return Array.from(groups.values()).map((group) => ({
      model: group.model,
      metrics: {
        avgOverallRating: this.calculateAverage(group.overall),
        avgSpeedRating: this.calculateAverage(group.speed),
        avgAccuracyRating: this.calculateAverage(group.accuracy),
        avgResponseTimeMs: this.calculateAverage(group.responseTimes),
        avgCost: this.calculateAverage(group.costs),
        evaluationCount: group.overall.length,
      },
    }));
  }

  private generateModelRecommendations(
    comparison: Array<{
      model: ModelComparisonMessageRow['model'];
      metrics: {
        avgOverallRating: number;
        avgSpeedRating: number;
        avgAccuracyRating: number;
        avgResponseTimeMs: number;
        avgCost: number;
        evaluationCount: number;
      };
    }>,
  ): string[] {
    if (comparison.length === 0) {
      return [];
    }

    const recommendations: string[] = [];

    // Find best performer by rating
    const bestRated = comparison.reduce((best, current) =>
      current.metrics.avgOverallRating > best.metrics.avgOverallRating
        ? current
        : best,
    );

    // Find most cost-effective
    const cheapest = comparison.reduce((cheapest, current) =>
      current.metrics.avgCost < cheapest.metrics.avgCost ? current : cheapest,
    );

    recommendations.push(
      `${bestRated.model?.name} has the highest user satisfaction rating`,
    );
    recommendations.push(
      `${cheapest.model?.name} is the most cost-effective option`,
    );

    return recommendations;
  }

  private extractTaskContent(task: TaskRecord): string {
    if (typeof task.prompt === 'string' && task.prompt.trim().length > 0) {
      return task.prompt;
    }

    if (typeof task.response === 'string' && task.response.trim().length > 0) {
      return task.response;
    }

    const metadataContent = task.response_metadata?.content;
    if (typeof metadataContent === 'string' && metadataContent.trim()) {
      return metadataContent;
    }
    if (metadataContent && typeof metadataContent === 'object') {
      return JSON.stringify(metadataContent);
    }

    const metadataResponse = task.response_metadata?.response;
    if (typeof metadataResponse === 'string' && metadataResponse.trim()) {
      return metadataResponse;
    }
    if (metadataResponse && typeof metadataResponse === 'object') {
      return JSON.stringify(metadataResponse);
    }

    if (typeof task.method === 'string' && task.method.trim().length > 0) {
      return `${task.method.replace(/_/g, ' ')} Task`;
    }

    return 'Task';
  }

  private hasTaskEvaluation(evaluation: TaskRecord['evaluation']): boolean {
    if (!evaluation) {
      return false;
    }

    return (
      typeof evaluation.user_rating === 'number' ||
      typeof evaluation.speed_rating === 'number' ||
      typeof evaluation.accuracy_rating === 'number'
    );
  }

  private deriveAgentName(task: TaskRecord): string {
    const metadataAgentName =
      task.response_metadata?.agent_name ??
      task.response_metadata?.agentName ??
      task.metadata?.agent_name ??
      (task.metadata as Record<string, unknown> | undefined)?.agentName ??
      task.llm_metadata?.agent_name ??
      task.llm_metadata?.agentName ??
      null;

    if (metadataAgentName && typeof metadataAgentName === 'string') {
      return metadataAgentName;
    }

    if (task.method && task.method !== 'process') {
      return (
        task.method
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (l: string) => l.toUpperCase()) + ' Agent'
      );
    }

    return 'AI Assistant';
  }

  private calculateAverage(values: number[]): number {
    return values.length > 0
      ? values.reduce((sum, val) => sum + val, 0) / values.length
      : 0;
  }

  private convertFeedbackToCSV(feedback: unknown[]): string {
    if (feedback.length === 0) return '';

    const headers = Object.keys(feedback[0] as Record<string, unknown>).join(
      ',',
    );
    const rows = feedback.map((item) =>
      Object.values(item as Record<string, unknown>)
        .map((val) =>
          typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val,
        )
        .join(','),
    );

    return [headers, ...rows].join('\n');
  }

  private parseTaskRecords(data: unknown): TaskRecord[] {
    if (!Array.isArray(data)) {
      return [];
    }

    return taskRecordArraySchema.parse(data);
  }

  // Task Evaluation Methods
  async evaluateTask(
    userId: string,
    taskId: string,
    evaluationDto: MessageEvaluationDto,
  ): Promise<Record<string, unknown> | null> {
    const client = this.db;

    // Verify task exists and belongs to user
    const { data: task, error: taskError } = (await client
      .from(null, 'tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', userId)
      .single()) as { data: unknown; error: unknown };

    if (taskError || !task) {
      return null;
    }

    // Update task with evaluation data
    // Store with camelCase keys to match TaskEvaluation type on the frontend
    const evaluationData = {
      userRating: evaluationDto.userRating,
      speedRating: evaluationDto.speedRating,
      accuracyRating: evaluationDto.accuracyRating,
      userNotes: evaluationDto.userNotes,
      evaluationDetails: evaluationDto.evaluationDetails,
      evaluationTimestamp: new Date().toISOString(),
    };

    const { data: updatedTask, error: updateError } = (await client
      .from(null, 'tasks')
      .update({
        evaluation: evaluationData,
      })
      .eq('id', taskId)
      .eq('user_id', userId)
      .select('*')
      .single()) as { data: unknown; error: { message: string } | null };

    if (updateError) {
      throw new HttpException(
        `Failed to save task evaluation: ${updateError.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Convert snake_case DB columns to camelCase for the frontend
    return snakeToCamel(updatedTask) as Record<string, unknown> | null;
  }

  async getTaskWithEvaluation(
    userId: string,
    taskId: string,
  ): Promise<Record<string, unknown> | null> {
    const client = this.db;

    const { data: task, error } = (await client
      .from(null, 'tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', userId)
      .single()) as {
      data: unknown;
      error: { code: string; message: string } | null;
    };

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw new HttpException(
        `Failed to fetch task: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Convert snake_case DB columns to camelCase for the frontend
    return snakeToCamel(task) as Record<string, unknown> | null;
  }

  async updateTaskEvaluation(
    userId: string,
    taskId: string,
    evaluationDto: MessageEvaluationDto,
  ): Promise<Record<string, unknown> | null> {
    // Same as evaluateTask but for updates
    return this.evaluateTask(userId, taskId, evaluationDto);
  }

  async getConversationTaskEvaluations(
    userId: string,
    conversationId: string,
    filters: EvaluationFilters = {},
  ): Promise<Record<string, unknown>[]> {
    const client = this.db;

    const query = client
      .from(null, 'tasks')
      .select('*')
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .not('evaluation', 'is', null)
      .order('created_at');

    // Apply filters based on evaluation data
    if (filters.minRating || filters.hasNotes) {
      // For tasks, we need to filter on the evaluation JSON field
      const { data: tasks, error } = (await query) as {
        data: Record<string, unknown>[] | null;
        error: { message: string } | null;
      };

      if (error) {
        throw new HttpException(
          `Failed to fetch conversation task evaluations: ${error.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Filter in memory since we're working with JSON fields
      let filteredTasks = tasks || [];

      if (filters.minRating !== undefined) {
        filteredTasks = filteredTasks.filter((task) => {
          const evaluation = task.evaluation as
            | Record<string, unknown>
            | undefined;
          // Support both camelCase (new) and snake_case (legacy) keys
          const rating = (evaluation?.userRating ?? evaluation?.user_rating) as
            | number
            | undefined;
          return rating && rating >= filters.minRating!;
        });
      }

      if (filters.hasNotes) {
        filteredTasks = filteredTasks.filter((task) => {
          const evaluation = task.evaluation as
            | Record<string, unknown>
            | undefined;
          // Support both camelCase (new) and snake_case (legacy) keys
          const notes = (evaluation?.userNotes ?? evaluation?.user_notes) as
            | string
            | undefined;
          return notes && notes.trim().length > 0;
        });
      }

      return filteredTasks.map(
        (t) => snakeToCamel(t) as Record<string, unknown>,
      );
    }

    const { data: tasks, error } = (await query) as {
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    };

    if (error) {
      throw new HttpException(
        `Failed to fetch conversation task evaluations: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return (tasks ?? []).map((t) => snakeToCamel(t) as Record<string, unknown>);
  }

  async getAllUserEvaluations(
    userId: string,
    filters: AllUserEvaluationsFilters,
  ): Promise<{
    evaluations: EnhancedMessageResponseDto[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const client = this.db;

    // Query only tasks for evaluations (since that's where the data actually is)
    const { data: tasks, error: tasksError } = (await client
      .from(null, 'tasks')
      .select('*')
      .eq('user_id', userId)
      .not('evaluation', 'is', null)) as {
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    };

    if (tasksError) {
      throw new HttpException(
        `Failed to fetch task evaluations: ${tasksError.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const taskRecords = this.parseTaskRecords(tasks ?? []);

    // Filter out tasks that don't have actual evaluation ratings
    const tasksWithEvaluations = taskRecords.filter((task) =>
      this.hasTaskEvaluation(task.evaluation),
    );

    // Get unique provider and model IDs from tasks to fetch details
    const providerIds = new Set<string>();
    const modelIds = new Set<string>();

    tasksWithEvaluations.forEach((task) => {
      const providerId = task.llm_metadata?.originalLLMSelection?.providerId;
      const modelId = task.llm_metadata?.originalLLMSelection?.modelId;

      if (providerId) {
        providerIds.add(providerId);
      }
      if (modelId) {
        modelIds.add(modelId);
      }
    });

    // Fetch provider and model details
    const providersMap = new Map<string, Provider>();
    const modelsMap = new Map<string, ModelResponseDto>();

    // Fetch user email

    const { data: userProfile } = (await client
      .from(null, 'profiles')
      .select('email')
      .eq('id', userId)
      .single()) as {
      data: { email?: string } | null;
      error: { message: string } | null;
    };

    const userEmail = userProfile?.email ?? 'Unknown';

    if (providerIds.size > 0) {
      const { data: providers } = (await client
        .from(null, 'llm_providers')
        .select('*')
        .in('id', Array.from(providerIds))) as {
        data: LLMProviderDbRecord[] | null;
        error: { message: string } | null;
      };

      if (providers) {
        providers.forEach((provider) => {
          const mappedProvider = mapLLMProviderFromDb(
            provider as Record<string, unknown>,
          );
          if (provider.id) {
            providersMap.set(provider.id, mappedProvider);
          }
        });
      }
    }

    if (modelIds.size > 0) {
      const { data: models } = (await client
        .from(null, 'llm_models')
        .select('*')
        .in('id', Array.from(modelIds))) as {
        data: LLMModelDbRecord[] | null;
        error: { message: string } | null;
      };

      if (models) {
        models.forEach((model) => {
          const mappedModel = mapLLMModelFromDb(
            model as Record<string, unknown>,
          );
          if (model.id) {
            modelsMap.set(model.id, mappedModel);
          }
        });
      }
    }

    // Transform task evaluations to the expected DTO format
    const allEvaluations: EnhancedMessageResponseDto[] = tasksWithEvaluations
      .map((task): EnhancedMessageResponseDto | null => {
        // Debug: log all available task fields and data

        // Additional debug for missing response data

        const taskContent = this.extractTaskContent(task);
        const responseMetadataRecord = this.asRecord(task.response_metadata);
        const llmMetadataRecord = this.asRecord(task.llm_metadata);
        const taskMetadataRecord = this.asRecord(task.metadata);

        const sessionId =
          this.pickString(task.session_id) ??
          this.pickString(task.conversation_id);
        const userIdValue = this.pickString(task.user_id);
        if (!sessionId || !userIdValue) {
          this.logger.warn(
            `Skipping evaluation task ${task.id} due to missing session or user identifier`,
          );
          return null;
        }

        // Create more meaningful agent name from metadata
        let agentName = 'Agent';
        const responseAgentSnake = this.pickString(
          task.response_metadata?.agent_name,
        );
        const responseAgentCamel = this.pickString(
          task.response_metadata?.agentName,
        );
        const metadataAgentSnake = this.pickString(task.metadata?.agent_name);
        const metadataAgentCamel = this.pickString(task.metadata?.agentName);
        const llmAgentSnake = this.pickString(task.llm_metadata?.agent_name);
        const llmAgentCamel = this.pickString(task.llm_metadata?.agentName);
        const methodName = this.pickString(task.method);

        if (responseAgentSnake) {
          agentName = responseAgentSnake;
        } else if (responseAgentCamel) {
          agentName = responseAgentCamel;
        } else if (metadataAgentSnake) {
          agentName = metadataAgentSnake;
        } else if (metadataAgentCamel) {
          agentName = metadataAgentCamel;
        } else if (llmAgentSnake) {
          agentName = llmAgentSnake;
        } else if (llmAgentCamel) {
          agentName = llmAgentCamel;
        } else if (methodName && methodName !== 'process') {
          // Only use method as agent name if it's not the generic 'process' method
          agentName =
            methodName
              .replace(/_/g, ' ')
              .replace(/\b\w/g, (l: string) => l.toUpperCase()) + ' Agent';
        } else {
          // Last resort: use a generic name instead of "Process Agent"
          agentName = 'AI Assistant';
        }

        // Format the agent name for consistent display
        const displayAgentName = formatAgentNameForDisplay(agentName);

        // Get provider and model from LLM metadata (nested in originalLLMSelection)
        const originalSelectionRecord = this.asRecord(
          llmMetadataRecord?.originalLLMSelection,
        );
        const providerId = this.pickString(originalSelectionRecord?.providerId);
        const modelId = this.pickString(originalSelectionRecord?.modelId);
        const provider = providerId ? providersMap.get(providerId) : undefined;
        const model = modelId ? modelsMap.get(modelId) : undefined;

        const timestamp =
          this.pickString(task.evaluation?.evaluation_timestamp) ??
          this.pickString(task.created_at) ??
          new Date().toISOString();

        return {
          id: task.id,
          content: taskContent,
          role: 'assistant' as const,
          sessionId,
          userId: userIdValue,
          timestamp,
          order: 0,
          // Store agent name in metadata for frontend (since it's not in DTO)
          metadata: {
            agentName: displayAgentName,
            taskType: task.method,
            status: task.status,
            taskPrompt: task.prompt,
            taskResponse: task.response,
            responseMetadata: responseMetadataRecord
              ? this.toPlainObject(responseMetadataRecord)
              : undefined,
            llmMetadata: llmMetadataRecord
              ? this.toPlainObject(llmMetadataRecord)
              : undefined,
            taskMetadata: taskMetadataRecord
              ? this.toPlainObject(taskMetadataRecord)
              : undefined,
            deliverableType: task.type,
            workflowStepsCompleted:
              responseMetadataRecord?.workflow_steps_completed,
            userEmail,
          },
          // Map evaluation fields directly to DTO (not nested)
          userRating: this.normalizeUserRating(task.evaluation?.user_rating),
          speedRating: this.normalizeUserRating(task.evaluation?.speed_rating),
          accuracyRating: this.normalizeUserRating(
            task.evaluation?.accuracy_rating,
          ),
          userNotes: task.evaluation?.user_notes ?? undefined,
          evaluationTimestamp:
            this.pickString(task.evaluation?.evaluation_timestamp) ?? undefined,
          evaluationDetails: task.evaluation?.evaluation_details ?? undefined,
          // Include provider and model details from LLM metadata
          responseTimeMs:
            this.pickNumber(llmMetadataRecord?.response_time_ms) ?? undefined,
          totalCost:
            this.pickNumber(llmMetadataRecord?.total_cost) ?? undefined,
          provider,
          model,
        };
      })
      .filter(
        (evaluation): evaluation is EnhancedMessageResponseDto =>
          evaluation !== null,
      );

    // Apply filters using direct DTO fields
    let filteredEvaluations = allEvaluations;

    if (filters.minRating !== undefined) {
      filteredEvaluations = filteredEvaluations.filter(
        (evaluation) =>
          evaluation.userRating && evaluation.userRating >= filters.minRating!,
      );
    }

    if (filters.hasNotes) {
      filteredEvaluations = filteredEvaluations.filter(
        (evaluation) =>
          evaluation.userNotes && evaluation.userNotes.trim().length > 0,
      );
    }

    // Filter by agent name using metadata
    if (filters.agentName) {
      filteredEvaluations = filteredEvaluations.filter(
        (evaluation) =>
          evaluation.metadata?.agentName &&
          (evaluation.metadata.agentName as string)
            .toLowerCase()
            .includes(filters.agentName!.toLowerCase()),
      );
    }

    // Sort by evaluation timestamp (most recent first)
    filteredEvaluations.sort((a, b) => {
      const timestampA = a.evaluationTimestamp || a.timestamp;
      const timestampB = b.evaluationTimestamp || b.timestamp;
      return new Date(timestampB).getTime() - new Date(timestampA).getTime();
    });

    // Apply pagination
    const total = filteredEvaluations.length;
    const totalPages = Math.ceil(total / filters.limit);
    const offset = (filters.page - 1) * filters.limit;
    const paginatedEvaluations = filteredEvaluations.slice(
      offset,
      offset + filters.limit,
    );

    const evaluations = paginatedEvaluations;

    return {
      evaluations,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages,
      },
    };
  }

  // ============================================================================
  // ENHANCED ADMIN EVALUATION METHODS
  // ============================================================================

  /**
   * Get all evaluations across users for admin monitoring
   * Includes enhanced metadata with workflow and constraint data
   */
  async getAllEvaluationsForAdmin(filters: AdminEvaluationFiltersDto): Promise<{
    evaluations: EnhancedEvaluationMetadataDto[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const client = this.db;

    // Build base query for tasks with evaluations (no user filtering for admin)
    let tasksQuery = client
      .from(null, 'tasks')
      .select('*', { count: 'exact' })
      .not('evaluation', 'is', null);

    // Note: Date filtering will be applied after fetching tasks
    // since evaluation_timestamp is stored in JSONB and requires
    // special handling for date comparisons
    if (filters.minRating) {
      // Note: This requires filtering in memory since evaluation is JSON
      // For performance, consider adding computed columns for ratings
    }

    // Note: Pagination will be applied after filtering since we need to
    // filter by evaluation timestamp which is stored in JSONB
    tasksQuery = tasksQuery.order('created_at', { ascending: false });

    const { data: tasks, error: tasksError } = (await tasksQuery) as {
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    };

    if (tasksError) {
      throw new HttpException(
        `Failed to fetch admin evaluations: ${tasksError.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Filter tasks with actual evaluation ratings
    const tasksWithEvaluations = (tasks || []).filter((task) => {
      const taskRecord = task;
      const taskEval = taskRecord.evaluation as
        | Record<string, unknown>
        | undefined;
      const hasRating =
        taskRecord.evaluation &&
        (taskEval?.user_rating ||
          taskEval?.speed_rating ||
          taskEval?.accuracy_rating);

      // Apply filters that require evaluation data inspection
      if (
        filters.minRating &&
        (!taskEval?.user_rating ||
          (taskEval.user_rating as number) < filters.minRating)
      ) {
        return false;
      }
      if (
        filters.maxRating &&
        taskEval?.user_rating &&
        (taskEval.user_rating as number) > filters.maxRating
      ) {
        return false;
      }
      if (filters.hasNotes !== undefined) {
        const hasNotes =
          taskEval?.user_notes &&
          (taskEval.user_notes as string).trim().length > 0;
        if (filters.hasNotes !== hasNotes) {
          return false;
        }
      }
      if (filters.hasWorkflowSteps !== undefined) {
        const taskRespMeta = taskRecord.response_metadata as
          | Record<string, unknown>
          | undefined;
        const hasWorkflow =
          taskRespMeta?.workflow_steps_completed &&
          (taskRespMeta.workflow_steps_completed as unknown[]).length > 0;
        if (filters.hasWorkflowSteps !== hasWorkflow) {
          return false;
        }
      }
      if (filters.hasConstraints !== undefined) {
        const taskLlmMeta = taskRecord.llm_metadata as
          | Record<string, unknown>
          | undefined;
        const origSelection = taskLlmMeta?.originalLLMSelection as
          | Record<string, unknown>
          | undefined;
        const cidafmOpts = origSelection?.cidafmOptions as
          | Record<string, unknown>
          | undefined;
        const hasConstraints =
          cidafmOpts &&
          (((cidafmOpts.activeStateModifiers as unknown[] | undefined)
            ?.length ?? 0) > 0 ||
            ((cidafmOpts.responseModifiers as unknown[] | undefined)?.length ??
              0) > 0);
        if (filters.hasConstraints !== hasConstraints) {
          return false;
        }
      }

      // Apply date filters
      if (filters.startDate && taskEval?.evaluation_timestamp) {
        const evaluationDate = new Date(
          taskEval.evaluation_timestamp as string | number | Date,
        );
        const startDate = new Date(filters.startDate);
        if (evaluationDate < startDate) {
          return false;
        }
      }
      if (filters.endDate && taskEval?.evaluation_timestamp) {
        const evaluationDate = new Date(
          taskEval.evaluation_timestamp as string | number | Date,
        );
        const endDate = new Date(filters.endDate);
        // Set end date to end of day for inclusive filtering
        endDate.setHours(23, 59, 59, 999);
        if (evaluationDate > endDate) {
          return false;
        }
      }

      return hasRating;
    });

    // Get unique user IDs and provider/model IDs for batch fetching
    const userIds = new Set<string>();
    const providerIds = new Set<string>();
    const modelIds = new Set<string>();

    tasksWithEvaluations.forEach((task) => {
      const taskRecord = task;
      userIds.add(taskRecord.user_id as string);

      const taskLlmMeta = taskRecord.llm_metadata as
        | Record<string, unknown>
        | undefined;
      const origSelection = taskLlmMeta?.originalLLMSelection as
        | Record<string, unknown>
        | undefined;
      const providerId = origSelection?.providerId;
      const modelId = origSelection?.modelId;

      if (providerId) providerIds.add(providerId as string);
      if (modelId) modelIds.add(modelId as string);
    });

    // Batch fetch user profiles, providers, and models
    const [usersMap, providersMap, modelsMap] = await Promise.all([
      this.fetchUsersMap(Array.from(userIds)),
      this.fetchProvidersMap(Array.from(providerIds)),
      this.fetchModelsMap(Array.from(modelIds)),
    ]);

    // Transform tasks to enhanced evaluation metadata
    const enhancedEvaluations: EnhancedEvaluationMetadataDto[] =
      tasksWithEvaluations
        .map((task) =>
          this.transformTaskToEnhancedEvaluation(
            task as unknown as TaskRecord,
            usersMap,
            providersMap,
            modelsMap,
          ),
        )
        .filter((evaluation) => {
          // Apply additional filters that require the transformed data
          if (
            filters.agentName &&
            !evaluation.task.agentName
              .toLowerCase()
              .includes(filters.agentName.toLowerCase())
          ) {
            return false;
          }
          if (
            filters.userEmail &&
            !evaluation.user.email
              .toLowerCase()
              .includes(filters.userEmail.toLowerCase())
          ) {
            return false;
          }
          if (
            filters.provider &&
            evaluation.llmInfo.provider !== filters.provider
          ) {
            return false;
          }
          if (filters.model && evaluation.llmInfo.model !== filters.model) {
            return false;
          }
          if (
            filters.minResponseTime &&
            evaluation.llmInfo.responseTimeMs < filters.minResponseTime
          ) {
            return false;
          }
          if (
            filters.maxResponseTime &&
            evaluation.llmInfo.responseTimeMs > filters.maxResponseTime
          ) {
            return false;
          }
          if (filters.workflowStepStatus && evaluation.workflowSteps) {
            const hasStepWithStatus = evaluation.workflowSteps.stepDetails.some(
              (step) => step.status === filters.workflowStepStatus,
            );
            if (!hasStepWithStatus) {
              return false;
            }
          }
          if (filters.constraintType && evaluation.llmConstraints) {
            const hasConstraintType =
              evaluation.llmConstraints.activeStateModifiers.includes(
                filters.constraintType,
              ) ||
              evaluation.llmConstraints.responseModifiers.includes(
                filters.constraintType,
              );
            if (!hasConstraintType) {
              return false;
            }
          }

          return true;
        });

    // Sort by evaluation timestamp (most recent first)
    enhancedEvaluations.sort(
      (a, b) =>
        new Date(b.evaluation.evaluationTimestamp).getTime() -
        new Date(a.evaluation.evaluationTimestamp).getTime(),
    );

    // Apply pagination after filtering and sorting
    const total = enhancedEvaluations.length;
    const totalPages = Math.ceil(total / filters.limit!);
    const offset = (filters.page! - 1) * filters.limit!;
    const paginatedEvaluations = enhancedEvaluations.slice(
      offset,
      offset + filters.limit!,
    );

    return {
      evaluations: paginatedEvaluations,
      pagination: {
        page: filters.page!,
        limit: filters.limit!,
        total,
        totalPages,
      },
    };
  }

  /**
   * Get system-wide evaluation analytics for admin dashboard
   */
  async getEvaluationAnalytics(
    filters: AdminEvaluationFiltersDto,
  ): Promise<EvaluationAnalyticsDto> {
    const client = this.db;

    // Build query for tasks with evaluations
    const query = client
      .from(null, 'tasks')
      .select('*')
      .not('evaluation', 'is', null);

    // Note: Date filtering will be applied after fetching tasks
    // since evaluation_timestamp is stored in JSONB

    const { data: tasks, error } = (await query) as {
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    };

    if (error) {
      throw new HttpException(
        `Failed to fetch evaluation analytics: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Filter tasks with actual evaluations and apply date filters
    const evaluatedTasks = (tasks || []).filter((task) => {
      const taskRecord = task;
      const taskEval = taskRecord.evaluation as
        | Record<string, unknown>
        | undefined;
      const hasRating =
        taskRecord.evaluation &&
        (taskEval?.user_rating ||
          taskEval?.speed_rating ||
          taskEval?.accuracy_rating);

      if (!hasRating) return false;

      // Apply date filters
      if (filters.startDate && taskEval?.evaluation_timestamp) {
        const evaluationDate = new Date(
          taskEval.evaluation_timestamp as string | number | Date,
        );
        const startDate = new Date(filters.startDate);
        if (evaluationDate < startDate) {
          return false;
        }
      }
      if (filters.endDate && taskEval?.evaluation_timestamp) {
        const evaluationDate = new Date(
          taskEval.evaluation_timestamp as string | number | Date,
        );
        const endDate = new Date(filters.endDate);
        // Set end date to end of day for inclusive filtering
        endDate.setHours(23, 59, 59, 999);
        if (evaluationDate > endDate) {
          return false;
        }
      }

      return true;
    });

    // Calculate analytics
    const totalEvaluations = evaluatedTasks.length;
    const ratings = evaluatedTasks
      .map(
        (task) =>
          (task.evaluation as Record<string, unknown>).user_rating as
            | number
            | null
            | undefined,
      )
      .filter((rating): rating is number => rating != null);
    const speedRatings = evaluatedTasks
      .map(
        (task) =>
          (task.evaluation as Record<string, unknown>).speed_rating as
            | number
            | null
            | undefined,
      )
      .filter((rating): rating is number => rating != null);
    const accuracyRatings = evaluatedTasks
      .map(
        (task) =>
          (task.evaluation as Record<string, unknown>).accuracy_rating as
            | number
            | null
            | undefined,
      )
      .filter((rating): rating is number => rating != null);

    const averageRating =
      ratings.length > 0
        ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
        : 0;
    const averageSpeedRating =
      speedRatings.length > 0
        ? speedRatings.reduce((sum, rating) => sum + rating, 0) /
          speedRatings.length
        : 0;
    const averageAccuracyRating =
      accuracyRatings.length > 0
        ? accuracyRatings.reduce((sum, rating) => sum + rating, 0) /
          accuracyRatings.length
        : 0;

    // Calculate workflow completion rate
    const workflowTasks = evaluatedTasks.filter(
      (task) =>
        (task.response_metadata as Record<string, unknown> | undefined)
          ?.workflow_steps_completed,
    );
    const averageWorkflowCompletionRate =
      workflowTasks.length > 0
        ? workflowTasks.reduce((sum, task): number => {
            const taskRespMeta = task.response_metadata as Record<
              string,
              unknown
            >;
            const steps = taskRespMeta.workflow_steps_completed || [];
            const completedCount = (steps as unknown[]).filter(
              (step: unknown) =>
                (step as Record<string, unknown>).status === 'completed',
            ).length;
            return sum + (completedCount / (steps as unknown[]).length) * 100;
          }, 0) / workflowTasks.length
        : 0;

    // Calculate average response time and cost
    const responseTimes = evaluatedTasks
      .map(
        (task) =>
          (task.llm_metadata as Record<string, unknown> | undefined)
            ?.response_time_ms as number | null | undefined,
      )
      .filter((time): time is number => time != null);
    const costs = evaluatedTasks
      .map(
        (task) =>
          (task.llm_metadata as Record<string, unknown> | undefined)
            ?.total_cost as number | null | undefined,
      )
      .filter((cost): cost is number => cost != null);

    const averageResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((sum, time) => sum + time, 0) /
          responseTimes.length
        : 0;
    const averageCost =
      costs.length > 0
        ? costs.reduce((sum, cost) => sum + cost, 0) / costs.length
        : 0;

    // Rating distribution
    const ratingDistribution: Record<string, number> = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
    };
    ratings.forEach((rating) => {
      const key = Math.floor(rating).toString();
      if (ratingDistribution[key] !== undefined) {
        ratingDistribution[key]++;
      }
    });

    // Top performing agents
    const agentPerformance = this.calculateAgentPerformance(
      evaluatedTasks as unknown as TaskRecord[],
    );
    const topPerformingAgents = agentPerformance
      .sort((a, b) => b.averageRating - a.averageRating)
      .slice(0, 10);

    // Top constraints (from CIDAFM data)
    const constraintEffectiveness = this.calculateConstraintEffectiveness(
      evaluatedTasks as unknown as TaskRecord[],
    );
    const topConstraints = constraintEffectiveness
      .sort((a, b) => b.effectivenessScore - a.effectivenessScore)
      .slice(0, 10);

    // Workflow failure points
    const workflowFailurePoints = this.calculateWorkflowFailurePoints(
      evaluatedTasks as unknown as TaskRecord[],
    );

    return {
      totalEvaluations,
      averageRating,
      averageSpeedRating,
      averageAccuracyRating,
      averageWorkflowCompletionRate,
      averageResponseTime,
      averageCost,
      ratingDistribution,
      topPerformingAgents,
      topConstraints,
      workflowFailurePoints,
    };
  }

  /**
   * Get workflow-specific analytics for admin monitoring
   */
  async getWorkflowAnalytics(filters: AdminEvaluationFiltersDto): Promise<{
    workflowPerformance: Array<{
      stepName: string;
      averageDuration: number;
      successRate: number;
      failureRate: number;
      totalExecutions: number;
    }>;
    commonFailurePatterns: Array<{
      pattern: string;
      occurrences: number;
      impactRating: number;
    }>;
    workflowEfficiencyTrends: Array<{
      date: string;
      averageSteps: number;
      averageDuration: number;
      successRate: number;
    }>;
  }> {
    const client = this.db;

    let query = client
      .from(null, 'tasks')
      .select('*')
      .not('response_metadata', 'is', null);

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate);
    }
    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    const { data: tasks, error } = (await query) as {
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    };

    if (error) {
      throw new HttpException(
        `Failed to fetch workflow analytics: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const workflowTasks = (tasks || []).filter(
      (task) =>
        (task.response_metadata as Record<string, unknown> | undefined)
          ?.workflow_steps_completed,
    );

    const workflowPerformance = this.calculateWorkflowStepPerformance(
      workflowTasks as unknown as TaskRecord[],
    );
    const commonFailurePatterns = this.identifyWorkflowFailurePatterns(
      workflowTasks as unknown as TaskRecord[],
    );
    const workflowEfficiencyTrends = this.calculateWorkflowEfficiencyTrends(
      workflowTasks as unknown as TaskRecord[],
    );

    return {
      workflowPerformance,
      commonFailurePatterns,
      workflowEfficiencyTrends,
    };
  }

  /**
   * Get constraint effectiveness analytics for CIDAFM optimization
   */
  async getConstraintAnalytics(filters: AdminEvaluationFiltersDto): Promise<{
    constraintUsage: Array<{
      constraintName: string;
      usageCount: number;
      averageEffectiveness: number;
      userSatisfaction: number;
    }>;
    constraintCombinations: Array<{
      combination: string[];
      usageCount: number;
      effectivenessScore: number;
      averageRating: number;
    }>;
    constraintImpactOnPerformance: Array<{
      constraintName: string;
      withConstraint: {
        averageRating: number;
        averageResponseTime: number;
        averageCost: number;
      };
      withoutConstraint: {
        averageRating: number;
        averageResponseTime: number;
        averageCost: number;
      };
    }>;
  }> {
    const client = this.db;

    const query = client
      .from(null, 'tasks')
      .select('*')
      .not('evaluation', 'is', null)
      .not('llm_metadata', 'is', null);

    // Note: Date filtering will be applied after fetching tasks
    // since evaluation_timestamp is stored in JSONB

    const { data: tasks, error } = (await query) as {
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    };

    if (error) {
      throw new HttpException(
        `Failed to fetch constraint analytics: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const evaluatedTasks = (tasks || []).filter((task) => {
      const taskRecord = task;
      const taskEval = taskRecord.evaluation as
        | Record<string, unknown>
        | undefined;
      const hasRating =
        taskRecord.evaluation &&
        (taskEval?.user_rating ||
          taskEval?.speed_rating ||
          taskEval?.accuracy_rating);

      if (!hasRating) return false;

      // Apply date filters
      if (filters.startDate && taskEval?.evaluation_timestamp) {
        const evaluationDate = new Date(
          taskEval.evaluation_timestamp as string | number | Date,
        );
        const startDate = new Date(filters.startDate);
        if (evaluationDate < startDate) {
          return false;
        }
      }
      if (filters.endDate && taskEval?.evaluation_timestamp) {
        const evaluationDate = new Date(
          taskEval.evaluation_timestamp as string | number | Date,
        );
        const endDate = new Date(filters.endDate);
        // Set end date to end of day for inclusive filtering
        endDate.setHours(23, 59, 59, 999);
        if (evaluationDate > endDate) {
          return false;
        }
      }

      return true;
    });

    const constraintUsage = this.calculateConstraintUsageStats(
      evaluatedTasks as unknown as TaskRecord[],
    );
    const constraintCombinations = this.analyzeConstraintCombinations(
      evaluatedTasks as unknown as TaskRecord[],
    );
    const constraintImpactOnPerformance =
      this.calculateConstraintPerformanceImpact(
        evaluatedTasks as unknown as TaskRecord[],
      );

    return {
      constraintUsage,
      constraintCombinations,
      constraintImpactOnPerformance,
    };
  }

  /**
   * Export enhanced evaluations for admin analysis
   */
  async exportEnhancedEvaluations(
    filters: AdminEvaluationFiltersDto,
    options: {
      format: 'json' | 'csv';
      includeWorkflowDetails?: boolean;
      includeConstraintDetails?: boolean;
      anonymizeUsers?: boolean;
    },
  ): Promise<Record<string, unknown>[] | string> {
    // Set a higher limit for export
    const exportFilters = { ...filters, limit: 10000, page: 1 };

    const { evaluations } = await this.getAllEvaluationsForAdmin(exportFilters);

    const exportData = evaluations.map((evaluation) => {
      const baseData = {
        taskId: evaluation.task.id,
        userEmail: options.anonymizeUsers
          ? this.anonymizeEmail(evaluation.user.email)
          : evaluation.user.email,
        userName: options.anonymizeUsers
          ? 'Anonymous User'
          : evaluation.user.name,
        agentName: evaluation.task.agentName,
        method: evaluation.task.method,
        userRating: evaluation.evaluation.userRating,
        speedRating: evaluation.evaluation.speedRating,
        accuracyRating: evaluation.evaluation.accuracyRating,
        userNotes: evaluation.evaluation.userNotes,
        evaluationTimestamp: evaluation.evaluation.evaluationTimestamp,
        taskCreatedAt: evaluation.task.createdAt,
        taskCompletedAt: evaluation.task.completedAt,
        taskStatus: evaluation.task.status,
        provider: evaluation.llmInfo.provider,
        model: evaluation.llmInfo.model,
        responseTimeMs: evaluation.llmInfo.responseTimeMs,
        cost: evaluation.llmInfo.cost,
        inputTokens: evaluation.llmInfo.tokenUsage.input,
        outputTokens: evaluation.llmInfo.tokenUsage.output,
      };

      if (options.includeWorkflowDetails && evaluation.workflowSteps) {
        return {
          ...baseData,
          workflowTotalSteps: evaluation.workflowSteps.totalSteps,
          workflowCompletedSteps: evaluation.workflowSteps.completedSteps,
          workflowFailedSteps: evaluation.workflowSteps.failedSteps,
          workflowProgressPercent: evaluation.workflowSteps.progressPercent,
          workflowTotalDuration: evaluation.workflowSteps.totalDuration,
          workflowFailedStep: evaluation.workflowSteps.failedStep,
        };
      }

      if (options.includeConstraintDetails && evaluation.llmConstraints) {
        return {
          ...baseData,
          activeStateModifiers:
            evaluation.llmConstraints.activeStateModifiers.join(', '),
          responseModifiers:
            evaluation.llmConstraints.responseModifiers.join(', '),
          executedCommands:
            evaluation.llmConstraints.executedCommands.join(', '),
          constraintEffectiveness:
            evaluation.llmConstraints.constraintEffectiveness
              ?.overallEffectiveness,
          constraintCompliance:
            evaluation.llmConstraints.constraintEffectiveness
              ?.modifierCompliance,
        };
      }

      return baseData;
    });

    if (options.format === 'csv') {
      return this.convertToCSV(exportData);
    }

    return exportData;
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private async fetchUsersMap(
    userIds: string[],
  ): Promise<Map<string, UserProfileRecord>> {
    if (userIds.length === 0) return new Map();

    const { data: result, error } = (await this.db
      .from(null, 'profiles')
      .select('id, email, display_name, roles')
      .in('id', userIds)) as {
      data: ProfileDbRecord[] | null;
      error: { message: string } | null;
    };

    if (error) {
      return new Map();
    }

    const users = result;
    const usersMap = new Map<string, UserProfileRecord>();
    (users || []).forEach((user) => {
      if (user.id) {
        usersMap.set(user.id, user);
      }
    });

    return usersMap;
  }

  private async fetchProvidersMap(
    providerIds: string[],
  ): Promise<Map<string, Provider>> {
    if (providerIds.length === 0) return new Map();

    const { data: result, error } = (await this.db
      .from(null, 'llm_providers')
      .select('*')
      .in('id', providerIds)) as {
      data: LLMProviderDbRecord[] | null;
      error: { message: string } | null;
    };

    if (error) {
      return new Map();
    }

    const providers = result;
    const providersMap = new Map<string, Provider>();
    (providers || []).forEach((provider) => {
      const mappedProvider = mapLLMProviderFromDb(provider);
      if (provider.id) {
        providersMap.set(provider.id, mappedProvider);
      }
    });

    return providersMap;
  }

  private async fetchModelsMap(
    modelIds: string[],
  ): Promise<Map<string, ModelResponseDto>> {
    if (modelIds.length === 0) return new Map();

    const { data: result, error } = (await this.db
      .from(null, 'llm_models')
      .select('*')
      .in('id', modelIds)) as {
      data: LLMModelDbRecord[] | null;
      error: { message: string } | null;
    };

    if (error) {
      return new Map();
    }

    const models = result;
    const modelsMap = new Map<string, ModelResponseDto>();
    (models || []).forEach((model) => {
      const mappedModel = mapLLMModelFromDb(model);
      if (model.id) {
        modelsMap.set(model.id, mappedModel);
      }
    });

    return modelsMap;
  }

  private transformTaskToEnhancedEvaluation(
    task: TaskRecord,
    usersMap: Map<string, UserProfileRecord>,
    providersMap: Map<string, Provider>,
    modelsMap: Map<string, ModelResponseDto>,
  ): EnhancedEvaluationMetadataDto {
    // Get user info
    const userProfile = task.user_id ? usersMap.get(task.user_id) : undefined;
    const user: EvaluationUserDto = {
      id: task.user_id ?? 'unknown-user',
      email: userProfile?.email ?? 'unknown@example.com',
      name:
        userProfile?.display_name ??
        userProfile?.email?.split('@')[0] ??
        'Unknown User',
      roles: this.normalizeUserRoles(userProfile?.roles),
    };

    // Extract evaluation data
    const responseMetadataRecord = this.asRecord(task.response_metadata);
    const llmMetadataRecord = this.asRecord(task.llm_metadata);
    const taskMetadataRecord = this.asRecord(task.metadata);

    const evaluationRecord = task.evaluation ?? {};
    const evaluation: EvaluationDataDto = {
      userRating: this.normalizeUserRating(evaluationRecord.user_rating) ?? 1,
      speedRating: this.normalizeUserRating(evaluationRecord.speed_rating),
      accuracyRating: this.normalizeUserRating(
        evaluationRecord.accuracy_rating,
      ),
      userNotes: evaluationRecord.user_notes ?? undefined,
      evaluationTimestamp: new Date(
        evaluationRecord.evaluation_timestamp ?? task.created_at ?? Date.now(),
      ),
      evaluationDetails: evaluationRecord.evaluation_details ?? undefined,
    };

    // Format agent name
    const agentName = this.deriveAgentName(task);
    const displayAgentName = formatAgentNameForDisplay(agentName);

    // Extract task info
    const taskInfo: EvaluationTaskDto = {
      id: task.id,
      prompt: task.prompt ?? '',
      response: task.response ?? undefined,
      agentName: displayAgentName,
      method: task.method ?? '',
      status: task.status ?? 'unknown',
      createdAt: new Date(task.created_at ?? Date.now()),
      completedAt: (() => {
        const completedAtRaw = this.pickString(llmMetadataRecord?.completed_at);
        return completedAtRaw ? new Date(completedAtRaw) : undefined;
      })(),
      metadata: taskMetadataRecord
        ? this.toPlainObject(taskMetadataRecord)
        : undefined,
    };

    // Extract workflow information
    let workflowSteps: WorkflowTrackingDto | undefined;
    const workflowStepsCompleted =
      responseMetadataRecord?.workflow_steps_completed ?? null;
    if (
      Array.isArray(workflowStepsCompleted) &&
      workflowStepsCompleted.length > 0
    ) {
      const normalizedSteps = workflowStepsCompleted
        .map((step) => this.normalizeWorkflowStep(step))
        .filter((step): step is WorkflowStepDto => step !== null);

      if (normalizedSteps.length > 0) {
        const completedCount = normalizedSteps.filter(
          (step) => step.status === 'completed',
        ).length;
        const failedSteps = normalizedSteps.filter(
          (step) => step.status === 'failed',
        );

        workflowSteps = {
          totalSteps: normalizedSteps.length,
          completedSteps: completedCount,
          failedSteps: failedSteps.length,
          progressPercent:
            normalizedSteps.length > 0
              ? Math.round((completedCount / normalizedSteps.length) * 100)
              : 0,
          stepDetails: normalizedSteps,
          totalDuration: normalizedSteps.reduce(
            (sum, step) => sum + (step.duration ?? 0),
            0,
          ),
          failedStep: failedSteps[0]?.name ?? undefined,
        };
      }
    }

    // Extract CIDAFM constraint information
    let llmConstraints: LLMConstraintsDto | undefined;
    const originalSelectionRecord = this.asRecord(
      llmMetadataRecord?.originalLLMSelection,
    );
    const cidafmOptions = originalSelectionRecord?.cidafmOptions ?? null;
    if (cidafmOptions) {
      const cidafmRecord = this.asRecord(cidafmOptions);
      if (cidafmRecord) {
        llmConstraints = {
          activeStateModifiers: this.pickStringArray(
            cidafmRecord.activeStateModifiers,
          ),
          responseModifiers: this.pickStringArray(
            cidafmRecord.responseModifiers,
          ),
          executedCommands: this.pickStringArray(cidafmRecord.executedCommands),
          constraintEffectiveness: undefined,
          processingNotes: this.extractProcessingNotes(
            cidafmRecord.customOptions,
          ),
        };
      }
    }

    // Get LLM info
    const providerId = this.pickString(originalSelectionRecord?.providerId);
    const modelId = this.pickString(originalSelectionRecord?.modelId);
    const provider = providerId ? providersMap.get(providerId) : undefined;
    const model = modelId ? modelsMap.get(modelId) : undefined;
    const providerRecord = this.asRecord(provider);
    const modelRecord = this.asRecord(model);

    const llmInfo: EnhancedLLMInfoDto = {
      provider:
        provider?.name ??
        this.pickString(providerRecord?.display_name) ??
        'Unknown Provider',
      model:
        model?.name ??
        this.pickString(modelRecord?.model_name) ??
        this.pickString(modelRecord?.display_name) ??
        'Unknown Model',
      responseTimeMs: this.pickNumber(llmMetadataRecord?.response_time_ms) ?? 0,
      cost: this.pickNumber(llmMetadataRecord?.total_cost) ?? 0,
      tokenUsage: {
        input: this.pickNumber(llmMetadataRecord?.input_tokens) ?? 0,
        output: this.pickNumber(llmMetadataRecord?.output_tokens) ?? 0,
      },
      modelVersion: this.pickString(modelRecord?.modelName) ?? undefined,
      temperature:
        this.pickNumber(originalSelectionRecord?.temperature) ?? undefined,
      maxTokens:
        this.pickNumber(originalSelectionRecord?.maxTokens) ?? undefined,
    };

    return {
      user,
      evaluation,
      task: taskInfo,
      workflowSteps,
      llmConstraints,
      llmInfo,
      systemMetadata: {
        taskMetadata: task.metadata,
        responseMetadata: task.response_metadata,
        llmMetadata: task.llm_metadata,
      },
    };
  }

  private normalizeUserRoles(roles: string[] | null | undefined): string[] {
    if (!Array.isArray(roles) || roles.length === 0) {
      return ['user'];
    }

    const validRoles = roles.filter(
      (role) => typeof role === 'string' && role.length > 0,
    );

    return validRoles.length ? validRoles : ['user'];
  }

  private normalizeUserRating(value: unknown): UserRatingScale | undefined {
    const rating = this.pickNumber(value);
    if (rating === undefined) {
      return undefined;
    }
    const rounded = Math.round(rating);
    if (rounded < 1 || rounded > 5) {
      return undefined;
    }
    return rounded as UserRatingScale;
  }

  private normalizeWorkflowStep(step: unknown): WorkflowStepDto | null {
    const record = this.asRecord(step);
    if (!record) {
      return null;
    }

    const duration = this.pickNumber(record.duration);
    const metadataRecord = this.asRecord(record.metadata);

    return {
      name: this.pickString(record.name) ?? 'Unknown Step',
      status: this.normalizeWorkflowStatus(record.status),
      duration,
      error: this.pickString(record.error) ?? undefined,
      metadata: metadataRecord ? this.toPlainObject(metadataRecord) : undefined,
      startTime: this.normalizeDate(record.startTime),
      endTime: this.normalizeDate(record.endTime),
    };
  }

  private normalizeWorkflowStatus(value: unknown): WorkflowStepDto['status'] {
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      switch (normalized) {
        case 'pending':
        case 'in_progress':
        case 'completed':
        case 'failed':
          return normalized;
        case 'in-progress':
          return 'in_progress';
        default:
          break;
      }
    }
    return 'pending';
  }

  private normalizeDate(value: unknown): Date | undefined {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? undefined : value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
  }

  private pickNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private pickString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private pickStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((entry) => this.pickString(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  private extractProcessingNotes(
    value: unknown,
  ): Record<string, unknown> | undefined {
    const record = this.asRecord(value);
    return record ? this.toPlainObject(record) : undefined;
  }

  private toPlainObject(
    record: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(Object.entries(record)) as Record<
      string,
      unknown
    >;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private calculateAgentPerformance(tasks: TaskRecord[]): Array<{
    agentName: string;
    averageRating: number;
    evaluationCount: number;
  }> {
    const agentGroups = tasks.reduce(
      (
        groups: Record<string, { ratings: number[]; count: number }>,
        task: TaskRecord,
      ) => {
        let agentName = 'AI Assistant';
        const responseMetadata = task.response_metadata as
          | Record<string, unknown>
          | null
          | undefined;
        if (responseMetadata?.agent_name) {
          agentName = responseMetadata.agent_name as string;
        } else if (task.method && task.method !== 'process') {
          agentName =
            task.method
              .replace(/_/g, ' ')
              .replace(/\b\w/g, (l: string) => l.toUpperCase()) + ' Agent';
        }
        const displayName = formatAgentNameForDisplay(agentName);

        if (!groups[displayName]) {
          groups[displayName] = { ratings: [], count: 0 };
        }

        if (task.evaluation?.user_rating) {
          groups[displayName].ratings.push(task.evaluation.user_rating);
          groups[displayName].count++;
        }

        return groups;
      },
      {} as Record<string, { ratings: number[]; count: number }>,
    );

    return Object.entries(agentGroups as Record<string, unknown>).map(
      ([agentName, data]: [string, unknown]) => {
        const dataObj = data as Record<string, unknown>;
        const ratings = (dataObj.ratings as number[] | undefined) || [];
        return {
          agentName,
          averageRating:
            ratings.length > 0
              ? ratings.reduce(
                  (sum: number, rating: number) => sum + rating,
                  0,
                ) / ratings.length
              : 0,
          evaluationCount: (dataObj.count as number) || 0,
        };
      },
    );
  }

  private extractProviderModelInfo(task: unknown): {
    providerId?: string;
    providerName?: string;
    modelId?: string;
    modelName?: string;
  } | null {
    if (!task || typeof task !== 'object') {
      return null;
    }

    const taskObj = task as Record<string, unknown>;
    const llmMetadata = (taskObj.llm_metadata as Record<string, unknown>) || {};
    const selection =
      (llmMetadata.originalLLMSelection as
        | Record<string, unknown>
        | undefined) ||
      (llmMetadata.currentLLMSelection as
        | Record<string, unknown>
        | undefined) ||
      (llmMetadata.selectedLLM as Record<string, unknown> | undefined) ||
      (llmMetadata.llmSelection as Record<string, unknown> | undefined) ||
      {};

    const providerId =
      selection.providerId ||
      selection.provider_id ||
      llmMetadata.providerId ||
      llmMetadata.provider_id ||
      taskObj.provider_id ||
      (taskObj.provider as Record<string, unknown> | undefined)?.id ||
      undefined;
    const modelId =
      selection.modelId ||
      selection.model_id ||
      llmMetadata.modelId ||
      llmMetadata.model_id ||
      taskObj.model_id ||
      (taskObj.model as Record<string, unknown> | undefined)?.id ||
      undefined;

    const providerName =
      selection.providerName ||
      selection.provider ||
      llmMetadata.providerName ||
      llmMetadata.provider ||
      llmMetadata.provider_name ||
      taskObj.provider_name ||
      (taskObj.provider as Record<string, unknown> | undefined)?.display_name ||
      (taskObj.provider as Record<string, unknown> | undefined)
        ?.provider_name ||
      (taskObj.provider as Record<string, unknown> | undefined)?.name ||
      (taskObj.metadata as Record<string, unknown> | undefined)?.providerName ||
      (
        (taskObj.metadata as Record<string, unknown> | undefined)?.provider as
          | Record<string, unknown>
          | undefined
      )?.name ||
      (
        (taskObj.metadata as Record<string, unknown> | undefined)?.provider as
          | Record<string, unknown>
          | undefined
      )?.displayName ||
      (taskObj.metadata as Record<string, unknown> | undefined)?.provider ||
      undefined;

    const modelName =
      selection.modelName ||
      selection.model ||
      llmMetadata.modelName ||
      llmMetadata.model ||
      llmMetadata.model_name ||
      taskObj.model_name ||
      (taskObj.model as Record<string, unknown> | undefined)?.model_name ||
      (taskObj.model as Record<string, unknown> | undefined)?.display_name ||
      (taskObj.model as Record<string, unknown> | undefined)?.name ||
      (taskObj.metadata as Record<string, unknown> | undefined)?.modelName ||
      (
        (taskObj.metadata as Record<string, unknown> | undefined)?.model as
          | Record<string, unknown>
          | undefined
      )?.name ||
      (
        (taskObj.metadata as Record<string, unknown> | undefined)?.model as
          | Record<string, unknown>
          | undefined
      )?.displayName ||
      (taskObj.metadata as Record<string, unknown> | undefined)?.model ||
      undefined;

    if (!providerId && !providerName) {
      return null;
    }

    if (!modelId && !modelName) {
      return null;
    }

    return {
      providerId: (providerId as string | undefined) || undefined,
      providerName: (providerName as string | undefined) || undefined,
      modelId: (modelId as string | undefined) || undefined,
      modelName: (modelName as string | undefined) || undefined,
    };
  }

  private buildRecommendationKey(
    providerId?: string,
    providerName?: string,
    modelId?: string,
    modelName?: string,
  ): string {
    const providerPart = (providerId || providerName || 'unknown_provider')
      .toString()
      .toLowerCase();
    const modelPart = (modelId || modelName || 'unknown_model')
      .toString()
      .toLowerCase();
    return `${providerPart}::${modelPart}`;
  }

  private normalizeAgentIdentifier(value?: string | null): string {
    if (!value || typeof value !== 'string') {
      return '';
    }

    // Convert to consistent underscore format:
    // 1. Replace spaces, hyphens with underscores
    // 2. Remove common suffixes like 'agent', 'assistant', 'writer'
    // 3. Convert to lowercase
    // 4. Trim and clean up multiple underscores
    return value
      .toLowerCase()
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/-/g, '_') // Replace hyphens with underscores
      .replace(/_writer$/i, '') // Remove 'writer' suffix
      .replace(/_agent$/i, '') // Remove 'agent' suffix
      .replace(/_assistant$/i, '') // Remove 'assistant' suffix
      .replace(/writer$/i, '') // Remove 'writer' suffix without underscore
      .replace(/agent$/i, '') // Remove 'agent' suffix without underscore
      .replace(/assistant$/i, '') // Remove 'assistant' suffix without underscore
      .replace(/_{2,}/g, '_') // Replace multiple underscores with single
      .replace(/^_|_$/g, '') // Remove leading/trailing underscores
      .trim();
  }

  private extractAgentIdentifiers(task: TaskRecord): string[] {
    const names = new Set<string>();

    const metadata = task.metadata as Record<string, unknown> | null;
    const responseMetadata = task.response_metadata as Record<
      string,
      unknown
    > | null;
    const llmMetadata = task.llm_metadata as Record<string, unknown> | null;

    const candidateValues = [
      responseMetadata?.agent_name,
      responseMetadata?.agentName,
      metadata?.agent_name,
      metadata?.agentName,
      (metadata?.agent as Record<string, unknown>)?.name,
      (metadata?.agent as Record<string, unknown>)?.displayName,
      (metadata?.originalAgent as Record<string, unknown>)?.agentName,
      (metadata?.originalAgent as Record<string, unknown>)?.name,
      metadata?.originalAgentName,
      metadata?.agentDisplayName,
      metadata?.agentLabel,
      metadata?.llmMetadata &&
        (
          (metadata.llmMetadata as Record<string, unknown>)
            .originalLLMSelection as Record<string, unknown>
        )?.agentName,
      metadata?.llmMetadata &&
        (
          (metadata.llmMetadata as Record<string, unknown>)
            .originalLLMSelection as Record<string, unknown>
        )?.agent_name,
      llmMetadata?.agent_name,
      llmMetadata?.agentName,
      (llmMetadata?.originalLLMSelection as Record<string, unknown>)?.agentName,
      (llmMetadata?.originalLLMSelection as Record<string, unknown>)
        ?.agent_name,
      (task as unknown as Record<string, unknown>).agent_name,
      (task as unknown as Record<string, unknown>).agentName,
      task.method,
    ];

    candidateValues.forEach((value) => {
      const normalized = this.normalizeAgentIdentifier(
        value as string | null | undefined,
      );
      if (normalized) {
        names.add(normalized);
      }
    });

    const firstCandidate = candidateValues.find((value) => value);
    if (firstCandidate) {
      const display = formatAgentNameForDisplay(firstCandidate as string);
      const normalizedDisplay = this.normalizeAgentIdentifier(display);
      if (normalizedDisplay) {
        names.add(normalizedDisplay);
      }
    }

    return Array.from(names);
  }

  private recordMatchesAgent(
    record: TaskRecord,
    normalizedTarget: string,
  ): boolean {
    if (!normalizedTarget) {
      return false;
    }

    const identifiers = this.extractAgentIdentifiers(record);
    return identifiers.includes(normalizedTarget);
  }

  private calculateConstraintEffectiveness(tasks: TaskRecord[]): Array<{
    constraintName: string;
    effectivenessScore: number;
    usageCount: number;
  }> {
    const constraintStats = new Map<
      string,
      { ratings: number[]; count: number }
    >();

    tasks.forEach((task) => {
      const llmMetadata = task.llm_metadata as
        | Record<string, unknown>
        | null
        | undefined;
      const originalLLMSelection = llmMetadata?.originalLLMSelection as
        | Record<string, unknown>
        | null
        | undefined;
      const cidafmOptions = originalLLMSelection?.cidafmOptions as
        | Record<string, unknown>
        | null
        | undefined;
      if (!cidafmOptions || !task.evaluation?.user_rating) return;

      const allConstraints = [
        ...((cidafmOptions.activeStateModifiers as unknown[]) || []),
        ...((cidafmOptions.responseModifiers as unknown[]) || []),
        ...((cidafmOptions.executedCommands as unknown[]) || []),
      ];

      allConstraints.forEach((constraint) => {
        if (!constraintStats.has(constraint as string)) {
          constraintStats.set(constraint as string, { ratings: [], count: 0 });
        }

        const stats = constraintStats.get(constraint as string)!;
        stats.ratings.push(task.evaluation!.user_rating as number);
        stats.count++;
      });
    });

    return Array.from(constraintStats.entries()).map(
      ([constraintName, stats]) => ({
        constraintName,
        effectivenessScore:
          stats.ratings.length > 0
            ? stats.ratings.reduce((sum, rating) => sum + rating, 0) /
              stats.ratings.length
            : 0,
        usageCount: stats.count,
      }),
    );
  }

  private calculateWorkflowFailurePoints(tasks: TaskRecord[]): Array<{
    stepName: string;
    failureRate: number;
    averageDuration: number;
  }> {
    const stepStats = new Map<
      string,
      { total: number; failed: number; durations: number[] }
    >();

    tasks.forEach((task) => {
      const responseMetadata = task.response_metadata as
        | Record<string, unknown>
        | null
        | undefined;
      const steps = responseMetadata?.workflow_steps_completed as
        | Array<Record<string, unknown>>
        | null
        | undefined;
      if (!steps) return;

      steps.forEach((step) => {
        const stepName = step.name as string;
        if (!stepStats.has(stepName)) {
          stepStats.set(stepName, {
            total: 0,
            failed: 0,
            durations: [],
          });
        }

        const stats = stepStats.get(stepName)!;
        stats.total++;

        if (step.status === 'failed') {
          stats.failed++;
        }

        if (step.duration) {
          stats.durations.push(step.duration as number);
        }
      });
    });

    return Array.from(stepStats.entries()).map(([stepName, stats]) => ({
      stepName,
      failureRate: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0,
      averageDuration:
        stats.durations.length > 0
          ? stats.durations.reduce((sum, duration) => sum + duration, 0) /
            stats.durations.length
          : 0,
    }));
  }

  private calculateWorkflowStepPerformance(tasks: TaskRecord[]): Array<{
    stepName: string;
    averageDuration: number;
    successRate: number;
    failureRate: number;
    totalExecutions: number;
  }> {
    const stepStats = new Map<
      string,
      {
        total: number;
        successful: number;
        failed: number;
        durations: number[];
      }
    >();

    tasks.forEach((task) => {
      const responseMetadata = task.response_metadata as
        | Record<string, unknown>
        | null
        | undefined;
      const steps = responseMetadata?.workflow_steps_completed as
        | Array<Record<string, unknown>>
        | null
        | undefined;
      if (!steps) return;

      steps.forEach((step) => {
        const stepName = step.name as string;
        if (!stepStats.has(stepName)) {
          stepStats.set(stepName, {
            total: 0,
            successful: 0,
            failed: 0,
            durations: [],
          });
        }

        const stats = stepStats.get(stepName)!;
        stats.total++;

        if (step.status === 'completed') {
          stats.successful++;
        } else if (step.status === 'failed') {
          stats.failed++;
        }

        if (step.duration) {
          stats.durations.push(step.duration as number);
        }
      });
    });

    return Array.from(stepStats.entries()).map(([stepName, stats]) => ({
      stepName,
      averageDuration:
        stats.durations.length > 0
          ? stats.durations.reduce((sum, duration) => sum + duration, 0) /
            stats.durations.length
          : 0,
      successRate: stats.total > 0 ? (stats.successful / stats.total) * 100 : 0,
      failureRate: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0,
      totalExecutions: stats.total,
    }));
  }

  private identifyWorkflowFailurePatterns(tasks: TaskRecord[]): Array<{
    pattern: string;
    occurrences: number;
    impactRating: number;
  }> {
    const failurePatterns = new Map<
      string,
      { count: number; totalImpact: number }
    >();

    tasks.forEach((task) => {
      const responseMetadata = task.response_metadata as
        | Record<string, unknown>
        | null
        | undefined;
      const steps = responseMetadata?.workflow_steps_completed as
        | Array<Record<string, unknown>>
        | null
        | undefined;
      if (!steps) return;

      const failedSteps = steps.filter((step) => step.status === 'failed');
      if (failedSteps.length === 0) return;

      // Create patterns based on failure sequences
      const failureSequence = failedSteps.map((step) => step.name).join(' -> ');
      const userRating = task.evaluation?.user_rating || 3;
      const impactScore = 5 - userRating + 1; // Higher impact for lower ratings

      if (!failurePatterns.has(failureSequence)) {
        failurePatterns.set(failureSequence, {
          count: 0,
          totalImpact: 0,
        });
      }

      const pattern = failurePatterns.get(failureSequence)!;
      pattern.count++;
      pattern.totalImpact += impactScore;
    });

    return Array.from(failurePatterns.entries()).map(([pattern, stats]) => ({
      pattern,
      occurrences: stats.count,
      impactRating: stats.count > 0 ? stats.totalImpact / stats.count : 0,
    }));
  }

  private calculateWorkflowEfficiencyTrends(tasks: TaskRecord[]): Array<{
    date: string;
    averageSteps: number;
    averageDuration: number;
    successRate: number;
  }> {
    // Group tasks by date
    const dailyStats = new Map<
      string,
      {
        totalSteps: number;
        totalDuration: number;
        totalTasks: number;
        successfulTasks: number;
      }
    >();

    tasks.forEach((task) => {
      const responseMetadata = task.response_metadata as
        | Record<string, unknown>
        | null
        | undefined;
      const steps = responseMetadata?.workflow_steps_completed as
        | Array<Record<string, unknown>>
        | null
        | undefined;
      if (!steps) return;

      const date = new Date(task.created_at as string | number | Date)
        .toISOString()
        .split('T')[0];
      if (date && !dailyStats.has(date)) {
        dailyStats.set(date, {
          totalSteps: 0,
          totalDuration: 0,
          totalTasks: 0,
          successfulTasks: 0,
        });
      }

      const stats = date ? dailyStats.get(date)! : null;
      if (!stats) return;
      stats.totalSteps += steps.length;
      stats.totalDuration += steps.reduce(
        (sum: number, step) => sum + ((step.duration as number) || 0),
        0,
      );
      stats.totalTasks++;

      const successfulSteps = steps.filter(
        (step: unknown) =>
          (step as Record<string, unknown>).status === 'completed',
      ).length;
      if (successfulSteps === steps.length) {
        stats.successfulTasks++;
      }
    });

    return Array.from(dailyStats.entries())
      .map(([date, stats]) => ({
        date,
        averageSteps:
          stats.totalTasks > 0 ? stats.totalSteps / stats.totalTasks : 0,
        averageDuration:
          stats.totalTasks > 0 ? stats.totalDuration / stats.totalTasks : 0,
        successRate:
          stats.totalTasks > 0
            ? (stats.successfulTasks / stats.totalTasks) * 100
            : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private calculateConstraintUsageStats(tasks: TaskRecord[]): Array<{
    constraintName: string;
    usageCount: number;
    averageEffectiveness: number;
    userSatisfaction: number;
  }> {
    const constraintStats = new Map<
      string,
      {
        usage: number;
        ratings: number[];
        effectivenessScores: number[];
      }
    >();

    tasks.forEach((task) => {
      const llmMetadata = task.llm_metadata as
        | Record<string, unknown>
        | null
        | undefined;
      const originalLLMSelection = llmMetadata?.originalLLMSelection as
        | Record<string, unknown>
        | null
        | undefined;
      const cidafmOptions = originalLLMSelection?.cidafmOptions as
        | Record<string, unknown>
        | null
        | undefined;
      if (!cidafmOptions) return;

      const allConstraints = [
        ...((cidafmOptions.activeStateModifiers as unknown[]) || []),
        ...((cidafmOptions.responseModifiers as unknown[]) || []),
        ...((cidafmOptions.executedCommands as unknown[]) || []),
      ];

      allConstraints.forEach((constraint) => {
        if (!constraintStats.has(constraint as string)) {
          constraintStats.set(constraint as string, {
            usage: 0,
            ratings: [],
            effectivenessScores: [],
          });
        }

        const stats = constraintStats.get(constraint as string)!;
        stats.usage++;

        if (task.evaluation?.user_rating) {
          stats.ratings.push(task.evaluation.user_rating);
        }

        // Mock effectiveness score - could be enhanced with actual tracking
        const effectivenessScore = task.evaluation?.user_rating
          ? task.evaluation.user_rating * 0.8 + Math.random() * 0.4
          : 3;
        stats.effectivenessScores.push(effectivenessScore);
      });
    });

    return Array.from(constraintStats.entries()).map(
      ([constraintName, stats]) => ({
        constraintName,
        usageCount: stats.usage,
        averageEffectiveness:
          stats.effectivenessScores.length > 0
            ? stats.effectivenessScores.reduce((sum, score) => sum + score, 0) /
              stats.effectivenessScores.length
            : 0,
        userSatisfaction:
          stats.ratings.length > 0
            ? stats.ratings.reduce((sum, rating) => sum + rating, 0) /
              stats.ratings.length
            : 0,
      }),
    );
  }

  private analyzeConstraintCombinations(tasks: TaskRecord[]): Array<{
    combination: string[];
    usageCount: number;
    effectivenessScore: number;
    averageRating: number;
  }> {
    const combinationStats = new Map<
      string,
      {
        constraints: string[];
        usage: number;
        ratings: number[];
        effectivenessScores: number[];
      }
    >();

    tasks.forEach((task) => {
      const llmMetadata = task.llm_metadata as
        | Record<string, unknown>
        | null
        | undefined;
      const originalLLMSelection = llmMetadata?.originalLLMSelection as
        | Record<string, unknown>
        | null
        | undefined;
      const cidafmOptions = originalLLMSelection?.cidafmOptions as
        | Record<string, unknown>
        | null
        | undefined;
      if (!cidafmOptions) return;

      const allConstraints = [
        ...((cidafmOptions.activeStateModifiers as unknown[]) || []),
        ...((cidafmOptions.responseModifiers as unknown[]) || []),
      ].sort(); // Sort for consistent combination keys

      if (allConstraints.length < 2) return; // Only analyze combinations

      const combinationKey = allConstraints.join('|');
      if (!combinationStats.has(combinationKey)) {
        combinationStats.set(combinationKey, {
          constraints: allConstraints as string[],
          usage: 0,
          ratings: [],
          effectivenessScores: [],
        });
      }

      const stats = combinationStats.get(combinationKey)!;
      stats.usage++;

      if (task.evaluation?.user_rating) {
        stats.ratings.push(task.evaluation.user_rating);
        // Mock effectiveness calculation
        const effectivenessScore =
          task.evaluation.user_rating * 0.9 + Math.random() * 0.2;
        stats.effectivenessScores.push(effectivenessScore);
      }
    });

    return Array.from(combinationStats.entries())
      .map(([_, stats]) => ({
        combination: stats.constraints,
        usageCount: stats.usage,
        effectivenessScore:
          stats.effectivenessScores.length > 0
            ? stats.effectivenessScores.reduce((sum, score) => sum + score, 0) /
              stats.effectivenessScores.length
            : 0,
        averageRating:
          stats.ratings.length > 0
            ? stats.ratings.reduce((sum, rating) => sum + rating, 0) /
              stats.ratings.length
            : 0,
      }))
      .filter((combo) => combo.usageCount >= 3) // Only show combinations used at least 3 times
      .sort((a, b) => b.effectivenessScore - a.effectivenessScore);
  }

  private calculateConstraintPerformanceImpact(tasks: TaskRecord[]): Array<{
    constraintName: string;
    withConstraint: {
      averageRating: number;
      averageResponseTime: number;
      averageCost: number;
    };
    withoutConstraint: {
      averageRating: number;
      averageResponseTime: number;
      averageCost: number;
    };
  }> {
    const constraintStats = new Map<
      string,
      {
        withConstraint: {
          ratings: number[];
          responseTimes: number[];
          costs: number[];
        };
        withoutConstraint: {
          ratings: number[];
          responseTimes: number[];
          costs: number[];
        };
      }
    >();

    // First pass: identify all constraints
    const allConstraints = new Set<string>();
    tasks.forEach((task) => {
      const llmMetadata = task.llm_metadata as
        | Record<string, unknown>
        | null
        | undefined;
      const originalLLMSelection = llmMetadata?.originalLLMSelection as
        | Record<string, unknown>
        | null
        | undefined;
      const cidafmOptions = originalLLMSelection?.cidafmOptions as
        | Record<string, unknown>
        | null
        | undefined;
      if (cidafmOptions) {
        [
          ...((cidafmOptions.activeStateModifiers as unknown[]) || []),
          ...((cidafmOptions.responseModifiers as unknown[]) || []),
        ].forEach((constraint) => allConstraints.add(constraint as string));
      }
    });

    // Initialize stats for each constraint
    allConstraints.forEach((constraint) => {
      constraintStats.set(constraint, {
        withConstraint: { ratings: [], responseTimes: [], costs: [] },
        withoutConstraint: { ratings: [], responseTimes: [], costs: [] },
      });
    });

    // Second pass: categorize tasks
    tasks.forEach((task) => {
      const llmMetadata = task.llm_metadata as
        | Record<string, unknown>
        | null
        | undefined;
      const originalLLMSelection = llmMetadata?.originalLLMSelection as
        | Record<string, unknown>
        | null
        | undefined;
      const cidafmOptions = originalLLMSelection?.cidafmOptions as
        | Record<string, unknown>
        | null
        | undefined;
      const taskConstraints = cidafmOptions
        ? [
            ...((cidafmOptions.activeStateModifiers as unknown[]) || []),
            ...((cidafmOptions.responseModifiers as unknown[]) || []),
          ]
        : [];

      const rating = task.evaluation?.user_rating;
      const responseTime: unknown = llmMetadata?.response_time_ms;
      const cost: unknown = llmMetadata?.total_cost;

      if (!rating) return;

      allConstraints.forEach((constraint) => {
        const stats = constraintStats.get(constraint)!;
        const hasConstraint = taskConstraints.includes(constraint);

        const targetStats = hasConstraint
          ? stats.withConstraint
          : stats.withoutConstraint;
        targetStats.ratings.push(rating);
        if (typeof responseTime === 'number')
          targetStats.responseTimes.push(responseTime);
        if (typeof cost === 'number') targetStats.costs.push(cost);
      });
    });

    return Array.from(constraintStats.entries())
      .map(([constraintName, stats]) => ({
        constraintName,
        withConstraint: {
          averageRating: this.calculateAverage(stats.withConstraint.ratings),
          averageResponseTime: this.calculateAverage(
            stats.withConstraint.responseTimes,
          ),
          averageCost: this.calculateAverage(stats.withConstraint.costs),
        },
        withoutConstraint: {
          averageRating: this.calculateAverage(stats.withoutConstraint.ratings),
          averageResponseTime: this.calculateAverage(
            stats.withoutConstraint.responseTimes,
          ),
          averageCost: this.calculateAverage(stats.withoutConstraint.costs),
        },
      }))
      .filter(
        (result) =>
          result.withConstraint.averageRating > 0 &&
          result.withoutConstraint.averageRating > 0,
      );
  }

  private anonymizeEmail(email: string): string {
    const [username, domain] = email.split('@');
    const anonymizedUsername =
      username && username.length > 3
        ? username.substring(0, 2) + '*'.repeat(username.length - 2)
        : '***';
    return `${anonymizedUsername}@${domain}`;
  }

  private convertToCSV(data: unknown[]): string {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0] as Record<string, unknown>).join(',');
    const rows = data.map((item) =>
      Object.values(item as Record<string, unknown>)
        .map((val) => {
          if (typeof val === 'string' && val.includes(',')) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        })
        .join(','),
    );

    return [headers, ...rows].join('\n');
  }
}
