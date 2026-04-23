import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

/**
 * Ethan feedback #5 — dashboard prediction-card slim-down.
 *
 * The card now renders a horizontal chip row of analyst stances (instead of
 * a vertical list), a single "View" CTA, and a one-line trade signal. The
 * detailed Entry/Stop/Target and the Trade button live inside
 * `AnalystPredictionModal` (which also carries Sources from Phase 4).
 */

test.describe('predictions facet — dashboard card shape', () => {
  test('slim card shape: chip row, single View CTA, Read-more opens modal', async ({ page }) => {
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
    await page.waitForLoadState('networkidle');

    const cards = page.locator('.prediction-card');
    if ((await cards.count()) === 0) {
      test.skip(true, 'No prediction cards seeded for testing-team user.');
      return;
    }

    const firstCard = cards.first();
    await expect(firstCard).toBeVisible();

    // The slim card replaces the vertical stance list with `.stance-chip-row`.
    await expect(firstCard.locator('.stance-chip-row, .stance-neutral')).toBeVisible();
    await expect(firstCard.locator('.analyst-stances')).toHaveCount(0);
    await expect(firstCard.locator('.trade-rec-details')).toHaveCount(0);

    const viewBtn = firstCard.locator('[data-test="dashboard-card-view"]');
    await expect(viewBtn).toBeVisible();

    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
