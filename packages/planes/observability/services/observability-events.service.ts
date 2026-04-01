import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { ExecutionContext, isNilUuid } from '@orchestrator-ai/transport-types';
import { randomUUID } from 'crypto';
import {
  AUTH_SERVICE,
  AuthServiceProvider,
} from '../../auth/interfaces/auth-service.interface';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '../../database';

/**
 * ObservabilityEventRecord
 *
 * Record structure for observability events.
 * All identity fields come from context - no duplication.
 */
export interface ObservabilityEventRecord {
  /** ExecutionContext capsule - contains all identity fields */
  context: ExecutionContext;
  /** Source application identifier */
  source_app: string;
  /** Event type (e.g., 'langgraph.started', 'agent.progress') */
  hook_event_type: string;
  /** Event status */
  status: string;
  /** Human-readable message */
  message: string | null;
  /** Progress percentage (0-100) */
  progress: number | null;
  /** Current step/phase name */
  step: string | null;
  /** Full event payload */
  payload: Record<string, unknown>;
  /** Unix timestamp (milliseconds) */
  timestamp: number;
}

interface ObservabilityDbRow {
  id: string;
  conversation_id: string | null;
  task_id: string | null;
  user_id: string | null;
  agent_slug: string | null;
  organization_slug: string | null;
  source_app: string;
  hook_event_type: string;
  status: string | null;
  message: string | null;
  progress: number | null;
  step: string | null;
  payload: Record<string, unknown> | null;
  username: string | null;
  mode: string | null;
  sequence: number | null;
  total_steps: number | null;
  timestamp: number;
  created_at: string;
}

/**
 * ObservabilityEventsService
 *
 * Maintains an in-memory, reactive buffer of the most recent observability
 * events so multiple consumers (admin SSE, task SSE, debugging tools) can
 * subscribe to the same stream without duplicating plumbing.
 */
@Injectable()
export class ObservabilityEventsService {
  private readonly logger = new Logger(ObservabilityEventsService.name);
  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  private readonly bufferSize: number;
  /**
   * Use a regular Subject (not ReplaySubject) for live events.
   *
   * Replay is handled manually via getSnapshot() by consumers who need it.
   * This prevents duplicate events when a consumer:
   * 1. First calls getSnapshot() to replay missed events
   * 2. Then subscribes to events$ for live updates
   *
   * Using ReplaySubject would cause events to be delivered twice.
   */
  private readonly subject: Subject<ObservabilityEventRecord>;
  private readonly buffer: ObservabilityEventRecord[] = [];

  // Cache of userId -> username mappings
  private readonly userCache = new Map<string, string>();
  // Track pending lookups to avoid duplicate requests
  private readonly pendingLookups = new Set<string>();

  constructor(
    @Optional()
    @Inject(forwardRef(() => AUTH_SERVICE))
    private readonly authService: AuthServiceProvider | null,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {
    this.bufferSize = Math.max(
      Number(process.env.OBSERVABILITY_EVENT_BUFFER ?? 500),
      1,
    );
    // Use regular Subject - replay is handled manually via getSnapshot()
    this.subject = new Subject<ObservabilityEventRecord>();
  }

  /**
   * Get username for userId - from cache or fetch from database (once)
   */
  async resolveUsername(userId: string): Promise<string | undefined> {
    if (!userId) return undefined;

    // Check cache first
    const cached = this.userCache.get(userId);
    if (cached) {
      return cached;
    }

    // Don't duplicate pending lookups
    if (this.pendingLookups.has(userId)) {
      return undefined;
    }

    // Fetch from database (one-time hit per user)
    this.pendingLookups.add(userId);
    try {
      const profile = await this.authService?.getUserProfile(userId);
      const username = profile?.displayName || profile?.email;
      if (username) {
        this.userCache.set(userId, username);
        this.logger.log(`📝 Cached username: ${userId} -> ${username}`);
        return username;
      }
    } catch (err) {
      this.logger.warn(
        `Failed to resolve username for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.pendingLookups.delete(userId);
    }

    return undefined;
  }

  /**
   * Cache a userId -> username mapping (called when username comes in from event)
   */
  cacheUsername(userId: string, username: string): void {
    if (userId && username && username !== userId) {
      this.userCache.set(userId, username);
      this.logger.debug(
        `📝 Cached username from event: ${userId} -> ${username}`,
      );
    }
  }

  /**
   * Observable stream of events for subscribers.
   */
  get events$(): Observable<ObservabilityEventRecord> {
    return this.subject.asObservable();
  }

  /**
   * Snapshot of the current in-memory buffer (FIFO with configured size).
   */
  getSnapshot(): ObservabilityEventRecord[] {
    return [...this.buffer];
  }

  /**
   * Push a new event into the buffer and notify subscribers.
   * Enriches events with username (from cache or database lookup).
   */
  async push(event: ObservabilityEventRecord): Promise<void> {
    try {
      const userId = this.toValidUuidOrNull(event.context?.userId);
      const payloadUsername = event.payload?.username as string | undefined;

      // Learn: If event already has a username in payload, cache it
      if (userId && payloadUsername && payloadUsername !== userId) {
        this.cacheUsername(userId, payloadUsername);
      }

      // Enrich: If event doesn't have username, resolve it (from cache or DB)
      if (userId && !payloadUsername) {
        const username = await this.resolveUsername(userId);
        if (username) {
          event.payload = {
            ...event.payload,
            username,
          };
        }
      }

      const username = event.payload?.username;
      const usernameStr = typeof username === 'string' ? username : 'unknown';
      this.logger.debug(
        `📥 [BUFFER] Pushing event: ${event.hook_event_type} for conversation ${event.context.conversationId || 'unknown'}, username=${usernameStr}`,
      );
      this.buffer.push(event);
      if (this.buffer.length > this.bufferSize) {
        this.buffer.shift();
      }

      this.subject.next(event);
      this.logger.debug(
        `✅ [BUFFER] Event pushed successfully, buffer size: ${this.buffer.length}, subscribers notified`,
      );

      // Persist to database (fire and forget, don't block)
      this.persistToDatabase(event).catch((err) => {
        this.logger.warn(`Failed to persist event to database: ${err}`);
      });
    } catch (error) {
      this.logger.error(
        `❌ [BUFFER] Failed to push observability event: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.logger.error(error);
    }
  }

  /**
   * Persist event to database for historical queries
   */
  private async persistToDatabase(
    event: ObservabilityEventRecord,
  ): Promise<void> {
    try {
      const rawConversationId = this.toValidUuidOrNull(
        event.context.conversationId,
      );
      const conversationId =
        await this.getPersistableConversationId(rawConversationId);
      const taskId =
        this.toValidUuidOrNull(event.context.conversationId) || randomUUID();
      const userId = this.toValidUuidOrNull(event.context.userId);

      const { error } = await this.db
        .from(null, 'observability_events')
        .insert({
          source_app: event.source_app,
          session_id: conversationId || taskId,
          hook_event_type: event.hook_event_type,
          user_id: userId,
          username: (event.payload?.username as string) || null,
          conversation_id: conversationId,
          task_id: taskId,
          agent_slug: event.context.agentSlug || null,
          organization_slug: event.context.orgSlug || null,
          mode: (event.payload?.mode as string) || null,
          status: event.status,
          message: event.message,
          progress: event.progress,
          step: event.step,
          sequence: (event.payload?.sequence as number) || null,
          total_steps: (event.payload?.totalSteps as number) || null,
          payload: event.payload,
          timestamp: event.timestamp,
        });

      if (error) {
        this.logger.warn(`Database insert error: ${error.message}`);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to persist event: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private toValidUuidOrNull(value: string | null | undefined): string | null {
    if (
      !value ||
      !ObservabilityEventsService.UUID_REGEX.test(value) ||
      isNilUuid(value)
    ) {
      return null;
    }
    return value;
  }

  private async getPersistableConversationId(
    conversationId: string | null,
  ): Promise<string | null> {
    if (!conversationId) {
      return null;
    }

    const { data, error } = (await this.db
      .from(null, 'conversations')
      .select('id')
      .eq('id', conversationId)
      .single()) as QueryResult<unknown>;

    if (error || !data) {
      return null;
    }

    return conversationId;
  }

  /**
   * Query historical events from database
   * @param since Timestamp (ms) - fetch events from this time onwards
   * @param limit Max number of events to return
   * @param until Optional timestamp (ms) - fetch events up to this time
   */
  async getHistoricalEvents(
    since: number,
    limit = 1000,
    until?: number,
  ): Promise<ObservabilityEventRecord[]> {
    try {
      let query = this.db
        .from(null, 'observability_events')
        .select('*')
        .gte('timestamp', since);

      // Add upper bound if specified
      if (until) {
        query = query.lte('timestamp', until);
      }

      const { data, error } = (await query
        .order('timestamp', { ascending: false })
        .limit(limit)) as QueryResult<unknown>;

      if (error) {
        this.logger.error(
          `Failed to query historical events: ${error.message}`,
        );
        return [];
      }

      // Map database records to ObservabilityEventRecord format
      const rows = (data || []) as ObservabilityDbRow[];
      return rows.map((row) => ({
        context: {
          conversationId: row.conversation_id,
          userId: row.user_id,
          agentSlug: row.agent_slug,
          orgSlug: row.organization_slug,
          agentType: '',
          provider: '',
          model: '',
        } as ExecutionContext,
        source_app: row.source_app,
        hook_event_type: row.hook_event_type,
        status: row.status || '',
        message: row.message,
        progress: row.progress,
        step: row.step,
        payload: {
          ...(row.payload || {}),
          username: row.username,
          mode: row.mode,
          sequence: row.sequence,
          totalSteps: row.total_steps,
        },
        timestamp: row.timestamp,
        id: row.id,
        created_at: row.created_at,
      }));
    } catch (err) {
      this.logger.error(
        `Failed to query historical events: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }
}
