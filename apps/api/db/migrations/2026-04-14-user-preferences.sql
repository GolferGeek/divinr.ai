-- User preferences table — houses the onboarding tour state for each user.
-- Keyed by user_id; onboarding_state is a JSONB blob that gets mutated atomically
-- via the OnboardingService. Row is lazy-initialized on first GET.
--
-- Note: the actual live DDL is applied by apps/api/src/onboarding/onboarding-schema.service.ts
-- at runtime (idempotent pattern per this codebase). This file is the documented snapshot.

CREATE TABLE IF NOT EXISTS authz.user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES authz.users(id) ON DELETE CASCADE,
  onboarding_state JSONB NOT NULL DEFAULT jsonb_build_object(
    'started_at',      NULL,
    'completed_at',    NULL,
    'skipped',         FALSE,
    'current_step',    'welcome',
    'steps_completed', '[]'::jsonb,
    'last_seen_at',    NULL
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_updated_at
  ON authz.user_preferences(updated_at);
