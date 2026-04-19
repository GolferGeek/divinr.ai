# Prod Migration Log — testing-team

**Date applied**: 2026-04-19
**Migration file**: `apps/api/db/migrations/2026-04-19-testing-team-seed.sql`

## Environment shape

Prod Divinr.ai is Node-on-Spark fronted by Cloudflare. The local Supabase
instance on Spark (Postgres on `127.0.0.1:7011`) **is** the prod DB for
`api.divinr.ai` — there is no separate hosted Supabase project. `SUPABASE_URL`
in `.env` (`http://127.0.0.1:7010`) and `DATABASE_URL`
(`postgresql://postgres:postgres@127.0.0.1:7011/postgres`) point at the same
cluster the prod API process reads from.

This means the local apply **is** the prod apply for this environment.

## Apply command (re-run safe — migration is idempotent)

```sh
PGPASSWORD=postgres psql -h 127.0.0.1 -p 7011 -U postgres -d postgres \
  -f apps/api/db/migrations/2026-04-19-testing-team-seed.sql
```

## Pre-condition: testing-team user in auth.users

The migration joins against `auth.users` to mirror the testing-team user into
`authz.users`. On a fresh prod DB, the auth row must exist first. Created on
Spark 2026-04-19 via direct psql insert (dev-only convenience — passwords land
in auth.users via `crypt(<plaintext>, gen_salt('bf'))`):

```sql
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change_token, email_change_token_current, reauthentication_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'testing-team@divinr.ai',
  crypt('testing-team-2026!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now(),
  false,
  false,
  '', '', '', '', '', '', ''
) ON CONFLICT DO NOTHING;
```

**Important**: GoTrue v2.188.1's Go SQL scanner cannot convert NULL to string
for `confirmation_token`, `recovery_token`, `email_change_token_new`,
`email_change`, `phone_change_token`, `email_change_token_current`, and
`reauthentication_token`. These columns are nominally nullable in the schema
but must be seeded with empty strings (`''`), or every login attempt returns
`500 unexpected_failure: Database error querying schema`. The Dashboard path
(below) sets them correctly automatically; a raw INSERT must be explicit.

If a row already exists with NULLs in these columns, heal it with:

```sql
UPDATE auth.users
SET confirmation_token = COALESCE(confirmation_token, ''),
    recovery_token = COALESCE(recovery_token, ''),
    email_change_token_new = COALESCE(email_change_token_new, ''),
    email_change = COALESCE(email_change, ''),
    phone_change_token = COALESCE(phone_change_token, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''),
    reauthentication_token = COALESCE(reauthentication_token, '')
WHERE email = 'testing-team@divinr.ai';
```

Credentials for the Phase 3 Playwright login (stored in `apps/e2e/.env`, not
committed):

```
TEST_USER_EMAIL=testing-team@divinr.ai
TEST_USER_PASSWORD=testing-team-2026!
```

## Verification (2026-04-19)

```
email                  | is_testing | admin_grants | billing_status | portfolios | positions | club_memberships | tournament_entries
-----------------------+------------+--------------+----------------+------------+-----------+------------------+--------------------
testing-team@divinr.ai | t          | 1            | active         | 1          | 1         | 1                | 1
```

All fixture state in place. Phase 3 can log in against `https://divinr.ai` with
the seeded credentials.

## Future hosted-Supabase migration

If Divinr ever splits to a hosted Supabase project (separate from the Spark
local cluster), the prod apply sequence becomes:

1. Create the testing-team auth user via **Supabase Dashboard → Auth → Users
   → Add user** (email `testing-team@divinr.ai`, confirm email immediately,
   auto-generated UUID). Set the password to match `TEST_USER_PASSWORD`.
2. Connect to the hosted Postgres with the service-role psql URL.
3. Run the migration file.
4. Re-run the verification query above.

The migration is idempotent; safe to re-run.
