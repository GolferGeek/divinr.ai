import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

test.describe('predictions facet — smoke', () => {
  test('loads analyses list and enforces vocabulary + no 5xx', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      const u = resp.url();
      if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
        serverErrors.push(`${resp.status()} ${u}`);
      }
    });

    await page.goto('/predictions');
    await dismissWelcomeModal(page);

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /analyses/i, level: 1 })).toBeVisible({ timeout: 10_000 });

    const heading = page.locator('h1', { hasText: /analyses/i });
    const viewRoot = heading.locator('..');
    const filter = viewRoot.locator('ion-select').first();
    await expect(filter).toBeVisible();
    await expect(filter).toBeEnabled();

    // Vocabulary check: exclude <LegalDisclaimer> copy (required to say "not a prediction model"
    // and "not investment advice" per CLAUDE.md), and exclude the first-touch onboarding panel
    // which may reference domain terminology intentionally.
    const nonDisclaimerText = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]').forEach((n) => n.remove());
      return (clone.innerText || '').trim();
    });
    expect(nonDisclaimerText, 'user-visible copy (outside legal disclaimer) must not contain forbidden vocabulary').not.toMatch(/\bprediction(s|ed|or)?\b/i);
    expect(nonDisclaimerText).not.toMatch(/\brecommendation\b/i);
    expect(nonDisclaimerText).not.toMatch(/\badvice\b/i);

    await page.waitForLoadState('networkidle');
    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
