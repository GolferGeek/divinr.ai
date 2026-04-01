/**
 * Supabase Observability Provider
 *
 * Persists events to the observability_events table, maintains an in-memory
 * buffer for live SSE streaming, and records LLM usage for cost attribution.
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import type { ExecutionContext } from '@orchestrator-ai/transport-types';
import { DATABASE_SERVICE } from '../../database';
import type { DatabaseService } from '../../database';
import type { ObservabilityServiceProvider } from '../observability.interface';
import type {
  InvocationEvent,
  LLMUsageEvent,
  StreamCorrelation,
  ObservabilityEventRecord,
} from '../observability.types';

@Injectable()
export class SupabaseObservabilityService implements ObservabilityServiceProvider {
  private readonly logger = new Logger(SupabaseObservabilityService.name);
  private readonly bufferSize: number;
  private readonly subject = new Subject<ObservabilityEventRecord>();
  private readonly buffer: ObservabilityEventRecord[] = [];

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {
    this.bufferSize = Math.max(
      Number(process.env.OBSERVABILITY_EVENT_BUFFER ?? 500),
      1,
    );
    this.logger.log('Supabase observability provider initialized');
  }

  // ─── Invocation Lifecycle ─────────────────────────────────────────

  async emitInvocationEvent(
    context: ExecutionContext,
    event: InvocationEvent,
  ): Promise<void> {
    const record: ObservabilityEventRecord = {
      context,
      sourceApp: event.sourceApp,
      eventType: event.type,
      status: event.type.split('.').pop() || 'unknown',
      message: event.message,
      progress: event.progress,
      step: event.step,
      payload: {
        ...event.payload,
        success: event.success,
        error: event.error,
        duration: event.duration,
      },
      timestamp: Date.now(),
    };

    await this.pushAndPersist(record);
  }

  // ─── LLM Usage ───────────────────────────────────────────────────

  async recordLLMUsage(
    context: ExecutionContext,
    usage: LLMUsageEvent,
  ): Promise<void> {
    const record: ObservabilityEventRecord = {
      context,
      sourceApp: 'llm-plane',
      eventType: 'llm.usage',
      status: usage.success ? 'completed' : 'failed',
      message: usage.error || undefined,
      payload: {
        provider: usage.provider,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        costUsd: usage.costUsd,
        durationMs: usage.durationMs,
        streaming: usage.streaming,
        success: usage.success,
        error: usage.error,
        ...usage.metadata,
      },
      timestamp: Date.now(),
    };

    await this.pushAndPersist(record);
  }

  // ─── Stream Correlation ───────────────────────────────────────────

  async registerStream(
    context: ExecutionContext,
    correlation: StreamCorrelation,
  ): Promise<void> {
    const record: ObservabilityEventRecord = {
      context,
      sourceApp: 'stream-plane',
      eventType: 'stream.registered',
      status: 'registered',
      payload: {
        requestId: correlation.requestId,
        streamId: correlation.streamId,
        startedAt: correlation.startedAt,
      },
      timestamp: Date.now(),
    };

    await this.pushAndPersist(record);
  }

  async emitStreamEvent(
    context: ExecutionContext,
    requestId: string | number | null,
    eventType: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const record: ObservabilityEventRecord = {
      context,
      sourceApp: 'stream-plane',
      eventType: `stream.${eventType}`,
      status: eventType,
      payload: {
        requestId,
        ...data,
      },
      timestamp: Date.now(),
    };

    await this.pushAndPersist(record);
  }

  // ─── Query / Subscribe ────────────────────────────────────────────

  getRecentEvents(limit?: number): ObservabilityEventRecord[] {
    if (limit) {
      return this.buffer.slice(-limit);
    }
    return [...this.buffer];
  }

  getEventStream(): Observable<ObservabilityEventRecord> {
    return this.subject.asObservable();
  }

  async getHistoricalEvents(
    since: number,
    limit = 1000,
    until?: number,
  ): Promise<ObservabilityEventRecord[]> {
    let query = this.db
      .from(null, 'observability_events')
      .select('*')
      .gte('timestamp', since);

    if (until) {
      query = query.lte('timestamp', until);
    }

    const { data, error } = await query
      .order('timestamp', { ascending: true })
      .limit(limit);

    if (error) {
      this.logger.error(`Failed to query historical events: ${error.message}`);
      return [];
    }

    const rows = (data || []) as Record<string, unknown>[];
    return rows.map((row) => this.mapRowToRecord(row));
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private async pushAndPersist(record: ObservabilityEventRecord): Promise<void> {
    // Buffer + notify subscribers
    this.buffer.push(record);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
    }
    this.subject.next(record);

    // Persist (fire-and-forget)
    this.persistToDatabase(record).catch((err) => {
      this.logger.warn(
        `Failed to persist observability event: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private async persistToDatabase(record: ObservabilityEventRecord): Promise<void> {
    const { error } = await this.db
      .from(null, 'observability_events')
      .insert({
        source_app: record.sourceApp,
        hook_event_type: record.eventType,
        status: record.status,
        message: record.message || null,
        progress: record.progress ?? null,
        step: record.step || null,
        payload: record.payload,
        timestamp: record.timestamp,
        // ExecutionContext v2 fields
        conversation_id: record.context.conversationId || null,
        user_id: record.context.userId || null,
        agent_slug: record.context.agentSlug || null,
        organization_slug: record.context.orgSlug || null,
        // Provider/model attribution
        session_id: record.context.conversationId || 'unknown',
      });

    if (error) {
      this.logger.warn(`Database insert error: ${error.message}`);
    }
  }

  private mapRowToRecord(row: Record<string, unknown>): ObservabilityEventRecord {
    return {
      context: {
        orgSlug: (row.organization_slug as string) || '',
        userId: (row.user_id as string) || '',
        conversationId: (row.conversation_id as string) || '',
        agentSlug: (row.agent_slug as string) || '',
        agentType: '',
        provider: '',
        model: '',
      },
      sourceApp: (row.source_app as string) || '',
      eventType: (row.hook_event_type as string) || '',
      status: (row.status as string) || '',
      message: row.message as string | undefined,
      progress: row.progress as number | undefined,
      step: row.step as string | undefined,
      payload: (row.payload as Record<string, unknown>) || {},
      timestamp: row.timestamp as number,
    };
  }
}
