import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

@Injectable()
export class ClubSchemaService {
  private schemaReady = false;
  private readonly logger = new Logger(ClubSchemaService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;

    const ddl = `
      CREATE TABLE IF NOT EXISTS prediction.clubs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name TEXT NOT NULL,
        description TEXT,
        invite_code TEXT UNIQUE,
        is_public BOOLEAN DEFAULT false,
        created_by TEXT NOT NULL,
        channel_id TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS prediction.club_members (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
        joined_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (club_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS prediction.club_invites (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
        invite_token TEXT NOT NULL UNIQUE,
        invited_by TEXT NOT NULL,
        invited_email TEXT,
        invited_user_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS prediction.club_analysts (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
        analyst_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (club_id, analyst_id)
      );

      CREATE TABLE IF NOT EXISTS prediction.club_prediction_challenges (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
        created_by TEXT NOT NULL,
        instrument_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        prompt TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'revealed', 'closed')),
        created_at TIMESTAMPTZ DEFAULT now(),
        revealed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS prediction.club_challenge_responses (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        challenge_id TEXT NOT NULL REFERENCES prediction.club_prediction_challenges(id),
        user_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('bull', 'bear', 'neutral')),
        thesis TEXT NOT NULL,
        submitted_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (challenge_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS prediction.club_consensus_polls (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
        created_by TEXT NOT NULL,
        instrument_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'revealed', 'closed')),
        created_at TIMESTAMPTZ DEFAULT now(),
        revealed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS prediction.club_consensus_votes (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        poll_id TEXT NOT NULL REFERENCES prediction.club_consensus_polls(id),
        user_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('bull', 'bear', 'neutral')),
        voted_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (poll_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS prediction.club_strategy_journals (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
        user_id TEXT NOT NULL,
        tournament_id TEXT,
        symbol TEXT,
        entry TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_club_members_club_user ON prediction.club_members(club_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_club_members_user ON prediction.club_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_clubs_invite_code ON prediction.clubs(invite_code);
      CREATE INDEX IF NOT EXISTS idx_clubs_public ON prediction.clubs(is_public) WHERE is_public = true;
      CREATE INDEX IF NOT EXISTS idx_club_invites_token ON prediction.club_invites(invite_token);
      CREATE INDEX IF NOT EXISTS idx_club_analysts_club ON prediction.club_analysts(club_id);
      CREATE INDEX IF NOT EXISTS idx_club_challenges_club ON prediction.club_prediction_challenges(club_id);
      CREATE INDEX IF NOT EXISTS idx_club_polls_club ON prediction.club_consensus_polls(club_id);
      CREATE INDEX IF NOT EXISTS idx_club_journals_club ON prediction.club_strategy_journals(club_id, user_id);

      ALTER TABLE prediction.clubs ADD COLUMN IF NOT EXISTS badges JSONB DEFAULT '[]';
      ALTER TABLE prediction.clubs ADD COLUMN IF NOT EXISTS ranking_score NUMERIC DEFAULT 0;
      ALTER TABLE prediction.clubs ADD COLUMN IF NOT EXISTS ranking_position INTEGER;

      CREATE TABLE IF NOT EXISTS prediction.club_ranking_snapshots (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
        period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'monthly', 'quarterly')),
        period_label TEXT NOT NULL,
        ranking_position INTEGER NOT NULL,
        ranking_score NUMERIC NOT NULL,
        avg_return_pct NUMERIC,
        club_win_rate NUMERIC,
        member_count INTEGER,
        tournament_count INTEGER,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (club_id, period_type, period_label)
      );

      ALTER TABLE prediction.club_ranking_snapshots
        DROP CONSTRAINT IF EXISTS club_ranking_snapshots_period_type_check;
      ALTER TABLE prediction.club_ranking_snapshots
        ADD CONSTRAINT club_ranking_snapshots_period_type_check
        CHECK (period_type IN ('daily', 'monthly', 'quarterly'));

      CREATE INDEX IF NOT EXISTS idx_club_ranking_snapshots_club ON prediction.club_ranking_snapshots(club_id);
      CREATE INDEX IF NOT EXISTS idx_club_ranking_snapshots_daily
        ON prediction.club_ranking_snapshots(period_label DESC)
        WHERE period_type = 'daily';
      CREATE INDEX IF NOT EXISTS idx_clubs_ranking ON prediction.clubs(ranking_score DESC) WHERE is_public = true;

      -- Mentor/mentee pairing system
      CREATE TABLE IF NOT EXISTS prediction.club_mentors (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'inactive')),
        tournament_count INTEGER,
        win_rate NUMERIC(5,2),
        avg_return_pct NUMERIC(5,2),
        applied_at TIMESTAMPTZ DEFAULT now(),
        approved_at TIMESTAMPTZ,
        approved_by TEXT,
        UNIQUE (club_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS prediction.club_mentor_pairings (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
        mentor_id TEXT NOT NULL REFERENCES prediction.club_mentors(id),
        mentee_user_id TEXT NOT NULL,
        dm_channel_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
        paired_at TIMESTAMPTZ DEFAULT now(),
        ended_at TIMESTAMPTZ,
        UNIQUE (club_id, mentee_user_id)
      );

      CREATE TABLE IF NOT EXISTS prediction.club_mentee_requests (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'cancelled')),
        requested_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (club_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS prediction.club_mentor_feedback (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        pairing_id TEXT NOT NULL REFERENCES prediction.club_mentor_pairings(id),
        mentee_user_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        period_label TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (pairing_id, period_label)
      );

      CREATE INDEX IF NOT EXISTS idx_club_mentors_club ON prediction.club_mentors(club_id);
      CREATE INDEX IF NOT EXISTS idx_club_mentors_user ON prediction.club_mentors(user_id);
      CREATE INDEX IF NOT EXISTS idx_club_mentor_pairings_club ON prediction.club_mentor_pairings(club_id);
      CREATE INDEX IF NOT EXISTS idx_club_mentor_pairings_mentor ON prediction.club_mentor_pairings(mentor_id);
      CREATE INDEX IF NOT EXISTS idx_club_mentee_requests_club ON prediction.club_mentee_requests(club_id);
      CREATE INDEX IF NOT EXISTS idx_club_mentor_feedback_pairing ON prediction.club_mentor_feedback(pairing_id);
    `;

    const result = await this.db.rawQuery(ddl);
    if (result.error) {
      throw new Error(`Club schema creation failed: ${result.error.message}`);
    }

    this.schemaReady = true;
    this.logger.log('Club schema ready');
  }
}
