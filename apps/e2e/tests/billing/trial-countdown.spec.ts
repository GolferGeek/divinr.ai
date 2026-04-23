import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

test.describe('billing facet — trial countdown chip', () => {
  test('trial-countdown visible iff status===trial && !is_read_only, no 5xx, vocab clean', async ({ page }) => {
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
    expect(j, 'billing status must carry the lifecycle shape').toMatchObject({
      status: expect.anything(),
      is_read_only: expect.any(Boolean),
    });

    const chip = page.locator('[data-testid="trial-countdown"]');
    if (j.status === 'trial' && !j.is_read_only) {
      await expect(chip).toBeVisible({ timeout: 10_000 });
      const label = (await chip.locator('ion-label').textContent())?.trim() ?? '';
      expect(label).toMatch(/^(trial ends today|1 day left|\d+ days left)$/i);
    } else {
      await expect(chip).toHaveCount(0);
    }

    // Mutual exclusion: the two banners must never both render.
    const banner = page.locator('[data-testid="read-only-banner"]');
    if (await chip.count() > 0) {
      await expect(banner).toHaveCount(0);
    }

    const nonDisclaimerText = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(
        '.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]',
      ).forEach((n) => n.remove());
      return (clone.innerText || '').trim();
    });
    expect(nonDisclaimerText).not.toMatch(/\bprediction(s|ed|or)?\b/i);
    expect(nonDisclaimerText).not.toMatch(/\brecommendation\b/i);
    expect(nonDisclaimerText).not.toMatch(/\badvice\b/i);

    await page.waitForLoadState('networkidle');
    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
