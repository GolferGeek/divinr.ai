# Tests — Tournaments facet

Playwright smoke spec: `apps/e2e/tests/tournaments/smoke.spec.ts`.

Storage state: `apps/e2e/.auth/testing-team.json` (populated by `scripts/prepare-auth-state.ts`). The `tournaments` project in `playwright.config.ts` is configured to use this storage state.

## Numbered cases

### 1. List renders

**What**: Navigate to `/tournaments`. Assert heading, at least one card OR the empty-state marker, and zero 5xx.

```ts
test('tournaments list loads without 5xx and shows cards or empty state', async ({ page }) => {
  const serverErrors: string[] = [];
  page.on('response', (resp) => {
    if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(resp.url())) {
      serverErrors.push(`${resp.status()} ${resp.url()}`);
    }
  });

  await page.goto('/tournaments');
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: /^tournaments$/i, level: 1 })).toBeVisible({ timeout: 10_000 });

  const cards = page.locator('.tournament-card, ion-card.tournament-card');
  const empty = page.locator('.empty');
  await expect(cards.first().or(empty)).toBeVisible({ timeout: 10_000 });

  await page.waitForLoadState('networkidle');
  expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
});
```

### 2. Vocabulary

Same pattern as `predictions/smoke.spec.ts`: clone `document.body`, strip `.legal-disclaimer` + `[surface-key]` + `[data-surface-key]`, assert no forbidden words.

### 3. Detail page tabs exist

**What**: Click the first tournament card; assert we reach `/tournaments/:id`; assert all four segment buttons are visible.

```ts
test('tournament detail shows four segment tabs', async ({ page }) => {
  await page.goto('/tournaments');
  await expect(page.getByRole('heading', { name: /^tournaments$/i, level: 1 })).toBeVisible({ timeout: 10_000 });

  const firstCard = page.locator('.tournament-card, ion-card.tournament-card').first();
  test.skip(!(await firstCard.isVisible()), 'no tournaments available in this environment');

  await firstCard.click();
  await expect(page).toHaveURL(/\/tournaments\/[\w-]+/, { timeout: 10_000 });

  for (const value of ['leaderboard', 'positions', 'trade', 'info']) {
    await expect(page.locator(`ion-segment-button[value="${value}"]`)).toBeVisible({ timeout: 10_000 });
  }
});
```

### Social opt-outs — tournament participation + leaderboard visibility (future case)

**What**: With user A signed in, navigate to `/settings/social-opt-outs`, toggle
`social_tournament_participation` off. User A joins a new tournament. As user B,
open that tournament and confirm A is **not** listed in `My Positions` /
participation rosters (applies prospectively). Separately, toggle
`social_leaderboard_visible` off; B checks the leaderboard and confirms A's
row is hidden. System cron paths (snapshot, finalize) still include A — only
user-facing reads are filtered. Restore both toggles.

Service-layer coverage lives at
`apps/api/tests/unit/social-opt-out-coverage.test.ts`. The prospective-only
nature of `social_tournament_participation` is documented on the settings tab
via the italic note on that toggle.

## Chrome-MCP exploratory (not in CI)

- `/tournaments/:id?tab=trade&symbol=AAPL&direction=long&qty=1` — verify `applyTradePrefillFromQuery` populates the trade form and clears the URL. Manual-only until we add a deterministic trade fixture.
- Leaderboard → `MemberProfileDrawer` — click a leaderboard row on a club-scoped tournament.
- Countdown line on upcoming tournament — verify countdown format and that the `Enter Game` button gates on status/canWrite.
- Toggle `social_leaderboard_visible` off at `/settings/social-opt-outs`, reload the leaderboard, confirm the signed-in user still sees themselves (owner exception) while a second session does not.

## Running

```bash
pnpm --filter @divinr/e2e exec playwright test --project=tournaments
```
