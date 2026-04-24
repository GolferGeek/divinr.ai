---
product: divinr
severity: major
capability: authz
surface-key: instruments.add
spec: null
verify-command: PGPASSWORD=postgres psql -h 127.0.0.1 -p 7011 -U postgres -d postgres -c "SELECT pp.name FROM authz.rbac_roles rr JOIN authz.rbac_role_permissions rp ON rp.role_id = rr.id JOIN authz.rbac_permissions pp ON pp.id = rp.permission_id WHERE rr.name = 'admin' AND pp.name = 'markets.instruments.write';"
first-seen: 2026-04-24T14:30:00Z
last-seen: 2026-04-24T14:30:00Z
regression-count: 0
trace-artifact: null
---

## What failed

Users with RBAC role `admin` cannot create, update, or delete markets resources. POST `/api/markets/instruments` returns `403 Forbidden` ("Write permission denied") for any `admin`-role user, even though the controller's own role-name check treats `admin` as writable. Symptom: new-user-cannot-add-first-instrument for any account provisioned with `admin` instead of `member`/`owner`/`super-admin`/`subscriber`.

## Repro steps

1. Seed a user with RBAC role `admin` only (e.g. `testing-team@divinr.ai` on local).
2. Log in via web, navigate to `/instruments`, click Add Instrument, enter any symbol, submit.
3. Expected: instrument is created.
   Observed: POST returns 403; no instrument in `prediction.instruments`.

Also reproducible via direct API call with an `admin`-role session token.

## Root cause

Two authorization checks disagree:

- `apps/api/src/markets/markets.controller.ts:171-192` (`requireWriteAccess`) inspects `authz.rbac_user_roles` → `authz.rbac_roles.name` and accepts `['super-admin', 'owner', 'member', 'admin']`.
- `apps/api/src/markets/markets.service.ts:260-271` (`requireWrite`) calls `rbac.hasPermission(userId, 'markets.instruments.write')`, which looks up `authz.rbac_role_permissions`.

The controller passes but the service rejects because `authz.rbac_role_permissions` has **zero rows for `role-admin`** in the local DB. The seed file `apps/api/db/seed/2026-04-08-auth-bootstrap.sql:30-42` correctly grants `(role-admin, markets-instruments-read)` and `(role-admin, markets-instruments-write)` with `ON CONFLICT DO NOTHING`, so re-running the seed fixes the local state. Local drift almost certainly came from the `admin` role being added to the seed after an earlier partial run; the permission grants were never backfilled.

## Scope

- **Local** (verified): seed re-application restores `admin` write permission. Instrument creation succeeds and fires the new article-relevance backfill as expected.
- **Prod**: unknown. Needs to be checked before merging any fix. If prod has the same drift, any `admin`-role user on prod is locked out of markets mutations right now.

## Fix candidates

1. **Idempotent migration** (preferred). New migration that `INSERT ... ON CONFLICT DO NOTHING` the role-admin permission grants. Catches local and prod drift without re-running the whole bootstrap seed.
2. **Reconcile the two checks.** Drop `requireWriteAccess` (or make it delegate to `hasPermission`) so the controller and service use the same authorization source. Bigger surface — affects every `requireWriteAccess` call-site.
3. **Reseed**. Just `psql -f apps/api/db/seed/2026-04-08-auth-bootstrap.sql` against the affected DB. Works locally; not an acceptable prod fix.

## Notes

Discovered while verifying `ethan-feedback-2026-04-22` fix #1 (article-relevance backfill on createInstrument). UI-level verification of that fix was blocked by this 403 until the seed was re-applied locally. Today's 5-fix PR does not include any RBAC changes — this finding should ship as a separate PR.
