"use strict";
/**
 * Console Observability Provider
 *
 * Lightweight implementation for development and testing.
 * Logs events to console and maintains an in-memory buffer.
 * No database persistence.
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var ConsoleObservabilityService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsoleObservabilityService = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
let ConsoleObservabilityService = ConsoleObservabilityService_1 = class ConsoleObservabilityService {
    logger = new common_1.Logger(ConsoleObservabilityService_1.name);
    subject = new rxjs_1.Subject();
    buffer = [];
    bufferSize = 200;
    async emitInvocationEvent(context, event) {
        this.logger.log(`[${event.type}] ${context.agentSlug} | ${event.message || ''} | org=${context.orgSlug} user=${context.userId}`);
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
    async recordLLMUsage(context, usage) {
        this.logger.log(`[llm.usage] ${usage.provider}/${usage.model} | tokens=${usage.totalTokens || 0} cost=$${usage.costUsd?.toFixed(4) || '?'} | ${usage.success ? 'ok' : 'FAILED'} | agent=${context.agentSlug}`);
        this.pushToBuffer({
            context,
            sourceApp: 'llm-plane',
            eventType: 'llm.usage',
            status: usage.success ? 'completed' : 'failed',
            payload: { provider: usage.provider, model: usage.model, totalTokens: usage.totalTokens, costUsd: usage.costUsd },
            timestamp: Date.now(),
        });
    }
    async registerStream(context, correlation) {
        this.logger.log(`[stream.registered] requestId=${String(correlation.requestId)} streamId=${correlation.streamId} | agent=${context.agentSlug}`);
    }
    async emitStreamEvent(context, requestId, eventType, data) {
        this.logger.debug(`[stream.${eventType}] requestId=${String(requestId)} | agent=${context.agentSlug}`);
    }
    getRecentEvents(limit) {
        if (limit) {
            return this.buffer.slice(-limit);
        }
        return [...this.buffer];
    }
    getEventStream() {
        return this.subject.asObservable();
    }
    async getHistoricalEvents() {
        return [...this.buffer];
    }
    pushToBuffer(record) {
        this.buffer.push(record);
        if (this.buffer.length > this.bufferSize) {
            this.buffer.shift();
        }
        this.subject.next(record);
    }
};
exports.ConsoleObservabilityService = ConsoleObservabilityService;
exports.ConsoleObservabilityService = ConsoleObservabilityService = ConsoleObservabilityService_1 = __decorate([
    (0, common_1.Injectable)()
], ConsoleObservabilityService);
