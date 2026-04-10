# User-Analyst Affinity — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Completed**: 2026-04-10
**Final Status**: All Phases Complete

## Summary
- Total phases: 6
- Phases completed: 6
- Phases remaining: 0

## Phase Results

### Phase 1: Data Model & Affinity Service Core
- **Status**: Complete
- 3 new tables: `user_analyst_affinity`, `user_affinity_signals`, `user_contrarian_alerts`
- `AffinityService` with exponential decay scoring (30-day half-life), Bayesian prior for cold start
- 21 unit tests passing

### Phase 2: Signal Collection Hooks
- **Status**: Complete
- Signal recording wired into `confirmTrade()`, `skipTrade()`, and challenge flows in MarketsService
- Fire-and-forget pattern (non-blocking to trade flow)
- **Deviation**: Plan originally targeted UserPortfolioService, but trade decisions live in MarketsService. Adjusted accordingly.
- 17 unit tests passing

### Phase 3: Affinity Profile API & Nightly Decay
- **Status**: Complete
- `GET /markets/affinity` endpoint returns user's affinity profile
- Nightly decay hooks into `runNightlyEvaluation()` as Phase 4
- Signal pruning at 90 days, score normalization when clustered
- 14 unit tests passing

### Phase 4: Contrarian Alert Generation
- **Status**: Complete
- Weighted consensus calculation using affinity scores
- Alert generation: fires when low-affinity analyst (< 0.5) disagrees at high confidence (>= 80%)
- 3-alert cap per user
- `GET /markets/affinity/alerts` and `PATCH /markets/affinity/alerts/:id/read` endpoints
- Pipeline hook in `AnalystPipelineService` after prediction generation
- Fixed beta-reader-guard test (added `requireWriteAccess` to PATCH endpoint)
- 13 unit tests passing

### Phase 5: Frontend — Affinity Profile & Dashboard Personalization
- **Status**: Complete
- `affinity.store.ts` Pinia store with full API integration
- `AffinityProfile.vue` component with ranked list, affinity bars, signal breakdown
- `/affinity` route added to router
- Dashboard analyst list sorted by affinity when data available
- Affinity badges on analyst names in dashboard

### Phase 6: Frontend — Contrarian Alerts & Browse Signals
- **Status**: Complete
- `ContrarianAlert.vue` component with dismiss action and legal-compliant language
- Notification badge in layout toolbar for unread alerts
- `POST /markets/affinity/signals/browse` endpoint
- Browse signal tracking in `AnalystPredictionModal.vue` with 10-second timer and 5-minute debounce
- `patch()` method added to `useApi.ts` composable
- Affinity nav item added to sidebar
- 9 unit tests passing

## Gate Results
All quality gates passed across all 6 phases:
- **Lint**: Clean on all phases (API + web)
- **Build**: Clean on all phases (API tsc + web Vite)
- **Typecheck**: Pre-existing errors only (window/HTMLElement/RouteParam) — no new errors introduced
- **Unit Tests**: 74 new affinity tests across 5 test files, all passing. Zero regressions in existing tests.
- **Guard Test**: Fixed by adding `requireWriteAccess` to new PATCH endpoint

## Deviations from PRD
1. **Signal hooks in MarketsService, not UserPortfolioService**: The plan targeted UserPortfolioService, but `confirmTrade()` and `skipTrade()` are methods on MarketsService. Functionally equivalent — all signal recording works as specified.
2. **Typecheck pre-existing failures**: `vue-tsc --noEmit` has pre-existing errors unrelated to this effort. Build (Vite) succeeds, confirming no new compilation issues.

## Files Changed
### New Files (10)
- `apps/api/src/markets/services/affinity.service.ts`
- `apps/api/tests/unit/affinity-service.test.ts`
- `apps/api/tests/unit/affinity-signals.test.ts`
- `apps/api/tests/unit/affinity-decay.test.ts`
- `apps/api/tests/unit/contrarian-alerts.test.ts`
- `apps/api/tests/unit/affinity-browse-signal.test.ts`
- `apps/web/src/stores/affinity.store.ts`
- `apps/web/src/components/AffinityProfile.vue`
- `apps/web/src/components/ContrarianAlert.vue`
- `apps/web/src/views/AffinityView.vue`

### Modified Files (11)
- `apps/api/src/markets/schema/markets-schema.service.ts` — DDL for 3 new tables
- `apps/api/src/markets/markets.types.ts` — 3 new type interfaces
- `apps/api/src/markets/markets.module.ts` — AffinityService registration
- `apps/api/src/markets/markets.service.ts` — Signal hooks + AffinityService injection
- `apps/api/src/markets/markets.controller.ts` — 4 new endpoints
- `apps/api/src/markets/services/nightly-evaluation.service.ts` — Decay hook
- `apps/api/src/markets/services/analyst-pipeline.service.ts` — Contrarian alert generation
- `apps/api/package.json` — 5 new test entries
- `apps/web/src/composables/useApi.ts` — patch() method
- `apps/web/src/router/index.ts` — /affinity route
- `apps/web/src/views/DashboardView.vue` — Sorting + badges + ContrarianAlert
- `apps/web/src/layouts/DefaultLayout.vue` — Alert badge + Affinity nav item
- `apps/web/src/components/AnalystPredictionModal.vue` — Browse signal timer

## Next Steps
- Chrome testing: verify all frontend components render correctly in browser
- Run `/pr-eval` to review architectural compliance before merging
