/**
 * LegacyObservabilityGateway
 * Merged from apps/observability/server/src/observability/observability.gateway.ts
 *
 * WebSocket gateway for the legacy observability client.
 * Broadcasts events to connected clients and sends initial event batch on connect.
 */
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ObservabilityDbService } from '../observability-db.service';
import type { HookEvent } from '../observability-types';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  path: '/observability-legacy/stream',
  transports: ['websocket', 'polling'],
})
export class LegacyObservabilityGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(LegacyObservabilityGateway.name);

  constructor(private readonly databaseService: ObservabilityDbService) {}

  afterInit(_server: Server) {
    this.logger.log('Legacy Observability WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);

    try {
      // Send recent events on connection
      const events = await this.databaseService.getRecentEvents(300);
      client.emit('message', JSON.stringify({ type: 'initial', data: events }));
    } catch (error) {
      this.logger.error('Error sending initial events:', error);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('message')
  handleMessage(client: Socket, payload: unknown): void {
    this.logger.log(`Received message from ${client.id}:`, payload);
  }

  broadcastEvent(event: HookEvent): void {
    const message = JSON.stringify({ type: 'event', data: event });
    this.server.emit('message', message);
  }
}
