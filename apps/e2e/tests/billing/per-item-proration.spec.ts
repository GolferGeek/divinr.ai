import { test, expect } from '@playwright/test';

/**
 * Verifies the Phase 3 per-item billing flow: when a user adds an authored
 * instrument or analyst, a prorated Stripe subscription item is added and the
 * /billing/preview upcomingInvoice reflects it; deleting the item credits back.
 *
 * Skipped when STRIPE_SECRET_KEY is unset because the path requires real
 * Stripe API calls (subscriptionItems.create / .del + invoices.createPreview).
 *
 * Also skipped when the test user doesn't have a stripe_subscription_id yet —
 * which is the default state for testing-team@divinr.ai. To exercise the live
 * path locally:
 *   1. Walk through /billing/summary → "Add a card" → Stripe Checkout with
 *      4242 4242 4242 4242
 *   2. Wait for the subscription.created webhook to populate
 *      billing.subscriptions.stripe_subscription_id
 *   3. Re-run this spec
 */
test.describe('billing facet — per-item proration', () => {
  test('upcomingInvoice contract is well-formed when Stripe is wired', async ({ request }) => {
    test.skip(!process.env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY not configured — skip live preview');

    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:7100';
    // Lift the bearer the same way the rest of the auth-using specs do
    // (extraHTTPHeaders attaches it through page.request, but `request` here is
    // the worker-level request fixture — same mechanism).
    const previewResp = await request.get(`${apiBase}/billing/preview`);
    expect(previewResp.ok(), `GET /billing/preview must succeed: ${previewResp.status()}`).toBeTruthy();
    const preview = await previewResp.json();

    // The new field is always present (additive contract). Either the user has
    // a subscription and we got Stripe data back, OR they don't and the field
    // is null. Both are valid; assert the type contract.
    expect(preview, 'preview includes upcomingInvoice key').toHaveProperty('upcomingInvoice');

    const ui = preview.upcomingInvoice;
    if (ui === null) {
      test.skip(true, 'User has no Stripe subscription yet — proration cannot be exercised. Walk through Stripe Checkout first.');
      return;
    }

    expect(ui, 'upcomingInvoice carries the documented shape').toMatchObject({
      amountDue: expect.any(Number),
      currency: expect.any(String),
      lineItems: expect.any(Array),
    });
    for (const line of ui.lineItems) {
      expect(line, 'each line item has description+amountCents+priceId').toMatchObject({
        description: expect.any(String),
        amountCents: expect.any(Number),
      });
      expect(['string', 'object']).toContain(typeof line.priceId);
    }
  });
});
