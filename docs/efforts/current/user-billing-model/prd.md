# User Billing Model (Single Tier + Per-Item Authorship) — PRD

## 1. Overview

Formalize **Divinr Basic** as the single baseline product shape: every active account is a $50/mo Basic subscriber. Clubs are fully social — zero billing coupling in product, code, or docs. Custom content authorship is an opt-in per-item upgrade ($20/mo per authored instrument, $60/mo per authored analyst) charged on top of Basic. BYO API key authorship carries a flat platform fee. Accounts follow a 30-day trial → active → 6-month read-only expired → purge lifecycle.

This effort owns the **billing model** (policy, domain, enforcement, UX surface, doc reconciliation). It does **not** own the Stripe SDK integration — that is the downstream `stripe-integration` effort, which consumes the contracts defined here. The effort also ships the first-class "silent user" experience: per-user social opt-outs so a $50-only user can be invisible-to and invisible-from every other user.

The billing schema, pricing env vars, and authored-item ownership plumbing are already shipped (`billing.subscriptions`, `billing.authored_items`, `billing.invoice_ledger`, `BillingService`, `BillingTab.vue` preview, `author_user_id` columns, immutability triggers). What remains is: **resolve open policy questions, enforce the lifecycle state machine, ship the silent-user opt-outs, build the pricing/bill UX, reconcile stale strategy docs, and migrate existing users**.

## 2. Goals & Success Criteria

### Goals
1. One user-facing tier: $50/mo Divinr Basic. No Starter/Pro/Premium/Custom tier ladder in product, code, copy, or marketing.
2. Clubs carry zero billing meaning in every layer (DB, API, UI, copy, onboarding).
3. Per-item authorship fees flow onto the monthly bill alongside the $50 Basic charge, itemized clearly.
4. Silent $50-only user is a first-class, fully-supported experience (no forced social surfaces).
5. Account lifecycle (trial → active → expired → purged) is enforced by the platform, not by external billing side effects.
6. Strategy docs and in-repo references match the new model — no orphaned paid-club / multi-tier artifacts.

### Success Criteria (how we know it's done)
- **DB invariant**: `SELECT count(*) FROM billing.subscriptions` equals the count of non-deleted user accounts; every row has a valid `status`.
- **Zero billing coupling in clubs**: `rg -i "club.*(tier|price|billing|paid|quota|entitlement)" apps/ docs/efforts/current docs/efforts/future` returns no hits that describe club-as-billing. (Archived efforts are permitted to retain historical refs.)
- **Coverage**: every active user either (a) has `status IN ('trial', 'active')`, or (b) is read-only gated with a visible UI banner + paywall middleware refusing writes.
- **Itemized bill**: `BillingTab.vue` renders `$50 Basic + {authored items} + {byo platform fee} = total` for a user with ≥1 authored item, matching the `BillingService.getBillingPreview()` payload.
- **Silent-user surface**: a user with all social opt-outs enabled appears in zero member lists, leaderboards, club rosters, tournament rosters, or messaging suggestions across web and API responses.
- **Lifecycle cron proven**: trial-ending, expired-entering-purge-window, and purge jobs run green against seed data with correct email touchpoints emitted.
- **Migration clean**: one-shot migration backfills a `billing.subscriptions` row for every existing account that lacks one, in the correct starting state.
- **Strategy docs reconciled**: `docs/efforts/current/**`, `docs/efforts/future/**`, `docs/features.md`, `docs/efforts/roadmap.md`, `docs/efforts/master-intention.md` contain no contradictions with the single-tier + per-item + social-clubs model. Stale forward-references in shipped efforts (e.g., `learning-clubs` "Next efforts: paid-club-tiers") removed or explicitly annotated as retired.

## 3. User Stories / Use Cases

**US-1: New user signs up and lands on Basic.** A new account is created, a `billing.subscriptions` row is seeded with `status='trial'` and a 30-day `trial_ends_at`, and the user gets full Basic access (base analysts × base instruments × all UI). No club is auto-joined. No upsell prompt.

**US-2: Trial user adds a card.** Card-on-file transitions the user to `status='active'` at trial end (or immediately, depending on Stripe effort). Nothing in this effort changes the user experience — it owns the domain contract Stripe consumes.

**US-3: Trial user does not add a card.** At `trial_ends_at`, the user's subscription transitions to `status='canceled'` (trial-expired). They get read-only access for 6 months. A trial-conversion email fires at trial end. A 30-day-before-purge warning email fires at month 5. After the 6-month window, the account is purged.

**US-4: Basic user authors a custom analyst.** They complete `CreateAnalystWizard.vue`. `BillingService.addAuthoredItem(userId, 'custom_analyst', analystId)` is already invoked (shipped). The `BillingTab.vue` preview now shows a `$60` line item under "Authored Analysts." The user's next bill reflects `$50 + $60 = $110`.

**US-5: Basic user donates a custom analyst to base.** On donation (handled by future `custom-to-base-graduation` effort), `BillingService.cancelAuthoredItem` fires. The `$60` line item disappears on the next bill. This effort only guarantees the line-item lifecycle contract exists; the donation flow itself is out of scope.

**US-6: Basic user turns on BYO API key for a custom analyst.** A `billing.authored_items` row with `item_kind='byo_platform_fee'` is added. The bill shows a single `$10 BYO Platform Fee` line (flat per user, not per-item — resolved below). The user's own provider bills them separately for actual inference.

**US-7: Silent user.** User flips four toggles in Settings → Social: `visible_in_member_lists=false`, `messaging_enabled=false`, `tournament_participation=false`, `leaderboard_visible=false`. They drop out of every discovery surface across the product. They keep full Basic data access. No other user can see them; they receive no social notifications.

**US-8: Existing user on flip-over.** The user-billing-model migration script runs. Every existing user without a `billing.subscriptions` row gets one seeded with `status='trial'` and `trial_ends_at` set 30 days out from the migration date (grandfathered generous trial). Users with existing authored content keep their `billing.authored_items` rows untouched.

**US-9: Admin spot-checks a user's billing picture.** Admin endpoints (already stubbed at `BillingController` and under `/admin/*` surfaces) surface the user's subscription status, authored items, and current bill preview. Full self-service Stripe portal is delivered by `stripe-integration`; this effort only owns the domain read path.

## 4. Technical Requirements

### 4.1 Architecture

The effort sits across three planes:

1. **API (`apps/api/src/billing/`)**: extend `BillingService` with lifecycle enforcement methods, paywall-status computation, and migration helpers. Add a new `SocialOptOutService` under `apps/api/src/users/` (or sibling) that reads/writes the per-user social flags and is called by every social-surface endpoint. Add cron workers (or lightweight scheduled tasks consistent with the existing spark-beta-hardening cron patterns) for trial expiry and purge.
2. **Web (`apps/web/src/`)**: extend `BillingTab.vue` with the itemized monthly-bill view. Add a read-only gate banner component (`ReadOnlyBanner.vue`). Add `SocialOptOutsTab.vue` in Settings. Add `PricingView.vue` for the public pricing page. Surface trial-remaining countdown in the app shell.
3. **Docs**: Reconcile stale references. Update `docs/features.md` if needed. Remove forward-references in shipped efforts to retired efforts.

NestJS DI reminder: every new constructor param must use explicit `@Inject(ClassName)` per CLAUDE.md convention.

### 4.2 Data Model Changes

**Already shipped (no changes needed):**
- `billing.subscriptions` (user_id PK, stripe_*, status enum, trial_started_at, trial_ends_at, current_period_end, timestamps)
- `billing.authored_items` (id, user_id, item_kind, item_id, monthly_usd_cents, stripe_subscription_item_id, status, activated_at, canceled_at)
- `billing.invoice_ledger` (id, user_id, period_start, period_end, amount_usd_cents, status, generated_at)
- Status enum: `'trial' | 'active' | 'past_due' | 'canceled' | 'dormant'`

**New / extended in this effort:**
- `billing.subscriptions` gets two new columns:
  - `expired_at TIMESTAMPTZ NULL` — timestamp at which the user entered the read-only expired window. Set when the lifecycle cron transitions `trial|past_due → canceled` and the user has no card on file.
  - `purge_scheduled_at TIMESTAMPTZ NULL` — `expired_at + interval '6 months'` at the moment of entry. Pre-computed so purge cron can cheap-select.
- `billing.subscription_events` (new table) — append-only audit log of every lifecycle transition. Columns: `id`, `user_id`, `from_status`, `to_status`, `reason` (e.g., `'trial_ended_no_card'`, `'stripe_webhook'`, `'admin_override'`, `'migration_backfill'`), `triggered_by` (`'system' | 'user' | 'admin' | 'stripe'`), `created_at`. Provides forensic trail for billing disputes and the stripe-integration effort downstream.
- **User social opt-out flags**: add columns to the existing user profile table (concretely `public.profiles` or whichever is the current authoritative user-profile surface per `user-scoped-platform`):
  - `social_visible_in_member_lists BOOLEAN NOT NULL DEFAULT true`
  - `social_messaging_enabled BOOLEAN NOT NULL DEFAULT true`
  - `social_tournament_participation BOOLEAN NOT NULL DEFAULT true`
  - `social_leaderboard_visible BOOLEAN NOT NULL DEFAULT true`
  - `social_notifications_enabled BOOLEAN NOT NULL DEFAULT true`
  - Grouped under a single `social_opt_outs` JSONB column is rejected — discrete booleans make filter queries indexable and readable in SQL.
- **No club-billing columns anywhere**. The PRD explicitly prohibits adding any billing/tier/price/quota column to club tables. A DB-level check or repo-level lint is not required (overkill) but the verification phase of the plan will grep for it.

### 4.3 API Changes

**Extended `BillingService` (apps/api/src/billing/billing.service.ts):**
- `computeLifecycleTransitions()` — scans `billing.subscriptions` for users whose `trial_ends_at < now()` and `status = 'trial'`; transitions them. Called by trial-expiry cron.
- `markExpired(userId, reason)` — sets `status='canceled'`, `expired_at=now()`, `purge_scheduled_at=now()+6mo`, writes `subscription_events` row, fires trial-conversion email touchpoint.
- `isReadOnly(userId)` — returns `true` iff `status IN ('canceled', 'dormant')`. Used by gating middleware.
- `computePurgeCandidates()` — scans `billing.subscriptions` for `purge_scheduled_at < now() - 30 days` and fires the 30-day warning email (idempotent — only once per user); for `purge_scheduled_at < now()` schedules the purge.
- `migrateBackfillSubscriptions()` — one-shot: for every user in `auth.users` (or the canonical user source) without a `billing.subscriptions` row, insert a trial row with `trial_ends_at = now() + 30 days` and a `subscription_events` entry with `reason='migration_backfill'`.

**New `SocialOptOutService`:**
- `getOptOuts(userId)` — returns the five booleans.
- `setOptOuts(userId, partialOptOuts)` — upserts.
- `applyVisibilityFilter(query, viewerId)` — helper that wraps member-list / leaderboard / roster queries to exclude users who opted out. Used by: clubs member-list endpoint, tournament roster, `/analysts` owner-visibility, messaging suggestion endpoints, performance-dashboard leaderboards.

**New `ReadOnlyGuard` middleware:**
- Attaches to every POST/PUT/PATCH/DELETE route under `apps/api/src/` except `/billing/checkout-session`, `/billing/portal-session`, and auth flows.
- Rejects with `403 Forbidden { code: 'SUBSCRIPTION_EXPIRED' }` when `BillingService.isReadOnly(userId)` is true.
- Wired via NestJS guard pattern; does **not** block read endpoints (GET).

**Extended `BillingController`:**
- `GET /billing/preview` — already exists; extend to return the full itemized shape including base-line, per-item lines, BYO fee.
- `GET /billing/status` — new; returns `{ status, trial_ends_at, expired_at, purge_scheduled_at, is_read_only, days_until_purge }`. Drives the trial countdown and read-only banner.
- `GET /users/:id/social-opt-outs` / `PATCH /users/:id/social-opt-outs` — the social opt-out endpoints (self-serve only; 403 if `:id !== auth.userId`).

**Admin endpoints (stubs in this effort, deepened by stripe-integration later):**
- `GET /admin/users/:id/billing` — returns `{ subscription, authored_items[], events[], preview }`. Admin-only.

All new endpoints follow the explicit `@Inject(ClassName)` DI convention.

### 4.4 Frontend Changes

**New/extended Vue surfaces (all with `useFirstTouch('<surface-key>')` per CLAUDE.md Definition of Done):**

- **`apps/web/src/views/authored/BillingTab.vue`** — extend existing preview card to render itemized bill:
  - "Divinr Basic" line at $50
  - "Authored Analysts ($60 × N)" rollup, expandable to show per-analyst lines
  - "Authored Instruments ($20 × N)" rollup, expandable to show per-instrument lines
  - "BYO API Key Platform Fee" ($10 flat, conditional)
  - "Monthly Total: $X"
  - Uses "analysis/signal" vocabulary per CLAUDE.md — no "prediction model" copy except in `<LegalDisclaimer variant="full" />`
  - First-touch key: `billing.bill-overview`
- **`apps/web/src/views/settings/SocialOptOutsTab.vue`** — new tab under Settings. Five toggles, each with a plain-English description (e.g., "Hide me from club member lists"). Saves to `/users/:id/social-opt-outs` on change. First-touch key: `settings.social-opt-outs`.
- **`apps/web/src/components/ReadOnlyBanner.vue`** — shown in the app shell when `GET /billing/status.is_read_only === true`. Copy: "Your trial has ended — add a card to continue [verb-verb-verb]. Your data remains accessible until {purge date}." Uses `<LegalDisclaimer variant="short" />` where needed. First-touch key: `billing.read-only-banner`.
- **`apps/web/src/components/TrialCountdown.vue`** — small badge in the app shell while `status='trial'`, showing days remaining. First-touch key: `billing.trial-countdown`.
- **`apps/web/src/views/PricingView.vue`** — public pricing page. Single card: "Divinr Basic — $50/mo. Includes full platform access (analyses, signals, risk debates, reasoning, performance dashboards, clubs). 30-day free trial." Secondary card: "Author custom content — add $20/mo per custom instrument, $60/mo per custom analyst, $10/mo BYO API key add-on." Route at `/pricing`. First-touch key: `pricing.overview`.
- **App shell integration**: `ReadOnlyBanner` rendered when relevant; `TrialCountdown` rendered in header while trial. Both read from a new `useBillingStatusStore` backed by `/billing/status`.

**Copy rules** (CLAUDE.md vocabulary):
- All user-visible labels/copy use "analysis / signal" — never "prediction / advice / recommendation / predictor"
- Disclaimers route through `<LegalDisclaimer>` — five variants already defined; this effort does not add new variants (the existing `short` / `full` / `trade-cta` variants cover billing contexts)
- Per-item authorship copy says "authored custom instrument" / "authored custom analyst", not "custom analysis" (authorship is the action; analysis is the output)

**Surface-content inventory:**
- Add entries for the five new first-touch keys (`billing.bill-overview`, `settings.social-opt-outs`, `billing.read-only-banner`, `billing.trial-countdown`, `pricing.overview`) to `apps/web/src/onboarding/surface-content.ts`
- Run the coverage check (`apps/web/scripts/check-first-touch-coverage.mjs`) as a gate

**Testing coverage:**
- Extend an existing deep testing skill or stub a new one per CLAUDE.md. Candidate existing skills: `divinr-authoring-browser-skill` (covers `/settings/authored-content`, natural home for `BillingTab.vue` changes) and `divinr-workflow-browser-skill` (root; login/fixtures). 
- The pricing page, trial countdown, and read-only banner span the root experience — they fit into a new **`divinr-billing-browser-skill`** deep skill, with a corresponding Playwright project under `apps/e2e/tests/billing/`.
- Minimum green specs: (a) trial user sees countdown; (b) authored-items appear on bill preview; (c) read-only banner + write-blocked API response when status=canceled; (d) social opt-outs hide user from a second-user's member list.

### 4.5 Infrastructure Requirements

- **Cron / scheduled jobs**: two new jobs. `trial-expiry-cron` (runs hourly) calls `BillingService.computeLifecycleTransitions()`. `purge-cron` (runs daily) calls `BillingService.computePurgeCandidates()` for the 30-day warning email and the actual purge. Jobs live in `apps/api/src/billing/cron/` following existing cron patterns under `apps/api/src/`.
- **Email touchpoints**: the jobs fire events into the existing notification/email infrastructure (whichever is current — `notification-system` effort). This effort does **not** build the email transport; it emits events with stable payloads:
  - `billing.trial_ended_no_card` (payload: `{userId, expired_at, purge_date}`)
  - `billing.purge_warning_30d` (payload: `{userId, purge_date}`)
  - `billing.subscription_lifecycle_transition` (internal audit event, payload: `{userId, from_status, to_status, reason}`)
- **Dev ports**: API on 7100, web on 7101 per project convention (CLAUDE.md memory). No change.
- **Env vars** (used by `BillingService`; no new vars needed — all present):
  - `BASIC_MONTHLY_USD=50`
  - `INSTRUMENT_AUTHORSHIP_USD=20`
  - `ANALYST_AUTHORSHIP_USD=60`
  - `BYO_PLATFORM_FEE_USD=10`
  - `TRIAL_DAYS=30`
  - `DORMANCY_MONTHS_BEFORE_PURGE=6`

## 5. Non-Functional Requirements

- **Performance**: `GET /billing/status` and `GET /billing/preview` must respond in <200ms p95 (in-process DB read). Lifecycle crons must complete full-user-base scan in <5 min at expected beta-phase scale (thousands of users).
- **Security**:
  - Social opt-out endpoints enforce `auth.userId === :id`
  - Admin billing-view endpoints gated by admin role
  - Read-only gating applied by middleware, not relying on UI to hide write controls
  - `subscription_events` audit rows are append-only (no UPDATE/DELETE path in service layer)
  - Migration script idempotent; safe to run twice
- **Scalability**: lifecycle cron is user-count bound; index `billing.subscriptions(status, trial_ends_at)` and `billing.subscriptions(status, purge_scheduled_at)` for cheap scans. Already acceptable at beta scale; revisit at 100k users.
- **Compatibility**:
  - Existing `billing.subscriptions` / `billing.authored_items` rows must not break — new columns nullable or defaulted
  - Users who already have `status='trial'` from initial shipped BillingService stay on their current `trial_ends_at`
  - Frontend BillingTab.vue must remain functional when `/billing/status` is unreachable (graceful degradation — hide banner, show error toast)
- **Observability**: each cron run logs summary `{ transitioned_count, errors_count, duration_ms }`. Lifecycle transitions emit structured log entries.
- **Dev-loop ergonomics**: migration + cron jobs must be runnable against the local Supabase (7010–7016 ports) for test fixtures.

## 6. Out of Scope

Explicitly NOT in this effort:

- **Stripe SDK integration**: customer creation, checkout sessions, webhooks, customer portal, proration, tax. All belong to `docs/efforts/future/stripe-integration/`. This effort defines the contracts Stripe consumes (status enum, line-item shape, lifecycle events) but ships no actual charges.
- **Authoring mechanics**: wizards, contract editors, credential management. Shipped by `user-authored-custom-content` (PR #50) and `cost-modeling-system` (PR #55).
- **Cost pass-through billing for students**: `student-accounts` effort.
- **Graduation / donation mechanics**: `custom-to-base-graduation` effort.
- **Notification/email transport infrastructure**: `notification-system` effort owns the delivery; this effort only emits events.
- **Affiliate / referral / revenue-share**: not in any current effort.
- **Multi-currency**: USD only in v1. Revisit in stripe-integration.
- **Admin refund/credit/comp UI**: stripe-integration ships the write side; this effort ships only the read-only admin view.
- **BYO platform fee granularity**: v1 is flat $10/mo per user (regardless of authored-item count). Per-authored-item BYO fees are a future refinement.
- **Per-authored-item quota / first-free**: v1 is strict per-item (no freebie). See §7 for rationale.
- **Contract-override pricing** (`analyst_contract_override`, `instrument_contract_override` item kinds in the schema): priced at $0 in v1. Non-zero pricing is a future decision.
- **User-facing account deletion UX**: purge is system-triggered on lifecycle expiry. Voluntary account deletion is a separate GDPR-track effort.

## 7. Dependencies & Risks

### Open questions (from intention) — resolved for this PRD:

1. **"Does Basic include per-item authorship quota?"** — **No.** Per-item billing is strict from the first item. Rationale: simpler mental model, cleaner migration path, no freebie-arbitrage incentive. Revisit in stripe-integration if conversion data suggests adding a "first analyst free" promo.
2. **"BYO API key platform fee structure?"** — **Flat $10/mo per user** (one `billing.authored_items` row with `item_kind='byo_platform_fee'` per user, regardless of how many authored items use BYO keys). Rationale: provider-side costs are asymmetric and the fee is a platform surcharge for KYC/credential storage/routing overhead, not a proxy for compute. Revisit if cost-modeling-system surfaces different per-authored-item economics.
3. **"How to display the monthly bill?"** — **Itemized, rollup-by-kind, expandable.** See §4.4 BillingTab.vue spec. Perception risk of "nickel-and-diming" mitigated by the rollup (users see "Authored Analysts: $180 (3)" first, drill in only if curious) and by the pricing page framing authorship as a premium creator tier on top of Basic, not a slice of Basic.

### Dependencies

- **Shipped / available**:
  - `billing.subscriptions` / `billing.authored_items` / `billing.invoice_ledger` schema (shipped)
  - `BillingService` skeleton with pricing helpers (shipped)
  - `BillingTab.vue` preview UI (shipped, extended here)
  - `author_user_id` on analyst/instrument config versions + immutability triggers (shipped)
  - `cost-modeling-system` (shipped, PR #55) — upstream for per-item cost data, though this effort does not consume it directly (stripe-integration / student-accounts do)
  - `user-scoped-platform` — provides the `public.profiles` user table structure we add social opt-out columns to
  - `<LegalDisclaimer>` component with five variants (shipped via `ui-vocabulary-and-marketing-refresh`)
- **Downstream** (blocked by this effort):
  - `stripe-integration` — reads the contracts defined here
  - `student-accounts` — reuses the lifecycle state machine and read-only gating
  - `custom-to-base-graduation` — reuses `BillingService.cancelAuthoredItem`

### Risks

1. **Lifecycle cron vs. Stripe webhooks drift**: once stripe-integration ships, Stripe webhooks and our cron can race on the `status` column. **Mitigation**: the `subscription_events` table lets us audit the exact source of every transition. Future stripe-integration effort will add webhook-source reason codes and claim precedence; this effort's cron writes `reason='trial_ended_no_card'` or `'migration_backfill'` so it's always distinguishable.
2. **Migration backfill granting free trial to users who would normally be past trial**: if we migrate existing users into `status='trial'` with a fresh 30-day clock, we grant a retroactive free trial. **Mitigation**: acceptable — we have no prior billing state, the beta-testers memo explicitly prioritizes goodwill, and it is a one-shot at flip-over. Future policy revisits after stripe-integration ships.
3. **Silent-user + tournament participation**: a user who has opted out of tournament participation but already has open positions in a tournament. **Mitigation**: `tournament_participation=false` is a prospective flag — it hides the user from future tournament surfaces and prevents them from joining new ones; existing positions are unaffected (leaderboard visibility is a separate flag). Document this in the `SocialOptOutsTab.vue` copy.
4. **Read-only gating false positive during Stripe grace period**: if a payment fails and Stripe's retry window is 7 days, our middleware would gate the user on day 1 of failure. **Mitigation**: `status='past_due'` is NOT treated as read-only in v1 (`isReadOnly` returns true only for `canceled` and `dormant`). This gives stripe-integration room to implement proper grace-period handling.
5. **Doc reconciliation going stale**: shipped efforts reference retired concepts (e.g., `learning-clubs/prd.md` mentions "Paid club tiers — future revenue model"). Future efforts might reintroduce retired concepts by copy-paste. **Mitigation**: the reconciliation phase explicitly deletes or annotates stale forward-references in shipped efforts, and `docs/efforts/master-intention.md` Section 7 ("What This Replaces") remains the authoritative retirement ledger.
6. **Social opt-outs applied inconsistently across surfaces**: miss one query and a "silent" user leaks into a leaderboard. **Mitigation**: `SocialOptOutService.applyVisibilityFilter` is the single choke point; phase includes a grep-gate that fails CI if any member-list / leaderboard / roster query is added without importing the filter helper.
7. **First-touch coverage drift**: new surfaces without `useFirstTouch` entries break the coverage build. **Mitigation**: gate plan phases on `check-first-touch-coverage.mjs` and ensure all five new surface keys land in `surface-content.ts`.

## 8. Phasing

Each phase ships independently-verifiable. The sequence preserves invariants (no client-observable regression mid-phase) and de-risks the highest-coupling concerns first.

### Phase 1: Strategy & Doc Reconciliation (prerequisite)
**Goal**: no orphaned references to retired models anywhere in the repo's planning docs.

- Scan `docs/efforts/current/**`, `docs/efforts/future/**`, `docs/efforts/master-intention.md`, `docs/efforts/roadmap.md`, `docs/features.md`, `docs/personas.md`, `docs/what-divinr-can-do.md` for: `Starter|Pro tier|Premium tier|Custom Tier|paid-club-tiers|default.*Divinr Basic club|club.as.billing|auto.enroll.*club`.
- For shipped efforts (e.g., `learning-clubs/prd.md:255`, `learning-clubs/intention.md:79`, `learning-clubs/completion-report.md:94`): annotate "Paid club tiers" as retired per master-intention §7, or delete the forward-reference outright.
- Archived efforts (`archive/paid-club-tiers/`, `archive/onboarding-v1/`): no change needed — they are already flagged retired.
- Update `docs/efforts/master-intention.md` Section 7 retirement ledger if any new retirements are discovered.
- **Validation**: the grep scan returns zero hits in non-archive paths.

### Phase 2: Policy Decisions Landed + Schema Extensions
**Goal**: codebase reflects the resolved open questions; schema has the new columns needed for lifecycle enforcement.

- Supabase migration adding `expired_at`, `purge_scheduled_at` to `billing.subscriptions`
- Supabase migration creating `billing.subscription_events` table
- Supabase migration adding five `social_*` boolean columns to `public.profiles`
- Indexes: `billing.subscriptions(status, trial_ends_at)`, `billing.subscriptions(status, purge_scheduled_at)`
- BillingService gains `markExpired`, `isReadOnly`, stubs for cron methods
- **Validation**: schema migration applies clean against local Supabase; `BillingService.isReadOnly(userId)` unit test passes for all five status values.

### Phase 3: Lifecycle State Machine + Read-Only Gating
**Goal**: trial → expired transition enforced; expired users are truly read-only.

- Implement `computeLifecycleTransitions()`, `computePurgeCandidates()` in BillingService
- Wire `trial-expiry-cron` and `purge-cron` into the existing scheduled-task runner
- Implement `ReadOnlyGuard` NestJS middleware; attach to all write routes
- Emit the three lifecycle events (`billing.trial_ended_no_card`, `billing.purge_warning_30d`, `billing.subscription_lifecycle_transition`)
- Frontend: `ReadOnlyBanner.vue` + `TrialCountdown.vue` + `useBillingStatusStore`; wire into app shell
- **Validation**: seeded test user with `trial_ends_at < now()` auto-transitions to `canceled` after one cron tick; a POST to any write route returns 403 `SUBSCRIPTION_EXPIRED`; UI shows the read-only banner; trial user sees countdown.

### Phase 4: Per-User Social Opt-Outs
**Goal**: silent $50-only user is a first-class experience.

- Implement `SocialOptOutService` + `applyVisibilityFilter` helper
- Integrate the filter helper into every surface returning user/member data: clubs member-list, tournament rosters, leaderboards, messaging suggestions, analyst owner attribution (where user names surface)
- `SocialOptOutsTab.vue` in Settings with the five toggles
- First-touch content entry for `settings.social-opt-outs`
- **Validation**: two test users A, B; A opts out of all five surfaces; B's API responses contain zero references to A across member lists, leaderboards, rosters, messaging suggestions; A can still read all Basic data.

### Phase 5: Pricing Page & Monthly Bill UX
**Goal**: user-facing billing surface matches the model.

- Extend `BillingTab.vue` with itemized bill view (Basic + per-item rollups + BYO fee + total)
- Extend `GET /billing/preview` to return the full itemized shape
- Build `PricingView.vue` at `/pricing` with the two-card layout (Basic + per-item authorship)
- First-touch entries for `billing.bill-overview`, `pricing.overview`, `billing.trial-countdown`, `billing.read-only-banner`
- Deep testing skill: stub `divinr-billing-browser-skill` and its Playwright project under `apps/e2e/tests/billing/`
- **Validation**: a user with ≥1 authored analyst and ≥1 authored instrument sees an itemized bill matching $50 + $60N + $20M (+ $10 if BYO); pricing page renders clean; four Playwright specs green.

### Phase 6: Migration + Admin Read-Only View
**Goal**: existing users all on the new billing model; admins can spot-check.

- One-shot migration script `migrateBackfillSubscriptions()` callable via `apps/api/scripts/`
- Idempotent: skips users already having a `billing.subscriptions` row
- Grandfathers a fresh 30-day trial for every existing user
- Writes `subscription_events` row per backfill with `reason='migration_backfill'`
- Admin endpoint `GET /admin/users/:id/billing` + admin surface showing subscription state, authored items, events, preview
- **Validation**: running migration twice is a no-op after the first; `SELECT count(*) FROM auth.users EXCEPT SELECT user_id FROM billing.subscriptions` returns zero; admin endpoint returns the expected payload for a seeded user.

### Phase 7: Cleanup & Verification
**Goal**: no loose ends; effort archiveable.

- Verify success criteria §2 all pass
- Confirm no club-billing coupling grep hits
- Run first-touch coverage gate; run testing-coverage gate
- Update `docs/efforts/roadmap.md` to move user-billing-model from "current" to "ready to ship"
- Write completion-report.md
- Ensure the stripe-integration intention references this effort's contracts correctly (it already does)

---

*PRD drafted 2026-04-19. Verified against intention.md line-by-line. Grounded in shipped billing schema and service stubs. Ready for build-plan.*
