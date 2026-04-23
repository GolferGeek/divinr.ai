import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

test.describe('analysts facet — analyst performance back button', () => {
  test('in-page Back returns to /performance when entered from there', async ({ page }) => {
    await page.goto('/performance');
    await dismissWelcomeModal(page);

    const leaderboardRow = page.locator('tr.leaderboard-row').first();

    const hasLeaderboard = await leaderboardRow
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    test.skip(!hasLeaderboard, 'performance dashboard has no analyst leaderboard rows (empty state)');

    await leaderboardRow.click();
    await page.waitForURL(/\/analysts\/[^/]+\/performance$/, { timeout: 15_000 });

    const backBtn = page.locator('[data-test="analyst-performance-back"]');
    await expect(backBtn).toBeVisible({ timeout: 10_000 });
    await backBtn.click();

    await page.waitForURL((u) => /\/performance$/.test(u.pathname) && !/\/analysts\//.test(u.pathname), {
      timeout: 10_000,
    });
    expect(new URL(page.url()).pathname).toBe('/performance');
  });

  test('in-page Back falls back to /analysts on deep-link entry', async ({ page }) => {
    await page.goto('/analysts');
    await dismissWelcomeModal(page);

    // /analysts cards don't directly link to /performance, but they DO link to
    // /analysts/:id/contract. Extract any analyst ID from those links and
    // synthesize the /performance URL for a deep-link navigation.
    const analystId = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/analysts/"]'));
      for (const a of anchors) {
        const m = (a.getAttribute('href') || '').match(/\/analysts\/([^/?#]+)/);
        if (m) return m[1];
      }
      return null;
    });

    test.skip(!analystId, 'no seeded analyst available to deep-link into');

    await page.goto(`/analysts/${analystId}/performance`);
    await page.waitForURL(/\/analysts\/[^/]+\/performance$/, { timeout: 15_000 });

    const backBtn = page.locator('[data-test="analyst-performance-back"]');
    await expect(backBtn).toBeVisible({ timeout: 10_000 });
    await backBtn.click();

    await page.waitForURL((u) => u.pathname === '/analysts', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/analysts');
  });
});
