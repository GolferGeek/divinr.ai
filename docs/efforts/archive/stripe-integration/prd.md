# Stripe Integration — Product Requirements Document

## 1. Overview

`user-billing-model` (PR #69) shipped the complete trial → read-only → dormancy → purge lifecycle, itemized bill preview, admin billing view, and nine Playwright specs — all without any payment processor. Stripe columns are present on `billing.subscriptions` and `billing.authored_items` but empty; the webhook endpoint is stubbed to return `{ received: true }`.

This effort wires Stripe into the existing surface. Every billable axis defined in master-intention §4 — `BASIC_MONTHLY_USD` subscription, per-item authorship (`INSTRUMENT_AUTHORSHIP_USD`, `ANALYST_AUTHORSHIP_USD`), BYO platform fee, and the flat `STUDENT_DISCOUNT_PCT` for .edu-verified users — becomes chargeable. No new business rules; only payment-rail implementation for rules already shipped.

## 2. Goals & Success Criteria

### Goals

1. Turn the existing no-card billing surface into a real payment pipeline. Every trial converts to a paid subscription (or gracefully expires) through Stripe, not through hand-wavy state transitions.
2. Make dynamic per-item billing first-class: authoring a custom instrument on day 15 adds a prorated Stripe subscription item; deleting it on day 20 credits the remainder. No month-end batching, no custom aggregate-invoice code.
3. Give students a frictionless path — `.edu` verification → 10% flat discount on authorship items, no Basic charge, no cost-pass-through accrual.
4. Retire the `STUDENT_FLOOR_USD` / variable-cost-pass-through code path in `StudentBillingService` without breaking any existing cost dashboards.
5. Make every Stripe event auditable — signature verification, event-id idempotency, full `subscription_events` trail.

### Success Criteria

Each criterion must pass before the effort can archive:

1. A regular user can complete the path: signup → 30-day trial → add card via Checkout → auto-convert to paid Basic at month-end, billed `BASIC_MONTHLY_USD`.
2. A regular user can author a custom instrument mid-cycle and see a prorated `INSTRUMENT_AUTHORSHIP_USD` line item on their next invoice; deleting that instrument credits the unused portion back.
3. A `.edu`-verified student pays `0.10 × INSTRUMENT_AUTHORSHIP_USD` per authored instrument (and `0.10 × ANALYST_AUTHORSHIP_USD` per authored analyst) and no Basic monthly. A student with zero authored items owes `$0`.
4. A user can click "Manage Billing" and land on the Stripe Customer Portal to update their card, download invoices, or cancel.
5. Payment failure drives Stripe's own Smart Retry cadence; `past_due` shows in `TrialCountdown` but does not itself block mutations. When Stripe emits `customer.subscription.deleted` (retries exhausted), our DB status flips to `canceled` and `ReadOnlyGuard` starts blocking mutations. Every transition is captured in `billing.subscription_events` with `triggered_by='stripe'`.
6. Stripe webhook receives an event, validates the signature (`STRIPE_WEBHOOK_SECRET`), records the event id in `billing.stripe_webhook_events`, and no-ops on duplicates.
7. The `/admin/users/:id/billing` view renders Stripe-sourced data (current invoice total, card last-four, payment history, upcoming invoice, refund/credit/comp controls).
8. `StudentBillingService` no longer reads `STUDENT_FLOOR_USD`; `cost-modeling/*` still renders cost-summary dashboards for operator/educational use, but is disconnected from billing.
9. All existing `/apps/e2e/tests/billing/*.spec.ts` specs continue to pass. New specs cover the Stripe-mode paths (checkout redirect, portal redirect, webhook-driven state change, student price routing).

## 3. User Stories / Use Cases

### Regular user — happy path
- **Signup**: Ethan signs up with email, starts a 30-day trial. No Stripe customer created yet. `TrialCountdown` shows `30 days left`.
- **Day 25 — add card**: Ethan clicks "Add a card" in the app-shell banner. He's redirected to a Stripe Checkout Session; on return, a Stripe `Customer` is created, a `Subscription` is created with `trial_period_days` set to `TRIAL_DAYS − 25 = 5`, and `billing.subscriptions.stripe_{customer,subscription}_id` are populated.
- **Day 30 — trial ends**: Stripe auto-charges `BASIC_MONTHLY_USD`. Webhook `invoice.paid` fires, `billing.subscriptions.status` goes from `trial` to `active`, `subscription_events` records `triggered_by='stripe'`.
- **Mid-cycle instrument author**: On day 35, Ethan authors a custom RR instrument. `BillingService.addAuthoredItem()` calls Stripe to add a subscription item referencing `STRIPE_PRICE_INSTRUMENT_REGULAR` with `proration_behavior='create_prorations'`. Next invoice shows the prorated `INSTRUMENT_AUTHORSHIP_USD` charge.

### Regular user — payment failure
- Card declines. Stripe enters `past_due` and drives its own Smart Retries (default ~3 weeks, 4 attempts). `TrialCountdown` shows a yellow "Payment failed — we'll retry" variant during `past_due`. **`ReadOnlyGuard` does not react to `past_due`** — we trust Stripe to either recover the payment or emit `customer.subscription.deleted`, at which point we flip to `canceled` and `ReadOnlyGuard` starts blocking mutations. 6-month dormancy clock starts from the `canceled` transition.

### Regular user — authoring during trial
- A trial user can author custom instruments and analysts freely. Authored items accumulate as unpriced DB rows during the trial; at trial-end (`invoice.paid` webhook for the first real invoice), they show up as regular Stripe subscription items charged at full rate. If the user never adds a card, trial expires to `canceled` with zero charges — authored items remain in the DB but the read-only state blocks any further authorship. **Rationale:** the trial's whole point is "try the full product." Gating authorship behind a paid subscription creates an upsell wall around the main value prop, which we don't want.

### Student user — happy path
- **.edu signup**: Alice signs up with `alice@bigu.edu`. `BillingService` verifies the `.edu` suffix against `STUDENT_EDU_ALLOWED_DOMAINS`. `authz.users.is_student = true`. No Stripe activity yet.
- **Zero-item baseline**: Alice has no authored items. `billing.subscriptions.status = trial → active`, `billing.subscriptions.stripe_subscription_id = null`. No Stripe subscription exists — there's nothing to charge. Alice gets full base-content access.
- **Day 5 — first authorship attempt**: Alice clicks "Create custom analyst" in the authoring UI. Frontend checks `billing-status.store` — no card on file. Before the authorship form submits, the frontend calls `POST /billing/checkout-session` (which the server resolves to `mode='setup'` because Alice has no subscription). Alice is redirected to Stripe Checkout, saves a card, and returns. `payment_method.attached` webhook fires; `billing.subscriptions.stripe_customer_id` and card details are populated.
- **Day 5 — authorship completes**: The authoring UI resumes; Alice submits the form. `BillingService.addAuthoredItem()` detects `is_student=true` AND `stripe_subscription_id IS NULL`, so it lazily creates a Stripe subscription using `STRIPE_PRICE_ANALYST_STUDENT` (`0.10 × ANALYST_AUTHORSHIP_USD = $6`) as the sole subscription item. Proration kicks in from the day-of-signup anchor.
- **.edu lapse** (detected by monthly cron): Alice's domain is no longer on the allowlist. `BillingService` flags the account `is_student=false`, loops over her Stripe subscription items and calls `stripe.subscriptionItems.update` to swap each student Price for the corresponding regular Price, appends a `STRIPE_PRICE_BASIC_MONTHLY` item, and emits a `notification` row. Her next invoice shows the full rates.

### BYO API keys
- Power user Mike attaches his own OpenAI key to his custom analyst. Billing adds `STRIPE_PRICE_BYO_PLATFORM_FEE` as a subscription item (`BYO_PLATFORM_FEE_USD`/mo). When Mike detaches the last BYO key, the item is removed (prorated credit).

### Admin support
- A support ticket comes in: "I was charged twice." Operator opens `/admin/users/:id/billing`, sees the duplicate invoice, clicks **Refund** — the action calls `POST /admin/users/:id/billing/refund` which calls Stripe's `refunds.create`, then appends a `subscription_event` with `triggered_by='admin', reason='support_refund'`.

## 4. Technical Requirements

### 4.1 Architecture

**Library:** `stripe` (npm, official Node SDK), pinned to the version matching `STRIPE_API_VERSION`. Single `StripeService` (`apps/api/src/billing/stripe.service.ts`) is the only module that instantiates `new Stripe(...)`; every caller hits its methods.

**Module wiring:** extend the existing `BillingModule`. Register `StripeService`, `BillingStripeSyncService`, `AdminBillingActionsController`. Use `@Inject(StripeService)` per CLAUDE.md DI convention — no type-only params.

**Responsibility split:**
- `BillingService` — the existing façade. Methods `addAuthoredItem`/`cancelAuthoredItem` grow a Stripe dimension: they perform the existing `INSERT ... ON CONFLICT` DB write first, then call `StripeService` to mirror the change. If the Stripe call fails post-DB-write, the failure is logged with enough context for manual reconciliation (v1 is best-effort; automated drift detection is deferred). Stripe writes are idempotent-keyed on `{authored_item_id}:{action}`, so retrying the same addAuthoredItem call is safe.
- `StripeService` — thin wrapper around the Stripe SDK. Creates customers, subscriptions, subscription items, checkout sessions, portal sessions, refunds. Knows nothing about the Divinr schema beyond Stripe metadata it attaches (`userId`, `authoredItemId`).
- `BillingController` (existing) — houses `POST /billing/webhooks/stripe`. The existing stub gets replaced with the full signature-verifying, idempotent-dedupe handler. Dispatch logic is delegated to `BillingStripeSyncService`.
- `BillingStripeSyncService` — the event handlers. Translates Stripe webhook payloads into `BillingService` state transitions (`appendSubscriptionEvent`, `markExpired`, etc.). Lives alongside `BillingService`.

**State-of-truth:** Stripe is canonical for dollars — subscription state, payment methods, invoice history. Divinr's `billing.subscriptions` / `billing.authored_items` rows are a denormalized mirror, for fast in-app reads (dashboard, TrialCountdown, ReadOnlyGuard).

**Write ordering** (user-initiated flows like addAuthoredItem):
1. DB write with Stripe ID columns left null (or retained from an earlier row).
2. Stripe call with an idempotency key derived from the DB row's stable id.
3. `UPDATE` the DB row with the returned Stripe IDs (`stripe_subscription_item_id`, etc.).

If step 2 fails, the DB row persists with null Stripe IDs (visible in the admin view as "pending Stripe sync"); operator reconciles manually (v1 is best-effort).

**Webhooks** are a passive sync channel: they catch eventual-consistency drift (e.g., a card auto-updated by Stripe), surface Stripe-initiated events with no corresponding user action (invoice.paid, subscription.deleted, payment_failed), and are the source of `billing.subscription_events` rows with `triggered_by='stripe'`. They are **not** the primary write path for user-initiated changes.

For mid-cycle preview reads ("what will my next bill be"), call `stripe.invoices.createPreview` — don't try to recompute from the DB.

**Config:** introduce a thin `BillingConfigService` that wraps `process.env` reads for every pricing/Stripe env var. No full NestJS `ConfigModule` refactor (out of scope); every new consumer uses `BillingConfigService`, and `BillingService` / `StudentBillingService` get refactored to read through it as part of this effort.

### 4.2 Data Model Changes

All additions; no column renames or drops.

#### New table: `billing.stripe_webhook_events`

Idempotency + audit trail for every inbound Stripe event.

```sql
CREATE TABLE IF NOT EXISTS billing.stripe_webhook_events (
  event_id text PRIMARY KEY,            -- Stripe event.id (e.g., evt_1N...)
  event_type text NOT NULL,             -- e.g., 'invoice.paid'
  stripe_created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,             -- null until handler succeeds
  user_id text,                         -- populated when event resolves to a user
  payload jsonb NOT NULL,
  handler_error text                    -- last error message if processing failed; null if ok
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_user_idx
  ON billing.stripe_webhook_events(user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS stripe_webhook_events_type_idx
  ON billing.stripe_webhook_events(event_type, received_at DESC);
```

Ships as a formal migration in `apps/api/db/migrations/2026-04-24-stripe-webhook-events.sql` (not via `BillingSchemaService.ensureSchema()`) to set the precedent for Stripe-related schema and keep webhook state explicit.

#### Extend: `billing.subscriptions`

Columns already present from `user-billing-model`:
- `stripe_customer_id text`
- `stripe_subscription_id text`

Add:
- `stripe_latest_invoice_id text`
- `stripe_default_payment_method_id text`
- `stripe_price_id_basic text` — which Price variant this user is on (regular vs. any future variant). Currently one of `STRIPE_PRICE_BASIC_MONTHLY` or `null` (students). Sets up cleanly for future educator/enterprise variants.
- `card_last4 text` — cached from Stripe for display without a round-trip
- `card_exp_month smallint`, `card_exp_year smallint` — cached for "card expiring soon" UX

Migration: `apps/api/db/migrations/2026-04-24-subscriptions-stripe-columns.sql` with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (idempotent).

#### Extend: `billing.authored_items`

Columns already present:
- `stripe_subscription_item_id text`
- `stripe_invoice_id text`

Add:
- `stripe_price_id text` — the Price this item was attached with (regular vs. student). Needed for .edu-lapse re-pricing (know which Price to swap from).

Migration: `apps/api/db/migrations/2026-04-24-authored-items-stripe-price-id.sql`.

#### Extend: `authz.users`

Add:
- `is_student boolean NOT NULL DEFAULT false`
- `edu_email text` — the specific email that verified `.edu` (may differ from primary login email if we ever support separate billing emails)
- `edu_last_verified_at timestamptz`

Migration: `apps/api/db/migrations/2026-04-24-users-student-flags.sql`.

### 4.3 API Changes

#### New: `POST /billing/checkout-session`

**Already stubbed; this effort implements the body.**

Request: `{ returnUrl: string }`.
Response: `{ url: string }` (Stripe-hosted Checkout URL).

Server infers Stripe Checkout mode from the user's billing state:

| User state | Mode | Initial items |
|---|---|---|
| Regular, no subscription | `subscription` | `STRIPE_PRICE_BASIC_MONTHLY` + current authored items (if any) at regular Prices |
| Student, no subscription | `setup` | (none — card-collection only; subscription is created lazily on first authored item) |
| Any user, already has a subscription | Returns 409 with `{ useEndpoint: '/billing/portal-session' }` |

Stripe Customer is created lazily on first call. Trial inheritance: when mode=`subscription`, `subscription_data.trial_period_days` is set to the user's remaining trial days (0 if already expired).

`@SkipReadOnly()` — users in `canceled|dormant` must still be able to re-subscribe via this endpoint.

#### New: `POST /billing/portal-session`

**Already stubbed; implement.**

Request: `{ returnUrl: string }`.
Response: `{ url: string }` (Stripe Customer Portal URL).

Requires an existing `stripe_customer_id`. Returns 409 if the user has never added a card.

#### New: `POST /billing/webhooks/stripe`

**Already stubbed to return `{ received: true }`; replace with real handler.**

Not authenticated (Stripe calls us). Signature-validated via `STRIPE_WEBHOOK_SECRET` and the `stripe-signature` header. Must be registered in `main.ts` with `rawBody: true` so the signature verifier gets the raw payload bytes (Nest's default JSON body parser breaks Stripe sig verification otherwise).

Flow per request:
1. Parse + verify signature → fail fast with 400 on mismatch.
2. Insert into `billing.stripe_webhook_events` with `ON CONFLICT (event_id) DO NOTHING`. If `INSERT ... RETURNING` returned zero rows, event is a duplicate — return 200 immediately.
3. Dispatch to `BillingStripeSyncService.handle<EventType>(payload)` inside a try/catch.
4. On success: `UPDATE ... SET processed_at = now() WHERE event_id = $1`. Return 200.
5. On failure: record `handler_error`, return 500. Stripe will retry.

Events handled in v1:
- `customer.subscription.created` → ensure mirror row; no-op if already present (our own create flow will have already written it).
- `customer.subscription.updated` → sync status, items, period dates.
- `customer.subscription.deleted` → mark `canceled`, append `subscription_event`.
- `customer.subscription.trial_will_end` → notify; no state change (trial hasn't actually ended).
- `invoice.paid` → append `subscription_event` with `to_status='active'` if currently `trial` or `past_due`.
- `invoice.payment_failed` → append `subscription_event` with `to_status='past_due'`. No read-only yet.
- `payment_method.attached` → cache `card_last4`, `card_exp_month`, `card_exp_year`.
- `checkout.session.completed` — optional; primary wiring is via `subscription.created`.

Events explicitly ignored in v1 (logged but not handled): anything `setup_intent.*`, `charge.*`, `balance.available` — Stripe sends a lot of noise.

#### Modified: `GET /billing/preview`

Existing endpoint returns DB-computed preview. Extend to call `stripe.invoices.createPreview` for users with a `stripe_subscription_id` and merge/reconcile. For trial-no-card and students-zero-items (no subscription yet), fall back to the DB path. Response shape stays backward-compatible — add `upcomingInvoice: { amountDue, dueDate, lineItems[] } | null`.

#### New: `GET /api/config/public`

**Unauthenticated**, minimal public config for the SPA bundle. Response:
```json
{ "stripePublishableKey": "pk_test_..." }
```
Exists so the publishable key can be rotated without a frontend rebuild. Only add more fields here when they're genuinely needed on the client before login.

#### New: `POST /admin/users/:id/billing/refund`

Request: `{ invoiceId: string, amountCents?: number, reason: string }`.
Response: `{ refundId: string }`.

Admin-only (RBAC `admin.billing.refund` permission — must be added via seed migration). Calls `stripe.refunds.create`, appends a `subscription_event` with `triggered_by='admin'`.

#### New: `POST /admin/users/:id/billing/credit`

One-time credit against the next invoice. Request: `{ amountCents: number, reason: string }`.

Uses Stripe's `customers.createBalanceTransaction` with a negative amount. Event log as above.

#### New: `POST /admin/users/:id/billing/comp`

Zero-charge an upcoming period. Request: `{ periodsCount: number, reason: string }` (default 1).

Implementation: apply a 100% coupon for N billing cycles. Event log as above.

#### Modified: `GET /admin/users/:id/billing`

Extend the existing admin view response with: last 10 Stripe invoices (amount, status, invoiceUrl), current payment method card-last4/exp, upcoming invoice preview, list of Stripe events from `billing.stripe_webhook_events` (last 50).

### 4.4 Frontend Changes

#### Modified: `TrialCountdown.vue`
Add a `past_due` variant (yellow, text: "Payment failed — retrying"). Add a `setup_needed` variant (blue, text: "Add a card to continue after trial"). **Precedence when multiple conditions are true**: subscription status beats days-until-anything. So `past_due` with 2 days left on the trial still renders the `past_due` chip.

#### Modified: `BillingSummaryView.vue` (`/billing-summary`)
- Replace "Add a card" placeholder link with a real call to `POST /billing/checkout-session` and window-redirect.
- Add a "Manage Billing" button → `POST /billing/portal-session` → redirect.
- Render the `upcomingInvoice` block from the extended preview response.

#### Modified: `PricingView.vue` (`/pricing`)
- Distinct student-vs-regular rows. Render `$20` / `$60` for regular, `$2` / `$6` for student with a "requires .edu email verification" footnote.
- No nickel-and-diming: lead with "Divinr Basic: $50/mo" and "Everything base — all analysts on all instruments — included." Per-item authorship is a follow-up line framed as "Make it yours: author your own instrument ($20/mo) or analyst ($60/mo)."

#### Modified: `AdminUserBillingView.vue` (`/admin/users/:id/billing`)
Three new sections (stacked under the existing panels): **Payment Methods**, **Invoice History**, **Stripe Events**. Three new action buttons: **Refund**, **Credit**, **Comp** — each opens a modal with a form + explicit confirmation.

#### "Add a card" buttons (ReadOnlyBanner, TrialCountdown, authoring flow)
No modal. Each CTA triggers `POST /billing/checkout-session` and does a direct `window.location` redirect to the returned URL. Stripe hosts the actual card-entry form; we round-trip through it. On return, the dashboard re-fetches `billing-status.store` and the appropriate UI state (chip, banner, authoring form) re-renders.

### 4.5 Infrastructure Requirements

- **Stripe account setup** (operator task, not code): test-mode + live-mode. Products and Prices seeded via one-time bootstrap script (`apps/api/scripts/stripe-seed.ts`) that reads the pricing env vars and creates the Products/Prices idempotently, writing the resulting IDs back to an ops-managed `.env.stripe` file. Run once per Stripe environment.
- **Cloudflare**: webhook endpoint `api.divinr.ai/billing/webhooks/stripe` must not be WAF-blocked. Stripe's IP ranges are documented; add to allowlist if needed.
- **Env vars** (new):
  - `STRIPE_SECRET_KEY` — sk_test_* / sk_live_*. Never committed.
  - `STRIPE_PUBLISHABLE_KEY` — pk_test_* / pk_live_*. Frontend fetches via `/api/config/public` (new tiny endpoint).
  - `STRIPE_WEBHOOK_SECRET` — whsec_*. One per environment.
  - `STRIPE_API_VERSION` — pinned (e.g., `2025-04-30.basil`).
  - `STRIPE_PRODUCT_BASIC`, `STRIPE_PRICE_BASIC_MONTHLY` — written by the seed script.
  - `STRIPE_PRODUCT_INSTRUMENT`, `STRIPE_PRICE_INSTRUMENT_REGULAR`, `STRIPE_PRICE_INSTRUMENT_STUDENT`
  - `STRIPE_PRODUCT_ANALYST`, `STRIPE_PRICE_ANALYST_REGULAR`, `STRIPE_PRICE_ANALYST_STUDENT`
  - `STRIPE_PRODUCT_BYO`, `STRIPE_PRICE_BYO_PLATFORM_FEE`
  - `STUDENT_EDU_ALLOWED_DOMAINS` — comma-separated, default `edu` (suffix match).
- **Local dev**: Stripe CLI (`stripe listen --forward-to localhost:7100/billing/webhooks/stripe`) becomes part of the dev onboarding. Add to CLAUDE.md after shipping.
- **Cron job (new)**: monthly `.edu` re-verification. Lives alongside existing `billing-lifecycle.cron.ts`. Marks `is_student=false` for users whose email domain falls out of the allowlist; triggers the re-pricing flow (swap all their Stripe subscription items to regular Prices, attach `STRIPE_PRICE_BASIC_MONTHLY`).

## 5. Non-Functional Requirements

### Security

- `STRIPE_SECRET_KEY` lives only in the API process environment; never logged, never serialized in error messages. Add an explicit redaction filter in `logger.ts` for any string matching `/sk_(test|live)_/`.
- Webhook signature verification is mandatory — no "dev mode bypass." Local dev uses a separate `STRIPE_WEBHOOK_SECRET` from the Stripe CLI's output.
- Admin actions (refund, credit, comp) require the `admin.billing.refund` / `.credit` / `.comp` permissions — seeded for `role-admin` and `role-super-admin` only.
- The public pricing page must never expose `STRIPE_SECRET_KEY`. `STRIPE_PUBLISHABLE_KEY` is safe to embed but should still be fetched via `/api/config/public` (server-rendered) rather than compiled into the bundle, so rotation is operator-local.

### Reliability

- Stripe SDK calls wrapped with a 10-second timeout. Timeouts log a warning and bubble up as 502 to the caller. User-facing error: "Payment provider is briefly unavailable. Please try again in a minute."
- Every write path (subscription item add/remove) uses Stripe's `idempotencyKey` (derived deterministically from `authoredItemId` + action) so retries don't double-charge.
- Webhook handler errors return 500; Stripe retries with exponential backoff for 3 days. The handler itself is idempotent via `billing.stripe_webhook_events.event_id` PK.

### Performance

- Webhook round-trip: p95 under 200ms. Synchronous DB writes; no external calls from the handler beyond the signature verifier.
- Checkout Session creation: p95 under 500ms (Stripe API-bound). Acceptable because it's one-shot and user-initiated.

### Observability

- Every webhook event hits `billing.stripe_webhook_events`; the admin view surfaces last 50 per user. No Datadog/Grafana integration in v1 (we don't have the infra); add a simple `GET /admin/billing/webhook-health` returning count-by-status-by-day-last-7 for spot checks.

### Compatibility

- Existing `/billing/preview`, `/billing/status`, `/admin/users/:id/billing` response shapes must stay backward-compatible (additive fields only). The nine shipped Playwright specs under `apps/e2e/tests/billing/` must continue to pass without modification.

## 6. Out of Scope

- **Stripe Tax**. Manual sales-tax tracking for any state that crosses nexus. Follow-up effort.
- **Multi-currency.** USD only. Stripe supports currency per Price, so the future enablement path is "add new Prices"; no architecture change needed.
- **Affiliate/referral payouts.** No Stripe Connect, no payout flows.
- **Usage-based pricing.** Per-item fees are flat. The cost-modeling system computes compute-cost for operator visibility, not billing.
- **Custom pricing negotiation.** No enterprise one-off invoices in v1.
- **Graduation cost-reduction rewards** — handled by `custom-to-base-graduation` effort (future). This effort just needs to expose a clean "remove authored item" path that credits back properly.
- **Full NestJS `ConfigModule` refactor.** Introduce a scoped `BillingConfigService` only; other modules' `process.env` reads remain until a future infra-hardening effort.
- **Webhook replay admin endpoint.** Stripe's own dashboard has replay. If we need in-app replay later, we have the events table to drive it.
- **Email sends.** `trial_will_end`, `payment_failed`, `dormancy_warning` should surface as in-app `Notification` rows per existing `notification-system`. SMTP delivery is a follow-up when we have an email provider chosen.
- **Contract-override billing.** Master-intention §4.3 marks this as TBD. No Stripe Product/Price is seeded for contract overrides; authoring a contract override against a base entity is free in v1. Decided when graduation and override economics are revisited.

## 7. Dependencies & Risks

### External dependencies

- Stripe test-mode account access for dev; Stripe live-mode account access for prod. Account-level setup (legal-entity info, bank account) is a one-time operator task.
- npm `stripe` package, pinned to a version whose default API version matches `STRIPE_API_VERSION`.
- Stripe CLI for local webhook forwarding during dev.

### Internal dependencies

- `user-billing-model` (shipped) — this effort builds directly on its schema and services.
- `user-authored-custom-content` (shipped) — `addAuthoredItem`/`cancelAuthoredItem` already have the event-hook shape we need; we just add Stripe calls inside.
- `cost-modeling-system` (shipped) — survives in read-only form after the student-billing refactor.

### Technical risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Stripe API version drift — our pinned version becomes deprecated | Medium | Pin explicitly. Quarterly review. Upgrade is a focused effort, not a surprise. |
| Webhook delivery failures silently accumulate | Medium | `billing.stripe_webhook_events.processed_at IS NULL` query + a daily alert (admin digest email is deferred — surface via `/admin/billing/webhook-health` endpoint now, wire to Cloudflare email alert when the alerting infra lands). |
| Post-DB-write Stripe call fails → Divinr DB and Stripe drift | Medium | DB `INSERT ... ON CONFLICT` completes first, then the Stripe call runs with an idempotency key derived from `{authored_item_id}:{action}`. Failures after the DB write are logged with full context (userId, authoredItemId, stripeOperation, errorPayload). v1 is best-effort — manual operator reconciliation via Stripe dashboard + admin billing view. Automated drift-detection cron is a future hardening effort; acceptable given the small beta cohort. |
| Double-charge on network retry | Low | Every Stripe write uses an idempotency key derived from stable IDs (`authored_item:{uuid}:{action}`). |
| .edu allowlist too permissive | Low | Conservative allowlist: `edu` suffix only in v1. Explicit allowlist for non-`.edu` student programs (e.g., `.ac.uk`) can be added per request. |
| Student re-pricing on lapse fails midway | Medium | Re-pricing is a loop over subscription items. If it crashes after item 3 of 7, the monthly cron picks it up on the next run (the user is still flagged `is_student=false`, so the cron re-targets items still on student Prices). |
| Pricing env-var drift between Stripe and our DB | High if unchecked | Startup sanity check in `StripeService.onModuleInit`: fetch each `STRIPE_PRICE_*` Price and compare `unit_amount` against the corresponding `*_USD` env var. Log-and-continue on mismatch (operator alert, not crash — Stripe is authoritative for charging). |

### Product risks

- **Student abuse** — a user with a fake `.edu` address pays 10% forever. Mitigation: only a handful of known real .edu users in v1; manual spot-checks. Formal verification (e.g., SheerID) is a future effort if abuse shows up.
- **Pricing page anxiety** — users worry about per-item nickel-and-diming. Mitigation: marketing copy reframes per-item as "Make it yours" (additive creation, not extractive billing); itemized bill view makes every charge transparent.

## 8. Phasing

Each phase is a green-light checkpoint. All phases ship behind the same implicit feature flag: `STRIPE_SECRET_KEY` presence. If the env var is unset, all Stripe calls no-op and the app behaves exactly as it does today (trial/expired state transitions happen on our own cron, no payment). This lets us ship to prod in increments without a big-bang cutover.

### Phase 1 — Scaffolding & Config (0.5 day)

- Add `stripe` npm dependency, pin version.
- Create `BillingConfigService` wrapping all pricing + Stripe env vars.
- Create `StripeService` skeleton with constructor-injected config; `onModuleInit` fetches each `STRIPE_PRICE_*` and logs a warning if `unit_amount` mismatches the corresponding `*_USD` env var (log-and-continue; Stripe is authoritative).
- Write one-time seed script `apps/api/scripts/stripe-seed.ts` for Products/Prices (idempotent — reads existing Products by `lookup_key` before creating).
- Implement `GET /api/config/public` returning `{ stripePublishableKey }`.
- Manual operator step: run seed script against Stripe test-mode, write IDs to env.
- Gate: `StripeService.onModuleInit` passes sanity check; `/api/config/public` returns the test-mode publishable key; env-mismatch warning path unit-tested.

### Phase 2 — Regular-User Subscription Lifecycle (1.5 days)

Scope: regular-path only. Student path waits for Phase 4.

- **Migrations**:
  - `apps/api/db/migrations/2026-04-24-stripe-webhook-events.sql` — create `billing.stripe_webhook_events`.
  - `apps/api/db/migrations/2026-04-24-subscriptions-stripe-columns.sql` — add `stripe_latest_invoice_id`, `stripe_default_payment_method_id`, `stripe_price_id_basic`, `card_last4`, `card_exp_month`, `card_exp_year` to `billing.subscriptions`.
  - `apps/api/db/migrations/2026-04-24-users-is-student.sql` — add `authz.users.is_student boolean NOT NULL DEFAULT false` only. (`edu_email`, `edu_last_verified_at` ship in Phase 4.)
- Implement `POST /billing/checkout-session` with server-side mode inference. For Phase 2 users (all non-student), mode is always `subscription` with Basic + existing authored items.
- Implement `POST /billing/portal-session`.
- Replace `POST /billing/webhooks/stripe` stub with the full handler: raw-body via `main.ts` config, signature verification, `ON CONFLICT (event_id) DO NOTHING` idempotency, per-event dispatch.
- Wire `BillingStripeSyncService` handlers: `customer.subscription.{created,updated,deleted}`, `invoice.{paid,payment_failed}`, `customer.subscription.trial_will_end`, `payment_method.attached`, `checkout.session.completed`.
- `trial_will_end` and `invoice.payment_failed` handlers write `notification` rows via the existing notification-system (in-app; no SMTP).
- `ReadOnlyGuard` tweak: document that it reacts only to `canceled`/`dormant` (no change to code needed; this is a status-assumption confirmation rather than a new grace path). `past_due` is handled purely at the UI layer via `TrialCountdown`.
- Frontend: wire "Add a card" button in `ReadOnlyBanner` / `TrialCountdown` / `BillingSummaryView` → calls `POST /billing/checkout-session` → `window.location` redirect.
- `TrialCountdown.vue` grows `past_due` and `setup_needed` variants with explicit precedence (status > days).
- Gate: a regular beta user (test-mode Stripe) can signup → trial → add card → auto-convert to paid at `invoice.paid`; `TrialCountdown` reflects each transition; `billing.subscription_events` logs every Stripe-driven transition with `triggered_by='stripe'`. New Playwright specs: `checkout-redirect.spec.ts`, `webhook-lifecycle.spec.ts` (spec drives real `POST /billing/webhooks/stripe` calls against a signed test-mode payload fixture).

### Phase 3 — Per-Item Line Items (1 day)

- Migration: `2026-04-24-authored-items-stripe-price-id.sql` — add `stripe_price_id` to `billing.authored_items`.
- Wire `BillingService.addAuthoredItem` → `StripeService.addSubscriptionItem` with `proration_behavior='create_prorations'` and idempotency key `authored_item:{id}:add`.
- Wire `BillingService.cancelAuthoredItem` → `StripeService.removeSubscriptionItem` with credit-back proration and idempotency key `authored_item:{id}:remove`.
- Handle the first-authored-item-for-regular-user-who-has-subscription case (add to existing sub).
- Extend `GET /billing/preview` with `upcomingInvoice` from `stripe.invoices.createPreview`; `BillingSummaryView` renders it.
- Gate: regular user authors an instrument mid-cycle → `upcomingInvoice` shows a prorated charge; deletes it → credit-back line appears. New spec: `per-item-proration.spec.ts`.

### Phase 4 — Student Pricing Path (1 day)

- Migration: `2026-04-24-users-edu-fields.sql` — add `authz.users.edu_email`, `edu_last_verified_at`.
- `.edu` verification at signup: check email suffix against `STUDENT_EDU_ALLOWED_DOMAINS` (default `edu`); set `is_student=true`, populate `edu_email`, `edu_last_verified_at`.
- **Extend `POST /billing/checkout-session` mode inference**: student-with-no-subscription returns `mode='setup'` (card-only, no subscription). Regular path from Phase 2 unchanged.
- **Extend `BillingService.addAuthoredItem`** to branch on `is_student`:
  - Student first item with no subscription: frontend is responsible for ensuring a card is on file first (via checkout redirect); `addAuthoredItem` lazily creates the Stripe customer (if needed) and subscription, with only the student-Price item as the initial subscription item. No `BASIC_MONTHLY_USD` line.
  - Student subsequent item: add as another subscription item at the student Price.
  - Regular user: regular Price (no change from Phase 3).
- Frontend: authoring flow pre-checks `billing-status.store` for `hasCardOnFile`; if false and user is trying to author, redirect to checkout first, then resume.
- Monthly `.edu` re-verification cron (alongside existing `billing-lifecycle.cron.ts`): if a user's `edu_email` domain is no longer on the allowlist, set `is_student=false`, loop over their subscription items and call `stripe.subscriptionItems.update` to swap each student Price for the matching regular Price, attach `STRIPE_PRICE_BASIC_MONTHLY`, write a `notification` row.
- Refactor `StudentBillingService` to remove all `STUDENT_FLOOR_USD` reads and the cost-pass-through accrual path. Keep `getMySummary()` returning LLM usage totals for the educational/operator dashboard; make it no longer feed billing.
- `PricingView.vue`: student variant row with "requires .edu email verification" footnote; updated marketing copy ("Make it yours…").
- Gate: student signup end-to-end (test-mode Stripe); zero-item student owes $0 and has no Stripe subscription; adding analyst redirects to Checkout for card, returns, creates sub with $6 student item; `.edu` lapse cron re-prices cleanly. New specs: `student-signup.spec.ts`, `student-lapse.spec.ts`.

### Phase 5 — BYO + Admin Actions (1 day)

- Wire BYO platform fee: attaching the first BYO LLM credential adds `STRIPE_PRICE_BYO_PLATFORM_FEE` as a subscription item; detaching the last credential removes it (both prorated). Idempotency keys: `byo:{userId}:add`, `byo:{userId}:remove`.
- Implement `POST /admin/users/:id/billing/{refund,credit,comp}` per §4.3.
- Seed RBAC permissions `admin.billing.refund` / `.credit` / `.comp` to `role-admin` and `role-super-admin` via a seed migration `2026-04-24-admin-billing-permissions.sql`.
- Extend `AdminUserBillingView.vue` with **Payment Methods**, **Invoice History**, **Stripe Events** panels + three action modals.
- Implement `GET /admin/billing/webhook-health` — returns counts of processed / failed / pending events grouped by day for the last 7 days. Surface at `/admin/billing/webhook-health` admin route (new small view; one table, no chart).
- Gate: admin can refund an invoice end-to-end with a webhook-driven event log; BYO fee adds/removes cleanly; webhook-health view renders. New spec: `admin-refund.spec.ts`.

### Phase 6 — Cleanup, Testing, Prod Cutover (0.5 day)

- Delete `STUDENT_FLOOR_USD` from `.env.example`, comment-banner the removal in the file header, remove any remaining references in docs (CLAUDE.md if any, `cost-modeling-system/*` archives are left untouched by convention).
- Add Stripe CLI local-dev instruction to `CLAUDE.md` (how to run `stripe listen --forward-to localhost:7100/billing/webhooks/stripe` during development).
- Write `docs/runbooks/stripe-cutover.md` — prod Stripe account provisioning checklist, order of operations for env-var rollout, rollback plan (unset `STRIPE_SECRET_KEY` reverts the app to no-payment behavior).
- Add monthly `.edu` re-verification cron to the API's systemd timer / process-manager config.
- **Operator cutover**:
  1. Create live-mode Stripe account (legal entity, bank account — operator task).
  2. Run `apps/api/scripts/stripe-seed.ts` against live-mode.
  3. Write resulting Price IDs to prod env.
  4. Set `STRIPE_SECRET_KEY` to live key in prod (this is the "feature flag on" moment — real charges begin).
  5. Restart API.
- Gate: first real trial-to-paid conversion happens in prod. One of the three active beta users (`ethan`, `golfergeek`, `demo-user`) takes the full path.

**Total estimate: ~5.5 engineering days** — tight because most of the surface (`billing.subscriptions`, `authored_items`, admin view, Playwright billing project) is already shipped. The effort is primarily "wire Stripe into existing scaffolding," not "build billing from scratch."

---

*This PRD derives directly from `intention.md` in this folder. Every scope item in the intention is addressed in sections 4–5; every resolved decision from the 2026-04-24 discussion is implemented in the data model, API, or phasing. The four intention-level open questions are resolved here (parallel Prices for student discount; monthly cron for .edu re-verification; additive pricing-page framing; no webhook replay endpoint in v1, surfaced via admin events view).*
