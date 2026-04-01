"use strict";
/**
 * Supabase Observability Provider
 *
 * Persists events to the observability_events table, maintains an in-memory
 * buffer for live SSE streaming, and records LLM usage for cost attribution.
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var SupabaseObservabilityService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseObservabilityService = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const database_1 = require("../../database");
let SupabaseObservabilityService = SupabaseObservabilityService_1 = class SupabaseObservabilityService {
    db;
    logger = new common_1.Logger(SupabaseObservabilityService_1.name);
    bufferSize;
    subject = new rxjs_1.Subject();
    buffer = [];
    constructor(db) {
        this.db = db;
        this.bufferSize = Math.max(Number(process.env.OBSERVABILITY_EVENT_BUFFER ?? 500), 1);
        this.logger.log('Supabase observability provider initialized');
    }
    // ─── Invocation Lifecycle ─────────────────────────────────────────
    async emitInvocationEvent(context, event) {
        const record = {
            context,
            sourceApp: event.sourceApp,
            eventType: event.type,
            status: event.type.split('.').pop() || 'unknown',
            message: event.message,
            progress: event.progress,
            step: event.step,
            payload: {
                ...event.payload,
                success: event.success,
                error: event.error,
                duration: event.duration,
            },
            timestamp: Date.now(),
        };
        await this.pushAndPersist(record);
    }
    // ─── LLM Usage ───────────────────────────────────────────────────
    async recordLLMUsage(context, usage) {
        const record = {
            context,
            sourceApp: 'llm-plane',
            eventType: 'llm.usage',
            status: usage.success ? 'completed' : 'failed',
            message: usage.error || undefined,
            payload: {
                provider: usage.provider,
                model: usage.model,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
                costUsd: usage.costUsd,
                durationMs: usage.durationMs,
                streaming: usage.streaming,
                success: usage.success,
                error: usage.error,
                ...usage.metadata,
            },
            timestamp: Date.now(),
        };
        await this.pushAndPersist(record);
    }
    // ─── Stream Correlation ───────────────────────────────────────────
    async registerStream(context, correlation) {
        const record = {
            context,
            sourceApp: 'stream-plane',
            eventType: 'stream.registered',
            status: 'registered',
            payload: {
                requestId: correlation.requestId,
                streamId: correlation.streamId,
                startedAt: correlation.startedAt,
            },
            timestamp: Date.now(),
        };
        await this.pushAndPersist(record);
    }
    async emitStreamEvent(context, requestId, eventType, data) {
        const record = {
            context,
            sourceApp: 'stream-plane',
            eventType: `stream.${eventType}`,
            status: eventType,
            payload: {
                requestId,
                ...data,
            },
            timestamp: Date.now(),
        };
        await this.pushAndPersist(record);
    }
    // ─── Query / Subscribe ────────────────────────────────────────────
    getRecentEvents(limit) {
        if (limit) {
            return this.buffer.slice(-limit);
        }
        return [...this.buffer];
    }
    getEventStream() {
        return this.subject.asObservable();
    }
    async getHistoricalEvents(since, limit = 1000, until) {
        let query = this.db
            .from(null, 'observability_events')
            .select('*')
            .gte('timestamp', since);
        if (until) {
            query = query.lte('timestamp', until);
        }
        const { data, error } = await query
            .order('timestamp', { ascending: true })
            .limit(limit);
        if (error) {
            this.logger.error(`Failed to query historical events: ${error.message}`);
            return [];
        }
        const rows = (data || []);
        return rows.map((row) => this.mapRowToRecord(row));
    }
    // ─── Internal ─────────────────────────────────────────────────────
    async pushAndPersist(record) {
        // Buffer + notify subscribers
        this.buffer.push(record);
        if (this.buffer.length > this.bufferSize) {
            this.buffer.shift();
        }
        this.subject.next(record);
        // Persist (fire-and-forget)
        this.persistToDatabase(record).catch((err) => {
            this.logger.warn(`Failed to persist observability event: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
    async persistToDatabase(record) {
        const { error } = await this.db
            .from(null, 'observability_events')
            .insert({
            source_app: record.sourceApp,
            hook_event_type: record.eventType,
            status: record.status,
            message: record.message || null,
            progress: record.progress ?? null,
            step: record.step || null,
            payload: record.payload,
            timestamp: record.timestamp,
            // ExecutionContext v2 fields
            conversation_id: record.context.conversationId || null,
            user_id: record.context.userId || null,
            agent_slug: record.context.agentSlug || null,
            organization_slug: record.context.orgSlug || null,
            // Provider/model attribution
            session_id: record.context.conversationId || 'unknown',
        });
        if (error) {
            this.logger.warn(`Database insert error: ${error.message}`);
        }
    }
    mapRowToRecord(row) {
        return {
            context: {
                orgSlug: row.organization_slug || '',
                userId: row.user_id || '',
                conversationId: row.conversation_id || '',
                agentSlug: row.agent_slug || '',
                agentType: '',
                provider: '',
                model: '',
            },
            sourceApp: row.source_app || '',
            eventType: row.hook_event_type || '',
            status: row.status || '',
            message: row.message,
            progress: row.progress,
            step: row.step,
            payload: row.payload || {},
            timestamp: row.timestamp,
        };
    }
};
exports.SupabaseObservabilityService = SupabaseObservabilityService;
exports.SupabaseObservabilityService = SupabaseObservabilityService = SupabaseObservabilityService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_1.DATABASE_SERVICE)),
    __metadata("design:paramtypes", [Object])
], SupabaseObservabilityService);
