/**
 * Observability Plane Interface
 *
 * Defines the public contract for the observability provider plane.
 * Selected by OBSERVABILITY_PROVIDER env var at deploy time:
 *   - supabase (default): Supabase-backed event persistence + in-memory buffer
 *   - console: Console-only logging (development/testing)
 *
 * Consumers inject OBSERVABILITY_SERVICE and get the active implementation.
 *
 * Every method accepts ExecutionContext v2 for full attribution:
 * org, user, conversation, agent, provider, model.
 */

import type { ExecutionContext } from '@orchestrator-ai/transport-types';
import type {
  InvocationEvent,
  LLMUsageEvent,
  StreamCorrelation,
  ObservabilityEventRecord,
} from './observability.types';

export const OBSERVABILITY_SERVICE = Symbol('OBSERVABILITY_SERVICE');

/**
 * ObservabilityServiceProvider — the public contract for all observability implementations.
 */
export interface ObservabilityServiceProvider {
  // ─── Invocation Lifecycle ───────────────────────────────────────────

  /**
   * Record an invocation lifecycle event (started, completed, failed).
   */
  emitInvocationEvent(
    context: ExecutionContext,
    event: InvocationEvent,
  ): Promise<void>;

  // ─── LLM Usage ─────────────────────────────────────────────────────

  /**
   * Record LLM usage for cost attribution and observability.
   * Called after every LLM call — including direct provider calls.
   */
  recordLLMUsage(
    context: ExecutionContext,
    usage: LLMUsageEvent,
  ): Promise<void>;

  // ─── Stream Correlation ────────────────────────────────────────────

  /**
   * Register a streaming session for correlation.
   * Links a stream to its originating invocation via requestId.
   */
  registerStream(
    context: ExecutionContext,
    correlation: StreamCorrelation,
  ): Promise<void>;

  /**
   * Record a stream event (started, chunk, progress, output, completed, error).
   * Uses the registered correlation for trace linkage.
   */
  emitStreamEvent(
    context: ExecutionContext,
    requestId: string | number | null,
    eventType: string,
    data?: Record<string, unknown>,
  ): Promise<void>;

  // ─── Query / Subscribe ─────────────────────────────────────────────

  /**
   * Get recent events from the in-memory buffer.
   */
  getRecentEvents(limit?: number): ObservabilityEventRecord[];

  /**
   * Get a live observable of events for SSE streaming.
   * Returns an RxJS-compatible observable.
   */
  getEventStream(): import('rxjs').Observable<ObservabilityEventRecord>;

  /**
   * Query historical events from persistent storage.
   */
  getHistoricalEvents(
    since: number,
    limit?: number,
    until?: number,
  ): Promise<ObservabilityEventRecord[]>;
}
