-- Effort: activity-viewed-counter
-- Date: 2026-04-19
--
-- Adds prediction.club_members.last_viewed_at so the ACTIVITIES tab can show
-- a per-club unread-count badge keyed off "what has happened since you last
-- looked." NULL means "never viewed" — the read query COALESCEs to joined_at
-- so brand-new members see post-join activity, not full club history.
--
-- All DDL is idempotent. Safe to re-run.
-- Note: ClubSchemaService.ensureSchema() in apps/api/src/clubs/club-schema.service.ts
-- carries the same ALTER inline — that path is what actually evolves the dev DB
-- on boot. This file exists for fresh-seed reproducibility.

ALTER TABLE prediction.club_members
  ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;
