# Effort: Stripe live-mode cutover

## Problem

The `stripe-integration` effort (Phases 1–5, shipped 2026-04-25) wired
Stripe into the entire user-facing + operator surface, but deliberately
stopped short of swapping `sk_test_…` for `sk_live_…` in prod. That swap is
the moment real money starts moving — and any UX bug or unexpected flow
slipped past test-mode would hit a real card. Test-mode beta gives us
weeks-to-months of slack to find those bugs first.

This effort is the deliberate "go live" event. It is gated behind enough
beta + browser testing on test mode that the team is confident the signup
→ trial → checkout → paid → past-due → cancellation path holds up under
real usage.

## Intention

Flip the prod env from Stripe test mode to Stripe live mode without losing
any in-flight test-mode subscribers (there shouldn't be any — they're all
test cards), and verify end-to-end with a real charge before declaring
cutover complete.

The runbook for the actual mechanics already exists at
`docs/runbooks/stripe-cutover.md`; this effort just activates it.

## Scope

### Pre-cutover gates (all must be green before the swap)

These are explicit pre-conditions, not optional:

- Stripe live-mode account fully activated (legal entity, bank account,
  tax info, identity verification, payouts test-driven with $0.50 charge)
- Browser testing checklist from `docs/runbooks/stripe-cutover.md` §2
  fully exercised on test mode, with any UX issues found and re-verified
- Production webhook endpoint registered in Stripe Dashboard (live mode)
  pointing at `https://api.divinr.ai/billing/webhooks/stripe` so we
  don't depend on the local `stripe listen` CLI in prod
- Secrets storage decided (don't commit `sk_live_…`; use a secrets
  manager or root-owned `.env` permissions)

### The cutover itself

Follow `docs/runbooks/stripe-cutover.md` §3 step-by-step:

1. Activate live mode in Stripe Dashboard
2. Run `tsx apps/api/scripts/stripe-seed.ts` against live mode → Products + Prices
3. Register live webhook endpoint, copy `whsec_…`
4. Update prod `.env` with all live keys + Price IDs in one atomic write
5. Restart API
6. Verify `/api/config/public` returns `pk_live_…`
7. Operator-driven smoke test: signup → Add a card → real charge → refund
8. Record first prod charge in the runbook history table

### Post-cutover monitoring

- Monitor `billing.stripe_webhook_events` for `handler_error IS NOT NULL`
  rows in the first 48 hours
- Monitor `/admin/billing/webhook-health` daily for the first week
- Track first-real-user signup → conversion ratio against test-mode baseline

## Out of Scope

- Stripe Tax integration (separate future effort if needed)
- Replacing the local-dev `stripe listen` CLI with a dashboard-registered
  webhook (covered in `feedback_stripe_webhook_followup` memory; needs
  to happen for prod webhook anyway, but that's a sub-step not a
  scope addition)
- Webhook replay admin endpoint (Stripe Dashboard's own replay is enough)
- Email delivery for trial_will_end / payment_failed (notifications are
  written to `notify.notifications`; SMTP wiring is a separate effort)
- Affiliate / referral payouts (Stripe Connect not in plan)
- Multi-currency (USD only for v1)

## Success Criteria

- `curl https://api.divinr.ai/api/config/public` returns a `pk_live_…` value
- A real card (yours, in step 7) successfully charged $50 (or the configured
  `BASIC_MONTHLY_USD` value) and the webhook flipped the user's status to
  `active` in `billing.subscriptions`
- The same charge was successfully refunded via the admin Refund button,
  verified by both Stripe Dashboard and the user's
  `billing.subscription_events` audit log
- No `handler_error` rows in `billing.stripe_webhook_events` after 48 hours
  of live operation

## Dependencies

- `stripe-integration` (the predecessor effort — Phases 1–5 must be on
  `main` and serving prod traffic without bugs before this effort begins)
- `feedback_stripe_cutover_gate` memory — the durable guidance that this
  effort is gated behind extensive browser testing
- Stripe live-mode account activation (operator task; can run in parallel
  with browser testing on test mode)

## Notes

The two pieces of work this effort owns are literally:
- `docs/runbooks/stripe-cutover.md` §3 (the ~7 step cutover sequence)
- `docs/runbooks/stripe-cutover.md` §5 (record the first prod charge)

Everything else — the code, the migrations, the admin tools, the rollback
plan — is already on `main` from the predecessor effort. This effort is a
deliberate human + operator activity, not a code-writing one.
