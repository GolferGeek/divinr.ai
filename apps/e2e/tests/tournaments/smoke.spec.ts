import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

test.describe('tournaments facet — smoke', () => {
  test('list loads without 5xx, enforces vocabulary, and detail tabs render', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      const u = resp.url();
      if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
        serverErrors.push(`${resp.status()} ${u}`);
      }
    });

    await page.goto('/tournaments');
    await dismissWelcomeModal(page);

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /^tournaments$/i, level: 1 })).toBeVisible({ timeout: 10_000 });

    const cards = page.locator('.tournament-card, ion-card.tournament-card');
    const empty = page.locator('.empty');
    await expect(cards.first().or(empty)).toBeVisible({ timeout: 10_000 });

    const nonDisclaimerText = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]').forEach((n) => n.remove());
      return (clone.innerText || '').trim();
    });
    expect(nonDisclaimerText, 'user-visible copy (outside legal disclaimer) must not contain forbidden vocabulary').not.toMatch(/\bprediction(s|ed|or)?\b/i);
    expect(nonDisclaimerText).not.toMatch(/\brecommendation\b/i);
    expect(nonDisclaimerText).not.toMatch(/\badvice\b/i);

    const cardVisible = await cards.first().isVisible().catch(() => false);
    if (cardVisible) {
      await cards.first().click();
      await expect(page).toHaveURL(/\/tournaments\/[\w-]+/, { timeout: 10_000 });

      for (const name of [/^leaderboard$/i, /^my positions$/i, /^trade$/i, /^info$/i]) {
        await expect(page.getByRole('tab', { name })).toBeVisible({ timeout: 10_000 });
      }
    } else {
      test.info().annotations.push({ type: 'skip-detail', description: 'no tournament cards available — detail tab assertion skipped' });
    }

    await page.waitForLoadState('networkidle');
    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
