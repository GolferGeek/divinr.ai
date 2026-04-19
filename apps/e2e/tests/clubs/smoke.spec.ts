import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

test.describe('clubs facet — smoke', () => {
  test('list loads without 5xx and enforces vocabulary', async ({ page }) => {
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

    // Either at least one club card or an empty-state marker — both-missing is a failure.
    const cards = page.locator('.clubs-page ion-card');
    const empty = page.locator('.clubs-page .empty');
    await expect(cards.first().or(empty.first())).toBeVisible({ timeout: 10_000 });

    // Vocabulary check: exclude <LegalDisclaimer> copy (required to say "not a prediction model"
    // and "not investment advice" per CLAUDE.md), and exclude the first-touch onboarding panel
    // which may reference domain terminology intentionally.
    const nonDisclaimerText = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]')
        .forEach((n) => n.remove());
      return (clone.innerText || '').trim();
    });
    expect(nonDisclaimerText, 'user-visible copy (outside legal disclaimer) must not contain forbidden vocabulary').not.toMatch(/\bprediction(s|ed|or)?\b/i);
    expect(nonDisclaimerText).not.toMatch(/\brecommendation\b/i);
    expect(nonDisclaimerText).not.toMatch(/\badvice\b/i);

    await page.waitForLoadState('networkidle');
    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
