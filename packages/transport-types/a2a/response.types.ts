/**
 * A2A Invoke Response V2
 *
 * Typed output response envelope. Replaces old mode-based response
 * with explicit output typing and lean metadata.
 */

import type { ExecutionContext } from '../invocation/execution-context';
import type { OutputType } from '../invocation/output-types';

/**
 * The typed output of a capability invocation.
 */
export interface InvokeOutput {
  /** The output content */
  content: unknown;

  /** The type of content returned */
  outputType: OutputType;

  /** Output-specific metadata (e.g., dimensions for images, schema for JSON) */
  metadata?: Record<string, unknown>;
}

/**
 * Invoke success result — the result field of a JSON-RPC success response.
 */
export interface InvokeResult {
  /** Always true for success */
  success: true;

  /** The typed output */
  output: InvokeOutput;

  /** Response metadata (usage stats, routing decisions, timing) */
  metadata?: Record<string, unknown>;

  /** Returned context (optional — backend may echo context for frontend sync) */
  context?: ExecutionContext;
}

/**
 * Invoke error data — structured application-level error detail.
 */
export interface InvokeError {
  /** JSON-RPC error code */
  code: number;

  /** Human-readable error message */
  message: string;

  /** Additional structured error detail */
  data?: {
    errorType?: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
}

/**
 * Complete A2A invoke success response (JSON-RPC 2.0).
 */
export interface A2AInvokeSuccessResponse {
  /** JSON-RPC version (always "2.0") */
  jsonrpc: '2.0';

  /** Request identifier (matches request) */
  id: string | number | null;

  /** Invoke success result */
  result: InvokeResult;
}

/**
 * Complete A2A invoke error response (JSON-RPC 2.0).
 */
export interface A2AInvokeErrorResponse {
  /** JSON-RPC version (always "2.0") */
  jsonrpc: '2.0';

  /** Request identifier (matches request) */
  id: string | number | null;

  /** Invoke error detail */
  error: InvokeError;
}

/**
 * A2A invoke response (success or error).
 */
export type A2AInvokeResponse = A2AInvokeSuccessResponse | A2AInvokeErrorResponse;
