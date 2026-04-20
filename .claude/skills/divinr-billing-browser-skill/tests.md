# Tests — Billing facet

Playwright specs:

- `apps/e2e/tests/billing/trial-countdown.spec.ts` — app-shell chip smoke, branch A / B tolerant.
- `apps/e2e/tests/billing/read-only-banner.spec.ts` — in-content alert smoke, branch C tolerant.
- `apps/e2e/tests/billing/social-opt-outs.spec.ts` — `/settings/social-opt-outs` page renders the five toggles, `GET` + `PATCH /api/users/:id/social-opt-outs` round-trip works, vocab guard clean.

Storage state: `apps/e2e/.auth/testing-team.json` (populated by `scripts/prepare-auth-state.ts`). The `billing` project in `playwright.config.ts` uses this storage state via `PLAYWRIGHT_STORAGE_STATE`.

## Numbered cases

### 1. Trial countdown chip renders when in trial; absent otherwise

**What**: Navigate to `/` (dashboard), fetch `GET /api/billing/status`, and assert the chip visibility matches the lifecycle branch returned by the API.

```ts
test('trial-countdown chip is visible iff status===trial, no 5xx, vocab clean', async ({ page }) => {
  const serverErrors: string[] = [];
  page.on('response', (resp) => {
    const u = resp.url();
    if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
      serverErrors.push(`${resp.status()} ${u}`);
    }
  });

  await page.goto('/');
  await dismissWelcomeModal(page);
  await expect(page).not.toHaveURL(/\/login/);

  const resp = await page.request.get('/api/billing/status');
  expect(resp.status()).toBe(200);
  const j = await resp.json();

  const chip = page.locator('[data-testid="trial-countdown"]');
  if (j.status === 'trial' && !j.is_read_only) {
    await expect(chip).toBeVisible({ timeout: 10_000 });
    const label = (await chip.locator('ion-label').textContent())?.trim() ?? '';
    expect(label).toMatch(/^(trial ends today|1 day left|\d+ days left)$/i);
  } else {
    await expect(chip).toHaveCount(0);
  }

  await expect(
    page.locator('[data-testid="read-only-banner"]').and(page.locator('[data-testid="trial-countdown"]')),
  ).toHaveCount(0);

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

### 2. Read-only banner renders when is_read_only; absent otherwise

**What**: Navigate to `/`, fetch `GET /api/billing/status`, and gate banner assertions on `is_read_only`.

```ts
test('read-only banner is visible iff is_read_only; disclaimer + CTA present on branch C', async ({ page }) => {
  const serverErrors: string[] = [];
  page.on('response', (resp) => {
    const u = resp.url();
    if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
      serverErrors.push(`${resp.status()} ${u}`);
    }
  });

  await page.goto('/');
  await dismissWelcomeModal(page);
  await expect(page).not.toHaveURL(/\/login/);

  const resp = await page.request.get('/api/billing/status');
  expect(resp.status()).toBe(200);
  const j = await resp.json();

  const banner = page.locator('[data-testid="read-only-banner"]');
  if (j.is_read_only) {
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(banner.getByText(/your trial has ended\.?/i)).toBeVisible();
    await expect(banner.getByRole('button', { name: /^add a card$/i })).toBeVisible();
    // Disclaimer MUST route through <LegalDisclaimer>.
    const disclaimer = banner.locator('.legal-disclaimer, [data-testid="legal-disclaimer"]');
    await expect(disclaimer).toHaveCount(1);
  } else {
    await expect(banner).toHaveCount(0);
  }

  await page.waitForLoadState('networkidle');
  expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
});
```

### 3. Social opt-outs tab renders five toggles and round-trips PATCH

**What**: Navigate to `/settings/social-opt-outs`. Confirm each of the five toggles
(`social-opt-out-social_visible_in_member_lists`,
`social-opt-out-social_messaging_enabled`,
`social-opt-out-social_tournament_participation`,
`social-opt-out-social_leaderboard_visible`,
`social-opt-out-social_notifications_enabled`) is visible. Fetch
`GET /api/users/:id/social-opt-outs` for the authenticated user, flip a flag via
`PATCH`, confirm response echoes the new state, restore. Vocab guard clean.

See `apps/e2e/tests/billing/social-opt-outs.spec.ts` for the canonical
implementation.

## Chrome-MCP exploratory (not in CI)

- Force the lifecycle via a DB update (dev only): flip `users.billing_status` to `trial` with `trial_ends_at = now() + interval '2 days'`, reload, confirm the chip reads "2 days left" and color is `danger`.
- Force read-only: `trial_ends_at = now() - interval '1 day'`, run the lifecycle cron (or call `billing.computeLifecycleTransitions` via Nest context), reload, confirm the banner appears on every route (`/`, `/instruments`, `/portfolios`, `/clubs`).
- Click "Add a card" on the banner and verify navigation to `/settings/authored-content`.
- Remove the user's billing row entirely; confirm both banners stay absent and the API returns `status: null`.

## Running

```bash
cd apps/e2e
pnpm exec playwright test --project=billing
```
