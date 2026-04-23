import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

test.describe('instruments facet — Article Relevance tab', () => {
  test('tab reads "Article Relevance" and surfaces article rows when data exists', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      const u = resp.url();
      if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
        serverErrors.push(`${resp.status()} ${u}`);
      }
    });

    await page.goto('/instruments');
    await dismissWelcomeModal(page);

    const instrumentId = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/instruments/"]'));
      for (const a of anchors) {
        const m = (a.getAttribute('href') || '').match(/\/instruments\/([^/?#]+)/);
        if (m && m[1] !== 'mine') return m[1];
      }
      return null;
    });

    test.skip(!instrumentId, 'no seeded instrument available to navigate into');

    await page.goto(`/instruments/${instrumentId}`);
    await page.waitForLoadState('networkidle');

    // 1. The tab renamed label
    const segment = page.locator('ion-segment[data-tour="instrument-tabs"] ion-segment-button[value="predictors"]');
    await expect(segment).toBeVisible({ timeout: 10_000 });
    await expect(segment).toContainText(/Article Relevance/i);
    // Guard against the old label leaking back in
    await expect(segment).not.toContainText(/AI Scoring/i);

    // 2. Click the tab and confirm the panel renders (either a list or an explicit empty-state).
    await segment.click();
    const list = page.locator('[data-test="article-relevance-list"]');
    const emptyState = page
      .getByText(/No articles scored yet for this ticker/i);
    await expect(list.or(emptyState)).toBeVisible({ timeout: 10_000 });

    // 3. Vocabulary inside the panel body (not the first-touch which gets stripped).
    const panelText = await page.evaluate(() => {
      const segmentEl = document.querySelector('ion-segment[data-tour="instrument-tabs"]') as HTMLElement | null;
      const container = segmentEl?.parentElement as HTMLElement | null;
      const clone = (container ?? document.body).cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll('.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]')
        .forEach((n) => n.remove());
      return (clone.innerText || '').trim();
    });
    expect(panelText).not.toMatch(/\brecommendation\b/i);
    expect(panelText).not.toMatch(/\badvice\b/i);

    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
