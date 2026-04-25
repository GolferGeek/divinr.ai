-- Phase 4 of the stripe-integration effort: track which email proved a user's
-- .edu status and when we last confirmed it. The signup-time verifier writes
-- edu_email + edu_last_verified_at; the monthly re-verification cron re-checks
-- the suffix and either bumps edu_last_verified_at or flips is_student=false +
-- re-prices the user's subscription items.

ALTER TABLE authz.users ADD COLUMN IF NOT EXISTS edu_email text;
ALTER TABLE authz.users ADD COLUMN IF NOT EXISTS edu_last_verified_at timestamptz;
