-- Effort: user-billing-model (Phase 2)
-- Adds per-user social opt-out flags so a "silent $50" user can participate
-- individually without appearing in member lists, rosters, leaderboards,
-- messaging suggestions, or notification fan-out. See PRD §4.3 and §4.4.
--
-- Deviation: the plan/PRD names `public.profiles` as the user table, but
-- this codebase uses `authz.users` as the canonical user row (the existing
-- `is_testing` boolean is the precedent for user-level flags). Columns are
-- added there so every existing join against authz.users gets opt-out state
-- for free.
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS so the migration can re-run.

ALTER TABLE authz.users ADD COLUMN IF NOT EXISTS social_visible_in_member_lists BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE authz.users ADD COLUMN IF NOT EXISTS social_messaging_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE authz.users ADD COLUMN IF NOT EXISTS social_tournament_participation BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE authz.users ADD COLUMN IF NOT EXISTS social_leaderboard_visible BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE authz.users ADD COLUMN IF NOT EXISTS social_notifications_enabled BOOLEAN NOT NULL DEFAULT true;
