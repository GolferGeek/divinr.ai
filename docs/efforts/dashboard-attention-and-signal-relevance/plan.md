# Dashboard Attention and Signal Relevance — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-05-12
**Status**: Complete and verified 2026-07-24

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Dashboard relevance contract
- [x] Phase 2: Explicit analysis preferences
- [x] Phase 3: Portfolio-first dashboard module
- [x] Phase 4: Tournament standings dashboard module
- [x] Phase 5: Relevant analysis module and dashboard simplification
- [x] Phase 6: Coverage, copy, and verification

---

## Shared Notes

- Monorepo uses pnpm + Turbo.
- API runs on port 7100, web on port 7101.
- Home dashboard is `apps/web/src/views/DashboardView.vue`.
- Current dashboard analysis endpoint is `GET /markets/predictions/dashboard`, implemented by `MarketsService.getDashboardPredictions(userId)`.
- Portfolio store already exposes `fetchMyPortfolio()`, `fetchMyPositions('open')`, and portfolio detail helpers.
- Tournament store already exposes `fetchMyEntries()`, `fetchTournament(id)`, `fetchLeaderboard(id)`, and `fetchPositions(id, status)`.
- Analyst affinity already exists through `AffinityService` and `useAffinityStore()`.
- Existing `authz.user_preferences` stores onboarding JSON; explicit analysis preferences need queryable storage in the `prediction` schema.
- User-visible copy in `apps/web/src` must use "analysis" or "signal", never forbidden investment vocabulary.
- Do not add request-time schema mutation.
- Any new NestJS dependency must use explicit `@Inject(...)`.

## Implementation Notes

- 2026-05-12: Implemented dashboard relevance scoring, explicit analysis preference storage/API/UI, portfolio-first dashboard rows, tournament standing rows, relevant-analysis reason chips, first-touch coverage, deep skill test docs, and targeted E2E specs.
- 2026-05-12: Passing gates so far:
  - `pnpm --filter @divinr/api exec tsx tests/unit/dashboard-relevance-score.test.ts`
  - `pnpm --filter @divinr/api exec tsx tests/unit/analysis-preferences-service.test.ts`
  - `pnpm --filter @divinr/api exec tsx tests/unit/beta-reader-guard.test.ts`
  - `pnpm --filter @divinr/api typecheck`
  - `pnpm --filter @divinr/web typecheck`
  - `pnpm --filter @divinr/api lint`
  - `pnpm --filter @divinr/web lint`
  - `pnpm --filter @divinr/api build`
  - `pnpm --filter @divinr/web build`
  - `node apps/web/scripts/check-first-touch-coverage.mjs`
  - `pnpm --filter @divinr/api exec tsx tests/unit/markets-schema-bootstrap-tracking.test.ts`
  - `BASE_URL=http://localhost:7101 API_BASE_URL=http://localhost:7100 pnpm --filter @divinr/e2e exec playwright test tests/predictions/analysis-preferences.spec.ts tests/predictions/dashboard-card.spec.ts --project=predictions`
  - `BASE_URL=http://localhost:7101 API_BASE_URL=http://localhost:7100 pnpm --filter @divinr/e2e exec playwright test tests/predictions/analysis-preferences.spec.ts tests/predictions/dashboard-card.spec.ts tests/portfolios/smoke.spec.ts tests/tournaments/smoke.spec.ts --project=predictions --project=portfolios --project=tournaments --headed`
- 2026-05-12: Fixed `StudentBillingService.getMySummary()` so explicit historical `yearMonth` requests compare against that requested month, not the wall-clock current month. Focused `tests/unit/student-billing.test.ts` and full `pnpm --filter @divinr/api run test:unit` now pass.
- 2026-05-12: Headed Chrome checklist found two issues and both are fixed: dashboard cards at the API inclusion threshold now receive the visible `High-conviction signal` reason, and the Analysis Preferences priority segment now persists the selected priority mode. The broader headed checklist passed 49 assertions across desktop dashboard, preferences, and mobile layout; screenshots are in `.testing-artifacts/dashboard-attention-desktop.png` and `.testing-artifacts/dashboard-attention-mobile.png`.
- 2026-05-12: Local `dev:up` exposed an existing-bootstrap-marker gap for the new preference tables. Fixed by adding a dedicated `markets-analysis-preferences-v2026-05-12` bootstrap step that runs through explicit bootstrap, not request handlers.
- 2026-07-24: Closure review confirmed the implementation was already committed on `main`. API/web lint, typecheck, and build passed; first-touch coverage passed; dashboard relevance, preferences, and student-billing regression tests passed; and the focused production Playwright pass completed 4/4 across dashboard cards, analysis preferences, portfolios, and tournaments. Retained desktop/mobile screenshots were visually inspected with no overlap or clipping.

Reusable gate commands:

```bash
pnpm --filter @divinr/api lint
pnpm --filter @divinr/web lint
pnpm --filter @divinr/api build
pnpm --filter @divinr/web build
pnpm --filter @divinr/api run test:unit
pnpm --filter @divinr/api typecheck
pnpm --filter @divinr/web typecheck
pnpm --filter @divinr/e2e exec playwright test --project=portfolios
pnpm --filter @divinr/e2e exec playwright test --project=tournaments
pnpm --filter @divinr/e2e exec playwright test tests/predictions/dashboard-card.spec.ts
```

## Consolidated Chrome Test Script

Run this full browser pass after Phase 5 and again in Phase 6. It is the visual proof that the proposed dashboard direction works as a user experience, not just as isolated components.

### Desktop pass: 1440x900

- [x] Open `/`.
- [x] Confirm the first viewport is anchored by portfolio positions and tournament standing/context, not generic navigation or platform counters.
- [x] Confirm the positions module appears above secondary navigation.
- [x] Confirm open position rows render with symbol, direction, quantity, entry/current price when available, and unrealized P&L; if there are no open positions, confirm a useful empty state links to Analyses and Portfolios.
- [x] Click a position's analysis action and confirm it reaches the relevant instrument or Analyses route.
- [x] Confirm the tournament module appears near the top when community surfaces are available.
- [x] Confirm active/upcoming tournament rows render with tournament name, status, rank/standing context when available, and a link to `/tournaments/:id`; if there are no active entries, confirm a useful empty state links to `/tournaments`.
- [x] Click a tournament row and confirm it opens tournament detail.
- [x] Confirm relevant analysis cards appear below the two primary modules.
- [x] Confirm every visible analysis card has at least one concise relevance reason, such as `In your portfolio`, `In an active tournament`, `Analyst you read often`, `High-conviction signal`, or `Analysts disagree`.
- [x] Confirm dashboard analysis is visibly bounded and does not read like a dump of every instrument.
- [x] Confirm broad `/predictions` remains reachable as the discovery route.
- [x] Confirm generic count cards and large pathway cards no longer dominate the first viewport.
- [x] Confirm no visible copy uses forbidden vocabulary outside allowed/debug contexts.
- [x] Confirm there are no console errors or app 5xx network responses.

### Mobile pass: 390x844

- [x] Open `/`.
- [x] Confirm positions and tournament modules stack cleanly without horizontal overflow.
- [x] Confirm position row text, buttons, price/P&L values, and badges do not overlap or clip.
- [x] Confirm tournament row rank/status text does not overlap or clip.
- [x] Confirm analysis card relevance reasons wrap cleanly.
- [x] Confirm all primary row/card actions are tappable.
- [x] Confirm no clipped button text, no invisible overflow, and no first-touch panel overlap with primary content.

### Preference-model pass

- [x] Open `/settings/analysis-preferences`.
- [x] Follow an analyst, watch an instrument, mute an instrument, and choose a dashboard priority mode.
- [x] Return to `/` and confirm the selected preferences are reflected in dashboard relevance reasons and ordering.
- [x] Confirm muted instruments do not appear in dashboard analysis cards.
- [x] Change dashboard priority from balanced to portfolio first or tournaments first and confirm the ordering changes when matching data exists.
- [x] Confirm dashboard analysis ordering is explainable from visible context:
  - followed analysts and watched instruments are promoted when present
  - held instruments outrank generic instruments when present
  - active tournament instruments appear before generic instruments when present
  - analyst-affinity language appears only when the user has enough affinity history
  - high-conviction or disagreement reasons appear only on cards that actually meet those criteria
- [x] Confirm the preferences UI stays small: follow/watch/mute plus dashboard priority only.

---

## Phase 1: Dashboard relevance contract

**Status**: Not Started
**Objective**: Add deterministic relevance metadata to dashboard analysis so the dashboard can show fewer, more useful items.

### Steps

- [x] 1.1 Add a typed relevance shape near `MarketsService.getDashboardPredictions(userId)`:
  - `score`
  - `reasons`
  - `explicit_preference_score`
  - `open_position_count`
  - `active_tournament_count`
  - `top_affinity_score`
  - `disagreement_score`
- [x] 1.2 Refactor the dashboard analysis query so it can identify context for the authenticated user:
  - followed analyst IDs
  - watched instrument IDs
  - muted instrument IDs
  - dashboard priority mode
  - open user positions by `instrument_id` or symbol mapping already available to portfolio rows
  - queued trades where available
  - active tournament instruments or tournament positions where available
  - analyst affinity scores for analysts in the run
  - do not add watched/recently-viewed tracking in this effort; emit `recent_activity` only if an existing source is confirmed
- [x] 1.3 Implement a small pure scoring helper that orders dashboard analysis by:
  - muted instrument exclusion
  - followed analyst boost
  - watched instrument boost
  - open position
  - active tournament
  - queued trade
  - analyst affinity
  - non-neutral high conviction
  - analyst disagreement
  - recency as final tiebreaker
- [x] 1.4 Keep existing dashboard visibility gates for non-neutral arbitrator synthesis and minimum confidence. If implementation discovers a need for a lower context-specific threshold, update the PRD before changing the gate.
- [x] 1.5 Return at most 8 dashboard analysis items by default.
- [x] 1.6 Add/extend API unit tests:
  - `apps/api/tests/unit/dashboard-signal-gate.test.ts`
  - new `apps/api/tests/unit/dashboard-relevance-score.test.ts`
  - assertions for muted exclusion, followed-analyst boost, watched-instrument boost, priority-mode ordering, position-first, tournament-second, affinity ordering, disagreement promotion, neutral/low-confidence exclusion, and stable tiebreaking.
- [x] 1.7 Wire any new unit test into `apps/api/package.json` `test:unit`.

### Quality Gate

Before moving to Phase 2, all of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api lint`
- [x] **Build**: `pnpm --filter @divinr/api build`
- [x] **Typecheck**: `pnpm --filter @divinr/api typecheck`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [x] **Curl Tests**:
  ```bash
  curl -i http://localhost:7100/markets/predictions/dashboard
  ```
  Expected without auth: `401`.
  With a valid local JWT, expected: `200` JSON array; every row has `relevance.score` and `relevance.reasons`.
- [x] **E2E Tests**: n/a for this API-only phase.
- [x] **Chrome Tests**: n/a for this API-only phase.
- [x] **Phase Review**:
  - [x] Dashboard analysis is bounded.
  - [x] Explicit preference inputs influence scoring in unit-tested helper scenarios.
  - [x] Relevance metadata is explainable.
  - [x] Existing dashboard response fields remain compatible.
  - [x] No request-time schema mutation was added.

---

## Phase 2: Explicit analysis preferences

**Status**: Not Started
**Objective**: Add a small explicit preference workflow for followed analysts, watched instruments, muted instruments, and dashboard priority mode.

### Steps

- [x] 2.1 Add idempotent migration `apps/api/db/migrations/YYYY-MM-DD-dashboard-analysis-preferences.sql`:
  - `prediction.user_analysis_preferences`
  - `prediction.user_dashboard_preferences`
  - indexes from the PRD
- [x] 2.2 Wire the same DDL into the explicit schema bootstrap path for markets/onboarding as appropriate; do not add request-time schema mutation.
- [x] 2.3 Add an API service with explicit `@Inject(...)` constructor params to read/replace preferences:
  - followed analyst IDs
  - watched instrument IDs
  - muted instrument IDs
  - dashboard priority mode
- [x] 2.4 Add controller endpoints under `MarketsController`:
  - `GET /markets/preferences/analysis`
  - `PUT /markets/preferences/analysis`
- [x] 2.5 Validate `PUT` input:
  - accepted priority modes: `balanced`, `portfolio_first`, `tournaments_first`
  - target ID arrays are deduped
  - target IDs exist where practical
  - replacing with empty arrays clears those preference types
- [x] 2.6 Add `apps/web/src/stores/analysis-preferences.store.ts`.
- [x] 2.7 Add `apps/web/src/views/AnalysisPreferencesView.vue` at `/settings/analysis-preferences`:
  - segmented control for dashboard priority mode
  - searchable/compact analyst list with follow toggles
  - searchable/compact instrument list with watch and mute toggles
  - clear saved/loading/error states
  - `FirstTouchPanel surface-key="settings.analysis-preferences"`
- [x] 2.8 Register the route in `apps/web/src/router/index.ts` and add a Settings nav item/mastery policy in `apps/web/src/mastery/mastery-config.ts`.
- [x] 2.9 Add first-touch content for `settings.analysis-preferences`.
- [x] 2.10 Add API unit tests for preferences read/replace/idempotency and input validation.
- [x] 2.11 Add or update E2E coverage under `apps/e2e/tests/predictions/` or a settings-appropriate project to cover loading and saving explicit preferences.
- [x] 2.12 Update relevant deep skill docs to include the preferences surface.

### Quality Gate

Before moving to Phase 3, all of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api lint && pnpm --filter @divinr/web lint`
- [x] **Build**: `pnpm --filter @divinr/api build && pnpm --filter @divinr/web build`
- [x] **Typecheck**: `pnpm --filter @divinr/api typecheck && pnpm --filter @divinr/web typecheck`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [x] **E2E Tests**: run the new/updated preference spec.
- [x] **Curl Tests**:
  ```bash
  curl -i http://localhost:7100/markets/preferences/analysis
  curl -i -X PUT http://localhost:7100/markets/preferences/analysis \
    -H 'Content-Type: application/json' \
    -d '{"followed_analyst_ids":[],"watched_instrument_ids":[],"muted_instrument_ids":[],"priority_mode":"balanced"}'
  ```
  Expected without auth: `401`. With a valid local JWT, expected `200` and persisted shape.
- [x] **Chrome Tests**:
  - Open `/settings/analysis-preferences`.
  - Follow/unfollow an analyst.
  - Watch/unwatch an instrument.
  - Mute/unmute an instrument.
  - Change priority mode and confirm persistence after reload.
  - Confirm mobile layout has no clipped toggles or labels.
- [x] **Phase Review**:
  - [x] Preferences are explicit, small, and understandable.
  - [x] Preferences are stored in queryable tables.
  - [x] Preference API is idempotent.
  - [x] First-touch and testing coverage are present for the new settings surface.
  - [x] User-visible copy avoids forbidden vocabulary.

---

## Phase 3: Portfolio-first dashboard module

**Status**: Not Started
**Objective**: Make current open positions the primary dashboard content and link them to relevant analysis.

### Steps

- [x] 3.1 In `DashboardView.vue`, load portfolio state with `portfolio.fetchMyPortfolio()` and `portfolio.fetchMyPositions('open')`.
- [x] 3.2 Add a dashboard positions module with `data-test="dashboard-positions"`.
- [x] 3.3 Render each open position with `data-test="dashboard-position-row"` and compact fields:
  - symbol
  - direction
  - quantity
  - entry/current price when available
  - unrealized P&L
  - opened time when available
- [x] 3.4 Add per-position actions:
  - view relevant analysis for the position's instrument
  - view full portfolio detail
- [x] 3.5 Add an empty state that links to the Analyses page and portfolio view without implying investment advice.
- [x] 3.6 If row markup is duplicated from `PortfolioDashboardView.vue`, extract a small presentational component under `apps/web/src/components/` and reuse it.
- [x] 3.7 Preserve existing `FirstTouchPanel surface-key="dashboard"` and update `apps/web/src/onboarding/surface-content.ts` dashboard copy to describe positions, tournaments, explicit preferences, and relevant analysis.

### Quality Gate

Before moving to Phase 4, all of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/web lint`
- [x] **Build**: `pnpm --filter @divinr/web build`
- [x] **Typecheck**: `pnpm --filter @divinr/web typecheck`
- [x] **Unit Tests**: n/a unless a pure formatter/helper is introduced; if so, add a focused test or document why web has no unit harness for it.
- [x] **E2E Tests**: Extend `apps/e2e/tests/portfolios/smoke.spec.ts` or add `apps/e2e/tests/portfolios/dashboard-home.spec.ts` to assert populated position rows or the empty state.
- [x] **Curl Tests**:
  ```bash
  curl -i http://localhost:7100/markets/portfolios/me/positions?status=open
  ```
  Expected without auth: `401`.
- [x] **Chrome Tests**:
  - Open `/`.
  - Confirm positions module is visible above generic navigation.
  - Confirm no horizontal overflow on mobile viewport.
  - Confirm row action reaches an instrument or Analyses route.
- [x] **Phase Review**:
  - [x] Open positions are visible without scrolling past generic cards.
  - [x] Empty state is useful.
  - [x] Dashboard first-touch copy is updated.
  - [x] User-visible copy avoids forbidden vocabulary.

---

## Phase 4: Tournament standings dashboard module

**Status**: Not Started
**Objective**: Show active tournament participation and rank context directly on the dashboard.

### Steps

- [x] 4.1 In `DashboardView.vue`, continue loading `tournamentStore.fetchMyEntries()`.
- [x] 4.2 Add a dashboard tournaments module with `data-test="dashboard-tournaments"`.
- [x] 4.3 For active or upcoming tournament entries, fetch bounded detail/leaderboard context:
  - active entries first
  - upcoming entries second
  - cap detail leaderboard fetches to the top 3 tournament entries shown on dashboard
- [x] 4.4 Render each tournament row with `data-test="dashboard-tournament-row"`:
  - tournament name
  - status
  - current rank when available
  - rank delta when already present in leaderboard payload
  - total P&L/return where available
  - link to leaderboard or tournament detail
- [x] 4.5 Add an empty state linking to `/tournaments`.
- [x] 4.6 Keep community/mastery gating behavior consistent with existing `showCommunitySurfaces`.
- [x] 4.7 Add defensive loading/error states so a failed leaderboard request does not hide all dashboard tournament entries.

### Quality Gate

Before moving to Phase 5, all of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/web lint`
- [x] **Build**: `pnpm --filter @divinr/web build`
- [x] **Typecheck**: `pnpm --filter @divinr/web typecheck`
- [x] **Unit Tests**: n/a unless helper functions are introduced.
- [x] **E2E Tests**: Extend `apps/e2e/tests/tournaments/smoke.spec.ts` or add `apps/e2e/tests/tournaments/dashboard-home.spec.ts` to assert the dashboard tournament module renders rows or empty state.
- [x] **Curl Tests**:
  ```bash
  curl -i http://localhost:7100/tournaments/me
  curl -i http://localhost:7100/tournaments/:id/leaderboard
  ```
  Expected without auth: `401`.
- [x] **Chrome Tests**:
  - Open `/`.
  - Confirm tournament module is visible near the top when community surfaces are available.
  - Confirm row link opens `/tournaments/:id`.
  - Confirm mobile viewport has no overlap or clipped rank text.
- [x] **Phase Review**:
  - [x] Active standings are easy to find from dashboard.
  - [x] No unbounded leaderboard fetch loop was introduced.
  - [x] Empty and error states are understandable.
  - [x] User-visible copy avoids forbidden vocabulary.

---

## Phase 5: Relevant analysis module and dashboard simplification

**Status**: Not Started
**Objective**: Replace the generic active-signal grid and summary stats with a relevance-ordered analysis module that supports portfolio and tournament context.

### Steps

- [x] 5.1 Replace the current generic `Active Signals` grid in `DashboardView.vue` with a module using `data-test="dashboard-relevant-analysis"`.
- [x] 5.2 Render analysis cards with `data-test="dashboard-analysis-card"` and show concise relevance reasons:
  - "In your portfolio"
  - "In an active tournament"
  - "Analyst you read often"
  - "High-conviction signal"
  - "Analysts disagree"
- [x] 5.3 Keep analyst chips affinity-sorted using `useAffinityStore()` as a client-side presentation enhancement.
- [x] 5.4 Remove or demote generic summary statistic cards:
  - ticker count
  - active analysis count
  - multi-analyst count
  - analyst stance count
- [x] 5.5 Convert pathway cards into compact secondary actions so portfolio/tournament/analysis modules dominate the first viewport.
- [x] 5.6 Ensure dashboard links into `/predictions` are broad-browse links and links from positions/tournaments carry `instrumentId` only when it creates a useful filtered view.
- [x] 5.7 Update `apps/e2e/tests/predictions/dashboard-card.spec.ts` for the new dashboard card shape.
- [x] 5.8 Include explicit preference reasons on analysis cards when applicable:
  - `Followed analyst`
  - `Watched instrument`
  - `Muted` should not appear because muted instruments are excluded
- [x] 5.9 Add a compact link from the dashboard relevant-analysis module to `/settings/analysis-preferences`.

### Quality Gate

Before moving to Phase 6, all of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/web lint`
- [x] **Build**: `pnpm --filter @divinr/web build`
- [x] **Typecheck**: `pnpm --filter @divinr/web typecheck`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` to verify Phase 1 relevance gates still pass after UI integration.
- [x] **E2E Tests**:
  ```bash
  pnpm --filter @divinr/e2e exec playwright test tests/predictions/dashboard-card.spec.ts
  ```
- [x] **Curl Tests**:
  ```bash
  curl -i http://localhost:7100/markets/predictions/dashboard
  ```
  With a valid local JWT, expected rows are relevance-ordered and bounded.
- [x] **Chrome Tests**:
  - Open `/` at 1440x900 and mobile.
  - Confirm dashboard first viewport prioritizes positions and tournaments.
  - Confirm analysis cards are below primary modules and show relevance reasons.
  - Confirm broad `/predictions` remains reachable.
- [x] **Phase Review**:
  - [x] Dashboard answers "what deserves attention now?"
  - [x] Broad analysis discovery remains separate.
  - [x] Generic platform stats no longer dominate the home view.
  - [x] User-visible copy avoids forbidden vocabulary.

---

## Phase 6: Coverage, copy, and verification

**Status**: Not Started
**Objective**: Finish first-touch, deep skill, E2E, and quality gate coverage for the changed user-facing surfaces.

### Steps

- [x] 6.1 Update first-touch content in `apps/web/src/onboarding/surface-content.ts`:
  - `dashboard`
  - `settings.analysis-preferences`
  - `predictions` only if copy changes
  - portfolio/tournament keys only if new wrappers/components qualify as first-touch surfaces
- [x] 6.2 Run first-touch coverage check:
  ```bash
  node apps/web/scripts/check-first-touch-coverage.mjs
  ```
- [x] 6.3 Update deep testing skill docs:
  - `.agents/skills/divinr-portfolios-browser-skill/tests.md`
  - `.agents/skills/divinr-tournaments-browser-skill/tests.md`
  - `.agents/skills/divinr-predictions-browser-skill/tests.md`
  - settings/preferences coverage in the most relevant existing settings skill or a new deep skill if a settings facet is formalized
  - add a dashboard-specific note to the most relevant existing skill rather than creating a new facet unless the implementation introduces a new route.
- [x] 6.4 Add or update Playwright specs:
  - explicit analysis preferences settings surface
  - dashboard positions module
  - dashboard tournament standings module
  - dashboard relevant analysis module
  - vocabulary compliance on dashboard after stripping legal/first-touch copy
- [x] 6.5 Run final quality gates:
  ```bash
  pnpm --filter @divinr/api lint
  pnpm --filter @divinr/web lint
  pnpm --filter @divinr/api build
  pnpm --filter @divinr/web build
  pnpm --filter @divinr/api run test:unit
  pnpm --filter @divinr/api typecheck
  pnpm --filter @divinr/web typecheck
  pnpm --filter @divinr/e2e exec playwright test --project=portfolios
  pnpm --filter @divinr/e2e exec playwright test --project=tournaments
  pnpm --filter @divinr/e2e exec playwright test tests/predictions/dashboard-card.spec.ts
  pnpm --filter @divinr/e2e exec playwright test tests/predictions/analysis-preferences.spec.ts
  ```
- [x] 6.6 Browser-verify final dashboard:
  - desktop 1440x900
  - mobile 390x844
  - no visible overlap
  - no clipped button text
  - no forbidden vocabulary outside allowed/debug contexts
  - all top-level row/card links work
- [x] 6.7 Update docs/features.md if this effort changes the described dashboard or analysis relevance behavior.

### Quality Gate

This phase is complete only when all of the following pass:

- [x] **Lint**: API and web lint pass.
- [x] **Build**: API and web build pass.
- [x] **Typecheck**: API and web typecheck pass, or any pre-existing unrelated failures are documented with exact file/line scope.
- [x] **Unit Tests**: API `test:unit` passes.
- [x] **E2E Tests**: affected portfolios, tournaments, dashboard-card, and analysis-preferences specs pass.
- [x] **First-Touch Coverage**: `node apps/web/scripts/check-first-touch-coverage.mjs` passes.
- [x] **Chrome Tests**: final dashboard verified on desktop and mobile.
- [x] **Phase Review**:
  - [x] Every PRD requirement is represented in code or explicitly deferred as out of scope.
  - [x] Dashboard primary content is positions and tournaments.
  - [x] Explicit preferences can be managed and affect dashboard relevance.
  - [x] Analysis ordering is relevance-based and bounded.
  - [x] Deep skill docs and Playwright specs cover the changed user-visible surface.
  - [x] User-visible vocabulary complies with repo rules.
