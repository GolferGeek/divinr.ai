/**
 * Observability Plane Types
 *
 * Shared event types for cross-product observability.
 * All events carry ExecutionContext v2 for full attribution.
 */

import type { ExecutionContext } from '@orchestrator-ai/transport-types';

// ─── Invocation Lifecycle ─────────────────────────────────────────────

/**
 * Invocation lifecycle event types.
 */
export type InvocationEventType =
  | 'invocation.started'
  | 'invocation.progress'
  | 'invocation.completed'
  | 'invocation.failed';

/**
 * Invocation lifecycle event.
 */
export interface InvocationEvent {
  /** Event type */
  type: InvocationEventType;

  /** Source application identifier */
  sourceApp: string;

  /** Human-readable message */
  message?: string;

  /** Progress percentage (0-100) */
  progress?: number;

  /** Current step/phase name */
  step?: string;

  /** Event-specific payload */
  payload?: Record<string, unknown>;

  /** Duration in milliseconds (for completed/failed) */
  duration?: number;

  /** Whether the invocation succeeded (for completed/failed) */
  success?: boolean;

  /** Error message (for failed) */
  error?: string;
}

// ─── LLM Usage ────────────────────────────────────────────────────────

/**
 * LLM usage event for cost attribution and observability.
 */
export interface LLMUsageEvent {
  /** Provider used (from ExecutionContext or overridden) */
  provider: string;

  /** Model used (from ExecutionContext or overridden) */
  model: string;

  /** Input tokens consumed */
  inputTokens?: number;

  /** Output tokens generated */
  outputTokens?: number;

  /** Total tokens (input + output) */
  totalTokens?: number;

  /** Cost in USD (if calculable) */
  costUsd?: number;

  /** Duration of the LLM call in milliseconds */
  durationMs?: number;

  /** Whether the call was streaming */
  streaming?: boolean;

  /** Whether the call succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Additional metadata (temperature, max_tokens, etc.) */
  metadata?: Record<string, unknown>;
}

// ─── Stream Correlation ───────────────────────────────────────────────

/**
 * Stream correlation — links a streaming session to its invocation.
 */
export interface StreamCorrelation {
  /** JSON-RPC request id */
  requestId: string | number | null;

  /** Unique stream identifier */
  streamId: string;

  /** Timestamp when streaming started */
  startedAt: string;
}

// ─── Persisted Event Record ───────────────────────────────────────────

/**
 * Persisted observability event record.
 * This is the canonical shape for buffered and stored events.
 */
export interface ObservabilityEventRecord {
  /** Full ExecutionContext v2 capsule */
  context: ExecutionContext;

  /** Source application identifier */
  sourceApp: string;

  /** Event type (e.g., 'invocation.started', 'llm.usage', 'stream.chunk') */
  eventType: string;

  /** Event status */
  status: string;

  /** Human-readable message */
  message?: string;

  /** Progress percentage (0-100) */
  progress?: number;

  /** Current step/phase name */
  step?: string;

  /** Full event payload */
  payload: Record<string, unknown>;

  /** Unix timestamp (milliseconds) */
  timestamp: number;
}
