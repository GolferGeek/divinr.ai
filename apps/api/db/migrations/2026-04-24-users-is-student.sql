-- Phase 2 introduces the is_student flag so downstream code can treat the
-- column as always-present. Phase 4 adds edu_email + edu_last_verified_at and
-- wires the .edu signup detection.

ALTER TABLE authz.users ADD COLUMN IF NOT EXISTS is_student boolean NOT NULL DEFAULT false;
