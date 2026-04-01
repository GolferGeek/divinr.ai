import { Injectable, Inject, Logger } from '@nestjs/common';
import { v4 as uuidv4, validate as isValidUUID } from 'uuid';
import { isNilUuid } from '@orchestrator-ai/transport-types';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '@/database';
import { getTableName } from '@orchestratorai/planes/database';
import { LLMUsageMetrics } from './types/llm-evaluation';

export interface RunMetadata {
  runId: string;
  provider: string;
  model: string;
  tier: 'local' | 'centralized' | 'external';
  cost: number;
  duration: number;
  timestamp: string;
  inputTokens?: number;
  outputTokens?: number;
  status: 'started' | 'completed' | 'error';
  errorMessage?: string;
  // Enhanced metrics from LLMUsageMetrics
  enhancedMetrics?: LLMUsageMetrics;
}

export interface MetadataContext {
  runId: string;
  startTime: number;
  provider: string;
  model: string;
  tier: 'local' | 'centralized' | 'external';
  inputTokens?: number;
  userId?: string;
  callerType?: string; // 'agent', 'api', 'user', 'system', 'service'
  callerName?: string; // 'metrics-agent', 'user-chat', 'api-endpoint', etc.
  conversationId?: string; // Optional conversation/session context
  complexityLevel?: string;
  complexityScore?: number;
  dataClassification?: string;
  isLocal?: boolean;
  modelTier?: string;
  fallbackUsed?: boolean;
  routingReason?: string;
}

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
}

/**
 * Database record type for llm_usage table
 */
export interface LLMUsageDbRecord {
  run_id: string;
  provider: string;
  model: string;
  tier: string;
  cost: number;
  duration: number;
  input_tokens?: number;
  output_tokens?: number;
  status: string;
  error_message?: string;
  timestamp: string;
  created_at: string;
  [key: string]: unknown;
}

@Injectable()
export class RunMetadataService {
  private readonly logger = new Logger(RunMetadataService.name);
  private readonly activeRuns = new Map<string, MetadataContext>();

  constructor(@Inject(DATABASE_SERVICE) private readonly db: DatabaseService) {}

  // Cost estimates per 1K tokens (in USD) - Updated December 2025
  private readonly costTable = {
    // OpenAI pricing (December 2025)
    'gpt-5': { input: 0.00125, output: 0.01 },
    'gpt-5.2': { input: 0.00175, output: 0.014 },
    'gpt-4o': { input: 0.005, output: 0.015 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    o1: { input: 0.015, output: 0.06 },
    'o1-mini': { input: 0.003, output: 0.012 },
    o3: { input: 0.001, output: 0.004 },
    'o3-mini': { input: 0.00011, output: 0.00044 },
    // Legacy OpenAI models
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
    'gpt-3.5-turbo-instruct': { input: 0.0015, output: 0.002 },

    // Anthropic pricing (December 2025)
    'claude-sonnet-4': { input: 0.003, output: 0.015 },
    'claude-opus-4.5': { input: 0.005, output: 0.025 },
    'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
    'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
    'claude-3-opus-20240229': { input: 0.015, output: 0.075 },

    // xAI Grok pricing (December 2025)
    'grok-4': { input: 0.003, output: 0.015 },
    'grok-4.1-fast': { input: 0.0002, output: 0.0005 },
    'grok-3': { input: 0.003, output: 0.015 },
    'grok-3-fast': { input: 0.0005, output: 0.0015 },

    // Google Gemini pricing (December 2025)
    'gemini-3-pro': { input: 0.002, output: 0.012 },
    'gemini-2.5-pro': { input: 0.00125, output: 0.01 },
    'gemini-2.5-flash': { input: 0.00015, output: 0.0006 },
    'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
    'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
    'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },

    // Local models (estimated electricity cost)
    'llama3.2:1b': { input: 0.0001, output: 0.0001 },
    'llama3.2:3b': { input: 0.0002, output: 0.0002 },
    'llama3.1:8b': { input: 0.0005, output: 0.0005 },
    'gpt-oss-2b': { input: 0.0001, output: 0.0001 },
    'gpt-oss-20b': { input: 0.001, output: 0.001 },
    'qwen2.5:7b': { input: 0.0004, output: 0.0004 },

    // Default fallback
    default: { input: 0.001, output: 0.002 },
  };

  // Constructor already defined above

  /**
   * Start tracking a new LLM request
   */
  startRequest(
    routingDecision: {
      provider: string;
      model: string;
      isLocal: boolean;
      modelTier?: string;
      fallbackUsed?: boolean;
      complexityLevel?: string;
      complexityScore?: number;
      routingReason?: string;
    },
    options?: {
      userId?: string;
      callerType?: string;
      callerName?: string;
      conversationId?: string;
      dataClassification?: string;
    },
  ): Promise<MetadataContext> {
    this.logger.debug(
      `🔍 [LLM-USAGE-DEBUG] RunMetadataService.startRequest called with provider: ${routingDecision.provider}, model: ${routingDecision.model}, callerName: ${options?.callerName}`,
    );
    const runId = this.generateRunId();
    const startTime = Date.now();

    const tier: 'local' | 'centralized' | 'external' = routingDecision.isLocal
      ? 'local'
      : 'external'; // TODO: Add 'centralized' tier logic when implemented

    const context: MetadataContext = {
      runId,
      startTime,
      provider: routingDecision.provider,
      model: routingDecision.model,
      tier,
      userId: options?.userId,
      callerType: options?.callerType,
      callerName: options?.callerName,
      conversationId: options?.conversationId,
      complexityLevel: routingDecision.complexityLevel,
      complexityScore: routingDecision.complexityScore,
      dataClassification: options?.dataClassification,
      isLocal: routingDecision.isLocal,
      modelTier: routingDecision.modelTier,
      fallbackUsed: routingDecision.fallbackUsed || false,
      routingReason: routingDecision.routingReason,
    };

    // Legacy two-phase tracking disabled: do not insert starter rows
    return Promise.resolve(context);
  }

  /**
   * Complete tracking for a successful request
   */
  async completeRequest(
    context: MetadataContext,
    response: {
      content: string;
      inputTokens?: number;
      outputTokens?: number;
      enhancedMetrics?: LLMUsageMetrics;
    },
  ): Promise<RunMetadata> {
    this.logger.debug(
      `🔍 [LLM-USAGE-DEBUG] RunMetadataService.completeRequest called for runId: ${context.runId}`,
    );
    const endTime = Date.now();
    const duration = endTime - context.startTime;

    // Estimate tokens if not provided
    const inputTokens = response.inputTokens || this.estimateTokens(''); // TODO: Pass actual input
    const outputTokens =
      response.outputTokens || this.estimateTokens(response.content);

    // Calculate cost
    const costEstimate = this.calculateCost(
      context.model,
      inputTokens,
      outputTokens,
    );

    const metadata: RunMetadata = {
      runId: context.runId,
      provider: context.provider,
      model: context.model,
      tier: context.tier,
      cost: costEstimate.totalCost,
      duration,
      timestamp: new Date().toISOString(),
      inputTokens,
      outputTokens,
      status: 'completed',
      enhancedMetrics: response.enhancedMetrics,
    };

    // Single-pass insert for legacy callers
    await this.insertCompletedUsage({
      provider: context.provider,
      model: context.model,
      isLocal: context.isLocal,
      userId: context.userId,
      callerType: context.callerType,
      callerName: context.callerName,
      conversationId: context.conversationId,
      inputTokens,
      outputTokens,
      totalCost: costEstimate.totalCost,
      startTime: context.startTime,
      endTime: Date.now(),
      status: 'completed',
      enhancedMetrics: response.enhancedMetrics,
      runId: context.runId,
    });

    return metadata;
  }

  /**
   * Insert a single completed usage record (preferred flow)
   */
  async insertCompletedUsage(params: {
    provider: string;
    model: string;
    isLocal?: boolean;
    userId?: string;
    callerType?: string;
    callerName?: string;
    conversationId?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalCost?: number;
    startTime?: number;
    endTime?: number;
    status?: 'completed' | 'blocked' | 'error';
    enhancedMetrics?: LLMUsageMetrics;
    runId?: string;
  }): Promise<void> {
    try {
      // Database queries
      const runId = params.runId || uuidv4();
      const startTime = params.startTime || Date.now();
      const endTime = params.endTime || Date.now();
      const duration = Math.max(0, endTime - startTime);

      // Verify user exists in public.users table before inserting
      // If user doesn't exist, set user_id to null to avoid foreign key constraint violation
      let userId: string | null =
        params.userId && isValidUUID(params.userId) && !isNilUuid(params.userId)
          ? params.userId
          : null;
      if (userId) {
        const { data: user, error: userError } = (await this.db
          .from(null, getTableName('users'))
          .select('id')
          .eq('id', userId)
          .single()) as QueryResult<unknown>;

        if (userError || !user) {
          this.logger.warn(
            `User ${userId} not found in public.users table. Setting user_id to null for usage tracking.`,
          );
          userId = null;
        }
      }

      // Compute fallback cost if not provided
      const inTok = params.inputTokens ?? 0;
      const outTok = params.outputTokens ?? 0;
      const needsCost =
        params.totalCost === undefined || params.totalCost === null;
      const estimated = this.calculateCost(params.model, inTok, outTok);
      const inputCost = needsCost ? estimated.inputCost : undefined;
      const outputCost = needsCost ? estimated.outputCost : undefined;
      const totalCost = needsCost ? estimated.totalCost : params.totalCost;

      // Validate conversation_id is a valid UUID (or null)
      // Invalid UUIDs like 'unknown' or 'test-conversation-id' should be set to null
      // Also treat NIL_UUID as null since it won't exist in the conversations table
      let conversationId =
        params.conversationId &&
        isValidUUID(params.conversationId) &&
        !isNilUuid(params.conversationId)
          ? params.conversationId
          : null;

      // Verify conversation exists in conversations table before inserting
      // If conversation doesn't exist, set conversation_id to null to avoid foreign key constraint violation
      if (conversationId) {
        const { data: conversation, error: conversationError } = (await this.db
          .from(null, getTableName('conversations'))
          .select('id')
          .eq('id', conversationId)
          .single()) as QueryResult<unknown>;

        if (conversationError || !conversation) {
          this.logger.warn(
            `Conversation ${conversationId} not found in conversations table. Setting conversation_id to null for usage tracking.`,
          );
          conversationId = null;
        }
      }

      const insertData: Record<string, unknown> = {
        run_id: runId,
        user_id: userId,
        caller_type: params.callerType || 'llm_service',
        agent_name: params.callerName || 'direct_call',
        conversation_id: conversationId,
        provider_name: params.provider,
        model_name: params.model,
        is_local: !!params.isLocal,
        model_tier: params.isLocal ? 'local' : 'external',
        route: params.isLocal ? 'local' : 'remote',
        fallback_used: false,
        status: params.status || 'completed',
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date(endTime).toISOString(),
        duration_ms: duration,
        input_tokens: params.inputTokens ?? null,
        output_tokens: params.outputTokens ?? null,
        input_cost: inputCost ?? null,
        output_cost: outputCost ?? null,
        total_cost: totalCost ?? null,
      };

      // Map enhanced metrics if provided
      if (params.enhancedMetrics) {
        const m = params.enhancedMetrics as unknown as Record<string, unknown>;
        insertData.data_sanitization_applied = (m.dataSanitizationApplied ??
          null) as boolean | null;
        insertData.sanitization_level = (m.sanitizationLevel ?? null) as
          | string
          | null;
        insertData.pii_detected = (m.piiDetected ?? null) as boolean | null;
        insertData.pii_types = (m.piiTypes ?? null) as string[] | null;
        insertData.pseudonyms_used = (m.pseudonymsUsed ?? null) as
          | boolean
          | null;
        insertData.pseudonym_types = (m.pseudonymTypes ?? null) as
          | string[]
          | null;
        insertData.redactions_applied = (m.redactionsApplied ?? null) as
          | boolean
          | null;
        insertData.redaction_types = (m.redactionTypes ?? null) as
          | string[]
          | null;
        insertData.source_blinding_applied = m.sourceBlindingApplied ?? null;
        insertData.headers_stripped = m.headersStripped ?? null;
        insertData.custom_user_agent_used = m.customUserAgentUsed ?? null;
        insertData.proxy_used = m.proxyUsed ?? null;
        insertData.no_train_header_sent = m.noTrainHeaderSent ?? null;
        insertData.no_retain_header_sent = m.noRetainHeaderSent ?? null;
        insertData.sanitization_time_ms = m.sanitizationTimeMs ?? null;
        insertData.reversal_context_size = m.reversalContextSize ?? null;
        insertData.policy_profile = m.policyProfile ?? null;
        insertData.sovereign_mode = m.sovereignMode ?? null;
        insertData.compliance_flags = m.complianceFlags ?? null;
        // Persist full pseudonym mappings if provided
        if (m.pseudonymMappings) {
          insertData.pseudonym_mappings = m.pseudonymMappings;
        }
      }

      const { error } = (await this.db
        .from(null, getTableName('llm_usage'))
        .insert(insertData)) as QueryResult<unknown>;

      if (error) {
        this.logger.error(
          `🔍 [LLM-USAGE-DEBUG] Insert usage failed for runId: ${runId}:`,
          error,
        );
        throw new Error(`Failed to insert usage record: ${error.message}`);
      } else {
        this.logger.debug(
          `🔍 [LLM-USAGE-DEBUG] Inserted completed usage for runId: ${runId}`,
        );
      }
    } catch (_err) {
      this.logger.error('Failed to insert completed usage:', _err);
    }
  }

  /**
   * Complete tracking for a failed request
   */
  completeRequestWithError(
    context: MetadataContext,
    error: Error,
  ): Promise<RunMetadata> {
    const endTime = Date.now();
    const duration = endTime - context.startTime;

    const metadata: RunMetadata = {
      runId: context.runId,
      provider: context.provider,
      model: context.model,
      tier: context.tier,
      cost: 0, // No cost for failed requests
      duration,
      timestamp: new Date().toISOString(),
      status: 'error',
      errorMessage: error.message,
    };

    // Update database record with error (async, non-blocking)
    this.updateUsageRecord(context.runId, {
      status: 'error',
      durationMs: duration,
      errorMessage: error.message,
      completedAt: new Date().toISOString(),
    }).catch((dbError) => {
      this.logger.error(
        `Failed to update error record for ${context.runId}:`,
        dbError,
      );
    });

    // Clean up active tracking
    this.activeRuns.delete(context.runId);

    this.logger.warn(
      `Failed run ${context.runId}: ${error.message} (${duration}ms)`,
    );

    return Promise.resolve(metadata);
  }

  /**
   * Generate a unique run ID using UUID v4
   */
  private generateRunId(): string {
    return uuidv4();
  }

  /**
   * Estimate token count from text (4 characters ≈ 1 token)
   */
  private estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate cost estimate based on model and token usage
   */
  private calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): CostEstimate {
    const pricing =
      this.costTable[model as keyof typeof this.costTable] ||
      this.costTable['default'];

    const inputCost = (inputTokens / 1000) * pricing.input;
    const outputCost = (outputTokens / 1000) * pricing.output;
    const totalCost = inputCost + outputCost;

    return {
      inputCost,
      outputCost,
      totalCost,
      currency: 'USD',
    };
  }

  /**
   * Get metadata for a specific run ID
   */
  getRunMetadata(runId: string): MetadataContext | null {
    return this.activeRuns.get(runId) || null;
  }

  /**
   * Fetch a single usage record by run_id from the database
   */
  async getUsageDetails(runId: string): Promise<LLMUsageDbRecord | null> {
    try {
      // Database queries
      const { data: result, error } = (await this.db
        .from(null, getTableName('llm_usage'))
        .select('*')
        .eq('run_id', runId)
        .single()) as { data: unknown; error: unknown };

      const data = result as LLMUsageDbRecord | null;

      if (error) {
        if ((error as { code?: string })?.code === 'PGRST116') {
          // no rows
          return null;
        }
        throw new Error(String((error as Record<string, unknown>).message));
      }

      return data;
    } catch (_err) {
      this.logger.error(
        `Failed to fetch usage details for runId ${runId}:`,
        _err,
      );
      throw _err;
    }
  }

  /**
   * Get all active runs (for monitoring)
   */
  getActiveRuns(): MetadataContext[] {
    return Array.from(this.activeRuns.values());
  }

  /**
   * Clean up stale runs (older than 5 minutes)
   */
  cleanupStaleRuns(): void {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    for (const [runId, context] of this.activeRuns.entries()) {
      if (context.startTime < fiveMinutesAgo) {
        this.activeRuns.delete(runId);
        this.logger.warn(`Cleaned up stale run ${runId}`);
      }
    }
  }

  /**
   * Get service statistics
   */
  async getStats(): Promise<{
    activeRuns: number;
    totalRunsToday: number;
    avgDuration: number;
    avgCost: number;
  }> {
    try {
      // Database queries

      // Get last 24 hours of completed runs (more flexible than "today")
      const last24Hours = new Date(
        Date.now() - 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data: result, error: recentError } = (await this.db
        .from(null, getTableName('llm_usage'))
        .select('duration_ms, input_cost, output_cost')
        .eq('status', 'completed')
        .gte('started_at', last24Hours)) as QueryResult<unknown>;

      const recentRuns = result as Array<{
        duration_ms?: number;
        input_cost?: number;
        output_cost?: number;
      }> | null;

      if (recentError) {
        this.logger.error('Error fetching recent runs:', recentError);
        return {
          activeRuns: this.activeRuns.size,
          totalRunsToday: 0,
          avgDuration: 0,
          avgCost: 0,
        };
      }

      const totalRunsToday = recentRuns?.length || 0;
      const avgDuration =
        totalRunsToday > 0 && recentRuns
          ? recentRuns.reduce((sum, run) => sum + (run.duration_ms || 0), 0) /
            totalRunsToday
          : 0;
      const avgCost =
        totalRunsToday > 0 && recentRuns
          ? recentRuns.reduce(
              (sum, run) =>
                sum + ((run.input_cost || 0) + (run.output_cost || 0)),
              0,
            ) / totalRunsToday
          : 0;

      return {
        activeRuns: this.activeRuns.size,
        totalRunsToday,
        avgDuration,
        avgCost,
      };
    } catch (error) {
      this.logger.error('Error calculating stats:', error);
      return {
        activeRuns: this.activeRuns.size,
        totalRunsToday: 0,
        avgDuration: 0,
        avgCost: 0,
      };
    }
  }

  /**
   * Insert initial usage record into database
   */
  private async insertUsageRecord(
    context: MetadataContext,
    status: string,
  ): Promise<void> {
    // Database queries

    // Verify user exists in public.users table before inserting
    // If user doesn't exist, set user_id to null to avoid foreign key constraint violation
    let userId: string | null =
      context.userId &&
      isValidUUID(context.userId) &&
      !isNilUuid(context.userId)
        ? context.userId
        : null;
    if (userId) {
      const { data: user, error: userError } = (await this.db
        .from(null, getTableName('users'))
        .select('id')
        .eq('id', userId)
        .single()) as QueryResult<unknown>;

      if (userError || !user) {
        this.logger.warn(
          `User ${userId} not found in public.users table. Setting user_id to null for usage tracking.`,
        );
        userId = null;
      }
    }

    const conversationId =
      context.conversationId &&
      isValidUUID(context.conversationId) &&
      !isNilUuid(context.conversationId)
        ? context.conversationId
        : null;

    const insertData = {
      run_id: context.runId,
      user_id: userId,
      caller_type: context.callerType || 'system',
      agent_name: context.callerName || 'unknown',
      conversation_id: conversationId,
      provider_name: context.provider, // Fixed: provider → provider_name
      model_name: context.model, // Fixed: model → model_name
      is_local: context.isLocal || false,
      model_tier: context.modelTier,
      fallback_used: context.fallbackUsed || false,
      routing_reason: context.routingReason,
      complexity_level: context.complexityLevel,
      complexity_score: context.complexityScore,
      data_classification: context.dataClassification,
      status: status,
      started_at: new Date(context.startTime).toISOString(),
      duration_ms: 0,
    };

    this.logger.debug(
      `🔍 [LLM-USAGE-DEBUG] Inserting into ${getTableName('llm_usage')} table:`,
      insertData,
    );

    const { error } = (await this.db
      .from(null, getTableName('llm_usage'))
      .insert(insertData)) as QueryResult<unknown>;

    if (error) {
      this.logger.error(`🔍 [LLM-USAGE-DEBUG] Database insert failed:`, error);
      throw new Error(`Failed to insert usage record: ${error.message}`);
    } else {
      this.logger.debug(
        `🔍 [LLM-USAGE-DEBUG] Database insert successful for runId: ${context.runId}`,
      );
    }
  }

  /**
   * Update usage record in database
   */
  private async updateUsageRecord(
    runId: string,
    updates: {
      status: string;
      inputTokens?: number;
      outputTokens?: number;
      inputCost?: number;
      outputCost?: number;
      durationMs?: number;
      completedAt?: string;
      errorMessage?: string;
      enhancedMetrics?: LLMUsageMetrics;
    },
  ): Promise<void> {
    // Database queries

    this.logger.debug(
      `🔍 [PII-METADATA-DEBUG] updateUsageRecord - updates.enhancedMetrics exists:`,
      !!updates.enhancedMetrics,
    );
    if (updates.enhancedMetrics) {
      this.logger.debug(
        `🔍 [PII-METADATA-DEBUG] updateUsageRecord - enhancedMetrics content:`,
        {
          piiDetected: updates.enhancedMetrics.piiDetected,
          pseudonymsUsed: updates.enhancedMetrics.pseudonymsUsed,
          pseudonymTypes: updates.enhancedMetrics.pseudonymTypes,
          redactionsApplied: updates.enhancedMetrics.redactionsApplied,
          redactionTypes: updates.enhancedMetrics.redactionTypes,
        },
      );
    }

    const updateData = {
      status: updates.status,
      input_tokens: updates.inputTokens,
      output_tokens: updates.outputTokens,
      input_cost: updates.inputCost,
      output_cost: updates.outputCost,
      total_cost: (updates.inputCost || 0) + (updates.outputCost || 0),
      duration_ms: updates.durationMs,
      completed_at: updates.completedAt,
      error_message: updates.errorMessage,
      ...(updates.enhancedMetrics && {
        data_sanitization_applied:
          updates.enhancedMetrics.dataSanitizationApplied,
        sanitization_level: updates.enhancedMetrics.sanitizationLevel,
        pii_detected: updates.enhancedMetrics.piiDetected,
        showstopper_detected:
          updates.enhancedMetrics.showstopperDetected || false,
        pii_types: Array.isArray(updates.enhancedMetrics.piiTypes)
          ? updates.enhancedMetrics.piiTypes
          : updates.enhancedMetrics.piiTypes || [],
        pseudonyms_used: updates.enhancedMetrics.pseudonymsUsed,
        pseudonym_types: updates.enhancedMetrics.pseudonymTypes,
        redactions_applied:
          updates.enhancedMetrics.patternRedactionsApplied ||
          updates.enhancedMetrics.redactionsApplied ||
          0,
        redaction_types:
          updates.enhancedMetrics.patternRedactionTypes ||
          updates.enhancedMetrics.redactionTypes ||
          [],
        source_blinding_applied: updates.enhancedMetrics.sourceBlindingApplied,
        headers_stripped: updates.enhancedMetrics.headersStripped,
        custom_user_agent_used: updates.enhancedMetrics.customUserAgentUsed,
        proxy_used: updates.enhancedMetrics.proxyUsed,
        no_train_header_sent: updates.enhancedMetrics.noTrainHeaderSent,
        no_retain_header_sent: updates.enhancedMetrics.noRetainHeaderSent,
        sanitization_time_ms: updates.enhancedMetrics.sanitizationTimeMs,
        reversal_context_size: updates.enhancedMetrics.reversalContextSize,
        policy_profile: updates.enhancedMetrics.policyProfile,
        sovereign_mode: updates.enhancedMetrics.sovereignMode,
        compliance_flags: updates.enhancedMetrics.complianceFlags,
        pseudonym_mappings: updates.enhancedMetrics.pseudonymMappings,
      }),
    };

    this.logger.debug(
      `🔍 [PII-METADATA-DEBUG] updateUsageRecord - Final updateData PII fields:`,
      {
        pii_detected: updateData.pii_detected,
        pseudonyms_used: updateData.pseudonyms_used,
        pseudonym_types: updateData.pseudonym_types,
        redactions_applied: updateData.redactions_applied,
        redaction_types: updateData.redaction_types,
      },
    );

    this.logger.debug(
      `🔍 [LLM-USAGE-DEBUG] Updating runId ${runId} in ${getTableName('llm_usage')} with:`,
      updateData,
    );

    const { data: result, error } = (await this.db
      .from(null, getTableName('llm_usage'))
      .update(updateData)
      .eq('run_id', runId)
      .select(
        'run_id,status,input_tokens,output_tokens,duration_ms,pii_detected,pseudonyms_used,sanitization_level,total_cost',
      )
      .single()) as QueryResult<unknown>;

    const updatedRow = result as Partial<LLMUsageDbRecord> | null;

    if (error) {
      this.logger.error(
        `🔍 [LLM-USAGE-DEBUG] Database update failed for runId: ${runId}:`,
        error,
      );
      throw new Error(`Failed to update usage record: ${error.message}`);
    } else {
      this.logger.debug(
        `🔍 [LLM-USAGE-DEBUG] Database update successful for runId: ${runId}`,
      );
      this.logger.debug(
        `🔍 [LLM-USAGE-DEBUG] Updated row snapshot:`,
        updatedRow,
      );
    }
  }

  /**
   * Get usage records from database
   */
  async getUsageRecords(filters?: {
    userId?: string;
    callerType?: string;
    callerName?: string;
    conversationId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    route?: 'local' | 'remote';
  }): Promise<LLMUsageDbRecord[]> {
    // Database queries

    let query = this.db
      .from(null, getTableName('llm_usage'))
      .select('*')
      .order('started_at', { ascending: false });

    if (filters?.userId) query = query.eq('user_id', filters.userId);
    if (filters?.callerType)
      query = query.eq('caller_type', filters.callerType);
    if (filters?.callerName)
      query = query.eq('caller_name', filters.callerName);
    if (filters?.conversationId)
      query = query.eq('conversation_id', filters.conversationId);
    if (filters?.startDate) query = query.gte('started_at', filters.startDate);
    if (filters?.endDate) query = query.lte('started_at', filters.endDate);
    if (filters?.route) query = query.eq('route', filters.route);
    if (filters?.limit) query = query.limit(filters.limit);

    const { data: result, error } = (await query) as QueryResult<unknown>;
    const data = result as LLMUsageDbRecord[] | null;
    if (error)
      throw new Error(`Failed to fetch usage records: ${error.message}`);
    return data || [];
  }

  /**
   * Get usage analytics from database
   */
  async getUsageAnalytics(filters?: {
    startDate?: string;
    endDate?: string;
    callerType?: string;
    route?: 'local' | 'remote';
  }): Promise<Record<string, unknown>[]> {
    // Database queries

    let query = this.db
      .from(null, 'llm_usage')
      .select(
        'run_id, user_id, caller_type, agent_name, conversation_id, provider_name, model_name, is_local, model_tier, route, status, started_at, completed_at, duration_ms, input_tokens, output_tokens',
      )
      .order('created_at', { ascending: false });

    if (filters?.startDate) query = query.gte('created_at', filters.startDate);
    if (filters?.endDate) query = query.lte('created_at', filters.endDate);
    if (filters?.callerType)
      query = query.eq('caller_type', filters.callerType);
    if (filters?.route) query = query.eq('route', filters.route);

    const { data: result, error } = (await query) as QueryResult<unknown>;
    const data = result as LLMUsageDbRecord[] | null;
    if (error)
      throw new Error(`Failed to fetch usage analytics: ${error.message}`);
    return data || [];
  }
}
