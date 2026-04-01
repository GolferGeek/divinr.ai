/**
 * Streaming Event Contract V2
 *
 * Shared stream event envelope for all products. Transport-types defines
 * the event structure; the observability plane owns emission, correlation,
 * and operational visibility.
 */

import type { ExecutionContext } from '../invocation/execution-context';

/**
 * Shared stream event types.
 */
export type StreamEventType =
  | 'started'
  | 'chunk'
  | 'progress'
  | 'output'
  | 'completed'
  | 'error';

/**
 * Shared stream event envelope.
 * All streaming events follow this shape for cross-product consistency.
 */
export interface StreamEvent {
  /** Event type */
  event: StreamEventType;

  /** JSON-RPC request id for correlation */
  requestId: string | number | null;

  /** Full ExecutionContext v2 capsule (REQUIRED — never partial) */
  context: ExecutionContext;

  /** Event-specific payload */
  data?: Record<string, unknown>;

  /** Event-specific descriptive metadata */
  metadata?: Record<string, unknown>;

  /** ISO timestamp */
  timestamp?: string;
}

// ─── Event Data Shapes ────────────────────────────────────────────────

/**
 * Chunk event data — incremental output content.
 */
export interface ChunkEventData {
  /** The streamed content */
  content: unknown;

  /** Content type hint */
  contentType?: 'text' | 'markdown' | 'json';
}

/**
 * Progress event data — structured execution progress.
 */
export interface ProgressEventData {
  /** Current stage or step label */
  stage?: string;

  /** Human-readable progress message */
  message?: string;

  /** Progress percentage (0-100) */
  percent?: number;
}

/**
 * Output event data — structured partial output (more semantic than chunk).
 */
export interface OutputEventData {
  /** Output type */
  outputType: 'text' | 'markdown' | 'json' | 'image' | 'video' | 'audio' | 'artifact-ref';

  /** The output content */
  content: unknown;
}

/**
 * Error event data — streaming failure.
 */
export interface ErrorEventData {
  /** Error code */
  code?: string;

  /** Human-readable error message */
  message: string;

  /** Whether the caller may retry */
  retryable?: boolean;
}

// ─── Typed Stream Events ──────────────────────────────────────────────

/** Stream started event */
export type StartedEvent = StreamEvent & { event: 'started' };

/** Stream chunk event */
export type ChunkEvent = StreamEvent & { event: 'chunk'; data: ChunkEventData };

/** Stream progress event */
export type ProgressEvent = StreamEvent & { event: 'progress'; data: ProgressEventData };

/** Stream output event */
export type OutputEvent = StreamEvent & { event: 'output'; data: OutputEventData };

/** Stream completed event */
export type CompletedEvent = StreamEvent & { event: 'completed' };

/** Stream error event */
export type ErrorEvent = StreamEvent & { event: 'error'; data: ErrorEventData };

/**
 * Union of all typed stream events.
 */
export type TypedStreamEvent =
  | StartedEvent
  | ChunkEvent
  | ProgressEvent
  | OutputEvent
  | CompletedEvent
  | ErrorEvent;

// ─── SSE Transport ────────────────────────────────────────────────────

/**
 * SSE connection options for higher-level clients.
 */
export interface SSEConnectionOptions {
  /** Maximum reconnection attempts before giving up */
  maxReconnectAttempts?: number;

  /** Delay between reconnection attempts in milliseconds */
  reconnectDelay?: number;

  /** Initial connection timeout in milliseconds */
  timeout?: number;

  /** Enable verbose debug logging */
  debug?: boolean;
}

/**
 * SSE connection state.
 */
export type SSEConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'error';
