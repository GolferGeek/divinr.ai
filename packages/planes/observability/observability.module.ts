/**
 * Observability Plane Module
 *
 * @Global() module providing OBSERVABILITY_SERVICE plus the full
 * observability implementation: events buffer, webhook forwarding,
 * SSE streaming, and legacy DB services.
 *
 * Selected by OBSERVABILITY_PROVIDER env var:
 *   - supabase (default): Supabase-backed persistence + in-memory buffer
 *   - console: Console-only logging for development/testing
 */

import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { OBSERVABILITY_SERVICE } from './observability.interface';
import { SupabaseObservabilityService } from './providers/supabase-observability.service';
import { ConsoleObservabilityService } from './providers/console-observability.service';
import { ObservabilityEventsService } from './services/observability-events.service';
import { ObservabilityWebhookService } from './services/observability-webhook.service';
import { ObservabilityStreamController } from './services/observability-stream.controller';
import { ObservabilityDbService } from './services/observability-db.service';

const logger = new Logger('ObservabilityPlaneModule');

@Global()
@Module({
  imports: [ConfigModule, HttpModule],
  controllers: [ObservabilityStreamController],
  providers: [
    SupabaseObservabilityService,
    ConsoleObservabilityService,
    ObservabilityEventsService,
    ObservabilityWebhookService,
    ObservabilityDbService,
    {
      provide: OBSERVABILITY_SERVICE,
      useFactory: (
        supabaseService: SupabaseObservabilityService,
        consoleService: ConsoleObservabilityService,
      ) => {
        const provider = process.env.OBSERVABILITY_PROVIDER || 'supabase';
        logger.log(`Observability plane provider: ${provider}`);
        switch (provider) {
          case 'supabase':
            return supabaseService;
          case 'console':
            return consoleService;
          default:
            throw new Error(
              `Unsupported OBSERVABILITY_PROVIDER '${provider}'. Expected: supabase, console`,
            );
        }
      },
      inject: [SupabaseObservabilityService, ConsoleObservabilityService],
    },
  ],
  exports: [
    OBSERVABILITY_SERVICE,
    ObservabilityEventsService,
    ObservabilityWebhookService,
    ObservabilityDbService,
  ],
})
export class ObservabilityPlaneModule {}
