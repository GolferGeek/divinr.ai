-- Effort: testing-team (2026-04-19)
--
-- Adds the is_testing column to authz.users and seeds the shared testing-team
-- fixture (one club membership, one paper portfolio with an AAPL position, one
-- tournament entry). Grants role-admin and mock-paid subscription so the
-- testing user can exercise admin and authoring surfaces in Phase 5.
--
-- Idempotent. Safe to re-run. No-op on blocks whose prerequisite rows are
-- missing (e.g., auth.users signup must happen first; see
-- docs/efforts/current/testing-team/prod-migration-log.md for the prod order).
--
-- Apply with:
--   PGPASSWORD=postgres psql -h localhost -p 7011 -U postgres -d postgres \
--     -f apps/api/db/migrations/2026-04-19-testing-team-seed.sql
--

-- 1. Column — is_testing on authz.users
ALTER TABLE authz.users
  ADD COLUMN IF NOT EXISTS is_testing boolean NOT NULL DEFAULT false;

-- 2. Mirror the testing-team Supabase auth user into authz.users.
--    Requires the auth.users row to already exist (founder signs up via the
--    app's login flow, or via `supabase auth signUp`, once per environment).
INSERT INTO authz.users (id, email, display_name, status)
SELECT id::text, email, 'Testing Team', 'active'
FROM auth.users
WHERE email = 'testing-team@divinr.ai'
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      status = 'active';

-- 3. Mark the row as is_testing = true.
UPDATE authz.users
SET is_testing = true
WHERE email = 'testing-team@divinr.ai';

-- 4a. Ensure role-admin exists (mirrors the auth-bootstrap seed; self-heals
--     envs where that seed was not applied).
INSERT INTO authz.rbac_roles (id, name, display_name, description, is_system)
VALUES ('role-admin', 'admin', 'Admin', 'Platform admin — full access', true)
ON CONFLICT (id) DO NOTHING;

-- 4b. Grant role-admin so Phase 5.7 admin specs can exercise admin surfaces.
INSERT INTO authz.rbac_user_roles (user_id, role_id, assigned_by)
SELECT u.id, 'role-admin', 'testing-team-seed'
FROM authz.users u
WHERE u.email = 'testing-team@divinr.ai'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 5. Ensure billing schema exists (BillingSchemaService creates it lazily in
--    dev — this keeps the migration runnable on a cold prod DB).
CREATE SCHEMA IF NOT EXISTS billing;

CREATE TABLE IF NOT EXISTS billing.subscriptions (
  user_id text PRIMARY KEY,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text NOT NULL DEFAULT 'trial',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Mock-paid subscription so Phase 5.6 authoring specs pass the tier gate.
INSERT INTO billing.subscriptions (user_id, status, current_period_end, created_at, updated_at)
SELECT u.id, 'active', now() + interval '100 years', now(), now()
FROM authz.users u
WHERE u.email = 'testing-team@divinr.ai'
ON CONFLICT (user_id) DO UPDATE
  SET status = 'active',
      current_period_end = EXCLUDED.current_period_end,
      updated_at = now();

-- 7. Club + membership (owner of a stable "Testing Team" club).
INSERT INTO prediction.clubs (id, name, description, is_public, created_by)
SELECT 'club-testing-team', 'Testing Team', 'Stable fixture club used by the harness', false, u.id
FROM authz.users u
WHERE u.email = 'testing-team@divinr.ai'
ON CONFLICT (id) DO NOTHING;

INSERT INTO prediction.club_members (id, club_id, user_id, role)
SELECT 'clubmember-testing-team', 'club-testing-team', u.id, 'owner'
FROM authz.users u
WHERE u.email = 'testing-team@divinr.ai'
  AND EXISTS (SELECT 1 FROM prediction.clubs WHERE id = 'club-testing-team')
ON CONFLICT (club_id, user_id) DO NOTHING;

-- 8. Paper portfolio + one AAPL position (looked up by symbol — avoids
--    hard-coding an instrument_id that would drift between envs).
INSERT INTO prediction.user_portfolios (id, user_id, initial_balance, current_balance)
SELECT 'portfolio-testing-team', u.id, 1000000, 1000000
FROM authz.users u
WHERE u.email = 'testing-team@divinr.ai'
ON CONFLICT (id) DO NOTHING;

INSERT INTO prediction.user_positions (
  id, portfolio_id, user_id, instrument_id, symbol, direction, quantity,
  entry_price, current_price, status
)
SELECT
  'position-testing-team-aapl',
  'portfolio-testing-team',
  u.id,
  i.id,
  'AAPL',
  'long',
  10,
  150,
  150,
  'open'
FROM authz.users u
CROSS JOIN prediction.instruments i
WHERE u.email = 'testing-team@divinr.ai'
  AND i.symbol = 'AAPL'
  AND EXISTS (SELECT 1 FROM prediction.user_portfolios WHERE id = 'portfolio-testing-team')
ON CONFLICT (id) DO NOTHING;

-- 9. Tournament + portfolio + entry (weekly_sprint so it satisfies CHECK).
INSERT INTO prediction.tournaments (
  id, name, description, scope, tournament_type, status, created_by,
  starting_balance, starts_at, ends_at
)
SELECT
  'tournament-testing-team',
  'Testing Team Weekly Sprint',
  'Stable fixture tournament for harness verification',
  'system',
  'weekly_sprint',
  'active',
  u.id,
  100000,
  now() - interval '1 day',
  now() + interval '100 years'
FROM authz.users u
WHERE u.email = 'testing-team@divinr.ai'
ON CONFLICT (id) DO NOTHING;

INSERT INTO prediction.tournament_portfolios (
  id, tournament_id, user_id, initial_balance, current_balance
)
SELECT
  'tourney-portfolio-testing-team',
  'tournament-testing-team',
  u.id,
  100000,
  100000
FROM authz.users u
WHERE u.email = 'testing-team@divinr.ai'
  AND EXISTS (SELECT 1 FROM prediction.tournaments WHERE id = 'tournament-testing-team')
ON CONFLICT (id) DO NOTHING;

INSERT INTO prediction.tournament_entries (
  id, tournament_id, user_id, portfolio_id
)
SELECT
  'tourney-entry-testing-team',
  'tournament-testing-team',
  u.id,
  'tourney-portfolio-testing-team'
FROM authz.users u
WHERE u.email = 'testing-team@divinr.ai'
  AND EXISTS (SELECT 1 FROM prediction.tournament_portfolios WHERE id = 'tourney-portfolio-testing-team')
ON CONFLICT (tournament_id, user_id) DO NOTHING;
