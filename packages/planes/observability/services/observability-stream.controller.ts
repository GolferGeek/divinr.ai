import { Controller, Get, Res, Logger, Query, Inject, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import {
  ObservabilityEventsService,
  ObservabilityEventRecord,
} from './observability-events.service';
import { Subscription } from 'rxjs';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RbacGuard } from '../../rbac/guards/rbac.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';

/**
 * Observability Stream Controller
 *
 * Provides admin-only SSE endpoint for real-time monitoring of all agent executions.
 * Broadcasts all observability events to connected admin clients.
 *
 * Events flow through ObservabilityEventsService (RxJS ReplaySubject buffer).
 * All event producers must push to that service for events to appear here.
 *
 * Endpoint: GET /observability/stream
 * Auth: Requires admin:audit permission
 * Response: Server-Sent Events stream
 */
@Controller('observability')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ObservabilityStreamController {
  private readonly logger = new Logger(ObservabilityStreamController.name);

  constructor(
    @Inject(ObservabilityEventsService) private readonly observabilityEvents: ObservabilityEventsService,
  ) {}

  /**
   * Stream all observability events to clients
   * GET /observability/stream
   *
   * Optional query params for filtering:
   * - filterUserId: Filter by user ID
   * - filterAgentSlug: Filter by agent
   * - filterConversationId: Filter by conversation
   *
   */
  @Get('stream')
  @RequirePermission('admin:audit')
  streamEvents(
    @Res() response: Response,
    @Query('userId') filterUserId?: string,
    @Query('agentSlug') filterAgentSlug?: string,
    @Query('conversationId') filterConversationId?: string,
  ): void {
    this.logger.debug('🔌 Admin connected to observability stream');
    this.logger.debug(
      `📋 Filters: userId=${filterUserId || 'none'}, agentSlug=${filterAgentSlug || 'none'}, conversationId=${filterConversationId || 'none'}`,
    );

    // Set SSE headers
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || 'http://localhost:7101');
    response.setHeader('X-Accel-Buffering', 'no');

    // Send initial connection confirmation
    const connectionEvent = {
      event_type: 'connected',
      message: 'Observability stream connected',
    };
    response.write(`data: ${JSON.stringify(connectionEvent)}\n\n`);
    this.logger.debug('📡 SSE connection established, sent connection event');

    // Send buffered events from ReplaySubject (recent in-memory events)
    const bufferedEvents = this.observabilityEvents.getSnapshot();
    if (bufferedEvents.length > 0) {
      // Filter buffered events by active filters
      const filteredBuffered = bufferedEvents.filter((e) => {
        if (
          filterConversationId &&
          e.context.conversationId !== filterConversationId
        )
          return false;
        if (filterUserId && e.context.userId !== filterUserId) return false;
        if (filterAgentSlug && e.context.agentSlug !== filterAgentSlug)
          return false;
        return true;
      });

      for (const event of filteredBuffered) {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      this.logger.debug(
        `📦 Sent ${filteredBuffered.length}/${bufferedEvents.length} buffered events (filtered by conversationId: ${filterConversationId || 'none'})`,
      );
    }

    // Subscribe to live observability stream (RxJS-based)
    this.logger.debug(
      `📡 Subscribing to ObservabilityEventsService. Current buffer size: ${this.observabilityEvents.getSnapshot().length}`,
    );

    const subscription: Subscription =
      this.observabilityEvents.events$.subscribe({
        next: (event) => {
          this.logger.debug(
            `📨 Received event: ${event.hook_event_type} for conversation ${event.context.conversationId || 'none'}`,
          );

          // Apply query param filters
          if (filterUserId && event.context.userId !== filterUserId) {
            this.logger.debug(`📨 Filtered out - userId mismatch`);
            return;
          }
          if (filterAgentSlug && event.context.agentSlug !== filterAgentSlug) {
            this.logger.debug(`📨 Filtered out - agentSlug mismatch`);
            return;
          }
          if (
            filterConversationId &&
            event.context.conversationId !== filterConversationId
          ) {
            this.logger.debug(
              `📨 Filtered out - conversationId mismatch: event=${event.context.conversationId}, filter=${filterConversationId}`,
            );
            return;
          }
          this.logger.debug(`✅ Event passed filters, writing to stream`);
          this.writeEvent(response, event);
        },
        error: (error) => {
          this.logger.error(
            `❌ Subscription error: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      });

    // Send heartbeat every 30 seconds
    const heartbeatInterval = setInterval(() => {
      try {
        response.write(': heartbeat\n\n');
      } catch {
        this.logger.warn('Failed to send heartbeat, client disconnected');
        clearInterval(heartbeatInterval);
      }
    }, 30000);

    // Handle client disconnect
    response.on('close', () => {
      this.logger.debug('🔌 Admin disconnected from observability stream');
      clearInterval(heartbeatInterval);
      subscription.unsubscribe();
    });
  }

  private writeEvent(
    response: Response,
    event: ObservabilityEventRecord,
  ): void {
    try {
      const eventJson = JSON.stringify(event);
      this.logger.debug(
        `✍️ Writing event: ${event.hook_event_type} (${eventJson.length} bytes)`,
      );
      response.write(`data: ${eventJson}\n\n`);
      this.logger.debug(`✅ Event written successfully`);
    } catch (error) {
      this.logger.error(`❌ Failed to write event to stream:`, error);
    }
  }

  /**
   * Get historical events from database
   * GET /observability/history?since=<timestamp>&until=<timestamp>&limit=<number>
   *
   * Query params:
   * - since: Unix timestamp (ms) - defaults to 1 hour ago
   * - until: Unix timestamp (ms) - defaults to now (optional end time for custom ranges)
   * - limit: Max events to return (default 1000, max 5000)
   */
  @Get('history')
  @RequirePermission('admin:audit')
  async getHistory(
    @Query('since') sinceParam?: string,
    @Query('until') untilParam?: string,
    @Query('limit') limitParam?: string,
  ): Promise<{ events: ObservabilityEventRecord[]; count: number }> {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const since = sinceParam ? parseInt(sinceParam, 10) : oneHourAgo;
    const until = untilParam ? parseInt(untilParam, 10) : undefined;
    const limit = Math.min(
      Math.max(parseInt(limitParam || '1000', 10), 1),
      5000,
    );

    this.logger.log(
      `📚 Fetching historical events since ${new Date(since).toISOString()}${until ? ` until ${new Date(until).toISOString()}` : ''}, limit ${limit}`,
    );

    const events = await this.observabilityEvents.getHistoricalEvents(
      since,
      limit,
      until,
    );

    this.logger.log(`📚 Found ${events.length} historical events`);

    return {
      events,
      count: events.length,
    };
  }
}
