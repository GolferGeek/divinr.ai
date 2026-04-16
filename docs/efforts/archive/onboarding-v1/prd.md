# Onboarding Tour — Product Requirements Document

## 1. Overview

Ship a first-login guided tour that walks a new Divinr user down the left-nav, top-to-bottom, teaching what each screen is, how to read it, and how Divinr's core thesis — **explainability over black boxes** — plays out in the product. The tour is driven by a docent panel that docks next to the content, not a modal takeover. Nav items above the user's current step render locked (🔒, muted, click routes to current step) so the user can see the full scope of the platform without feeling overwhelmed. Skip, pause, resume, and restart are first-class.

Target: ship tonight (2026-04-14), before Ethan and his St. Thomas Investing Club friends (invite code `J5M36WG2`) hit first login ahead of the 2026-04-20 tournament.

## 2. Goals & Success Criteria

**Goals**
- A first-time user completes the tour and understands what each left-nav screen does and how they connect.
- The "whoa" moments (instrument detail analyst cards, Blue/Red/Arbiter debate) are surfaced with narrative framing, not left for the user to find by accident.
- The platform's full scope is visible but soft-gated so users feel guided, not overwhelmed.
- A skip lane exists for every power user and a restart lane exists for every user who skipped and regretted it.

**Success criteria (measurable)**
- A new user (Ethan's fresh account on 2026-04-15) hits the welcome modal on first login.
- Accepting the tour progresses through all 12 steps; state persists across page reloads and logout/login.
- Clicking a locked nav item routes to the current step and shows the docent's gentle redirect message (never a blank page).
- Skipping from the welcome modal unlocks every nav item and never re-prompts.
- "Retake onboarding tour" from the user menu resets state and restarts from step 1.
- Super-admin can reset onboarding for any user via a dev control (to test repeatedly against Ethan's account).
- Tour state survives a hard refresh (backed by DB, not localStorage).

## 3. User Stories / Use Cases

- **Ethan (new user, accepts tour)**: Signs in after using invite code J5M36WG2. Welcome modal offers a tour; accepts. Docent walks him through 12 steps. He reaches the completion modal feeling oriented, not lost.
- **Power user (skip)**: Signs up, hits welcome modal, clicks "Skip — I'll figure it out." All nav items unlocked. Never sees the docent again unless they opt back in from settings.
- **Interrupted user (pause/resume)**: Starts tour, gets pulled into a meeting, closes tab. Returns next day, logs in, docent reappears at the step they left off.
- **Curious skipper**: Skipped at first, now wants the tour. Opens user menu → "Retake onboarding tour." Tour restarts from step 1; nav re-locks accordingly.
- **Admin/owner**: Goes through normal member tour. Admin-only "System" nav group (Runs, Sources, Evaluations, Learning, Proposals) stays visible and always unlocked regardless of tour state — it's not part of the tour.
- **Super-admin testing**: Hits "Reset onboarding for user X" in a dev menu, resets Ethan's state to re-run the tour against his account.
- **Direct-link visitor**: User in step 3 clicks an old link to `/clubs`. Router redirects back to the current step route and docent says "You'll get there — just a few more steps first."

## 4. Technical Requirements

### 4.1 Architecture

- **Storage layer**: one new table `authz.user_preferences` holding a JSONB `onboarding_state`. Future user-scoped prefs can reuse the same table/column pattern, but this PRD delivers only onboarding.
- **API layer**: new `OnboardingModule` in `apps/api/src/onboarding/` with controller + service, following the `ClubModule` shape (`apps/api/src/clubs/club.module.ts:15-32`). Explicit `@Inject(ClassName)` on every constructor param (per project CLAUDE.md and `apps/api/src/clubs/club.controller.ts:37-45`).
- **Web layer**:
  - One Pinia store `onboarding.store.ts` (mirrors `auth.store.ts` composition-API pattern).
  - One new top-level component `DocentPanel.vue` mounted inside `DefaultLayout.vue`, not per-view.
  - One `WelcomeModal.vue` (IonModal) shown conditionally on first mount of `DefaultLayout.vue`.
  - One `CompletionModal.vue` for step 12.
  - Tour content defined as a typed TS config at `apps/web/src/onboarding/tour-content.ts` — no runtime data fetching for copy.
  - Nav unlock logic lives in `DefaultLayout.vue` by extending the existing `NavItem` interface with `unlockStep?: string` and filtering/decorating via the onboarding store.
  - Router guard added in `apps/web/src/router/index.ts` next to the existing `beforeEach` auth guard.
- **No new packages**: no tour library (Shepherd, Driver.js, Intro.js). Native Vue + Ionic. The docent is a plain component with position:fixed styling; element highlighters use a simple overlay pulse driven by a CSS selector lookup.

### 4.2 Data Model Changes

New migration: `apps/api/db/migrations/2026-04-14-user-preferences.sql`.

```sql
CREATE TABLE IF NOT EXISTS authz.user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES authz.users(id) ON DELETE CASCADE,
  onboarding_state JSONB NOT NULL DEFAULT jsonb_build_object(
    'started_at',      NULL,
    'completed_at',    NULL,
    'skipped',         FALSE,
    'current_step',    'welcome',
    'steps_completed', '[]'::jsonb,
    'last_seen_at',    NULL
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_updated_at
  ON authz.user_preferences(updated_at);
```

Row is **lazily initialized** by the GET endpoint on first call (INSERT ... ON CONFLICT DO NOTHING, then SELECT). No backfill migration needed — users without rows get the default shape on first read.

**Valid step IDs** (enforced at the API layer, not as a DB CHECK, to stay nimble):
`welcome`, `dashboard`, `predictions`, `instrument-detail`, `analysts`, `performance`, `risk`, `portfolios`, `clubs`, `tournaments`, `messages`, `done`.

**Note on `steps_completed`**: stored as a JSONB array of step IDs (order matters for progress display, de-duped by the service).

### 4.3 API Changes

New module mounted in `apps/api/src/app.module.ts` alongside `ClubModule`. All endpoints behind `JwtAuthGuard` and use `req.user.id` per `auth.middleware.ts`.

| Method | Path | Body | Returns | Purpose |
|---|---|---|---|---|
| `GET` | `/onboarding/state` | — | `OnboardingState` | Fetch current user's tour state. Auto-init row if missing. |
| `PATCH` | `/onboarding/state` | `OnboardingPatch` | `OnboardingState` | Apply one change (complete a step, set current step, skip, restart, mark-seen). |
| `POST` | `/onboarding/reset/:userId` | — | `OnboardingState` | Super-admin only. Reset target user's onboarding to defaults. Used by dev control. |

**Response shape (`OnboardingState`)**
```ts
{
  started_at:      string | null;   // ISO-8601
  completed_at:    string | null;
  skipped:         boolean;
  current_step:    StepId;
  steps_completed: StepId[];
  last_seen_at:    string | null;
}
```

**Request shape (`OnboardingPatch`)** — one action per PATCH to keep the service side-effect reasoning simple:
```ts
  | { action: 'start' }                         // sets started_at=now, current_step='dashboard', steps_completed=['welcome']
  | { action: 'complete_step'; step: StepId }   // appends to steps_completed (dedup), advances current_step to next step in order
  | { action: 'set_current_step'; step: StepId }
  | { action: 'skip' }                          // skipped=true, completed_at=now, current_step='done', steps_completed=[all 12]
  | { action: 'restart' }                       // reset to defaults AND auto-start: started_at=now, current_step='dashboard', steps_completed=['welcome']. No welcome modal (user already opted in by clicking restart).
  | { action: 'mark_seen' }                     // updates last_seen_at only
```

**Semantics — restart vs reset (admin)**
- Self `restart` (via PATCH with `action: 'restart'`): resets and auto-starts. User skips the welcome modal and sees the docent at step `dashboard` immediately. Used by "Retake onboarding tour" in the user menu.
- Super-admin `POST /onboarding/reset/:userId`: writes pristine defaults (started_at=null, skipped=false, completed_at=null, steps_completed=[], current_step='welcome'). Target user sees the welcome modal on their next login. Used by dev control to test Ethan's first-login flow repeatedly.

**Validation**
- `StepId` enum enforced server-side; unknown step → `400 Bad Request`.
- `POST /onboarding/reset/:userId` requires caller role `super-admin` (lookup follows the pattern in `club.controller.ts:52-67`). Non-super-admin → `403`.

**Not in this effort**: endpoints for per-step analytics events (future, per intention §Analytics).

### 4.4 Frontend Changes

**Files added**
- `apps/web/src/stores/onboarding.store.ts` — Pinia store.
- `apps/web/src/components/DocentPanel.vue` — floating right-dock docent.
- `apps/web/src/components/WelcomeModal.vue` — first-login gate (IonModal).
- `apps/web/src/components/CompletionModal.vue` — step-12 celebration (IonModal).
- `apps/web/src/components/ElementHighlighter.vue` — overlay pulse for element highlights.
- `apps/web/src/onboarding/tour-content.ts` — typed tour definition (all 12 steps, nav-lock map).
- `apps/web/src/onboarding/types.ts` — shared `StepId`, `StepContent`, `OnboardingState` types.

**Files modified**
- `apps/web/src/layouts/DefaultLayout.vue`:
  - On mount, call `onboarding.fetch()` (idempotent).
  - Mount `<DocentPanel/>`, `<WelcomeModal/>`, `<CompletionModal/>`, `<ElementHighlighter/>` once at shell level.
  - Extend `NavItem` interface with optional `unlockStep: StepId`.
  - Decorate locked items in the sidebar `v-for` with `🔒` glyph and `locked` class, intercept click to route to the current tour step instead.
  - Add a header tour button (ionicons `mapOutline` or `compassOutline`) next to the user chip: click toggles the docent open/paused. Shows `3 / 12` progress badge when the tour is active.
  - Add "Retake onboarding tour" entry in the user chip area (simple popover/menu — minimal IonChip click → small IonPopover). First settings surface in the app; keep it small.
- `apps/web/src/router/index.ts`:
  - Add a second `beforeEach` guard (after the auth guard) that consults the onboarding store. Pseudocode:
    ```
    if (!onboarding.active) return true;                // skipped/completed → no guard
    if (to.meta.public) return true;                    // public routes bypass
    if (isAlwaysUnlockedRoute(to.path)) return true;    // /, /notifications, admin System routes, tour route itself
    if (onboarding.isUnlocked(to.path)) return true;
    onboarding.flashLocked('Let's get through this first');
    return onboarding.currentStepPath;                  // redirect
    ```
  - `isAlwaysUnlockedRoute` allowlist: `/`, `/notifications`, all 5 admin System routes (`/runs`, `/sources`, `/evaluations`, `/learning`, `/proposals`), and `onboarding.currentStepPath` itself (prevents redirect loops).
  - Dynamic sub-routes (`/instruments/:id`, `/clubs/:id`, etc.) are evaluated by matching the prefix against the nav lock map (e.g., `/instruments/foo` → uses `/instruments` unlock rule).

**Pinia store API**
```ts
useOnboardingStore() → {
  state: Ref<OnboardingState | null>,
  loading: Ref<boolean>,
  active:       computed(() => !!started_at && !completed_at && !skipped),
  currentStep:  computed(() => state.current_step),
  currentStepPath: computed(() => tourContent[current_step].routePath),
  progress:     computed(() => ({ done: steps_completed.length, total: 12 })),
  isUnlocked:   (navPath: string) => boolean,     // takes the nav item's `to` path (e.g., '/clubs'); looks up unlockStep in tourContent.navLocks and checks steps_completed
  docentVisible: Ref<boolean>,  // collapsed vs expanded
  pulseTargets: Ref<string[]>,  // CSS selectors driven by active step
  lockedFlash:  Ref<string | null>, // transient message when user hits a lock
  // actions (each maps to one PATCH action or POST)
  fetch(), start(), completeStep(step), setStep(step),
  skip(), restart(), markSeen(),
  notifyAction(actionKey),           // views call this on user action; no-op unless current step is kind:'action' with matching actionKey
  flashLocked(message), openDocent(), closeDocent(),
  resetForUser(userId)               // super-admin only, calls POST /onboarding/reset/:userId
}
```

**Docent panel behavior**
- Position: `position: fixed; right: 0; top: 72px; bottom: 16px; width: 360px` when expanded. Collapsed to a 40px ribbon with step number.
- Renders `tourContent[currentStep]`: title, markdown body, optional CTA button, optional "Got It → next" button.
- Pause button → `closeDocent()` (keeps state, hides UI). Header tour button reopens.
- Skip Tour link → confirm → `skip()` → unlocks everything.
- On step change, reads `content.pulseSelectors` → stores pushed to `pulseTargets` → `ElementHighlighter` mounts a subtle outline/pulse on each matched DOM node. If a selector matches nothing (e.g., the user is on the wrong page), the highlight is silent (no error).
- Completion condition per step:
  - `kind: 'got_it'` — advance on Next click.
  - `kind: 'action'` — advance when a matching event fires (store exposes `notifyAction(actionKey)` called by views; e.g., `InstrumentDetailView.vue` calls `onboarding.notifyAction('opened-instrument-detail')` on mount). Views only fire `notifyAction` if that step is the current step, so instrumentation stays inert outside the tour.

**Tour content (source of truth — `tour-content.ts`)**

```ts
type StepKind = 'got_it' | 'action';
interface StepContent {
  id: StepId;
  title: string;
  body: string;                       // markdown, 2-3 short paragraphs
  routePath: string;                  // anchor route for this step — used as redirect destination by the router guard. For action-gated steps that terminate on a dynamic route (e.g., /instruments/:id), use the approach route (e.g., /instruments) so a direct-link bounce has a valid destination.
  pulseSelectors?: string[];          // DOM elements to highlight via ElementHighlighter
  cta?: { label: string; actionKey?: string }; // actionKey used for kind:'action'
  completion: { kind: StepKind; actionKey?: string };
  emotionalBeat: string;              // internal copy note, not shown
}

interface NavLockMap {
  [navPath: string]: StepId | 'always' | 'admin-only';
}
// Exported alongside the step content array. Drives isUnlocked() in the store
// and the sidebar decoration in DefaultLayout.vue.
```

The step IDs in order are: `welcome` → `dashboard` → `predictions` → `instrument-detail` → `analysts` → `performance` → `risk` → `portfolios` → `clubs` → `tournaments` → `messages` → `done`. `complete_step` advances along this fixed order. Actual copy is written in Phase 4.

**Nav unlock table (authoritative — drives `tour-content.ts` map)**

| Nav item (DefaultLayout key) | `routePath` | `unlockStep` (in `steps_completed` → unlocked) |
|---|---|---|
| Dashboard | `/` | always |
| Instruments | `/instruments` | `predictions` |
| Portfolios | `/portfolios` | `risk` |
| Risk | `/risk` | `instrument-detail` |
| Analysts | `/analysts` | `instrument-detail` |
| Performance | `/performance` | `analysts` |
| Coordination | `/coordination` | `performance` (and admin-only visible anyway) |
| Affinity | `/affinity` | `done` |
| Clubs | `/clubs` | `portfolios` |
| Tournaments | `/tournaments` | `clubs` |
| Messages | `/messages` | `tournaments` |
| Notifications (header bell) | `/notifications` | always |
| System group (all 5) | — | admin-only, always unlocked |

### 4.5 Infrastructure Requirements

- No new infra. Uses existing Postgres (port 54322), existing API (7100), existing web dev server (7101).
- Migration runs via the project's existing migration mechanism (same as the 2026-04-13 mentor/curriculum/tournament migrations).
- No new env vars.
- No new package dependencies on web or api.

## 5. Non-Functional Requirements

- **Performance**: Docent and nav lock rendering must not block first paint. Onboarding state fetch runs in parallel with other layout-time fetches (affinity, notifications, fear/greed, messaging — see `DefaultLayout.vue:109-112`). Tour-content is a static TS import — zero runtime cost.
- **Persistence**: All state lives in Postgres. No localStorage fallback (keeps multi-device consistent).
- **Security**:
  - `POST /onboarding/reset/:userId` gated to `super-admin` via RBAC role check (mirror `club.controller.ts:52-67`).
  - GET/PATCH operate only on `req.user.id`; users cannot read/write others' state.
- **Compatibility**:
  - Works on desktop and iPad (Ionic Vue). On narrow viewports (<900px), docent collapses to a bottom sheet rather than a right dock. Out-of-scope this effort: native iOS shell — test only in web.
  - Shown to all roles including `beta_reader` (read-only users still benefit from the tour).
- **Accessibility**: Docent is a proper landmark (`<aside aria-label="Onboarding tour">`). Next/Pause/Skip are real buttons, keyboard-reachable. Locked nav items retain `tabindex="0"` and announce "locked — complete step X to unlock" via `aria-label`.
- **Legal language**: Tour copy uses "analysis/signal" vocabulary only, never "advice/recommendation" (per project memory `project_legal_language.md`). Copy review in Phase 4.
- **Reversibility**: Restart wipes state back to defaults. Skip is a one-way door in normal flow but reversible via Restart.

## 6. Out of Scope

- Per-step analytics events, drop-off dashboard (future effort, per intention).
- Multi-language content. English only.
- Role-specific tour variants (members vs custom tier). Same tour for everyone.
- Gamified achievements / badges.
- Video walkthroughs.
- Native iOS (Capacitor shell) testing. Target is the web app at port 7101.
- Interactive tutorials that require specific market data (e.g., "make a trade now").
- Migration to OpenRouter / Gemma 3n E4B for tour-copy generation — all copy is authored by hand, checked into `tour-content.ts`.
- Automated UI tests (no web test framework exists yet; verification is manual browser testing per intention timeline).
- Settings/profile page. This effort adds a minimal popover for "Retake onboarding" only; a full settings surface is future work.

## 7. Dependencies & Risks

**Dependencies**
- Landing page (shipped).
- `/join` and `/join/:code` signup flow (shipped; see `router/index.ts:20-30`).
- `JwtAuthGuard` and `req.user.id` convention (existing).
- Existing RBAC role lookup query pattern (`club.controller.ts:52-67`).

**Risks**

| Risk | Mitigation |
|---|---|
| **Ethan's test account already has a prefs row or cached localStorage state**, skipping the welcome modal. | Super-admin reset endpoint + dev menu button explicitly covers this. Verify by resetting Ethan's account before 2026-04-15 demo. |
| **Element highlighter selectors drift** as views evolve, leaving the pulse silent. | Silent fail (no error); selectors are defined in `tour-content.ts` next to the step, easy to update. Phase 7 manual pass confirms each selector hits. |
| **Router guard loops** (redirect to current-step path, which itself triggers the guard). | Guard short-circuits when `to.path === stepPath(current_step)`. Unit-testable logic; exercise in Phase 6. |
| **User completes step via natural navigation before the docent says "Next"**. | `kind: 'action'` steps advance on the action itself; docent stays in sync. `kind: 'got_it'` steps don't gate on user location, only the Next button. |
| **First-login detection misfires** — welcome modal shows on every login forever. | Welcome modal only shows when `onboarding_state.started_at === null && !skipped && !completed_at`. Any of {start, skip} sets a terminal flag. |
| **Admin System routes** accidentally locked by guard. | Guard explicitly allowlists admin routes + `/notifications` + `/` before considering redirect. |
| **Nest DI crash from `design:paramtypes` absence** when tests hit `OnboardingService`. | Follow CLAUDE.md: explicit `@Inject(ClassName)` on every constructor param without exception. |
| **Ship-tonight scope slip** — copywriting all 12 steps is the real heavy lift. | Copy is isolated in `tour-content.ts`. Infrastructure (Phases 1-3) can ship with placeholder copy; Phase 4 is the last thing that must be done and can be iterated after Ethan sees it if needed. |
| **Beta readers (read-only) hit an `action`-gated step that needs write access**. | All 12 steps are read-only operations (viewing screens, opening detail pages, expanding rationale panels). No step requires write/trade actions. Confirmed in Phase 4 copy review. |
| **Concurrent PATCHes** (e.g., user clicks Next twice). | `PATCH /onboarding/state` is idempotent per action: `complete_step` dedups, `set_current_step` is a set not a delta. No transactions needed. |

## 8. Phasing

Each phase ends with a specific browser-verifiable or curl-verifiable checkpoint.

### Phase 1 — DB schema + API endpoints

Build the storage and API surface. Mount the module. Verify with curl before touching the web app.

- Write migration `2026-04-14-user-preferences.sql`.
- Create `apps/api/src/onboarding/` with `onboarding.module.ts`, `onboarding.controller.ts`, `onboarding.service.ts`, `onboarding.types.ts`. Explicit `@Inject` on every constructor param.
- Register `OnboardingModule` in `app.module.ts`.
- Service logic: lazy-init row, apply each action, return state.
- RBAC check on `POST /onboarding/reset/:userId`.
- **Checkpoint**: `curl -H "Authorization: Bearer $TOKEN" http://localhost:7100/onboarding/state` returns default state. `PATCH ... '{"action":"start"}'` returns state with `started_at` set. Service unit test in `apps/api/tests/unit/onboarding.service.test.ts` covers all six actions.

### Phase 2 — Pinia store + docent skeleton

Wire the web side to the API. No tour content yet, just plumbing.

- Create `onboarding.store.ts` with fetch/start/completeStep/setStep/skip/restart/markSeen/resetForUser actions hitting `useApi('/onboarding')`.
- Create minimal `DocentPanel.vue` that shows `Step X of 12` and Next/Pause/Skip buttons (no styled copy yet).
- Create minimal `WelcomeModal.vue` with Accept/Skip.
- Create minimal `CompletionModal.vue`.
- Mount all three in `DefaultLayout.vue`. Call `onboarding.fetch()` on mount.
- **Checkpoint**: Log into the web app with a freshly-reset account. Welcome modal appears. Clicking Accept transitions to `dashboard` step. Docent shows `Step 2 of 12`. Clicking Next advances. Refresh — state persists. Skip from welcome dismisses and never returns.

### Phase 3 — Nav lock rendering + router guard

Turn the sidebar into a progress indicator, redirect direct-link bypass attempts.

- Extend `NavItem` interface in `DefaultLayout.vue` with `unlockStep?: StepId`. Populate the unlock map (see §4.4 table).
- Apply `.locked` class + 🔒 glyph to items whose unlock step isn't yet in `steps_completed`. Clicking a locked item calls `onboarding.flashLocked(...)` and routes to current step's path.
- Add router guard in `router/index.ts` (after auth guard): redirect to `stepPath(currentStep)` when user hits a locked route via direct link. Allowlist admin routes + `/`, `/notifications`, `/welcome`, `/login`, `/join*`, `/signup/*`.
- Add header tour button (compass icon) that reopens docent when paused.
- **Checkpoint**: With account at `step=dashboard`, Clubs nav item shows locked. Clicking it flashes the docent message and stays on dashboard. Typing `/clubs` in the URL bar redirects to `/`. Admin account still sees System routes unlocked. Complete steps up through `portfolios` — Clubs unlocks.

### Phase 4 — Tour content (the copy)

The heavy lift. Write all 12 steps with real narrative and pulse targets. Copy emphasizes explainability-over-black-boxes; uses "analysis/signal" not "advice/recommendation".

- Author `tour-content.ts` with all 12 entries per the structure in §4.4. Each step: title, 2-3 markdown paragraphs, route, pulse selectors, CTA, completion kind/actionKey, emotional beat.
- For `kind: 'action'` steps, call `onboarding.notifyAction(key)` at the relevant mount point in the view (InstrumentDetailView, RiskDashboardView, etc.) — guarded so it no-ops outside the tour.
- Wire `DocentPanel.vue` to render markdown + CTA + highlight pulse selectors through `ElementHighlighter.vue`.
- **Checkpoint**: Reset Ethan's account. Manual walkthrough of all 12 steps in the browser. Each step's copy reads as intended, pulse targets land on real elements, action-gated steps advance naturally.

### Phase 5 — Welcome modal, completion celebration, polish

Make the bookends feel like a product, not a debug UI.

- Style the welcome modal with warm welcome copy + two prominent buttons.
- Style the completion modal with confetti (simple CSS/JS, no new dep) and "You've unlocked everything" copy.
- Polish docent panel styling: shadow, typography, collapse ribbon, progress bar, keyboard focus states.
- Polish element highlighter pulse (subtle outline ring, 1.5s loop).
- Narrow-viewport fallback: docent becomes a bottom sheet under 900px.
- **Checkpoint**: Walkthrough feels finished. No debug labels, no raw JSON on screen.

### Phase 6 — Restart + admin reset + user-menu affordance

Give users a way back in and give us a way to test.

- Add small IonPopover off the user chip in `DefaultLayout.vue` with "Retake onboarding tour" action → calls `onboarding.restart()` and opens the docent.
- Add super-admin dev menu entry (inside the same popover, gated on `auth.isSuperAdmin`) "Reset onboarding for user X" — prompts for user ID, calls `onboarding.resetForUser(id)`. Simple prompt box is fine.
- **Checkpoint**: Skipping user clicks "Retake" → tour restarts from step 1, nav re-locks. Super-admin resets Ethan's state while logged in as golfergeek; verified with direct API check.

### Phase 7 — Browser testing + polish pass

Manual verification against success criteria. No automated tests (no web test framework exists yet, per §5 NFRs).

- Reset Ethan's account. Full walkthrough.
- Reset + skip; confirm no re-prompt; confirm all nav unlocked.
- Reset + pause mid-tour, close tab, reopen; confirm resume at correct step.
- Direct-link bypass attempts on every locked route.
- Admin walkthrough: System routes never locked.
- Beta reader walkthrough: tour completes, no write-gated steps.
- Copy review pass: explainability framing lands, no "advice/recommendation" slips.
- **Checkpoint**: Every bullet in §2 Success Criteria verified in the browser. Ready for Ethan 2026-04-15.
