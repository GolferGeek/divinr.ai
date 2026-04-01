/**
 * LegacyObservabilityModule
 *
 * Merged from apps/observability/server — provides the original
 * hook-based event ingestion, WebSocket broadcasting, HITL relay,
 * and theme management endpoints.
 *
 * Routes are namespaced under /observability-legacy/ to avoid
 * conflicts with the current /observability/ SSE-based system.
 */
import { Module } from '@nestjs/common';
import { ObservabilityDbService } from '../observability-db.service';
import { LegacyObservabilityController } from './legacy-observability.controller';
import { LegacyObservabilityGateway } from './legacy-observability.gateway';
import { LegacyHitlRelayService } from './legacy-hitl-relay.service';
import { LocalObservabilitySinkService } from './local-observability-sink.service';
import { OBSERVABILITY_SINK } from './observability-sink.interface';
import { LegacyThemesController } from './legacy-themes.controller';
import { LegacyThemesService } from './legacy-themes.service';

@Module({
  controllers: [LegacyObservabilityController, LegacyThemesController],
  providers: [
    ObservabilityDbService,
    LegacyObservabilityGateway,
    LegacyHitlRelayService,
    LocalObservabilitySinkService,
    LegacyThemesService,
    {
      provide: OBSERVABILITY_SINK,
      useFactory: (localSink: LocalObservabilitySinkService) => {
        const provider = process.env.OBSERVABILITY_SINK_PROVIDER || 'local';

        switch (provider) {
          case 'local':
            return localSink;
          case 'azure_monitor':
            throw new Error(
              'OBSERVABILITY_SINK_PROVIDER=azure_monitor is not implemented yet.',
            );
          default:
            throw new Error(
              `Unsupported OBSERVABILITY_SINK_PROVIDER '${provider}'. Allowed values: local, azure_monitor`,
            );
        }
      },
      inject: [LocalObservabilitySinkService],
    },
  ],
  exports: [ObservabilityDbService],
})
export class LegacyObservabilityModule {}
