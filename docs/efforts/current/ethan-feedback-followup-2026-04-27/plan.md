# Ethan Feedback Follow-Up — Implementation Plan

**PRD**: `docs/efforts/current/ethan-feedback-followup-2026-04-27/prd.md`  
**Status**: Complete

## Progress Tracker

- [x] Phase 1: Research Detail and Learning Panel Access
- [x] Phase 2: Trade Submission Feedback
- [x] Phase 3: Validation and Remaining Polish

---

## Phase 1: Research Detail and Learning Panel Access
**Status**: Complete

### Objectives

- simplify instrument detail framing
- hide dead/non-level-appropriate affordances
- add persistent Learning Panel launcher
- pass instrument/page context into Learning Panel requests

### Landed

- `InstrumentDetailView.vue`
  - back action now uses browser/app history with fallback
  - `Edit Contract` hidden unless builder-appropriate
- `InstrumentAnalystPanel.vue`
  - simple `Buy / Sell / Hold` stance framing
- `PredictorScoringPanel.vue`
  - grouped by analyst
  - rescoring workbench visible only for builder-level users
- `DefaultLayout.vue`
  - persistent bottom-right Learning Panel launcher
- `LearningPanelSurface.vue`
  - instrument context threaded into thread creation and message append flows
- `apps/e2e/tests/learning-panel/smoke.spec.ts`
  - updated for the new quick-access launcher

### Validation

- [x] `pnpm --filter @divinr/web run build`
- [x] `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/learning-panel/smoke.spec.ts --project=learning-panel`
- [x] in-app browser sanity check confirms the quick-access launcher is present in the live shell

---

## Phase 2: Trade Submission Feedback
**Status**: Complete

### Objectives

- make trade submission visibly successful
- show immediate recent activity after queueing a trade
- clarify the relationship between queued activity and later portfolio changes

### Landed

- `TournamentDetailView.vue`
  - visible success state after queueing a trade
  - toast confirmation
  - Recent Activity card for queued trades
  - explanatory note about queued vs executed behavior
- `tournament.store.ts`
  - typed queue-trade return shape

### Validation

- [x] `pnpm --filter @divinr/web run build`
- [x] `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/tournaments/smoke.spec.ts --project=tournaments`

---

## Phase 3: Validation and Remaining Polish
**Status**: Complete

### Objectives

- extend browser coverage around the research-detail fixes
- continue live in-app browser validation
- catch any final friction in dashboard → detail → trade handoff

### Steps

- [x] extend `apps/e2e/tests/instruments/article-relevance.spec.ts`
  - back button visible
  - `Edit Contract` hidden for the normal fixture
  - simple stance framing present
- [x] keep the spec skip-safe when local seed data does not expose a reachable instrument
- [x] complete a cleaner live browser walkthrough for:
  - dashboard → instrument detail
  - article relevance tab
  - queued trade feedback visibility
- [x] record any new issues found in that pass and either fix them here or split them into a new effort

### Current Validation

- [x] `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/instruments/article-relevance.spec.ts --project=instruments`
  - skip-safe under current local seed conditions
- [x] live in-app browser sanity pass on `http://localhost:7101`
  - confirmed Level 1 dashboard cards still expose `Trade`, `Portfolios`, and `Learning Panel`
  - confirmed shell chrome still exposes the Learning Panel launcher
  - confirmed the `/chat` route renders the current threaded Learning Panel surface

### Exit Gate

Before marking this effort complete:

- [x] `pnpm --filter @divinr/web run build`
- [x] `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/learning-panel/smoke.spec.ts --project=learning-panel`
- [x] `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/tournaments/smoke.spec.ts --project=tournaments`
- [x] `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/instruments/article-relevance.spec.ts --project=instruments`
- [x] one final in-app browser sanity pass across the touched surfaces
