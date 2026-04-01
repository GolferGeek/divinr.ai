/**
 * Transport Types — type guard unit tests
 *
 * Tests isA2AInvokeRequest, isA2AInvokeSuccessResponse,
 * isA2AInvokeErrorResponse, isExecutionContext, and isCapabilityCard.
 * All functions are pure — no mocks needed.
 */

import {
  isA2AInvokeRequest,
  isA2AInvokeSuccessResponse,
  isA2AInvokeErrorResponse,
  isExecutionContext,
  createMockExecutionContext,
  NIL_UUID,
} from './index';
import { isCapabilityCard } from './discovery/well-known.types';

// ─── isA2AInvokeRequest ──────────────────────────────────────────────────────

describe('isA2AInvokeRequest', () => {
  it('returns true for a valid A2AInvokeRequest', () => {
    const request = {
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'invoke',
      params: {
        context: createMockExecutionContext(),
        data: { content: 'hello' },
      },
    };
    expect(isA2AInvokeRequest(request)).toBe(true);
  });

  it('returns false when jsonrpc is not 2.0', () => {
    expect(isA2AInvokeRequest({ jsonrpc: '1.0', method: 'invoke', params: {}, id: 1 })).toBe(false);
  });

  it('returns false when method is not invoke', () => {
    expect(isA2AInvokeRequest({ jsonrpc: '2.0', method: 'query', params: {}, id: 1 })).toBe(false);
  });

  it('returns false for null and non-objects', () => {
    expect(isA2AInvokeRequest(null)).toBe(false);
    expect(isA2AInvokeRequest('string')).toBe(false);
    expect(isA2AInvokeRequest(42)).toBe(false);
  });
});

// ─── isA2AInvokeSuccessResponse ──────────────────────────────────────────────

describe('isA2AInvokeSuccessResponse', () => {
  it('returns true for a valid success response', () => {
    const response = {
      jsonrpc: '2.0',
      id: 'req-1',
      result: { success: true, output: { content: 'ok', outputType: 'text' } },
    };
    expect(isA2AInvokeSuccessResponse(response)).toBe(true);
  });

  it('returns false when result field is missing', () => {
    expect(isA2AInvokeSuccessResponse({ jsonrpc: '2.0', id: 1 })).toBe(false);
  });

  it('returns false for an error response (has error, not result)', () => {
    const errorResponse = { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'bad' } };
    // has id and jsonrpc=2.0 but no result
    expect(isA2AInvokeSuccessResponse(errorResponse)).toBe(false);
  });
});

// ─── isA2AInvokeErrorResponse ────────────────────────────────────────────────

describe('isA2AInvokeErrorResponse', () => {
  it('returns true for a valid error response', () => {
    const response = {
      jsonrpc: '2.0',
      id: 'req-1',
      error: { code: -32603, message: 'Internal error' },
    };
    expect(isA2AInvokeErrorResponse(response)).toBe(true);
  });

  it('returns false when error field is missing', () => {
    expect(isA2AInvokeErrorResponse({ jsonrpc: '2.0', id: 1 })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isA2AInvokeErrorResponse(null)).toBe(false);
  });
});

// ─── isExecutionContext ──────────────────────────────────────────────────────

describe('isExecutionContext', () => {
  it('returns true for a valid ExecutionContext created by createMockExecutionContext', () => {
    const ctx = createMockExecutionContext();
    expect(isExecutionContext(ctx)).toBe(true);
  });

  it('returns true for a system-triggered context with NIL_UUID userId', () => {
    const ctx = createMockExecutionContext({ userId: NIL_UUID, agentType: 'system' });
    expect(isExecutionContext(ctx)).toBe(true);
  });

  it('returns false when required fields are missing', () => {
    expect(isExecutionContext({ orgSlug: 'acme' })).toBe(false);
    expect(isExecutionContext(null)).toBe(false);
  });

  it('returns false when a required string field is the wrong type', () => {
    const bad = { ...createMockExecutionContext(), userId: 12345 };
    expect(isExecutionContext(bad)).toBe(false);
  });
});

// ─── isCapabilityCard ────────────────────────────────────────────────────────

describe('isCapabilityCard', () => {
  it('returns true for a valid CapabilityCard', () => {
    const card = {
      id: 'cap-1',
      slug: 'marketing-swarm',
      name: 'Marketing Swarm',
      kind: 'workflow',
      discoverable: true,
      invoke: { method: 'invoke' },
    };
    expect(isCapabilityCard(card)).toBe(true);
  });

  it('returns false when required string fields are missing', () => {
    expect(isCapabilityCard({ slug: 'test', name: 'Test' })).toBe(false);
  });

  it('returns false when discoverable is not a boolean', () => {
    const bad = { id: 'c', slug: 's', name: 'N', kind: 'k', discoverable: 'yes', invoke: {} };
    expect(isCapabilityCard(bad)).toBe(false);
  });

  it('returns false for null and primitives', () => {
    expect(isCapabilityCard(null)).toBe(false);
    expect(isCapabilityCard('string')).toBe(false);
  });
});
