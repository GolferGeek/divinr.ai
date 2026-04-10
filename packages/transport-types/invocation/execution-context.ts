/**
 * ExecutionContext V2 - The lean execution identity capsule.
 *
 * Created at the edge (frontend or ingress), passed whole through:
 * - API controllers
 * - Services and runners
 * - LangGraph workflows
 * - Observability and streaming emitters
 *
 * Rules:
 * 1. Pass whole — never destructure into individual fields for downstream calls
 * 2. Never construct in the backend — originates from edge/frontend
 * 3. Never mutate mid-flight
 * 4. Every LLM call receives it
 * 5. Every observability path receives it
 */

/**
 * Nil UUID - used when no entity exists for a field.
 * Standard "zero UUID" per RFC 4122.
 */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Check if a UUID is the nil UUID (no entity).
 */
export function isNilUuid(uuid: string): boolean {
  return uuid === NIL_UUID;
}

/**
 * ExecutionContext V2 - the shared execution identity capsule.
 *
 * Carries identity, tracing, observability, and provider/model attribution
 * for every A2A invocation. Product-specific workflow state (taskId, planId,
 * deliverableId) is no longer part of the shared core.
 */
export interface ExecutionContext {
  /** User ID (from auth) — attribution, auditability */
  userId: string;

  /** Conversation ID — the primary continuity boundary */
  conversationId: string;

  /** Agent slug — which agent definition or capability was invoked */
  agentSlug: string;

  /** Agent type (e.g., 'context', 'rag', 'api', 'external', 'media', 'capability', 'workflow') */
  agentType: string;

  /** LLM provider (e.g., 'openai', 'anthropic', 'ollama', 'google') */
  provider: string;

  /** LLM model identifier (e.g., 'gpt-4', 'claude-sonnet-4-20250514') */
  model: string;

  /** Sovereign mode — when true, only local providers (e.g., Ollama) are allowed */
  sovereignMode?: boolean;
}

/**
 * Create a complete execution context with all required fields.
 */
export function createExecutionContext(params: {
  userId: string;
  conversationId: string;
  agentSlug: string;
  agentType: string;
  provider: string;
  model: string;
  sovereignMode?: boolean;
}): ExecutionContext {
  return { ...params };
}

/**
 * Create a mock execution context for testing.
 */
export function createMockExecutionContext(
  overrides?: Partial<ExecutionContext>,
): ExecutionContext {
  return {
    userId: 'test-user-id',
    conversationId: 'test-conversation-id',
    agentSlug: 'test-agent',
    agentType: 'context',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    ...overrides,
  };
}

/**
 * Type guard to check if an object is a valid ExecutionContext.
 */
export function isExecutionContext(obj: unknown): obj is ExecutionContext {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  return (
    typeof candidate.userId === 'string' &&
    typeof candidate.conversationId === 'string' &&
    typeof candidate.agentSlug === 'string' &&
    typeof candidate.agentType === 'string' &&
    typeof candidate.provider === 'string' &&
    typeof candidate.model === 'string'
  );
}
