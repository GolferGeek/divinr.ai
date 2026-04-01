/**
 * Well-Known Discovery V2
 *
 * Types for the well-known capability listing endpoint.
 * Exposes the set of discoverable capabilities with summary-level metadata.
 */

import type { CapabilityCard } from './agent-card.types';

/**
 * Summary entry in a well-known listing — a lightweight view
 * of a capability for discovery without full card detail.
 */
export interface WellKnownEntry {
  /** Capability slug */
  slug: string;

  /** Display name */
  name: string;

  /** Short description */
  description?: string;

  /** High-level classification */
  kind: string;

  /** Whether the capability supports streaming */
  streaming?: boolean;

  /** Common output types */
  outputTypes?: string[];
}

/**
 * Well-known listing response — the full set of discoverable capabilities.
 */
export interface WellKnownListing {
  /** Product or service identifier */
  product: string;

  /** Version of the discovery contract */
  version: string;

  /** Discoverable capabilities */
  capabilities: WellKnownEntry[];
}

/**
 * Type guard to check if an object is a valid CapabilityCard.
 */
export function isCapabilityCard(obj: unknown): obj is CapabilityCard {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.slug === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.kind === 'string' &&
    typeof candidate.discoverable === 'boolean' &&
    typeof candidate.invoke === 'object' &&
    candidate.invoke !== null
  );
}
