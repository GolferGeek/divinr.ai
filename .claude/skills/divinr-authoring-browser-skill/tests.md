# Tests — Authoring facet

Playwright smoke spec: `apps/e2e/tests/authoring/smoke.spec.ts`.

Storage state: `apps/e2e/.auth/testing-team.json` (populated by `scripts/prepare-auth-state.ts`). The `authoring` project in `playwright.config.ts` is configured to use this storage state (set via `PLAYWRIGHT_STORAGE_STATE`).

## Numbered cases

### 1. Authored-content hub renders (or tier-gate redirect)

**What**: Navigate to `/settings/authored-content`. Assert one of:

- "Your Content" h1 is visible AND either an authored-content card or the empty-state copy is visible.
- An upgrade / subscribe CTA heading is visible (tier-gate branch).

Plus vocabulary check and zero 5xx during load.

```ts
test('authored-content hub loads (your content or upgrade CTA), no 5xx, vocab clean', async ({ page }) => {
  const serverErrors: string[] = [];
  page.on('response', (resp) => {
    const u = resp.url();
    if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
      serverErrors.push(`${resp.status()} ${u}`);
    }
  });

  await page.goto('/settings/authored-content');
  await dismissWelcomeModal(page);
  await expect(page).not.toHaveURL(/\/login/);

  const yourContent = page.getByRole('heading', { name: /^your content$/i, level: 1 });
  const upgradeCta  = page.getByRole('heading', { name: /upgrade|subscribe|paid plan|unlock/i });
  await expect(yourContent.or(upgradeCta)).toBeVisible({ timeout: 10_000 });

  if (await yourContent.isVisible()) {
    const analystCard = page.locator('ion-card').first();
    const empty = page.getByText(/no authored analysts yet — create your first one\.?/i);
    await expect(analystCard.or(empty)).toBeVisible({ timeout: 10_000 });
  }

  // Vocabulary check (excludes <LegalDisclaimer> + first-touch surface panels).
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

### 3. Billing tab surfaces the itemized monthly bill

**What**: The **Billing** segment tab on `/settings/authored-content` now renders
the itemized bill from `GET /api/billing/preview`: Basic $50 line, optional
per-rollup rows for Authored Analysts ($60 × N) and Authored Instruments
($20 × M), BYO platform fee line when present, and a Monthly Total footer.
Expanding a rollup reveals per-item rows with display names.

Canonical coverage lives in the billing facet:
`apps/e2e/tests/billing/bill-preview.spec.ts`
(see `.claude/skills/divinr-billing-browser-skill/tests.md` Numbered case 4).
This spec is runnable from the `billing` Playwright project; the `authoring`
project does not duplicate it.

## Chrome-MCP exploratory (not in CI)

- Switch through all five segment tabs (`analysts` -> `instruments` -> `wiring` -> `apikeys` -> `billing`) and verify each renders without console errors.
- Click **Create Analyst**, walk through the wizard (do NOT submit), verify form validation states.
- Click **Edit Contract** on an authored analyst row and confirm `/analysts/<uuid>/contract` resolves.
- Same for an instrument row -> `/instruments/<uuid>/contract`.
- Curriculum authoring: from a club detail, open the Curriculum tab and walk to `CurriculumCreateView`.

## Running

```bash
cd apps/e2e
pnpm exec playwright test --project=authoring
```
