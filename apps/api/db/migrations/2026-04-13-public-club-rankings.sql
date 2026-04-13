-- Effort: public-club-rankings
-- Date: 2026-04-13
--
-- Adds ranking columns to clubs and creates ranking snapshots table.
-- All DDL is idempotent. Safe to re-run.

ALTER TABLE prediction.clubs ADD COLUMN IF NOT EXISTS badges JSONB DEFAULT '[]';
ALTER TABLE prediction.clubs ADD COLUMN IF NOT EXISTS ranking_score NUMERIC DEFAULT 0;
ALTER TABLE prediction.clubs ADD COLUMN IF NOT EXISTS ranking_position INTEGER;

CREATE TABLE IF NOT EXISTS prediction.club_ranking_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
  period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly')),
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

CREATE INDEX IF NOT EXISTS idx_club_ranking_snapshots_club ON prediction.club_ranking_snapshots(club_id);
CREATE INDEX IF NOT EXISTS idx_clubs_ranking ON prediction.clubs(ranking_score DESC) WHERE is_public = true;
