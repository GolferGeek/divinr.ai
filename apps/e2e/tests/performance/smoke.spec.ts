import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

test.describe('performance facet — smoke', () => {
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

    // Vocabulary check scoped to .performance-page so we exclude the FirstTouchPanel
    // content payload (onboarding copy may reference domain terminology intentionally)
    // and any global LegalDisclaimer wrappers.
    const text = await root.evaluate((el) => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll('.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]')
        .forEach((n) => n.remove());
      return (clone.textContent || '').trim();
    });
    expect(text, 'performance dashboard copy must not contain forbidden vocabulary').not.toMatch(/\bprediction(s|ed|or)?\b/i);
    expect(text).not.toMatch(/\brecommendation\b/i);
    expect(text).not.toMatch(/\badvice\b/i);

    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
