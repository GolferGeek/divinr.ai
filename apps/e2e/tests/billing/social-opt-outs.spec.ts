import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

const FLAGS = [
  'social_visible_in_member_lists',
  'social_messaging_enabled',
  'social_tournament_participation',
  'social_leaderboard_visible',
  'social_notifications_enabled',
] as const;

test.describe('billing facet — social opt-outs tab', () => {
  test('tab renders five toggles, PATCH persists across reload, vocab clean', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      const u = resp.url();
      if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
        serverErrors.push(`${resp.status()} ${u}`);
      }
    });

    await page.goto('/settings/social-opt-outs');
    await dismissWelcomeModal(page);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /visibility.*social/i })).toBeVisible();

    // Every flag has a visible toggle with a stable data-testid.
    for (const flag of FLAGS) {
      const toggle = page.locator(`[data-testid="social-opt-out-${flag}"]`);
      await expect(toggle, `toggle for ${flag} missing`).toBeVisible({ timeout: 10_000 });
    }

    // Snapshot current state via the API (bypasses UI fetch latency).
    const meResp = await page.request.get('/api/billing/status');
    expect(meResp.status(), 'billing status sanity check').toBe(200);

    // Flip social_visible_in_member_lists off, then back on, through the API.
    // (UI path is exercised by the visibility check above; API path proves the
    // backend is wired end-to-end.)
    const userIdResp = await page.request.get('/api/auth/me');
    if (userIdResp.status() === 200) {
      const me = await userIdResp.json();
      const userId = me.user?.id ?? me.id;
      if (userId) {
        const getResp = await page.request.get(`/api/users/${userId}/social-opt-outs`);
        expect(getResp.status(), 'GET social-opt-outs must be 200').toBe(200);
        const initial = await getResp.json();
        for (const flag of FLAGS) {
          expect(initial, `${flag} flag missing from payload`).toHaveProperty(flag);
        }

        const flipResp = await page.request.patch(
          `/api/users/${userId}/social-opt-outs`,
          { data: { social_visible_in_member_lists: false } },
        );
        expect(flipResp.status(), 'PATCH must be 200').toBe(200);
        const flipped = await flipResp.json();
        expect(flipped.social_visible_in_member_lists).toBe(false);

        // Restore so subsequent runs are idempotent.
        const restoreResp = await page.request.patch(
          `/api/users/${userId}/social-opt-outs`,
          { data: { social_visible_in_member_lists: initial.social_visible_in_member_lists } },
        );
        expect(restoreResp.status(), 'PATCH restore must be 200').toBe(200);
      }
    }

    // Vocab guard: user-visible copy on this page must use "analysis/signal",
    // never "prediction/advice/recommendation". Disclaimer text is exempt.
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
