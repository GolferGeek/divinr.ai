import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

/**
 * Admin user-billing view spec. Branch-tolerant — resolves the logged-in user
 * id via /api/billing/subscription, then opens the admin view for that same
 * user. The testing-team session carries the admin role, so the view must
 * render subscription + items + events + preview sections without a 5xx.
 *
 * Admin facet is RELAXED on the prediction/advice/recommendation vocabulary
 * per CLAUDE.md — no vocab check here.
 */
test.describe('admin facet — user billing', () => {
  test('admin can open /admin/users/<self>/billing and see every card', async ({ page }) => {
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

    const subResp = await page.request.get('/api/billing/subscription');
    expect(subResp.status(), 'subscription endpoint must respond 200').toBe(200);
    const sub = await subResp.json();
    expect(sub, 'subscription payload must exist').toBeTruthy();
    const userId = sub?.user_id as string | undefined;
    expect(userId, 'logged-in user must have a user_id in the subscription row').toBeTruthy();

    await page.goto(`/admin/users/${userId}/billing`);
    await expect(page).not.toHaveURL(/\/(login|welcome)/);

    await expect(page.locator('[data-testid="admin-user-billing"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="admin-billing-subscription"]')).toBeVisible();
    await expect(page.locator('[data-testid="admin-billing-items"]')).toBeVisible();
    await expect(page.locator('[data-testid="admin-billing-events"]')).toBeVisible();
    await expect(page.locator('[data-testid="admin-billing-preview"]')).toBeVisible();

    await page.waitForLoadState('networkidle');
    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
