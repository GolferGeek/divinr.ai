"use strict";
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
var ObservabilityEventsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityEventsService = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const transport_types_1 = require("@orchestrator-ai/transport-types");
const crypto_1 = require("crypto");
const auth_service_interface_1 = require("../../auth/interfaces/auth-service.interface");
const database_1 = require("../../database");
/**
 * ObservabilityEventsService
 *
 * Maintains an in-memory, reactive buffer of the most recent observability
 * events so multiple consumers (admin SSE, task SSE, debugging tools) can
 * subscribe to the same stream without duplicating plumbing.
 */
let ObservabilityEventsService = class ObservabilityEventsService {
    static { ObservabilityEventsService_1 = this; }
    authService;
    db;
    logger = new common_1.Logger(ObservabilityEventsService_1.name);
    static UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    bufferSize;
    /**
     * Use a regular Subject (not ReplaySubject) for live events.
     *
     * Replay is handled manually via getSnapshot() by consumers who need it.
     * This prevents duplicate events when a consumer:
     * 1. First calls getSnapshot() to replay missed events
     * 2. Then subscribes to events$ for live updates
     *
     * Using ReplaySubject would cause events to be delivered twice.
     */
    subject;
    buffer = [];
    // Cache of userId -> username mappings
    userCache = new Map();
    // Track pending lookups to avoid duplicate requests
    pendingLookups = new Set();
    constructor(authService, db) {
        this.authService = authService;
        this.db = db;
        this.bufferSize = Math.max(Number(process.env.OBSERVABILITY_EVENT_BUFFER ?? 500), 1);
        // Use regular Subject - replay is handled manually via getSnapshot()
        this.subject = new rxjs_1.Subject();
    }
    /**
     * Get username for userId - from cache or fetch from database (once)
     */
    async resolveUsername(userId) {
        if (!userId)
            return undefined;
        // Check cache first
        const cached = this.userCache.get(userId);
        if (cached) {
            return cached;
        }
        // Don't duplicate pending lookups
        if (this.pendingLookups.has(userId)) {
            return undefined;
        }
        // Fetch from database (one-time hit per user)
        this.pendingLookups.add(userId);
        try {
            const profile = await this.authService?.getUserProfile(userId);
            const username = profile?.displayName || profile?.email;
            if (username) {
                this.userCache.set(userId, username);
                this.logger.log(`📝 Cached username: ${userId} -> ${username}`);
                return username;
            }
        }
        catch (err) {
            this.logger.warn(`Failed to resolve username for ${userId}: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            this.pendingLookups.delete(userId);
        }
        return undefined;
    }
    /**
     * Cache a userId -> username mapping (called when username comes in from event)
     */
    cacheUsername(userId, username) {
        if (userId && username && username !== userId) {
            this.userCache.set(userId, username);
            this.logger.debug(`📝 Cached username from event: ${userId} -> ${username}`);
        }
    }
    /**
     * Observable stream of events for subscribers.
     */
    get events$() {
        return this.subject.asObservable();
    }
    /**
     * Snapshot of the current in-memory buffer (FIFO with configured size).
     */
    getSnapshot() {
        return [...this.buffer];
    }
    /**
     * Push a new event into the buffer and notify subscribers.
     * Enriches events with username (from cache or database lookup).
     */
    async push(event) {
        try {
            const userId = this.toValidUuidOrNull(event.context?.userId);
            const payloadUsername = event.payload?.username;
            // Learn: If event already has a username in payload, cache it
            if (userId && payloadUsername && payloadUsername !== userId) {
                this.cacheUsername(userId, payloadUsername);
            }
            // Enrich: If event doesn't have username, resolve it (from cache or DB)
            if (userId && !payloadUsername) {
                const username = await this.resolveUsername(userId);
                if (username) {
                    event.payload = {
                        ...event.payload,
                        username,
                    };
                }
            }
            const username = event.payload?.username;
            const usernameStr = typeof username === 'string' ? username : 'unknown';
            this.logger.debug(`📥 [BUFFER] Pushing event: ${event.hook_event_type} for conversation ${event.context.conversationId || 'unknown'}, username=${usernameStr}`);
            this.buffer.push(event);
            if (this.buffer.length > this.bufferSize) {
                this.buffer.shift();
            }
            this.subject.next(event);
            this.logger.debug(`✅ [BUFFER] Event pushed successfully, buffer size: ${this.buffer.length}, subscribers notified`);
            // Persist to database (fire and forget, don't block)
            this.persistToDatabase(event).catch((err) => {
                this.logger.warn(`Failed to persist event to database: ${err}`);
            });
        }
        catch (error) {
            this.logger.error(`❌ [BUFFER] Failed to push observability event: ${error instanceof Error ? error.message : String(error)}`);
            this.logger.error(error);
        }
    }
    /**
     * Persist event to database for historical queries
     */
    async persistToDatabase(event) {
        try {
            const rawConversationId = this.toValidUuidOrNull(event.context.conversationId);
            const conversationId = await this.getPersistableConversationId(rawConversationId);
            const taskId = this.toValidUuidOrNull(event.context.conversationId) || (0, crypto_1.randomUUID)();
            const userId = this.toValidUuidOrNull(event.context.userId);
            const { error } = await this.db
                .from(null, 'observability_events')
                .insert({
                source_app: event.source_app,
                session_id: conversationId || taskId,
                hook_event_type: event.hook_event_type,
                user_id: userId,
                username: event.payload?.username || null,
                conversation_id: conversationId,
                task_id: taskId,
                agent_slug: event.context.agentSlug || null,
                organization_slug: event.context.orgSlug || null,
                mode: event.payload?.mode || null,
                status: event.status,
                message: event.message,
                progress: event.progress,
                step: event.step,
                sequence: event.payload?.sequence || null,
                total_steps: event.payload?.totalSteps || null,
                payload: event.payload,
                timestamp: event.timestamp,
            });
            if (error) {
                this.logger.warn(`Database insert error: ${error.message}`);
            }
        }
        catch (err) {
            this.logger.warn(`Failed to persist event: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    toValidUuidOrNull(value) {
        if (!value ||
            !ObservabilityEventsService_1.UUID_REGEX.test(value) ||
            (0, transport_types_1.isNilUuid)(value)) {
            return null;
        }
        return value;
    }
    async getPersistableConversationId(conversationId) {
        if (!conversationId) {
            return null;
        }
        const { data, error } = (await this.db
            .from(null, 'conversations')
            .select('id')
            .eq('id', conversationId)
            .single());
        if (error || !data) {
            return null;
        }
        return conversationId;
    }
    /**
     * Query historical events from database
     * @param since Timestamp (ms) - fetch events from this time onwards
     * @param limit Max number of events to return
     * @param until Optional timestamp (ms) - fetch events up to this time
     */
    async getHistoricalEvents(since, limit = 1000, until) {
        try {
            let query = this.db
                .from(null, 'observability_events')
                .select('*')
                .gte('timestamp', since);
            // Add upper bound if specified
            if (until) {
                query = query.lte('timestamp', until);
            }
            const { data, error } = (await query
                .order('timestamp', { ascending: false })
                .limit(limit));
            if (error) {
                this.logger.error(`Failed to query historical events: ${error.message}`);
                return [];
            }
            // Map database records to ObservabilityEventRecord format
            const rows = (data || []);
            return rows.map((row) => ({
                context: {
                    conversationId: row.conversation_id,
                    userId: row.user_id,
                    agentSlug: row.agent_slug,
                    orgSlug: row.organization_slug,
                    agentType: '',
                    provider: '',
                    model: '',
                },
                source_app: row.source_app,
                hook_event_type: row.hook_event_type,
                status: row.status || '',
                message: row.message,
                progress: row.progress,
                step: row.step,
                payload: {
                    ...(row.payload || {}),
                    username: row.username,
                    mode: row.mode,
                    sequence: row.sequence,
                    totalSteps: row.total_steps,
                },
                timestamp: row.timestamp,
                id: row.id,
                created_at: row.created_at,
            }));
        }
        catch (err) {
            this.logger.error(`Failed to query historical events: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
};
exports.ObservabilityEventsService = ObservabilityEventsService;
exports.ObservabilityEventsService = ObservabilityEventsService = ObservabilityEventsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, common_1.Inject)((0, common_1.forwardRef)(() => auth_service_interface_1.AUTH_SERVICE))),
    __param(1, (0, common_1.Inject)(database_1.DATABASE_SERVICE)),
    __metadata("design:paramtypes", [Object, Object])
], ObservabilityEventsService);
