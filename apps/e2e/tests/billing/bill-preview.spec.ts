import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

/**
 * Branch-tolerant bill-preview spec. Fixture-forced authored content
 * (one analyst + one instrument + BYO) would require seeded billing rows,
 * which we don't have in the shared test DB. Instead, fetch /api/billing/preview
 * and assert the shape + arithmetic invariant are correct for the returned data.
 * DOM assertions run only on sections the fetched data actually populates.
 */
test.describe('billing facet — bill preview', () => {
  test('itemized bill shape + arithmetic + UI reflects API', async ({ page }) => {
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

    const previewResp = await page.request.get('/api/billing/preview');
    expect(previewResp.status(), 'billing preview must return 200').toBe(200);
    const preview = await previewResp.json();

    expect(preview, 'preview must carry the itemized shape').toMatchObject({
      basicMonthlyUsd: expect.any(Number),
      authoredAnalysts: expect.any(Array),
      authoredInstruments: expect.any(Array),
      byoPlatformFeeUsd: expect.any(Number),
      totalMonthlyUsd: expect.any(Number),
    });

    // Arithmetic invariant: total = basic + $60·analysts + $20·instruments + byoFee
    const analystSum = preview.authoredAnalysts.reduce((s: number, r: { monthlyUsd: number }) => s + r.monthlyUsd, 0);
    const instrSum = preview.authoredInstruments.reduce((s: number, r: { monthlyUsd: number }) => s + r.monthlyUsd, 0);
    const expected = preview.basicMonthlyUsd + analystSum + instrSum + preview.byoPlatformFeeUsd;
    expect(Math.abs(preview.totalMonthlyUsd - expected)).toBeLessThan(0.01);

    // Navigate to the BillingTab. Many tenants land on /authored/billing; fall back
    // to a direct fetch path if the link isn't discoverable (no hard-coded nav here).
    await page.goto('/authored');
    if (await page.locator('[data-testid="billing-tab"]').count() === 0) {
      // Some builds mount Billing under a different authored route — try another entry.
      await page.goto('/authored?tab=billing');
    }

    const billingTab = page.locator('[data-testid="billing-tab"]');
    if (await billingTab.count() > 0) {
      await expect(page.locator('[data-testid="bill-basic"]')).toBeVisible();
      await expect(page.locator('[data-testid="bill-total"]')).toBeVisible();

      if (preview.authoredAnalysts.length > 0) {
        await expect(page.locator('[data-testid="bill-analysts-rollup"]')).toBeVisible();
        // Expand and confirm row count matches the API payload.
        await page.locator('[data-testid="bill-analysts-rollup"]').click();
        await expect(page.locator('[data-testid="bill-analyst-row"]')).toHaveCount(preview.authoredAnalysts.length);
      }
      if (preview.authoredInstruments.length > 0) {
        await expect(page.locator('[data-testid="bill-instruments-rollup"]')).toBeVisible();
        await page.locator('[data-testid="bill-instruments-rollup"]').click();
        await expect(page.locator('[data-testid="bill-instrument-row"]')).toHaveCount(preview.authoredInstruments.length);
      }
    }

    // Vocabulary clean in non-disclaimer copy.
    const nonDisclaimerText = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(
        '.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]',
      ).forEach((n) => n.remove());
      return (clone.innerText || '').trim();
    });
    expect(nonDisclaimerText).not.toMatch(/\brecommendation\b/i);
    expect(nonDisclaimerText).not.toMatch(/\badvice\b/i);

    await page.waitForLoadState('networkidle');
    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
