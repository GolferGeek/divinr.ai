-- Effort: learning-clubs
-- Date: 2026-04-13
--
-- Creates all learning club tables in the prediction schema.
-- All DDL is idempotent (CREATE IF NOT EXISTS). Safe to re-run.

-- Clubs
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

-- Club members
CREATE TABLE IF NOT EXISTS prediction.club_members (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (club_id, user_id)
);

-- Club invites
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

-- Club analysts (junction: clubs ↔ market_analysts)
CREATE TABLE IF NOT EXISTS prediction.club_analysts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
  analyst_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (club_id, analyst_id)
);

-- Prediction challenges
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

-- Challenge responses
CREATE TABLE IF NOT EXISTS prediction.club_challenge_responses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  challenge_id TEXT NOT NULL REFERENCES prediction.club_prediction_challenges(id),
  user_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('bull', 'bear', 'neutral')),
  thesis TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (challenge_id, user_id)
);

-- Consensus polls
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

-- Consensus votes
CREATE TABLE IF NOT EXISTS prediction.club_consensus_votes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  poll_id TEXT NOT NULL REFERENCES prediction.club_consensus_polls(id),
  user_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('bull', 'bear', 'neutral')),
  voted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (poll_id, user_id)
);

-- Strategy journals
CREATE TABLE IF NOT EXISTS prediction.club_strategy_journals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  club_id TEXT NOT NULL REFERENCES prediction.clubs(id),
  user_id TEXT NOT NULL,
  tournament_id TEXT,
  symbol TEXT,
  entry TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_club_members_club_user ON prediction.club_members(club_id, user_id);
CREATE INDEX IF NOT EXISTS idx_club_members_user ON prediction.club_members(user_id);
CREATE INDEX IF NOT EXISTS idx_clubs_invite_code ON prediction.clubs(invite_code);
CREATE INDEX IF NOT EXISTS idx_clubs_public ON prediction.clubs(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_club_invites_token ON prediction.club_invites(invite_token);
CREATE INDEX IF NOT EXISTS idx_club_analysts_club ON prediction.club_analysts(club_id);
CREATE INDEX IF NOT EXISTS idx_club_challenges_club ON prediction.club_prediction_challenges(club_id);
CREATE INDEX IF NOT EXISTS idx_club_polls_club ON prediction.club_consensus_polls(club_id);
CREATE INDEX IF NOT EXISTS idx_club_journals_club ON prediction.club_strategy_journals(club_id, user_id);
