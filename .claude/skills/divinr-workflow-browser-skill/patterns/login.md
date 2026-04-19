# Login & Storage-State Reuse

Divinr tests do not log in per-test. They log in once, produce a storage-state JSON, and reuse it across all specs within a run. This keeps prod login volume low (Supabase rate-limits) and avoids flaky login regressions from masking the actual test failure.

## Storage-state file

- Path: `apps/e2e/.auth/testing-team.json` (gitignored).
- Produced by: `apps/e2e/scripts/prepare-auth-state.ts`.
- Consumed by: every spec automatically via `playwright.config.ts`'s `use.storageState = process.env.PLAYWRIGHT_STORAGE_STATE`.

## Producing a fresh state

```bash
cd /home/golfergeek/projects/divinr.ai
export TEST_USER_EMAIL=testing-team@divinr.ai
export TEST_USER_PASSWORD=<from apps/e2e/.env>
pnpm --filter @divinr/e2e run prepare-auth
```

This launches headless Chromium, logs in against `BASE_URL` (default `https://divinr.ai`), and writes the storage state. Run it once per local dev session, and once per cron run.

## Using the fixture

For specs that need a fresh login (rare — e.g., testing the login form itself):

```ts
import { test } from '@playwright/test';
import { loginAs } from '../../fixtures/login';

test('login round-trip', async ({ page }) => {
  await loginAs(page, process.env.TEST_USER_EMAIL!, process.env.TEST_USER_PASSWORD!);
  // assertions...
});
```

Most specs do not call `loginAs` directly — they rely on the pre-seeded storage state.

## When to re-login

- Storage state older than 24h (Supabase session may have expired — `accessToken` is short-lived).
- A previous spec run failed with a redirect back to `/login` (stale state).
- After rotating the test user's password.

The cron pipeline refreshes storage state at the start of `divinr-discover` to bound staleness to one day.

## Credentials

The test user `testing-team@divinr.ai` is seeded by `apps/api/db/migrations/2026-04-19-testing-team-seed.sql`. Its password lives only in `apps/e2e/.env` (gitignored) and the local Supabase's `auth.users.encrypted_password`. Never commit the plaintext.
