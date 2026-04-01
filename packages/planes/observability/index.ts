/**
 * Observability Plane — public API
 *
 * Usage:
 *   import { OBSERVABILITY_SERVICE, ObservabilityServiceProvider } from '@orchestratorai/planes/observability';
 *
 *   @Inject(OBSERVABILITY_SERVICE) private readonly observability: ObservabilityServiceProvider
 */
export {
  OBSERVABILITY_SERVICE,
  type ObservabilityServiceProvider,
} from './observability.interface';

export { ObservabilityPlaneModule } from './observability.module';

export type {
  InvocationEventType,
  InvocationEvent,
  LLMUsageEvent,
  StreamCorrelation,
  ObservabilityEventRecord as PlaneObservabilityEventRecord,
} from './observability.types';

// ─── Full Implementation Services ──────────────────────────────────────
// These are the canonical implementations — products import from here.

export {
  ObservabilityEventsService,
  type ObservabilityEventRecord,
} from './services/observability-events.service';

export {
  ObservabilityWebhookService,
  type ObservabilityEvent,
} from './services/observability-webhook.service';

export { ObservabilityStreamController } from './services/observability-stream.controller';

export { ObservabilityDbService } from './services/observability-db.service';

// Legacy types (for backward compatibility)
export type {
  HookEvent,
  HookDataInput,
  FilterOptions,
  HumanInTheLoop,
  HumanInTheLoopResponse,
  HumanInTheLoopStatus,
  Theme,
  ThemeSearchQuery,
  ThemeColors,
  ThemeValidationError,
  ThemeExportData,
  ThemeImportData,
  ThemeStats,
  ApiResponse,
} from './services/observability-types';
