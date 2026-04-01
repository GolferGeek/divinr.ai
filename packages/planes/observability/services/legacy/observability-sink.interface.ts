/**
 * ObservabilitySink — abstraction for event ingestion.
 * Merged from apps/observability/server/src/observability/observability-sink.interface.ts
 *
 * Selected by OBSERVABILITY_SINK_PROVIDER env var (local | azure_monitor).
 */
import type { HookEvent } from '../observability-types';

export interface ObservabilitySink {
  emitEvent(event: HookEvent): Promise<HookEvent>;
}

export const OBSERVABILITY_SINK = Symbol('OBSERVABILITY_SINK');
