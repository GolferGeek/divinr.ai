import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding.js';

/**
 * Verifies the "Add a card" CTA in /billing-summary actually round-trips
 * through Stripe Checkout. We intercept the POST /api/billing/checkout-session
 * response so the test never navigates off-origin (and doesn't need
 * STRIPE_SECRET_KEY to be configured for the skipped variant — when keys are
 * absent the API returns `{ url: null }` and we assert that contract instead).
 */
test.describe('billing facet — checkout redirect', () => {
  test('Add a card button POSTs checkout-session and navigates to returned URL', async ({ page, context }) => {
    await page.goto('/');
    await dismissWelcomeModal(page);
    await expect(page).not.toHaveURL(/\/login/);

    const stripeEnabled = !!process.env.STRIPE_SECRET_KEY;

    // Stub the API response so we never actually navigate to checkout.stripe.com
    // (Playwright won't let us assert URLs across origins without baseURL gymnastics,
    // and we don't want to depend on Stripe's test-mode session URL format).
    const stubUrl = 'https://checkout.stripe.com/c/pay/cs_test_stub';
    await context.route('**/api/billing/checkout-session', async (route) => {
      const req = route.request();
      const body = req.postDataJSON();
      expect(body, 'POST body must include returnUrl').toMatchObject({ returnUrl: expect.any(String) });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(stripeEnabled ? { url: stubUrl } : { url: null, message: 'Stripe not configured' }),
      });
    });

    await page.goto('/billing/summary');
    // Wait for billing-status store to populate — the actions block is wrapped
    // in v-if="billing.loaded" and only paints after GET /api/billing/status returns.
    const actions = page.getByTestId('billing-summary-actions');
    await actions.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);

    const addCard = page.getByTestId('billing-summary-add-card');
    if ((await addCard.count()) === 0) {
      test.skip(true, 'User already has a card on file; "Add a card" CTA not rendered.');
      return;
    }

    if (!stripeEnabled) {
      // The API responds with `{ url: null }` and the composable surfaces a warning toast.
      // We assert no off-origin navigation happens.
      const beforeUrl = page.url();
      await addCard.click();
      await page.waitForTimeout(800);
      expect(page.url(), 'no navigation when API returns null url').toBe(beforeUrl);
      await expect(page.locator('ion-toast')).toHaveCount(1);
      return;
    }

    // Stripe enabled: clicking should set window.location.href to the stub URL.
    // We intercept that navigation by listening for `framenavigated` and asserting
    // the target before Playwright actually tries to load the off-origin page.
    const navPromise = page.waitForEvent('framenavigated', { timeout: 5000 }).catch(() => null);
    await addCard.click();
    const frame = await navPromise;
    if (frame) {
      expect(frame.url()).toBe(stubUrl);
    } else {
      // Fallback: read window.location directly.
      const href = await page.evaluate(() => window.location.href);
      expect(href).toBe(stubUrl);
    }
  });
});
