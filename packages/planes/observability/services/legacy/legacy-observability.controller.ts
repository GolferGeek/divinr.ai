/**
 * LegacyObservabilityController
 * Merged from apps/observability/server/src/observability/observability.controller.ts
 *
 * Provides the original hook/event endpoints for the observability client:
 *   POST /observability-legacy/hooks
 *   POST /observability-legacy/events
 *   GET  /observability-legacy/events/filter-options
 *   GET  /observability-legacy/events/recent
 *   POST /observability-legacy/events/:id/respond
 */
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ObservabilityDbService } from '../observability-db.service';
import { LegacyHitlRelayService } from './legacy-hitl-relay.service';
import { LegacyObservabilityGateway } from './legacy-observability.gateway';
import type {
  HookEvent,
  HookDataInput,
  HumanInTheLoopResponse,
} from '../observability-types';
import {
  OBSERVABILITY_SINK,
  ObservabilitySink,
} from './observability-sink.interface';

@Controller('observability-legacy')
export class LegacyObservabilityController {
  private readonly logger = new Logger(LegacyObservabilityController.name);

  constructor(
    private readonly databaseService: ObservabilityDbService,
    private readonly gateway: LegacyObservabilityGateway,
    private readonly hitlRelayService: LegacyHitlRelayService,
    @Inject(OBSERVABILITY_SINK)
    private readonly observabilitySink: ObservabilitySink,
  ) {}

  @Get()
  getRoot() {
    return 'Multi-Agent Observability Server (merged into API)';
  }

  @Post('hooks')
  @HttpCode(HttpStatus.OK)
  async handleHook(@Body() hookData: HookDataInput) {
    try {
      // Extract session_id with proper type handling
      const sessionIdFromPayload = hookData.payload?.session_id;
      const sessionId: string =
        hookData.session_id ||
        hookData.sessionId ||
        (typeof sessionIdFromPayload === 'string'
          ? sessionIdFromPayload
          : null) ||
        'unknown';

      // Ensure payload is Record<string, unknown>
      const payload: Record<string, unknown> = hookData.payload || {};

      const event: HookEvent = {
        source_app: hookData.source_app || hookData.sourceApp || 'unknown',
        session_id: sessionId,
        hook_event_type:
          hookData.event_type ||
          hookData.hook_event_type ||
          hookData.eventType ||
          'Unknown',
        payload,
        timestamp: hookData.timestamp || Date.now(),
        summary: hookData.summary,
        chat: hookData.chat,
        model_name: hookData.model_name || hookData.modelName,
      };

      const savedEvent = await this.observabilitySink.emitEvent(event);

      return { success: true, id: savedEvent.id };
    } catch (error) {
      this.logger.error('Error processing hook:', error);
      // Always return 200 to not block hooks
      return { success: false, error: 'Failed to process hook' };
    }
  }

  @Post('events')
  async createEvent(@Body() event: HookEvent) {
    if (
      !event.source_app ||
      !event.session_id ||
      !event.hook_event_type ||
      !event.payload
    ) {
      throw new BadRequestException('Missing required fields');
    }

    const savedEvent = await this.observabilitySink.emitEvent(event);

    return savedEvent;
  }

  @Get('events/filter-options')
  async getFilterOptions() {
    return this.databaseService.getFilterOptions();
  }

  @Get('events/recent')
  async getRecentEvents(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit) : 300;
    return this.databaseService.getRecentEvents(limitNum);
  }

  @Post('events/:id/respond')
  async respondToEvent(
    @Param('id') id: string,
    @Body() response: HumanInTheLoopResponse,
  ) {
    const eventId = parseInt(id);
    response.respondedAt = Date.now();

    const updatedEvent = await this.databaseService.updateEventHITLResponse(
      eventId,
      response,
    );

    if (!updatedEvent) {
      throw new NotFoundException('Event not found');
    }

    // Send response to agent via WebSocket
    if (updatedEvent.humanInTheLoop?.responseWebSocketUrl) {
      try {
        await this.hitlRelayService.sendResponseToAgent(
          updatedEvent.humanInTheLoop.responseWebSocketUrl,
          response,
        );
      } catch (error) {
        this.logger.error('Failed to send response to agent:', error);
        // Don't fail the request if we can't reach the agent
      }
    }

    // Broadcast updated event to all connected clients
    this.gateway.broadcastEvent(updatedEvent);

    return updatedEvent;
  }
}
