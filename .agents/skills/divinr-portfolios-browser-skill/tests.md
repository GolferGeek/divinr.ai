# Tests — Portfolios facet

Playwright smoke spec: `apps/e2e/tests/portfolios/smoke.spec.ts`.

Storage state: `apps/e2e/.auth/testing-team.json` (populated by `scripts/prepare-auth-state.ts`). The `portfolios` project in `playwright.config.ts` is configured to use this storage state.

## Numbered cases

### 1. Dashboard renders + vocabulary + no 5xx

**What**: Navigate to `/portfolios`. Dismiss the welcome modal. Assert heading visible, at least one `.portfolio-row` OR the `No portfolios yet.` empty marker, no forbidden vocabulary outside disclaimers, and zero 5xx.

```ts
test('portfolios dashboard loads, enforces vocabulary, no 5xx', async ({ page }) => {
  const serverErrors: string[] = [];
  page.on('response', (resp) => {
    const u = resp.url();
    if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
      serverErrors.push(`${resp.status()} ${u}`);
    }
  });

  await page.goto('/portfolios');
  await dismissWelcomeModal(page);

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: /^portfolios$/i, level: 1 })).toBeVisible({ timeout: 10_000 });

  const rowOrEmpty = page
    .locator('.portfolio-row')
    .first()
    .or(page.getByText(/^no portfolios yet\.?$/i));
  await expect(rowOrEmpty).toBeVisible({ timeout: 10_000 });

  const nonDisclaimerText = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]').forEach((n) => n.remove());
    return (clone.innerText || '').trim();
  });
  expect(nonDisclaimerText).not.toMatch(/\bprediction(s|ed|or)?\b/i);
  expect(nonDisclaimerText).not.toMatch(/\brecommendation\b/i);
  expect(nonDisclaimerText).not.toMatch(/\badvice\b/i);

  await page.waitForLoadState('networkidle');
  expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
});
```

## Chrome-MCP exploratory (not in CI)

- Dashboard home: open `/` and confirm `[data-test="dashboard-positions"]` appears above secondary navigation. Assert either `[data-test="dashboard-position-row"]` exists or the open-position empty state links to Analyses and Portfolios. Click a populated row and confirm it reaches the relevant instrument or Analyses route.
- Switch tabs: `mine` → `analysts` → `triples`. On `analysts` confirm the kind chips include `analyst`, `arbitrator`, `day_trader`. On `triples` confirm `AddTripleFlow` button or empty-state note renders.
- Click the user row in `mine` tab and confirm the expanded panel shows Account cards, Equity Curve, Positions list (or `No positions in last 30 days.`), Queued Trades section, and Decisions section.
- Type a known portfolio name into `[data-testid="portfolio-search"]` and confirm rows filter live.
- Toggle kind chips off and verify the matching group disappears.
- Pick `Sort: Return` and toggle direction; confirm the row order changes within each group.
- Verify the Calibration link on an analyst row navigates to `/analysts/:id/performance`.

## Running

```bash
pnpm exec playwright test --project=portfolios
```
