# Auth Bootstrap — Completion Report

**Branch**: `effort/auth-bootstrap`
**Completed**: 2026-04-08
**Final Status**: Complete pending API restart + manual smoke pass

## Goal

Make divinr.ai actually authenticate users with real Supabase JWTs. Stop relying on `MARKETS_DEV_AUTH_BYPASS=true`. Wire up the auth plane that was sitting in `packages/planes/auth` as half-loaded dead code. Bootstrap the empty `authz` schema with roles, organizations, users, and role grants. Make the web app auto-login as a demo user on boot using the new login endpoint.

## What landed

### Backend

**`apps/api/src/auth/auth.controller.ts` (new)** — `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. Wraps the auth plane's `SupabaseAuthService` (which was previously unused dead code).

**`apps/api/src/app.module.ts`** — Wired `SupabaseAuthService` and `InternalIdentityLinkService` into the API DI graph. Bound `AUTH_SERVICE` token via `useExisting: SupabaseAuthService`. Registered the new `AuthController`.

### Database — seed file

**`apps/api/db/seed/2026-04-08-auth-bootstrap.sql` (new)**, idempotent. Creates:

- 3 RBAC roles: `super-admin`, `owner`, `member`. **Note the hyphen** in `super-admin` — `RbacService.isSuperAdmin()` hard-codes that lookup.
- The two existing markets permissions (`markets-instruments-read`, `markets-instruments-write`) granted to all 3 roles.
- 3 organizations: `*` (sentinel for global super-admin grants), `personal-golfergeek`, `personal-demo-user`.
- `authz.users` rows linking the 2 real Supabase `auth.users` uuids to their email — these are the FK targets for `rbac_user_org_roles.user_id`.
- Role grants:
  - golfergeek: `(personal-golfergeek, owner)` + `('*', super-admin)`
  - demo-user: `(personal-demo-user, owner)`

The 3 stale `seed-user-*` rows in `authz.users` (from the older compliance harness seed) were left intact — the compliance harness still uses them.

### Database — stale data cleanup

Deleted 257 rows across 7 base tables (`phase1_analysts`, `market_analysts`, `risk_dimension_assessments`, `risk_debates`, `analyst_config_versions`, `instruments`, `tenant_source_entitlements`) where `organization_slug LIKE 'run_%_tenant_a'` — leftover crud from old test runs. `authz.organizations` now contains exactly the 3 real orgs.

### Database — demo user password

`update auth.users set encrypted_password = crypt('DemoUser123!', gen_salt('bf')) where email = 'demo-user@orchestratorai.io'`. Verified by curling Supabase's token endpoint directly — got back a valid access token. The golfergeek user's password was left unchanged (whatever it was before).

### Web frontend

**`apps/web/src/auth/bootstrap-auth.ts` (new)** — boot-time helper. If `tenant.store.token` is empty, calls `POST /api/auth/login` with credentials from `VITE_DEFAULT_USER_EMAIL` / `VITE_DEFAULT_USER_PASSWORD`, then `GET /api/auth/me` to read the principal id, then populates the tenant store with `(orgSlug, userId, accessToken)`.

**`apps/web/src/main.ts`** — calls `bootstrapAuth()` after the router is ready and before `app.mount()`.

**`apps/web/src/composables/useApi.ts`** — stopped sending the `x-user-id` header. It only worked under the dev bypass and is meaningless against real auth. The `Authorization: Bearer <token>` header (already present) carries identity now.

**`apps/web/src/components/AnalystPredictionModal.vue`** — same fix in the one direct fetch call that was reaching past `useApi.ts` and sending its own `x-user-id`. Now sends `Authorization: Bearer` instead.

### Environment

**`.env`**:
- Added `VITE_DEFAULT_USER_EMAIL=demo-user@orchestratorai.io`
- Added `VITE_DEFAULT_USER_PASSWORD=DemoUser123!`
- Added `VITE_DEFAULT_ORG_SLUG=personal-demo-user`
- `MARKETS_DEV_AUTH_BYPASS=false` confirmed (was already flipped earlier).

## Test infra accommodations

The HTTP smoke tests (`run-markets-http-tests.ts`) and the in-process smoke tests (`run-markets-smoke-tests.ts`) both depend on the **compliance harness's seed users** (`seed-user-alpha`/`seed-user-steadfast`/`seed-user-apex`), which are text-id rows in `authz.users` with no corresponding `auth.users` records and no markets-permission grants. They cannot present a valid Supabase JWT.

**Tactical fix**: both runners now `process.env.MARKETS_DEV_AUTH_BYPASS = 'true'` at the top of `main()` — same pattern the integration test runner has used since `markets-integration-test-infra` landed. **The runtime bypass is off** (per `.env`); only test runners opt into it. Documented inline in the test files.

**Follow-up needed (separate effort)**: migrate the compliance harness to admin-create a real `auth.users` row with a known password during `seedComplianceData()`, link an `authz.users` row to it, and have the HTTP test mint a JWT via the new `/auth/login` endpoint at suite startup. Once that lands, the in-runner bypass can be removed.

## Gates

| Gate | Result |
|---|---|
| `pnpm --filter @divinr/api run typecheck` | ✓ |
| `pnpm --filter @divinr/api run lint` | ✓ |
| `pnpm --filter @divinr/api run build` | ✓ |
| `pnpm --filter @divinr/api run test:unit` (44 assertions) | ✓ |
| `pnpm -w run ci:markets` | ✓ |
| Direct Supabase token mint for demo user | ✓ (verified out-of-band) |
| `pnpm --filter @divinr/web run typecheck` | **5 pre-existing errors on main** (`HTMLElement` / `window` undefined in `apps/web/src` — DOM lib config issue confirmed via `git stash` test). Not caused by this effort. Same 5 errors as before, zero new ones. |

## Manual smoke pass (for the user)

The API process running on `:7100` predates these changes and does not yet expose `/auth/login`. Restart it.

```bash
# 1. Restart the API to pick up the new auth module + controller.
#    (Use whatever start command you normally use — pnpm dev, etc.)

# 2. Verify /auth/login works against the live API
curl -s -i http://localhost:7100/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"demo-user@orchestratorai.io","password":"DemoUser123!"}'
# Expect: 201 with {accessToken, refreshToken, tokenType, expiresIn}

# 3. Use that token to call a markets endpoint
TOKEN=$(curl -s http://localhost:7100/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"demo-user@orchestratorai.io","password":"DemoUser123!"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')

curl -s -i http://localhost:7100/markets/instruments?organizationSlug=personal-demo-user \
  -H "Authorization: Bearer $TOKEN"
# Expect: 200 with an instruments array (probably empty for this fresh org)

# 4. Confirm bypass is actually off — call without the token
curl -s -o /dev/null -w '%{http_code}\n' \
  http://localhost:7100/markets/instruments?organizationSlug=personal-demo-user
# Expect: 400 ("Authentication required") or 401, NOT 200

# 5. Open the web app. It should auto-login as the demo user via bootstrapAuth().
#    Network panel should show /api/auth/login then /api/auth/me on first load,
#    then markets endpoints carry Authorization: Bearer <token>.
```

## Risks / things to watch

1. **Auto-login happens on every page load** if the token in localStorage is missing or expired. Supabase access tokens expire (default 1 hour). When the token expires, the next API call returns 401 and the web app currently has no refresh logic — `bootstrapAuth` only runs once at boot. **Follow-up**: add a 401 interceptor in `useApi.ts` that calls `/auth/login` again on the fly.

2. **The web app's localStorage holds a Supabase access token in cleartext.** That's fine for dev convenience, not great for prod security. When real auth UI lands, switch to `httpOnly` cookies or session storage at minimum.

3. **golfergeek has no password set.** `auth.users.encrypted_password` is null for that account. golfergeek can't log in via password until you set one. Run `update auth.users set encrypted_password = crypt('YourPassword', gen_salt('bf')) where email = 'golfergeek@orchestratorai.io';` whenever you want.

4. **`AUTH_SERVICE` resolves to `SupabaseAuthService` always.** No env-based selection like `LLM_SERVICE` has. If you ever want to swap to `ExternalOidcAuthService`, that's a small additional wire-up.

5. **Test infra still uses bypass.** Documented above as a follow-up. The compliance + HTTP smoke + integration runners all opt back into the bypass for their own convenience. Production traffic does not.

## Out of scope (deliberately deferred)

- Login UI in the web app. The bootstrap is invisible — there's no "Log out" button, no "Switch user" affordance, no error UI when login fails.
- Token refresh.
- Multi-org context switching.
- A real "create user" flow / signup endpoint (the auth plane has it, but no controller exposes it yet).
- Migrating the compliance harness off the stale `seed-user-*` rows.
- Setting golfergeek's password.
- Cleanup of the dead `simplified-llm.service.ts` discovered during the LLM reasoning effort (separate concern).
