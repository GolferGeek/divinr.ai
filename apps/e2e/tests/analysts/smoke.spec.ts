import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

test.describe('analysts facet — smoke', () => {
  test('loads /analysts grid, enforces vocabulary, and stays free of 5xx', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      const u = resp.url();
      if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
        serverErrors.push(`${resp.status()} ${u}`);
      }
    });

    await page.goto('/analysts');
    await dismissWelcomeModal(page);

    // (a) heading visible — match the literal <h1>Analysts</h1> in AnalystsView.vue
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /^analysts$/i, level: 1 })).toBeVisible({ timeout: 10_000 });

    // (b) grid container always renders (empty or populated). FirstTouchPanel is hidden
    // once dismissed, so we don't rely on it as an alternative.
    await expect(page.locator('ion-grid').first()).toBeVisible({ timeout: 10_000 });

    // (c) vocabulary check with .legal-disclaimer / [surface-key] exclusion
    const nonDisclaimerText = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll('.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]')
        .forEach((n) => n.remove());
      return (clone.innerText || '').trim();
    });
    expect(
      nonDisclaimerText,
      'user-visible copy (outside legal disclaimer + first-touch surfaces) must not contain forbidden vocabulary',
    ).not.toMatch(/\bprediction(s|ed|or)?\b/i);
    expect(nonDisclaimerText).not.toMatch(/\brecommendation\b/i);
    expect(nonDisclaimerText).not.toMatch(/\badvice\b/i);

    // (d) no 5xx on divinr.ai / 127.0.0.1:(7100|7101)
    await page.waitForLoadState('networkidle');
    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
