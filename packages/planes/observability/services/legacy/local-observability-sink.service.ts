/**
 * LocalObservabilitySinkService
 * Merged from apps/observability/server/src/observability/local-observability-sink.service.ts
 *
 * Persists events to the database and broadcasts via WebSocket gateway.
 */
import { Injectable, Inject } from '@nestjs/common';
import { ObservabilityDbService } from '../observability-db.service';
import type { HookEvent } from '../observability-types';
import { LegacyObservabilityGateway } from './legacy-observability.gateway';
import type { ObservabilitySink } from './observability-sink.interface';

@Injectable()
export class LocalObservabilitySinkService implements ObservabilitySink {
  constructor(
    @Inject(ObservabilityDbService) private readonly databaseService: ObservabilityDbService,
    @Inject(LegacyObservabilityGateway) private readonly gateway: LegacyObservabilityGateway,
  ) {}

  async emitEvent(event: HookEvent): Promise<HookEvent> {
    const savedEvent = await this.databaseService.insertEvent(event);
    this.gateway.broadcastEvent(savedEvent);
    return savedEvent;
  }
}
