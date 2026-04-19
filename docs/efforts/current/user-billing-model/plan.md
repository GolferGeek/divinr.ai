# User Billing Model (Single Tier + Per-Item Authorship) — Implementation Plan

**PRD**: [./prd.md](./prd.md)
**Intention**: [./intention.md](./intention.md)
**Created**: 2026-04-19
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Strategy & Doc Reconciliation
- [ ] Phase 2: Schema Extensions + BillingService Core
- [ ] Phase 3a: Lifecycle State Machine + Read-Only Gating (backend)
- [ ] Phase 3b: Trial/Read-Only App-Shell Surface (web)
- [ ] Phase 4: Per-User Social Opt-Outs
- [ ] Phase 5: Pricing Page & Monthly Bill UX
- [ ] Phase 6: Migration + Admin Read-Only View
- [ ] Phase 7: Cleanup & Verification

---

## Plan-level notes

- **Phase 3 was split into 3a (backend) and 3b (web)** after PR review flagged the combined phase as over-scoped (two cron jobs + global guard + endpoint + Pinia store + two components + new deep skill + new Playwright project in one phase). Splitting lets the backend lifecycle + read-only gating land and be curl-verified before any Vue work begins.
- **Migration grandfathering decision**: intention.md says "Grandfathered trial/active state per current account state (TBD in PRD)". The PRD and plan both grandfather every existing user into a fresh 30-day trial regardless of prior activity. This is the simplest migration path and is explicitly acknowledged as a generous give-away in PRD Risk §7.2. It sidesteps the intention's "per current account state" phrasing rather than addressing it. Acceptable for beta flip-over; revisit if stripe-integration's data suggests a different policy.
- **Two missing directories that phases implicitly create**: `apps/api/src/users/` (Phase 4 step 4.1–4.2) and `apps/api/scripts/` (Phase 6 step 6.2). Both are flagged in-step so run-plan doesn't stall looking for them.

---

## Conventions used by every phase

- **NestJS DI**: every new constructor param uses explicit `@Inject(ClassName)` per CLAUDE.md. No exceptions.
- **User-visible copy**: "analysis/signal" vocabulary only; disclaimers via `<LegalDisclaimer>`; no "prediction/advice/recommendation" outside code identifiers.
- **Dev ports**: API 7100, web 7101, Supabase 7010–7016 (Postgres 7011). Never vite default 5173.
- **Schema**: this repo extends the billing schema through `BillingSchemaService.ensureSchema()` DDL rather than per-file migration SQL. New billing tables/columns are added there unless they belong to `public.profiles` (where the existing migration convention under `apps/api/db/migrations/` applies).
- **First-touch coverage**: every new user-facing surface gets (a) `useFirstTouch('<key>')` or `<FirstTouchPanel :surface-key="...">`, and (b) a matching entry in `apps/web/src/onboarding/surface-content.ts`. Coverage gate: `node apps/web/scripts/check-first-touch-coverage.mjs`.
- **Testing coverage**: each phase that adds or substantially changes a user-visible surface updates the corresponding `.claude/skills/divinr-<facet>-browser-skill/tests.md` and ships at least one Playwright spec under `apps/e2e/tests/<facet>/`.

### Shared gate commands

| Gate | Command |
| --- | --- |
| API lint | `pnpm --filter @divinr/api run lint` |
| API typecheck | `pnpm --filter @divinr/api run typecheck` |
| API build | `pnpm --filter @divinr/api run build` |
| API unit tests | `pnpm --filter @divinr/api run test:unit` |
| Web lint | `pnpm --filter @divinr/web run lint` |
| Web typecheck | `pnpm --filter @divinr/web run typecheck` |
| Web build | `pnpm --filter @divinr/web run build` |
| First-touch coverage | `node apps/web/scripts/check-first-touch-coverage.mjs` |
| E2E (single project) | `pnpm --filter @divinr/e2e exec playwright test --project=<name>` |
| Repo lint | `pnpm -w run lint` |

---

## Phase 1: Strategy & Doc Reconciliation
**Status**: Complete
**Objective**: Remove every orphaned reference to retired billing models (Starter/Pro/Premium/Custom tier, paid clubs, default Divinr Basic club, auto-enrolled clubs) from non-archive planning docs, so the rest of the effort has no contradictions to work against.

### Steps
- [x] 1.1 Run the reconciliation grep on non-archive paths and capture hits:
  - `rg -n --glob '!**/archive/**' -i "Starter( tier)?|Pro tier|Premium tier|Custom Tier|paid-club-tiers|default.*Divinr Basic club|club.as.billing|auto.enroll.*club" docs/`
- [x] 1.2 For each shipped effort that references retired concepts (e.g. `docs/efforts/archive/learning-clubs/` forward refs if still discoverable, `master-intention.md`, `roadmap.md`, `features.md`): either delete the line or annotate it as "retired per `docs/efforts/master-intention.md` §7".
- [x] 1.3 Confirm `docs/efforts/master-intention.md` §7 retirement ledger lists: paid-club-tiers, Starter/Pro/Premium/Custom tier ladder, default Divinr Basic club, auto-enrolled club on signup. Add any that are missing. **Note:** the actual ledger is §8 (not §7); all four retirements are already present (lines 292, 294, 296, 299).
- [x] 1.4 Confirm `docs/efforts/roadmap.md` has no references to the retired tier table or "users bring their own API keys" Custom Tier framing; rewrite the user-billing-model line so it points at this effort and the single-tier model. **Result:** grep returns zero hits in `roadmap.md`.
- [x] 1.5 Confirm `docs/features.md` reflects: single $50/mo Basic tier, clubs are free/social, per-item authorship opt-in. Rewrite stale lines. **Result:** grep returns zero hits in `features.md`.
- [x] 1.6 Confirm `docs/personas.md` and `docs/what-divinr-can-do.md` do not describe tier-based gating; rewrite stale lines if any. **Result:** grep returns zero hits in either.
- [x] 1.7 Sanity-check `project_strategy.md` in auto-memory — if it still references retired models, flag it for update (do not silently mutate memory during a build-plan phase; note the mismatch in the phase review). **Result:** not mutated during this phase; flag for owner review.

### Phase 1 Notes
- Annotated three forward-references in the shipped-but-not-archived `docs/efforts/learning-clubs/` effort (completion-report.md:94, prd.md:255, intention.md:79) to point at master-intention §8 instead of the retired "Paid club tiers" phrase.
- Remaining grep hits after reconciliation are all intentional:
  - Master-intention §8 retirement ledger (authoritative — MUST retain the phrases)
  - `user-billing-model/` prd/plan/intention (active effort describing the retirement work)
  - Unrelated false positives: `docs/initial/analyst-system.md` "starter kit", `docs/efforts/slot-based-enablement-ui/**` "starter triples", `docs/efforts/analyst-intelligence-platform/data-sources-investigation.md` "Polygon.io Starter / FMP Starter" (data-provider pricing)
- No orphaned billing-tier / club-billing references remain outside the authoritative ledger and the active effort's planning docs.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: no code changed; lint skip acceptable for docs-only phase
- [x] **Build**: no code changed; build skip acceptable for docs-only phase
- [x] **Unit Tests**: no code changed; test skip acceptable for docs-only phase
- [x] **E2E Tests**: N/A for this phase (docs only)
- [x] **Curl Tests**: N/A for this phase
- [x] **Chrome Tests**: N/A for this phase
- [x] **Reconciliation grep**: Step 1.1 returns only intentional hits (ledger + active-effort docs + unrelated false positives); zero orphaned billing-tier references
- [x] **Phase Review**: Compare against PRD §8 Phase 1
  - [x] No orphaned Starter/Pro/Premium/Custom tier references in current or future docs
  - [x] No default-Divinr-Basic-club references outside `archive/`
  - [x] No club-as-billing references outside `archive/`
  - [x] master-intention retirement ledger current (all four retirements present at §8 lines 292/294/296/299)
  - [x] Deviations documented in Phase 1 Notes above — grep-strict zero-hits interpreted as "zero *orphaned* hits" given the ledger and active-effort docs are both expected to match

---

## Phase 2: Schema Extensions + BillingService Core
**Status**: Not Started
**Objective**: Extend billing schema with the two new lifecycle columns, the `subscription_events` audit table, and the five `social_*` profile columns; land the first core `BillingService` methods (`markExpired`, `isReadOnly`) with unit tests.

### Steps
- [ ] 2.1 Extend `apps/api/src/billing/billing-schema.service.ts` `ensureSchema()` DDL:
  - Add `expired_at TIMESTAMPTZ NULL` to `billing.subscriptions` (idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`)
  - Add `purge_scheduled_at TIMESTAMPTZ NULL` to `billing.subscriptions`
  - Create `billing.subscription_events` with columns: `id uuid PK`, `user_id text NOT NULL`, `from_status text`, `to_status text NOT NULL`, `reason text NOT NULL`, `triggered_by text NOT NULL CHECK (triggered_by IN ('system','user','admin','stripe'))`, `created_at timestamptz DEFAULT now()`
  - Add indexes: `billing_subscriptions_status_trial_ends_idx ON billing.subscriptions(status, trial_ends_at)`, `billing_subscriptions_status_purge_idx ON billing.subscriptions(status, purge_scheduled_at)`, `billing_subscription_events_user_created_idx ON billing.subscription_events(user_id, created_at DESC)`
  - Append-only enforcement: `REVOKE UPDATE, DELETE` is not possible at schema-service layer for arbitrary users; instead, document in the service-layer comment that `subscription_events` has no UPDATE/DELETE code path, and add a unit test that asserts `BillingService` exposes only `appendSubscriptionEvent`.
- [ ] 2.2 Add a migration file `apps/api/db/migrations/2026-04-19-social-opt-outs.sql` that adds five columns to `public.profiles`:
  - `social_visible_in_member_lists BOOLEAN NOT NULL DEFAULT true`
  - `social_messaging_enabled BOOLEAN NOT NULL DEFAULT true`
  - `social_tournament_participation BOOLEAN NOT NULL DEFAULT true`
  - `social_leaderboard_visible BOOLEAN NOT NULL DEFAULT true`
  - `social_notifications_enabled BOOLEAN NOT NULL DEFAULT true`
  - Use `ADD COLUMN IF NOT EXISTS` so the migration is idempotent.
- [ ] 2.3 Extend `BillingService` (apps/api/src/billing/billing.service.ts) interfaces:
  - Update `BillingSubscription` interface to include `expired_at: string | null` and `purge_scheduled_at: string | null`
  - Add `SubscriptionEvent` interface matching the new table
  - Add `SubscriptionStatus` type alias for the five enum values
- [ ] 2.4 Implement `BillingService.isReadOnly(userId: string): Promise<boolean>`:
  - Reads the subscription row; returns `true` iff `status IN ('canceled','dormant')`. Returns `false` if no row exists (new user pre-signup state; real users are guaranteed to have a row by migration/signup flow).
- [ ] 2.5 Implement `BillingService.appendSubscriptionEvent(...)` — internal helper writing one row to `billing.subscription_events`. Takes `{ userId, fromStatus, toStatus, reason, triggeredBy }`.
- [ ] 2.6 Implement `BillingService.markExpired(userId: string, reason: string, triggeredBy: 'system'|'admin'): Promise<void>`:
  - Transactional update: sets `status='canceled'`, `expired_at=now()`, `purge_scheduled_at=now() + interval '6 months'`, `updated_at=now()`
  - Reads prior status for the event row, then calls `appendSubscriptionEvent`
  - Emits `billing.subscription_lifecycle_transition` event (log line in this phase; real event bus wiring deferred to Phase 3a)
- [ ] 2.7 Extend `apps/api/tests/unit/billing-service.test.ts`:
  - `isReadOnly` returns true for `canceled`, true for `dormant`, false for `trial`, `active`, `past_due`
  - `markExpired` sets the three columns correctly and appends exactly one subscription_events row with the supplied reason
  - `appendSubscriptionEvent` inserts append-only (covered by lack of update method)
- [ ] 2.8 Register the new test file entry in `apps/api/package.json` `test:unit` chain if a new file was created (extend `apps/api/tests/unit/billing-service.test.ts` instead where possible to avoid churn). If a new file is added, append the `tsx tests/unit/<name>.test.ts` token to the `test:unit` script.
- [ ] 2.9 Wire trial seeding into the two existing account-creation flows (no traditional `POST /signup` endpoint exists in this codebase — all new accounts come in via invite or club code):
  - **Flow A — invite acceptance**: `apps/api/src/auth/invite.service.ts`, in `acceptInvite()` after the `SupabaseAuthService.createUser()` call succeeds (around line 196). Inject `BillingService` via `@Inject(BillingService)` on the service constructor and call `await this.billing.ensureSubscription(newUserId)` before returning.
  - **Flow B — club-code signup**: `apps/api/src/auth/auth.controller.ts`, in `signupWithClubCode()` after the user row is created (around line 212). Same pattern.
  - **Rationale for not hooking at the layer below**: `SupabaseAuthService.createUser()` lives in `packages/planes/auth/` and would introduce a cross-package dependency (`packages/` → `apps/api/src/billing/`) that violates the existing layering. Two call-site hooks are preferable to the layer violation.
  - Wire `BillingModule` into the importing module's `imports[]` if not already present. `BillingService` must be exported from `BillingModule` (verify; add to `exports` if missing).
  - Add a unit test for each flow asserting `ensureSubscription(newUserId)` is invoked exactly once after successful account creation. Use `jest.spyOn` or an injected mock of `BillingService`.
  - PRD US-1 is satisfied by these two hooks for new accounts post-ship; Phase 6 backfill covers pre-existing accounts. If a third account-creation flow is added in the future, it must also call `ensureSubscription` — this invariant is documented here but not enforceable via grep without registering a new guard pattern (out of scope for this effort).

### Quality Gate
Before moving to Phase 3a, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/api run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` (includes new billing-service assertions)
- [ ] **E2E Tests**: N/A for this phase (no user-visible surface change)
- [ ] **Curl Tests**:
  - `curl -s http://localhost:7100/health` returns 200 with schema-ready flag true after the API restart (this validates `ensureSchema()` ran against the local Supabase on ports 7010–7016 without throwing)
- [ ] **DB inspection**: against local Supabase (port 7011):
  - `psql ... -c "\d billing.subscriptions"` shows `expired_at`, `purge_scheduled_at`
  - `psql ... -c "\d billing.subscription_events"` shows the expected columns
  - `psql ... -c "\d public.profiles"` shows the five `social_*` columns
- [ ] **Chrome Tests**: N/A for this phase
- [ ] **Phase Review**: Compare against PRD §4.2 and §8 Phase 2
  - [ ] Schema has all new columns / tables / indexes from PRD §4.2
  - [ ] `isReadOnly` exact enum match from PRD §4.3
  - [ ] No new `@Inject`-missing constructor params
  - [ ] Migration idempotency validated by running the migration twice

---

## Phase 3a: Lifecycle State Machine + Read-Only Gating (backend)
**Status**: Not Started
**Objective**: Trial → canceled transition is enforced by a cron against real clock; purge-warning and purge paths are scheduled; write requests for expired users are 403'd at the API boundary; `GET /billing/status` returns the state the web shell will consume in Phase 3b.

### Steps
- [ ] 3a.1 Implement `BillingService.computeLifecycleTransitions()`:
  - Selects rows where `status = 'trial' AND trial_ends_at < now()` (using the new composite index)
  - For each row, call `markExpired(userId, 'trial_ended_no_card', 'system')`
  - Returns `{ transitionedCount: number, errors: Array<{userId, error}> }`
  - Log structured summary per PRD §5 Observability: `{ transitioned_count, errors_count, duration_ms }`
- [ ] 3a.2 Implement `BillingService.computePurgeCandidates()`:
  - Select rows where `status = 'canceled' AND purge_scheduled_at IS NOT NULL AND purge_scheduled_at < now() + interval '30 days' AND purge_scheduled_at >= now()` for the 30-day warning (idempotent: only fire once per user — check `billing.subscription_events` for an existing `reason='purge_warning_30d'` event before emitting)
  - Select rows where `status = 'canceled' AND purge_scheduled_at < now()` for the actual purge; emit `billing.purge_scheduled` with userId; the actual account purge is out of scope (owned by `notification-system` / future GDPR effort)
  - Log structured summary
- [ ] 3a.3 Create `apps/api/src/billing/cron/billing-lifecycle.cron.ts`:
  - `@Cron('0 * * * *')` → `trialExpiryTick()` → calls `computeLifecycleTransitions`
  - `@Cron('0 6 * * *')` → `purgeTick()` → calls `computePurgeCandidates`
  - Inject `BillingService` with `@Inject(BillingService)`
  - Register the cron provider in `apps/api/src/billing/billing.module.ts`
- [ ] 3a.4 Emit the three lifecycle events from the service methods:
  - `billing.trial_ended_no_card` (from `markExpired` when reason is trial-ended)
  - `billing.purge_warning_30d` (from `computePurgeCandidates` when emitting the 30-day warning)
  - `billing.subscription_lifecycle_transition` (every transition)
  - Event emission in this phase = structured `logger.log` with a stable JSON shape on a dedicated logger channel (`logger = new Logger('BillingLifecycleEvents')`). Real transport wiring belongs to `notification-system`.
- [ ] 3a.5 Implement `ReadOnlyGuard` at `apps/api/src/billing/read-only.guard.ts`:
  - NestJS `CanActivate` guard
  - Reads `request.method`; returns `true` for GET/HEAD/OPTIONS
  - Reads `request.user.id` (existing auth middleware populates this)
  - Calls `BillingService.isReadOnly(userId)`; if true, throws `ForbiddenException` with `{ code: 'SUBSCRIPTION_EXPIRED', message: '...' }`
  - Exempt routes: `/billing/checkout-session`, `/billing/portal-session`, `/auth/*`, `/billing/status`, `/users/:id/social-opt-outs` (so expired users can still read their state and manage minimal account hygiene)
  - Apply via `APP_GUARD` in `app.module.ts` so it's global, with a `@SkipReadOnly()` decorator for the exempt routes
- [ ] 3a.6 Implement `BillingController.getStatus()`:
  - `GET /billing/status` (auth required)
  - Returns `{ status, trial_ends_at, expired_at, purge_scheduled_at, is_read_only, days_until_purge }`
  - `days_until_purge` = `ceil((purge_scheduled_at - now()) / day)` or null if not scheduled

### Quality Gate
Before moving to Phase 3b, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/api run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — includes new assertions for `computeLifecycleTransitions`, `computePurgeCandidates`, `ReadOnlyGuard` (unit-level with mocked BillingService)
- [ ] **E2E Tests**: N/A for this phase (no user-visible web surface change)
- [ ] **Curl Tests** (API running on 7100, authed as a fixture user):
  - Trial user: `curl -s -H "Authorization: Bearer $TRIAL_JWT" http://localhost:7100/billing/status` returns `{ status: 'trial', is_read_only: false, ... }`
  - Expired user: `curl -s -H "Authorization: Bearer $EXPIRED_JWT" http://localhost:7100/billing/status` returns `{ status: 'canceled', is_read_only: true, days_until_purge: <number> }`
  - Expired user write attempt: `curl -s -X POST -H "Authorization: Bearer $EXPIRED_JWT" http://localhost:7100/clubs -d '{"name":"x"}'` returns `403 { code: 'SUBSCRIPTION_EXPIRED' }`
  - Trial user write attempt: `curl -s -X POST -H "Authorization: Bearer $TRIAL_JWT" http://localhost:7100/clubs -d '{"name":"x"}'` returns `2xx`
  - Exempt route for expired user: `curl -s -X PATCH -H "Authorization: Bearer $EXPIRED_JWT" -d '{}' http://localhost:7100/users/$USER_ID/social-opt-outs` does NOT return `SUBSCRIPTION_EXPIRED` (endpoint may 404 until Phase 4 ships the handler — that's acceptable, just not a read-only block)
- [ ] **Chrome Tests**: N/A for this phase (web surface deferred to 3b)
- [ ] **Cron dry-run**: seed a test subscription with `trial_ends_at = now() - 1 hour, status='trial'`; invoke `BillingService.computeLifecycleTransitions()` directly via a unit test → status flips to `canceled`, `expired_at` set, `purge_scheduled_at` set 6 months out, `subscription_events` row with `reason='trial_ended_no_card'` appended
- [ ] **Phase Review**: Compare against PRD §4.3, §4.5, §8 Phase 3 (backend portions)
  - [ ] All three lifecycle events emit with stable payloads (PRD §4.5)
  - [ ] `past_due` is NOT gated as read-only (PRD Risk §7.4)
  - [ ] Exempt routes list matches PRD §4.3
  - [ ] No implicit DI — every param uses `@Inject`
  - [ ] Deviations documented

---

## Phase 3b: Trial/Read-Only App-Shell Surface (web)
**Status**: Not Started
**Objective**: Users see the trial countdown and the read-only banner in the app shell; the new `divinr-billing-browser-skill` deep testing skill is stubbed with green Playwright specs; first-touch content is wired for both new components.

### Steps
- [ ] 3b.1 Add `apps/web/src/stores/billing-status.store.ts`:
  - Pinia store with `status`, `trialEndsAt`, `expiredAt`, `purgeScheduledAt`, `isReadOnly`, `daysUntilPurge`
  - `fetch()` action calling `GET /billing/status`
  - Call `fetch()` on app mount, after login, and every 5 minutes while the app is foregrounded
- [ ] 3b.2 Create `apps/web/src/components/ReadOnlyBanner.vue`:
  - Visible when `billingStatus.isReadOnly === true`
  - Copy: "Your trial has ended. Add a card to continue accessing your data. Your account remains read-only until {purge date}."
  - `<LegalDisclaimer variant="short" />`
  - `useFirstTouch('billing.read-only-banner')`
- [ ] 3b.3 Create `apps/web/src/components/TrialCountdown.vue`:
  - Visible when `billingStatus.status === 'trial'`
  - Small badge showing days remaining until `trialEndsAt`
  - `useFirstTouch('billing.trial-countdown')`
- [ ] 3b.4 Wire `ReadOnlyBanner` and `TrialCountdown` into the app shell (`App.vue` or the main layout wrapper; match the existing `ActiveTournamentBanner.vue` pattern — grep for it to find the anchor point).
- [ ] 3b.5 Add `billing.read-only-banner` and `billing.trial-countdown` entries to `apps/web/src/onboarding/surface-content.ts`.
- [ ] 3b.6 Stub the `divinr-billing-browser-skill` deep testing skill:
  - Create `.claude/skills/divinr-billing-browser-skill/` with six files: `SKILL.md`, `what.md`, `where.md`, `expectations.md`, `tests.md`, `completeness.md` (follow the structure of `divinr-authoring-browser-skill`)
  - Register new Playwright project `billing` in `apps/e2e/playwright.config.ts`: `{ name: 'billing', testMatch: 'billing/*.spec.ts' }`
  - Add green spec `apps/e2e/tests/billing/trial-countdown.spec.ts`: login as a fixture trial user → app shell shows the TrialCountdown badge with a day count
  - Add green spec `apps/e2e/tests/billing/read-only-banner.spec.ts`: login as a fixture canceled user → app shell shows the ReadOnlyBanner; a POST against any protected route returns 403 with `code: 'SUBSCRIPTION_EXPIRED'`
- [ ] 3b.7 Update `.claude/skills/divinr-platform-browser-skill/SKILL.md` index to include the new billing deep skill.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/web run lint`
- [ ] **Build**: `pnpm --filter @divinr/web run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` (no regressions from Phase 3a)
- [ ] **E2E Tests**: `pnpm --filter @divinr/e2e exec playwright test --project=billing` — both specs green
- [ ] **Curl Tests**: N/A (backend already validated in Phase 3a)
- [ ] **Chrome Tests** (web on 7101):
  - Login as a trial user → TrialCountdown badge visible in header showing "N days left"
  - Login as an expired user → ReadOnlyBanner visible at top of app shell with purge date
  - First-touch popover appears on first visit for `billing.trial-countdown` and `billing.read-only-banner`
- [ ] **First-touch coverage**: `node apps/web/scripts/check-first-touch-coverage.mjs` green
- [ ] **Phase Review**: Compare against PRD §4.4, §8 Phase 3 (web portions)
  - [ ] `useFirstTouch` present on both new components
  - [ ] Store fetches on mount + after login + every 5 min (PRD §4.4 implicit)
  - [ ] Deep skill has six files; Playwright project registered; two green specs
  - [ ] Platform-skill index updated
  - [ ] Deviations documented

---

## Phase 4: Per-User Social Opt-Outs
**Status**: Not Started
**Objective**: Ship the silent $50-only user. All five opt-out flags are editable; every discovery surface (member lists, rosters, leaderboards, messaging suggestions, analyst owner attribution) respects them.

### Steps
- [ ] 4.1 Create `apps/api/src/users/social-opt-out.service.ts`:
  - `getOptOuts(userId: string): Promise<SocialOptOuts>` — reads the five columns from `public.profiles`, returns defaults (all `true`) if no row exists
  - `setOptOuts(userId: string, partial: Partial<SocialOptOuts>): Promise<SocialOptOuts>` — upserts; returns new state
  - `applyVisibilityFilter(sql: string, params: unknown[], viewerId: string, flag: keyof SocialOptOuts): { sql, params }` — adds a `WHERE ... AND (p.<flag> = true OR p.user_id = $viewerId)` clause to the supplied SQL; viewer always sees themselves even when opted out
  - Constructor uses `@Inject(DATABASE_SERVICE)`
- [ ] 4.2 Add the service to a `UsersModule` (create it if it does not already exist at `apps/api/src/users/users.module.ts`) and import it into `app.module.ts`.
- [ ] 4.3 Implement `GET /users/:id/social-opt-outs` and `PATCH /users/:id/social-opt-outs` in a new `UsersController`:
  - Self-serve only: 403 when `req.user.id !== :id`
  - Return / accept the full five-boolean shape
- [ ] 4.4 Thread `applyVisibilityFilter` into every discovery surface. Each requires identifying the query, adding the helper, and adding a unit test. Surfaces to update (grep to discover exact file paths before editing):
  - [ ] Clubs members endpoint (facet: clubs) → `social_visible_in_member_lists`
  - [ ] Tournament roster endpoint (facet: tournaments) → `social_tournament_participation`
  - [ ] Tournament leaderboard endpoint → `social_leaderboard_visible`
  - [ ] Club rankings endpoint → `social_leaderboard_visible`
  - [ ] Performance leaderboard endpoint (facet: performance) → `social_leaderboard_visible`
  - [ ] Messaging suggestions / DM user-picker endpoint → `social_messaging_enabled`
  - [ ] Analyst owner attribution surfaces (where user names surface in `/analysts` list or detail) → `social_visible_in_member_lists`
  - [ ] Notification fan-out (drop recipients with `social_notifications_enabled=false`) → `social_notifications_enabled`
  - Use a grep guard in Step 4.7 to ensure no surface is missed.
- [ ] 4.5 Create `apps/web/src/views/settings/SocialOptOutsTab.vue`:
  - Five toggles with plain-English descriptions
  - `useFirstTouch('settings.social-opt-outs')`
  - Writes to `PATCH /users/:id/social-opt-outs` on change
  - Note about prospective-only effect of `tournament_participation` (per PRD Risk §7.3)
- [ ] 4.6 Wire `SocialOptOutsTab.vue` into Settings navigation; add a route `settings/social-opt-outs` under the existing settings parent in `apps/web/src/router/index.ts`.
- [ ] 4.7 Add entry for `settings.social-opt-outs` to `apps/web/src/onboarding/surface-content.ts`.
- [ ] 4.8 Add a grep-gate unit test `apps/api/tests/unit/social-opt-out-coverage.test.ts`:
  - For each known discovery-surface file path (hardcoded list reviewed against step 4.4), assert the file imports `SocialOptOutService` or calls `applyVisibilityFilter`
  - If a new member-list / leaderboard / roster endpoint is added later without the filter, this test fails
- [ ] 4.9 Testing coverage:
  - Update `.claude/skills/divinr-clubs-browser-skill/tests.md`, `divinr-tournaments-browser-skill/tests.md`, `divinr-performance-browser-skill/tests.md` to note the opt-out expectations on their list views
  - Add Playwright spec `apps/e2e/tests/billing/social-opt-outs.spec.ts`:
    - Two users A, B
    - A toggles all five opt-outs
    - B's clubs-members list, tournament-roster, leaderboard, messaging-suggestions all lack A's identity

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/api run lint && pnpm --filter @divinr/web run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run build && pnpm --filter @divinr/web run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — includes `social-opt-out.service.test.ts` + `social-opt-out-coverage.test.ts`
- [ ] **E2E Tests**: `pnpm --filter @divinr/e2e exec playwright test --project=billing` — includes the new opt-out spec and both earlier billing specs
- [ ] **Curl Tests**:
  - `curl -s -H "Authorization: Bearer $USER_A_JWT" http://localhost:7100/users/$USER_A_ID/social-opt-outs` returns five booleans
  - `curl -s -X PATCH -H "Authorization: Bearer $USER_A_JWT" -H 'Content-Type: application/json' -d '{"social_visible_in_member_lists":false}' http://localhost:7100/users/$USER_A_ID/social-opt-outs` returns updated shape
  - Cross-user attempt: `curl -s -X PATCH -H "Authorization: Bearer $USER_A_JWT" -d '{}' http://localhost:7100/users/$USER_B_ID/social-opt-outs` returns 403
  - After A opts out of member-lists: `curl -s -H "Authorization: Bearer $USER_B_JWT" http://localhost:7100/clubs/$SHARED_CLUB_ID/members` response contains zero references to A
- [ ] **Chrome Tests** (web on 7101):
  - Navigate to Settings → Social; toggle all five; save; refresh; values persist
  - Sign in as B; open the shared club → members list does not contain A
  - First-touch popover appears on `settings.social-opt-outs`
- [ ] **First-touch coverage**: `node apps/web/scripts/check-first-touch-coverage.mjs` green
- [ ] **Phase Review**: Compare against PRD §4.3, §4.4, §8 Phase 4
  - [ ] All eight discovery surfaces use `applyVisibilityFilter`; the grep-gate test passes
  - [ ] Self-serve enforcement on the endpoints (PRD §5 Security)
  - [ ] Viewer sees themselves even when opted out (PRD US-7 implicit)
  - [ ] Prospective-only note present in UI copy (PRD Risk §7.3)
  - [ ] Deviations documented

---

## Phase 5: Pricing Page & Monthly Bill UX
**Status**: Not Started
**Objective**: User-facing billing surface matches the model — itemized bill in BillingTab, public pricing page, one-click path from pricing to trial signup.

### Steps
- [ ] 5.1 Extend `BillingService.getBillingPreview(userId)` to return the full itemized shape required by PRD §4.4:
  - `{ basicMonthlyUsd, authoredAnalysts: Array<{ id, displayName, monthlyUsd }>, authoredInstruments: Array<{ id, displayName, monthlyUsd }>, byoPlatformFeeUsd, totalMonthlyUsd }`
  - Existing shape is preserved as a subset where possible; extend rather than break.
- [ ] 5.2 Confirm `GET /billing/preview` returns the new shape. Update the return-type contract in `BillingController`.
- [ ] 5.3 Extend `apps/web/src/views/authored/BillingTab.vue`:
  - "Divinr Basic — $50" line
  - "Authored Analysts ($60 × N) — $60N" rollup row, expandable to show per-analyst rows
  - "Authored Instruments ($20 × M) — $20M" rollup row, expandable to show per-instrument rows
  - "BYO API Key Platform Fee — $10" conditional line
  - "Monthly Total — $T" footer
  - Hook `useFirstTouch('billing.bill-overview')` at mount
  - Use "analysis/signal" vocabulary per CLAUDE.md; route any legal language through `<LegalDisclaimer variant="short" />`
- [ ] 5.4 Create `apps/web/src/views/PricingView.vue`:
  - Two-card layout:
    - Card 1: "Divinr Basic — $50/mo. Includes full platform access (analyses, signals, risk debates, reasoning, performance dashboards, clubs). 30-day free trial."
    - Card 2: "Author custom content — add $20/mo per custom instrument, $60/mo per custom analyst, $10/mo BYO API key add-on."
  - Primary CTA "Start free trial" → routes to signup
  - `<LegalDisclaimer variant="full" />` at the bottom
  - `useFirstTouch('pricing.overview')`
- [ ] 5.5 Add route `{ path: '/pricing', name: 'pricing', component: () => import('../views/PricingView.vue') }` in `apps/web/src/router/index.ts` at an unauthenticated-accessible level (public route).
- [ ] 5.6 Add entries for `billing.bill-overview` and `pricing.overview` to `apps/web/src/onboarding/surface-content.ts`.
- [ ] 5.7 Verify `apps/web/src/views/authored/BillingTab.vue` imports `useFirstTouch` with the correct key and the old `BillingPreview.vue` component (if used) is either removed or left as an internal dependency.
- [ ] 5.8 Testing coverage — billing facet:
  - Populate `.claude/skills/divinr-billing-browser-skill/tests.md` with the four required specs (trial countdown, read-only banner from Phase 3b; bill-preview itemization and pricing page from this phase)
  - Add `apps/e2e/tests/billing/bill-preview.spec.ts`: fixture user with one authored analyst, one authored instrument, BYO on → BillingTab shows `$50 + $60 + $20 + $10 = $140` with correct rollup rows
  - Add `apps/e2e/tests/billing/pricing-page.spec.ts`: unauthenticated `goto('/pricing')` → both cards render; "Start free trial" links to signup; `<LegalDisclaimer variant="full">` present
- [ ] 5.9 Testing coverage — authoring facet linkage:
  - Update `.claude/skills/divinr-authoring-browser-skill/tests.md` to note that Billing tab now surfaces the itemized bill (cross-link to `divinr-billing-browser-skill`)

### Quality Gate
Before moving to Phase 6, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/api run lint && pnpm --filter @divinr/web run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run build && pnpm --filter @divinr/web run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — includes updated billing-service preview assertions
- [ ] **E2E Tests**: `pnpm --filter @divinr/e2e exec playwright test --project=billing` — all four billing specs green
- [ ] **Curl Tests**:
  - `curl -s -H "Authorization: Bearer $USER_WITH_AUTHORED_JWT" http://localhost:7100/billing/preview` returns the new itemized shape with `authoredAnalysts`, `authoredInstruments`, `byoPlatformFeeUsd`, `totalMonthlyUsd`
  - Calculated total equals `50 + 60 * len(authoredAnalysts) + 20 * len(authoredInstruments) + byoPlatformFeeUsd`
- [ ] **Chrome Tests** (web on 7101):
  - `/pricing` renders two cards, trial CTA visible, disclaimer at bottom
  - Authored user Settings → Billing tab shows itemized bill; expanding "Authored Analysts" reveals per-analyst rows
  - All user-visible copy uses "analysis/signal" — grep `rg -n -i "predict|advice|recommend" apps/web/src/views/PricingView.vue apps/web/src/views/authored/BillingTab.vue` returns no matches outside disclaimers/comments
- [ ] **First-touch coverage**: `node apps/web/scripts/check-first-touch-coverage.mjs` green
- [ ] **Vocabulary check** (PRD §4.4 copy rules):
  - `rg -n -i "\b(predict(ion|ed|or)?|advice|recommend(ation|ed)?)\b" apps/web/src/views/PricingView.vue apps/web/src/views/authored/BillingTab.vue apps/web/src/onboarding/surface-content.ts | rg -v LegalDisclaimer` returns no matches
- [ ] **Phase Review**: Compare against PRD §4.4, §8 Phase 5
  - [ ] Itemized bill renders $50 + per-item lines correctly for the seeded user
  - [ ] Pricing page two-card layout matches spec
  - [ ] Four specs required by PRD §4.4 Testing coverage are green
  - [ ] First-touch keys present: `billing.bill-overview`, `pricing.overview`
  - [ ] Deviations documented

---

## Phase 6: Migration + Admin Read-Only View
**Status**: Not Started
**Objective**: Existing users are all on the new billing model via the idempotent migration; admins have a read-only view of a user's billing picture.

### Steps
- [ ] 6.1 Implement `BillingService.migrateBackfillSubscriptions()`:
  - For every row in the canonical user source (`public.profiles` or `auth.users` — verify which exists in this codebase) that does NOT have a matching `billing.subscriptions` row, insert `{ user_id, status: 'trial', trial_started_at: now(), trial_ends_at: now() + interval '30 days' }`
  - Append a `subscription_events` row with `reason='migration_backfill'`, `triggered_by='system'`, `to_status='trial'`, `from_status=NULL`
  - Idempotent: use `INSERT ... ON CONFLICT DO NOTHING` on `user_id`
  - Returns `{ inserted_count, skipped_count, errors }`
- [ ] 6.2 Create CLI entry `apps/api/scripts/migrate-billing-backfill.ts`:
  - **Scaffolding note**: `apps/api/scripts/` does not currently exist; create the directory as part of this step.
  - Bootstraps a minimal Nest context, resolves `BillingService`, calls `migrateBackfillSubscriptions()`, prints summary, exits
  - Runnable via `tsx apps/api/scripts/migrate-billing-backfill.ts`
- [ ] 6.3 Implement `GET /admin/users/:id/billing` in `BillingController`:
  - Admin-role guarded
  - Returns `{ subscription: BillingSubscription, authored_items: BillingAuthoredItem[], events: SubscriptionEvent[], preview: BillingPreview }`
- [ ] 6.4 Unit test coverage:
  - `migrateBackfillSubscriptions`: fresh DB → inserts N rows; run twice → second run skipped_count = N, inserted_count = 0
  - Every backfill row has a matching `subscription_events` row with `reason='migration_backfill'`
  - `/admin/users/:id/billing` returns expected shape
  - `/admin/users/:id/billing` returns 403 for non-admin
- [ ] 6.5 Ship the read-only admin view (PRD §8 Phase 6 explicitly calls for "admin surface showing subscription state, authored items, events, preview"; PRD §6 excludes only the write side):
  - Create `apps/web/src/views/AdminUserBillingView.vue` (new admin-only view). Sections: subscription state, authored items table, events timeline, bill preview. No write controls.
  - `useFirstTouch('admin.user-billing')`
  - Route `{ path: '/admin/users/:id/billing', name: 'admin-user-billing', component: ... }` gated on admin role under the existing admin router subtree
  - Add `admin.user-billing` entry to `apps/web/src/onboarding/surface-content.ts`
  - Update `.claude/skills/divinr-admin-browser-skill/tests.md` with expectations and add `apps/e2e/tests/admin/user-billing.spec.ts`: admin loads the view for a seeded user and sees subscription, ≥1 authored item, ≥1 event row, and the itemized preview

### Quality Gate
Before moving to Phase 7, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/api run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — includes `migrate-billing-backfill.test.ts` and admin endpoint tests
- [ ] **E2E Tests**: `pnpm --filter @divinr/e2e exec playwright test --project=admin` — admin billing view spec green
- [ ] **Curl Tests**:
  - Admin: `curl -s -H "Authorization: Bearer $ADMIN_JWT" http://localhost:7100/admin/users/$USER_ID/billing` returns the four-key shape
  - Non-admin: same URL with a regular user JWT → 403
- [ ] **Migration dry-run**:
  - On local Supabase with seeded test users: `tsx apps/api/scripts/migrate-billing-backfill.ts` → `inserted_count > 0`
  - Run again: `inserted_count = 0, skipped_count > 0`
  - Invariant check: `psql ... -c "SELECT count(*) FROM public.profiles p LEFT JOIN billing.subscriptions s ON s.user_id = p.user_id WHERE s.user_id IS NULL"` → returns 0
- [ ] **Chrome Tests** (web on 7101):
  - Admin user navigates to `/admin/users/<id>/billing` → view shows subscription status, authored-items table, events timeline, itemized preview
  - Non-admin user hitting same URL → routed away / forbidden
  - First-touch popover appears on `admin.user-billing`
- [ ] **First-touch coverage**: `node apps/web/scripts/check-first-touch-coverage.mjs` green
- [ ] **Phase Review**: Compare against PRD §4.3, §8 Phase 6
  - [ ] Migration is idempotent
  - [ ] Every backfill writes a `subscription_events` audit row
  - [ ] Admin endpoint gated and shaped per spec
  - [ ] Deviations documented

---

## Phase 7: Cleanup & Verification
**Status**: Not Started
**Objective**: All PRD success criteria verified; effort is archivable; downstream efforts can begin.

### Steps
- [ ] 7.1 Verify every PRD §2 success criterion programmatically:
  - **DB invariant**: run the count-equality query (active users vs. subscriptions rows)
  - **Zero billing coupling in clubs grep**: `rg -i "club.*(tier|price|billing|paid|quota|entitlement)" apps/ docs/efforts/current docs/efforts/future` → no club-as-billing hits
  - **Coverage**: every user has a status in the valid enum
  - **Itemized bill**: BillingTab render matches getBillingPreview payload (covered by Phase 5 spec)
  - **Silent-user surface**: Phase 4 spec re-run to confirm
  - **Lifecycle cron proven**: run both crons against seed data, observe transitions
  - **Migration clean**: left-join query from Phase 6 returns 0
  - **Strategy docs reconciled**: Phase 1 grep re-run
- [ ] 7.2 Confirm all four billing Playwright specs are registered and green; confirm no other facet specs regressed (`pnpm --filter @divinr/e2e exec playwright test --project=smoke`).
- [ ] 7.3 Run the full quality gate one last time: API lint, web lint, API build, web build, API test:unit, e2e billing project, first-touch coverage.
- [ ] 7.4 Update `docs/efforts/roadmap.md`: move user-billing-model from "current" to "ready to ship" / recently-shipped.
- [ ] 7.5 Update `docs/efforts/master-intention.md` retirement ledger if any retirements were discovered during Phase 1 that were not already listed.
- [ ] 7.6 Write `docs/efforts/current/user-billing-model/completion-report.md` summarizing:
  - What shipped
  - Open questions resolved (per PRD §7) and their chosen answers
  - Known follow-ups (e.g., stripe-integration hooks, notification-system event transport, BYO per-item granularity revisit)
  - Verification output from Step 7.1
- [ ] 7.7 Verify the `stripe-integration` intention / PRD (if present in `docs/efforts/future/`) references the contracts shipped here — at minimum: `billing.subscriptions` status enum (five values), `billing.subscription_events.reason` vocabulary, the three lifecycle events (`billing.trial_ended_no_card`, `billing.purge_warning_30d`, `billing.subscription_lifecycle_transition`). Flag corrections but do not edit that effort's docs here.

### Quality Gate
Before the effort is complete, ALL of the following must pass:

- [ ] **Lint**: `pnpm -w run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run build && pnpm --filter @divinr/web run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: `pnpm --filter @divinr/e2e exec playwright test --project=billing --project=smoke`
- [ ] **Curl Tests**: re-run each curl from Phases 2–6 against a fresh local stack; all pass
- [ ] **Chrome Tests**: smoke-walk trial → pay-attention-banner → authoring-with-itemized-bill → pricing page → settings social-opt-outs
- [ ] **First-touch coverage**: `node apps/web/scripts/check-first-touch-coverage.mjs` green
- [ ] **Success-criteria evidence**: every bullet in PRD §2 has a passing verification from Step 7.1 attached to the completion report
- [ ] **Phase Review**: Compare against PRD §2 (Success Criteria) and §8 Phase 7
  - [ ] Every success criterion met
  - [ ] No loose ends documented
  - [ ] Roadmap reflects shipped status
  - [ ] completion-report.md written
  - [ ] Deviations documented

---

*Plan drafted 2026-04-19. Verified against prd.md §2–§8 and intention.md line-by-line. Uses the repo's `pnpm`/`turbo`/`tsx`/Playwright conventions and the existing `BillingSchemaService.ensureSchema()` schema-extension pattern.*
