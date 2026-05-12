-- Dashboard analysis preferences.
-- Applied by explicit schema bootstrap via MarketsSchemaService.analysisPreferencesDdl().

CREATE TABLE IF NOT EXISTS prediction.user_analysis_preferences (
  user_id TEXT NOT NULL REFERENCES authz.users(id) ON DELETE CASCADE,
  preference_type TEXT NOT NULL CHECK (preference_type IN ('followed_analyst', 'watched_instrument', 'muted_instrument')),
  target_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, preference_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_user_analysis_preferences_user_type
  ON prediction.user_analysis_preferences(user_id, preference_type);

CREATE TABLE IF NOT EXISTS prediction.user_dashboard_preferences (
  user_id TEXT PRIMARY KEY REFERENCES authz.users(id) ON DELETE CASCADE,
  priority_mode TEXT NOT NULL DEFAULT 'balanced'
    CHECK (priority_mode IN ('balanced', 'portfolio_first', 'tournaments_first')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
