import { test, expect } from '@playwright/test';

/**
 * Pricing page is public — no login needed. Assertions are deterministic
 * (no fixture user required): two cards, Start-free-trial CTA wires to /login,
 * full disclaimer present, vocabulary clean in non-disclaimer copy.
 */
test.describe('billing facet — pricing page', () => {
  test('unauth /pricing renders two cards, CTA→/login, full disclaimer, vocab clean', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      const u = resp.url();
      if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
        serverErrors.push(`${resp.status()} ${u}`);
      }
    });

    await page.goto('/pricing');
    await expect(page).toHaveURL(/\/pricing$/);

    await expect(page.getByRole('heading', { name: /one plan/i })).toBeVisible();
    await expect(page.locator('[data-testid="pricing-card-basic"]')).toBeVisible();
    await expect(page.locator('[data-testid="pricing-card-authoring"]')).toBeVisible();

    // Basic card shows $50 and 30-day trial copy.
    const basicCard = page.locator('[data-testid="pricing-card-basic"]');
    await expect(basicCard).toContainText('$50');
    await expect(basicCard).toContainText(/30-day free trial/i);

    // Authoring card shows the three add-on price points.
    const authoringCard = page.locator('[data-testid="pricing-card-authoring"]');
    await expect(authoringCard).toContainText(/\$20\/mo/);
    await expect(authoringCard).toContainText(/\$60\/mo/);
    await expect(authoringCard).toContainText(/\$10\/mo/);

    // CTA routes to login.
    await page.locator('[data-testid="start-free-trial"]').click();
    await expect(page).toHaveURL(/\/login/);

    // Back to pricing to exercise the disclaimer check.
    await page.goto('/pricing');
    const fullDisclaimer = page.locator('.legal-disclaimer, [data-testid="legal-disclaimer"]').first();
    await expect(fullDisclaimer).toBeVisible();

    // Vocabulary: no "prediction/advice/recommendation" outside disclaimers.
    const nonDisclaimerText = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(
        '.legal-disclaimer, [data-testid="legal-disclaimer"]',
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
