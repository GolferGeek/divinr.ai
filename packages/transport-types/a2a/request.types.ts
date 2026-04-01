/**
 * A2A Invoke Request V2
 *
 * Single shared invoke contract. Replaces the old mode/action matrix
 * with a simple { context, data, metadata? } params shape.
 */

import type { ExecutionContext } from '../invocation/execution-context';
import type { ContentType } from '../invocation/output-types';

/**
 * The business payload for a capability invocation.
 */
export interface InvokeData {
  /** The input content for the invocation */
  content: unknown;

  /** Content type hint for the input */
  contentType?: ContentType;
}

/**
 * Invoke request parameters — the params field of the JSON-RPC request.
 */
export interface InvokeParams {
  /** ExecutionContext v2 capsule (REQUIRED) */
  context: ExecutionContext;

  /** Business data payload (REQUIRED) */
  data: InvokeData;

  /** Per-call optional metadata (streaming hints, idempotency, caller hints) */
  metadata?: Record<string, unknown>;
}

/**
 * Complete A2A invoke request (JSON-RPC 2.0).
 */
export interface A2AInvokeRequest {
  /** JSON-RPC version (always "2.0") */
  jsonrpc: '2.0';

  /** Request identifier */
  id: string | number | null;

  /** Method name — always "invoke" for the shared contract */
  method: 'invoke';

  /** Invoke parameters */
  params: InvokeParams;
}
