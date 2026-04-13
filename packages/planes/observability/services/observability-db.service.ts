/**
 * ObservabilityDbService
 *
 * Database facade for the legacy observability event system.
 * Merged from apps/observability/server/src/database/database.service.ts
 *
 * Wraps DATABASE_SERVICE queries against the `observability` schema
 * (tables: events, themes).
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '../../database';
import type {
  HookEvent,
  FilterOptions,
  Theme,
  ThemeSearchQuery,
  HumanInTheLoopResponse,
} from './observability-types';

@Injectable()
export class ObservabilityDbService {
  private readonly logger = new Logger(ObservabilityDbService.name);

  constructor(
    @Inject(DATABASE_SERVICE)
    private readonly db: DatabaseService,
  ) {
    this.logger.log(
      'ObservabilityDbService initialized with DATABASE_SERVICE provider',
    );
  }

  async insertEvent(event: HookEvent): Promise<HookEvent> {
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
      .single()) as QueryResult<unknown>;

    if (error) {
      throw new Error(`Failed to insert event: ${error.message}`);
    }

    return {
      ...event,
      id: (data as { id: number }).id,
      timestamp,
      humanInTheLoopStatus,
    };
  }

  async getFilterOptions(): Promise<FilterOptions> {
    const [sourceAppsResult, sessionIdsResult, eventTypesResult] =
      await Promise.all([
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
    const uniqueSourceApps: string[] = [
      ...new Set<string>(
        ((sourceAppsResult.data as Array<{ source_app: string }>) || []).map(
          (r) => r.source_app,
        ),
      ),
    ];
    const uniqueSessionIds: string[] = [
      ...new Set<string>(
        ((sessionIdsResult.data as Array<{ session_id: string }>) || []).map(
          (r) => r.session_id,
        ),
      ),
    ];
    const uniqueEventTypes: string[] = [
      ...new Set<string>(
        (
          (eventTypesResult.data as Array<{ hook_event_type: string }>) || []
        ).map((r) => r.hook_event_type),
      ),
    ];

    return {
      source_apps: uniqueSourceApps,
      session_ids: uniqueSessionIds,
      hook_event_types: uniqueEventTypes,
    };
  }

  async getRecentEvents(limit: number = 300): Promise<HookEvent[]> {
    const { data, error } = (await this.db
      .from('observability', 'events')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit)) as QueryResult<unknown>;

    if (error) {
      throw new Error(`Failed to get recent events: ${error.message}`);
    }

    // Map database rows to HookEvent interface and reverse for oldest-first
    return ((data as Record<string, unknown>[]) || [])
      .map((row) => this.mapRowToEvent(row))
      .reverse();
  }

  async updateEventHITLResponse(
    id: number,
    response: HumanInTheLoopResponse,
  ): Promise<HookEvent | null> {
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
      .single()) as QueryResult<unknown>;

    if (error) {
      this.logger.error(`Failed to update HITL response: ${error.message}`);
      return null;
    }

    if (!data) {
      return null;
    }

    return this.mapRowToEvent(data as Record<string, unknown>);
  }

  // Theme database functions

  async insertTheme(theme: Theme): Promise<Theme> {
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

  async updateTheme(id: string, updates: Partial<Theme>): Promise<boolean> {
    const updateData: Record<string, unknown> = {};

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
      .eq('id', id)) as QueryResult<unknown>;

    if (error) {
      throw new Error(`Failed to update theme: ${error.message}`);
    }

    return true;
  }

  async getTheme(id: string): Promise<Theme | null> {
    const { data, error } = (await this.db
      .from('observability', 'themes')
      .select('*')
      .eq('id', id)
      .single()) as QueryResult<unknown>;

    if (error || !data) {
      return null;
    }

    return this.mapRowToTheme(data as Record<string, unknown>);
  }

  async getThemes(query: ThemeSearchQuery = {}): Promise<Theme[]> {
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
      qb = qb.or(
        `name.ilike.%${query.query}%,display_name.ilike.%${query.query}%,description.ilike.%${query.query}%`,
      );
    }

    // Apply sorting
    const sortColumn =
      {
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
      } else {
        qb = qb.limit(query.limit);
      }
    }

    const { data, error } = (await qb) as QueryResult<unknown>;

    if (error) {
      throw new Error(`Failed to get themes: ${error.message}`);
    }

    return ((data as Record<string, unknown>[]) || []).map((row) =>
      this.mapRowToTheme(row),
    );
  }

  async deleteTheme(id: string): Promise<boolean> {
    const { error } = (await this.db
      .from('observability', 'themes')
      .delete()
      .eq('id', id)) as QueryResult<unknown>;

    if (error) {
      throw new Error(`Failed to delete theme: ${error.message}`);
    }

    return true;
  }

  async incrementThemeDownloadCount(id: string): Promise<boolean> {
    // Atomic increment — avoids read-then-update race condition
    const result = await this.db.rawQuery(
      `UPDATE observability.themes SET download_count = COALESCE(download_count, 0) + 1 WHERE id = $1 RETURNING id`,
      [id],
    );

    if (result.error) {
      throw new Error(`Failed to increment download count: ${result.error.message}`);
    }

    const rows = (result.data as Array<unknown> | null) ?? [];
    return rows.length > 0;
  }

  // Helper: map a database row to HookEvent
  private mapRowToEvent(row: Record<string, unknown>): HookEvent {
    return {
      id: row.id as number,
      source_app: row.source_app as string,
      session_id: row.session_id as string,
      hook_event_type: row.hook_event_type as string,
      payload:
        typeof row.payload === 'string'
          ? (JSON.parse(row.payload) as Record<string, unknown>)
          : (row.payload as Record<string, unknown>),
      chat: row.chat
        ? typeof row.chat === 'string'
          ? (JSON.parse(row.chat) as unknown[])
          : (row.chat as unknown[])
        : undefined,
      summary: (row.summary as string) || undefined,
      timestamp: row.timestamp as number,
      humanInTheLoop: row.human_in_the_loop
        ? typeof row.human_in_the_loop === 'string'
          ? (JSON.parse(row.human_in_the_loop) as HookEvent['humanInTheLoop'])
          : (row.human_in_the_loop as HookEvent['humanInTheLoop'])
        : undefined,
      humanInTheLoopStatus: row.human_in_the_loop_status
        ? typeof row.human_in_the_loop_status === 'string'
          ? (JSON.parse(
              row.human_in_the_loop_status,
            ) as HookEvent['humanInTheLoopStatus'])
          : (row.human_in_the_loop_status as HookEvent['humanInTheLoopStatus'])
        : undefined,
      model_name: (row.model_name as string) || undefined,
    };
  }

  // Helper: map a database row to Theme
  private mapRowToTheme(row: Record<string, unknown>): Theme {
    return {
      id: row.id as string,
      name: row.name as string,
      displayName: row.display_name as string,
      description: row.description as string | undefined,
      colors:
        typeof row.colors === 'string'
          ? (JSON.parse(row.colors) as Theme['colors'])
          : (row.colors as Theme['colors']),
      isPublic: row.is_public as boolean,
      authorId: row.author_id as string | undefined,
      authorName: row.author_name as string | undefined,
      createdAt: new Date(row.created_at as string).getTime(),
      updatedAt: new Date(row.updated_at as string).getTime(),
      tags: row.tags
        ? typeof row.tags === 'string'
          ? (JSON.parse(row.tags) as string[])
          : (row.tags as string[])
        : [],
      downloadCount: row.download_count as number | undefined,
      rating: row.rating as number | undefined,
      ratingCount: row.rating_count as number | undefined,
    };
  }
}
