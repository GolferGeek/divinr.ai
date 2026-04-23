# Tests — Performance facet

Playwright smoke spec: `apps/e2e/tests/performance/smoke.spec.ts`.

Storage state: `apps/e2e/.auth/testing-team.json` (populated by `scripts/prepare-auth-state.ts`).
The `performance` project in `playwright.config.ts` is configured to use this storage state.

## Numbered cases

### 1. Dashboard renders (one terminal state) and vocabulary clean, no 5xx

**What**: Navigate to `/performance`. Assert heading, then assert that exactly one of the
three terminal states becomes visible (empty-state, no-data, or a chart canvas). Assert the
non-disclaimer text inside `.performance-page` is vocabulary-clean. Assert zero 5xx.

```ts
test('performance dashboard renders, vocabulary clean, no 5xx', async ({ page }) => {
  const serverErrors: string[] = [];
  page.on('response', (resp) => {
    const u = resp.url();
    if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
      serverErrors.push(`${resp.status()} ${u}`);
    }
  });

  await page.goto('/performance');
  await dismissWelcomeModal(page);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: /^performance$/i, level: 2 })).toBeVisible({ timeout: 10_000 });

  const root = page.locator('.performance-page');
  const emptyState = root.locator('.empty-state');
  const noData = root.locator('.no-data').first();
  const chartCanvas = root.locator('.chart-container canvas');

  await page.waitForLoadState('networkidle');
  await expect(emptyState.or(noData).or(chartCanvas)).toBeVisible({ timeout: 10_000 });

  // Vocabulary check scoped to .performance-page (excludes FirstTouchPanel content payload)
  const text = await root.evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]').forEach((n) => n.remove());
    return (clone.textContent || '').trim();
  });
  expect(text).not.toMatch(/\bprediction(s|ed|or)?\b/i);
  expect(text).not.toMatch(/\brecommendation\b/i);
  expect(text).not.toMatch(/\badvice\b/i);

  expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
});
```

### Social opt-outs — analyst leaderboard visibility (forward-compatible note)

**What**: The current `/performance` leaderboard is analyst-scoped (not
per-user), so no user-visible row is hidden by `social_leaderboard_visible`
today. When a cross-user surface lands (e.g., a "top traders" leaderboard),
wire it through `SocialOptOutService.applyVisibilityFilter` with
`social_leaderboard_visible` and extend this doc with a two-user verification
case modeled on the clubs / tournaments entries.

Service-layer coverage of the flag is asserted at
`apps/api/tests/unit/social-opt-out-coverage.test.ts` via the
clubs-analytics / tournaments-leaderboard surfaces.

## Chrome-MCP exploratory (not in CI)

- Range segment switching: click `1W` → `1M` → `3M` → `All`, verify the equity-curve refetches
  (network panel: `/performance/dashboard?days=...`). Confirm chart re-renders.
- Leaderboard row click: pick a populated row, click, confirm route lands at `/analysts/:id/performance`.
- `/analysts/:id/performance`: confirm the lazy-loaded `CalibrationScatter` SVG renders.
- `/attribution/mine`: confirm sparkline polyline renders when history exists.
- `/attribution/admin`: switch through five segment tabs, confirm filter inputs persist.

## Running

```bash
pnpm --filter @divinr/e2e exec playwright test --project=performance
```
