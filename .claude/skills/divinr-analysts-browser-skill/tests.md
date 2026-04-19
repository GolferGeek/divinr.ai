# Tests — Analysts facet

Primary section: Playwright cases the smoke spec encodes. Secondary
section: Chrome-MCP exploratory walkthrough for humans or
`divinr-test-agent --interactive analysts`.

## Playwright cases (spec: `apps/e2e/tests/analysts/smoke.spec.ts`)

### 1. Loads the analysts grid

- Preconditions: `PLAYWRIGHT_STORAGE_STATE=.auth/testing-team.json`.
- Steps:
  1. Attach `page.on('response', …)` to capture 5xx on
     `divinr.ai` / `127.0.0.1:(7100|7101)`.
  2. `await page.goto('/analysts')`.
  3. `await dismissWelcomeModal(page)`.
  4. Assert the URL has not flipped to `/login`.
  5. Assert `<h1>Analysts</h1>` is visible.
  6. Assert that **either** the first `ion-grid ion-card` is visible
     **OR** the `[surface-key="analysts"]` first-touch panel is visible.
- `expect()` calls:
  - `await expect(page).not.toHaveURL(/\/login/);`
  - `await expect(page.getByRole('heading', { name: /^analysts$/i, level: 1 })).toBeVisible({ timeout: 10_000 });`
  - `await expect(cards.first().or(firstTouch)).toBeVisible({ timeout: 10_000 });`
- Artifacts: trace + screenshot on first retry / failure (Playwright
  config defaults).

### 2. Vocabulary compliance

- Steps: clone `document.body`, strip `.legal-disclaimer`, `[data-testid="legal-disclaimer"]`, `[surface-key]`, `[data-surface-key]` subtrees, read remaining `innerText`.
- `expect()` calls:
  - `expect(text).not.toMatch(/\bprediction(s|ed|or)?\b/i);`
  - `expect(text).not.toMatch(/\brecommendation\b/i);`
  - `expect(text).not.toMatch(/\badvice\b/i);`
- Caveat: per task brief, if a real leak exists, **relax the selector or
  document in `completeness.md`** — do NOT edit `apps/web/`.

### 3. No 5xx on the happy path

- Push every response with status ≥ 500 (matching the host regex) into
  an array; `expect(serverErrors).toEqual([])` after `networkidle`.

## Verify-command snippet

```sh
cd apps/e2e
pnpm exec playwright test --project=analysts
# or single spec
pnpm exec playwright test tests/analysts/smoke.spec.ts
```

Expected output: 1 test, 1 passed. Trace artifact only on first retry
or failure.

---

## Chrome-MCP exploratory patterns (secondary section)

Use these when running `divinr-test-agent --interactive analysts` or
when a human wants to reproduce a finding without writing a spec.

1. **Open the env**
   ```
   mcp__claude-in-chrome__tabs_create_mcp url="http://127.0.0.1:7101/analysts"
   ```
2. **Read the page**
   ```
   mcp__claude-in-chrome__read_page
   ```
   Confirm `<h1>Analysts</h1>` and at least one card.
3. **Console scan**
   ```
   mcp__claude-in-chrome__read_console_messages pattern="error|warn"
   ```
4. **Drill into the first analyst's Performance**
   ```
   mcp__claude-in-chrome__javascript_tool
     code: document.querySelector('a[href*="/analysts/"][href$="/performance"]')?.click();
   ```
   Then `read_page` and verify the four aggregate tiles render.
5. **Expand the first resolved-analysis row**
   ```
   mcp__claude-in-chrome__javascript_tool
     code: document.querySelector('div[style*="cursor:pointer"]')?.click();
   ```
   `read_network_requests pattern="/predictions/.*/llm-calls"` should
   show a 200.
6. **Open the Contract editor**
   ```
   mcp__claude-in-chrome__navigate url="http://127.0.0.1:7101/analysts/<id>/contract"
   ```
   Confirm em-dash heading `{name} — Contract`, version history list,
   and `Edit` / `Diff` / `Rollback` buttons (if logged-in user has
   `canWrite`).
7. **Vocabulary scan in-browser**
   ```
   mcp__claude-in-chrome__javascript_tool
     code: |
       const c = document.body.cloneNode(true);
       c.querySelectorAll('.legal-disclaimer, [data-testid=legal-disclaimer], [surface-key], [data-surface-key]').forEach(n => n.remove());
       /\b(prediction|predicted|predictor|recommendation|advice)s?\b/i.test(c.innerText);
   ```
   Expect `false`.

Exit-criteria triage hints:

- **P2** if vocabulary leaks into visible copy outside the disclaimer /
  first-touch surfaces.
- **P1** if the grid is empty AND the first-touch panel is also absent
  (silent failure per Expectations §3).
- **P0-adjacent** if `GET /analysts` returns 5xx, or if the contract
  editor's `PUT` returns 5xx instead of the structured 400 on bad
  markdown (regression of the v4 stage-keyed validation behavior).
