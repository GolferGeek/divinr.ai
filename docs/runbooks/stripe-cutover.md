# Stripe live-mode cutover runbook

**Status:** Reference document. The actual cutover is gated behind weeks/months
of beta + browser testing on test mode; the live cutover effort itself sits in
`docs/efforts/future/stripe-live-cutover/`. Do not run the steps in §3 unless
that effort has been activated.

---

## 1. What "cutover" means

Today the API runs with Stripe **test-mode** keys (`sk_test_…`,
`pk_test_…`, `whsec_…`) configured locally in `.env`. The API on this Spark
machine serves both local dev (via `localhost:7100/7101`) AND
production traffic (via Cloudflare tunnel → `api.divinr.ai` /
`divinr.ai`). Real-user signups currently exercise Phase 1–5 code against
the test-mode Stripe sandbox — no real money moves.

"Cutover" means swapping `sk_test_…` for `sk_live_…` (and the corresponding
publishable + webhook secrets + Price IDs) in the prod env so real charges
begin. It is intentionally manual.

## 2. Prerequisites (must all be done before §3)

These are pre-cutover gates. Each is a separate piece of work, not a checkbox:

- [ ] Stripe live-mode account fully activated:
  - Legal entity registered (sole prop / LLC / etc.)
  - Bank account connected and verified
  - Tax info filled out (EIN/SSN as appropriate)
  - Identity verification completed
  - Payouts enabled (test by issuing a `$0.50` charge, verify it lands)
- [ ] Extensive beta + browser testing on the test-mode pipeline:
  - Fresh signup → trial → "Add a card" → Stripe Checkout → return → state flips to active
  - Past-due simulation (`stripe trigger invoice.payment_failed`) → TrialCountdown shows yellow → recovery
  - Cancellation (`stripe trigger customer.subscription.deleted`) → ReadOnlyBanner appears → re-subscribe
  - .edu student signup → setup-mode Checkout → first authorship → student-Price line item appears
  - .edu lapse cron → re-pricing kicks in
  - Per-item authorship → prorated upcomingInvoice → delete → credit-back
  - "Manage Billing" → Stripe Customer Portal → update card / cancel from there
  - Admin refund a test-mode charge → event log shows triggered_by='admin'
  - BYO platform fee: attach LLM credential → BYO line appears; revoke → BYO line goes away
- [ ] All issues found during browser testing fixed and re-verified
- [ ] Production webhook endpoint registered in Stripe Dashboard (live mode)
  pointing at `https://api.divinr.ai/billing/webhooks/stripe` so we don't
  depend on the local `stripe listen` CLI in prod
- [ ] Secrets storage decided (don't commit `sk_live_…` to git; use a secrets
  manager or root-owned `.env` permissions)

## 3. Cutover steps (DO NOT run until §2 is fully green)

Order matters — the goal is "publishable + webhook secret + Price IDs land
first, then `sk_live_…` flips the switch in one atomic restart":

1. **Activate live mode in Stripe Dashboard** (top-left toggle, must be in
   live mode for the API keys to be `sk_live_*`).

2. **Run the seed script against live mode** to create Products + Prices in
   the live Stripe environment. The script is idempotent and uses the same
   stable `lookup_key` values as test mode:

   ```bash
   STRIPE_SECRET_KEY=sk_live_REDACTED \
     pnpm --filter @divinr/api exec tsx apps/api/scripts/stripe-seed.ts
   ```

   Copy the printed `STRIPE_PRODUCT_*` and `STRIPE_PRICE_*` block.

3. **Register the live webhook endpoint** in Stripe Dashboard
   (Developers → Webhooks → Add endpoint):
   - URL: `https://api.divinr.ai/billing/webhooks/stripe`
   - Events: `checkout.session.completed`,
     `customer.subscription.{created,updated,deleted,trial_will_end}`,
     `invoice.{paid,payment_failed}`, `payment_method.attached`
   - Reveal the resulting `whsec_…`.

4. **Update prod `.env`** (this is the moment everything actually flips). All
   Stripe-related vars at once — order in the file doesn't matter, but the
   set must land atomically before restart:

   ```
   STRIPE_SECRET_KEY=sk_live_REDACTED
   STRIPE_PUBLISHABLE_KEY=pk_live_REDACTED
   STRIPE_WEBHOOK_SECRET=whsec_REDACTED
   STRIPE_PRODUCT_BASIC=prod_REDACTED
   STRIPE_PRICE_BASIC_MONTHLY=price_REDACTED
   STRIPE_PRODUCT_INSTRUMENT=prod_REDACTED
   STRIPE_PRICE_INSTRUMENT_REGULAR=price_REDACTED
   STRIPE_PRICE_INSTRUMENT_STUDENT=price_REDACTED
   STRIPE_PRODUCT_ANALYST=prod_REDACTED
   STRIPE_PRICE_ANALYST_REGULAR=price_REDACTED
   STRIPE_PRICE_ANALYST_STUDENT=price_REDACTED
   STRIPE_PRODUCT_BYO=prod_REDACTED
   STRIPE_PRICE_BYO_PLATFORM_FEE=price_REDACTED
   ```

5. **Restart the API** to pick up the new env. Either:
   - `pnpm --filter @divinr/api run dev:up` (kills + restarts cleanly), or
   - whatever process manager owns the prod node binary.

6. **Verify Stripe is in live mode** (no more test-mode banner on Checkout):

   ```bash
   curl -sS https://api.divinr.ai/api/config/public
   # → { "stripePublishableKey": "pk_live_..." }   ← live, not test
   ```

7. **First real charge — operator-driven smoke** (you, not a beta user, the
   first time through):
   - Sign up a fresh account at `https://divinr.ai`
   - Click "Add a card" in the trial chip
   - Complete Stripe Checkout with a real card
   - Wait for trial to end (or use `stripe trigger invoice.paid` against
     live mode if you want to skip the wait — be careful, this issues a
     real charge)
   - Verify in the Stripe Dashboard that the charge succeeded
   - Refund yourself via the admin UI (`/admin/users/<your-id>/billing` →
     Refund button) to confirm the refund flow works in live mode too

8. **Record the first prod charge** in this runbook under §5 below
   (date, user, amount, link to the Stripe Dashboard event).

## 4. Rollback plan

If anything goes wrong during cutover or in the hours after, the rollback
is one env-var change + restart:

1. Comment out (or unset) `STRIPE_SECRET_KEY` in prod `.env`.
2. Restart the API (`pnpm --filter @divinr/api run dev:up`).
3. The feature flag (`STRIPE_SECRET_KEY` presence) means every Stripe code
   path immediately reverts to `{ url: null, message: 'Stripe not configured…' }`
   responses. Real users see the pre-Stripe behavior again.

**What rollback does NOT do:** it does not cancel any subscriptions Stripe
already created. Users who completed checkout before rollback continue to
be charged by Stripe directly until you either:
- Cancel their subscription via Stripe Dashboard, or
- Cancel via `stripe subscriptions cancel sub_xxx --prorate`

If a user ends up double-charged or stuck because of the rollback, use the
admin Refund / Credit / Comp UI (still works as long as `STRIPE_SECRET_KEY`
is set — even briefly toggling it back on for the refund and back off
afterward is fine).

## 5. Post-cutover history

| Date | User | Amount | Stripe event | Notes |
|------|------|--------|--------------|-------|
| _(empty — cutover not yet performed)_ |   |   |   |   |

## 6. Operational invariants

- `.edu` re-verification cron runs daily at 03:00 UTC inside the API process
  via `@Cron('0 3 * * *')` on `BillingLifecycleCron.eduReverifyTick`. As long
  as the API process is up, the cron fires; no systemd timer needed. If the
  API is down for more than a day, the cron just resumes on next boot
  (idempotent — students already lapsed simply stay lapsed).
- The webhook endpoint `POST /billing/webhooks/stripe` enforces signature
  verification (`STRIPE_WEBHOOK_SECRET`) and event-id idempotency
  (`billing.stripe_webhook_events.event_id` PK). Duplicate deliveries return
  `{ received: true, duplicate: true }` and skip the handler.
- Stripe is canonical for dollars. `billing.subscriptions` and
  `billing.authored_items` are denormalized mirrors. If they ever drift
  from Stripe, trust Stripe; reconcile via Stripe Dashboard exports.
- Refund / credit / comp actions write to `billing.subscription_events`
  with `triggered_by='admin'` for audit. The reason text includes the
  admin user id who took the action.

## 7. Future hardening (deferred)

- Replace local `stripe listen` CLI with a dashboard-registered webhook
  endpoint (covered in `feedback_stripe_webhook_followup` memory).
- Stripe Tax integration (out of scope per PRD §6).
- Automated DB ↔ Stripe drift detection cron (PRD §4.1 Risks: best-effort v1).
- Webhook replay admin endpoint (PRD §6: dashboard's own replay is enough for v1).
- Email delivery for trial_will_end / payment_failed notifications (currently
  written to in-app `notify.notifications` rows; SMTP follow-up effort).
