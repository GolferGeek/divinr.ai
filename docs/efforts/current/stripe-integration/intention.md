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
4. **Student discount (.edu)** — `.edu`-verified users pay `STUDENT_DISCOUNT_PCT` (default 10%) of the regular per-item authorship price and no `BASIC_MONTHLY_USD`. A student with zero authored items owes $0. Implemented as per-subscription-item Stripe coupons or a separate price tier per item; decision deferred to PRD.
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

## Resolved Before PRD (2026-04-24 discussion)

- **Line-item granularity**: one Stripe subscription with many dynamic line items. Authoritative source of truth is Stripe; our DB mirrors. Avoids custom aggregate-invoice code.
- **Student billing**: flat `STUDENT_DISCOUNT_PCT` (10%) on per-item authorship, no `BASIC_MONTHLY_USD`, no floor. Retires the variable cost-pass-through path. Existing `StudentBillingService` + `student-billing.test.ts` need refactoring to match (PRD will scope the rewrite).
- **Proration**: standard Stripe subscription-item proration on mid-cycle add/remove, for both regular and student users. Authoring an instrument on day 15 charges a half-month line item; deleting on day 20 credits back the remainder.
- **Multi-currency**: USD only for v1.
- **Tax**: defer Stripe Tax to a follow-up effort. Collect US sales tax manually if the early-adopter volume ever crosses nexus thresholds.

## Open Questions for PRD Phase

- How is the student discount implemented in Stripe? Per-subscription-item coupons (one `STUDENT_PCT_OFF_10` coupon applied to each authorship line item), or two parallel Price objects per product (`instrument_regular` + `instrument_student`) with a product-wide customer metadata flag routing signup? The second is cleaner for reporting; the first is cleaner for code.
- `.edu` lapse: auto-detect via scheduled re-verification, or on-demand when the user logs in? Affects how fast a graduated-student starts paying full rate.
- How does the public pricing page express per-item pricing without feeling like nickel-and-diming? (UX problem, worth dedicated design attention — the itemized bill view `user-billing-model` shipped already demonstrates the idea; marketing copy can borrow from that.)
- Exact failure modes for webhook delivery (Stripe retries 3 days) — do we need a replay endpoint in the admin panel, or is the Stripe dashboard enough?

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
- Master intention env vars must be threaded through: `BASIC_MONTHLY_USD`, `INSTRUMENT_AUTHORSHIP_USD`, `ANALYST_AUTHORSHIP_USD`, `BYO_PLATFORM_FEE_USD`, `STUDENT_DISCOUNT_PCT`, `TRIAL_DAYS`, `DORMANCY_MONTHS_BEFORE_PURGE`. (`STUDENT_FLOOR_USD` and `REGULAR_MARKUP_PCT` retired; see master-intention §4.5 — existing code references in `cost-modeling/student-billing.service.ts` need cleanup as part of this effort.)

---

*Rewritten after the master intention retired the multi-tier (Free/Pro/Premium/Custom) and paid club-tier models. Billing surface is now single Basic subscription + per-item line items + cost-pass-through for students.*
