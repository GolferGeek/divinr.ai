-- Mentor/mentee pairing system within learning clubs

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
