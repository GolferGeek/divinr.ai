# Tests — Clubs facet

Playwright smoke spec: `apps/e2e/tests/clubs/smoke.spec.ts`.

Storage state: `apps/e2e/.auth/testing-team.json` (populated by `scripts/prepare-auth-state.ts`). The `clubs` project in `playwright.config.ts` inherits storage state via `PLAYWRIGHT_STORAGE_STATE` in `apps/e2e/.env`.

## Numbered cases

### 1. List renders + vocabulary + no 5xx (read-only)

**What**: Navigate to `/clubs`, dismiss the welcome modal, assert heading, assert at least one card OR an empty state, run vocabulary exclusion check, capture any 5xx.

**Important**: Smoke is read-only — do **not** click into a club detail or switch the My Clubs / Discover segment. That coverage belongs to a future case.

```ts
test('clubs list loads without 5xx, enforces vocabulary', async ({ page }) => {
  const serverErrors: string[] = [];
  page.on('response', (resp) => {
    const u = resp.url();
    if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
      serverErrors.push(`${resp.status()} ${u}`);
    }
  });

  await page.goto('/clubs');
  await dismissWelcomeModal(page);

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: /^clubs$/i, level: 1 })).toBeVisible({ timeout: 10_000 });

  const cards = page.locator('.clubs-page ion-card');
  const empty = page.locator('.clubs-page .empty');
  await expect(cards.first().or(empty.first())).toBeVisible({ timeout: 10_000 });

  const nonDisclaimerText = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]')
      .forEach((n) => n.remove());
    return (clone.innerText || '').trim();
  });
  expect(nonDisclaimerText).not.toMatch(/\bprediction(s|ed|or)?\b/i);
  expect(nonDisclaimerText).not.toMatch(/\brecommendation\b/i);
  expect(nonDisclaimerText).not.toMatch(/\badvice\b/i);

  await page.waitForLoadState('networkidle');
  expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
});
```

### 2. Detail page tab bar (future case — NOT in current smoke)

When promoted, click the first card and assert the six segment buttons render:

```ts
for (const value of ['members', 'analysts', 'activities', 'analytics', 'curriculum', 'mentoring']) {
  await expect(page.locator(`ion-segment.club-tabs ion-segment-button[value="${value}"]`)).toBeVisible({ timeout: 10_000 });
}
```

### 3. Deep-link tab (future case — NOT in current smoke)

```ts
await page.goto(`/clubs/${id}?tab=analytics`);
await expect(page.locator('.analytics-grid')).toBeVisible();
```

## Chrome-MCP exploratory (not in CI)

- `My Clubs` → `Discover` tab toggle — verify card list refreshes.
- Click into a club; verify the legal disclaimer (`club` variant) appears above the tab bar.
- Click each detail tab in order and confirm content loads (lazy-loaded by `loadTab(t)`).
- Click a member row in the Members tab; confirm `MemberProfileDrawer` opens.
- `/clubs/<id>?tab=mentoring` deep-link; confirm the mentoring panel renders the right state for the role (apply / request / pending feedback).
- `/clubs/invite/<token>` invite-landing flow — covered separately; needs a fresh token.

## Running

```bash
cd apps/e2e
pnpm exec playwright test --project=clubs
```
