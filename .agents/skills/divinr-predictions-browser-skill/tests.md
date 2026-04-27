# Tests — Predictions facet

Primary section: Playwright cases the smoke spec encodes. Secondary section: Chrome-MCP exploratory walkthrough for humans or the divinr-test-agent interactive mode.

## Playwright cases (spec: `apps/e2e/tests/predictions/smoke.spec.ts`)

### 1. Loads the predictions list

- Preconditions: storage state is the testing-team session.
- Steps:
  1. `page.goto('/predictions')`
  2. Wait for `page.getByRole('heading', { name: /analyses/i })` visible.
  3. Wait either for `ion-list > ion-item` first row visible (`{ timeout: 10_000 }`) OR for the first-touch panel to be visible.
- `expect()` calls:
  - `await expect(page.getByRole('heading', { name: /analyses/i })).toBeVisible();`
  - `await expect(page.locator('ion-list > ion-item').first().or(page.locator('[surface-key="predictions"]'))).toBeVisible({ timeout: 10_000 });`
- Artifacts: on fail, trace + screenshot auto-captured.

### 2. Vocabulary compliance

- Steps: read the visible text of the page, assert it does not match forbidden tokens in user-visible copy.
- `expect()` calls:
  - `const body = await page.locator('body').innerText();`
  - `expect(body).not.toMatch(/\bprediction(s|ed|or)?\b/i);`
  - `expect(body).not.toMatch(/\brecommendation\b/i);`
  - `expect(body).not.toMatch(/\badvice\b/i);`
- Caveat: if an intentional debug string leaks, update this test with a narrow allow-list plus the finding.

### 3. Role filter is interactive

- Steps: assert the `ion-select` is present and enabled.
- `expect()` calls:
  - `const filter = page.locator('ion-select').first();`
  - `await expect(filter).toBeVisible();`
  - `await expect(filter).toBeEnabled();`

### 4. No 5xx on the happy path

- Attach `page.on('response', …)` before `goto`. Push any status ≥ 500 into an array.
- Assert the array is empty at the end.

### 5. No unhandled console errors

- Attach `page.on('console', …)` (filter per base skill's `patterns/console-network-capture.md`).
- Assert captured app-code errors array is empty.

### 6a. Dashboard prediction card — slim shape (spec: `apps/e2e/tests/predictions/dashboard-card.spec.ts`)

- Surface: `/` (`DashboardView`).
- Asserts `.prediction-card` present, renders `.stance-chip-row` (or `.stance-neutral` when all analysts are flat), has a single `[data-test="dashboard-card-view"]` CTA, and that the old dense elements (`.analyst-stances`, `.trade-rec-details`) are gone.
- `test.skip()`s cleanly when no cards are seeded for the testing-team user.
- Manual density check (1440×900, ≥5 cards above the fold) lives in the PR description, not the spec.

### 6. Prediction sources component — collapse/expand + fallback

- Spec: `apps/e2e/tests/predictions/sources.spec.ts` (alongside the smoke spec).
- Surfaces: `/instruments/:id` (`InstrumentAnalystPanel`) and the `AnalystPredictionModal` Evidence tab.
- Steps:
  1. Navigate to `/instruments` and open the first instrument.
  2. Locate `[data-test="prediction-sources"]` on the latest-signal block of an `InstrumentAnalystPanel`. `test.skip()` if absent (no seeded analyst signals for the testing-team user).
  3. Click `[data-test="prediction-sources-toggle"]`.
  4. Assert either `[data-test="prediction-sources-body"]` renders at least one row with an anchor whose `target="_blank"` and `rel="noopener noreferrer"`, OR the empty copy `No articles were used in this analysis.` is visible, OR the italic fallback banner `[data-test="prediction-sources-fallback"]` renders.
- Vocabulary: body of `[data-test="prediction-sources-body"]` must not match `/prediction|predicted|recommendation|advice/i` (data-driven rationale strings excluded by scoping the assertion to the component shell — skip the rationale text node in the regex scope).

## Verify-command snippet

```sh
pnpm e2e --project=predictions
# or just this spec
pnpm --filter @divinr/e2e exec playwright test tests/predictions/smoke.spec.ts
```

Expected output: all cases pass. Trace only appears on first-retry or failure.

---

## Chrome-MCP exploratory patterns (secondary section)

Use these steps when `divinr-test-agent --interactive predictions` runs, or a human wants to reproduce a finding without writing a spec.

1. **Open a tab against the env**
   ```
   mcp__claude-in-chrome__tabs_create_mcp url="http://127.0.0.1:7101/predictions"
   ```
2. **Read the page**
   ```
   mcp__claude-in-chrome__read_page
   ```
   Confirm `<h1>Analyses</h1>` in the markup.
3. **Dump console**
   ```
   mcp__claude-in-chrome__read_console_messages pattern="error|warn"
   ```
4. **Toggle role filter via JS**
   ```
   mcp__claude-in-chrome__javascript_tool
     code:
       const el = document.querySelector('ion-select');
       el.value = 'analyst';
       el.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'analyst' } }));
       document.querySelectorAll('ion-list > ion-item').length;
   ```
   Compare the returned count vs. the `all` count captured before the toggle.
5. **Check for forbidden vocabulary**
   ```
   mcp__claude-in-chrome__javascript_tool
     code: /prediction|predicted|advice|recommendation/i.test(document.body.innerText)
   ```
   Expect `false`.
6. **Capture a network slice**
   ```
   mcp__claude-in-chrome__read_network_requests pattern="/predictions"
   ```

Exit criteria (triage severity hint):
- P2 if vocabulary leaks into visible copy.
- P1 if the list is empty AND the first-touch panel is also absent (silent failure per assertions §1 and §5).
- P0-adjacent if the trade-CTA target 404s (per assertions §6).
