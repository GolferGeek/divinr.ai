import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

// Read-only smoke for the admin facet.
//
// Targets `/admin/cost/calibration` (CostCalibrationView). Per CLAUDE.md the
// admin facet is RELAXED on the user-visible vocabulary rule (forbidden words
// "prediction" / "advice" / "recommendation" are allowed in admin copy), so
// this spec deliberately omits the vocabulary check that other facet smokes
// include.
test.describe('admin facet — smoke', () => {
  test('loads /admin/cost/calibration with heading + content (no 5xx)', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      const u = resp.url();
      if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
        serverErrors.push(`${resp.status()} ${u}`);
      }
    });

    await page.goto('/admin/cost/calibration');
    await dismissWelcomeModal(page);

    // (a) Route resolves — not redirected to login or welcome.
    await expect(page).not.toHaveURL(/\/(login|welcome)/);

    // (a) Heading visible (h2 in CostCalibrationView).
    await expect(
      page.getByRole('heading', { name: /cost calibration/i }),
    ).toBeVisible({ timeout: 10_000 });

    // (b) Content container visible — the calibration table is always rendered
    // (it ships with an explicit empty-state row when there are no rows).
    await expect(page.locator('table').first()).toBeVisible({ timeout: 10_000 });

    // (c) NO vocabulary check — admin facet is RELAXED per CLAUDE.md.

    // (d) No 5xx on the happy path.
    await page.waitForLoadState('networkidle');
    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
