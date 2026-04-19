import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

test.describe('instruments facet — smoke', () => {
  test('list loads without 5xx and enforces vocabulary on the list surface', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      const u = resp.url();
      if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
        serverErrors.push(`${resp.status()} ${u}`);
      }
    });

    await page.goto('/instruments');
    await dismissWelcomeModal(page);

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /^instruments$/i, level: 1 }))
      .toBeVisible({ timeout: 10_000 });

    // Floor: at least one card OR the Add Instrument button. The view does not
    // render an explicit empty-state element, but the Add button is unconditional,
    // so its presence proves the template rendered.
    const cards = page.locator('ion-card');
    const addBtn = page.getByRole('button', { name: /add instrument/i });
    await expect(cards.first().or(addBtn)).toBeVisible({ timeout: 10_000 });

    // Vocabulary check — scope to the list surface only. The instrument detail
    // page renders LLM-authored rationale that may legitimately leak forbidden
    // vocabulary; that's a separate finding (see the instruments skill's
    // completeness.md). Cloning from the heading's grandparent captures the
    // outer wrapper div (h1 + grid) without the document-level chrome.
    const text = await page.evaluate(() => {
      const heading = document.querySelector('h1') as HTMLElement | null;
      const root: HTMLElement =
        (heading?.parentElement?.parentElement as HTMLElement | null) ?? document.body;
      const clone = root.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(
        '.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]',
      ).forEach((n) => n.remove());
      return (clone.innerText || '').trim();
    });
    expect(
      text,
      'instruments list copy (outside legal disclaimer) must not contain forbidden vocabulary',
    ).not.toMatch(/\bprediction(s|ed|or)?\b/i);
    expect(text).not.toMatch(/\brecommendation\b/i);
    expect(text).not.toMatch(/\badvice\b/i);

    await page.waitForLoadState('networkidle');
    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
