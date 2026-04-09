import { Injectable, Logger, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@orchestrator-ai/transport-types';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  AUTH_SERVICE,
  AuthServiceProvider,
} from '../../auth/interfaces/auth-service.interface';

/**
 * Observability event payload structure
 */
export interface ObservabilityEvent {
  source_app: string;
  session_id: string;
  hook_event_type: string;
  payload: Record<string, unknown>;
  timestamp?: number;
  chat?: unknown[];
  summary?: string;
  model_name?: string;

  // Full ExecutionContext capsule (preferred — pass this when available)
  context?: ExecutionContext;

  // Enriched fields (legacy — used when context is not available)
  userId?: string;
  username?: string; // display_name or email
  conversationId?: string;
  agentSlug?: string;
  organizationSlug?: string;
  mode?: string;
  message?: string;
  progress?: number;
  step?: string;
  sequence?: number;
  totalSteps?: number;
}

/**
 * User cache entry
 */
interface UserCacheEntry {
  username: string;
  cachedAt: number;
}

/**
 * ObservabilityWebhookService
 *
 * Centralized service for sending observability events to the observability server.
 * Features:
 * - Username resolution (display_name or email) with caching
 * - Automatic enrichment with userId, conversationId, taskId, etc.
 * - Non-blocking webhook calls (failures don't affect agent execution)
 * - Configurable observability server URL
 */
@Injectable()
export class ObservabilityWebhookService implements OnModuleInit {
  private readonly logger = new Logger(ObservabilityWebhookService.name);

  // In-memory cache for username lookups (userId -> username)
  // Cache TTL: 5 minutes
  private readonly userCache = new Map<string, UserCacheEntry>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Observability server URL (configurable via env)
  private readonly observabilityUrl: string;

  constructor(
    @Inject(HttpService) private readonly httpService: HttpService,
    @Optional()
    @Inject(AUTH_SERVICE)
    private readonly authService: AuthServiceProvider | null,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    // No default port - must be explicitly configured
    // This sends events to observability endpoints within the Orchestrator AI API
    const observabilityUrl = this.configService.get<string>(
      'OBSERVABILITY_SERVER_URL',
    );
    const apiPort = this.configService.get<string>('API_PORT');

    if (!apiPort && !observabilityUrl) {
      throw new Error(
        'Either API_PORT or OBSERVABILITY_SERVER_URL environment variable is required. ' +
          'Set API_PORT in your .env file.',
      );
    }
    const apiHost = this.configService.get<string>('API_HOST') || 'localhost';
    this.observabilityUrl = observabilityUrl || `http://${apiHost}:${apiPort}`;
  }

  onModuleInit() {
    this.logger.log(
      `ObservabilityWebhookService initialized - sending events to ${this.observabilityUrl}`,
    );
  }

  /**
   * Resolve userId to username (display_name or email)
   * Uses caching to avoid repeated database lookups
   */
  private async resolveUsername(userId: string): Promise<string | undefined> {
    if (!userId) {
      return undefined;
    }

    // Check cache first
    const cached = this.userCache.get(userId);
    const now = Date.now();

    if (cached && now - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.username;
    }

    try {
      // Fetch user profile
      const profile = await this.authService?.getUserProfile(userId);

      if (!profile) {
        this.logger.warn(`User profile not found for userId: ${userId}`);
        return undefined;
      }

      // Prefer display_name, fallback to email
      const username = profile.displayName || profile.email || 'Unknown User';

      // Cache the result
      this.userCache.set(userId, {
        username,
        cachedAt: now,
      });

      return username;
    } catch (error) {
      this.logger.error(
        `Failed to resolve username for userId ${userId}:`,
        error instanceof Error ? error.message : String(error),
      );
      return undefined;
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();

    for (const [userId, entry] of this.userCache.entries()) {
      if (now - entry.cachedAt >= this.CACHE_TTL_MS) {
        this.userCache.delete(userId);
      }
    }
  }

  /**
   * Send an observability event to the observability server
   * This is non-blocking - failures are logged but don't throw
   */
  async sendEvent(event: ObservabilityEvent): Promise<void> {
    // Clean up cache periodically (every 10th call)
    if (Math.random() < 0.1) {
      this.cleanupCache();
    }

    // Resolve username if userId is provided
    if (event.userId && !event.username) {
      event.username = await this.resolveUsername(event.userId);
    }

    // Ensure timestamp is set
    if (!event.timestamp) {
      event.timestamp = Date.now();
    }

    try {
      const url = `${this.observabilityUrl}/webhooks/status`;
      const webhookPayload = this.buildWebhookPayload(event);

      await firstValueFrom(
        this.httpService.post(url, webhookPayload, {
          timeout: 2000, // 2 second timeout - don't block
          validateStatus: () => true, // Accept any status
        }),
      );
    } catch (error) {
      // Log but don't throw - observability failures shouldn't break agent execution
      this.logger.warn(
        `Failed to send observability event (non-blocking): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Convert ObservabilityEvent payload into the webhook format expected by
   * /webhooks/status so downstream services continue to receive updates.
   */
  private buildWebhookPayload(
    event: ObservabilityEvent,
  ): Record<string, unknown> {
    const payload = event.payload ?? {};
    const asString = (value: unknown): string | undefined =>
      typeof value === 'string' && value.length > 0 ? value : undefined;
    const asNumber = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined;

    const timestampIso =
      typeof event.timestamp === 'number'
        ? new Date(event.timestamp).toISOString()
        : (asString(event.timestamp) ?? new Date().toISOString());

    const resolvedConversationId =
      asString(event.conversationId) ??
      asString(payload.conversationId) ??
      asString(payload.id) ??
      'unknown';

    // Reconstruct ExecutionContext from event fields if not provided directly
    const context: ExecutionContext | undefined = event.context ?? {
      orgSlug:
        asString(event.organizationSlug) ??
        asString(payload.organizationSlug) ??
        '',
      userId: asString(event.userId) ?? asString(payload.userId) ?? '',
      conversationId: resolvedConversationId,
      agentSlug: asString(event.agentSlug) ?? asString(payload.agentSlug) ?? '',
      agentType: asString(payload.agentType) ?? '',
      provider: asString(payload.provider) ?? '',
      model: asString(payload.model) ?? '',
    };

    return {
      conversationId:
        asString(event.conversationId) ??
        asString(payload.conversationId) ??
        resolvedConversationId,
      context,
      status: event.hook_event_type,
      timestamp: timestampIso,
      userId: asString(event.userId) ?? asString(payload.userId),
      username: asString(event.username) ?? asString(payload.username),
      agentSlug: asString(event.agentSlug) ?? asString(payload.agentSlug),
      organizationSlug:
        asString(event.organizationSlug) ?? asString(payload.organizationSlug),
      mode: asString(event.mode) ?? asString(payload.mode),
      message:
        asString(event.message) ?? asString(payload.message) ?? undefined,
      step: asString(event.step) ?? asString(payload.step),
      percent:
        asNumber(event.progress) ??
        asNumber(payload.progress) ??
        asNumber(payload.percent),
      sequence: asNumber(event.sequence) ?? asNumber(payload.sequence),
      totalSteps: asNumber(event.totalSteps) ?? asNumber(payload.totalSteps),
      data: {
        ...payload,
        hook_event_type: event.hook_event_type,
        source_app: event.source_app,
        session_id: event.session_id,
      },
    };
  }

  /**
   * Emit agent execution started event
   *
   * @deprecated Use emitAgentStartedWithContext(context, params) instead.
   *             Accepts cherry-picked fields rather than the full ExecutionContext capsule.
   *             New code must pass the complete ExecutionContext from the request.
   */
  async emitAgentStarted(params: {
    userId: string;
    conversationId: string;
    agentSlug: string;
    organizationSlug?: string;
    mode: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.sendEvent({
      source_app: 'orchestrator-ai',
      session_id: params.conversationId,
      hook_event_type: 'agent.started',
      userId: params.userId,
      conversationId: params.conversationId,
      agentSlug: params.agentSlug,
      organizationSlug: params.organizationSlug,
      mode: params.mode,
      payload: {
        ...params.payload,
        agentSlug: params.agentSlug,
        mode: params.mode,
      },
    });
  }

  /**
   * Emit agent execution completed event
   *
   * @deprecated Use emitAgentCompletedWithContext(context, params) instead.
   *             Accepts cherry-picked fields rather than the full ExecutionContext capsule.
   *             New code must pass the complete ExecutionContext from the request.
   */
  async emitAgentCompleted(params: {
    userId: string;
    conversationId: string;
    agentSlug: string;
    organizationSlug?: string;
    mode: string;
    success: boolean;
    result?: unknown;
    error?: string;
    duration?: number;
  }): Promise<void> {
    await this.sendEvent({
      source_app: 'orchestrator-ai',
      session_id: params.conversationId,
      hook_event_type: params.success ? 'agent.completed' : 'agent.failed',
      userId: params.userId,
      conversationId: params.conversationId,
      agentSlug: params.agentSlug,
      organizationSlug: params.organizationSlug,
      mode: params.mode,
      payload: {
        success: params.success,
        result: params.result,
        error: params.error,
        duration: params.duration,
        agentSlug: params.agentSlug,
        mode: params.mode,
      },
    });
  }

  /**
   * Emit agent progress event
   *
   * @deprecated Use emitAgentProgressWithContext(context, params) instead.
   *             Accepts cherry-picked fields rather than the full ExecutionContext capsule.
   *             New code must pass the complete ExecutionContext from the request.
   */
  async emitAgentProgress(params: {
    userId: string;
    conversationId: string;
    agentSlug: string;
    organizationSlug?: string;
    mode: string;
    message: string;
    progress?: number;
    step?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.sendEvent({
      source_app: 'orchestrator-ai',
      session_id: params.conversationId,
      hook_event_type: 'agent.progress',
      userId: params.userId,
      conversationId: params.conversationId,
      agentSlug: params.agentSlug,
      organizationSlug: params.organizationSlug,
      mode: params.mode,
      payload: {
        message: params.message,
        progress: params.progress,
        step: params.step,
        ...params.metadata,
      },
    });
  }

  /**
   * Emit orchestration step event
   *
   * @deprecated Accept individual fields rather than the full ExecutionContext capsule.
   *             New code must pass the complete ExecutionContext. Migrate callers to
   *             sendEvent() with the full context object populated from ExecutionContext.
   */
  async emitOrchestrationStep(params: {
    userId: string;
    conversationId: string;
    orchestrationRunId: string;
    stepId: string;
    stepName: string;
    status: 'started' | 'completed' | 'failed';
    agentSlug?: string;
    error?: string;
    duration?: number;
  }): Promise<void> {
    await this.sendEvent({
      source_app: 'orchestrator-ai',
      session_id: params.conversationId,
      hook_event_type: `orchestration.step.${params.status}`,
      userId: params.userId,
      conversationId: params.conversationId,
      agentSlug: params.agentSlug,
      payload: {
        orchestrationRunId: params.orchestrationRunId,
        stepId: params.stepId,
        stepName: params.stepName,
        status: params.status,
        error: params.error,
        duration: params.duration,
      },
    });
  }

  /**
   * Emit agent execution started event.
   * Accepts the full ExecutionContext capsule — this is the preferred method.
   * ExecutionContext is passed whole; individual fields are read here only to
   * populate the event shape and are never cherry-picked for function signatures.
   */
  async emitAgentStartedWithContext(
    context: ExecutionContext,
    params: {
      mode: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.sendEvent({
      source_app: 'orchestrator-ai',
      session_id: context.conversationId,
      hook_event_type: 'agent.started',
      userId: context.userId,
      conversationId: context.conversationId,
      agentSlug: context.agentSlug,
      organizationSlug: context.orgSlug,
      mode: params.mode,
      payload: {
        ...params.payload,
        agentSlug: context.agentSlug,
        mode: params.mode,
      },
    });
  }

  /**
   * Emit agent execution completed event.
   * Accepts the full ExecutionContext capsule — this is the preferred method.
   * ExecutionContext is passed whole; individual fields are read here only to
   * populate the event shape and are never cherry-picked for function signatures.
   */
  async emitAgentCompletedWithContext(
    context: ExecutionContext,
    params: {
      mode: string;
      success: boolean;
      result?: unknown;
      error?: string;
      duration?: number;
    },
  ): Promise<void> {
    await this.sendEvent({
      source_app: 'orchestrator-ai',
      session_id: context.conversationId,
      hook_event_type: params.success ? 'agent.completed' : 'agent.failed',
      userId: context.userId,
      conversationId: context.conversationId,
      agentSlug: context.agentSlug,
      organizationSlug: context.orgSlug,
      mode: params.mode,
      payload: {
        success: params.success,
        result: params.result,
        error: params.error,
        duration: params.duration,
        agentSlug: context.agentSlug,
        mode: params.mode,
      },
    });
  }

  /**
   * Emit agent progress event.
   * Accepts the full ExecutionContext capsule — this is the preferred method.
   * ExecutionContext is passed whole; individual fields are read here only to
   * populate the event shape and are never cherry-picked for function signatures.
   */
  async emitAgentProgressWithContext(
    context: ExecutionContext,
    params: {
      mode: string;
      message: string;
      progress?: number;
      step?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.sendEvent({
      source_app: 'orchestrator-ai',
      session_id: context.conversationId,
      hook_event_type: 'agent.progress',
      userId: context.userId,
      conversationId: context.conversationId,
      agentSlug: context.agentSlug,
      organizationSlug: context.orgSlug,
      mode: params.mode,
      payload: {
        message: params.message,
        progress: params.progress,
        step: params.step,
        ...params.metadata,
      },
    });
  }
}
