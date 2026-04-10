/**
 * Console Observability Provider
 *
 * Lightweight implementation for development and testing.
 * Logs events to console and maintains an in-memory buffer.
 * No database persistence.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import type { ExecutionContext } from '@orchestrator-ai/transport-types';
import type { ObservabilityServiceProvider } from '../observability.interface';
import type {
  InvocationEvent,
  LLMUsageEvent,
  StreamCorrelation,
  ObservabilityEventRecord,
} from '../observability.types';

@Injectable()
export class ConsoleObservabilityService implements ObservabilityServiceProvider {
  private readonly logger = new Logger(ConsoleObservabilityService.name);
  private readonly subject = new Subject<ObservabilityEventRecord>();
  private readonly buffer: ObservabilityEventRecord[] = [];
  private readonly bufferSize = 200;

  async emitInvocationEvent(
    context: ExecutionContext,
    event: InvocationEvent,
  ): Promise<void> {
    this.logger.log(
      `[${event.type}] ${context.agentSlug} | ${event.message || ''} | user=${context.userId}`,
    );

    this.pushToBuffer({
      context,
      sourceApp: event.sourceApp,
      eventType: event.type,
      status: event.type.split('.').pop() || 'unknown',
      message: event.message,
      progress: event.progress,
      step: event.step,
      payload: { ...event.payload, success: event.success, error: event.error, duration: event.duration },
      timestamp: Date.now(),
    });
  }

  async recordLLMUsage(
    context: ExecutionContext,
    usage: LLMUsageEvent,
  ): Promise<void> {
    this.logger.log(
      `[llm.usage] ${usage.provider}/${usage.model} | tokens=${usage.totalTokens || 0} cost=$${usage.costUsd?.toFixed(4) || '?'} | ${usage.success ? 'ok' : 'FAILED'} | agent=${context.agentSlug}`,
    );

    this.pushToBuffer({
      context,
      sourceApp: 'llm-plane',
      eventType: 'llm.usage',
      status: usage.success ? 'completed' : 'failed',
      payload: { provider: usage.provider, model: usage.model, totalTokens: usage.totalTokens, costUsd: usage.costUsd },
      timestamp: Date.now(),
    });
  }

  async registerStream(
    context: ExecutionContext,
    correlation: StreamCorrelation,
  ): Promise<void> {
    this.logger.log(
      `[stream.registered] requestId=${String(correlation.requestId)} streamId=${correlation.streamId} | agent=${context.agentSlug}`,
    );
  }

  async emitStreamEvent(
    context: ExecutionContext,
    requestId: string | number | null,
    eventType: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    this.logger.debug(
      `[stream.${eventType}] requestId=${String(requestId)} | agent=${context.agentSlug}`,
    );
  }

  getRecentEvents(limit?: number): ObservabilityEventRecord[] {
    if (limit) {
      return this.buffer.slice(-limit);
    }
    return [...this.buffer];
  }

  getEventStream(): Observable<ObservabilityEventRecord> {
    return this.subject.asObservable();
  }

  async getHistoricalEvents(): Promise<ObservabilityEventRecord[]> {
    return [...this.buffer];
  }

  private pushToBuffer(record: ObservabilityEventRecord): void {
    this.buffer.push(record);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
    }
    this.subject.next(record);
  }
}
