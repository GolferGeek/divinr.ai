import { useApi } from './useApi';

export type StripeRedirectError =
  | { kind: 'no-customer'; message: string }
  | { kind: 'already-subscribed'; message: string }
  | { kind: 'not-configured'; message: string }
  | { kind: 'network'; message: string };

export type StripeRedirectResult =
  | { ok: true; url: string }
  | { ok: false; error: StripeRedirectError };

/**
 * Tiny shim over the two Stripe-redirect endpoints. Used by ReadOnlyBanner,
 * TrialCountdown, and BillingSummaryView so the same "round-trip through
 * Stripe-hosted Checkout / Portal" flow renders consistently.
 *
 * On success the caller does `window.location.href = url`. On failure the
 * caller surfaces a toast and stays put — no in-app modal, Stripe owns the
 * card entry surface.
 */
export function useStripeRedirect() {
  const api = useApi('/api/billing');

  async function redirectToCheckout(returnUrl: string): Promise<StripeRedirectResult> {
    return call('/checkout-session', returnUrl);
  }

  async function redirectToPortal(returnUrl: string): Promise<StripeRedirectResult> {
    return call('/portal-session', returnUrl);
  }

  async function call(path: string, returnUrl: string): Promise<StripeRedirectResult> {
    try {
      const res = await api.post<{ url: string | null; useEndpoint?: string; error?: string; message?: string }>(path, { returnUrl });
      if (!res.url) {
        return { ok: false, error: { kind: 'not-configured', message: res.message ?? 'Stripe not configured' } };
      }
      return { ok: true, url: res.url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // useApi throws "<status>: <body>"; pull the status off the front to
      // distinguish 409 conflict variants from genuine network failure.
      if (msg.startsWith('409:')) {
        try {
          const body = JSON.parse(msg.slice(msg.indexOf(':') + 1).trim()) as { useEndpoint?: string; error?: string; message?: string };
          if (body.useEndpoint === '/billing/portal-session') {
            return { ok: false, error: { kind: 'already-subscribed', message: body.message ?? 'You already have a subscription.' } };
          }
          if (body.error === 'no_customer') {
            return { ok: false, error: { kind: 'no-customer', message: body.message ?? 'Add a card before opening the billing portal.' } };
          }
        } catch {
          // fall through
        }
      }
      return { ok: false, error: { kind: 'network', message: msg } };
    }
  }

  return { redirectToCheckout, redirectToPortal };
}
