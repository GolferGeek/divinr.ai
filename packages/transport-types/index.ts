/**
 * Transport Types V2
 *
 * Shared A2A contract for the platform. Defines the minimum common language
 * that all agentic products share: Compose, Forge, Bridge, Pulse.
 *
 * Structure:
 * - invocation/  — ExecutionContext v2, output types
 * - a2a/         — invoke request, response, streaming
 * - discovery/   — capability cards, well-known listing
 * - database/    — database plane interface
 * - shared/      — JSON value types
 */

// ============================================================================
// INVOCATION — EXECUTION CONTEXT V2
// ============================================================================
export type { ExecutionContext } from './invocation/execution-context';
export {
  NIL_UUID,
  isNilUuid,
  createExecutionContext,
  createMockExecutionContext,
  isExecutionContext,
} from './invocation/execution-context';

// ============================================================================
// INVOCATION — OUTPUT TYPES
// ============================================================================
export type {
  OutputType,
  ContentType,
} from './invocation/output-types';

// ============================================================================
// A2A — INVOKE REQUEST
// ============================================================================
export type {
  InvokeData,
  InvokeParams,
  A2AInvokeRequest,
} from './a2a/request.types';

// ============================================================================
// A2A — INVOKE RESPONSE
// ============================================================================
export type {
  InvokeOutput,
  InvokeResult,
  InvokeError,
  A2AInvokeSuccessResponse,
  A2AInvokeErrorResponse,
  A2AInvokeResponse,
} from './a2a/response.types';

// ============================================================================
// A2A — STREAMING
// ============================================================================
export type {
  StreamEventType,
  StreamEvent,
  ChunkEventData,
  ProgressEventData,
  OutputEventData,
  ErrorEventData,
  StartedEvent,
  ChunkEvent,
  ProgressEvent,
  OutputEvent,
  CompletedEvent,
  ErrorEvent,
  TypedStreamEvent,
  SSEConnectionOptions,
  SSEConnectionState,
} from './a2a/stream.types';

// ============================================================================
// DISCOVERY — CAPABILITY CARDS
// ============================================================================
export type {
  CapabilityInvokeDescriptor,
  CapabilityCard,
} from './discovery/agent-card.types';

export type {
  WellKnownEntry,
  WellKnownListing,
} from './discovery/well-known.types';

export { isCapabilityCard } from './discovery/well-known.types';

// ============================================================================
// DATABASE ABSTRACTION
// ============================================================================
export {
  DATABASE_SERVICE,
  type QueryResult,
  type QueryBuilder,
  type DatabaseService,
} from './database';

// ============================================================================
// JSON VALUE TYPES
// ============================================================================
export type {
  JsonPrimitive,
  JsonValue,
  JsonArray,
  JsonObject,
} from './shared/json.types';

// ============================================================================
// ERROR CODES
// ============================================================================
export {
  JsonRpcErrorCode,
  A2AErrorCode,
} from './shared/enums';

// ============================================================================
// PRODUCT REGISTRY
// ============================================================================
export type {
  ProductSlug,
  ProductCategory,
  ProductDefinition,
  ProductDisplayOverride,
  PresetName,
} from './products/product-registry';

export {
  PRODUCT_REGISTRY,
  PRODUCT_SLUGS,
  PRODUCT_CATEGORIES,
  getProduct,
  getProductDisplayName,
  getAllProducts,
  getProductsByCategory,
  setActivePreset,
  getActivePreset,
} from './products/product-registry';

// ============================================================================
// TYPE GUARDS
// ============================================================================

import type { A2AInvokeRequest } from './a2a/request.types';
import type {
  A2AInvokeSuccessResponse,
  A2AInvokeErrorResponse,
} from './a2a/response.types';

export function isA2AInvokeRequest(obj: unknown): obj is A2AInvokeRequest {
  if (typeof obj !== 'object' || obj === null) return false;
  const candidate = obj as Record<string, unknown>;
  return (
    candidate.jsonrpc === '2.0' &&
    candidate.method === 'invoke' &&
    typeof candidate.params === 'object' &&
    candidate.params !== null &&
    'id' in candidate
  );
}

export function isA2AInvokeSuccessResponse(obj: unknown): obj is A2AInvokeSuccessResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const candidate = obj as Record<string, unknown>;
  return (
    candidate.jsonrpc === '2.0' &&
    'result' in candidate &&
    'id' in candidate
  );
}

export function isA2AInvokeErrorResponse(obj: unknown): obj is A2AInvokeErrorResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const candidate = obj as Record<string, unknown>;
  return (
    candidate.jsonrpc === '2.0' &&
    'error' in candidate &&
    'id' in candidate
  );
}
