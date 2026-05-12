import { test, expect } from '@playwright/test';
import { loginAs } from '../../fixtures/login.js';
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
  test('slim card shape: chip row, View opens instrument detail, Read-more opens modal', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      const u = resp.url();
      if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
        serverErrors.push(`${resp.status()} ${u}`);
      }
    });

    await loginAs(
      page,
      process.env.TEST_USER_EMAIL ?? 'testing-team@divinr.ai',
      process.env.TEST_USER_PASSWORD ?? 'change-me',
    );

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
    await expect(firstCard.locator('[data-test="dashboard-analysis-reasons"]').first()).toBeVisible();
    await expect(firstCard.locator('.analyst-stances')).toHaveCount(0);
    await expect(firstCard.locator('.trade-rec-details')).toHaveCount(0);

    const viewBtn = firstCard.locator('[data-test="dashboard-card-view"]');
    await expect(viewBtn).toBeVisible();
    await viewBtn.click();
    await expect(page).toHaveURL(/\/instruments\/[\w-]+/, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: /^back$/i })).toBeVisible({ timeout: 10_000 });

    await page.goBack();
    await page.waitForLoadState('networkidle');

    const readMore = firstCard.locator('[data-test="dashboard-card-read-more"]');
    const hasReadMore = await readMore.count();
    if (hasReadMore > 0) {
      await readMore.click();
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    }

    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
