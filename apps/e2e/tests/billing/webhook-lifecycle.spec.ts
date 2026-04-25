import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

/**
 * Drives the /billing/webhooks/stripe endpoint with a synthetic, signature-valid
 * `invoice.paid` event and asserts:
 *   1. 200 response
 *   2. Idempotency: posting the same event id twice returns duplicate=true
 *   3. Bogus signature → 400
 *
 * Skipped entirely when STRIPE_WEBHOOK_SECRET is unset, because we can't sign
 * without it. To run locally:
 *   1. `stripe listen --forward-to localhost:7100/billing/webhooks/stripe`
 *   2. Copy the printed `whsec_*` into apps/e2e/.env as STRIPE_WEBHOOK_SECRET
 *   3. Re-run the billing project.
 */
test.describe('billing facet — webhook lifecycle', () => {
  test('signed invoice.paid → 200, duplicate replay → duplicate=true, bad sig → 400', async ({ request }) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    test.skip(!secret, 'STRIPE_WEBHOOK_SECRET not configured — skip live signature verification');

    const eventId = `evt_test_${Date.now()}`;
    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      type: 'invoice.paid',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `in_test_${Date.now()}`,
          object: 'invoice',
          customer: 'cus_test_unknown',
          status: 'paid',
        },
      },
    });
    const sigHeader = makeStripeSignature(payload, secret!);

    // Hit the API directly (skip the proxy — keeps the path simple and avoids
    // the extra hop while we already know the bearer setup works).
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:7100';
    const first = await request.post(`${apiBase}/billing/webhooks/stripe`, {
      headers: { 'Content-Type': 'application/json', 'stripe-signature': sigHeader },
      data: payload,
    });
    expect(first.status(), 'first delivery returns 200').toBe(200);
    const firstBody = await first.json();
    expect(firstBody, 'first delivery is not duplicate').toMatchObject({ received: true });
    expect(firstBody.duplicate ?? false).toBe(false);

    const second = await request.post(`${apiBase}/billing/webhooks/stripe`, {
      headers: { 'Content-Type': 'application/json', 'stripe-signature': sigHeader },
      data: payload,
    });
    expect(second.status(), 'replay returns 200').toBe(200);
    const secondBody = await second.json();
    expect(secondBody, 'replay flagged duplicate').toMatchObject({ received: true, duplicate: true });

    const bad = await request.post(`${apiBase}/billing/webhooks/stripe`, {
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 'v1=garbage,t=0' },
      data: payload,
    });
    expect(bad.status(), 'bad signature → 400').toBe(400);
  });
});

/**
 * Build a Stripe-compatible v1 signature for the given payload.
 * Mirrors stripe.webhooks.generateTestHeaderString without pulling the SDK
 * into the e2e workspace.
 */
function makeStripeSignature(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const sig = createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}
