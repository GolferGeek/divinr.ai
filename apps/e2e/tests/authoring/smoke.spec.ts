import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

test.describe('authoring facet — smoke', () => {
  test('authored-content hub loads (your-content or upgrade CTA), no 5xx, vocab clean', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      const u = resp.url();
      if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
        serverErrors.push(`${resp.status()} ${u}`);
      }
    });

    await page.goto('/settings/authored-content');
    await dismissWelcomeModal(page);

    await expect(page).not.toHaveURL(/\/login/);

    // Heading disjunction: primary "Your Content" hub OR tier-gate upgrade CTA.
    const yourContent = page.getByRole('heading', { name: /^your content$/i, level: 1 });
    const upgradeCta = page.getByRole('heading', { name: /upgrade|subscribe|paid plan|unlock/i });
    await expect(yourContent.or(upgradeCta)).toBeVisible({ timeout: 10_000 });

    // On the primary path, also assert at least one authored-content surface signal:
    // either an authored-item card OR the explicit empty-state copy.
    if (await yourContent.isVisible()) {
      const analystCard = page.locator('ion-card').first();
      const empty = page.getByText(/no authored analysts yet — create your first one\.?/i);
      await expect(analystCard.or(empty)).toBeVisible({ timeout: 10_000 });
    }

    // Vocabulary check: exclude <LegalDisclaimer> copy (required to say "not a prediction model"
    // and "not investment advice" per CLAUDE.md), and exclude first-touch onboarding panels
    // which may reference domain terminology intentionally.
    const nonDisclaimerText = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]').forEach((n) => n.remove());
      return (clone.innerText || '').trim();
    });
    expect(nonDisclaimerText, 'user-visible copy (outside legal disclaimer) must not contain forbidden vocabulary').not.toMatch(/\bprediction(s|ed|or)?\b/i);
    expect(nonDisclaimerText).not.toMatch(/\brecommendation\b/i);
    expect(nonDisclaimerText).not.toMatch(/\badvice\b/i);

    await page.waitForLoadState('networkidle');
    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
