-- Effort: leaderboard-rank-delta
-- Date: 2026-04-18
--
-- Adds the snapshot infrastructure needed to compute prev_rank / rank_delta
-- on both the tournament leaderboard and the club rankings.
--
-- All DDL is idempotent (CREATE IF NOT EXISTS, DROP CONSTRAINT IF EXISTS).
-- Safe to re-run.

-- 1. New table: daily rank snapshots for every tournament entry.
CREATE TABLE IF NOT EXISTS prediction.tournament_rank_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tournament_id TEXT NOT NULL REFERENCES prediction.tournaments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  rank INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tournament_id, user_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_tournament_rank_snapshots_tournament_date
  ON prediction.tournament_rank_snapshots(tournament_id, snapshot_date DESC);

-- 2. Widen the club_ranking_snapshots period_type CHECK to allow 'daily'.
ALTER TABLE prediction.club_ranking_snapshots
  DROP CONSTRAINT IF EXISTS club_ranking_snapshots_period_type_check;

ALTER TABLE prediction.club_ranking_snapshots
  ADD CONSTRAINT club_ranking_snapshots_period_type_check
  CHECK (period_type IN ('daily', 'monthly', 'quarterly'));

-- 3. Partial index that keeps the daily prior-period lookup cheap.
CREATE INDEX IF NOT EXISTS idx_club_ranking_snapshots_daily
  ON prediction.club_ranking_snapshots(period_label DESC)
  WHERE period_type = 'daily';
