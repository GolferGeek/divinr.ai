import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

test.describe('portfolios facet — smoke', () => {
  test('dashboard loads, shows row or empty state, enforces vocabulary, no 5xx', async ({ page }) => {
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
    expect(nonDisclaimerText, 'user-visible copy (outside legal disclaimer) must not contain forbidden vocabulary').not.toMatch(/\bprediction(s|ed|or)?\b/i);
    expect(nonDisclaimerText).not.toMatch(/\brecommendation\b/i);
    expect(nonDisclaimerText).not.toMatch(/\badvice\b/i);

    await page.waitForLoadState('networkidle');
    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
