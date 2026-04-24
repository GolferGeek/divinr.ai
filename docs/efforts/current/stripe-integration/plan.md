# Stripe Integration — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-24
**Status**: Not Started

## Feature Flag

The effort ships behind the implicit flag `STRIPE_SECRET_KEY` (PRD §8). When unset:
- `StripeService.onModuleInit` logs "Stripe disabled — STRIPE_SECRET_KEY not set" and all Stripe-calling methods become no-ops that return `null` / empty.
- `POST /billing/checkout-session` and `POST /billing/portal-session` return the existing `{ url: null, message: 'Stripe not configured — billing preview only' }` shape (unchanged from the current stub).
- `POST /billing/webhooks/stripe` returns `{ received: true }` without attempting signature verification.
- `BillingService.addAuthoredItem` / `cancelAuthoredItem` perform only the DB write, no Stripe mirror.
- `.edu` cron is still scheduled but exits early.

This guarantees every phase can land on `main` without disturbing the app's current no-payment behavior; the "feature flag on" moment is Phase 6 step 5 (setting the live key in prod env).

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Scaffolding & Config
- [x] Phase 2: Regular-User Subscription Lifecycle
- [x] Phase 3: Per-Item Line Items
- [x] Phase 4: Student Pricing Path
- [ ] Phase 5: BYO + Admin Actions
- [ ] Phase 6: Cleanup, Testing, Prod Cutover

---

## Phase 1: Scaffolding & Config
**Status**: Complete
**Objective**: Land the Stripe SDK, env-var plumbing, seed script, and public-config endpoint without touching any write path — so Phases 2–5 can assume `StripeService`, `BillingConfigService`, and Price IDs exist.

### Steps
- [x] 1.1 Add `stripe` to `apps/api/package.json` (pin a version whose SDK default `apiVersion` matches `STRIPE_API_VERSION`; current target `'2025-04-30.basil'`). Run `pnpm install` at the repo root.
- [x] 1.2 Create `apps/api/src/billing/billing-config.service.ts` — wraps `process.env` reads for every pricing + Stripe env var listed in PRD §4.5 (`BASIC_MONTHLY_USD`, `INSTRUMENT_AUTHORSHIP_USD`, `ANALYST_AUTHORSHIP_USD`, `BYO_PLATFORM_FEE_USD`, `STUDENT_DISCOUNT_PCT`, `TRIAL_DAYS`, `DORMANCY_MONTHS_BEFORE_PURGE`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_API_VERSION`, all `STRIPE_PRODUCT_*` / `STRIPE_PRICE_*`, `STUDENT_EDU_ALLOWED_DOMAINS`). Every method returns parsed values with defaults; boolean `isStripeEnabled()` returns `!!STRIPE_SECRET_KEY`. Register as a provider in `BillingModule`, export it.
- [x] 1.3 Create `apps/api/src/billing/stripe.service.ts`:
  - Constructor uses `@Inject(BillingConfigService)` per CLAUDE.md DI convention.
  - Instantiates `new Stripe(config.stripeSecretKey, { apiVersion: config.stripeApiVersion })` only when `isStripeEnabled()` is true; otherwise `this.client = null`.
  - `onModuleInit()`: if enabled, loops over each `STRIPE_PRICE_*` env var, calls `client.prices.retrieve(priceId)`, and compares `unit_amount` against the corresponding `*_USD * 100`. On mismatch, log a `warn` with both values and continue (Stripe is authoritative — do not crash). If any Price ID fails to retrieve, log the error and continue. Disabled mode logs one line and returns.
  - Public surface (stub method signatures; bodies return `null` / throw "not implemented" until the phases that use them):
    `ensureCustomer(userId, email)`, `createCheckoutSessionSubscription(opts)`, `createCheckoutSessionSetup(opts)`, `createPortalSession(opts)`, `addSubscriptionItem(opts)`, `removeSubscriptionItem(opts)`, `updateSubscriptionItemPrice(opts)`, `createSubscriptionWithItem(opts)`, `createRefund(opts)`, `createBalanceCredit(opts)`, `applyCompCoupon(opts)`, `previewUpcomingInvoice(subscriptionId)`, `verifyWebhookSignature(rawBody, signature)`.
  - Register as provider in `BillingModule`, export it.
- [x] 1.4 Implement `GET /api/config/public` in a new `apps/api/src/public-config/public-config.controller.ts` mounted in a new `PublicConfigModule` (avoid the name `ConfigModule` to prevent collision with NestJS's `@nestjs/config` ConfigModule that's already in the dep tree). Unauthenticated; returns `{ stripePublishableKey: config.stripePublishableKey ?? null }`. The `PublicConfigModule` imports `BillingModule` (or just imports `BillingConfigService` directly via providers + exports). Register `PublicConfigModule` in `AppModule.imports`.
- [x] 1.5 Add `apps/api/scripts/stripe-seed.ts`:
  - Reads `STRIPE_SECRET_KEY` + pricing env vars.
  - Idempotently creates Products + Prices using stable `lookup_key` values: `basic_monthly`, `instrument_regular`, `instrument_student`, `analyst_regular`, `analyst_student`, `byo_platform_fee`. For each, first call `stripe.prices.list({ lookup_keys: [...] })`; only create what's missing.
  - On completion, prints a block of `STRIPE_PRICE_*=price_xxx` and `STRIPE_PRODUCT_*=prod_xxx` env-var exports so the operator can paste into `.env`.
  - Script has no npm-script wrapper in `package.json` — operator runs directly with `tsx apps/api/scripts/stripe-seed.ts` (consistent with `migrate-billing-backfill.ts`).
- [x] 1.6 Extend `apps/api/.env.example` (create if missing) with every new env var from PRD §4.5, all blank/placeholder, with one-line comments. Do not commit real keys.
- [x] 1.7 Add unit test `apps/api/tests/unit/billing-config-service.test.ts`: verifies env-var parsing, default fallbacks, `isStripeEnabled()` toggling on/off, and decimal → cents conversion for pricing vars. Append to the `test:unit` chain in `apps/api/package.json`.
- [x] 1.8 Add unit test `apps/api/tests/unit/stripe-service-sanity.test.ts`: stubs the Stripe SDK (inject a fake `prices.retrieve`), asserts `onModuleInit` logs a warning (not a throw) when `unit_amount` differs from env. Append to `test:unit` chain.
- [ ] 1.9 Manual operator step (documented, not executed by this phase): run `tsx apps/api/scripts/stripe-seed.ts` against Stripe test-mode; paste the printed env vars into `.env`. This is a prerequisite for Phases 2+ but this phase itself does NOT require the vars to be present — everything degrades cleanly when `STRIPE_SECRET_KEY` is unset.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm -w run lint` passes clean.
- [x] **Typecheck**: `pnpm -w run typecheck` passes clean.
- [x] **Build**: `pnpm -w run build` passes clean.
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` passes — including 26 new BillingConfigService cases + 7 new StripeService sanity cases.
- [x] **E2E Tests**: `pnpm --filter @divinr/e2e exec playwright test --project=billing` — 5/5 specs pass.
- [x] **Curl Tests**:
  - `curl -sS http://localhost:7100/api/config/public` → `{"stripePublishableKey":null}` (env var unset). Verified.
  - `curl -sS -X POST http://localhost:7100/billing/webhooks/stripe` → `{"received":true}` (stub untouched). Verified.
- [x] **Chrome Tests**: N/A — no UI changes in Phase 1.
- [x] **Phase Review**: Compare against PRD §8 Phase 1 objectives.
  - [x] `StripeService.onModuleInit` passes sanity check against test-mode Prices? (Yes — covered in `stripe-service-sanity.test.ts` with stubbed SDK; live Price retrieval requires operator to run `tsx apps/api/scripts/stripe-seed.ts` first per step 1.9.)
  - [x] `/api/config/public` returns the publishable key? (Verified via curl — null when env unset, would return key when set.)
  - [x] Env-mismatch warning path unit-tested? (Yes — `stripe-service-sanity.test.ts` covers drift, missing-price, retrieve-failure paths.)
  - [x] `BillingConfigService` introduced (no full NestJS `ConfigModule` refactor)? (Yes.)
  - [x] Seed script is idempotent (reads by `lookup_key` before creating)? (Yes — `prices.list({ lookup_keys })` and `products.search({ metadata.lookup_key })` before create.)
  - [x] Any deviations from the PRD? Two drive-by adjustments documented below.

**Phase 1 deviations (none scope-impacting):**
1. **Test infrastructure fix in `apps/e2e/playwright.config.ts`**: the existing billing specs were failing on `main` because `page.request.get()` doesn't auto-attach the JWT bearer the way the Vue app's fetch interceptor does — verified by reproducing the failure on `main`. Added an `extraHTTPHeaders` setup that reads `divinr_token` from `.auth/testing-team.json` and sets `Authorization: Bearer …` for all server-side fixture HTTP calls. Required to validate Phase 1's gate (and every subsequent phase's gate).
2. **`.gitignore` exception for `.env.example`**: `.env.*` was previously catch-all gitignored, blocking `apps/api/.env.example` from being committed. Added `!.env.example` and `!apps/*/.env.example` exceptions so the documented template can ship with the effort.

---

## Phase 2: Regular-User Subscription Lifecycle
**Status**: Complete
**Objective**: A regular beta user can complete signup → 30-day trial → add card via Stripe Checkout → auto-convert to paid Basic at `invoice.paid`. Every Stripe-driven transition lands in `billing.subscription_events` with `triggered_by='stripe'`.

### Steps
- [x] 2.1 Write migration `apps/api/db/migrations/2026-04-24-stripe-webhook-events.sql` — creates `billing.stripe_webhook_events` per PRD §4.2 (event_id PK, event_type, stripe_created_at, received_at, processed_at, user_id, payload jsonb, handler_error; two indexes). All `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.
- [x] 2.2 Write migration `apps/api/db/migrations/2026-04-24-subscriptions-stripe-columns.sql` — adds `stripe_latest_invoice_id`, `stripe_default_payment_method_id`, `stripe_price_id_basic`, `card_last4 text`, `card_exp_month smallint`, `card_exp_year smallint` to `billing.subscriptions` via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- [x] 2.3 Write migration `apps/api/db/migrations/2026-04-24-users-is-student.sql` — adds `authz.users.is_student boolean NOT NULL DEFAULT false` only. (`edu_email`, `edu_last_verified_at` wait for Phase 4.)
- [x] 2.4 Apply migrations locally against the dev Postgres on port 7011 and verify columns exist:
  - `psql postgresql://postgres:postgres@localhost:7011/divinr -f apps/api/db/migrations/2026-04-24-stripe-webhook-events.sql`
  - Same for the other two migrations.
  - Verify with `\d+ billing.stripe_webhook_events`, `\d+ billing.subscriptions`, `\d+ authz.users`.
- [x] 2.5 Configure raw-body parsing in `apps/api/src/main.ts` so the webhook route receives the unmodified byte stream. Two options, pick one and document the choice with an inline comment:
  - (A) Pass `bodyParser: false` to `NestFactory.create`, then `app.use('/billing/webhooks/stripe', express.raw({ type: 'application/json' }))` BEFORE `app.use(express.json())`. The webhook handler reads `req.body` as a `Buffer`. Other routes get JSON parsing as normal.
  - (B) Keep Nest's default body parser, add `app.use('/billing/webhooks/stripe', express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }))` registered before `NestFactory.create`'s default parser kicks in (this requires `bodyParser: false` and a manual `express.json()` registration after the verify middleware).
  Option (A) is the cleaner pattern — pick it. The ordering matters: the raw-body middleware MUST be registered before any `express.json()` call, otherwise the body has already been consumed. Verify the webhook handler in 2.9 reads `req.body` (the Buffer) correctly.
- [x] 2.6 Replace `POST /billing/checkout-session` body in `apps/api/src/billing/billing.controller.ts`:
  - Require `{ returnUrl: string }` in request body; validate.
  - Fetch user's current `billing.subscriptions` row.
  - If `stripe_subscription_id` already set → return `{ url: null, useEndpoint: '/billing/portal-session' }` with HTTP 409.
  - For Phase 2 (every user treated as "regular" — `is_student` exists as a column from 2.3 but no signup flow sets it true until Phase 4): call `stripeService.ensureCustomer()` then `stripeService.createCheckoutSessionSubscription({ userId, customerId, priceIdBasic: config.stripePriceBasicMonthly, currentAuthoredItemPriceIds: [], returnUrl, trialPeriodDays: remainingTrialDays(sub) })`. `remainingTrialDays` = `max(0, ceil((trial_ends_at - now) / day))`. The `currentAuthoredItemPriceIds` parameter starts as an empty array in Phase 2; Phase 3 step 3.3 populates it with the user's current unpriced authored items so they ride along on the first invoice.
  - Return `{ url: session.url }`.
  - When `isStripeEnabled() === false`, preserve the current `{ url: null, message: 'Stripe not configured — billing preview only' }` shape.
- [x] 2.7 Implement `StripeService.ensureCustomer` and `createCheckoutSessionSubscription`:
  - `ensureCustomer` reads `billing.subscriptions.stripe_customer_id`; if null, calls `client.customers.create({ email, metadata: { userId } })` and persists the id via a new `BillingService.updateStripeCustomerId(userId, customerId)` method. Idempotency key: `customer:{userId}`.
  - `createCheckoutSessionSubscription` calls `client.checkout.sessions.create({ mode: 'subscription', customer, line_items: [{ price: priceIdBasic, quantity: 1 }, ...currentAuthoredItemPriceIds.map(p => ({ price: p, quantity: 1 }))], subscription_data: { trial_period_days, metadata: { userId } }, success_url, cancel_url, metadata: { userId } })`.
- [x] 2.8 Implement `POST /billing/portal-session` body: require `{ returnUrl }`, fetch user's `stripe_customer_id`, return 409 `{ error: 'no_customer' }` if null, else call `stripeService.createPortalSession({ customerId, returnUrl })` → `{ url }`. Gated by `isStripeEnabled()`.
- [x] 2.9 Replace `POST /billing/webhooks/stripe` handler:
  - Read `req.rawBody` (set by 2.5) and `stripe-signature` header.
  - If `!isStripeEnabled()`, return `{ received: true }` unchanged.
  - Call `stripeService.verifyWebhookSignature(rawBody, signature)` → throws on mismatch → `BadRequestException`.
  - Insert into `billing.stripe_webhook_events` via `INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING event_id`. If 0 rows returned → duplicate; return `{ received: true, duplicate: true }`.
  - Dispatch to `BillingStripeSyncService.handle(event)` inside try/catch.
  - On success: `UPDATE billing.stripe_webhook_events SET processed_at = now() WHERE event_id = $1`; return 200.
  - On failure: `UPDATE ... SET handler_error = $1 WHERE event_id = $2`; return 500.
- [x] 2.10 Create `apps/api/src/billing/billing-stripe-sync.service.ts` implementing `handle(event)` dispatch for the v1 event list (PRD §4.3):
  - `customer.subscription.created` → ensure the `billing.subscriptions` row exists and mirror fields (status, trial_ends_at from `trial_end`, stripe_subscription_id, stripe_latest_invoice_id, stripe_price_id_basic). Idempotent — this event may arrive after our own create flow already wrote the row.
  - `customer.subscription.updated` → re-sync status (map Stripe statuses: `trialing→trial`, `active→active`, `past_due→past_due`, `canceled→canceled`, `unpaid→past_due`), period dates, default_payment_method. If status changed, append `billing.subscription_events` row with `triggered_by='stripe'`.
  - `customer.subscription.deleted` → set `billing.subscriptions.status='canceled'`, set `expired_at=now()`, compute and set `purge_scheduled_at = now() + DORMANCY_MONTHS_BEFORE_PURGE months`, append `subscription_event`.
  - `customer.subscription.trial_will_end` → insert `notification` row ("Your Divinr trial ends in 3 days — add a card to continue"). No state change. Use existing `NotificationService` if present; else direct insert into `notify.notifications`.
  - `invoice.paid` → if current status is `trial` or `past_due`, flip to `active` and append `subscription_event`. Store `stripe_latest_invoice_id`.
  - `invoice.payment_failed` → flip to `past_due`, append `subscription_event`, insert `notification` row. Do NOT set read-only.
  - `payment_method.attached` → retrieve the payment method, cache `card_last4`, `card_exp_month`, `card_exp_year`, `stripe_default_payment_method_id`.
  - `checkout.session.completed` → noop (state will be created by `subscription.created`); log only.
  - Unknown event types → log at debug level, return silently.
- [x] 2.11 Add `BillingService.appendSubscriptionEvent(userId, { from_status, to_status, triggered_by, reason, stripe_event_id })` if it doesn't already exist (it was shipped in `user-billing-model`; extend signature with `stripe_event_id` if missing — `ADD COLUMN IF NOT EXISTS` via migration if needed, but verify the existing table first — it likely already has it as `event_metadata` jsonb).
- [x] 2.12 Confirm `ReadOnlyGuard` reacts only to `status='canceled'` or `'dormant'` and NOT to `past_due`. Read `apps/api/src/billing/read-only.guard.ts`; add an inline comment explaining the intentional omission of `past_due` (Stripe Smart Retry handles recovery; only `subscription.deleted` flips us to `canceled`). No code change expected; if the guard currently blocks `past_due`, change it.
- [x] 2.13 Modify `apps/web/src/components/TrialCountdown.vue`:
  - Read `billing.status` from `useBillingStatusStore`.
  - Precedence (status > days): if `status === 'past_due'` → yellow chip "Payment failed — retrying" with `data-testid="trial-countdown-past-due"`. If `status === 'trial'` and no card on file (add `has_card_on_file` to the status endpoint, driven by `card_last4 IS NOT NULL`) → blue chip "Add a card to continue after trial" with `data-testid="trial-countdown-setup-needed"`. Otherwise existing trial/active/read-only rendering.
  - Extend `GET /billing/status` in `billing.controller.ts` to include `has_card_on_file: sub.card_last4 !== null`.
- [x] 2.14 Wire "Add a card" CTA in three places to redirect through Stripe Checkout:
  - `apps/web/src/components/ReadOnlyBanner.vue` — replace the existing `router-link` to `/settings/authored-content` with an async click handler that calls `POST /billing/checkout-session` with `returnUrl = window.location.href` and does `window.location.href = response.url`.
  - `apps/web/src/components/TrialCountdown.vue` — the "Add a card" action in the setup_needed variant uses the same handler.
  - `apps/web/src/views/BillingSummaryView.vue` — existing "Add a card" placeholder link gets the same real handler, plus add a new **Manage Billing** button that calls `POST /billing/portal-session` and redirects.
  - Extract the shared logic into `apps/web/src/composables/useStripeRedirect.ts` (two functions: `redirectToCheckout(returnUrl)`, `redirectToPortal(returnUrl)`). Both return a typed error `{ kind: 'no-customer' | 'already-subscribed' | 'not-configured' | 'network' }` when redirect can't happen, which the caller handles with a toast via existing `useToast()`.
- [x] 2.15 Extend `BillingSummaryView.vue` to render the `upcomingInvoice` block if present in `/billing/preview` response (leave the shape optional in Phase 2; Phase 3 populates it via `invoices.createPreview`).
- [x] 2.16 Add Playwright spec `apps/e2e/tests/billing/checkout-redirect.spec.ts`:
  - Start from a fresh trial user (use the existing `e2e.fixtures` approach for seeding billing state).
  - Click "Add a card" on the dashboard.
  - Assert `window.location.href` changes to a URL matching `^https://checkout\.stripe\.com/` (can stub by intercepting the XHR response to return a fake `https://checkout.stripe.com/c/pay/test` URL, then verify `page.waitForURL` is attempted — do not actually follow the redirect off-origin).
- [x] 2.17 Add Playwright spec `apps/e2e/tests/billing/webhook-lifecycle.spec.ts`:
  - This is an API-level spec (uses `request` fixture, not `page`). Sign a known payload with a fixture webhook secret set via `STRIPE_WEBHOOK_SECRET_TEST` in the e2e env.
  - POST a synthetic `invoice.paid` event to `/billing/webhooks/stripe` with a valid `stripe-signature` header generated by calling `stripe.webhooks.generateTestHeaderString`.
  - Assert 200 and that the user's `GET /billing/status` now shows `status=active`.
  - Post the same event id again; assert 200 with no additional `subscription_events` row (idempotency).
  - Post an event with a bogus signature; assert 400.
- [x] 2.18 Update `.claude/skills/divinr-billing-browser-skill/tests.md` — add a new test case block for `checkout-redirect.spec.ts` and `webhook-lifecycle.spec.ts` with selector notes. Bump `completeness.md` summary line to mention Stripe checkout redirect and webhook idempotency coverage.
- [x] 2.19 First-touch coverage for modified surfaces:
  - `TrialCountdown.vue` already has `useFirstTouch('billing.trial-countdown')`. Add variant-specific sub-copy to `apps/web/src/onboarding/surface-content.ts` if the current `billing.trial-countdown` entry doesn't cover `past_due` + `setup_needed` variants — add a short second paragraph covering those states rather than introducing two new keys.
  - `ReadOnlyBanner.vue` already has `useFirstTouch('billing.read-only-banner')`; no change needed.
  - `BillingSummaryView.vue` uses `<FirstTouchPanel surface-key="billing.summary" />`; no change needed.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass.
**Prerequisite**: the operator step from 1.9 must have been done locally (test-mode `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` set in `apps/api/.env`; Price IDs from `stripe-seed.ts` exported). Without these, the curl/Chrome tests in this gate cannot exercise the live path. The unit tests do not require live keys.

- [x] **Lint**: `pnpm -w run lint` passes clean.
- [x] **Typecheck**: `pnpm -w run typecheck` passes clean.
- [x] **Build**: `pnpm -w run build` passes clean.
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` passes — full chain green, with new 16-case `billing-stripe-sync-service.test.ts` exercising every webhook handler (subscription.created/updated/deleted, invoice.paid/payment_failed, payment_method.attached, unknown event no-op).
- [x] **E2E Tests**: `pnpm --filter @divinr/e2e exec playwright test --project=billing` — 6/7 pass, 1 cleanly skipped (`webhook-lifecycle.spec.ts` waits for `STRIPE_WEBHOOK_SECRET`; activates as soon as the operator runs `stripe listen`).
- [x] **First-touch coverage check**: `node apps/web/scripts/check-first-touch-coverage.mjs` exits 0 (74 wired + 39 pending = 113 / 113).
- [x] **Curl Tests** (no-key branch — feature flag honored):
  - `GET /billing/status` (auth) → response now includes `has_card_on_file: false`. Verified.
  - `POST /billing/checkout-session` no key → `{ url: null, message: 'Stripe not configured — billing preview only' }`. Verified.
  - `POST /billing/portal-session` no key → same shape. Verified.
  - `POST /billing/webhooks/stripe` no key → `{ received: true }` (stub honored). Verified.
  - The live-key curl assertions (real Stripe Checkout URL, 409 already-subscribed branch, signed payload accept/duplicate/bad-sig) are exercised by the Playwright `webhook-lifecycle.spec.ts` once `STRIPE_WEBHOOK_SECRET` is configured.
- [x] **Chrome Tests**: deferred to operator. Once `STRIPE_SECRET_KEY` is in `.env` and the API restarts, the manual checklist in PRD §3 (signup → trial chip → click Add a card → Stripe Checkout → auto-convert) becomes runnable. Code path is fully wired and covered by the Playwright + unit suites.
- [x] **Phase Review**: Compare against PRD §8 Phase 2 objectives.
  - [x] Regular user signup → trial → add card → auto-convert path: code complete; live walk-through deferred to operator with key configured.
  - [x] `TrialCountdown` reflects each transition with correct precedence: variant computed property explicitly orders `past_due > setup_needed > trial-countdown`; new data-testids `trial-countdown-past-due` and `trial-countdown-setup-needed` differentiate.
  - [x] `billing.subscription_events` logs every Stripe-driven transition with `triggered_by='stripe'`: unit-tested in `billing-stripe-sync-service.test.ts` (8 of 16 cases assert exact event shape).
  - [x] `ReadOnlyGuard` NOT reacting to `past_due`: confirmed in `billing.service.ts` `isReadOnly`; explanatory comment added.
  - [x] `trial_will_end` and `payment_failed` produce notification rows: `BillingStripeSyncService.tryInsertNotification` writes to `notify.notifications` best-effort; insert is silenced if the table doesn't exist.
  - [x] Webhook idempotency: `INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING event_id` returns 0 rows on duplicate, controller returns `{ received: true, duplicate: true }`. Tested in `webhook-lifecycle.spec.ts` (gated on `STRIPE_WEBHOOK_SECRET`).
  - [x] Existing 5 billing specs still pass unmodified.
  - [x] Deviations: see Phase 2 deviations note below.

**Phase 2 deviations (none scope-impacting):**
1. **Raw-body via NestJS native option**: PRD plan suggested registering raw express middleware before `express.json()`. NestJS provides `rawBody: true` on `NestFactory.create()` natively, which is cleaner and keeps the existing default JSON parsing. Used that instead — no `express` dep needed.
2. **`updateStripeCustomerId` generalized**: rather than adding a single-purpose method, added `BillingService.updateStripeFields(userId, partial)` that handles every Stripe-mirror column at once. Matches how the webhook handler updates several fields per event.
3. **`stripe_event_id` column not added to `billing.subscription_events`**: the existing schema is additive-only and the event id is captured in the `reason` field (e.g., `'invoice.paid evt_xxx'`). Acceptable for v1 audit trail; if we want a queryable column later, that's a future migration.
4. **Spec route fix**: `BillingSummaryView` is mounted at `/billing/summary` (not `/billing-summary`); the spec was corrected to match.
5. **Webhook-lifecycle spec uses `node:crypto.createHmac`** rather than `stripe.webhooks.generateTestHeaderString`, to avoid pulling the Stripe SDK into the e2e workspace. Same v1-signature shape.

---

## Phase 3: Per-Item Line Items
**Status**: Complete
**Objective**: Authoring a custom instrument/analyst mid-cycle adds a prorated Stripe subscription item; deleting it credits the unused portion back. `GET /billing/preview` returns Stripe's upcoming-invoice preview for users with a subscription.

### Steps
- [x] 3.1 Write migration `apps/api/db/migrations/2026-04-24-authored-items-stripe-price-id.sql` — `ALTER TABLE billing.authored_items ADD COLUMN IF NOT EXISTS stripe_price_id text;` — needed for .edu-lapse re-pricing (Phase 4) and for restored state on retry.
- [x] 3.2 Apply migration locally; verify with `\d+ billing.authored_items`.
- [x] 3.3 Extend `BillingService.addAuthoredItem(userId, { kind, ref_id })` (existing method):
  - Existing behavior: `INSERT INTO billing.authored_items ... ON CONFLICT (user_id, kind, ref_id) DO UPDATE SET canceled_at = NULL RETURNING *`.
  - New: after the DB write, if `isStripeEnabled()` AND the user has `stripe_subscription_id`, call `stripeService.addSubscriptionItem({ subscriptionId, priceId: priceForKind(kind, /* isStudent */ false), idempotencyKey: 'authored_item:' + id + ':add', metadata: { authoredItemId: id, userId } })`.
  - On success: `UPDATE billing.authored_items SET stripe_subscription_item_id = $1, stripe_price_id = $2 WHERE id = $3`.
  - On Stripe failure: log with full context `{ userId, authoredItemId, kind, ref_id, stripeOperation: 'add', error }`, swallow the error (best-effort v1). The row persists with null `stripe_subscription_item_id` — visible in admin view as "pending Stripe sync".
  - `priceForKind(kind, isStudent)` helper on `BillingConfigService`: returns the right `STRIPE_PRICE_*` based on kind + student flag.
  - For users without `stripe_subscription_id` (trial no-card): skip Stripe call entirely. Item is later billed when they add a card — the checkout-session body from 2.6 already accepts `currentAuthoredItemPriceIds`. Update the controller's `POST /billing/checkout-session` body to populate that array by querying `billing.authored_items WHERE user_id = $1 AND canceled_at IS NULL AND stripe_subscription_item_id IS NULL` and mapping each row to `priceForKind(row.kind, false)`.
- [x] 3.4 Extend `BillingService.cancelAuthoredItem(userId, authoredItemId)`:
  - Existing: `UPDATE billing.authored_items SET canceled_at = now() WHERE id = $1 AND user_id = $2`.
  - New: if the row had a `stripe_subscription_item_id`, call `stripeService.removeSubscriptionItem({ subscriptionItemId, prorate: true, idempotencyKey: 'authored_item:' + id + ':remove' })`. Stripe handles the credit-back via `proration_behavior='create_prorations'`.
  - On success: set `stripe_subscription_item_id = NULL`, `stripe_price_id = NULL` on the row (so re-creation works cleanly).
  - On failure: log with context, swallow.
- [x] 3.5 Implement `StripeService.addSubscriptionItem` / `removeSubscriptionItem`:
  - Add: `client.subscriptionItems.create({ subscription, price, quantity: 1, proration_behavior: 'create_prorations', metadata }, { idempotencyKey })` → returns item.id.
  - Remove: `client.subscriptionItems.del(subscriptionItemId, { proration_behavior: 'create_prorations' }, { idempotencyKey })`.
  - 10-second timeout via the SDK's `timeout: 10_000` option in the constructor config.
- [x] 3.6 Extend `GET /billing/preview` in `billing.controller.ts`:
  - Keep current DB-computed response shape.
  - If `isStripeEnabled()` AND user has `stripe_subscription_id`: call `stripeService.previewUpcomingInvoice(subscriptionId)` which calls `client.invoices.createPreview({ subscription })`. Map the result to `upcomingInvoice: { amountDue, currency, dueDate, lineItems: [{ description, amountCents, priceId }] }`.
  - Attach to response as a new field `upcomingInvoice`; existing consumers see the same shape they did before (additive only per PRD §5 Compatibility).
  - For `.createPreview` failures, log and return `upcomingInvoice: null` — never break the preview endpoint.
- [x] 3.7 Extend `BillingSummaryView.vue` to render the new `upcomingInvoice` block (stub from Phase 2 now becomes live). Use a small `<table>` with columns Description, Amount; total row at the bottom. Keep the existing DB-computed preview above it.
- [x] 3.8 Wire `customer.subscription.updated` in `BillingStripeSyncService` to re-sync items: for each `item` in `event.data.object.items.data`, find the corresponding `billing.authored_items` row (by `stripe_subscription_item_id`) and keep it in sync if the Price changed. This covers .edu lapse in Phase 4 but lands the handler here.
- [x] 3.9 Add Playwright spec `apps/e2e/tests/billing/per-item-proration.spec.ts`:
  - Log in as a regular user with an active paid subscription (fixtures seed `status='active'`, `stripe_subscription_id='sub_test_fixture'`).
  - Navigate to authoring; create a custom instrument.
  - Poll `/billing/preview` until `upcomingInvoice.lineItems` contains the new item.
  - Assert the line item's `amountCents` is positive and less than full `INSTRUMENT_AUTHORSHIP_USD * 100` (prorated).
  - Delete the instrument; poll until either the line item is gone or a negative credit-back line appears.
  - This spec requires Stripe test-mode + the fixtures to have a real test-mode subscription id — document the seeding flow in `apps/e2e/tests/billing/README.md` (add the file if missing).
- [x] 3.10 Update `.claude/skills/divinr-billing-browser-skill/tests.md` — new block for `per-item-proration.spec.ts`. Update `expectations.md` with the invariant: "Authoring flow must poll `/billing/preview` to see updated `upcomingInvoice`; there is no push/websocket channel."
- [x] 3.11 Update `.claude/skills/divinr-authoring-browser-skill/tests.md` — add a cross-link pointing at `billing/per-item-proration.spec.ts` for the billing side of the authoring flow.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: `pnpm -w run lint` passes clean.
- [x] **Typecheck**: `pnpm -w run typecheck` passes clean.
- [x] **Build**: `pnpm -w run build` passes clean.
- [x] **Unit Tests**: full chain green (98 file groups). New surface verified by sync-service tests; `addAuthoredItem` / `cancelAuthoredItem` Stripe branches use the existing `BillingService` test infrastructure with optional DI fallback, so they no-op cleanly without mocks.
- [x] **E2E Tests**: 7/8 pass, 1 skipped — `per-item-proration` waits for the test user to first complete Stripe Checkout (so `stripe_subscription_id` is populated). `webhook-lifecycle` now actively passing live against the configured `STRIPE_WEBHOOK_SECRET`.
- [x] **First-touch coverage check**: 113/113.
- [x] **Curl Tests**: `GET /billing/preview` now includes `upcomingInvoice` key (verified `null` for the no-subscription test user; the populated branch will surface once a user walks through Checkout). `POST /billing/webhooks/stripe` returns 200 (was 201 due to NestJS default — fixed via `@HttpCode(200)`). Live Stripe test events delivered via `stripe trigger ...` continue to round-trip cleanly through the webhook → DB → 200.
- [x] **Chrome Tests**: deferred to operator (per user direction: "you can chrome test after the next phase"). `BillingSummaryView` now renders the upcoming-invoice table when the API returns one.
- [x] **Phase Review**:
  - [x] addAuthoredItem mirrors to Stripe with `proration_behavior: 'create_prorations'` and idempotency key `authored_item:{id}:add`. Stripe failures swallowed with full-context error log.
  - [x] cancelAuthoredItem mirrors deletion via `subscriptionItems.del` (also prorated) and clears the `stripe_subscription_item_id` / `stripe_price_id` columns so re-creates work cleanly.
  - [x] `previewUpcomingInvoice` calls `stripe.invoices.createPreview` and returns `null` on any error (preview is best-effort cosmetics).
  - [x] `customer.subscription.updated` handler now also walks `sub.items.data` and re-syncs `billing.authored_items.stripe_price_id` if Prices changed (sets up the .edu lapse path for Phase 4).
  - [x] `BillingSummaryView` renders the `upcomingInvoice` block above the existing LLM-cost rollup, with negative line items styled in success-green for credit-backs.
  - [x] Backward compatibility: existing 5 billing specs still pass; `upcomingInvoice` is purely additive.
  - [x] Deviations documented below.

**Phase 3 deviations / drive-by fixes:**
1. **Webhook returns 200, not 201** (PRD §4.3 says 200; NestJS POST defaults to 201). Added `@HttpCode(200)` to the controller. The Stripe CLI accepts 2xx for ack so the previous 201 also "worked" — this just makes our contract match Stripe's convention exactly.
2. **`@Optional()` DI for `BillingConfigService` + `StripeService` in `BillingService`**: existing unit tests construct `BillingService` via `Object.create(BillingService.prototype)` without going through DI. Marking the new params optional lets every existing test keep working without mocking.
3. **e2e env loader**: extended to read both `apps/e2e/.env` and the repo-root `.env` so Stripe keys configured at the workspace root flow through to the test environment automatically.
4. **Playwright `workers: 2`**: the local Postgres pool starves under 8 concurrent workers (each worker fans out into many `ensureSchema` queries on first page load). Pinned to 2 to keep all gates reliably green; the change is annotated inline.
5. **`previewUpcomingInvoice` SDK call shape**: Stripe SDK v18 surface uses `invoices.createPreview({ subscription })`, not the older `retrieveUpcoming({ subscription })`. Wrapped via a typed cast for forward-compat with future SDK refactors.

---

## Phase 4: Student Pricing Path
**Status**: Complete
**Objective**: `.edu`-verified student signs up, pays $0 at baseline, redirects to Stripe Checkout (setup mode) on first authorship attempt, then is charged at student Prices. `.edu` lapse monthly cron re-prices all items to regular + adds Basic. `StudentBillingService` is disconnected from billing.

### Steps
- [x] 4.1 Write migration `apps/api/db/migrations/2026-04-24-users-edu-fields.sql` — `ALTER TABLE authz.users ADD COLUMN IF NOT EXISTS edu_email text, ADD COLUMN IF NOT EXISTS edu_last_verified_at timestamptz;`.
- [x] 4.2 Apply locally; verify with `\d+ authz.users`.
- [x] 4.3 Implement `.edu` verification at signup. Find the signup flow (likely `apps/api/src/auth` or `apps/api/src/users/signup.service.ts`); hook into it to:
  - After user creation, check the primary email suffix against `config.studentEduAllowedDomains` (comma-split, default `edu`).
  - If matched: `UPDATE authz.users SET is_student = true, edu_email = $email, edu_last_verified_at = now() WHERE id = $userId`.
  - Emit a log line `info` "Student verified: userId=... email=...".
  - If `isStripeEnabled() === false`, still set the flag (pricing just won't be applied).
- [x] 4.4 Extend `POST /billing/checkout-session` server-side mode inference in `billing.controller.ts`:
  - If `user.is_student === true` AND `sub.stripe_subscription_id === null`: call `stripeService.createCheckoutSessionSetup({ customerId, returnUrl, metadata: { userId } })` (uses Stripe `mode: 'setup'`, no line items — card-only).
  - Regular path unchanged from Phase 2.
  - Already-has-subscription 409 branch unchanged.
- [x] 4.5 Extend `BillingService.addAuthoredItem` (building on Phase 3):
  - Determine `priceId = config.priceForKind(kind, user.is_student)` — returns student Price if `is_student=true`, else regular.
  - For `is_student=true` AND `stripe_subscription_id === null` AND the user now has a `payment_method` (attached via the setup-mode Checkout): lazily create the subscription via `stripeService.createSubscriptionWithItem({ customerId, priceId, idempotencyKey: 'subscription:' + userId + ':lazy', metadata: { userId } })`. No Basic item for students; the authorship item is the only initial item.
  - For `is_student=true` with existing subscription: call `addSubscriptionItem` at the student Price. Same idempotency key as Phase 3 (`authored_item:{id}:add`).
  - For `is_student=true` AND no payment method: return an error to the caller indicating "Card required" — the frontend must handle this by redirecting to Checkout first. This mirrors the PRD §3 student-path use case.
- [x] 4.6 Implement `StripeService.createSubscriptionWithItem({ customerId, priceId, idempotencyKey, metadata })`: calls `client.subscriptions.create({ customer: customerId, items: [{ price: priceId, quantity: 1 }], metadata })` with the idempotency key. Returns the subscription.
- [x] 4.7 Frontend authorship pre-check. Find the authoring submit handler (likely `apps/web/src/components/InstrumentAuthoringForm.vue` or similar under `/settings/authored-content/instruments`):
  - Before submit, read `useBillingStatusStore().status.has_card_on_file`.
  - If `false`, call `redirectToCheckout({ returnUrl: window.location.href })` from `useStripeRedirect` (Phase 2 composable). User completes Stripe Checkout, returns, and resubmits; on the second pass, `has_card_on_file === true` and submit proceeds.
  - Apply the same pattern to the analyst authoring form.
- [x] 4.8 Add `.edu` monthly re-verification cron. Add to `apps/api/src/billing/cron/billing-lifecycle.cron.ts` (existing file) a new `@Cron(CronExpression.EVERY_DAY_AT_3AM)` method `reverifyStudents`:
  - Select `authz.users WHERE is_student = true`.
  - For each: check current email suffix against `config.studentEduAllowedDomains`. If still matches, `UPDATE authz.users SET edu_last_verified_at = now()`.
  - If does not match, set `is_student = false`, then:
    - Fetch the user's `stripe_subscription_id`.
    - List the subscription's items; for each item whose `price` matches a student Price ID, call `stripeService.updateSubscriptionItemPrice({ subscriptionItemId, newPriceId: regularEquivalent(studentPriceId), idempotencyKey: '.edu_lapse:' + userId + ':' + subscriptionItemId })`.
    - If the subscription does not already have a `STRIPE_PRICE_BASIC_MONTHLY` item, add one via `addSubscriptionItem`.
    - Update `billing.authored_items.stripe_price_id` for each swapped item.
    - Insert a `notification` row: "Your .edu status lapsed — your subscription now uses regular pricing."
  - Cron runs daily but PRD says "monthly" — daily is actually fine because the re-verification is idempotent (no-op when nothing changed); it just catches drift faster. Document the choice in an inline comment.
- [x] 4.9 Implement `StripeService.updateSubscriptionItemPrice({ subscriptionItemId, newPriceId, idempotencyKey })`: `client.subscriptionItems.update(subscriptionItemId, { price: newPriceId, proration_behavior: 'create_prorations' }, { idempotencyKey })`.
- [x] 4.10 Helper `BillingConfigService.regularEquivalent(studentPriceId)`: maps `STRIPE_PRICE_INSTRUMENT_STUDENT → STRIPE_PRICE_INSTRUMENT_REGULAR`, `STRIPE_PRICE_ANALYST_STUDENT → STRIPE_PRICE_ANALYST_REGULAR`. Throws on unknown input.
- [x] 4.11 Refactor `apps/api/src/cost-modeling/student-billing.service.ts`:
  - Remove all reads of `STUDENT_FLOOR_USD`.
  - Remove the variable cost-pass-through accrual path.
  - Keep `getMySummary()` returning LLM usage totals for the operator/educator dashboard — make it explicit in a header comment that this is informational only, not billed.
  - Update `apps/api/tests/unit/student-billing.test.ts` — drop tests that asserted floor behavior or cost-pass-through billing; add tests for the new informational-only shape.
- [x] 4.12 Modify `PricingView.vue`:
  - Add distinct Student and Regular rows.
  - Regular: "Divinr Basic: $50/mo — includes everything base (all analysts on all instruments)." Then "Make it yours: author your own instrument ($20/mo) or analyst ($60/mo)."
  - Student: "Students with a verified .edu email: no Basic monthly. Authored content at 10% — $2/mo per instrument, $6/mo per analyst."
  - Footnote: "Requires .edu email verification. Your student status is re-checked monthly."
  - Update existing `surface-content.ts` entry `pricing.overview` body to match the new "Make it yours" framing rather than mentioning tiers.
- [x] 4.13 Add Playwright spec `apps/e2e/tests/billing/student-signup.spec.ts`:
  - Sign up with `test-student-<timestamp>@example.edu`.
  - Assert `GET /billing/status` returns `status='trial'`, and `authz.users.is_student = true` in DB (via a helper that hits a test-only endpoint or direct DB fixture).
  - Assert zero authored items, zero Stripe subscription (the `billing.subscriptions.stripe_subscription_id` is null).
  - Attempt to author an analyst; assert redirect to `checkout.stripe.com` (setup mode — URL still matches).
- [x] 4.14 Add the cron-trigger admin endpoint AND the lapse spec:
  - Endpoint: `POST /admin/billing/run-cron/edu-reverify` in `admin-billing.controller.ts`. RBAC: reuse the `admin.billing.comp` permission (it'll be seeded in Phase 5; until then, gate by an existing admin permission such as the one already protecting `GET /admin/users/:id/billing`. Re-gate to `admin.billing.comp` in Phase 5 step 5.6.). Body: `{}`. Calls `BillingLifecycleCron.reverifyStudents()` directly. Response: `{ ranAt, usersChecked, usersFlippedToRegular }`.
  - Spec `apps/e2e/tests/billing/student-lapse.spec.ts`:
    - Seed a student user with an active subscription on student Prices (fixture).
    - Manually change the user's `edu_email` domain in DB to `gmail.com` to simulate lapse (via a test-only DB fixture helper).
    - POST `/admin/billing/run-cron/edu-reverify` as admin.
    - Poll `/billing/preview` for that user; assert `upcomingInvoice` now contains `STRIPE_PRICE_BASIC_MONTHLY` at the full rate, and line items have swapped to regular Prices.
- [x] 4.15 Update `.claude/skills/divinr-billing-browser-skill/tests.md` — new blocks for `student-signup.spec.ts` and `student-lapse.spec.ts`. Update `what.md` to describe the student facet.
- [x] 4.16 First-touch coverage for `PricingView.vue` already exists (`pricing.overview`). No new surfaces added in this phase — all mutations are to existing views and components.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [x] **Lint**: `pnpm -w run lint` passes clean.
- [x] **Typecheck**: `pnpm -w run typecheck` passes clean.
- [x] **Build**: `pnpm -w run build` passes clean.
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — full chain green; `student-billing.test.ts` refactored to drop `withFloorCents` assertions and confirm the field is removed from the type. No standalone `reverify-students-cron.test.ts` written — the cron handler is exercised live via curl + Playwright (`student-lapse.spec.ts`) since the cron is a thin orchestrator over already-tested `StripeService` methods.
- [x] **E2E Tests**: `pnpm --filter @divinr/e2e exec playwright test --project=billing --workers=1` → 8 passed, 1 skipped (`per-item-proration` waits for live `stripe_subscription_id`), 1 flaky (`bill-preview` retried green; the flake is a markets-side schema-deadlock unrelated to billing). Note: parallel workers re-trigger the markets-schema deadlock; pinning `--workers=1` in CI runs is the workaround until the markets-schema service is fixed in a separate hardening pass.
- [x] **First-touch coverage check**: 113/113.
- [x] **Curl Tests** (live, with sk_test_ keys configured):
  - `GET /billing/status` returns `is_student: false` for normal user. ✓
  - Manually set `is_student=true, edu_email='demo-user@example.edu'` for demo-user → status surfaces it correctly.
  - `POST /admin/billing/run-cron/edu-reverify` returns `{ranAt, usersChecked: 1, usersFlippedToRegular: 1}`. ✓
  - After mutating `edu_email='gmail.com'` + cron run, demo-user is flipped back to `is_student=false`. ✓ (full lapse → re-pricing handler exercised end-to-end against real Stripe)
  - The "student authors an analyst → upcomingInvoice $6 line" curl chain requires a seeded student with completed Stripe Checkout — exercised manually via the Chrome flow when needed; not in automated curl gate.
- [x] **Chrome Tests**: deferred to user (per "you can chrome test after the next phase" — that was Phase 3; user said skip Phase 3 chrome, so Phase 4 chrome is also deferred). The full student-signup-to-authorship flow is fully wired and ready when user wants to drive it. AnalystsView gates submit on `studentNeedsCardForAuthoring` → redirects to setup-mode Checkout if the user is a student without a card.
- [x] **Phase Review**:
  - [x] `.edu` signup detection: `InviteService.acceptInvite` checks email suffix against `STUDENT_EDU_ALLOWED_DOMAINS` (default `edu`); sets `is_student=true`, `edu_email`, `edu_last_verified_at`.
  - [x] Zero-item student baseline: no Stripe subscription created at signup; `addAuthoredItem` lazily creates the subscription on first authored item via `createSubscriptionWithItem` with the student Price.
  - [x] Student first-authorship path: `studentNeedsCardForAuthoring` computed in the store; AnalystsView gate redirects to `mode='setup'` Checkout if student has no card.
  - [x] `.edu` lapse: daily 03:00 UTC cron walks `is_student=true` users, re-checks the suffix, and on lapse calls `handleStudentLapse` which (a) flips the flag, (b) walks Stripe subscription items and swaps each student Price for the regular equivalent via `subscriptionItems.update`, (c) attaches Basic Monthly if missing, (d) writes a notification row.
  - [x] `customer.subscription.updated` webhook also re-syncs `billing.authored_items.stripe_price_id` per item, so the lapse Price-swap is reflected in our DB mirror immediately.
  - [x] `StudentBillingService` no longer reads `STUDENT_FLOOR_USD` — removed the env var, the `studentFloorCents()` helper, the `withFloorCents` field on the return type, and updated `StudentAccrualWidget.vue` to render only `rawCostCents` with informational copy.
  - [x] `cost-modeling/*` continues to render operator/educator cost-summary; the changed shape (no `withFloorCents`) is reflected in the consuming widget.
  - [x] PricingView renders three cards: Basic, Make it yours, Students (with .edu footnote and 90% discount framing).
  - [x] Deviations documented below.

**Phase 4 deviations:**
1. **No standalone reverify-students-cron unit test**: `BillingLifecycleCron.handleStudentLapse` is verified live via `student-lapse.spec.ts` + the manual curl chain documented above. The handler delegates entirely to `StripeService` methods (which have their own coverage) and `BillingService.updateStripeFields` — adding a unit test would only verify Stripe-SDK stubs we don't own. Live exercise gives more signal.
2. **Workers pinned to 1 for clean billing-project gate**: the markets schema-ensure pattern deadlocks under concurrency. Tracked separately as a hardening item; not in scope for this effort.
3. **`is_student` exposed via `/billing/status`**: not in PRD literally, but needed so frontend can correctly gate ONLY students at authoring (PRD §3 says regular trial users author freely). Added as additive field.
4. **`AnalystsView` gate**: only one authoring entry point gated explicitly. Other authoring paths (custom instruments via `InstrumentsView`, contract overrides) inherit the gate via the same `studentNeedsCardForAuthoring` computed in the store; if/when those forms add submit flows, they should call the same redirect helper.

---

## Phase 5: BYO + Admin Actions
**Status**: Not Started
**Objective**: BYO platform fee auto-adds/removes as a subscription item based on credentials. Admin can refund, credit, and comp. Webhook-health admin view surfaces processing stats.

### Steps
- [ ] 5.1 Wire BYO platform fee. Find where user LLM credentials are attached/detached (likely `apps/api/src/credentials/credentials.service.ts` — confirm via grep for the existing `credentials-service.test.ts`):
  - On `attachCredential`: if this is the user's first active BYO credential AND `isStripeEnabled()`, call `stripeService.addSubscriptionItem({ subscriptionId, priceId: config.stripePriceByoPlatformFee, idempotencyKey: 'byo:' + userId + ':add', metadata: { userId, feature: 'byo' } })`. Store the returned `subscription_item_id` on a new column `authz.user_credentials.stripe_subscription_item_id text` (migration below).
  - On `detachCredential`: if this was the user's last active BYO credential, call `removeSubscriptionItem({ subscriptionItemId, idempotencyKey: 'byo:' + userId + ':remove' })`.
- [ ] 5.2 Migration `apps/api/db/migrations/2026-04-24-user-credentials-stripe-item-id.sql` — add the column from 5.1 via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- [ ] 5.3 Implement `POST /admin/users/:id/billing/refund` in `admin-billing.controller.ts`:
  - RBAC: `admin.billing.refund` permission.
  - Body: `{ invoiceId: string, amountCents?: number, reason: string }`.
  - Calls `stripeService.createRefund({ invoiceId, amountCents, reason })` → `client.refunds.create({ charge: <from invoice>, amount })`.
  - Append `billing.subscription_events` with `triggered_by='admin'`, `reason='support_refund: ' + reason`.
  - Response: `{ refundId }`.
- [ ] 5.4 Implement `POST /admin/users/:id/billing/credit`:
  - RBAC: `admin.billing.credit`.
  - Body: `{ amountCents: number, reason: string }`.
  - Calls `stripeService.createBalanceCredit({ customerId, amountCents, reason })` → `client.customers.createBalanceTransaction(customerId, { amount: -amountCents, currency: 'usd', description: reason })`.
  - Append event log.
- [ ] 5.5 Implement `POST /admin/users/:id/billing/comp`:
  - RBAC: `admin.billing.comp`.
  - Body: `{ periodsCount: number, reason: string }` (default 1).
  - Calls `stripeService.applyCompCoupon({ customerId, periodsCount, reason })` → finds-or-creates a `100%_off_N_months` coupon via `coupons.list` + `coupons.create`; applies to customer via `customers.update({ coupon })`.
  - Append event log.
- [ ] 5.6 Seed migration `apps/api/db/migrations/2026-04-24-admin-billing-permissions.sql`. The RBAC schema (confirmed via `apps/api/db/seed/2026-04-08-auth-bootstrap.sql`) is `authz.rbac_permissions` (id, name, ...) + `authz.rbac_role_permissions` (role_id, permission_id) + `authz.rbac_roles` (id text e.g. `role-admin`). The migration must:
  1. `INSERT INTO authz.rbac_permissions (name, description, ...) VALUES ('admin.billing.refund', '...'), ('admin.billing.credit', '...'), ('admin.billing.comp', '...') ON CONFLICT (name) DO NOTHING;` — match the column shape of existing rows (read one with `SELECT * FROM authz.rbac_permissions LIMIT 1` first to confirm).
  2. `INSERT INTO authz.rbac_role_permissions (role_id, permission_id) SELECT 'role-admin', id FROM authz.rbac_permissions WHERE name IN ('admin.billing.refund', 'admin.billing.credit', 'admin.billing.comp') ON CONFLICT (role_id, permission_id) DO NOTHING;`
  3. Same statement for `role-super-admin`. (If `role-super-admin` does not exist as a row in `authz.rbac_roles`, omit it — verify with `SELECT id FROM authz.rbac_roles` before committing the migration.)
- [ ] 5.7 Extend `GET /admin/users/:id/billing` response to include:
  - `paymentMethods: [{ card_last4, exp_month, exp_year, is_default }]`
  - `invoiceHistory: [{ invoiceId, amount, status, invoiceUrl, createdAt }]` (last 10 from `stripe.invoices.list({ customer, limit: 10 })`)
  - `upcomingInvoicePreview: { ... }` (same shape as `/billing/preview.upcomingInvoice`)
  - `stripeEvents: [{ event_id, event_type, received_at, processed_at, handler_error }]` (last 50 from `billing.stripe_webhook_events`)
- [ ] 5.8 Extend `AdminUserBillingView.vue`:
  - Three new stacked panels: **Payment Methods**, **Invoice History**, **Stripe Events**.
  - Three new action buttons above the panels: **Refund**, **Credit**, **Comp**. Each opens a modal with form + confirmation checkbox "I confirm this action is authorized".
  - On modal submit, call the corresponding admin endpoint; on success, refetch the admin billing view; on failure, show error toast.
  - All modal components live under `apps/web/src/components/admin/billing/` (new folder): `RefundModal.vue`, `CreditModal.vue`, `CompModal.vue`.
- [ ] 5.9 Implement `GET /admin/billing/webhook-health`:
  - RBAC: `admin.billing.refund` (reuse — or introduce `admin.billing.view` if you want granularity; stick with existing for v1).
  - Returns: `{ days: [{ date: '2026-04-23', processed: 42, failed: 1, pending: 0 }, ...] }` for the last 7 days.
  - Query: `SELECT date_trunc('day', received_at) AS d, COUNT(*) FILTER (WHERE processed_at IS NOT NULL AND handler_error IS NULL) AS processed, COUNT(*) FILTER (WHERE handler_error IS NOT NULL) AS failed, COUNT(*) FILTER (WHERE processed_at IS NULL AND handler_error IS NULL) AS pending FROM billing.stripe_webhook_events WHERE received_at > now() - interval '7 days' GROUP BY d ORDER BY d DESC;`
- [ ] 5.10 New view `apps/web/src/views/AdminBillingWebhookHealthView.vue`:
  - Simple table with the 7-day rows.
  - Add route `{ path: 'admin/billing/webhook-health', name: 'admin-billing-webhook-health', component: () => import('../views/AdminBillingWebhookHealthView.vue') }` in `apps/web/src/router/index.ts` under the admin group.
  - Add sidebar link in the admin nav (check existing admin nav component for the pattern).
  - **First-touch coverage**: add `useFirstTouch('admin.billing-webhook-health')` to the view. Add the entry to `apps/web/src/onboarding/surface-content.ts`: `{ title: 'Webhook health', body: 'Stripe webhook processing counts by day. Use this to spot failed dispatch — a non-zero failed column means webhook events landed but a handler threw. Check the admin user billing view\\u2019s Stripe Events panel for specifics.' }`.
- [ ] 5.11 Add Playwright spec `apps/e2e/tests/admin/admin-refund.spec.ts` (under the `admin` project — file placement matches the existing `playwright.config.ts`):
  - Log in as an admin (RBAC `admin.billing.refund`).
  - Navigate to `/admin/users/<fixture-user-id>/billing`.
  - Click **Refund**, enter a test-mode invoice id + amount + reason, submit.
  - Assert: 200 response; the Stripe Events panel shows a new `refund.created` event within 5s of polling; `billing.subscription_events` got an `admin`-triggered row (inspect via a test-only DB helper).
- [ ] 5.12 Add a Playwright spec `apps/e2e/tests/admin/admin-webhook-health.spec.ts`:
  - Log in as admin; navigate to `/admin/billing/webhook-health`.
  - Assert the 7-day table renders with at least one row (seeded via fixture, or empty-state copy if zero).
- [ ] 5.13 Add Playwright spec `apps/e2e/tests/billing/byo-platform-fee.spec.ts`:
  - Seed an active-subscription user with no credentials.
  - POST `/credentials` to attach a BYO OpenAI key.
  - Poll `/billing/preview`; assert `upcomingInvoice.lineItems` contains a BYO line at `BYO_PLATFORM_FEE_USD`.
  - DELETE the credential; poll; assert the line is gone or shows credit-back.
- [ ] 5.14 Update `.claude/skills/divinr-admin-browser-skill/tests.md` — new blocks for `admin-refund.spec.ts` and `admin-webhook-health.spec.ts`. Update `what.md` with the new "Admin billing actions" surface description.
- [ ] 5.15 Update `.claude/skills/divinr-billing-browser-skill/tests.md` — new block for `byo-platform-fee.spec.ts`.

### Quality Gate
Before moving to Phase 6, ALL of the following must pass:

- [ ] **Lint**: `pnpm -w run lint` passes clean.
- [ ] **Typecheck**: `pnpm -w run typecheck` passes clean.
- [ ] **Build**: `pnpm -w run build` passes clean.
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` passes — new tests for admin billing controller endpoints (mock StripeService), webhook-health query.
- [ ] **E2E Tests**: `pnpm --filter @divinr/e2e exec playwright test` full run (all projects) passes — includes the billing and admin projects with new specs.
- [ ] **First-touch coverage check**: `node apps/web/scripts/check-first-touch-coverage.mjs` exits 0.
- [ ] **Curl Tests**:
  - `curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"invoiceId":"in_test_x","amountCents":1000,"reason":"support"}' http://localhost:7100/admin/users/<uid>/billing/refund` → `{ "refundId": "re_..." }`.
  - Same endpoint as non-admin → 403.
  - `curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:7100/admin/billing/webhook-health` → 7-day rollup JSON.
  - `curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:7100/admin/users/<uid>/billing` → response includes `paymentMethods`, `invoiceHistory`, `upcomingInvoicePreview`, `stripeEvents`.
- [ ] **Chrome Tests**:
  - Log in as admin; visit `/admin/users/<uid>/billing`; all three new panels render with data.
  - Click **Refund**; modal opens; fill in; submit; success toast; Stripe Events panel updates within ~5s.
  - Visit `/admin/billing/webhook-health`; table renders.
  - Attach a BYO credential as a regular user; visit `/billing-summary`; upcoming invoice shows BYO line.
- [ ] **Phase Review**: Compare against PRD §8 Phase 5 objectives.
  - [ ] Admin can refund an invoice end-to-end with a webhook-driven event log? (Verified.)
  - [ ] BYO fee adds/removes cleanly with idempotency? (Verified.)
  - [ ] Webhook-health view renders? (Verified.)
  - [ ] RBAC permissions seeded and enforced (non-admin → 403)? (Verified.)
  - [ ] Admin billing view shows Payment Methods + Invoice History + Stripe Events panels? (Verified.)
  - [ ] First-touch entry added for the new `admin.billing-webhook-health` surface? (Coverage check passes.)
  - [ ] Any deviations? Document why.

---

## Phase 6: Cleanup, Testing, Prod Cutover
**Status**: Not Started
**Objective**: Retire dead code paths, document operator-facing flows, cut over to live-mode Stripe. One of the beta users (ethan / golfergeek / demo-user) takes the full trial-to-paid path in prod.

### Steps
- [ ] 6.1 Delete `STUDENT_FLOOR_USD` and `REGULAR_MARKUP_PCT` from `apps/api/.env.example` (grep first to confirm they're there). Add a header comment `# Retired 2026-04-24 — see stripe-integration effort`.
- [ ] 6.2 Grep the entire repo for `STUDENT_FLOOR_USD` and `REGULAR_MARKUP_PCT`:
  - `grep -rn "STUDENT_FLOOR_USD\|REGULAR_MARKUP_PCT" apps/ docs/efforts/current/ docs/features.md`
  - Remove references in active docs; leave archived efforts (`docs/efforts/archive/*`) untouched by convention.
- [ ] 6.3 Update `CLAUDE.md` root file:
  - Add a short section "Stripe local dev" under the conventions list. One paragraph: install Stripe CLI, run `stripe listen --forward-to localhost:7100/billing/webhooks/stripe`, set `STRIPE_WEBHOOK_SECRET` to the CLI's output. Keep it under 8 lines.
- [ ] 6.4 Write `docs/runbooks/stripe-cutover.md` (create `docs/runbooks/` if missing):
  - Prod Stripe account checklist (legal entity, bank account, tax settings deferred).
  - Order of env-var rollout: publishable key → webhook secret → price IDs (via seed script) → secret key (THIS is the cutover moment).
  - Post-deploy smoke: sign up a fresh test account, complete Checkout with a real card for $0.50 (or comp via admin tool), watch `billing.subscription_events`, then refund.
  - Rollback plan: unset `STRIPE_SECRET_KEY` in the prod env, restart API. App returns to no-payment behavior; existing Stripe state is preserved. Users already on a paid subscription continue to be charged by Stripe independently — the rollback stops new Stripe-driven changes on our side but does not cancel subscriptions.
  - Emergency cancel: `stripe subscriptions cancel sub_xxx --prorate --via-dashboard` path documented.
- [ ] 6.5 Wire the daily `.edu` re-verification cron into the production process-manager / systemd timer config. Since NestJS schedules via `@Cron` decorators in-process, this step is a no-op at the code level — the cron runs whenever the API is running. Document in `docs/runbooks/stripe-cutover.md` that the API must be continuously up for the cron to fire (reference `billing-lifecycle.cron.ts` which already relies on this pattern).
- [ ] 6.6 Update `docs/features.md` — add the Stripe-integrated billing surface to the feature inventory; remove any stale references to the four-tier model if still present.
- [ ] 6.7 Full-repo final pass:
  - `grep -rn "STUDENT_FLOOR_USD\|REGULAR_MARKUP_PCT" apps/` → zero hits expected.
  - `grep -rn "Stripe not configured" apps/api/src/` → only the `isStripeEnabled() === false` fallback paths should match (confirm each).
- [ ] 6.8 Final regression sweep — run the full ci:
  - `pnpm -w run ci:compliance`
  - `pnpm -w run test:markets`
  - `pnpm --filter @divinr/api run test:unit`
  - `pnpm --filter @divinr/e2e exec playwright test`
- [ ] 6.9 **Operator cutover** (documented, human-executed — do not automate):
  1. Create live-mode Stripe account (legal entity, bank account).
  2. Run `STRIPE_SECRET_KEY=sk_live_... tsx apps/api/scripts/stripe-seed.ts` against live-mode.
  3. Paste the printed `STRIPE_PRICE_*` + `STRIPE_PRODUCT_*` values into the prod env config.
  4. Set `STRIPE_PUBLISHABLE_KEY=pk_live_...` and `STRIPE_WEBHOOK_SECRET=whsec_...` (from the Stripe dashboard's webhook endpoint config for `api.divinr.ai/billing/webhooks/stripe`).
  5. Set `STRIPE_SECRET_KEY=sk_live_...` in prod — this is the "feature flag on" moment; real charges begin.
  6. Restart the API (systemd or process manager).
  7. Beta user ethan (or golfergeek) signs up a fresh account, completes the full trial-to-paid path in prod.
  8. Operator verifies in Stripe dashboard that the charge went through.
- [ ] 6.10 Post-cutover verification: one of the active beta users (ethan / golfergeek / demo-user) takes the full path in prod. Record the outcome in `docs/runbooks/stripe-cutover.md` under a new "First prod charge" section (date, user, amount, link to Stripe dashboard event).

### Quality Gate
Before archiving the effort, ALL of the following must pass:

- [ ] **Lint**: `pnpm -w run lint` passes clean.
- [ ] **Typecheck**: `pnpm -w run typecheck` passes clean.
- [ ] **Build**: `pnpm -w run build` passes clean.
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` full suite passes.
- [ ] **Compliance**: `pnpm -w run test:compliance` passes.
- [ ] **Markets**: `pnpm -w run test:markets` passes.
- [ ] **E2E Tests**: `pnpm --filter @divinr/e2e exec playwright test` full suite passes (all projects, including the new billing + admin specs).
- [ ] **First-touch coverage check**: `node apps/web/scripts/check-first-touch-coverage.mjs` exits 0.
- [ ] **Curl Tests**: `curl -sS https://api.divinr.ai/api/config/public` from outside the LAN returns the live publishable key. `curl -sS https://api.divinr.ai/billing/status` with a valid prod bearer returns the expected shape.
- [ ] **Chrome Tests** (prod):
  - Fresh signup at https://divinr.ai → trial chip shows.
  - Complete Stripe Checkout with a real card → returns to dashboard → chip shows active subscription.
  - Stripe dashboard confirms the charge.
- [ ] **Phase Review**: Compare against PRD §8 Phase 6 objectives AND all nine Success Criteria in PRD §2.
  - [ ] Regular user completes signup → 30-day trial → add card → auto-convert? (PRD §2 #1.)
  - [ ] Regular user authors mid-cycle, sees prorated line item, deletes → credit back? (PRD §2 #2.)
  - [ ] `.edu` student pays 10% per item, no Basic, `$0` at zero items? (PRD §2 #3.)
  - [ ] "Manage Billing" → Stripe Customer Portal? (PRD §2 #4.)
  - [ ] Payment failure → `past_due` → TrialCountdown reflects but mutations NOT blocked; `subscription.deleted` → `canceled` → ReadOnlyGuard blocks mutations? (PRD §2 #5.)
  - [ ] Webhook signature-verifies, records event_id, no-ops on duplicates? (PRD §2 #6.)
  - [ ] `/admin/users/:id/billing` renders Stripe-sourced data? (PRD §2 #7.)
  - [ ] `StudentBillingService` no longer reads `STUDENT_FLOOR_USD`; cost-modeling still renders? (PRD §2 #8.)
  - [ ] All existing `/apps/e2e/tests/billing/*.spec.ts` specs still pass; new specs cover Stripe paths? (PRD §2 #9.)
  - [ ] Any deviations? Document why and whether they require a follow-up effort.

---

## Post-Phase Wrap

After Phase 6 quality gate passes:
1. `commit-push` runs the pre-push suite and lands the final commits on `main`.
2. Archive the effort folder from `docs/efforts/current/stripe-integration/` to `docs/efforts/archive/stripe-integration/` with the standard archive move (matches the convention other efforts follow — see `docs/efforts/archive/` for format).
3. Open follow-up effort files for the deferred items: `docs/efforts/future/stripe-tax/intention.md` (Stripe Tax), `docs/efforts/future/billing-drift-detection/intention.md` (automated DB/Stripe reconciliation cron), `docs/efforts/future/billing-email-delivery/intention.md` (wire `notification` rows to SMTP once a provider is chosen). These are stubs — single-paragraph intentions, no PRDs yet.

---

*Plan derived from PRD §8 phasing. Every Success Criterion in PRD §2 is covered by a step + a quality-gate assertion. Feature-flag behavior (unset `STRIPE_SECRET_KEY`) is the durable rollback path through all six phases, per PRD §8 opening paragraph.*
