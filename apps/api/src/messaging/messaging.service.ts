import { Injectable, Inject, Logger, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { NIL_UUID } from '@orchestrator-ai/transport-types';
import { MessagingSchemaService } from './messaging-schema.service';
import { NotificationService } from '../markets/services/notification.service';
import { SocialOptOutService } from '../users/social-opt-out.service';
import type {
  Channel,
  ChannelScope,
  ChannelWithUnread,
  Message,
  SendMessageOptions,
} from './messaging.types';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MessagingSchemaService) private readonly schema: MessagingSchemaService,
    @Inject(SocialOptOutService) private readonly optOuts: SocialOptOutService,
    @Optional() @Inject(ObservabilityEventsService) private readonly observability?: ObservabilityEventsService,
    @Optional() @Inject(NotificationService) private readonly notifications?: NotificationService,
  ) {}

  // ─── Channel Operations ─────────────────────────────────────

  async createChannel(scope: ChannelScope, scopeId?: string, name?: string): Promise<Channel> {
    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO messaging.channels (id, scope, scope_id, name)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, scope, scopeId ?? null, name ?? null],
    );
    if (result.error) throw new Error(`Failed to create channel: ${result.error.message}`);
    const rows = result.data as Channel[] | null;
    return rows![0];
  }

  async addChannelMember(channelId: string, userId: string, role: 'member' | 'admin' = 'member'): Promise<void> {
    const result = await this.db.rawQuery(
      `INSERT INTO messaging.channel_members (channel_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [channelId, userId, role],
    );
    if (result.error) throw new Error(`Failed to add channel member: ${result.error.message}`);
  }

  async getChannel(channelId: string, userId: string): Promise<Channel> {
    await this.verifyMembership(channelId, userId);
    const result = await this.db.rawQuery(
      `SELECT * FROM messaging.channels WHERE id = $1`,
      [channelId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = result.data as Channel[] | null;
    if (!rows || rows.length === 0) throw new BadRequestException('Channel not found');
    return rows[0];
  }

  async listChannels(userId: string): Promise<ChannelWithUnread[]> {
    const result = await this.db.rawQuery(
      `SELECT
         c.*,
         COALESCE(
           (SELECT COUNT(*) FROM messaging.messages m
            WHERE m.channel_id = c.id
              AND m.is_deleted = false
              AND m.created_at > cm.last_read_at),
           0
         )::int AS unread_count,
         lm.body AS last_message_body,
         lm.created_at AS last_message_at,
         lm.sender_id AS last_message_sender_id
       FROM messaging.channel_members cm
       JOIN messaging.channels c ON c.id = cm.channel_id
       LEFT JOIN LATERAL (
         SELECT body, created_at, sender_id
         FROM messaging.messages
         WHERE channel_id = c.id AND is_deleted = false
         ORDER BY created_at DESC LIMIT 1
       ) lm ON true
       WHERE cm.user_id = $1
       ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
      [userId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as ChannelWithUnread[] | null) ?? [];
  }

  // ─── Message Operations ─────────────────────────────────────

  async sendMessage(channelId: string, senderId: string, body: string, opts?: SendMessageOptions): Promise<Message> {
    await this.verifyMembership(channelId, senderId);

    // Check if sender is blocked in DM channels
    const channelResult = await this.db.rawQuery(
      `SELECT scope FROM messaging.channels WHERE id = $1`,
      [channelId],
    );
    if (!channelResult.error) {
      const chRows = channelResult.data as Array<{ scope: string }> | null;
      if (chRows?.[0]?.scope === 'system') {
        // System channels are read-only for non-admin users
        const memberResult = await this.db.rawQuery(
          `SELECT role FROM messaging.channel_members WHERE channel_id = $1 AND user_id = $2`,
          [channelId, senderId],
        );
        const memberRows = memberResult.data as Array<{ role: string }> | null;
        if (!memberRows?.[0] || memberRows[0].role !== 'admin') {
          throw new ForbiddenException('System channels are read-only');
        }
      }
      if (chRows?.[0]?.scope === 'dm') {
        await this.checkDmBlocked(channelId, senderId);
      }
    }

    if (!body || body.trim().length === 0) {
      throw new BadRequestException('Message body cannot be empty');
    }

    // Validate attachment if provided
    if (opts?.attached_entity_type && opts?.attached_entity_id) {
      await this.validateAndResolveAttachment(opts.attached_entity_type, opts.attached_entity_id, senderId);
    }

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO messaging.messages
        (id, channel_id, sender_id, body, parent_message_id, attached_entity_type, attached_entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        channelId,
        senderId,
        body.trim(),
        opts?.parent_message_id ?? null,
        opts?.attached_entity_type ?? null,
        opts?.attached_entity_id ?? null,
      ],
    );
    if (result.error) throw new Error(`Failed to send message: ${result.error.message}`);
    const rows = result.data as Message[] | null;
    const message = rows![0];

    // Push SSE event for real-time delivery
    if (this.observability) {
      await this.observability.push({
        context: {
          userId: senderId,
          conversationId: NIL_UUID,
          agentSlug: 'messaging-service',
          agentType: 'context',
          provider: 'system',
          model: 'system',
        },
        source_app: 'divinr-api',
        hook_event_type: 'message_created',
        status: 'created',
        message: body.trim().slice(0, 100),
        progress: null,
        step: null,
        payload: { channelId, messageId: message.id, senderId },
        timestamp: Date.now(),
      }).catch(err => this.logger.warn(`SSE push failed: ${err}`));
    }

    // Process @mentions
    if (this.notifications) {
      const mentions = this.parseMentions(body);
      if (mentions.length > 0) {
        const resolved = await this.resolveUsernames(mentions);
        for (const user of resolved) {
          if (user.user_id !== senderId) {
            await this.notifications.notify(user.user_id, {
              event_type: 'mention',
              urgency: 'actionable',
              title: `You were mentioned in a message`,
              summary: body.trim().slice(0, 100),
              link_to: `/messages/${channelId}`,
            }).catch(err => this.logger.warn(`Mention notification failed: ${err}`));
          }
        }
      }
    }

    return message;
  }

  async listMessages(
    channelId: string,
    userId: string,
    options?: { before?: string; limit?: number },
  ): Promise<{ data: Message[]; has_more: boolean }> {
    await this.verifyMembership(channelId, userId);

    const limit = Math.min(options?.limit ?? 50, 100);
    const params: unknown[] = [channelId, limit + 1];
    let cursorClause = '';

    if (options?.before) {
      cursorClause = `AND m.created_at < (SELECT created_at FROM messaging.messages WHERE id = $3)`;
      params.push(options.before);
    }

    const result = await this.db.rawQuery(
      `SELECT m.*,
         u.display_name AS sender_display_name,
         COALESCE((SELECT COUNT(*) FROM messaging.messages r WHERE r.parent_message_id = m.id AND r.is_deleted = false), 0)::int AS reply_count
       FROM messaging.messages m
       LEFT JOIN authz.users u ON u.id = m.sender_id
       WHERE m.channel_id = $1
         AND m.is_deleted = false
         AND m.parent_message_id IS NULL
         ${cursorClause}
       ORDER BY m.created_at DESC
       LIMIT $2`,
      params,
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as (Message & { reply_count: number; attachment?: Record<string, unknown> })[] | null) ?? [];
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    // Resolve attachments for messages that have them
    for (const msg of data) {
      if (msg.attached_entity_type && msg.attached_entity_id) {
        try {
          msg.attachment = await this.resolveAttachment(msg.attached_entity_type, msg.attached_entity_id, userId) ?? undefined;
        } catch {
          // Attachment resolution failure is non-critical
        }
      }
    }

    return { data, has_more: hasMore };
  }

  // ─── Threading ──────────────────────────────────────────────

  async getThreadReplies(channelId: string, parentMessageId: string, userId: string): Promise<Message[]> {
    await this.verifyMembership(channelId, userId);

    const result = await this.db.rawQuery(
      `SELECT m.*, u.display_name AS sender_display_name
       FROM messaging.messages m
       LEFT JOIN authz.users u ON u.id = m.sender_id
       WHERE m.channel_id = $1
         AND m.parent_message_id = $2
         AND m.is_deleted = false
       ORDER BY m.created_at ASC`,
      [channelId, parentMessageId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Message[] | null) ?? [];
  }

  // ─── Reactions ─────────────────────────────────────────────

  async addReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    // Verify user is a member of the message's channel
    const msgCheck = await this.db.rawQuery(
      `SELECT channel_id FROM messaging.messages WHERE id = $1`, [messageId],
    );
    if (msgCheck.error) throw new Error(msgCheck.error.message);
    const msgRows = msgCheck.data as Array<{ channel_id: string }> | null;
    if (!msgRows || msgRows.length === 0) throw new BadRequestException('Message not found');
    await this.verifyMembership(msgRows[0].channel_id, userId);

    const result = await this.db.rawQuery(
      `INSERT INTO messaging.message_reactions (message_id, user_id, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
      [messageId, userId, emoji],
    );
    if (result.error) throw new Error(result.error.message);

    if (this.observability) {
      await this.observability.push({
        context: { userId, conversationId: NIL_UUID, agentSlug: 'messaging-service', agentType: 'context', provider: 'system', model: 'system' },
        source_app: 'divinr-api',
        hook_event_type: 'reaction_added',
        status: 'created',
        message: emoji,
        progress: null,
        step: null,
        payload: { messageId, userId, emoji },
        timestamp: Date.now(),
      }).catch(err => this.logger.warn(`SSE push failed: ${err}`));
    }
  }

  async removeReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    // Verify user is a member of the message's channel
    const msgCheck = await this.db.rawQuery(
      `SELECT channel_id FROM messaging.messages WHERE id = $1`, [messageId],
    );
    if (msgCheck.error) throw new Error(msgCheck.error.message);
    const msgRows = msgCheck.data as Array<{ channel_id: string }> | null;
    if (!msgRows || msgRows.length === 0) throw new BadRequestException('Message not found');
    await this.verifyMembership(msgRows[0].channel_id, userId);

    const result = await this.db.rawQuery(
      `DELETE FROM messaging.message_reactions
       WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [messageId, userId, emoji],
    );
    if (result.error) throw new Error(result.error.message);
  }

  async getReactions(messageIds: string[], userId: string): Promise<Record<string, Array<{ emoji: string; count: number; user_reacted: boolean }>>> {
    if (messageIds.length === 0) return {};

    const placeholders = messageIds.map((_, i) => `$${i + 1}`).join(', ');
    const result = await this.db.rawQuery(
      `SELECT message_id, emoji, COUNT(*)::int AS count,
         bool_or(user_id = $${messageIds.length + 1}) AS user_reacted
       FROM messaging.message_reactions
       WHERE message_id IN (${placeholders})
       GROUP BY message_id, emoji`,
      [...messageIds, userId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<{ message_id: string; emoji: string; count: number; user_reacted: boolean }> | null) ?? [];

    const map: Record<string, Array<{ emoji: string; count: number; user_reacted: boolean }>> = {};
    for (const row of rows) {
      if (!map[row.message_id]) map[row.message_id] = [];
      map[row.message_id].push({ emoji: row.emoji, count: row.count, user_reacted: row.user_reacted });
    }
    return map;
  }

  // ─── Pinning ───────────────────────────────────────────────

  async togglePin(messageId: string, userId: string): Promise<{ is_pinned: boolean }> {

    // Get message and verify admin
    const msgResult = await this.db.rawQuery(
      `SELECT m.channel_id, m.is_pinned FROM messaging.messages m WHERE m.id = $1`,
      [messageId],
    );
    if (msgResult.error) throw new Error(msgResult.error.message);
    const msgRows = msgResult.data as Array<{ channel_id: string; is_pinned: boolean }> | null;
    if (!msgRows || msgRows.length === 0) throw new BadRequestException('Message not found');

    const channelId = msgRows[0].channel_id;
    // In DM channels, any member can pin. In other channels, only admins.
    const chResult = await this.db.rawQuery(`SELECT scope FROM messaging.channels WHERE id = $1`, [channelId]);
    const chScope = (chResult.data as Array<{ scope: string }> | null)?.[0]?.scope;
    if (chScope !== 'dm') {
      await this.verifyAdmin(channelId, userId);
    } else {
      await this.verifyMembership(channelId, userId);
    }

    const newPinned = !msgRows[0].is_pinned;
    const updateResult = await this.db.rawQuery(
      `UPDATE messaging.messages SET is_pinned = $1 WHERE id = $2`,
      [newPinned, messageId],
    );
    if (updateResult.error) throw new Error(updateResult.error.message);

    if (this.observability) {
      await this.observability.push({
        context: { userId, conversationId: NIL_UUID, agentSlug: 'messaging-service', agentType: 'context', provider: 'system', model: 'system' },
        source_app: 'divinr-api',
        hook_event_type: 'message_pinned',
        status: 'created',
        message: newPinned ? 'pinned' : 'unpinned',
        progress: null,
        step: null,
        payload: { messageId, channelId, is_pinned: newPinned },
        timestamp: Date.now(),
      }).catch(err => this.logger.warn(`SSE push failed: ${err}`));
    }

    return { is_pinned: newPinned };
  }

  async getPinnedMessages(channelId: string, userId: string): Promise<Message[]> {
    await this.verifyMembership(channelId, userId);

    const result = await this.db.rawQuery(
      `SELECT m.*, u.display_name AS sender_display_name
       FROM messaging.messages m
       LEFT JOIN authz.users u ON u.id = m.sender_id
       WHERE m.channel_id = $1 AND m.is_pinned = true AND m.is_deleted = false
       ORDER BY m.created_at DESC`,
      [channelId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Message[] | null) ?? [];
  }

  // ─── Entity Attachments ─────────────────────────────────────

  async resolveAttachment(entityType: string, entityId: string, _userId: string): Promise<Record<string, unknown> | null> {

    const tableMap: Record<string, string> = {
      instrument: 'prediction.instruments',
      prediction: 'prediction.market_predictions',
      analyst: 'prediction.market_analysts',
      position: 'prediction.user_positions',
    };

    const table = tableMap[entityType];
    if (!table) {
      // Tournament table doesn't exist yet — return stub
      if (entityType === 'tournament') {
        return { id: entityId, name: 'Tournament', entity_type: 'tournament' };
      }
      return null;
    }

    const result = await this.db.rawQuery(
      `SELECT * FROM ${table} WHERE id = $1`,
      [entityId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = result.data as Array<Record<string, unknown>> | null;
    if (!rows || rows.length === 0) return null;

    const entity = rows[0];
    // Return normalized card data per type
    switch (entityType) {
      case 'instrument':
        return {
          entity_type: 'instrument',
          id: entity.id,
          symbol: entity.symbol,
          name: entity.name,
          asset_type: entity.asset_type,
        };
      case 'prediction':
        return {
          entity_type: 'prediction',
          id: entity.id,
          predicted_direction: entity.predicted_direction,
          confidence: entity.confidence,
          analyst_id: entity.analyst_id,
          instrument_id: entity.instrument_id,
          horizon_minutes: entity.horizon_minutes,
        };
      case 'analyst':
        return {
          entity_type: 'analyst',
          id: entity.id,
          display_name: entity.display_name,
          analyst_type: entity.analyst_type,
          workflow_scope: entity.workflow_scope,
        };
      case 'position':
        return {
          entity_type: 'position',
          id: entity.id,
          symbol: entity.symbol,
          direction: entity.direction,
          entry_price: entity.entry_price,
          current_price: entity.current_price,
          unrealized_pnl: entity.unrealized_pnl,
          status: entity.status,
        };
      default:
        return entity;
    }
  }

  async validateAndResolveAttachment(
    entityType: string | undefined,
    entityId: string | undefined,
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    if (!entityType || !entityId) return null;

    const attachment = await this.resolveAttachment(entityType, entityId, userId);
    if (!attachment && entityType !== 'tournament') {
      throw new BadRequestException(`Entity not found: ${entityType}/${entityId}`);
    }
    return attachment;
  }

  // ─── DM Operations ──────────────────────────────────────────

  async getOrCreateDmChannel(userId: string, targetUserId: string): Promise<Channel> {

    if (userId === targetUserId) {
      throw new BadRequestException('Cannot create DM with yourself');
    }

    // Check blocks in both directions
    const blockCheck = await this.db.rawQuery(
      `SELECT 1 FROM messaging.user_blocks
       WHERE (blocker_id = $1 AND blocked_id = $2)
          OR (blocker_id = $2 AND blocked_id = $1)`,
      [userId, targetUserId],
    );
    if (blockCheck.error) throw new Error(blockCheck.error.message);
    if ((blockCheck.data as unknown[] | null)?.length) {
      throw new ForbiddenException('Cannot create DM — user is blocked');
    }

    // Find existing DM channel between these two users
    const existing = await this.db.rawQuery(
      `SELECT c.* FROM messaging.channels c
       WHERE c.scope = 'dm'
         AND EXISTS (SELECT 1 FROM messaging.channel_members WHERE channel_id = c.id AND user_id = $1)
         AND EXISTS (SELECT 1 FROM messaging.channel_members WHERE channel_id = c.id AND user_id = $2)`,
      [userId, targetUserId],
    );
    if (existing.error) throw new Error(existing.error.message);
    const existingRows = existing.data as Channel[] | null;
    if (existingRows && existingRows.length > 0) {
      return existingRows[0];
    }

    // Create new DM channel
    const channel = await this.createChannel('dm');
    await this.addChannelMember(channel.id, userId, 'member');
    await this.addChannelMember(channel.id, targetUserId, 'member');
    return channel;
  }

  // ─── Read Tracking ─────────────────────────────────────────

  async updateLastRead(channelId: string, userId: string): Promise<void> {
    await this.verifyMembership(channelId, userId);
    const result = await this.db.rawQuery(
      `UPDATE messaging.channel_members
       SET last_read_at = now()
       WHERE channel_id = $1 AND user_id = $2`,
      [channelId, userId],
    );
    if (result.error) throw new Error(result.error.message);
  }

  async getUnreadCounts(userId: string): Promise<Record<string, number>> {
    const result = await this.db.rawQuery(
      `SELECT cm.channel_id,
         COUNT(m.id)::int AS unread_count
       FROM messaging.channel_members cm
       LEFT JOIN messaging.messages m
         ON m.channel_id = cm.channel_id
         AND m.is_deleted = false
         AND m.created_at > cm.last_read_at
       WHERE cm.user_id = $1
       GROUP BY cm.channel_id`,
      [userId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<{ channel_id: string; unread_count: number }> | null) ?? [];
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.channel_id] = row.unread_count;
    }
    return counts;
  }

  // ─── Blocking ──────────────────────────────────────────────

  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    const result = await this.db.rawQuery(
      `INSERT INTO messaging.user_blocks (blocker_id, blocked_id)
       VALUES ($1, $2)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      [blockerId, blockedId],
    );
    if (result.error) throw new Error(result.error.message);
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    const result = await this.db.rawQuery(
      `DELETE FROM messaging.user_blocks
       WHERE blocker_id = $1 AND blocked_id = $2`,
      [blockerId, blockedId],
    );
    if (result.error) throw new Error(result.error.message);
  }

  // ─── Helpers ────────────────────────────────────────────────

  private async checkDmBlocked(channelId: string, senderId: string): Promise<void> {
    // Get the other member of the DM channel
    const result = await this.db.rawQuery(
      `SELECT user_id FROM messaging.channel_members
       WHERE channel_id = $1 AND user_id != $2`,
      [channelId, senderId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = result.data as Array<{ user_id: string }> | null;
    if (!rows || rows.length === 0) return;

    const recipientId = rows[0].user_id;
    const blockCheck = await this.db.rawQuery(
      `SELECT 1 FROM messaging.user_blocks
       WHERE blocker_id = $1 AND blocked_id = $2`,
      [recipientId, senderId],
    );
    if (blockCheck.error) throw new Error(blockCheck.error.message);
    if ((blockCheck.data as unknown[] | null)?.length) {
      throw new ForbiddenException('You are blocked by this user');
    }
  }

  // ─── Mentions ──────────────────────────────────────────────

  parseMentions(body: string): string[] {
    const matches = body.match(/@(\w+)/g);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.slice(1)))];
  }

  async resolveUsernames(usernames: string[]): Promise<Array<{ username: string; user_id: string }>> {
    if (usernames.length === 0) return [];
    const placeholders = usernames.map((_, i) => `$${i + 1}`).join(', ');
    const result = await this.db.rawQuery(
      `SELECT id, email FROM auth.users
       WHERE split_part(email, '@', 1) IN (${placeholders})`,
      usernames,
    );
    if (result.error) {
      this.logger.warn(`Could not resolve usernames: ${result.error.message}`);
      return [];
    }
    const rows = (result.data as Array<{ id: string; email: string }> | null) ?? [];
    return rows.map(r => ({ username: r.email.split('@')[0], user_id: r.id }));
  }

  // ─── Moderation ───────────────────────────────────────────

  async deleteMessage(messageId: string, channelId: string, userId: string, userRole?: string): Promise<void> {
    await this.verifyMembership(channelId, userId);

    const msgResult = await this.db.rawQuery(
      `SELECT sender_id, channel_id FROM messaging.messages WHERE id = $1 AND channel_id = $2`,
      [messageId, channelId],
    );
    if (msgResult.error) throw new Error(msgResult.error.message);
    const msgRows = msgResult.data as Array<{ sender_id: string; channel_id: string }> | null;
    if (!msgRows || msgRows.length === 0) throw new BadRequestException('Message not found');

    const isSender = msgRows[0].sender_id === userId;
    const isSuperAdmin = userRole === 'super-admin';

    if (!isSender && !isSuperAdmin) {
      await this.verifyAdmin(channelId, userId);
    }

    const result = await this.db.rawQuery(
      `UPDATE messaging.messages SET is_deleted = true WHERE id = $1`,
      [messageId],
    );
    if (result.error) throw new Error(result.error.message);

    if (this.observability) {
      await this.observability.push({
        context: { userId, conversationId: NIL_UUID, agentSlug: 'messaging-service', agentType: 'context', provider: 'system', model: 'system' },
        source_app: 'divinr-api',
        hook_event_type: 'message_deleted',
        status: 'created',
        message: 'message deleted',
        progress: null,
        step: null,
        payload: { messageId, channelId },
        timestamp: Date.now(),
      }).catch(err => this.logger.warn(`SSE push failed: ${err}`));
    }
  }

  // ─── System & Scoped Channels ─────────────────────────────

  async createSystemChannel(name: string): Promise<Channel> {
    return this.createChannel('system', undefined, name);
  }

  async createScopedChannel(scope: 'club' | 'tournament', scopeId: string, name: string, adminUserId: string): Promise<Channel> {
    const channel = await this.createChannel(scope, scopeId, name);
    await this.addChannelMember(channel.id, adminUserId, 'admin');
    return channel;
  }

  // ─── User Search ──────────────────────────────────────────

  async searchUsers(query: string, viewerId: string): Promise<Array<{ id: string; display_name: string }>> {
    const filter = this.optOuts.applyVisibilityFilter(
      `SELECT au.id, au.email
       FROM auth.users au
       JOIN authz.users u ON u.id = au.id
       WHERE au.email ILIKE $1`,
      [`%${query}%`],
      viewerId,
      'social_messaging_enabled',
    );
    const result = await this.db.rawQuery(filter.sql + ` LIMIT 10`, filter.params);
    if (result.error) {
      this.logger.warn(`User search failed: ${result.error.message}`);
      return [];
    }
    const rows = (result.data as Array<{ id: string; email: string }> | null) ?? [];
    return rows.map(r => ({ id: r.id, display_name: r.email.split('@')[0] }));
  }

  // ─── Helpers ──────────────────────────────────────────────

  private async verifyAdmin(channelId: string, userId: string): Promise<void> {
    const result = await this.db.rawQuery(
      `SELECT role FROM messaging.channel_members
       WHERE channel_id = $1 AND user_id = $2`,
      [channelId, userId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = result.data as Array<{ role: string }> | null;
    if (!rows || rows.length === 0) {
      throw new ForbiddenException('Not a member of this channel');
    }
    if (rows[0].role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
  }

  private async verifyMembership(channelId: string, userId: string): Promise<void> {
    const result = await this.db.rawQuery(
      `SELECT 1 FROM messaging.channel_members
       WHERE channel_id = $1 AND user_id = $2`,
      [channelId, userId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = result.data as unknown[] | null;
    if (!rows || rows.length === 0) {
      throw new ForbiddenException('Not a member of this channel');
    }
  }
}
