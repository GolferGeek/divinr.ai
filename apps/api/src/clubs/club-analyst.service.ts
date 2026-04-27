import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { ClubSchemaService } from './club-schema.service';
import { ClubService } from './club.service';
import type { ClubAnalyst } from './club.types';

@Injectable()
export class ClubAnalystService {
  private readonly logger = new Logger(ClubAnalystService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ClubSchemaService) private readonly schema: ClubSchemaService,
    @Inject(ClubService) private readonly clubs: ClubService,
  ) {}

  async createClubAnalyst(
    clubId: string,
    input: { slug: string; display_name: string; persona_prompt: string; analyst_type?: string; workflow_scope?: string },
    userId: string,
  ): Promise<{ analyst_id: string; club_analyst_id: string }> {
    await this.clubs.requireRole(clubId, userId, ['owner', 'admin']);

    // Rate limit: max 10 analysts per club
    const countResult = await this.db.rawQuery(
      `SELECT COUNT(*)::int as count FROM prediction.club_analysts WHERE club_id = $1`,
      [clubId],
    );
    const count = ((countResult.data as Array<{ count: number }> | null) ?? [{ count: 0 }])[0].count;
    if (count >= 10) throw new Error('Maximum 10 analysts per club');

    // Create the market_analysts row
    const analystId = randomUUID();
    const slug = `club-${clubId.slice(0, 8)}-${input.slug.trim().toLowerCase()}`;
    const now = new Date().toISOString();

    const insertResult = await this.db.rawQuery(
      `INSERT INTO prediction.market_analysts
        (id, user_id, slug, display_name, name, persona_prompt, analyst_type,
         default_weight, tier_instructions, is_system_default, is_enabled, is_active,
         workflow_scope, domain_slug, learning_enabled, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1.0, '{}', false, true, true, $8, 'financial', true, $9, $10, $11)
       ON CONFLICT (slug) DO UPDATE SET display_name = excluded.display_name, persona_prompt = excluded.persona_prompt, updated_at = excluded.updated_at
       RETURNING id`,
      [
        analystId, userId, slug, input.display_name.trim(), input.display_name.trim(),
        input.persona_prompt.trim(), input.analyst_type ?? 'personality',
        input.workflow_scope ?? 'both', userId, now, now,
      ],
    );
    if (insertResult.error) throw new Error(insertResult.error.message);
    const createdId = ((insertResult.data as Array<{ id: string }> | null) ?? [])[0]?.id ?? analystId;

    // Create initial config version
    const versionId = randomUUID();
    await this.db.rawQuery(
      `INSERT INTO prediction.analyst_config_versions
        (id, analyst_id, version_number, persona_prompt, tier_instructions, default_weight,
         source, change_reason, is_active, created_by, created_at)
       VALUES ($1, $2, 1, $3, '{}', 1.0, 'manual', 'Initial club analyst creation', true, $4, $5)
       ON CONFLICT DO NOTHING`,
      [versionId, createdId, input.persona_prompt.trim(), userId, now],
    );

    await this.db.rawQuery(
      `UPDATE prediction.market_analysts SET current_config_version_id = $1 WHERE id = $2`,
      [versionId, createdId],
    );

    // Create junction row
    const clubAnalystId = randomUUID();
    const junctionResult = await this.db.rawQuery(
      `INSERT INTO prediction.club_analysts (id, club_id, analyst_id, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [clubAnalystId, clubId, createdId, userId],
    );
    if (junctionResult.error) throw new Error(junctionResult.error.message);

    this.logger.log(`Club analyst created: ${slug} for club ${clubId}`);
    return { analyst_id: createdId, club_analyst_id: clubAnalystId };
  }

  async listClubAnalysts(clubId: string, userId: string): Promise<Array<{ analyst_id: string; slug: string; display_name: string; persona_prompt: string; created_at: string }>> {
    await this.clubs.requireMembership(clubId, userId);

    const result = await this.db.rawQuery(
      `SELECT ma.id as analyst_id, ma.slug, ma.display_name, ma.persona_prompt, ca.created_at
       FROM prediction.club_analysts ca
       JOIN prediction.market_analysts ma ON ma.id = ca.analyst_id
       WHERE ca.club_id = $1
       ORDER BY ca.created_at ASC`,
      [clubId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Array<{ analyst_id: string; slug: string; display_name: string; persona_prompt: string; created_at: string }> | null) ?? [];
  }

  async getClubAnalystContract(clubId: string, analystId: string, userId: string): Promise<unknown> {
    await this.clubs.requireMembership(clubId, userId);

    // Verify analyst belongs to club
    const jResult = await this.db.rawQuery(
      `SELECT 1 FROM prediction.club_analysts WHERE club_id = $1 AND analyst_id = $2`,
      [clubId, analystId],
    );
    if (((jResult.data as Array<unknown> | null) ?? []).length === 0) {
      throw new Error('Analyst not found in this club');
    }

    const result = await this.db.rawQuery(
      `SELECT ma.*, acv.context_markdown, acv.version_number, acv.source, acv.change_reason, acv.created_at as version_created_at
       FROM prediction.market_analysts ma
       LEFT JOIN prediction.analyst_config_versions acv ON acv.id = ma.current_config_version_id
       WHERE ma.id = $1`,
      [analystId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<unknown> | null) ?? [];
    if (rows.length === 0) throw new Error('Analyst not found');
    return rows[0];
  }

  async updateClubAnalystContract(
    clubId: string,
    analystId: string,
    input: { persona_prompt?: string; context_markdown?: string; change_reason?: string },
    userId: string,
  ): Promise<void> {
    await this.clubs.requireRole(clubId, userId, ['owner', 'admin']);

    // Verify analyst belongs to club
    const jResult = await this.db.rawQuery(
      `SELECT 1 FROM prediction.club_analysts WHERE club_id = $1 AND analyst_id = $2`,
      [clubId, analystId],
    );
    if (((jResult.data as Array<unknown> | null) ?? []).length === 0) {
      throw new Error('Analyst not found in this club');
    }

    // Get current version number
    const vResult = await this.db.rawQuery(
      `SELECT COALESCE(MAX(version_number), 0)::int as max_ver FROM prediction.analyst_config_versions WHERE analyst_id = $1`,
      [analystId],
    );
    const maxVer = ((vResult.data as Array<{ max_ver: number }> | null) ?? [{ max_ver: 0 }])[0].max_ver;

    const versionId = randomUUID();
    const now = new Date().toISOString();

    // Get current values for fallback
    const current = await this.db.rawQuery(
      `SELECT persona_prompt FROM prediction.market_analysts WHERE id = $1`,
      [analystId],
    );
    const currentPrompt = ((current.data as Array<{ persona_prompt: string }> | null) ?? [])[0]?.persona_prompt ?? '';

    await this.db.rawQuery(
      `INSERT INTO prediction.analyst_config_versions
        (id, analyst_id, version_number, persona_prompt, context_markdown, tier_instructions, default_weight,
         source, change_reason, is_active, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, '{}', 1.0, 'manual', $6, true, $7, $8)`,
      [versionId, analystId, maxVer + 1, input.persona_prompt ?? currentPrompt, input.context_markdown ?? null, input.change_reason ?? 'Club admin update', userId, now],
    );

    // Update analyst
    if (input.persona_prompt) {
      await this.db.rawQuery(
        `UPDATE prediction.market_analysts SET persona_prompt = $1, current_config_version_id = $2, updated_at = $3 WHERE id = $4`,
        [input.persona_prompt, versionId, now, analystId],
      );
    } else {
      await this.db.rawQuery(
        `UPDATE prediction.market_analysts SET current_config_version_id = $1, updated_at = $2 WHERE id = $3`,
        [versionId, now, analystId],
      );
    }
  }
}
