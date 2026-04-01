/**
 * Discovery / Capability Card V2
 *
 * Lean shared discovery model for all products. Bridge may extend
 * beyond the shared core for external interoperability.
 */

/**
 * Invocation descriptor embedded in a capability card.
 * Tells consumers how to invoke this capability through the shared A2A contract.
 */
export interface CapabilityInvokeDescriptor {
  /** Method name — always "invoke" for the shared contract */
  method: 'invoke';

  /** Accepted input content types */
  inputTypes?: string[];

  /** Common output content types */
  outputTypes?: string[];

  /** Whether the capability supports streaming */
  streaming?: boolean;
}

/**
 * Shared capability card — identifies a capability or agent
 * in a way that is useful across products.
 */
export interface CapabilityCard {
  /** Stable unique identifier */
  id: string;

  /** Human-meaningful stable routing/discovery identifier */
  slug: string;

  /** Display label */
  name: string;

  /** Short explanation of what the capability does */
  description?: string;

  /** High-level classification (context, rag, api, external, media, capability, workflow, automation) */
  kind: string;

  /** Whether the capability should appear in discovery output */
  discoverable: boolean;

  /** Invocation metadata */
  invoke: CapabilityInvokeDescriptor;

  /** Expected or supported output types */
  outputTypes?: string[];

  /** Product-neutral descriptive metadata */
  metadata?: Record<string, unknown>;
}
