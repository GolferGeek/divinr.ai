# Tests — Admin facet

Primary section: Playwright cases the smoke spec encodes. Secondary section:
Chrome-MCP exploratory walkthrough for humans / `divinr-test-agent --interactive admin`.

## Playwright cases (spec: `apps/e2e/tests/admin/smoke.spec.ts`)

### 1. Loads the cost-calibration admin view

- Preconditions: storage state is the testing-team session (admin role seeded in Phase 1).
- Steps:
  1. `page.goto('/admin/cost/calibration')`
  2. `await dismissWelcomeModal(page)`
  3. Wait for the heading "Cost Calibration" (h2) to be visible.
  4. Wait for either the calibration `<table>` OR the explicit empty-state row "No calibrated models yet…" to be visible.
- `expect()` calls:
  - `await expect(page).not.toHaveURL(/\/(login|welcome)/);`
  - `await expect(page.getByRole('heading', { name: /cost calibration/i })).toBeVisible({ timeout: 10_000 });`
  - `await expect(page.locator('table').or(page.locator('td', { hasText: /no calibrated models yet/i })).first()).toBeVisible({ timeout: 10_000 });`
- **No vocabulary check** — admin facet is RELAXED per `CLAUDE.md`.

### 2. No 5xx on the happy path

- Attach `page.on('response', …)` before `goto`. Push any status ≥ 500 into an array.
- Assert the array is empty at the end.

### 3. (Deferred) Refresh-button round-trip

Not part of the smoke spec — read-only smoke only. Add to a deeper spec when
the calibration data has stabilized in non-prod envs.

### 4. Admin user-billing view renders for a seeded user

Canonical spec: `apps/e2e/tests/admin/user-billing.spec.ts`.

**What**: Admin visits `/admin/users/<id>/billing` for a seeded user and sees
the subscription card, authored-items table (or an empty-state line), events
timeline, and the itemized monthly preview.

- Preconditions: testing-team session has admin role. The seeded user id is
  resolved dynamically — the spec picks the first row from
  `GET /api/billing/preview`'s underlying user context (itself) so that it
  exercises a real user without relying on hard-coded uuids.
- Steps:
  1. Fetch the logged-in user id via an API round-trip (e.g.
     `page.request.get('/api/billing/subscription')` returns `{ user_id }`).
  2. `page.goto('/admin/users/<user_id>/billing')`.
  3. `await dismissWelcomeModal(page)`.
  4. Assert `[data-testid="admin-user-billing"]` is visible.
  5. Assert `[data-testid="admin-billing-subscription"]`,
     `[data-testid="admin-billing-items"]`,
     `[data-testid="admin-billing-events"]`,
     `[data-testid="admin-billing-preview"]` each render.
  6. Assert there is at least one `[data-testid="admin-billing-event-row"]`
     (every backfilled user has a `migration_backfill` event).
  7. No 5xx responses on `/admin/users/...` during the page load.

### 5. Admin billing actions (refund / credit / comp)

Canonical spec: `apps/e2e/tests/admin/admin-refund.spec.ts`.

**What**: The Phase 5 admin endpoints `POST /admin/users/:id/billing/{refund,credit,comp}`
are RBAC-gated (require `admin.billing.refund` / `.credit` / `.comp` permissions, seeded by
`apps/api/db/migrations/2026-04-24-admin-billing-permissions.sql` to `role-admin`,
`role-super-admin`, `role-owner`). The spec asserts:
- Missing `invoiceId` → 400 (refund)
- Missing `amountCents` → 400 (credit)
- Missing `reason` → 400 (comp)
- Lack of admin permission → 403 (skip-cleanly path)

The full Stripe round-trip (refund actually issued, credit balance reduced, coupon attached)
is exercised in manual chrome testing; the spec just locks the contract shape.

The frontend modals live in `AdminUserBillingView.vue` (the same file — not extracted into
separate components for v1). Each has a confirmation checkbox + RBAC enforcement on the
backend, so you can't accidentally fire a refund.

### 6. Webhook health 7-day rollup

Canonical spec: `apps/e2e/tests/admin/admin-webhook-health.spec.ts`.

**What**: `GET /admin/billing/webhook-health` returns `{ days: [{day, processed, failed, pending}] }`
for the last 7 days from `billing.stripe_webhook_events`. The view at
`/admin/billing/webhook-health` renders the table with non-zero `failed` counts highlighted
in red. Use this as the first-line check when something looks wrong with billing — if a
day has failed events, drill into the per-user `Stripe Events` panel for the specific
`handler_error`.

## Verify-command snippet

```sh
cd apps/e2e
pnpm exec playwright test --project=admin
# or just this spec
pnpm exec playwright test tests/admin/smoke.spec.ts
```

Expected output: 1 passed. Trace only appears on first-retry or failure.

---

## Chrome-MCP exploratory patterns (secondary section)

Use these steps when `divinr-test-agent --interactive admin` runs, or a human
wants to reproduce a finding without writing a spec.

1. **Open the calibration tab**
   ```
   mcp__claude-in-chrome__tabs_create_mcp url="http://127.0.0.1:7101/admin/cost/calibration"
   ```
2. **Read the page**
   ```
   mcp__claude-in-chrome__read_page
   ```
   Confirm `<h2>Cost Calibration</h2>` and either a populated `<table>` or the empty-state row.
3. **Dump console**
   ```
   mcp__claude-in-chrome__read_console_messages pattern="error|warn"
   ```
4. **Capture the calibration network slice**
   ```
   mcp__claude-in-chrome__read_network_requests pattern="/admin/cost/"
   ```
   401 / 403 here means the session lacks admin role — file the role-gate finding.
5. **Trigger a Refresh**
   ```
   mcp__claude-in-chrome__javascript_tool
     code: |
       const buttons = [...document.querySelectorAll('ion-button')];
       const btn = buttons.find(b => /refresh now/i.test(b.textContent || ''));
       btn?.click();
       'clicked';
   ```
   Then re-read the page and confirm the summary line appears.
6. **Visit a sibling admin route**
   ```
   mcp__claude-in-chrome__navigate url="http://127.0.0.1:7101/admin/attribution/sources"
   ```
   Confirm `<h2>Source Quality</h2>` is visible and the table renders.

Exit criteria (triage severity hint):

- P3 (cosmetic) if a heading is misaligned but data renders.
- P2 if the page renders only the shell with no table and no empty-state row (silent data failure).
- P1 if API calls under `/admin/*` return 401/403 for the testing-team user (admin role missing) — file the role-gate finding.
- P0-adjacent if a Refresh click triggers a 5xx.
