import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

test.describe('billing facet — read-only banner', () => {
  test('read-only-banner visible iff is_read_only; disclaimer + CTA present on branch C', async ({ page }) => {
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
    expect(resp.status(), 'GET /api/billing/status must return 200').toBe(200);
    const j = await resp.json();

    const banner = page.locator('[data-testid="read-only-banner"]');
    if (j.is_read_only) {
      await expect(banner).toBeVisible({ timeout: 10_000 });
      await expect(banner).toHaveAttribute('role', 'alert');
      await expect(banner.getByText(/your trial has ended\.?/i)).toBeVisible();
      await expect(banner.getByRole('button', { name: /^add a card$/i })).toBeVisible();
      // Disclaimer MUST route through <LegalDisclaimer>.
      const disclaimer = banner.locator('.legal-disclaimer, [data-testid="legal-disclaimer"]');
      await expect(disclaimer.first()).toBeVisible();
    } else {
      await expect(banner).toHaveCount(0);
    }

    await page.waitForLoadState('networkidle');
    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
