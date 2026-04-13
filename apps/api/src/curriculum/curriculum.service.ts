import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { CurriculumSchemaService } from './curriculum-schema.service';
import { ClubService } from '../clubs/club.service';
import { ClubActivityService } from '../clubs/club-activity.service';
import type {
  Curriculum,
  CurriculumModule,
  CurriculumEnrollment,
  CurriculumModuleProgress,
  CreateCurriculumInput,
  UpdateCurriculumInput,
  UpdateModuleInput,
} from './curriculum.types';

@Injectable()
export class CurriculumService {
  private readonly logger = new Logger(CurriculumService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(CurriculumSchemaService) private readonly schema: CurriculumSchemaService,
    @Inject(ClubService) private readonly clubService: ClubService,
    @Inject(ClubActivityService) private readonly activityService: ClubActivityService,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────

  async createCurriculum(input: CreateCurriculumInput, userId: string): Promise<Curriculum & { modules: CurriculumModule[] }> {
    await this.schema.ensureSchema();
    await this.clubService.requireRole(input.club_id, userId, ['owner', 'admin']);

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.curricula (id, club_id, name, description, week_count, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, input.club_id, input.name, input.description ?? null, input.week_count, userId],
    );
    if (result.error) throw new Error(result.error.message);

    const curriculum = ((result.data as Curriculum[] | null) ?? [])[0]!;

    // Auto-create empty module rows for each week
    const modules: CurriculumModule[] = [];
    for (let week = 1; week <= input.week_count; week++) {
      const moduleId = randomUUID();
      const modResult = await this.db.rawQuery(
        `INSERT INTO prediction.curriculum_modules (id, curriculum_id, week_number)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [moduleId, id, week],
      );
      if (modResult.error) throw new Error(modResult.error.message);
      const mod = ((modResult.data as CurriculumModule[] | null) ?? [])[0]!;
      modules.push(mod);
    }

    return { ...curriculum, modules };
  }

  async listCurricula(clubId: string, userId: string): Promise<Array<Curriculum & { enrolled_count: number }>> {
    await this.schema.ensureSchema();
    await this.clubService.requireMembership(clubId, userId);

    const result = await this.db.rawQuery(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM prediction.curriculum_enrollments e WHERE e.curriculum_id = c.id) as enrolled_count
       FROM prediction.curricula c
       WHERE c.club_id = $1
       ORDER BY c.created_at DESC`,
      [clubId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Array<Curriculum & { enrolled_count: number }> | null) ?? [];
  }

  async getCurriculum(id: string, userId?: string): Promise<(Curriculum & { modules: CurriculumModule[]; enrolled_count: number }) | null> {
    await this.schema.ensureSchema();

    const result = await this.db.rawQuery(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM prediction.curriculum_enrollments e WHERE e.curriculum_id = c.id) as enrolled_count
       FROM prediction.curricula c
       WHERE c.id = $1`,
      [id],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<Curriculum & { enrolled_count: number }> | null) ?? [];
    if (rows.length === 0) return null;

    const curriculum = rows[0]!;

    // Verify membership if userId provided (skip for internal calls)
    if (userId) {
      await this.clubService.requireMembership(curriculum.club_id, userId);
    }

    const modulesResult = await this.db.rawQuery(
      `SELECT * FROM prediction.curriculum_modules
       WHERE curriculum_id = $1
       ORDER BY week_number ASC`,
      [id],
    );
    if (modulesResult.error) throw new Error(modulesResult.error.message);
    const modules = (modulesResult.data as CurriculumModule[] | null) ?? [];

    return { ...curriculum, modules };
  }

  async updateCurriculum(id: string, input: UpdateCurriculumInput, userId: string): Promise<Curriculum> {
    await this.schema.ensureSchema();

    // Get curriculum to verify ownership
    const existing = await this.getCurriculum(id);
    if (!existing) throw new Error('Curriculum not found');
    await this.clubService.requireRole(existing.club_id, userId, ['owner', 'admin']);

    const sets: string[] = [];
    const params: unknown[] = [id];
    let idx = 2;

    if (input.name !== undefined) { sets.push(`name = $${idx}`); params.push(input.name); idx++; }
    if (input.description !== undefined) { sets.push(`description = $${idx}`); params.push(input.description); idx++; }
    if (input.status !== undefined) { sets.push(`status = $${idx}`); params.push(input.status); idx++; }

    if (sets.length === 0) return existing;

    const result = await this.db.rawQuery(
      `UPDATE prediction.curricula SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as Curriculum[] | null) ?? [])[0]!;
  }

  async deleteCurriculum(id: string, userId: string): Promise<void> {
    await this.schema.ensureSchema();

    const existing = await this.getCurriculum(id);
    if (!existing) throw new Error('Curriculum not found');
    if (existing.status !== 'draft') throw new Error('Can only delete draft curricula');
    await this.clubService.requireRole(existing.club_id, userId, ['owner', 'admin']);

    // Cascade delete: progress → enrollments → modules → curriculum
    await this.db.rawQuery(
      `DELETE FROM prediction.curriculum_module_progress
       WHERE enrollment_id IN (SELECT id FROM prediction.curriculum_enrollments WHERE curriculum_id = $1)`,
      [id],
    );
    await this.db.rawQuery(`DELETE FROM prediction.curriculum_enrollments WHERE curriculum_id = $1`, [id]);
    await this.db.rawQuery(`DELETE FROM prediction.curriculum_modules WHERE curriculum_id = $1`, [id]);
    await this.db.rawQuery(`DELETE FROM prediction.curricula WHERE id = $1`, [id]);
  }

  // ─── Module management ─────────────────────────────────────────

  async updateModule(curriculumId: string, weekNumber: number, input: UpdateModuleInput, userId: string): Promise<CurriculumModule> {
    await this.schema.ensureSchema();

    const existing = await this.getCurriculum(curriculumId);
    if (!existing) throw new Error('Curriculum not found');
    await this.clubService.requireRole(existing.club_id, userId, ['owner', 'admin']);

    const sets: string[] = [];
    const params: unknown[] = [curriculumId, weekNumber];
    let idx = 3;

    if (input.theme !== undefined) { sets.push(`theme = $${idx}`); params.push(input.theme); idx++; }
    if (input.instruments !== undefined) { sets.push(`instruments = $${idx}`); params.push(JSON.stringify(input.instruments)); idx++; }
    if (input.journal_prompt !== undefined) { sets.push(`journal_prompt = $${idx}`); params.push(input.journal_prompt); idx++; }
    if (input.challenge_id !== undefined) { sets.push(`challenge_id = $${idx}`); params.push(input.challenge_id); idx++; }
    if (input.poll_id !== undefined) { sets.push(`poll_id = $${idx}`); params.push(input.poll_id); idx++; }
    if (input.tournament_id !== undefined) { sets.push(`tournament_id = $${idx}`); params.push(input.tournament_id); idx++; }

    if (sets.length === 0) {
      const mod = await this.db.rawQuery(
        `SELECT * FROM prediction.curriculum_modules WHERE curriculum_id = $1 AND week_number = $2`,
        [curriculumId, weekNumber],
      );
      return ((mod.data as CurriculumModule[] | null) ?? [])[0]!;
    }

    const result = await this.db.rawQuery(
      `UPDATE prediction.curriculum_modules SET ${sets.join(', ')}
       WHERE curriculum_id = $1 AND week_number = $2
       RETURNING *`,
      params,
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as CurriculumModule[] | null) ?? [];
    if (rows.length === 0) throw new Error(`Module for week ${weekNumber} not found`);
    return rows[0]!;
  }

  // ─── Module activity creation ────────────────────────────────────

  async createModuleChallenge(
    curriculumId: string,
    weekNumber: number,
    input: { instrument_id: string; symbol: string; prompt?: string },
    userId: string,
  ): Promise<CurriculumModule> {
    const curriculum = await this.getCurriculum(curriculumId);
    if (!curriculum) throw new Error('Curriculum not found');
    await this.clubService.requireRole(curriculum.club_id, userId, ['owner', 'admin']);

    const challenge = await this.activityService.createChallenge(curriculum.club_id, input, userId);
    return this.updateModule(curriculumId, weekNumber, { challenge_id: challenge.id }, userId);
  }

  async createModulePoll(
    curriculumId: string,
    weekNumber: number,
    input: { instrument_id: string; symbol: string },
    userId: string,
  ): Promise<CurriculumModule> {
    const curriculum = await this.getCurriculum(curriculumId);
    if (!curriculum) throw new Error('Curriculum not found');
    await this.clubService.requireRole(curriculum.club_id, userId, ['owner', 'admin']);

    const poll = await this.activityService.createPoll(curriculum.club_id, input, userId);
    return this.updateModule(curriculumId, weekNumber, { poll_id: poll.id }, userId);
  }

  // ─── Templates ─────────────────────────────────────────────────

  private getTemplatesDir(): string {
    // At runtime, __dirname is dist/src/curriculum. Templates are in src/curriculum/templates.
    // Go up from dist/src/curriculum to the api root, then into src/curriculum/templates.
    const srcPath = join(__dirname, '..', '..', '..', 'src', 'curriculum', 'templates');
    return srcPath;
  }

  listTemplates(): Array<{ slug: string; name: string; description: string; week_count: number }> {
    const dir = this.getTemplatesDir();
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    return files.map(f => {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      return {
        slug: data.slug,
        name: data.name,
        description: data.description,
        week_count: data.weeks.length,
      };
    });
  }

  async createFromTemplate(clubId: string, templateSlug: string, userId: string): Promise<Curriculum & { modules: CurriculumModule[] }> {
    await this.schema.ensureSchema();
    await this.clubService.requireRole(clubId, userId, ['owner', 'admin']);

    const dir = this.getTemplatesDir();
    const filePath = join(dir, `${templateSlug}.json`);
    let template: {
      slug: string;
      name: string;
      description: string;
      weeks: Array<{
        week_number: number;
        theme: string;
        instruments: Array<{ symbol: string }>;
        journal_prompt: string;
      }>;
    };
    try {
      template = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      throw new Error(`Template not found: ${templateSlug}`);
    }

    // Create curriculum
    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.curricula (id, club_id, name, description, week_count, template_source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, clubId, template.name, template.description, template.weeks.length, template.slug, userId],
    );
    if (result.error) throw new Error(result.error.message);
    const curriculum = ((result.data as Curriculum[] | null) ?? [])[0]!;

    // Create pre-filled modules
    const modules: CurriculumModule[] = [];
    for (const week of template.weeks) {
      const moduleId = randomUUID();
      const modResult = await this.db.rawQuery(
        `INSERT INTO prediction.curriculum_modules (id, curriculum_id, week_number, theme, instruments, journal_prompt)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [moduleId, id, week.week_number, week.theme, JSON.stringify(week.instruments), week.journal_prompt],
      );
      if (modResult.error) throw new Error(modResult.error.message);
      modules.push(((modResult.data as CurriculumModule[] | null) ?? [])[0]!);
    }

    return { ...curriculum, modules };
  }

  // ─── Enrollment & Progress ─────────────────────────────────────

  async enroll(curriculumId: string, userId: string): Promise<CurriculumEnrollment> {
    await this.schema.ensureSchema();

    const curriculum = await this.getCurriculum(curriculumId);
    if (!curriculum) throw new Error('Curriculum not found');
    if (curriculum.status !== 'active') throw new Error('Can only enroll in active curricula');

    // Verify user is a club member
    await this.clubService.requireMembership(curriculum.club_id, userId);

    const enrollmentId = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.curriculum_enrollments (id, curriculum_id, user_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [enrollmentId, curriculumId, userId],
    );
    if (result.error) {
      if (result.error.message.includes('unique') || result.error.message.includes('duplicate')) {
        throw new Error('Already enrolled in this curriculum');
      }
      throw new Error(result.error.message);
    }

    const enrollment = ((result.data as CurriculumEnrollment[] | null) ?? [])[0]!;

    // Create progress row for week 1
    const week1Module = curriculum.modules.find(m => m.week_number === 1);
    if (week1Module) {
      await this.db.rawQuery(
        `INSERT INTO prediction.curriculum_module_progress (id, enrollment_id, module_id)
         VALUES ($1, $2, $3)`,
        [randomUUID(), enrollmentId, week1Module.id],
      );
    }

    return enrollment;
  }

  async getProgress(curriculumId: string, userId: string): Promise<{
    enrollment: CurriculumEnrollment;
    module_progress: Array<CurriculumModuleProgress & { week_number: number; theme: string }>;
  }> {
    await this.schema.ensureSchema();

    const enrollResult = await this.db.rawQuery(
      `SELECT * FROM prediction.curriculum_enrollments
       WHERE curriculum_id = $1 AND user_id = $2`,
      [curriculumId, userId],
    );
    if (enrollResult.error) throw new Error(enrollResult.error.message);
    const enrollments = (enrollResult.data as CurriculumEnrollment[] | null) ?? [];
    if (enrollments.length === 0) throw new Error('Not enrolled in this curriculum');

    const enrollment = enrollments[0]!;

    const progressResult = await this.db.rawQuery(
      `SELECT p.*, m.week_number, m.theme
       FROM prediction.curriculum_module_progress p
       JOIN prediction.curriculum_modules m ON m.id = p.module_id
       WHERE p.enrollment_id = $1
       ORDER BY m.week_number ASC`,
      [enrollment.id],
    );
    if (progressResult.error) throw new Error(progressResult.error.message);
    const module_progress = (progressResult.data as Array<CurriculumModuleProgress & { week_number: number; theme: string }> | null) ?? [];

    return { enrollment, module_progress };
  }

  async completeActivity(
    curriculumId: string,
    weekNumber: number,
    activityType: 'challenge' | 'poll' | 'journal' | 'tournament',
    userId: string,
  ): Promise<CurriculumModuleProgress> {
    await this.schema.ensureSchema();

    // Get enrollment
    const enrollResult = await this.db.rawQuery(
      `SELECT * FROM prediction.curriculum_enrollments
       WHERE curriculum_id = $1 AND user_id = $2`,
      [curriculumId, userId],
    );
    if (enrollResult.error) throw new Error(enrollResult.error.message);
    const enrollments = (enrollResult.data as CurriculumEnrollment[] | null) ?? [];
    if (enrollments.length === 0) throw new Error('Not enrolled in this curriculum');

    const enrollment = enrollments[0]!;

    // Check week is unlocked
    if (weekNumber > enrollment.current_week) {
      throw new Error(`Week ${weekNumber} is locked`);
    }

    // Get module
    const modResult = await this.db.rawQuery(
      `SELECT * FROM prediction.curriculum_modules
       WHERE curriculum_id = $1 AND week_number = $2`,
      [curriculumId, weekNumber],
    );
    if (modResult.error) throw new Error(modResult.error.message);
    const modules = (modResult.data as CurriculumModule[] | null) ?? [];
    if (modules.length === 0) throw new Error(`Module for week ${weekNumber} not found`);
    const mod = modules[0]!;

    // Get curriculum for club_id
    const curriculum = await this.getCurriculum(curriculumId);
    if (!curriculum) throw new Error('Curriculum not found');

    // Server-side verification: check the activity was actually completed
    await this.verifyActivityCompletion(activityType, mod, curriculum.club_id, userId, enrollment.id);

    // Update progress
    const columnMap: Record<string, string> = {
      challenge: 'challenge_completed',
      poll: 'poll_completed',
      journal: 'journal_completed',
      tournament: 'tournament_completed',
    };
    const column = columnMap[activityType];

    const updateResult = await this.db.rawQuery(
      `UPDATE prediction.curriculum_module_progress
       SET ${column} = true
       WHERE enrollment_id = $1 AND module_id = $2
       RETURNING *`,
      [enrollment.id, mod.id],
    );
    if (updateResult.error) throw new Error(updateResult.error.message);
    const progressRows = (updateResult.data as CurriculumModuleProgress[] | null) ?? [];
    if (progressRows.length === 0) throw new Error('Progress record not found');

    const progress = progressRows[0]!;

    // Check if all applicable activities for this week are done
    await this.checkWeekCompletion(enrollment, mod, progress, curriculum);

    // Re-fetch updated progress
    const refreshed = await this.db.rawQuery(
      `SELECT * FROM prediction.curriculum_module_progress
       WHERE enrollment_id = $1 AND module_id = $2`,
      [enrollment.id, mod.id],
    );
    return ((refreshed.data as CurriculumModuleProgress[] | null) ?? [])[0]!;
  }

  private async verifyActivityCompletion(
    activityType: string,
    mod: CurriculumModule,
    clubId: string,
    userId: string,
    enrollmentId: string,
  ): Promise<void> {
    switch (activityType) {
      case 'challenge': {
        if (!mod.challenge_id) throw new Error('No challenge assigned to this week');
        const r = await this.db.rawQuery(
          `SELECT id FROM prediction.club_challenge_responses
           WHERE challenge_id = $1 AND user_id = $2`,
          [mod.challenge_id, userId],
        );
        if (((r.data as unknown[] | null) ?? []).length === 0) {
          throw new Error('Challenge response not found — complete the challenge first');
        }
        break;
      }
      case 'poll': {
        if (!mod.poll_id) throw new Error('No poll assigned to this week');
        const r = await this.db.rawQuery(
          `SELECT id FROM prediction.club_consensus_votes
           WHERE poll_id = $1 AND user_id = $2`,
          [mod.poll_id, userId],
        );
        if (((r.data as unknown[] | null) ?? []).length === 0) {
          throw new Error('Poll vote not found — vote in the poll first');
        }
        break;
      }
      case 'journal': {
        if (!mod.journal_prompt) throw new Error('No journal prompt assigned to this week');
        // Require a journal entry created AFTER the module progress row was created
        // (i.e., after this week was unlocked). This prevents reusing old entries.
        const progressRow = await this.db.rawQuery(
          `SELECT created_at FROM prediction.curriculum_module_progress
           WHERE enrollment_id = $1 AND module_id = $2`,
          [enrollmentId, mod.id],
        );
        const progressCreatedAt = ((progressRow.data as Array<{ created_at: string }> | null) ?? [])[0]?.created_at;
        const r = await this.db.rawQuery(
          `SELECT id FROM prediction.club_strategy_journals
           WHERE club_id = $1 AND user_id = $2 AND created_at >= $3
           ORDER BY created_at DESC LIMIT 1`,
          [clubId, userId, progressCreatedAt ?? '1970-01-01'],
        );
        if (((r.data as unknown[] | null) ?? []).length === 0) {
          throw new Error('Journal entry not found — write a journal entry for this week first');
        }
        break;
      }
      case 'tournament': {
        if (!mod.tournament_id) throw new Error('No tournament assigned to this week');
        const r = await this.db.rawQuery(
          `SELECT id FROM prediction.tournament_entries
           WHERE tournament_id = $1 AND user_id = $2`,
          [mod.tournament_id, userId],
        );
        if (((r.data as unknown[] | null) ?? []).length === 0) {
          throw new Error('Tournament entry not found — join the tournament first');
        }
        break;
      }
    }
  }

  // ─── Dashboard ─────────────────────────────────────────────────

  async getDashboard(curriculumId: string, userId: string): Promise<{
    curriculum: Curriculum & { modules: CurriculumModule[] };
    students: Array<{
      user_id: string;
      display_name: string | null;
      enrollment: CurriculumEnrollment;
      module_progress: CurriculumModuleProgress[];
    }>;
  }> {
    await this.schema.ensureSchema();

    const curriculum = await this.getCurriculum(curriculumId);
    if (!curriculum) throw new Error('Curriculum not found');
    await this.clubService.requireRole(curriculum.club_id, userId, ['owner', 'admin']);

    // Single JOIN query: enrollments + module progress + user display names
    const result = await this.db.rawQuery(
      `SELECT e.*, u.display_name,
              json_agg(
                json_build_object(
                  'id', p.id,
                  'enrollment_id', p.enrollment_id,
                  'module_id', p.module_id,
                  'challenge_completed', p.challenge_completed,
                  'poll_completed', p.poll_completed,
                  'journal_completed', p.journal_completed,
                  'tournament_completed', p.tournament_completed,
                  'score', p.score,
                  'completed_at', p.completed_at
                ) ORDER BY m.week_number
              ) FILTER (WHERE p.id IS NOT NULL) as module_progress
       FROM prediction.curriculum_enrollments e
       LEFT JOIN authz.users u ON u.id = e.user_id
       LEFT JOIN prediction.curriculum_module_progress p ON p.enrollment_id = e.id
       LEFT JOIN prediction.curriculum_modules m ON m.id = p.module_id
       WHERE e.curriculum_id = $1
       GROUP BY e.id, u.display_name
       ORDER BY e.enrolled_at ASC`,
      [curriculumId],
    );
    if (result.error) throw new Error(result.error.message);

    const rows = (result.data as Array<CurriculumEnrollment & { display_name: string | null; module_progress: CurriculumModuleProgress[] | null }> | null) ?? [];

    const students = rows.map(row => ({
      user_id: row.user_id,
      display_name: row.display_name,
      enrollment: {
        id: row.id,
        curriculum_id: row.curriculum_id,
        user_id: row.user_id,
        current_week: row.current_week,
        completion_pct: row.completion_pct,
        enrolled_at: row.enrolled_at,
      },
      module_progress: row.module_progress ?? [],
    }));

    return { curriculum, students };
  }

  async getStudentDetail(curriculumId: string, studentUserId: string, userId: string): Promise<{
    enrollment: CurriculumEnrollment;
    modules: Array<{
      module: CurriculumModule;
      progress: CurriculumModuleProgress | null;
      activities: {
        challenge_response: unknown | null;
        poll_vote: unknown | null;
        journal_entry: unknown | null;
        tournament_entry: unknown | null;
      };
    }>;
  }> {
    await this.schema.ensureSchema();

    const curriculum = await this.getCurriculum(curriculumId);
    if (!curriculum) throw new Error('Curriculum not found');
    await this.clubService.requireRole(curriculum.club_id, userId, ['owner', 'admin']);

    // Get enrollment
    const enrollResult = await this.db.rawQuery(
      `SELECT * FROM prediction.curriculum_enrollments
       WHERE curriculum_id = $1 AND user_id = $2`,
      [curriculumId, studentUserId],
    );
    if (enrollResult.error) throw new Error(enrollResult.error.message);
    const enrollments = (enrollResult.data as CurriculumEnrollment[] | null) ?? [];
    if (enrollments.length === 0) throw new Error('Student not enrolled in this curriculum');
    const enrollment = enrollments[0]!;

    // Get progress for all modules
    const progressResult = await this.db.rawQuery(
      `SELECT * FROM prediction.curriculum_module_progress
       WHERE enrollment_id = $1`,
      [enrollment.id],
    );
    const allProgress = (progressResult.data as CurriculumModuleProgress[] | null) ?? [];

    // Batch-fetch all activity responses in 4 queries (not N+1)
    const challengeIds = curriculum.modules.map(m => m.challenge_id).filter(Boolean) as string[];
    const pollIds = curriculum.modules.map(m => m.poll_id).filter(Boolean) as string[];
    const tournamentIds = curriculum.modules.map(m => m.tournament_id).filter(Boolean) as string[];

    const challengeResponses = new Map<string, unknown>();
    if (challengeIds.length > 0) {
      const r = await this.db.rawQuery(
        `SELECT * FROM prediction.club_challenge_responses
         WHERE challenge_id = ANY($1) AND user_id = $2`,
        [challengeIds, studentUserId],
      );
      for (const row of (r.data as Array<{ challenge_id: string }> | null) ?? []) {
        challengeResponses.set(row.challenge_id, row);
      }
    }

    const pollVotes = new Map<string, unknown>();
    if (pollIds.length > 0) {
      const r = await this.db.rawQuery(
        `SELECT * FROM prediction.club_consensus_votes
         WHERE poll_id = ANY($1) AND user_id = $2`,
        [pollIds, studentUserId],
      );
      for (const row of (r.data as Array<{ poll_id: string }> | null) ?? []) {
        pollVotes.set(row.poll_id, row);
      }
    }

    // Journals: get all by this user in this club, ordered by date
    const journalResult = await this.db.rawQuery(
      `SELECT * FROM prediction.club_strategy_journals
       WHERE club_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [curriculum.club_id, studentUserId],
    );
    const allJournals = (journalResult.data as Array<{ id: string; created_at: string }> | null) ?? [];

    const tournamentEntries = new Map<string, unknown>();
    if (tournamentIds.length > 0) {
      const r = await this.db.rawQuery(
        `SELECT te.*, tp.current_balance, tp.total_realized_pnl, te.final_rank
         FROM prediction.tournament_entries te
         LEFT JOIN prediction.tournament_portfolios tp ON tp.id = te.portfolio_id
         WHERE te.tournament_id = ANY($1) AND te.user_id = $2`,
        [tournamentIds, studentUserId],
      );
      for (const row of (r.data as Array<{ tournament_id: string }> | null) ?? []) {
        tournamentEntries.set(row.tournament_id, row);
      }
    }

    // Build per-module detail from batch results
    const modules = curriculum.modules.map((mod) => {
      const progress = allProgress.find(p => p.module_id === mod.id) ?? null;

      // Match journal to module by finding one created after the progress row
      let journal_entry: unknown = null;
      if (mod.journal_prompt && progress) {
        const progressCreatedAt = (progress as unknown as { created_at?: string }).created_at;
        journal_entry = allJournals.find(j =>
          !progressCreatedAt || j.created_at >= progressCreatedAt
        ) ?? null;
      }

      return {
        module: mod,
        progress,
        activities: {
          challenge_response: mod.challenge_id ? (challengeResponses.get(mod.challenge_id) ?? null) : null,
          poll_vote: mod.poll_id ? (pollVotes.get(mod.poll_id) ?? null) : null,
          journal_entry,
          tournament_entry: mod.tournament_id ? (tournamentEntries.get(mod.tournament_id) ?? null) : null,
        },
      };
    });

    return { enrollment, modules };
  }

  private async checkWeekCompletion(
    enrollment: CurriculumEnrollment,
    mod: CurriculumModule,
    progress: CurriculumModuleProgress,
    curriculum: Curriculum & { modules: CurriculumModule[] },
  ): Promise<void> {
    // Determine which activities are required (only those with assigned IDs/prompts)
    const required: Array<{ field: keyof CurriculumModuleProgress; check: boolean }> = [];
    if (mod.challenge_id) required.push({ field: 'challenge_completed', check: progress.challenge_completed });
    if (mod.poll_id) required.push({ field: 'poll_completed', check: progress.poll_completed });
    if (mod.journal_prompt) required.push({ field: 'journal_completed', check: progress.journal_completed });
    if (mod.tournament_id) required.push({ field: 'tournament_completed', check: progress.tournament_completed });

    // If no activities are required or not all done, skip
    if (required.length === 0 || !required.every(r => r.check)) return;

    // Mark week as completed
    await this.db.rawQuery(
      `UPDATE prediction.curriculum_module_progress
       SET completed_at = now()
       WHERE enrollment_id = $1 AND module_id = $2`,
      [enrollment.id, mod.id],
    );

    // Calculate completion percentage
    const totalWeeks = curriculum.week_count;
    const completedResult = await this.db.rawQuery(
      `SELECT COUNT(*)::int as count FROM prediction.curriculum_module_progress
       WHERE enrollment_id = $1 AND completed_at IS NOT NULL`,
      [enrollment.id],
    );
    const completedCount = ((completedResult.data as Array<{ count: number }> | null) ?? [])[0]?.count ?? 0;
    const completionPct = Math.round((completedCount / totalWeeks) * 10000) / 100;

    // If not the last week, unlock next week
    const nextWeek = mod.week_number + 1;
    if (nextWeek <= totalWeeks) {
      // Increment current_week
      await this.db.rawQuery(
        `UPDATE prediction.curriculum_enrollments
         SET current_week = $1, completion_pct = $2
         WHERE id = $3`,
        [nextWeek, completionPct, enrollment.id],
      );

      // Create progress row for next week
      const nextModule = curriculum.modules.find(m => m.week_number === nextWeek);
      if (nextModule) {
        await this.db.rawQuery(
          `INSERT INTO prediction.curriculum_module_progress (id, enrollment_id, module_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (enrollment_id, module_id) DO NOTHING`,
          [randomUUID(), enrollment.id, nextModule.id],
        );
      }
    } else {
      // Last week completed — update completion to 100%
      await this.db.rawQuery(
        `UPDATE prediction.curriculum_enrollments
         SET completion_pct = $1
         WHERE id = $2`,
        [completionPct, enrollment.id],
      );
    }
  }
}
