import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { TournamentSchemaService } from './tournament-schema.service';
import type {
  Tournament,
  CreateTournamentInput,
  UpdateTournamentInput,
  ListTournamentsFilters,
} from './tournament.types';

@Injectable()
export class TournamentService {
  private readonly logger = new Logger(TournamentService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(TournamentSchemaService) private readonly schema: TournamentSchemaService,
  ) {}

  async createTournament(input: CreateTournamentInput, userId: string, userRole?: string): Promise<Tournament> {
    await this.schema.ensureSchema();

    if (input.scope === 'system' && userRole !== 'admin') {
      throw new Error('Only admins can create system tournaments');
    }

    // Club scope: validate club exists and user is admin/owner
    if (input.scope === 'club') {
      if (!input.scope_id) throw new Error('scope_id (club ID) is required for club tournaments');
      const clubCheck = await this.db.rawQuery(
        `SELECT cm.role FROM prediction.club_members cm WHERE cm.club_id = $1 AND cm.user_id = $2`,
        [input.scope_id, userId],
      );
      const members = (clubCheck.data as Array<{ role: string }> | null) ?? [];
      if (members.length === 0) throw new Error('Not a member of this club');
      if (!['owner', 'admin'].includes(members[0].role)) throw new Error('Only club admins can create club tournaments');
    }

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.tournaments
        (id, name, description, scope, scope_id, tournament_type, status,
         created_by, starting_balance, allowed_instruments, analyst_draft_config,
         starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'upcoming', $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        id, input.name, input.description ?? null,
        input.scope, input.scope_id ?? null,
        input.tournament_type, userId, input.starting_balance,
        input.allowed_instruments ? JSON.stringify(input.allowed_instruments) : null,
        input.analyst_draft_config ? JSON.stringify(input.analyst_draft_config) : null,
        input.starts_at, input.ends_at,
      ],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Tournament[] | null) ?? [];
    return rows[0]!;
  }

  async listTournaments(userId: string, filters: ListTournamentsFilters = {}): Promise<Tournament[]> {
    await this.schema.ensureSchema();

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // System tournaments visible to all; club visible to club members; invitation visible to creator or invitees
    conditions.push(`(
      t.scope = 'system'
      OR t.created_by = $${paramIndex}
      OR EXISTS (
        SELECT 1 FROM prediction.tournament_entries te WHERE te.tournament_id = t.id AND te.user_id = $${paramIndex}
      )
      OR EXISTS (
        SELECT 1 FROM prediction.tournament_invites ti WHERE ti.tournament_id = t.id AND ti.invited_user_id = $${paramIndex} AND ti.status = 'pending'
      )
      OR (t.scope = 'club' AND EXISTS (
        SELECT 1 FROM prediction.club_members cm WHERE cm.club_id = t.scope_id AND cm.user_id = $${paramIndex}
      ))
    )`);
    params.push(userId);
    paramIndex++;

    if (filters.scope) {
      conditions.push(`t.scope = $${paramIndex}`);
      params.push(filters.scope);
      paramIndex++;
    }
    if (filters.status) {
      conditions.push(`t.status = $${paramIndex}`);
      params.push(filters.status);
      paramIndex++;
    }
    if (filters.tournament_type) {
      conditions.push(`t.tournament_type = $${paramIndex}`);
      params.push(filters.tournament_type);
      paramIndex++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.db.rawQuery(
      `SELECT t.* FROM prediction.tournaments t ${where} ORDER BY t.starts_at DESC LIMIT 100`,
      params,
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Tournament[] | null) ?? [];
  }

  async getTournament(id: string, userId: string): Promise<Tournament | null> {
    await this.schema.ensureSchema();

    const result = await this.db.rawQuery(
      `SELECT t.* FROM prediction.tournaments t
       WHERE t.id = $1
         AND (
           t.scope = 'system'
           OR t.created_by = $2
           OR EXISTS (SELECT 1 FROM prediction.tournament_entries te WHERE te.tournament_id = t.id AND te.user_id = $2)
           OR EXISTS (SELECT 1 FROM prediction.tournament_invites ti WHERE ti.tournament_id = t.id AND ti.invited_user_id = $2 AND ti.status = 'pending')
           OR (t.scope = 'club' AND EXISTS (SELECT 1 FROM prediction.club_members cm WHERE cm.club_id = t.scope_id AND cm.user_id = $2))
         )`,
      [id, userId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Tournament[] | null) ?? [];
    return rows[0] ?? null;
  }

  async updateTournament(id: string, input: UpdateTournamentInput, userId: string, userRole?: string): Promise<Tournament> {
    await this.schema.ensureSchema();

    // Fetch tournament to check ownership and status
    const existing = await this.db.rawQuery(
      `SELECT * FROM prediction.tournaments WHERE id = $1`,
      [id],
    );
    if (existing.error) throw new Error(existing.error.message);
    const rows = (existing.data as Tournament[] | null) ?? [];
    if (rows.length === 0) throw new Error('Tournament not found');

    const tournament = rows[0]!;
    if (tournament.status !== 'upcoming') {
      throw new Error('Can only update upcoming tournaments');
    }
    if (tournament.created_by !== userId && userRole !== 'admin') {
      throw new Error('Only the creator or an admin can update this tournament');
    }

    const sets: string[] = [];
    const params: unknown[] = [id];
    let paramIndex = 2;

    if (input.name !== undefined) { sets.push(`name = $${paramIndex}`); params.push(input.name); paramIndex++; }
    if (input.description !== undefined) { sets.push(`description = $${paramIndex}`); params.push(input.description); paramIndex++; }
    if (input.starting_balance !== undefined) { sets.push(`starting_balance = $${paramIndex}`); params.push(input.starting_balance); paramIndex++; }
    if (input.allowed_instruments !== undefined) { sets.push(`allowed_instruments = $${paramIndex}`); params.push(JSON.stringify(input.allowed_instruments)); paramIndex++; }
    if (input.analyst_draft_config !== undefined) { sets.push(`analyst_draft_config = $${paramIndex}`); params.push(JSON.stringify(input.analyst_draft_config)); paramIndex++; }
    if (input.starts_at !== undefined) { sets.push(`starts_at = $${paramIndex}`); params.push(input.starts_at); paramIndex++; }
    if (input.ends_at !== undefined) { sets.push(`ends_at = $${paramIndex}`); params.push(input.ends_at); paramIndex++; }

    if (sets.length === 0) return tournament;

    const result = await this.db.rawQuery(
      `UPDATE prediction.tournaments SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as Tournament[] | null) ?? [])[0]!;
  }

  async archiveTournament(id: string, userId: string, userRole?: string): Promise<Tournament> {
    await this.schema.ensureSchema();

    const existing = await this.db.rawQuery(
      `SELECT * FROM prediction.tournaments WHERE id = $1`,
      [id],
    );
    if (existing.error) throw new Error(existing.error.message);
    const rows = (existing.data as Tournament[] | null) ?? [];
    if (rows.length === 0) throw new Error('Tournament not found');

    const tournament = rows[0]!;
    if (tournament.status !== 'completed') {
      throw new Error('Can only archive completed tournaments');
    }
    if (tournament.created_by !== userId && userRole !== 'admin') {
      throw new Error('Only the creator or an admin can archive this tournament');
    }

    const result = await this.db.rawQuery(
      `UPDATE prediction.tournaments SET status = 'archived' WHERE id = $1 RETURNING *`,
      [id],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as Tournament[] | null) ?? [])[0]!;
  }
}
