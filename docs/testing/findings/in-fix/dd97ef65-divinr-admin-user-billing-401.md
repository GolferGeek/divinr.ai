---
product: divinr
severity: P0
capability: admin
surface-key: admin.user-billing
spec: apps/e2e/tests/admin/user-billing.spec.ts
verify-command: pnpm --filter @divinr/e2e exec playwright test --project=admin
first-seen: 2026-04-20T06:44:04Z
last-seen: 2026-04-20T06:44:04Z
regression-count: 0
trace-artifact: /tmp/divinr-results/admin-artifacts/admin-user-billing-admin-f-f6e4e--billing-and-see-every-card-admin-retry1/trace.zip
status: in-fix
triaged-date: 2026-04-20
assigned-agent: divinr-test-agent
---

## What failed

The admin user-billing spec fails at `user-billing.spec.ts:28` —
`page.request.get('/api/billing/subscription')` returns HTTP 401 instead of the
expected 200. The spec resolves the logged-in user's id via that endpoint
before loading `/admin/users/<self>/billing`, so it never reaches the
admin-view assertions.

## Repro steps

1. `cd /home/golfergeek/projects/divinr.ai/apps/e2e`
2. `pnpm exec playwright test --project=admin`
3. Expected: `GET /api/billing/subscription` returns 200 with
   `{ user_id, status, ... }` for the authenticated testing-team session.
4. Observed: 401 Unauthorized. The spec's `expect(subResp.status()).toBe(200)`
   assertion fires immediately.

## Notes

- Trace: `/tmp/divinr-results/admin-artifacts/admin-user-billing-admin-f-f6e4e--billing-and-see-every-card-admin-retry1/trace.zip`.
- Two possible root causes for the 401 — triage should look at both:
  1. **Stale auth state**: `apps/e2e/.auth/testing-team.json` was captured
     2026-04-19T20:44 and this run fired 2026-04-20T06:44. Supabase access
     tokens default to a short TTL; the refresh token in the stored state
     may or may not have been consumed by the app shell before the spec's
     raw `page.request.get` fired.
  2. **Raw `page.request` bypasses the app's Authorization header**: the
     spec uses Playwright's `APIRequestContext`, which issues a bare fetch
     independent of the browser's app-layer HTTP wrapper. If the testing
     harness relies on the app to attach `Authorization: Bearer <token>`
     from `localStorage.divinr_token`, then raw `page.request` will always
     arrive at the API without a bearer header. This is a spec design bug,
     not a product bug — the `/admin/users/:id/billing` controller landed
     in Phase 6 with working auth (unit + compliance tests pass).
- Companion failures: portfolios (6b7d933c), performance (b3c97050),
  authoring (528d542d). Only the admin spec surfaces an explicit 401 — the
  other three swallow the auth failure and time out on missing rows.
- First failure on this spec since it was added in Phase 6 of the
  `user-billing-model` effort (commit 3c0fd56, branch
  `effort/user-billing-model`). The spec was authored but not executed in
  a headed session before this cron pass.
- Severity left at `major` per agent rules.
