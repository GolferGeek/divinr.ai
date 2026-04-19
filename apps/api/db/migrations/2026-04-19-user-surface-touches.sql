-- User surface touches table — tracks first-touch walkthrough state per (user, surface).
-- One row per (user_id, surface_key). Written the first time a user lands on a
-- surface; prevents the docent panel from re-firing on return visits.
--
-- Note: the actual live DDL is applied by apps/api/src/first-touch/first-touch-schema.service.ts
-- at runtime (idempotent pattern per this codebase). This file is the documented snapshot.

CREATE TABLE IF NOT EXISTS prediction.user_surface_touches (
  user_id           TEXT NOT NULL,
  surface_key       TEXT NOT NULL,
  first_touched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  dismissed         BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, surface_key)
);

CREATE INDEX IF NOT EXISTS idx_user_surface_touches_user
  ON prediction.user_surface_touches(user_id);
