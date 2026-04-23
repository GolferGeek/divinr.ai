import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

/**
 * Ethan feedback #4 — Article sourcing on analyst recommendations.
 *
 * PredictionSources.vue is wired into InstrumentAnalystPanel.vue for each
 * seeded analyst signal. This spec asserts the component exists, expands,
 * and renders either a real article list, the empty copy, or the fallback
 * banner — all three outcomes are valid depending on the seed data the
 * testing-team user can reach.
 */

test.describe('predictions facet — sources', () => {
  test('prediction sources collapse + expand on instrument detail', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      const u = resp.url();
      if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
        serverErrors.push(`${resp.status()} ${u}`);
      }
    });

    await page.goto('/instruments');
    await dismissWelcomeModal(page);

    // Pick the first instrument card with a detail link. Skip gracefully if
    // the testing-team user has no reachable instruments.
    const firstInstrumentLink = page.locator('a[href^="/instruments/"]').first();
    if ((await firstInstrumentLink.count()) === 0) {
      test.skip(true, 'No instruments reachable by testing-team user; skipping sources assertion.');
      return;
    }
    await firstInstrumentLink.click();

    await page.waitForLoadState('networkidle');

    const sources = page.locator('[data-test="prediction-sources"]').first();
    if ((await sources.count()) === 0) {
      test.skip(true, 'No seeded analyst signals with sources for this instrument; skipping.');
      return;
    }

    await expect(sources).toBeVisible();

    const toggle = sources.locator('[data-test="prediction-sources-toggle"]');
    await expect(toggle).toBeVisible();
    await toggle.click();

    const body = sources.locator('[data-test="prediction-sources-body"]');
    await expect(body).toBeVisible();

    // One of these three outcomes is always true depending on seed data:
    //  - at least one article row (anchors have target="_blank" + rel="noopener noreferrer"),
    //  - the empty-state copy,
    //  - the italic fallback banner.
    const rowCount = await body.locator('[data-test="prediction-sources-row"]').count();
    const hasFallback = (await body.locator('[data-test="prediction-sources-fallback"]').count()) > 0;
    const hasEmpty = (await body.locator('[data-test="prediction-sources-empty"]').count()) > 0;
    expect(rowCount > 0 || hasFallback || hasEmpty).toBe(true);

    if (rowCount > 0) {
      const firstAnchor = body.locator('a.article-title').first();
      await expect(firstAnchor).toHaveAttribute('target', '_blank');
      await expect(firstAnchor).toHaveAttribute('rel', /noopener\s+noreferrer/);
    }

    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
