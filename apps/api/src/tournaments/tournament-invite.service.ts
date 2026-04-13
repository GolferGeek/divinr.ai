import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { TournamentSchemaService } from './tournament-schema.service';
import { TournamentPortfolioService } from './tournament-portfolio.service';
import { NotificationService } from '../markets/services/notification.service';
import type { Tournament, TournamentInvite, TournamentEntry } from './tournament.types';

@Injectable()
export class TournamentInviteService {
  private readonly logger = new Logger(TournamentInviteService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(TournamentSchemaService) private readonly schema: TournamentSchemaService,
    @Inject(TournamentPortfolioService) private readonly portfolio: TournamentPortfolioService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  async createInviteLink(tournamentId: string, userId: string): Promise<{ token: string }> {
    await this.schema.ensureSchema();

    const tournament = await this.getTournament(tournamentId);
    if (tournament.scope !== 'invitation') {
      throw new Error('Invite links are only available for invitation-scope tournaments');
    }

    // Rate limit: max 50 invites per user per tournament
    const countResult = await this.db.rawQuery(
      `SELECT COUNT(*)::int as count FROM prediction.tournament_invites
       WHERE tournament_id = $1 AND invited_by = $2`,
      [tournamentId, userId],
    );
    const count = ((countResult.data as Array<{ count: number }> | null) ?? [{ count: 0 }])[0].count;
    if (count >= 50) {
      throw new Error('Maximum invite limit reached (50 per tournament)');
    }

    const token = randomUUID();
    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.tournament_invites (id, tournament_id, invite_token, invited_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, tournamentId, token, userId],
    );
    if (result.error) throw new Error(result.error.message);

    return { token };
  }

  async inviteByUsername(tournamentId: string, inviterId: string, username: string): Promise<TournamentInvite> {
    await this.schema.ensureSchema();

    const tournament = await this.getTournament(tournamentId);
    if (tournament.scope !== 'invitation') {
      throw new Error('Direct invites are only available for invitation-scope tournaments');
    }

    // Look up user by display_name or email
    const userResult = await this.db.rawQuery(
      `SELECT id, display_name, email FROM authz.users
       WHERE display_name = $1 OR email = $1
       LIMIT 1`,
      [username],
    );
    if (userResult.error) throw new Error(userResult.error.message);
    const users = (userResult.data as Array<{ id: string; display_name: string; email: string }> | null) ?? [];
    if (users.length === 0) throw new Error(`User not found: ${username}`);

    const targetUser = users[0];
    const token = randomUUID();
    const id = randomUUID();

    const result = await this.db.rawQuery(
      `INSERT INTO prediction.tournament_invites (id, tournament_id, invite_token, invited_by, invited_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, tournamentId, token, inviterId, targetUser.id],
    );
    if (result.error) throw new Error(result.error.message);

    // Send in-app notification
    await this.notifications.notify(targetUser.id, {
      event_type: 'tournament_starting',
      urgency: 'actionable',
      title: `You've been invited to a tournament!`,
      summary: `Join "${tournament.name}" — a ${tournament.tournament_type.replace(/_/g, ' ')} competition.`,
      link_to: `/tournaments/invite/${token}`,
    });

    return ((result.data as TournamentInvite[] | null) ?? [])[0]!;
  }

  async inviteByEmail(tournamentId: string, inviterId: string, email: string): Promise<TournamentInvite> {
    await this.schema.ensureSchema();

    const tournament = await this.getTournament(tournamentId);
    if (tournament.scope !== 'invitation') {
      throw new Error('Direct invites are only available for invitation-scope tournaments');
    }

    const token = randomUUID();
    const id = randomUUID();

    // Check if user exists with this email
    const userResult = await this.db.rawQuery(
      `SELECT id FROM authz.users WHERE email = $1 LIMIT 1`,
      [email],
    );
    const users = (userResult.data as Array<{ id: string }> | null) ?? [];
    const invitedUserId = users.length > 0 ? users[0].id : null;

    const result = await this.db.rawQuery(
      `INSERT INTO prediction.tournament_invites (id, tournament_id, invite_token, invited_by, invited_user_id, invited_email)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, tournamentId, token, inviterId, invitedUserId, email],
    );
    if (result.error) throw new Error(result.error.message);

    // If user exists, send notification
    if (invitedUserId) {
      await this.notifications.notify(invitedUserId, {
        event_type: 'tournament_starting',
        urgency: 'actionable',
        title: `You've been invited to a tournament!`,
        summary: `Join "${tournament.name}" — a ${tournament.tournament_type.replace(/_/g, ' ')} competition.`,
        link_to: `/tournaments/invite/${token}`,
      });
    }

    return ((result.data as TournamentInvite[] | null) ?? [])[0]!;
  }

  async getInviteDetails(token: string): Promise<{ tournament: Tournament; invite: TournamentInvite; entrant_count: number }> {
    await this.schema.ensureSchema();

    const inviteResult = await this.db.rawQuery(
      `SELECT * FROM prediction.tournament_invites WHERE invite_token = $1`,
      [token],
    );
    if (inviteResult.error) throw new Error(inviteResult.error.message);
    const invites = (inviteResult.data as TournamentInvite[] | null) ?? [];
    if (invites.length === 0) throw new Error('Invalid invite token');

    const invite = invites[0]!;
    const tournament = await this.getTournament(invite.tournament_id);

    const countResult = await this.db.rawQuery(
      `SELECT COUNT(*)::int as count FROM prediction.tournament_entries WHERE tournament_id = $1`,
      [invite.tournament_id],
    );
    const entrantCount = ((countResult.data as Array<{ count: number }> | null) ?? [{ count: 0 }])[0].count;

    return { tournament, invite, entrant_count: entrantCount };
  }

  async acceptInvite(token: string, userId: string): Promise<TournamentEntry> {
    await this.schema.ensureSchema();

    // Validate invite
    const inviteResult = await this.db.rawQuery(
      `SELECT * FROM prediction.tournament_invites WHERE invite_token = $1`,
      [token],
    );
    if (inviteResult.error) throw new Error(inviteResult.error.message);
    const invites = (inviteResult.data as TournamentInvite[] | null) ?? [];
    if (invites.length === 0) throw new Error('Invalid invite token');

    const invite = invites[0]!;
    if (invite.status !== 'pending') {
      throw new Error('This invite has already been used');
    }

    // Validate tournament status
    const tournament = await this.getTournament(invite.tournament_id);
    if (tournament.status !== 'upcoming' && tournament.status !== 'active') {
      throw new Error('Tournament is not accepting entries');
    }

    // Mark invite as accepted
    await this.db.rawQuery(
      `UPDATE prediction.tournament_invites SET status = 'accepted' WHERE id = $1`,
      [invite.id],
    );

    // Enter tournament
    return this.portfolio.enterTournament(invite.tournament_id, userId);
  }

  private async getTournament(id: string): Promise<Tournament> {
    const result = await this.db.rawQuery(
      `SELECT * FROM prediction.tournaments WHERE id = $1`,
      [id],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Tournament[] | null) ?? [];
    if (rows.length === 0) throw new Error('Tournament not found');
    return rows[0]!;
  }
}
