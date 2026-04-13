import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { ClubSchemaService } from './club-schema.service';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationService } from '../markets/services/notification.service';
import type {
  Club,
  ClubMember,
  ClubInvite,
  CreateClubInput,
  UpdateClubInput,
} from './club.types';

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

@Injectable()
export class ClubService {
  private readonly logger = new Logger(ClubService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ClubSchemaService) private readonly schema: ClubSchemaService,
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Optional() @Inject(NotificationService) private readonly notifications?: NotificationService,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────

  async createClub(input: CreateClubInput, userId: string): Promise<Club> {
    await this.schema.ensureSchema();

    const id = randomUUID();
    const inviteCode = generateInviteCode();

    // Create messaging channel
    const channel = await this.messaging.createChannel('club', id, input.name);

    const result = await this.db.rawQuery(
      `INSERT INTO prediction.clubs (id, name, description, invite_code, is_public, created_by, channel_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, input.name, input.description ?? null, inviteCode, input.is_public ?? false, userId, channel.id],
    );
    if (result.error) throw new Error(result.error.message);

    // Add owner as member
    await this.db.rawQuery(
      `INSERT INTO prediction.club_members (id, club_id, user_id, role)
       VALUES ($1, $2, $3, 'owner')`,
      [randomUUID(), id, userId],
    );

    // Add owner as channel admin
    await this.messaging.addChannelMember(channel.id, userId, 'admin');

    return ((result.data as Club[] | null) ?? [])[0]!;
  }

  async listMyClubs(userId: string): Promise<Array<Club & { member_count: number; my_role: string }>> {
    await this.schema.ensureSchema();
    const result = await this.db.rawQuery(
      `SELECT c.*, cm.role as my_role,
              (SELECT COUNT(*)::int FROM prediction.club_members m WHERE m.club_id = c.id) as member_count
       FROM prediction.clubs c
       JOIN prediction.club_members cm ON cm.club_id = c.id AND cm.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Array<Club & { member_count: number; my_role: string }> | null) ?? [];
  }

  async discoverClubs(): Promise<Array<Club & { member_count: number; tournament_count: number }>> {
    await this.schema.ensureSchema();
    const result = await this.db.rawQuery(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM prediction.club_members m WHERE m.club_id = c.id) as member_count,
              (SELECT COUNT(*)::int FROM prediction.tournaments t WHERE t.scope = 'club' AND t.scope_id = c.id) as tournament_count
       FROM prediction.clubs c
       WHERE c.is_public = true
       ORDER BY member_count DESC, c.created_at DESC
       LIMIT 50`,
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Array<Club & { member_count: number; tournament_count: number }> | null) ?? [];
  }

  async getClub(id: string, userId: string): Promise<(Club & { member_count: number; my_role: string }) | null> {
    await this.schema.ensureSchema();
    const result = await this.db.rawQuery(
      `SELECT c.*, cm.role as my_role,
              (SELECT COUNT(*)::int FROM prediction.club_members m WHERE m.club_id = c.id) as member_count
       FROM prediction.clubs c
       JOIN prediction.club_members cm ON cm.club_id = c.id AND cm.user_id = $2
       WHERE c.id = $1`,
      [id, userId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<Club & { member_count: number; my_role: string }> | null) ?? [];
    return rows[0] ?? null;
  }

  async updateClub(id: string, input: UpdateClubInput, userId: string): Promise<Club> {
    await this.schema.ensureSchema();
    await this.requireRole(id, userId, ['owner', 'admin']);

    const sets: string[] = [];
    const params: unknown[] = [id];
    let idx = 2;

    if (input.name !== undefined) { sets.push(`name = $${idx}`); params.push(input.name); idx++; }
    if (input.description !== undefined) { sets.push(`description = $${idx}`); params.push(input.description); idx++; }
    if (input.is_public !== undefined) { sets.push(`is_public = $${idx}`); params.push(input.is_public); idx++; }

    if (sets.length === 0) {
      const existing = await this.db.rawQuery(`SELECT * FROM prediction.clubs WHERE id = $1`, [id]);
      return ((existing.data as Club[] | null) ?? [])[0]!;
    }

    const result = await this.db.rawQuery(
      `UPDATE prediction.clubs SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as Club[] | null) ?? [])[0]!;
  }

  async deleteClub(id: string, userId: string): Promise<void> {
    await this.schema.ensureSchema();
    await this.requireRole(id, userId, ['owner']);

    // Get channel for archival
    const club = await this.db.rawQuery(`SELECT channel_id FROM prediction.clubs WHERE id = $1`, [id]);
    const channelId = ((club.data as Array<{ channel_id: string | null }> | null) ?? [])[0]?.channel_id;

    // Cascade delete: journals, votes, poll, responses, challenges, analysts, invites, members, club
    await this.db.rawQuery(`DELETE FROM prediction.club_strategy_journals WHERE club_id = $1`, [id]);
    await this.db.rawQuery(`DELETE FROM prediction.club_consensus_votes WHERE poll_id IN (SELECT id FROM prediction.club_consensus_polls WHERE club_id = $1)`, [id]);
    await this.db.rawQuery(`DELETE FROM prediction.club_consensus_polls WHERE club_id = $1`, [id]);
    await this.db.rawQuery(`DELETE FROM prediction.club_challenge_responses WHERE challenge_id IN (SELECT id FROM prediction.club_prediction_challenges WHERE club_id = $1)`, [id]);
    await this.db.rawQuery(`DELETE FROM prediction.club_prediction_challenges WHERE club_id = $1`, [id]);
    await this.db.rawQuery(`DELETE FROM prediction.club_analysts WHERE club_id = $1`, [id]);
    await this.db.rawQuery(`DELETE FROM prediction.club_invites WHERE club_id = $1`, [id]);
    await this.db.rawQuery(`DELETE FROM prediction.club_members WHERE club_id = $1`, [id]);
    await this.db.rawQuery(`DELETE FROM prediction.clubs WHERE id = $1`, [id]);

    // Archive messaging channel
    if (channelId) {
      await this.db.rawQuery(`UPDATE messaging.channels SET is_archived = true WHERE id = $1`, [channelId]);
    }
  }

  // ─── Membership ────────────────────────────────────────────────

  async joinClub(id: string, code: string, userId: string): Promise<ClubMember> {
    await this.schema.ensureSchema();

    // Validate invite code
    const clubResult = await this.db.rawQuery(
      `SELECT * FROM prediction.clubs WHERE id = $1 AND invite_code = $2`,
      [id, code],
    );
    if (clubResult.error) throw new Error(clubResult.error.message);
    const clubs = (clubResult.data as Club[] | null) ?? [];
    if (clubs.length === 0) throw new Error('Invalid invite code');

    const memberId = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.club_members (id, club_id, user_id, role)
       VALUES ($1, $2, $3, 'member')
       RETURNING *`,
      [memberId, id, userId],
    );
    if (result.error) {
      if (result.error.message.includes('unique') || result.error.message.includes('duplicate')) {
        throw new Error('Already a member of this club');
      }
      throw new Error(result.error.message);
    }

    // Add to messaging channel
    const club = clubs[0]!;
    if (club.channel_id) {
      await this.messaging.addChannelMember(club.channel_id, userId, 'member');
    }

    return ((result.data as ClubMember[] | null) ?? [])[0]!;
  }

  async leaveClub(id: string, userId: string): Promise<void> {
    await this.schema.ensureSchema();

    // Owner cannot leave
    const member = await this.getMember(id, userId);
    if (!member) throw new Error('Not a member of this club');
    if (member.role === 'owner') throw new Error('Owner cannot leave the club');

    await this.db.rawQuery(
      `DELETE FROM prediction.club_members WHERE club_id = $1 AND user_id = $2`,
      [id, userId],
    );

    // Remove from messaging channel
    const club = await this.db.rawQuery(`SELECT channel_id FROM prediction.clubs WHERE id = $1`, [id]);
    const channelId = ((club.data as Array<{ channel_id: string | null }> | null) ?? [])[0]?.channel_id;
    if (channelId) {
      await this.db.rawQuery(
        `DELETE FROM messaging.channel_members WHERE channel_id = $1 AND user_id = $2`,
        [channelId, userId],
      );
    }
  }

  async listMembers(clubId: string, userId: string): Promise<ClubMember[]> {
    await this.schema.ensureSchema();
    await this.requireMembership(clubId, userId);

    const result = await this.db.rawQuery(
      `SELECT cm.*, u.display_name
       FROM prediction.club_members cm
       LEFT JOIN authz.users u ON u.id = cm.user_id
       WHERE cm.club_id = $1
       ORDER BY CASE cm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, cm.joined_at ASC`,
      [clubId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as ClubMember[] | null) ?? [];
  }

  async promoteMember(clubId: string, targetUserId: string, userId: string): Promise<void> {
    await this.schema.ensureSchema();
    await this.requireRole(clubId, userId, ['owner']);
    await this.db.rawQuery(
      `UPDATE prediction.club_members SET role = 'admin' WHERE club_id = $1 AND user_id = $2 AND role = 'member'`,
      [clubId, targetUserId],
    );
  }

  async demoteMember(clubId: string, targetUserId: string, userId: string): Promise<void> {
    await this.schema.ensureSchema();
    await this.requireRole(clubId, userId, ['owner']);

    const target = await this.getMember(clubId, targetUserId);
    if (!target) throw new Error('Target user is not a member');
    if (target.role === 'owner') throw new Error('Cannot demote the owner');

    await this.db.rawQuery(
      `UPDATE prediction.club_members SET role = 'member' WHERE club_id = $1 AND user_id = $2`,
      [clubId, targetUserId],
    );
  }

  async removeMember(clubId: string, targetUserId: string, userId: string): Promise<void> {
    await this.schema.ensureSchema();
    await this.requireRole(clubId, userId, ['owner', 'admin']);

    const target = await this.getMember(clubId, targetUserId);
    if (!target) throw new Error('Target user is not a member');
    if (target.role === 'owner') throw new Error('Cannot remove the owner');

    await this.db.rawQuery(
      `DELETE FROM prediction.club_members WHERE club_id = $1 AND user_id = $2`,
      [clubId, targetUserId],
    );

    // Remove from messaging channel
    const club = await this.db.rawQuery(`SELECT channel_id FROM prediction.clubs WHERE id = $1`, [clubId]);
    const channelId = ((club.data as Array<{ channel_id: string | null }> | null) ?? [])[0]?.channel_id;
    if (channelId) {
      await this.db.rawQuery(
        `DELETE FROM messaging.channel_members WHERE channel_id = $1 AND user_id = $2`,
        [channelId, targetUserId],
      );
    }
  }

  // ─── Invites ───────────────────────────────────────────────────

  async createInvite(clubId: string, userId: string, input?: { email?: string; username?: string }): Promise<ClubInvite | { token: string }> {
    await this.schema.ensureSchema();
    await this.requireRole(clubId, userId, ['owner', 'admin']);

    const token = randomUUID();
    const id = randomUUID();

    if (input?.username) {
      // Look up user
      const userResult = await this.db.rawQuery(
        `SELECT id, display_name FROM authz.users WHERE display_name = $1 OR email = $1 LIMIT 1`,
        [input.username],
      );
      const users = (userResult.data as Array<{ id: string }> | null) ?? [];
      if (users.length === 0) throw new Error(`User not found: ${input.username}`);

      const result = await this.db.rawQuery(
        `INSERT INTO prediction.club_invites (id, club_id, invite_token, invited_by, invited_user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, clubId, token, userId, users[0].id],
      );
      if (result.error) throw new Error(result.error.message);

      // Send notification
      if (this.notifications) {
        const club = await this.db.rawQuery(`SELECT name FROM prediction.clubs WHERE id = $1`, [clubId]);
        const clubName = ((club.data as Array<{ name: string }> | null) ?? [])[0]?.name ?? 'a club';
        await this.notifications.notify(users[0].id, {
          event_type: 'tournament_starting',
          urgency: 'actionable',
          title: `You've been invited to ${clubName}!`,
          summary: `Join this Investment Learning Club to practice AI-assisted market analysis together.`,
          link_to: `/clubs/invite/${token}`,
        });
      }

      return ((result.data as ClubInvite[] | null) ?? [])[0]!;
    }

    if (input?.email) {
      const userResult = await this.db.rawQuery(`SELECT id FROM authz.users WHERE email = $1 LIMIT 1`, [input.email]);
      const users = (userResult.data as Array<{ id: string }> | null) ?? [];

      const result = await this.db.rawQuery(
        `INSERT INTO prediction.club_invites (id, club_id, invite_token, invited_by, invited_user_id, invited_email)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [id, clubId, token, userId, users[0]?.id ?? null, input.email],
      );
      if (result.error) throw new Error(result.error.message);

      if (users[0]?.id && this.notifications) {
        const club = await this.db.rawQuery(`SELECT name FROM prediction.clubs WHERE id = $1`, [clubId]);
        const clubName = ((club.data as Array<{ name: string }> | null) ?? [])[0]?.name ?? 'a club';
        await this.notifications.notify(users[0].id, {
          event_type: 'tournament_starting',
          urgency: 'actionable',
          title: `You've been invited to ${clubName}!`,
          summary: `Join this Investment Learning Club to practice AI-assisted market analysis together.`,
          link_to: `/clubs/invite/${token}`,
        });
      }

      return ((result.data as ClubInvite[] | null) ?? [])[0]!;
    }

    // Generate shareable link invite
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.club_invites (id, club_id, invite_token, invited_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, clubId, token, userId],
    );
    if (result.error) throw new Error(result.error.message);
    return { token };
  }

  async getInviteDetails(token: string): Promise<{ club: Club; invite: ClubInvite; member_count: number }> {
    await this.schema.ensureSchema();

    const inviteResult = await this.db.rawQuery(
      `SELECT * FROM prediction.club_invites WHERE invite_token = $1`,
      [token],
    );
    if (inviteResult.error) throw new Error(inviteResult.error.message);
    const invites = (inviteResult.data as ClubInvite[] | null) ?? [];
    if (invites.length === 0) throw new Error('Invalid invite token');

    const invite = invites[0]!;
    const clubResult = await this.db.rawQuery(
      `SELECT c.*, (SELECT COUNT(*)::int FROM prediction.club_members m WHERE m.club_id = c.id) as member_count
       FROM prediction.clubs c WHERE c.id = $1`,
      [invite.club_id],
    );
    if (clubResult.error) throw new Error(clubResult.error.message);
    const clubs = (clubResult.data as Array<Club & { member_count: number }> | null) ?? [];
    if (clubs.length === 0) throw new Error('Club not found');

    return { club: clubs[0]!, invite, member_count: (clubs[0] as unknown as { member_count: number }).member_count };
  }

  async acceptInvite(token: string, userId: string): Promise<ClubMember> {
    await this.schema.ensureSchema();

    const inviteResult = await this.db.rawQuery(
      `SELECT * FROM prediction.club_invites WHERE invite_token = $1 AND status = 'pending'`,
      [token],
    );
    if (inviteResult.error) throw new Error(inviteResult.error.message);
    const invites = (inviteResult.data as ClubInvite[] | null) ?? [];
    if (invites.length === 0) throw new Error('Invalid or already used invite');

    const invite = invites[0]!;

    // Mark accepted
    await this.db.rawQuery(
      `UPDATE prediction.club_invites SET status = 'accepted' WHERE id = $1`,
      [invite.id],
    );

    // Join club
    const memberId = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.club_members (id, club_id, user_id, role)
       VALUES ($1, $2, $3, 'member')
       RETURNING *`,
      [memberId, invite.club_id, userId],
    );
    if (result.error) {
      if (result.error.message.includes('unique') || result.error.message.includes('duplicate')) {
        throw new Error('Already a member of this club');
      }
      throw new Error(result.error.message);
    }

    // Add to messaging channel
    const club = await this.db.rawQuery(`SELECT channel_id FROM prediction.clubs WHERE id = $1`, [invite.club_id]);
    const channelId = ((club.data as Array<{ channel_id: string | null }> | null) ?? [])[0]?.channel_id;
    if (channelId) {
      await this.messaging.addChannelMember(channelId, userId, 'member');
    }

    return ((result.data as ClubMember[] | null) ?? [])[0]!;
  }

  // ─── Club Tournaments ──────────────────────────────────────────

  async getClubTournaments(clubId: string, userId: string): Promise<unknown[]> {
    await this.schema.ensureSchema();
    await this.requireMembership(clubId, userId);

    const result = await this.db.rawQuery(
      `SELECT * FROM prediction.tournaments
       WHERE scope = 'club' AND scope_id = $1
       ORDER BY starts_at DESC LIMIT 20`,
      [clubId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as unknown[] | null) ?? [];
  }

  // ─── Helpers ───────────────────────────────────────────────────

  async getMember(clubId: string, userId: string): Promise<ClubMember | null> {
    const result = await this.db.rawQuery(
      `SELECT * FROM prediction.club_members WHERE club_id = $1 AND user_id = $2`,
      [clubId, userId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as ClubMember[] | null) ?? [];
    return rows[0] ?? null;
  }

  async requireMembership(clubId: string, userId: string): Promise<ClubMember> {
    const member = await this.getMember(clubId, userId);
    if (!member) throw new Error('Not a member of this club');
    return member;
  }

  async requireRole(clubId: string, userId: string, roles: string[]): Promise<ClubMember> {
    const member = await this.requireMembership(clubId, userId);
    if (!roles.includes(member.role)) {
      throw new Error(`Requires ${roles.join(' or ')} role`);
    }
    return member;
  }
}
