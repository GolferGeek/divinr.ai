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
