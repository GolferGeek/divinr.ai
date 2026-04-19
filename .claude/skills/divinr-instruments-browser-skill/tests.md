# Tests — Instruments facet

Playwright smoke spec: `apps/e2e/tests/instruments/smoke.spec.ts`.

Storage state: `apps/e2e/.auth/testing-team.json` (populated by `scripts/prepare-auth-state.ts`). The `instruments` project in `playwright.config.ts` is configured to use this storage state.

## Numbered cases

### 1. List renders, vocabulary clean (scoped), no 5xx

**What**: Navigate to `/instruments`. Assert heading, card-or-add-button, scoped vocabulary, and zero 5xx.

```ts
test('instruments list loads without 5xx and enforces vocabulary on the list surface', async ({ page }) => {
  const serverErrors: string[] = [];
  page.on('response', (resp) => {
    const u = resp.url();
    if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
      serverErrors.push(`${resp.status()} ${u}`);
    }
  });

  await page.goto('/instruments');
  await dismissWelcomeModal(page);

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: /^instruments$/i, level: 1 }))
    .toBeVisible({ timeout: 10_000 });

  const cards = page.locator('ion-card');
  const addBtn = page.getByRole('button', { name: /add instrument/i });
  await expect(cards.first().or(addBtn)).toBeVisible({ timeout: 10_000 });

  // Scope vocabulary check to the list surface only — see where.md.
  const text = await page.evaluate(() => {
    const root =
      (document.querySelector('h1') as HTMLElement | null)?.parentElement?.parentElement
      ?? document.body;
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(
      '.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]',
    ).forEach((n) => n.remove());
    return (clone.innerText || '').trim();
  });
  expect(text).not.toMatch(/\bprediction(s|ed|or)?\b/i);
  expect(text).not.toMatch(/\brecommendation\b/i);
  expect(text).not.toMatch(/\badvice\b/i);

  await page.waitForLoadState('networkidle');
  expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
});
```

### 2. (manual) Detail page tabs

Open `/instruments/<uuid>`, assert `<h1>` is the symbol (not "Loading..."), assert both `ion-segment-button[value="analysts"]` and `ion-segment-button[value="predictors"]` are present, and click each. Not in CI smoke until an instrument fixture exists with deterministic rationale strings.

### 3. (manual) Add Instrument modal

Click `Add Instrument`, type symbol `TEST.X` + name `Smoke Test`, click Create, confirm card appears. Not in CI smoke (writes to prod).

## Chrome-MCP exploratory (not in CI)

- `/instruments/:id?analystId=<uuid>` — verify `TripleVariantSwitcher` triggers `loadData()` and the rendered analyst set narrows to one panel.
- Toggle `View history` on a panel with multiple predictions; verify the history block expands and shows older signal/risk rows.
- `/instruments/:id/contract` (admin only) — exercise the contract editor.
- Verify rationale text on the detail page does **not** contain `prediction|advice|recommendation` outside `<LegalDisclaimer>`. If it does, file a finding (see `completeness.md`).

## Running

```bash
pnpm --filter @divinr/e2e exec playwright test --project=instruments
```
