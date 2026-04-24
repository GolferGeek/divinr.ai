# Tests — Billing facet

Playwright specs:

- `apps/e2e/tests/billing/trial-countdown.spec.ts` — app-shell chip smoke, branch A / B tolerant.
- `apps/e2e/tests/billing/read-only-banner.spec.ts` — in-content alert smoke, branch C tolerant.
- `apps/e2e/tests/billing/social-opt-outs.spec.ts` — `/settings/social-opt-outs` page renders the five toggles, `GET` + `PATCH /api/users/:id/social-opt-outs` round-trip works, vocab guard clean.
- `apps/e2e/tests/billing/bill-preview.spec.ts` — `GET /api/billing/preview` returns the itemized shape (basic, analysts, instruments, byoFee, total); arithmetic invariant `total = basic + $60·|analysts| + $20·|instruments| + byoFee` holds; BillingTab DOM reflects the payload.
- `apps/e2e/tests/billing/pricing-page.spec.ts` — unauthenticated `/pricing` renders both cards with the $50/ $60/ $20/ $10 price points, "Start free trial" routes to `/login`, full disclaimer present, vocab clean.
- `apps/e2e/tests/billing/checkout-redirect.spec.ts` — clicking "Add a card" in `/billing-summary` POSTs `/api/billing/checkout-session` (intercepted) and `window.location` redirects to the returned Stripe URL. With Stripe disabled (`STRIPE_SECRET_KEY` unset) the API returns `{ url: null }` and the spec asserts no off-origin navigation + a warning toast.
- `apps/e2e/tests/billing/webhook-lifecycle.spec.ts` — drives `POST /billing/webhooks/stripe` directly with a `crypto.createHmac`-signed `invoice.paid` payload; asserts 200 first delivery, `duplicate=true` on replay (event_id PK idempotency), and 400 on a bogus signature. Skipped when `STRIPE_WEBHOOK_SECRET` is absent.

Storage state: `apps/e2e/.auth/testing-team.json` (populated by `scripts/prepare-auth-state.ts`). The `billing` project in `playwright.config.ts` uses this storage state via `PLAYWRIGHT_STORAGE_STATE`.

## Numbered cases

### 1. Trial countdown chip renders when in trial; absent otherwise

**What**: Navigate to `/` (dashboard), fetch `GET /api/billing/status`, and assert the chip visibility matches the lifecycle branch returned by the API.

```ts
test('trial-countdown chip is visible iff status===trial, no 5xx, vocab clean', async ({ page }) => {
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

  const resp = await page.request.get('/api/billing/status');
  expect(resp.status()).toBe(200);
  const j = await resp.json();

  const chip = page.locator('[data-testid="trial-countdown"]');
  if (j.status === 'trial' && !j.is_read_only) {
    await expect(chip).toBeVisible({ timeout: 10_000 });
    const label = (await chip.locator('ion-label').textContent())?.trim() ?? '';
    expect(label).toMatch(/^(trial ends today|1 day left|\d+ days left)$/i);
  } else {
    await expect(chip).toHaveCount(0);
  }

  await expect(
    page.locator('[data-testid="read-only-banner"]').and(page.locator('[data-testid="trial-countdown"]')),
  ).toHaveCount(0);

  const nonDisclaimerText = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]').forEach((n) => n.remove());
    return (clone.innerText || '').trim();
  });
  expect(nonDisclaimerText).not.toMatch(/\bprediction(s|ed|or)?\b/i);
  expect(nonDisclaimerText).not.toMatch(/\brecommendation\b/i);
  expect(nonDisclaimerText).not.toMatch(/\badvice\b/i);

  await page.waitForLoadState('networkidle');
  expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
});
```

### 2. Read-only banner renders when is_read_only; absent otherwise

**What**: Navigate to `/`, fetch `GET /api/billing/status`, and gate banner assertions on `is_read_only`.

```ts
test('read-only banner is visible iff is_read_only; disclaimer + CTA present on branch C', async ({ page }) => {
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

  const resp = await page.request.get('/api/billing/status');
  expect(resp.status()).toBe(200);
  const j = await resp.json();

  const banner = page.locator('[data-testid="read-only-banner"]');
  if (j.is_read_only) {
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(banner.getByText(/your trial has ended\.?/i)).toBeVisible();
    await expect(banner.getByRole('button', { name: /^add a card$/i })).toBeVisible();
    // Disclaimer MUST route through <LegalDisclaimer>.
    const disclaimer = banner.locator('.legal-disclaimer, [data-testid="legal-disclaimer"]');
    await expect(disclaimer).toHaveCount(1);
  } else {
    await expect(banner).toHaveCount(0);
  }

  await page.waitForLoadState('networkidle');
  expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
});
```

### 3. Social opt-outs tab renders five toggles and round-trips PATCH

**What**: Navigate to `/settings/social-opt-outs`. Confirm each of the five toggles
(`social-opt-out-social_visible_in_member_lists`,
`social-opt-out-social_messaging_enabled`,
`social-opt-out-social_tournament_participation`,
`social-opt-out-social_leaderboard_visible`,
`social-opt-out-social_notifications_enabled`) is visible. Fetch
`GET /api/users/:id/social-opt-outs` for the authenticated user, flip a flag via
`PATCH`, confirm response echoes the new state, restore. Vocab guard clean.

See `apps/e2e/tests/billing/social-opt-outs.spec.ts` for the canonical
implementation.

### 4. Monthly-bill itemization reflects authored content

**What**: `GET /api/billing/preview` returns `{ basicMonthlyUsd,
authoredAnalysts[], authoredInstruments[], byoPlatformFeeUsd, totalMonthlyUsd }`.
The BillingTab renders one row per rollup (analysts / instruments), expandable
to show per-item display names. Arithmetic: `total = basic + sum(authoredAnalysts) +
sum(authoredInstruments) + byoFee`.

See `apps/e2e/tests/billing/bill-preview.spec.ts` for the canonical
implementation (branch-tolerant — asserts the shape and arithmetic against
whatever the API returns for the logged-in user).

### 5b. Checkout redirect round-trips through Stripe-hosted Checkout

**What**: From `/billing-summary` (authenticated trial user with no card), click `[data-testid="billing-summary-add-card"]`. The POST to `/api/billing/checkout-session` is intercepted via `context.route()` and stubbed with a fake `https://checkout.stripe.com/c/pay/cs_test_stub` URL. Assert the page navigates to that URL (we never actually visit Stripe — keeps the spec deterministic and free of cross-origin redirects).

When `STRIPE_SECRET_KEY` is unset, the spec exercises the no-op contract instead: API returns `{ url: null }`, no navigation, warning toast surfaces.

See `apps/e2e/tests/billing/checkout-redirect.spec.ts`.

### 5c. Webhook signature verification + event-id idempotency

**What**: POST a synthetic `invoice.paid` payload to `/billing/webhooks/stripe` with a valid HMAC-SHA256 v1 signature derived from `STRIPE_WEBHOOK_SECRET`. Assert:
- First delivery → 200 with `{ received: true }` (no duplicate flag)
- Same `event_id` again → 200 with `{ received: true, duplicate: true }`
- Bogus signature → 400

Skipped when `STRIPE_WEBHOOK_SECRET` is unset (no key, no signature). To run locally: `stripe listen --forward-to localhost:7100/billing/webhooks/stripe` and copy the printed `whsec_*` into `apps/e2e/.env`.

See `apps/e2e/tests/billing/webhook-lifecycle.spec.ts`.

### 6. Public pricing page is discoverable and routes to signup

**What**: Unauthenticated `goto('/pricing')` loads without redirect. Two cards
render: Basic ($50/mo + 30-day trial copy) and Authoring add-ons ($20, $60,
$10 price points). "Start free trial" CTA routes to `/login`. Full disclaimer
renders at the bottom. Vocabulary clean in non-disclaimer copy.

See `apps/e2e/tests/billing/pricing-page.spec.ts` for the canonical
implementation.

## Chrome-MCP exploratory (not in CI)

- Force the lifecycle via a DB update (dev only): flip `users.billing_status` to `trial` with `trial_ends_at = now() + interval '2 days'`, reload, confirm the chip reads "2 days left" and color is `danger`.
- Force read-only: `trial_ends_at = now() - interval '1 day'`, run the lifecycle cron (or call `billing.computeLifecycleTransitions` via Nest context), reload, confirm the banner appears on every route (`/`, `/instruments`, `/portfolios`, `/clubs`).
- Click "Add a card" on the banner and verify navigation to `/settings/authored-content`.
- Remove the user's billing row entirely; confirm both banners stay absent and the API returns `status: null`.

## Running

```bash
cd apps/e2e
pnpm exec playwright test --project=billing
```
