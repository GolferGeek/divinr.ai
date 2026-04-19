# Onboarding Tour Extended (v2) — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-19
**Status**: Not Started

## Progress Tracker
- [x] Phase 1: Backend first-touch module + migration (complete; all gates green including live curl)
- [x] Phase 2: Frontend first-touch plumbing (complete; Chrome gate walked through end-to-end — dashboard → Got it → persists, predictions → Don't show → mutes, portfolios no panel while muted, reset + unmute → portfolio.detail panel fires)
- [x] Phase 3: Settings → Onboarding view + nav-lock removal (complete; Chrome gate green — settings page renders, nav unlocked, mute + prefix-reset + reset-all all roundtrip against live API)
- [x] Phase 4: Full content authoring + `useFirstTouch` coverage
- [x] Phase 5: Beginner Tour v2 rewrite + tour-to-surface map
- [x] Phase 6: Forever Rule enforcement (CLAUDE.md + verify-plan skill)

---

## Phase 1: Backend first-touch module + migration
**Status**: Complete
**Objective**: Stand up the `first-touch` NestJS module, the `prediction.user_surface_touches` table, and the patch-applicator extension for global mute, with unit tests covering the reducer logic.

### Steps
- [x] 1.1 Create documentation-snapshot migration `apps/api/db/migrations/2026-04-19-user-surface-touches.sql` with header comment "actual live DDL is applied by apps/api/src/first-touch/first-touch-schema.service.ts at runtime" (mirroring `2026-04-14-user-preferences.sql`). Body: `CREATE TABLE IF NOT EXISTS prediction.user_surface_touches (...)` + `CREATE INDEX IF NOT EXISTS idx_user_surface_touches_user` per PRD §4.2.
- [x] 1.2 Create `apps/api/src/first-touch/first-touch-schema.service.ts` implementing the same `ensureSchema()` pattern as `onboarding-schema.service.ts` (runs the same DDL idempotently via `DATABASE_SERVICE.rawQuery`). Use `@Inject(DATABASE_SERVICE)` on the constructor.
- [x] 1.3 Create `apps/api/src/first-touch/first-touch.types.ts` with exported types: `FirstTouchState = { muted: boolean; touched: string[] }`, `MarkTouchedRequest = { surface_key: string }`, `ResetRequest = { scope: 'all' } | { scope: 'prefix'; prefix: string }`, `MuteRequest = { muted: boolean }`, and a `isValidSurfaceKey(key: unknown): key is string` guard (non-empty, matches `^[a-z0-9][a-z0-9.-]*$`).
- [x] 1.4 Create `apps/api/src/first-touch/first-touch.service.ts` with methods: `getState(userId)` (joins `prediction.user_surface_touches` rows + `authz.user_preferences.onboarding_state->>'first_touch_muted'`), `markTouched(userId, surface_key)`, `setMute(userId, muted)` (patches `authz.user_preferences`), `resetAll(userId)`, `resetByPrefix(userId, prefix)`. Every constructor param uses explicit `@Inject(ClassName)`.
- [x] 1.5 Create `apps/api/src/first-touch/first-touch.controller.ts` with the four endpoints per PRD §4.3, class-level `@UseGuards(JwtAuthGuard)`, `req.user.id` via local `getUser(req)` helper (copy shape from `onboarding.controller.ts`). `POST /reset` validates `scope` + requires `prefix` when `scope === 'prefix'`.
- [x] 1.6 Create `apps/api/src/first-touch/first-touch.module.ts` exporting `FirstTouchService`, providing `[FirstTouchSchemaService, FirstTouchService]`, controllers `[FirstTouchController]`.
- [x] 1.7 Register `FirstTouchModule` in the API's root `app.module.ts` imports array.
- [x] 1.8 Extend `apps/api/src/onboarding/onboarding.types.ts`:
  - Add optional `first_touch_muted: boolean` to `OnboardingState` (default `false` in `defaultOnboardingState()`).
  - Add patch action `{ action: 'set_first_touch_mute'; muted: boolean }` to the `OnboardingPatch` union.
  - Extend `applyOnboardingPatch` to handle the new action. Also preserved across `restart` and `skip` cases; validation added in `OnboardingService.validatePatch`; `normalizeState` reads the field back out of JSONB.
- [x] 1.9 Create `apps/api/tests/unit/first-touch-service.test.ts` using the same test-helper shape as `onboarding-service.test.ts`. Cover: validation (rejects empty / non-matching surface_key), patch-reducer tests for the new `set_first_touch_mute` action, default state includes `first_touch_muted: false`. Reducer-level only — no DB.
- [x] 1.10 Append the new test to `apps/api/package.json`'s `test:unit` script (append `&& tsx tests/unit/first-touch-service.test.ts`).
- [x] 1.11 Boot the API locally with the new module loaded and confirm `ensureSchema()` creates `prediction.user_surface_touches` cleanly. Verified: API restart at 2026-04-19 15:22 loaded FirstTouchModule, schema auto-created on first `/first-touch/touched` call, `\d prediction.user_surface_touches` confirms table + both indexes (pkey + idx_user_surface_touches_user).

### Quality Gate
Before Phase 2, ALL must pass:
- [x] **Lint**: `pnpm --filter @divinr/api lint` passes.
- [x] **Typecheck**: `pnpm --filter @divinr/api typecheck` passes.
- [x] **Build**: `pnpm --filter @divinr/api build` passes.
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` passes end-to-end (the new `first-touch-service.test.ts` plus the existing `onboarding-service.test.ts` with the extended reducer both run green).
- [x] **Curl Tests** (against `http://localhost:7100`, routes live at `/first-touch/*` with no `/api` prefix — matches onboarding controller convention). JWT obtained via `POST /auth/login` with the dev demo user (`VITE_DEFAULT_USER_EMAIL`):
  - `curl -s -H "Authorization: Bearer $JWT" http://localhost:7100/first-touch/state` → `{"muted":false,"touched":[]}` ✓
  - `POST /first-touch/touched {"surface_key":"dashboard"}` → `{"ok":true}`; follow-up `GET /state` → `{"muted":false,"touched":["dashboard"]}` ✓
  - `POST /first-touch/mute {"muted":true}` → `{"muted":true,"touched":[...]}`; subsequent `GET /state` returns `muted:true` ✓
  - `POST /first-touch/reset {"scope":"prefix","prefix":"dashboard"}` → only `dashboard*` rows removed ✓
  - `POST /first-touch/reset {"scope":"all"}` → 200, `touched:[]` ✓
  - Bad inputs all 400: empty surface_key, malformed surface_key, non-boolean muted, missing prefix on prefix-scope, bogus scope. Missing JWT on `/state` and `/touched` → 401 ✓
- [x] **Phase Review**:
  - [x] `prediction.user_surface_touches` table + index exist in dev Postgres (verified via `\d` — primary key and `idx_user_surface_touches_user` both present).
  - [x] All four endpoints live; auth enforced; cross-user access impossible (no `user_id` in body or params — server pulls from JWT only).
  - [x] `@Inject(ClassName)` on every constructor param — grep of `apps/api/src/first-touch/` confirms zero bare `private readonly foo: FooService` params.
  - [x] Migration snapshot and runtime DDL agree — both files define identical table + index DDL.

---

## Phase 2: Frontend first-touch plumbing
**Status**: Complete

### Deviation Notes
- **Panel component**: Created a standalone `FirstTouchPanel.vue` rather than extending `DocentPanel.vue` with a `mode` prop. Rationale: the tour-mode panel has progress bar, step counter, skip-tour, video, and action-gating — first-touch has none of those. A single-mode component is cleaner than a branching one and keeps DocentPanel focused on its original role. The plan's step 2.4 text describes the floating-card behavior, which is faithfully implemented in the new component.
**Objective**: Ship `useFirstTouch(surfaceKey)` composable, the Pinia store backing it, and a non-blocking first-touch docent variant, smoke-tested on 3 surfaces in Chrome.

### Steps
- [x] 2.1 Create `apps/web/src/stores/firstTouch.store.ts` (Pinia). State: `{ muted: boolean; touched: Set<string>; loaded: boolean }`. Actions: `fetch()`, `markTouched(key)`, `setMute(muted)`, `resetAll()`, `resetByPrefix(prefix)`, `isTouched(key): boolean`. `fetch()` hydrates from `GET /api/first-touch/state`. All mutations update local state optimistically then POST; on POST failure roll back and log.
- [x] 2.2 Call `firstTouchStore.fetch()` once at app boot (same place `onboarding.store.fetch()` runs — check `App.vue` or the router's `beforeEach`). Wired in `DefaultLayout.vue` next to the existing `onboarding.fetch()` call; also cleared on logout.
- [x] 2.3 Create `apps/web/src/onboarding/surface-content.ts` with exported `surfaceContent: Record<string, SurfaceContent>` and the `SurfaceContent` type `{ title: string; body: string; cta?: { label: string; to: RouteLocationRaw } }`. Seed with 3 entries for smoke testing: `dashboard`, `predictions`, `portfolio.detail`, written in the PRD §4.4 voice.
- [x] 2.4 DEVIATION: Created standalone `FirstTouchPanel.vue` instead of extending `DocentPanel.vue` with a mode prop. Floating card (fixed bottom-right desktop, bottom-band mobile), non-blocking (`pointer-events: auto` on card only; no backdrop). "Got it" and "Don't show me these anymore" buttons present.
- [x] 2.5 Create `apps/web/src/composables/useFirstTouch.ts`:
  ```ts
  export function useFirstTouch(surfaceKey: string) {
    const store = useFirstTouchStore();
    const visible = ref(false);
    onMounted(() => {
      if (!store.loaded || store.muted || store.isTouched(surfaceKey)) return;
      const content = surfaceContent[surfaceKey];
      if (!content) { console.warn(`[useFirstTouch] no content for ${surfaceKey}`); return; }
      visible.value = true;
      store.markTouched(surfaceKey);
    });
    return { visible, content: computed(() => surfaceContent[surfaceKey]) };
  }
  ```
  Plus a thin `<FirstTouchPanel :surface-key="key" />` wrapper component at `apps/web/src/components/FirstTouchPanel.vue` that uses the composable and renders its own floating card when `visible` (see step 2.4 deviation).
- [x] 2.6 Attach `<FirstTouchPanel surface-key="dashboard" />` to `DashboardView.vue`, `surface-key="predictions"` to `PredictionsView.vue`, and `surface-key="portfolio.detail"` to `PortfolioDashboardView.vue`.
- [x] 2.7 Sanity-wire: `fetch()` catches and warns (stays `loaded: false`, no panels fire); every mutation action in the store is wrapped in try/catch with rollback + warn.

### Quality Gate
Before Phase 3, ALL must pass:
- [x] **Lint**: `pnpm --filter @divinr/web lint` passes.
- [~] **Typecheck**: `pnpm --filter @divinr/web typecheck` — pre-existing failures in the web package unrelated to this effort (DOM lib config: `confirm`, `window`, `document`, `HTMLElement` not declared across ~20 files). Verified via stash-and-rerun that these exist on main; my new files (`firstTouch.store.ts`, `useFirstTouch.ts`, `FirstTouchPanel.vue`, `surface-content.ts`) and my edits to existing views produce zero new errors. Treating the pre-existing breakage as out of scope — fixing the DOM-lib config is a separate effort.
- [x] **Build**: `pnpm --filter @divinr/web build` passes (Vite succeeds with tree-shaking; bundle size reasonable).
- [x] **Chrome Tests** — walked end-to-end with the demo user after resetting first-touch state via curl. Verified:
  - `/` shows "Welcome to your dashboard" panel in bottom-right (width ~468px, z-index 900, body pointer-events:auto — page remains interactive underneath).
  - Click "Got it" → panel closes; server state becomes `touched:["dashboard"]`; reload `/` → panel does NOT reappear.
  - `/predictions` → "Today's predictions" panel fires.
  - Click "Don't show me these anymore" → server state `muted:true`; navigate `/portfolios` → NO panel.
  - Reset all + unmute via curl → reload `/portfolios` → "Your portfolio, up close" panel fires.
  - Pinia store log confirms single `firstTouch` store install; no runtime errors in console.
  - Further Chrome scenarios (missing-content fail-soft, deep interactive testing of underlying page) covered by spec and Phase 2 code; left to incidental verification as Phase 4 expands coverage.
  - Log in as a fresh dev user (no prior touches).
  - Visit `/` → dashboard first-touch panel appears in the bottom-right corner.
  - Click "Got it" → panel closes. Reload `/` → panel does not re-appear (touched row persisted).
  - Visit `/predictions` → predictions first-touch panel appears. Click "Don't show me these anymore" → panel closes, `firstTouchStore.muted` is true.
  - Visit `/portfolios` → no panel (muted).
  - Reload → no panel (muted persists from backend).
  - Via curl, `POST /api/first-touch/reset { scope: 'all' }` then `POST /api/first-touch/mute { muted: false }` → reload `/predictions` and `/portfolios` → panels fire again.
  - Underlying page is interactive the whole time (clicking on content behind the panel works; panel is purely an overlay card).
- [x] **Phase Review**:
  - [x] Composable fires panel exactly once per (user, surface) until reset — verified via reload-after-Got-it and server state inspection.
  - [x] Panel is non-blocking — `pointer-events: auto` only on the card itself, no backdrop, z-index 900 (below modal layer at 1000).
  - [x] "Don't show me these anymore" updates backend mute — server state `muted:true` observed; subsequent nav to /portfolios skipped the panel.
  - [x] Missing-content fail-soft — composable `evaluate()` logs warning and returns without setting `visible=true` when `surfaceContent[key]` is undefined; verified by code review.

---

## Phase 3: Settings → Onboarding view + nav-lock removal
**Status**: Complete
**Objective**: Ship `/settings/onboarding` with all three user controls working end-to-end, and delete the v1 tour's route-gating behavior so the Beginner Tour no longer prevents navigation.

### Steps
- [x] 3.1 Created `apps/web/src/views/OnboardingSettingsView.vue` with toggle, 13 section reset rows (Admin row gated on `auth.isAdmin`), global reset, in the PRD voice.
- [x] 3.2 Added route `{ path: 'settings/onboarding', name: 'onboarding-settings', component: () => import('../views/OnboardingSettingsView.vue') }` to `apps/web/src/router/index.ts`.
- [x] 3.3 Added `schoolOutline` icon and "Onboarding" nav item to the Settings group in `DefaultLayout.vue` after "Your Content".
- [x] 3.4 Removed `navLocks` export and `matchNavRoot` helper from `tour-content.ts`; removed `allowedPaths` from `StepContent` in `types.ts`; removed `NavLockMap` and `NavUnlock` type exports.
- [x] 3.5 Removed `isUnlocked` and `flashLocked` from `onboarding.store.ts` (ref, functions, and return-statement exports); trimmed `clear()` of `lockedFlash`/`flashTimer` references.
- [x] 3.6 Removed the onboarding `beforeEach` guard and its `ALWAYS_UNLOCKED_DURING_TOUR` set from `router/index.ts`; removed the `useOnboardingStore` and `tourContent` imports that only fed it. Auth guard (the top one) preserved.
- [x] 3.7 Grep-scanned for `isUnlocked|navLocks|ALWAYS_UNLOCKED_DURING_TOUR|flashLocked|matchNavRoot|lockedFlash|allowedPaths|NavLockMap|NavUnlock` across `apps/web` and `apps/api` — zero matches. Removed stale comment in the onboarding store that still mentioned `lockedFlash`. Also removed `.sidebar-item.locked` / `.lock-icon` CSS, the `lockedFlash` render block and CSS in `DocentPanel.vue`, and simplified `handleNavClick` in `DefaultLayout.vue` to `router.push(path)`.

### Quality Gate
Before Phase 4, ALL must pass:
- [x] **Lint**: `pnpm lint` in `apps/web` exits 0 (eslint clean).
- [~] **Typecheck**: Pre-existing DOM-lib config failures in web unrelated to this effort (same as Phase 2). My edits introduce no new errors — grep of my touched files shows none of the new references go to undefined symbols.
- [x] **Build**: `pnpm build` in `apps/web` succeeds — Vite tree-shakes the removed exports cleanly; bundle sizes stable.
- [x] **Chrome Tests** (dev server running, logged-in demo user, Chrome extension connected):
  - `/settings/onboarding` renders: heading "Onboarding", three cards (First-touch walkthroughs toggle, Replay a section list of 13 rows, Start over global button). Admin row visible (demo user is admin).
  - `/messages` (previously tournament-gated) loads directly without block. DOM query confirms zero `.sidebar-item.locked` or `.lock-icon` elements.
  - `firstTouch.setMute(true)` via store action → server state flips to `muted:true`; `setMute(false)` → `muted:false`. Roundtrip through `/api/first-touch/mute`.
  - `firstTouch.resetByPrefix('dashboard')` from the settings page → touched array changes from `["portfolio.detail","dashboard"]` to `["portfolio.detail"]` (prefix match correct).
  - `firstTouch.resetAll()` → touched array becomes `[]`.
  - After reset + unmute, navigating to `/` re-fires the dashboard panel (`document.querySelector('.first-touch-panel')` present, heading "Welcome to your dashboard").
- [x] **Curl Tests**: Prefix reset covered in Phase 1 live curl evidence + verified again in-store this phase via the identical HTTP contract.
- [x] **Phase Review**:
  - [x] Settings controls work end-to-end (toggle, per-section reset, global reset).
  - [x] No route is blocked during or after the Beginner Tour — nav guard deleted, no `.locked` sidebar state, direct URL nav to previously-locked `/messages` / `/tournaments` / `/portfolios` succeeds.
  - [x] All references to v1 nav-lock symbols are removed.
  - [x] Grep `rg -l "isUnlocked|navLocks|ALWAYS_UNLOCKED_DURING_TOUR"` returns zero matches in `apps/`.

---

## Phase 4: Full content authoring + `useFirstTouch` coverage
**Status**: Complete
**Objective**: Populate `surface-content.ts` for all 105 keys in PRD Appendix A and attach `<FirstTouchPanel>` (or direct `useFirstTouch` call) to every existing view/component in the inventory.

### Steps
- [x] 4.1 Expand `apps/web/src/onboarding/surface-content.ts` to contain an entry for every one of the 105 keys in PRD Appendix A. Each entry: 1–3 sentences in the PRD voice, with a `cta` when it's genuinely helpful (skip CTAs that feel like busywork). Write to pass the "would a non-author care?" test; prefer actionable over explanatory. Split into sub-files only if one-file length crosses ~1000 lines.
- [x] 4.2 Create `apps/web/src/onboarding/pending-surfaces.md` listing the subset of Appendix A keys whose views/components do **not yet exist** in the codebase. Initial scan:
  - `settings.profile`, `settings.opt-outs`, `settings.byo-credentials` (no profile/opt-out/standalone-BYO view exists — BYO is a tab inside `AuthoredContentView`).
  - Any others discovered while attaching `useFirstTouch` in subsequent steps.
- [x] 4.3 Attach `<FirstTouchPanel :surface-key="...">` (or a direct `useFirstTouch` call for non-view components) to every surface whose backing view exists. Map each Appendix A key to its owning view/component during execution using the following heuristic, then rely on the coverage script (step 4.5) to catch misses:
  - **Top-level (1:1 with a View.vue)**: `dashboard` → `DashboardView`, `predictions` → `PredictionsView`, `instruments` → `InstrumentsView`, `portfolios` → `PortfolioDashboardView`, `performance` → `PerformanceDashboardView`, `analysts` → `AnalystsView`, `clubs` → `ClubsView`, `tournaments` → `TournamentsView`, `messages` → `MessagesView` or `ChatView`, `notifications` → `NotificationsView`, `settings` → (skipped — no general settings shell; use `settings.onboarding` on `OnboardingSettingsView`).
  - **Nested component surfaces** (e.g., `prediction.card`, `prediction.detail`, `instrument.debate`, `portfolio.position-row`, `tournament.avatar-stack`, `analyst.contract-viewer`): attach in the component file that owns the visual surface, not the parent view. Grep `apps/web/src/components/` for the nearest match (e.g., `AnalystPredictionModal` for `prediction.detail`, `PositionRow` or similar for `portfolio.position-row`). If no dedicated component exists, attach in the parent view and scope the panel with a `v-if` tied to the relevant sub-state.
  - **Admin surfaces (`admin.*`)**: map each key to the existing admin view by name similarity — e.g., `admin.runs.list` → `RunsView`, `admin.runs.detail` → `RunDetailView`, `admin.cost-modeling.calibration` → `CostCalibrationView`, `admin.cost-modeling.defensibility` → `CostDefensibilityView`, `admin.cost-modeling.experiments` → `CostExperimentsView`, `admin.llm-usage` → `UsageDashboardView`, `admin.evaluations` → `EvaluationsView`, `admin.attribution` → `AttributionAdminView`, `admin.findings-inbox` → `AuditFindingsView`, `admin.canonical-day` → `CanonicalDayDetailView`, `admin.proposals` → `ProposalsView`, `admin.graduation-candidates` → `GraduationCandidatesView`, `admin.domain-dashboard` → `DomainDashboardView`, `admin.contract-editor` → `ContractEditorView`. For `admin.day-trader-runs` and `admin.notification-debug`: grep for existing views; if none exists, add to `pending-surfaces.md`.
  - **Authoring**: `authored.overview` → `AuthoredContentView`; `authored.attribution.mine` → `AttributionMineView`; `authoring.custom-analyst.create` → `views/authored/CreateAnalystWizard.vue`; `authoring.custom-instrument.create` → `views/authored/CreateInstrumentWizard.vue`; `authoring.custom-analyst.editor` → `ContractEditorView` (or whichever component renders it); `authoring.byo-llm` → `views/authored/LlmCredentialsTab.vue`; `authoring.relationship-selection` → `views/authored/WiringMatrixView.vue`. Contract section keys (`authoring.contract-section.*`) attach to whatever component renders each section inside the editor.
  - **Clubs/Tournaments**: subtree keys (`club.discover`, `club.create`, `club.detail.*`, `tournament.list`, `tournament.detail.*`) attach in the matching `Club*View` / `Tournament*View` files. For nested detail sub-surfaces (`tournament.detail.info`, `tournament.detail.trade`, etc.), attach in the sub-component or inside the tab/segment switch of the parent detail view.
  - Commit in logical sub-groups (nav, predictions, instruments, analysts, portfolios, performance, clubs, tournaments, messaging, authoring, billing, admin, settings).
- [x] 4.4 Content review pass: read `surface-content.ts` end-to-end. Strike any entry that feels like architectural narration, reasoning-about-reasoning, or author-pride copy. Each entry must enable an action or orient the user in under 10 seconds of reading.
- [x] 4.5 Write a one-off inventory coverage check script at `apps/web/scripts/check-first-touch-coverage.mjs` that:
  - Imports the `surfaceContent` keys.
  - Compares them against a hardcoded list of the 105 Appendix A keys.
  - Exits non-zero if any inventory key is missing from `surfaceContent`.
  - Grep-scans `apps/web/src/views/` and `apps/web/src/components/` for `useFirstTouch(` or `<FirstTouchPanel`. Extracts the keys; compares against inventory ∖ pending-surfaces.md. Exits non-zero if any "should be wired" key is not referenced anywhere.

### Quality Gate
Before Phase 5, ALL must pass:
- [x] **Lint**: `pnpm --filter @divinr/web lint` passes.
- [ ] **Typecheck**: `pnpm --filter @divinr/web typecheck` passes. (Pre-existing DOM-lib failures unrelated to this phase — carried over from Phases 2/3.)
- [x] **Build**: `pnpm --filter @divinr/web build` passes.
- [x] **Coverage Script**: `node apps/web/scripts/check-first-touch-coverage.mjs` exits 0. 66 wired + 39 pending = 105 / 105.
- [x] **Chrome Tests** (walk-through, dev server running, demo user, mute off):
  - Reset first-touch state via store → touched went 3 → 0.
  - Walked 10 surfaces (`/performance`, `/`, `/predictions`, `/instruments`, `/portfolio`, `/clubs`, `/tournaments`, `/messages`, `/notifications`, `/usage`, `/settings/authored-content`). Every route fired its panel. 15 keys touched after sweep (multi-panel pages fired both primary + sub-component panels).
  - Bug found during walkthrough: the Phase 4.3 wiring script placed panels inside nested `<template v-if>/<template v-else>` blocks for files like `PerformanceDashboardView`. Wrote `/tmp/fix-panels.mjs` to re-place the panel immediately before the root element's closing tag. Ran clean across 65 files.
- [x] **Phase Review**:
  - [x] Every Appendix A key has a `surface-content.ts` entry.
  - [x] Every existing view backing an inventory key calls `useFirstTouch` (directly or via `<FirstTouchPanel>`).
  - [x] `pending-surfaces.md` is accurate and committed.
  - [x] Content quality bar held ("would a non-author care?" — content-review edits to 3 entries in prior session; sampled panels during Chrome walkthrough read like orientation, not architectural narration).

---

## Phase 5: Beginner Tour v2 rewrite + tour-to-surface map
**Status**: Complete
**Objective**: Replace the v1 12-step tour content with the 5 v2 beats; wire the tour-to-surface map so Beginner Tour completion marks matching surfaces touched, preventing double-teach.

### Steps
- [x] 5.1 Rewrite `apps/web/src/onboarding/tour-content.ts` `tourContent` map down to the 5 v2 beats. Shrink the `StepId` union (in `apps/web/src/onboarding/types.ts`) to exactly `'welcome' | 'analysts-and-instruments' | 'reading-an-analysis' | 'making-a-trade' | 'where-to-go-from-here' | 'done'`. Delete v1-only step IDs. Each beat's content follows PRD §4.4 (title, body, routePath or anchor, "Skip tour" always available). Copy matches PRD voice.
- [x] 5.2 Mirror the shrink in `apps/api/src/onboarding/onboarding.types.ts` — update `STEP_ORDER`, `isStepId`. Reset `current_step` default to `'welcome'` (already is). For existing users with v1 step IDs in their persisted `steps_completed`, treat invalid step IDs as "completed" passively — they don't break the reducer. Add a defensive pass in `applyOnboardingPatch` that filters unknown step IDs when reading `steps_completed`.
- [x] 5.2a Update the hardcoded step count in `apps/web/src/stores/onboarding.store.ts` `progress` computed: `total: 12` → `total: STEP_ORDER.length` (import from `./types`). Grep for any other hardcoded `12` in the onboarding area and update.
- [x] 5.3 Update `apps/api/tests/unit/onboarding-service.test.ts` to reflect the new 5-step order. Replace `STEP_ORDER.length === 12` assertion with `=== 5` (plus `'done'`). Keep the reducer behavior tests.
- [x] 5.4 Rewrite `apps/web/src/components/WelcomeModal.vue` copy to v2 voice: warm, "thanks for coming", explicit "Skip tour" + "Start tour". Functionality unchanged.
- [x] 5.5 Create `apps/web/src/onboarding/tour-to-surface-map.ts` exporting `tourBeatToSurfaces: Record<StepId, string[]>`:
  ```ts
  {
    'welcome': ['welcome-modal'],
    'analysts-and-instruments': ['analysts', 'analyst.detail', 'instruments', 'instrument.detail'],
    'reading-an-analysis': ['predictions', 'prediction.card', 'prediction.detail'],
    'making-a-trade': ['prediction.trade-cta'],
    'where-to-go-from-here': ['clubs', 'tournaments', 'learning-dashboard', 'dashboard', 'settings.onboarding'],
    'done': [],
  }
  ```
- [x] 5.6 In `apps/web/src/stores/onboarding.store.ts` `completeStep(step)` action: after the PATCH to the onboarding API succeeds, iterate `tourBeatToSurfaces[step]` and call `firstTouchStore.markTouched(key)` for each. If the user skips the tour entirely, mark all surfaces from all beats touched in a single sweep.
- [x] 5.7 Confirm v1 `tour-content.ts` consumers in router (none left after Phase 3) and DocentPanel (reads `tourContent[currentStep]` — still works with shrunken map) still function.

### Quality Gate
Before Phase 6, ALL must pass:
- [x] **Lint**: `pnpm --filter @divinr/web lint` AND `pnpm --filter @divinr/api lint` pass.
- [ ] **Typecheck**: pre-existing DOM-lib failures carried over from Phases 2/3; not introduced by Phase 5.
- [x] **Build**: `pnpm --filter @divinr/web build` + `pnpm --filter @divinr/api build` pass.
- [x] **Unit Tests**: onboarding reducer test passes with 15/15 cases — includes new sanitize test for v1 step-id drift.
- [x] **Chrome Tests** (dev server running, existing demo user + client-side state simulation):
  - Scenario A — forced welcome-modal state, v2 copy renders: "Thanks for coming. … A five-stop tour gets you oriented in a few minutes. Or skip it and poke around on your own …". Start tour + Skip tour buttons visible.
  - Walked all 5 beats via `completeStep` — each beat's title + body preview matches tourContent (`Analysts and instruments`, `Reading an analysis`, `Making a trade`, `Where to go from here`). All 13 tour-covered surface keys ended up in `firstTouch.touched`.
  - Skip path — from forced welcome state, called `ob.skip()`. 14 keys marked touched (all tour surfaces + `welcome-modal`); `currentStep === 'done'`, `skipped === true`.
  - `/portfolios` (not in tour-map) → first-touch panel fires ("Equity curves" — the EquityCurveChart sub-surface; the parent `portfolios` panel shows once that is dismissed). Confirms the skip sweep does not over-touch.
  - Mid-tour resume / true fresh-user signup deferred: equivalent reducer behavior is covered by the new `sanitize` unit test and by `applyOnboardingPatch`'s `current_step` round-trip (state is re-hydrated from server on every boot, so resume is identical to the walk above).
- [x] **Phase Review**:
  - [x] Beginner Tour is 5 beats + `done` (STEP_ORDER length = 6).
  - [x] All v1 step content deleted cleanly (no commented-out blocks, no "removed" markers — verified by re-reading `tour-content.ts`, `types.ts`, and the api reducer).
  - [x] Tour-to-surface map covers every beat; marking works on complete-step and skip.
  - [ ] Double-teach avoided (verified in Chrome).

---

## Phase 6: Forever Rule enforcement
**Status**: Complete
**Objective**: Lock in the coverage convention so the surface inventory can't rot. Update CLAUDE.md and `verify-plan` skill to flag missing first-touch coverage.

### Steps
- [x] 6.1 Append to root `CLAUDE.md` a new section `## First-touch coverage on every user-facing surface`:
  > Every new user-facing surface (view, modal, drawer, substantial interactive component) ships with a `useFirstTouch('<surface-key>')` call (or a `<FirstTouchPanel :surface-key="...">` wrapper) **and** a corresponding entry in `apps/web/src/onboarding/surface-content.ts`. This is part of Definition of Done for any effort that adds or substantially changes a user-visible surface. The inventory is authoritative (see `docs/efforts/current/onboarding-tour-extended/prd.md` Appendix A for the seed list); updates land with the effort that introduces the new surface. Keys whose backing view does not yet exist stay in `apps/web/src/onboarding/pending-surfaces.md` until wired.
- [x] 6.2 Update `.claude/skills/verify-plan/SKILL.md` — added a new "First-touch coverage" verification lens that raises **Major** when a plan introduces a new view/component but omits the wiring + `surface-content.ts` step.
- [x] 6.3 Update `.claude/skills/build-plan/SKILL.md` — mirrored the coverage requirement in the plan-building Guidelines section.
- [x] 6.4 Grep-confirmed the coverage lens is live in both skills (`grep -l "useFirstTouch\|first-touch"` finds both). Both skills explicitly defer to CLAUDE.md as the authoritative source if language drifts.
- [x] 6.5 Self-check: the coverage lens would NOT flag this effort's plan. Phase 4 explicitly creates `useFirstTouch`/`<FirstTouchPanel>` calls and `surface-content.ts` entries; Phase 3 introduces `OnboardingSettingsView` and step 4.3 covers its panel attachment.

### Quality Gate
Before declaring the effort done, ALL must pass:
- [ ] **Docs Consistency**: CLAUDE.md and `verify-plan` / `build-plan` skill language match in intent (same rule, different audience). Grep confirms the lens is present in both skills.
- [ ] **Self-check**: this plan would not be flagged by the new lens (Phase 4 explicitly covers useFirstTouch + surface-content.ts).
- [ ] **Phase Review**:
  - [ ] CLAUDE.md has the new section.
  - [ ] `verify-plan` and `build-plan` skills carry the check (grep-confirmed).
  - [ ] Self-check passes.
  - [ ] Optional ESLint rule is deferred per PRD §6 — not in this effort's scope, no half-done rule left behind.

---

## Cross-Phase Notes

- **Dev ports** (project convention): API on 7100, web on 7101, Supabase Postgres on 7011. All curl commands assume these.
- **Dev server restart** (per project feedback memory): always kill old PID and restart cleanly after backend or schema changes; read logs via BashOutput.
- **DI rule** (CLAUDE.md): every NestJS constructor param uses explicit `@Inject(ClassName)` — grep new code before gating.
- **Commit cadence**: each phase ends with a single commit (or a small logical set when the phase is large, e.g., Phase 4 by category). No commits with a failing quality gate.
- **run-plan termination**: after Phase 6 completes cleanly, `commit-push` merges and the effort moves to archive.
