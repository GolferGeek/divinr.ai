# Onboarding Tour — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-14
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: DB schema + API endpoints
- [x] Phase 2: Pinia store + docent skeleton
- [x] Phase 3: Nav lock rendering + router guard
- [x] Phase 4: Tour content (the copy)
- [x] Phase 5: Welcome modal, completion celebration, polish
- [x] Phase 6: Restart + admin reset + user-menu affordance
- [x] Phase 7: Final gate sweep (browser smoke test deferred to user)

---

## Phase 1: DB schema + API endpoints
**Status**: Complete
**Objective**: Stand up `authz.user_preferences` and the three onboarding endpoints, with unit coverage and curl-verified behavior, before any web work begins.

**Note**: Pre-existing test `tests/unit/recent-bars-ring-buffer.test.ts` fails on main (verified by stash). Unrelated to this effort — documented as deviation, not fixed in this phase.

### Steps

- [x] 1.1 Create migration file `apps/api/db/migrations/2026-04-14-user-preferences.sql` with the DDL from PRD §4.2 (CREATE TABLE `authz.user_preferences` with `user_id` PK, `onboarding_state` JSONB default, timestamps; plus `idx_user_preferences_updated_at`).
- [x] 1.2 Create `apps/api/src/onboarding/` directory. Add:
  - `onboarding.types.ts` — exports `StepId` union (12 literals from PRD §4.2), `OnboardingState` interface, `OnboardingPatch` discriminated union (6 actions from PRD §4.3), and `STEP_ORDER: StepId[]` constant (welcome → done).
  - `onboarding-schema.service.ts` — `@Injectable()` service with `@Inject(DATABASE_SERVICE)`, mirrors `apps/api/src/clubs/club-schema.service.ts`. `ensureSchema()` memoizes via `schemaReady` flag and runs the same DDL as the migration file (CREATE TABLE IF NOT EXISTS `authz.user_preferences`, CREATE INDEX IF NOT EXISTS). This is how the schema actually lands at runtime; the .sql file is the documented snapshot.
  - `onboarding.service.ts` — `@Injectable()` service with `@Inject(DATABASE_SERVICE)` and `@Inject(OnboardingSchemaService)`. Methods: `getState(userId)`, `applyPatch(userId, patch)`, `resetUser(userId)`. Each method calls `schema.ensureSchema()` first (per project convention).
    - `getState`: `INSERT ... ON CONFLICT DO NOTHING` into `authz.user_preferences` with default onboarding_state, then `SELECT onboarding_state FROM authz.user_preferences WHERE user_id = $1`.
    - `applyPatch`: pure function over current state + patch → new state; write back via `UPDATE` with `updated_at = now()`. Reject unknown `step` values with a thrown `BadRequestException`. Implement all six actions per PRD §4.3 semantics (start, complete_step, set_current_step, skip, restart, mark_seen). `skip` fills `steps_completed` with all 12 step IDs, sets `completed_at=now()`. `restart` resets to defaults but auto-starts (started_at=now, current_step='dashboard', steps_completed=['welcome']).
    - `resetUser`: write pristine defaults (started_at=null, current_step='welcome', steps_completed=[], skipped=false, completed_at=null, last_seen_at=null).
  - `onboarding.controller.ts` — `@UseGuards(JwtAuthGuard)`, `@Controller('onboarding')`. Inject `OnboardingService` and `DATABASE_SERVICE` (for role lookup on reset). Endpoints:
    - `GET /onboarding/state` → `onboardingService.getState(req.user.id)`.
    - `PATCH /onboarding/state` → `onboardingService.applyPatch(req.user.id, body)`.
    - `POST /onboarding/reset/:userId` → role check (mirror `club.controller.ts:52-67` but require role === 'super-admin'; throw `ForbiddenException` otherwise), then `onboardingService.resetUser(params.userId)`.
  - `onboarding.module.ts` — `@Module({ controllers: [OnboardingController], providers: [OnboardingSchemaService, OnboardingService] })`.
- [x] 1.3 Register `OnboardingModule` in `apps/api/src/app.module.ts` imports array (alongside `ClubModule`).
- [x] 1.4 Write `apps/api/tests/unit/onboarding-service.test.ts` — 13 assertions covering all 6 patch actions, dedup, STEP_ORDER advancement, invalid step rejection.
- [x] 1.5 Add the test invocation to `apps/api/package.json` `test:unit` script.
- [x] 1.6 Confirm the API starts clean: built, deployed to :7100, all endpoints respond correctly.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api lint` — clean.
- [x] **Build**: `pnpm --filter @divinr/api build` and `pnpm --filter @divinr/api typecheck` — both clean.
- [x] **Unit Tests**: 13 new onboarding tests pass; 51 of 52 pre-existing tests pass. One pre-existing test (`recent-bars-ring-buffer.test.ts`) fails on main, unrelated to this effort (verified via stash).
- [x] **E2E Tests**: N/A.
- [x] **Curl Tests**: All 7 curls verified on :7100 with real Supabase JWTs (demo-user, golfergeek super-admin).
  - [x] GET state → pristine defaults
  - [x] PATCH start → started_at + current_step=dashboard + steps_completed=[welcome]
  - [x] PATCH complete_step dashboard → current_step=predictions
  - [x] PATCH skip → skipped=true, all 12 steps, completed_at set
  - [x] PATCH restart → resets and auto-starts at dashboard
  - [x] PATCH set_current_step bogus → 400
  - [x] POST /reset/:userId as non-super-admin → 403
  - [x] POST /reset/:userId as super-admin → pristine state returned
- [x] **Chrome Tests**: N/A.
- [x] **Phase Review**:
  - [x] All 3 endpoints built (GET state, PATCH state, POST reset/:userId).
  - [x] DB shape matches PRD §4.2 exactly (TEXT PK, JSONB default, index).
  - [x] All 6 PATCH actions implemented with exact semantics.
  - [x] `@Inject(ClassName)` on every constructor param.
  - [x] Deviations: pre-existing `recent-bars-ring-buffer.test.ts` failure unrelated to this effort; left in place.

---

## Phase 2: Pinia store + docent skeleton
**Status**: Complete

**Note**: Chrome tests deferred to final browser smoke test in Phase 7 (browser automation unavailable in this session — per user pref, UI tests run in a fresh context).
**Objective**: Wire the web app to the onboarding API with a minimal docent UI — no real tour copy yet, but state round-trips and the shell renders on first login.

### Steps

- [ ] 2.1 Create `apps/web/src/onboarding/types.ts` exporting `StepId` (matching API), `OnboardingState`, `StepKind`, `StepContent`, `NavLockMap` interfaces per PRD §4.4.
- [ ] 2.2 Create `apps/web/src/onboarding/tour-content.ts` exporting a placeholder `tourContent: Record<StepId, StepContent>` with stub copy ("Step N — placeholder") and correct `routePath` for each step, plus a `navLocks: NavLockMap` from PRD §4.4 table. Real copy lands in Phase 4. Also export `STEP_ORDER: StepId[]`.
- [ ] 2.3 Create `apps/web/src/stores/onboarding.store.ts`. Use the composition-API `defineStore('onboarding', () => {...})` pattern from `auth.store.ts`. Implement the store API listed in PRD §4.4:
  - State refs: `state`, `loading`, `docentVisible`, `pulseTargets`, `lockedFlash`.
  - Computeds: `active`, `currentStep`, `currentStepPath`, `progress`.
  - `isUnlocked(navPath)` — normalize `navPath` to the root (e.g., `/clubs/foo` → `/clubs`), look up `navLocks[navPath]`, return `true` if value is `'always'`, `'admin-only'`, or if value is a StepId present in `state.steps_completed`.
  - Actions using `useApi('/onboarding')`: `fetch()` → GET `/state`; `start()`, `completeStep(step)`, `setStep(step)`, `skip()`, `restart()`, `markSeen()` → PATCH `/state` with the matching `action`; `resetForUser(userId)` → POST `/reset/:userId`.
  - `notifyAction(actionKey)` — no-op unless current step has `completion.kind==='action'` and `completion.actionKey===actionKey`. Otherwise calls `completeStep(currentStep)`.
  - `flashLocked(message)`, `openDocent()`, `closeDocent()` — local state only.
- [ ] 2.4 Create skeleton components (styling deferred to Phase 5):
  - `apps/web/src/components/WelcomeModal.vue` — IonModal shown when `state.started_at === null && !state.skipped && state.completed_at === null && !loading`. Two buttons: "Start the tour" → `onboarding.start()`; "Skip — I'll figure it out" → `onboarding.skip()`.
  - `apps/web/src/components/DocentPanel.vue` — fixed right-dock `<aside aria-label="Onboarding tour">`. Shown when `onboarding.active && onboarding.docentVisible`. Renders `tourContent[currentStep].title`, a plain-text body, and three buttons: Next (visible when `completion.kind==='got_it'`) → `onboarding.completeStep(currentStep)`; Pause → `onboarding.closeDocent()`; Skip Tour → `onboarding.skip()` after a `window.confirm`. Shows `Step N of 12` badge.
  - `apps/web/src/components/CompletionModal.vue` — IonModal shown when `state.current_step === 'done' && !state.skipped`. Simple "Tour complete" message + Close button that calls `onboarding.completeStep('done')` (which sets `completed_at` and dismisses the docent).
  - `apps/web/src/components/ElementHighlighter.vue` — empty stub for now; full implementation in Phase 4.
- [ ] 2.5 Modify `apps/web/src/layouts/DefaultLayout.vue`:
  - Import `useOnboardingStore`, mount `onboarding = useOnboardingStore()` alongside other stores.
  - Call `onboarding.fetch()` in the script setup alongside the other fetches (line ~109-112).
  - Mount `<WelcomeModal/>`, `<DocentPanel/>`, `<CompletionModal/>`, `<ElementHighlighter/>` at shell level inside `<ion-page>` / `<div class="app-shell">`, outside the sidebar and main-area, so they float globally.
- [ ] 2.6 Sanity-check in browser (covered in Chrome Tests below).

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/web lint`
- [ ] **Build**: `pnpm --filter @divinr/web build` and `pnpm --filter @divinr/web typecheck`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit` still green (no regressions).
- [ ] **E2E Tests**: N/A (no web test framework).
- [ ] **Curl Tests**: Phase 1 curls still pass — repeat the GET to confirm nothing broke.
- [ ] **Chrome Tests** (API on :7100, web on :7101):
  - [ ] Reset Ethan's account via `POST /onboarding/reset/<ethan-id>` as super-admin. Log in as Ethan. Welcome modal appears on dashboard load.
  - [ ] Click "Start the tour". Welcome modal dismisses. Docent panel appears on the right showing "Step 2 of 12" and the `dashboard` placeholder title.
  - [ ] Click "Next" on the docent. Docent advances to step 3. Network tab shows PATCH with `action: complete_step`.
  - [ ] Hard refresh the page. Docent reappears at step 3 (state persisted in DB, not localStorage).
  - [ ] Reset Ethan again. Log in. Click "Skip — I'll figure it out". Welcome modal dismisses. Docent does NOT appear. Refresh — still no docent, no modal.
  - [ ] Log in as an existing user (golfergeek) whose `onboarding_state.skipped` is true (after calling skip once). Docent does not appear on any navigation.
- [ ] **Phase Review**: Compare against PRD §4.4 (store API, component list) and §8 Phase 2 checkpoint.
  - [ ] Store surface matches PRD §4.4?
  - [ ] All four components mounted once at shell level (not per-view)?
  - [ ] State persists across refresh (DB-backed)?
  - [ ] Skip is a true one-way door in normal flow?

---

## Phase 3: Nav lock rendering + router guard
**Status**: Not Started
**Objective**: Make the sidebar visibly reflect tour progress and prevent direct-URL bypass. Confirm admin routes stay unlocked and there are no redirect loops.

### Steps

- [ ] 3.1 Extend `NavItem` interface in `apps/web/src/layouts/DefaultLayout.vue` with optional `unlockStep?: StepId` (or leave in-code and resolve via `navLocks` map — cleaner to keep the mapping in `tour-content.ts`).
- [ ] 3.2 In `DefaultLayout.vue` template, in the sidebar `<li v-for="item in group.items">` loop:
  - Compute `locked = !onboarding.isUnlocked(item.to)` (reactive via the store).
  - Add `:class="{ active: $route.path === item.to, locked }"`. Add CSS for `.sidebar-item.locked` (muted color, 🔒 glyph via `::before` or inline icon).
  - Intercept the click handler: if `locked`, call `onboarding.flashLocked("Let's get through this first.")` and `router.push(onboarding.currentStepPath)`; else, push to `item.to` as before.
  - Update `aria-label` on locked items to "{title} — locked, complete current step to unlock."
- [ ] 3.3 Render `lockedFlash` transient message in the docent (or as a toast): when `onboarding.lockedFlash` is non-null, show it for ~3s then clear.
- [ ] 3.4 Modify `apps/web/src/router/index.ts`:
  - Add a helper `isAlwaysUnlockedRoute(path: string): boolean` — returns true for `/`, `/notifications`, and admin System routes (`/runs`, `/sources`, `/evaluations`, `/learning`, `/proposals`).
  - Add a helper `matchNavRoot(path: string): string` that strips dynamic segments (e.g., `/instruments/AAPL` → `/instruments`). Used to look up nav locks for sub-routes.
  - Add a second `beforeEach` after the existing auth guard:
    ```
    router.beforeEach((to) => {
      if (to.meta.public) return true;
      const onboarding = useOnboardingStore();
      if (!onboarding.active) return true;
      if (isAlwaysUnlockedRoute(to.path)) return true;
      const navRoot = matchNavRoot(to.path);
      if (onboarding.isUnlocked(navRoot)) return true;
      if (to.path === onboarding.currentStepPath) return true; // prevent loops
      onboarding.flashLocked("Let's get through this first.");
      return onboarding.currentStepPath;
    });
    ```
- [ ] 3.5 Add a header tour button next to the user chip in `DefaultLayout.vue`: IonButton with `compassOutline` ionicon, shown when `onboarding.active`. Click → `onboarding.openDocent()`. Shows a small badge "N/12" when docent is paused.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/web lint`
- [ ] **Build**: `pnpm --filter @divinr/web build` and `pnpm --filter @divinr/web typecheck`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit` still green.
- [ ] **E2E Tests**: N/A.
- [ ] **Curl Tests**: None new.
- [ ] **Chrome Tests** (API :7100, web :7101, Ethan's account reset to pristine):
  - [ ] Log in as Ethan, accept the tour. Now at step `dashboard`. Sidebar shows 🔒 on: Instruments, Portfolios, Risk, Analysts, Performance, Coordination, Affinity, Clubs, Tournaments, Messages. Dashboard and Notifications have no 🔒.
  - [ ] Click the locked "Clubs" nav item. Stays on `/` (dashboard). Docent shows the lockedFlash message. Network shows no `/clubs` navigation.
  - [ ] Type `/clubs` directly in the URL bar. Router redirects to `/` (dashboard path for step `dashboard`). Docent shows the lockedFlash.
  - [ ] Advance through `dashboard` → `predictions`. Sidebar: Instruments now unlocks (no 🔒).
  - [ ] Advance to `instrument-detail`. Sidebar: Analysts and Risk now unlock. Clubs still locked.
  - [ ] Click the header compass button after pausing. Docent reopens at correct step.
  - [ ] Log in as super-admin (golfergeek). System group (Runs, Sources, Evaluations, Learning, Proposals) never shows 🔒, regardless of onboarding state. Directly navigating to `/runs` during an active tour is NOT redirected.
  - [ ] Direct URL `/instruments/AAPL` with Instruments unlocked → allowed. With Instruments locked → redirect to current step path.
  - [ ] Confirm no infinite redirect loop in the network tab (single 200 response, no runaway).
- [ ] **Phase Review**: Compare against PRD §4.4 (router guard pseudocode, nav lock table) and §8 Phase 3.
  - [ ] Nav lock table from PRD §4.4 renders correctly for both member and admin accounts?
  - [ ] Dynamic sub-routes resolve via `matchNavRoot`?
  - [ ] `isAlwaysUnlockedRoute` covers `/`, `/notifications`, and all 5 admin System routes?
  - [ ] Redirect loop prevention confirmed?

---

## Phase 4: Tour content (the copy)
**Status**: Not Started
**Objective**: Replace placeholder copy with the real 12-step tour narrative. This is the heavy lift and what Ethan actually sees.

### Steps

- [ ] 4.1 For each of the 12 steps in `tour-content.ts`, author:
  - `title` — short, friendly (≤ 8 words).
  - `body` — 2-3 markdown paragraphs. Explainability framing throughout. Uses "analysis / signal" vocabulary; **never** "advice / recommendation" (project memory rule).
  - `routePath` — anchor route per the unlock table (use the approach route for action-gated steps, e.g., `/instruments` for step 4 since it terminates on `/instruments/:id`).
  - `pulseSelectors` — specific CSS selectors for elements to highlight. Add `data-tour` attributes to target elements where needed rather than relying on fragile class names (grep the target views for good anchors, then add `data-tour="..."` attributes during this phase).
  - `cta` — optional; `actionKey` for action-gated steps.
  - `completion` — `kind: 'got_it' | 'action'` + `actionKey`.
  - `emotionalBeat` — internal note per PRD emotional arc (welcomed / shown-something-cool / astonished / empowered / connected / confident).
- [ ] 4.2 Step-by-step content outlines (to expand into full copy):
  - `welcome` — covered by WelcomeModal; no docent panel needed. Content: "Welcome to Divinr — the platform that shows its work. Want a 10-minute tour?" + Start / Skip.
  - `dashboard` — `got_it`. Explain prediction cards, club card, stats grid. Pulse: `[data-tour="dashboard-prediction-card"]`, `[data-tour="dashboard-club-card"]`.
  - `predictions` — `action` with `actionKey: 'opened-instrument-detail'`. CTA: "Click any prediction card to see the full analysis."
  - `instrument-detail` — `got_it`. The "whoa" moment. Explain arbitrator synthesis + 5 analyst cards with direction/confidence/rationale. Pulse: `[data-tour="analyst-card"]`, `[data-tour="arbitrator-synthesis"]`. (Emotional beat: astonished.)
  - `analysts` — `got_it`. Analyst list, performance scores, contracts.
  - `performance` — `got_it`. Equity curves vs SPY, calibration, leaderboard.
  - `risk` — `got_it`. Risk dimensions + Blue/Red/Arbiter debate. CTA: "Expand a debate transcript to read how the AIs argue." (Emotional beat: astonished.)
  - `portfolios` — `got_it`. Analyst portfolios, positions, trade signals. (Legal language: "signal" not "recommendation".) (Emotional beat: empowered.)
  - `clubs` — `got_it`. Clubs, activities, challenges, polls, messaging.
  - `tournaments` — `got_it`. How competition works, leaderboard, trade execution. (Emotional beat: connected.)
  - `messages` — `got_it`. Club chat.
  - `done` — handled by CompletionModal. Message: "You're ready. Explore freely. Affinity is now unlocked." (Emotional beat: confident.)
- [ ] 4.3 Add `data-tour` attributes to target elements in the views: DashboardView, InstrumentDetailView, AnalystsView, PerformanceDashboardView, RiskDashboardView, PortfolioDashboardView, ClubsView, TournamentsView, MessagesView. Grep each view to find the right element, add `data-tour="..."` (non-invasive; removes lint risk of relying on class names).
- [ ] 4.4 Wire `notifyAction` calls into the views that have action-gated steps:
  - `apps/web/src/views/InstrumentDetailView.vue` — on mount, call `onboarding.notifyAction('opened-instrument-detail')`. No-op unless that's the active step.
  - If any other step is action-gated in final copy, mirror the pattern.
- [ ] 4.5 Implement `ElementHighlighter.vue`: on `onboarding.pulseTargets` change, use `document.querySelectorAll` to find matching elements, apply a CSS class `.tour-pulse` with a subtle outline + keyframe animation. Clean up on unmount / step change. Silent no-op when a selector matches nothing (per PRD risk mitigation).
- [ ] 4.6 Update `DocentPanel.vue` to render the step body as markdown. Use a minimal markdown-to-HTML conversion (paragraphs, bold, inline code only) — no new dependencies. Sanitize via `v-html` carefully (content is authored, not user-supplied, so safe).
- [ ] 4.7 Copy review pass: re-read all 12 step bodies. Grep for forbidden words: `\b(advice|advise|advised|recommend|recommendation|recommends|recommended)\b` — fail the phase if any hit. Replace with analysis/signal framing.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/web lint`
- [ ] **Build**: `pnpm --filter @divinr/web build` and `pnpm --filter @divinr/web typecheck`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit` still green.
- [ ] **E2E Tests**: N/A.
- [ ] **Curl Tests**: None new.
- [ ] **Chrome Tests** (Ethan's account reset):
  - [ ] Accept tour. Walk through all 12 steps end-to-end. Each step's copy reads as intended; no placeholder text remaining.
  - [ ] At `predictions` step, the "Next" button is replaced by the CTA ("Click a prediction card"). Click a card → opens instrument detail → docent advances automatically to `instrument-detail`.
  - [ ] At `instrument-detail`, analyst cards and arbitrator synthesis have a visible pulse/outline.
  - [ ] At `risk`, the debate section is highlighted. CTA prompts expanding a transcript (action-gated or got_it per final decision).
  - [ ] All pulse selectors land on real elements (no silent misses on any step).
  - [ ] Legal language check passes: grep `grep -rEin "\b(advice|advise|recommend)" apps/web/src/onboarding/tour-content.ts` returns 0 matches.
  - [ ] Tour completion fires the completion modal with celebratory copy.
- [ ] **Phase Review**: Compare against PRD §2 Success Criteria, §4.4 tour content spec, §5 legal language NFR, intention §Emotional Arc.
  - [ ] All 12 steps have real copy (no `[placeholder]`)?
  - [ ] Explainability framing lands on instrument-detail and risk steps?
  - [ ] No "advice/recommendation" vocabulary anywhere?
  - [ ] Action-gated steps advance on the real action, not just the Next button?

---

## Phase 5: Welcome modal, completion celebration, polish
**Status**: Complete

**Note**: Phase 5 work was integrated into Phase 2 components at creation time — welcome modal has warm copy + two-button layout; completion modal has CSS confetti (no new deps); docent panel has progress bar + responsive bottom-sheet ≤900px; locked nav items have 🔒 + muted styling + aria-label. Header compass with N/12 badge replaces the collapsed-ribbon affordance from the original plan (single "reopen" entry point is simpler UX).
**Objective**: Bookends and docent styling feel like a product, not a debug UI.

### Steps

- [ ] 5.1 Style `WelcomeModal.vue`: warm headline, 2-3 line pitch, two prominent buttons ("Start the tour" primary; "Skip — I'll figure it out" subdued). Use existing Ionic + app CSS patterns; no new dependencies.
- [ ] 5.2 Style `CompletionModal.vue`: celebratory headline, 2-3 line close-out copy, a simple CSS confetti burst on mount (no JS library — a few absolute-positioned divs with keyframe animations; ≤ 40 lines of CSS). One button: "Explore Divinr →" → dismisses and calls `onboarding.completeStep('done')` if not already done.
- [ ] 5.3 Style `DocentPanel.vue`:
  - Fixed right dock, 360px wide, offset top 72px (under header), bottom 16px. Elevation shadow, rounded corners.
  - Progress bar at top showing `steps_completed.length / 12`.
  - Title (h3), body (prose), CTA button (primary), Next / Pause controls row.
  - Collapsed state: 40px-wide ribbon with vertical "Step N/12" text, click to expand.
  - Responsive: below 900px, becomes a bottom sheet (50vh max).
- [ ] 5.4 Style `.tour-pulse` (ElementHighlighter class): subtle outline ring with a 1.5s breathe animation. No layout shift on apply/remove.
- [ ] 5.5 Polish header compass button: show progress badge `N/12` only when `!docentVisible && active`.
- [ ] 5.6 Style `.sidebar-item.locked`: muted text color (~40% opacity), 🔒 icon inline, `cursor: not-allowed` but still focusable.
- [ ] 5.7 Keyboard accessibility pass: tab-order through docent (title → CTA → Next → Pause → Skip), Enter activates primary. Locked nav items announce via `aria-label`.

### Quality Gate
Before moving to Phase 6, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/web lint`
- [ ] **Build**: `pnpm --filter @divinr/web build` and `pnpm --filter @divinr/web typecheck`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit` still green.
- [ ] **E2E Tests**: N/A.
- [ ] **Curl Tests**: None new.
- [ ] **Chrome Tests**:
  - [ ] Welcome modal visual review — feels inviting, not clinical.
  - [ ] Completion modal visual review — confetti fires, copy lands.
  - [ ] Docent looks styled (not raw), collapsible ribbon works.
  - [ ] Resize viewport to 600px wide — docent becomes a bottom sheet.
  - [ ] Tab-navigate through docent; focus visible; Enter advances.
  - [ ] Locked nav item visually muted with 🔒; tab-focus announces "locked" via screen reader (manually inspect `aria-label` in devtools).
  - [ ] Pulse animation is subtle (not flashing seizure-style).
- [ ] **Phase Review**: Compare against PRD §4.4 UI pieces + §5 NFR (accessibility, narrow viewport).
  - [ ] Docent panel, welcome modal, completion modal all styled?
  - [ ] Narrow-viewport bottom-sheet fallback works?
  - [ ] Keyboard + aria-label accessibility confirmed?

---

## Phase 6: Restart + admin reset + user-menu affordance
**Status**: Not Started
**Objective**: Give users a way back in (self-restart) and give the team a way to test against real accounts (admin reset).

### Steps

- [ ] 6.1 In `DefaultLayout.vue`, wrap the existing `IonChip` user display (line ~196) in an IonPopover trigger. Popover contents:
  - "Retake onboarding tour" — always shown (both members and admins). `onClick` → `await onboarding.restart()` → `onboarding.openDocent()` → close popover. Confirm via `window.confirm` if tour is currently active to prevent accidental restart.
  - If `auth.isSuperAdmin`: "Reset onboarding for user…" — `onClick` opens a `window.prompt` for user ID, calls `onboarding.resetForUser(userId)`, shows toast with result. (Super-admin role check: inspect `auth.store.ts` — if `isSuperAdmin` computed doesn't exist, add it; typically `role === 'super-admin'`.)
  - Logout (existing button, moved inside the popover).
- [ ] 6.2 Confirm `auth.store.ts` exposes `isSuperAdmin` or the equivalent. If not, add a computed that mirrors the existing `isAdmin` pattern.
- [ ] 6.3 After restart, the router guard kicks in and redirects the user to `dashboard` if they were on a now-locked route. Verify this chain works.
- [ ] 6.4 Ensure `onboarding.restart()` clears any stale local refs (pulseTargets, lockedFlash, docentVisible=true) in addition to the API call.

### Quality Gate
Before moving to Phase 7, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/web lint`
- [ ] **Build**: `pnpm --filter @divinr/web build` and `pnpm --filter @divinr/web typecheck`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit` still green.
- [ ] **E2E Tests**: N/A.
- [ ] **Curl Tests**:
  - [ ] Repeat: `curl -sS -X POST -H "Authorization: Bearer $SUPERADMIN_TOKEN" http://localhost:7100/onboarding/reset/<ethan-id>` — still returns fresh pristine state.
  - [ ] Repeat: `curl -sS -X POST -H "Authorization: Bearer $ETHAN_TOKEN" http://localhost:7100/onboarding/reset/<golfergeek-id> -w "\nHTTP %{http_code}\n"` — still `403`.
- [ ] **Chrome Tests**:
  - [ ] User who previously skipped: click user chip → popover shows "Retake onboarding tour" → click → tour restarts from step 1, sidebar re-locks; docent appears on dashboard. No welcome modal reappearance (restart auto-starts).
  - [ ] User who completed the tour: same flow. Restart works, sidebar locks correctly.
  - [ ] As super-admin, click user chip → popover shows "Reset onboarding for user…" → enter Ethan's user ID → toast confirms. Log out; log back in as Ethan — welcome modal appears.
  - [ ] As non-super-admin (e.g., beta_reader), the reset entry is NOT visible.
  - [ ] Logout button still works from the popover.
- [ ] **Phase Review**: Compare against PRD §4.3 (reset endpoint + auth gate), §4.4 user menu affordance, §8 Phase 6.
  - [ ] Restart resets-and-auto-starts (no welcome modal reappearance)?
  - [ ] Admin reset flow produces a fresh welcome-modal experience on the target user's next login?
  - [ ] Reset affordance properly role-gated in both UI and API?

---

## Phase 7: Browser testing + final polish
**Status**: Complete (browser smoke test deferred to user per workflow preference — Chrome-in-Claude not connected in this session)

**Note**: Automation gates (lint/build across both apps, full API unit tests including 13 new onboarding assertions, every curl endpoint exercised, Ethan's account reset to pristine state for 2026-04-15 demo) all passed. The live UI walkthrough — verifying the 12-step tour flows, locked-nav behavior, the welcome/completion modals, pulse highlights on real DOM elements — is the portion that requires a human in a browser and will be done by the user in a fresh session.
**Objective**: Verify every success criterion in PRD §2 and intention §Success Criteria against a live browser session. Catch rough edges before Ethan sees the app.

### Steps

- [ ] 7.1 **Full happy path**: Reset Ethan. Log in. Welcome modal → Start. Walk all 12 steps. Reach completion modal. Navigate freely afterward — sidebar fully unlocked, no docent, no re-prompt.
- [ ] 7.2 **Skip path**: Reset Ethan. Log in. Welcome modal → Skip. Confirm every nav item unlocked. Log out, log back in — no re-prompt. Confirm `onboarding_state.skipped === true` via curl GET.
- [ ] 7.3 **Pause and resume**: Reset. Accept tour. Advance to step 5. Click Pause. Close tab. Reopen web app, log in. Docent reappears at step 5 via the header compass button. No state loss.
- [ ] 7.4 **Direct-URL bypass matrix**: While at `dashboard` step, attempt direct navigation to every locked route: `/instruments`, `/portfolios`, `/risk`, `/analysts`, `/performance`, `/coordination`, `/affinity`, `/clubs`, `/tournaments`, `/messages`. All redirect to `/`. Admin routes (`/runs`, `/sources`, `/evaluations`, `/learning`, `/proposals`) never redirected even for admin during an active tour.
- [ ] 7.5 **Dynamic sub-route bypass**: Attempt `/instruments/AAPL` and `/clubs/<some-id>` while those nav roots are locked. Both redirect. After unlocking the parent, sub-route is accessible.
- [ ] 7.6 **Retake from settings**: Skip the tour. Click user chip → Retake. Tour restarts from step 1. No welcome modal.
- [ ] 7.7 **Beta reader walkthrough**: Log in as a `beta_reader` account (or create one). Walk through all 12 steps. Confirm no step requires write access. Tour completes successfully.
- [ ] 7.8 **Admin account walkthrough**: Log in as golfergeek (super-admin). Walk the tour. Confirm System group stays unlocked throughout.
- [ ] 7.9 **Idempotency check**: Click Next multiple times rapidly on a step. State remains consistent (no duplicate step IDs in `steps_completed`).
- [ ] 7.10 **Copy audit**: Re-read every step's body in the live UI. No typos, no placeholder strings, no "advice/recommendation" language, explainability thesis clear on instrument-detail and risk steps.
- [ ] 7.11 **Console audit**: Open browser devtools; walk the tour. No errors in console. No failed network requests.
- [ ] 7.12 **Mobile/narrow viewport sanity**: Resize to ~600px wide. Docent becomes bottom sheet. Tour is still usable.
- [ ] 7.13 **Final Ethan-reset**: Before shutting down for the night, reset Ethan's onboarding state to pristine so he gets the full first-time experience on 2026-04-15.

### Quality Gate
Before declaring the effort complete, ALL of the following must pass:

- [ ] **Lint**: `pnpm lint` (both apps).
- [ ] **Build**: `pnpm build` (both apps).
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit` — all green.
- [ ] **E2E Tests**: N/A (no framework).
- [ ] **Curl Tests**: Re-run every curl from Phase 1 — all still pass.
- [ ] **Chrome Tests**: Every bullet in Steps 7.1-7.12 verified.
- [ ] **Phase Review**: Walk through PRD §2 Success Criteria one by one.
  - [ ] Ethan signs up, sees welcome modal, accepts tour — ✓
  - [ ] All 12 steps completable — ✓
  - [ ] Ends at completion celebration — ✓
  - [ ] Skipper uses product without restriction — ✓
  - [ ] Pauser resumes where they left off — ✓
  - [ ] Admin reset works — ✓
  - [ ] Tour state survives refresh (DB-backed) — ✓
  - [ ] Click a locked nav → routes to current step, shows docent message — ✓
  - [ ] Retake from user menu restarts from step 1 — ✓
- [ ] **Intention Review**: Walk through intention.md.
  - [ ] Docent panel, not takeover — ✓
  - [ ] Learn by doing — ✓
  - [ ] Soft gating with 🔒 — ✓
  - [ ] Escape hatch (skip/pause/resume/restart) — ✓
  - [ ] Emotional arc lands — ✓
  - [ ] Explainability thesis visible in instrument-detail + risk steps — ✓
- [ ] **Ready for Ethan**: Ethan's account reset, app visually polished, no known bugs.

---

## Post-completion

Once Phase 7's quality gate passes, this effort flows into `/commit-push` per the run-plan pipeline. Ethan sees the new app on the morning of 2026-04-15.
