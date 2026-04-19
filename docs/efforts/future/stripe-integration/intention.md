# Effort: Stripe Billing Integration

## Problem

No payment processing exists. Every billable axis in the master intention — the $50/mo Basic subscription, per-item authorship charges ($20/instrument, $60/analyst), BYO API key platform fee, student cost-pass-through billing, and eventual graduation cost-reductions — is blocked until Stripe is wired.

## Intention

Integrate Stripe to support the single-tier + per-item billing model defined in the master intention. Build a billing surface flexible enough to add/remove line items dynamically (as users author and donate content), support cost-pass-through pricing (students), and expose a clean self-service portal.

## Scope

### Core Stripe Integration

- Stripe SDK in the API (Node/TypeScript)
- Customer creation on signup (or first payment action)
- Subscription product: **"Divinr Basic"** — price from `BASIC_MONTHLY_USD` env var
- Per-item billing: each authored instrument / analyst becomes a line item added to the subscription
- Webhook handling for payment events (success, failure, cancellation, update)
- Stripe Customer Portal link for self-service (update card, view history, cancel)

### Billing Surface Shapes

1. **Basic subscription** — flat $50/mo, charged at month-start
2. **Per-item authorship** — dynamic line items added/removed as users author/delete custom content ($20 per instrument, $60 per analyst from env vars)
3. **BYO API key platform fee** — optional add-on subscription line item (`BYO_PLATFORM_FEE_USD`) for users routing inference through their own provider keys
4. **Cost-pass-through (students)** — variable monthly charge based on `cost-modeling-system` usage totals; minimum floor (`STUDENT_FLOOR_USD`)
5. **Graduation cost reduction** — when a user donates authored content to base, the corresponding line item is removed from their subscription (see `custom-to-base-graduation`)

### Trial & Lifecycle Mechanics

- 30-day free trial via Stripe subscription trial
- No-card trials: account enters trial-expired state (read-only, 6-month dormancy → purge) without charging
- Email touchpoints at trial-end conversion and 30-days-before-purge (integration with notification/email system)

### Admin & Support

- Admin dashboard to view any customer's subscription, line items, compute-cost breakdown, payment history
- Manual override: refund, credit, comp (useful for student-club comps, early-adopter credits, bug compensation)

### Feature Gating

- Middleware that checks subscription status before allowing access to protected flows
- Trial-expired users get read-only access (consistent with master-intention lifecycle)
- Authorship endpoints require active paid subscription (not trial) — soft restriction, TBD in PRD

## Open Questions for PRD Phase

- Line-item granularity: one Stripe subscription with many line items, or a single custom-billed subscription with our own line-item tracking in DB and a monthly aggregate charge?
- Cost-pass-through billing (students) — charged monthly in arrears based on usage, or pre-paid based on projected cost? Arrears is more honest; prepaid is simpler.
- Proration: when a user authors a new instrument mid-month, do we prorate the $20 or charge at next cycle? (Probably next cycle — simpler UX, minor revenue delay.)
- Multi-currency support — v1 USD only?
- Tax handling — Stripe Tax, or defer to later?
- How does the public pricing page express per-item pricing without feeling like nickel-and-diming? (UX problem, worth dedicated design attention.)

## Success Criteria

- A user can sign up, start a 30-day trial, add a card, and auto-convert to paid Basic at $50/mo
- A user can author a custom instrument and see the $20 appear on next month's bill
- A user can delete or donate an authored item and see the line item removed
- A student user can verify .edu email and see their bill accrue via cost-pass-through
- Stripe webhook events correctly update user state (active / expired / cancelled)
- Admin can see any user's full billing picture in one view

## Out of Scope

- Affiliate / referral payout infrastructure (future effort)
- Physical product billing (none — Divinr is purely digital services)
- International tax complexity beyond what Stripe Tax handles automatically
- Graduation author royalties or buyouts (master intention picked cost-reduction instead, so no new payment flow needed — just line-item removal)

## Dependencies

- `user-billing-model` — defines what the subscription includes
- `user-authored-custom-content` — defines what per-item authorship means in code
- `cost-modeling-system` — feeds the student cost-pass-through billing
- Master intention env vars must be threaded through: `BASIC_MONTHLY_USD`, `INSTRUMENT_AUTHORSHIP_USD`, `ANALYST_AUTHORSHIP_USD`, `BYO_PLATFORM_FEE_USD`, `STUDENT_FLOOR_USD`, `TRIAL_DAYS`, `DORMANCY_MONTHS_BEFORE_PURGE`

---

*Rewritten after the master intention retired the multi-tier (Free/Pro/Premium/Custom) and paid club-tier models. Billing surface is now single Basic subscription + per-item line items + cost-pass-through for students.*
