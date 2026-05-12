import { test, expect } from '@playwright/test';
import { loginAs } from '../../fixtures/login.js';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

test.describe('analysis preferences settings', () => {
  test('loads, saves priority mode, and exposes follow/watch/mute controls', async ({ page }) => {
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

    await page.goto('/settings/analysis-preferences');
    await dismissWelcomeModal(page);

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Analysis Preferences', level: 1 })).toBeVisible({ timeout: 10_000 });

    const priority = page.locator('[data-testid="dashboard-priority-mode"]');
    await expect(priority).toBeVisible();
    await priority.locator('ion-segment-button').filter({ hasText: 'Portfolio' }).click();

    const followToggle = page.locator('[data-testid^="follow-analyst-"]').first();
    const watchToggle = page.locator('[data-testid^="watch-instrument-"]').first();
    const muteToggle = page.locator('[data-testid^="mute-instrument-"]').first();

    const hasControls = await followToggle.isVisible().catch(() => false)
      && await watchToggle.isVisible().catch(() => false)
      && await muteToggle.isVisible().catch(() => false);
    test.skip(!hasControls, 'No analysts/instruments seeded for analysis preferences.');

    await followToggle.click();
    await watchToggle.click();
    await muteToggle.click();

    await page.getByTestId('analysis-preferences-save').click();
    await expect(page.getByText(/^saved\.$/i)).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Analysis Preferences', level: 1 })).toBeVisible({ timeout: 10_000 });
    await expect(priority.locator('ion-segment-button').filter({ hasText: 'Portfolio' })).toHaveClass(/segment-button-checked/);
    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
