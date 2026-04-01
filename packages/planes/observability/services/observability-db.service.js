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
var ObservabilityDbService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityDbService = void 0;
/**
 * ObservabilityDbService
 *
 * Database facade for the legacy observability event system.
 * Merged from apps/observability/server/src/database/database.service.ts
 *
 * Wraps DATABASE_SERVICE queries against the `observability` schema
 * (tables: events, themes).
 */
const common_1 = require("@nestjs/common");
const database_1 = require("../../database");
let ObservabilityDbService = ObservabilityDbService_1 = class ObservabilityDbService {
    db;
    logger = new common_1.Logger(ObservabilityDbService_1.name);
    constructor(db) {
        this.db = db;
        this.logger.log('ObservabilityDbService initialized with DATABASE_SERVICE provider');
    }
    async insertEvent(event) {
        const timestamp = event.timestamp || Date.now();
        // Initialize humanInTheLoopStatus to pending if humanInTheLoop exists
        let humanInTheLoopStatus = event.humanInTheLoopStatus;
        if (event.humanInTheLoop && !humanInTheLoopStatus) {
            humanInTheLoopStatus = { status: 'pending' };
        }
        const { data, error } = (await this.db
            .from('observability', 'events')
            .insert({
            source_app: event.source_app,
            session_id: event.session_id,
            hook_event_type: event.hook_event_type,
            payload: event.payload,
            chat: event.chat || null,
            summary: event.summary || null,
            timestamp,
            human_in_the_loop: event.humanInTheLoop || null,
            human_in_the_loop_status: humanInTheLoopStatus || null,
            model_name: event.model_name || null,
        })
            .select('id')
            .single());
        if (error) {
            throw new Error(`Failed to insert event: ${error.message}`);
        }
        return {
            ...event,
            id: data.id,
            timestamp,
            humanInTheLoopStatus,
        };
    }
    async getFilterOptions() {
        const [sourceAppsResult, sessionIdsResult, eventTypesResult] = await Promise.all([
            this.db
                .from('observability', 'events')
                .select('source_app')
                .order('source_app', { ascending: true }),
            this.db
                .from('observability', 'events')
                .select('session_id')
                .order('session_id', { ascending: false })
                .limit(300),
            this.db
                .from('observability', 'events')
                .select('hook_event_type')
                .order('hook_event_type', { ascending: true }),
        ]);
        // Deduplicate in code since QueryBuilder doesn't support SELECT DISTINCT
        const uniqueSourceApps = [
            ...new Set((sourceAppsResult.data || []).map((r) => r.source_app)),
        ];
        const uniqueSessionIds = [
            ...new Set((sessionIdsResult.data || []).map((r) => r.session_id)),
        ];
        const uniqueEventTypes = [
            ...new Set((eventTypesResult.data || []).map((r) => r.hook_event_type)),
        ];
        return {
            source_apps: uniqueSourceApps,
            session_ids: uniqueSessionIds,
            hook_event_types: uniqueEventTypes,
        };
    }
    async getRecentEvents(limit = 300) {
        const { data, error } = (await this.db
            .from('observability', 'events')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(limit));
        if (error) {
            throw new Error(`Failed to get recent events: ${error.message}`);
        }
        // Map database rows to HookEvent interface and reverse for oldest-first
        return (data || [])
            .map((row) => this.mapRowToEvent(row))
            .reverse();
    }
    async updateEventHITLResponse(id, response) {
        const status = {
            status: 'responded',
            respondedAt: response.respondedAt,
            response,
        };
        const { data, error } = (await this.db
            .from('observability', 'events')
            .update({ human_in_the_loop_status: status })
            .eq('id', id)
            .select('*')
            .single());
        if (error) {
            this.logger.error(`Failed to update HITL response: ${error.message}`);
            return null;
        }
        if (!data) {
            return null;
        }
        return this.mapRowToEvent(data);
    }
    // Theme database functions
    async insertTheme(theme) {
        const { error } = await this.db.from('observability', 'themes').insert({
            id: theme.id,
            name: theme.name,
            display_name: theme.displayName,
            description: theme.description || null,
            colors: theme.colors,
            is_public: theme.isPublic,
            author_id: theme.authorId || null,
            author_name: theme.authorName || null,
            created_at: new Date(theme.createdAt).toISOString(),
            updated_at: new Date(theme.updatedAt).toISOString(),
            tags: theme.tags || [],
            download_count: theme.downloadCount || 0,
            rating: theme.rating || null,
            rating_count: theme.ratingCount || 0,
        });
        if (error) {
            throw new Error(`Failed to insert theme: ${error.message}`);
        }
        return theme;
    }
    async updateTheme(id, updates) {
        const updateData = {};
        if (updates.displayName !== undefined) {
            updateData.display_name = updates.displayName;
        }
        if (updates.description !== undefined) {
            updateData.description = updates.description;
        }
        if (updates.colors !== undefined) {
            updateData.colors = updates.colors;
        }
        if (updates.isPublic !== undefined) {
            updateData.is_public = updates.isPublic;
        }
        if (updates.tags !== undefined) {
            updateData.tags = updates.tags;
        }
        if (updates.updatedAt !== undefined) {
            updateData.updated_at = new Date(updates.updatedAt).toISOString();
        }
        if (Object.keys(updateData).length === 0) {
            return true;
        }
        const { error } = (await this.db
            .from('observability', 'themes')
            .update(updateData)
            .eq('id', id));
        if (error) {
            throw new Error(`Failed to update theme: ${error.message}`);
        }
        return true;
    }
    async getTheme(id) {
        const { data, error } = (await this.db
            .from('observability', 'themes')
            .select('*')
            .eq('id', id)
            .single());
        if (error || !data) {
            return null;
        }
        return this.mapRowToTheme(data);
    }
    async getThemes(query = {}) {
        let qb = this.db.from('observability', 'themes').select('*');
        // Apply filters
        if (query.isPublic !== undefined) {
            qb = qb.eq('is_public', query.isPublic);
        }
        if (query.authorId) {
            qb = qb.eq('author_id', query.authorId);
        }
        if (query.query) {
            // ILIKE text search across name, display_name, description
            qb = qb.or(`name.ilike.%${query.query}%,display_name.ilike.%${query.query}%,description.ilike.%${query.query}%`);
        }
        // Apply sorting
        const sortColumn = {
            name: 'name',
            created: 'created_at',
            updated: 'updated_at',
            downloads: 'download_count',
            rating: 'rating',
        }[query.sortBy || 'created'] || 'created_at';
        const ascending = query.sortOrder === 'asc';
        qb = qb.order(sortColumn, { ascending });
        // Apply pagination
        if (query.limit) {
            if (query.offset) {
                qb = qb.range(query.offset, query.offset + query.limit - 1);
            }
            else {
                qb = qb.limit(query.limit);
            }
        }
        const { data, error } = (await qb);
        if (error) {
            throw new Error(`Failed to get themes: ${error.message}`);
        }
        return (data || []).map((row) => this.mapRowToTheme(row));
    }
    async deleteTheme(id) {
        const { error } = (await this.db
            .from('observability', 'themes')
            .delete()
            .eq('id', id));
        if (error) {
            throw new Error(`Failed to delete theme: ${error.message}`);
        }
        return true;
    }
    async incrementThemeDownloadCount(id) {
        // Fetch current count, increment, and update
        const { data } = (await this.db
            .from('observability', 'themes')
            .select('download_count')
            .eq('id', id)
            .single());
        if (!data) {
            return false;
        }
        const { error } = (await this.db
            .from('observability', 'themes')
            .update({
            download_count: (data.download_count || 0) + 1,
        })
            .eq('id', id));
        if (error) {
            throw new Error(`Failed to increment download count: ${error.message}`);
        }
        return true;
    }
    // Helper: map a database row to HookEvent
    mapRowToEvent(row) {
        return {
            id: row.id,
            source_app: row.source_app,
            session_id: row.session_id,
            hook_event_type: row.hook_event_type,
            payload: typeof row.payload === 'string'
                ? JSON.parse(row.payload)
                : row.payload,
            chat: row.chat
                ? typeof row.chat === 'string'
                    ? JSON.parse(row.chat)
                    : row.chat
                : undefined,
            summary: row.summary || undefined,
            timestamp: row.timestamp,
            humanInTheLoop: row.human_in_the_loop
                ? typeof row.human_in_the_loop === 'string'
                    ? JSON.parse(row.human_in_the_loop)
                    : row.human_in_the_loop
                : undefined,
            humanInTheLoopStatus: row.human_in_the_loop_status
                ? typeof row.human_in_the_loop_status === 'string'
                    ? JSON.parse(row.human_in_the_loop_status)
                    : row.human_in_the_loop_status
                : undefined,
            model_name: row.model_name || undefined,
        };
    }
    // Helper: map a database row to Theme
    mapRowToTheme(row) {
        return {
            id: row.id,
            name: row.name,
            displayName: row.display_name,
            description: row.description,
            colors: typeof row.colors === 'string'
                ? JSON.parse(row.colors)
                : row.colors,
            isPublic: row.is_public,
            authorId: row.author_id,
            authorName: row.author_name,
            createdAt: new Date(row.created_at).getTime(),
            updatedAt: new Date(row.updated_at).getTime(),
            tags: row.tags
                ? typeof row.tags === 'string'
                    ? JSON.parse(row.tags)
                    : row.tags
                : [],
            downloadCount: row.download_count,
            rating: row.rating,
            ratingCount: row.rating_count,
        };
    }
};
exports.ObservabilityDbService = ObservabilityDbService;
exports.ObservabilityDbService = ObservabilityDbService = ObservabilityDbService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_1.DATABASE_SERVICE)),
    __metadata("design:paramtypes", [Object])
], ObservabilityDbService);
