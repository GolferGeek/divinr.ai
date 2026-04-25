import { test, expect } from '@playwright/test';

/**
 * Verifies the Phase 5 BYO platform fee wiring at the contract level:
 * authoring a BYO credential triggers BillingService.addAuthoredItem with
 * kind='byo_platform_fee', which (when Stripe is wired and the user has a
 * subscription) attaches a $10/mo line item via subscriptionItems.create.
 *
 * Spec checks the API contract (billing-preview byoPlatformFeeUsd field).
 * Live Stripe round-trip exercised in manual chrome testing.
 *
 * Skipped when STRIPE_SECRET_KEY is unset.
 */
test.describe('billing facet — BYO platform fee', () => {
  test('billing/preview surfaces byoPlatformFeeUsd', async ({ request }) => {
    test.skip(!process.env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY not configured');

    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:7100';
    const resp = await request.get(`${apiBase}/billing/preview`);
    expect(resp.ok(), `preview must succeed: ${resp.status()}`).toBeTruthy();
    const body = await resp.json();
    expect(body, 'preview includes byoPlatformFeeUsd').toHaveProperty('byoPlatformFeeUsd');
    expect(typeof body.byoPlatformFeeUsd, 'byoPlatformFeeUsd is number').toBe('number');
  });
});
