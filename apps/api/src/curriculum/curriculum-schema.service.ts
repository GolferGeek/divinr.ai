import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

@Injectable()
export class CurriculumSchemaService {
  private schemaReady = false;
  private readonly logger = new Logger(CurriculumSchemaService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;

    const ddl = `
      CREATE TABLE IF NOT EXISTS prediction.curricula (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
        name TEXT NOT NULL,
        description TEXT,
        week_count INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
        template_source TEXT,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS prediction.curriculum_modules (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        curriculum_id TEXT NOT NULL REFERENCES prediction.curricula(id),
        week_number INTEGER NOT NULL,
        theme TEXT NOT NULL DEFAULT '',
        instruments JSONB NOT NULL DEFAULT '[]',
        challenge_id TEXT,
        poll_id TEXT,
        journal_prompt TEXT,
        tournament_id TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (curriculum_id, week_number)
      );

      CREATE TABLE IF NOT EXISTS prediction.curriculum_enrollments (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        curriculum_id TEXT NOT NULL REFERENCES prediction.curricula(id),
        user_id TEXT NOT NULL,
        current_week INTEGER NOT NULL DEFAULT 1,
        completion_pct NUMERIC(5,2) DEFAULT 0,
        enrolled_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (curriculum_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS prediction.curriculum_module_progress (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        enrollment_id TEXT NOT NULL REFERENCES prediction.curriculum_enrollments(id),
        module_id TEXT NOT NULL REFERENCES prediction.curriculum_modules(id),
        challenge_completed BOOLEAN DEFAULT false,
        poll_completed BOOLEAN DEFAULT false,
        journal_completed BOOLEAN DEFAULT false,
        tournament_completed BOOLEAN DEFAULT false,
        score NUMERIC(5,2),
        completed_at TIMESTAMPTZ,
        UNIQUE (enrollment_id, module_id)
      );

      CREATE INDEX IF NOT EXISTS idx_curricula_club ON prediction.curricula(club_id);
      CREATE INDEX IF NOT EXISTS idx_curriculum_modules_curriculum ON prediction.curriculum_modules(curriculum_id);
      CREATE INDEX IF NOT EXISTS idx_curriculum_enrollments_curriculum ON prediction.curriculum_enrollments(curriculum_id);
      CREATE INDEX IF NOT EXISTS idx_curriculum_enrollments_user ON prediction.curriculum_enrollments(user_id);
      CREATE INDEX IF NOT EXISTS idx_curriculum_module_progress_enrollment ON prediction.curriculum_module_progress(enrollment_id);
    `;

    const result = await this.db.rawQuery(ddl);
    if (result.error) {
      throw new Error(`Curriculum schema creation failed: ${result.error.message}`);
    }

    this.schemaReady = true;
    this.logger.log('Curriculum schema ready');
  }
}
