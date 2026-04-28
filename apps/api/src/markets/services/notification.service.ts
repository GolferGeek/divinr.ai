import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { NIL_UUID } from '@orchestrator-ai/transport-types';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import type { NotificationEventType, NotificationUrgency, Notification } from '../markets.types';

const NOTIFICATION_VISIBLE_HOURS = 24;

export interface NotifyInput {
  event_type: NotificationEventType;
  urgency: NotificationUrgency;
  title: string;
  summary?: string;
  link_to: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
    @Optional() @Inject(ObservabilityEventsService) private readonly observability?: ObservabilityEventsService,
  ) {}

  async notify(userId: string, input: NotifyInput): Promise<string> {

    // Honor per-user social_notifications_enabled opt-out.
    const optOutCheck = await this.db.rawQuery(
      `select social_notifications_enabled from authz.users where id = $1`,
      [userId],
    );
    const row = ((optOutCheck.data as Array<{ social_notifications_enabled: boolean | null }> | null) ?? [])[0];
    if (row && row.social_notifications_enabled === false) {
      return '';
    }

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `insert into prediction.notifications
        (id, user_id, event_type, urgency, title, summary, link_to)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, userId, input.event_type, input.urgency, input.title, input.summary ?? null, input.link_to],
    );
    if (result.error) {
      this.logger.error(`Failed to create notification: ${result.error.message}`);
      throw new Error(`Failed to create notification: ${result.error.message}`);
    }

    // Push SSE event so the frontend can update the bell in real-time
    if (this.observability) {
      await this.observability.push({
        context: {
          userId,
          conversationId: NIL_UUID,
          agentSlug: 'notification-service',
          agentType: 'context',
          provider: 'system',
          model: 'system',
        },
        source_app: 'divinr-api',
        hook_event_type: 'notification_created',
        status: 'created',
        message: input.title,
        progress: null,
        step: null,
        payload: { event_type: input.event_type, urgency: input.urgency },
        timestamp: Date.now(),
      }).catch(err => this.logger.warn(`SSE push failed: ${err}`));
    }

    return id;
  }

  async getNotifications(userId: string, unreadOnly = false): Promise<Notification[]> {
    const whereClause = unreadOnly
      ? `where user_id = $1 and is_read = false and ${this.activeNotificationPredicate()}`
      : `where user_id = $1 and ${this.activeNotificationPredicate()}`;
    const result = await this.db.rawQuery(
      `select * from prediction.notifications
       ${whereClause}
       order by created_at desc
       limit 100`,
      [userId, NOTIFICATION_VISIBLE_HOURS],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Notification[] | null) ?? [];
  }

  async getUnreadCount(userId: string): Promise<number> {
    const result = await this.db.rawQuery(
      `select count(*) as cnt from prediction.notifications
       where user_id = $1
         and is_read = false
         and ${this.activeNotificationPredicate()}`,
      [userId, NOTIFICATION_VISIBLE_HOURS],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<{ cnt: string }> | null) ?? [];
    return parseInt(rows[0]?.cnt ?? '0', 10);
  }

  private activeNotificationPredicate(): string {
    return `created_at >= now() - ($2 * interval '1 hour')`;
  }

  async markRead(id: string, userId: string): Promise<void> {
    await this.db.rawQuery(
      `update prediction.notifications
       set is_read = true
       where id = $1 and user_id = $2`,
      [id, userId],
    );
  }

  /**
   * Broadcast a notification to all users with portfolios.
   * Used by system-level services (stop-loss, nightly eval, etc.) that
   * don't have a specific userId in context.
   */
  async notifyAllUsers(input: NotifyInput): Promise<void> {
    const result = await this.db.rawQuery(
      `select distinct up.user_id
       from prediction.user_portfolios up
       join authz.users u on u.id = up.user_id
       where u.social_notifications_enabled IS NOT FALSE`,
    );
    const users = (result.data as Array<{ user_id: string }> | null) ?? [];
    for (const u of users) {
      await this.notify(u.user_id, input);
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db.rawQuery(
      `update prediction.notifications
       set is_read = true
       where user_id = $1 and is_read = false`,
      [userId],
    );
  }
}
