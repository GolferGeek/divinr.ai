# Entity-Level Performance Attribution — Completion Report

**Plan**: [plan.md](./plan.md)
**PRD**: [prd.md](./prd.md)
**Intention**: [intention.md](./intention.md)
**Completed**: 2026-04-17
**Final Status**: All Phases Complete

## Summary
- Total phases: 5
- Phases completed: 5
- Phases remaining: 0

## Phase Results

### Phase 1: Schema + Outcome Recording Layer — Complete
- Added `prediction.outcome_records` (28 columns + 6 indexes, 3 check constraints).
- Migration `apps/api/db/migrations/2026-04-19-outcome-attribution.sql`.
- New `apps/api/src/attribution/` module with `OutcomeAttributionService`.
- Hook into `NightlyEvaluationService` via `setOnEvaluationCycleComplete()` callback (non-breaking, try/catch wrapped).
- 38 unit tests covering cutoff, calibration, position vs calibration methods, predictor lookback, source-key dedupe, idempotency, env fallbacks.
- **Deviation**: service signature became `recordOutcomesForEvaluationRun(runStartedAt: Date)` (not `evaluationIds[]`) — caller doesn't surface UUIDs; timestamp + `NOT EXISTS` query is cleaner + idempotent.

### Phase 2: Aggregation Views + Nightly Refresh — Complete
- 6 materialized views (`attribution_per_{triple,analyst,instrument,source,author}_monthly` + `attribution_per_article_lifetime`), each with a unique index for `REFRESH CONCURRENTLY`.
- `AttributionAggregationService.refreshViews()` follows the LlmUsageQueryService concurrent-then-fallback pattern.
- Cron at `30 0 * * *` gated by `ATTRIBUTION_DISABLE_NIGHTLY_REFRESH`.
- 33 unit tests (26 original + 7 regression tests added in Phase 3 for the `{error}` fallback bug).

### Phase 3: Query Layer + Admin/Author Endpoints — Complete
- `AttributionQueryService` with 8 methods covering per-triple/per-analyst/per-instrument/per-source/per-author/graduation-candidates/slice/my-summary/instrument.
- `AdminAttributionController` (`/admin/attribution`, 8 endpoints) + `AuthorAttributionController` (`/attribution`, 2 endpoints).
- 76 query-service assertions + 41 controller-auth assertions.
- **Bug found + fixed during live curl testing**: `refreshViews()` didn't handle `{error}` return shape from the Postgres adapter → silent "success" on CONCURRENT failures; fixed and covered with regression tests.

### Phase 4: Frontend — Complete
- 5 new views: `AttributionMineView`, `InstrumentAttributionView`, `AttributionAdminView`, `SourceQualityView`, `GraduationCandidatesView`.
- 1 new component: `GraduationSuggestionBanner` (env-flag + session-dismiss).
- 2 widget extensions: `UserUsageWidget` (+authored-content line), `CostDefensibilityView` (+"Value / Compute $" column with disclaimer).
- 1 new Pinia store (`attribution.store.ts`) + 1 composable (`useMyAttribution.ts`).
- 5 new routes + sidebar nav (user: "My Attribution" under Settings; admin: "Attribution" group with Overview/Sources/Graduation Candidates).
- **Deviation**: "Value / Compute $" computed as `Σ paper P&L across all authors this month / kind.avgMonthlyCostCents` with italic disclaimer (attribution is keyed by author_user_id + year_month, not itemKind — a strict per-kind join needs a new backend aggregation that isn't yet justified).
- **Chrome tests deferred** to a fresh context per the "UI tests should run in a fresh context" memory; handoff to `/pr-eval` in a clean chrome session.

### Phase 5: Integration & E2E Pipeline — Complete
- **5.1** Documented the `{candidates: [...]}` shape as the contract for the future `custom-to-base-graduation` effort. Current shape covers who/what/track-record/ranking — no API changes needed.
- **5.2** Verified `CostDefensibilityView` Value/Compute $ column via code review (chrome walk deferred).
- **5.3** Legal-language audit: 3 hits for forbidden words, all inside disclaimers themselves ("no cash earnings. Estimate only"; "Estimates only — not investment advice"). Passes the plan's acceptance rule.
- **5.4** End-to-end pipeline check:
  - All 6 matviews present and queryable in Postgres (`SELECT matviewname FROM pg_matviews`).
  - Attribution module registered `outcome-attribution hook on NightlyEvaluationService` at API boot (log evidence).
  - `POST /admin/attribution/refresh-views` → `{refreshed: 6, failed: []}`.
  - All 10 endpoints return expected shapes for an empty dataset; non-admin → 403.
  - `POST /markets/admin/run-nightly-evaluation` returned 500 — the pre-existing `ensureSchema()` deadlock (documented on Phases 1/2 and the cost-modeling-system completion); unrelated to this effort. Live-data verification deferred until the evaluation queue accumulates.
- **5.5** Chrome walk deferred to fresh session per memory rule; all 5 target views shipped in Phase 4 with empty-state rendering validated via backend endpoint curls.
- **5.6** This report + final quality gates + commit-push.

## Gate Results

| Gate | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|---|---|---|---|---|---|
| API lint | ✅ | ✅ | ✅ | ✅ | ✅ |
| API typecheck | ✅ | ✅ | ✅ | ✅ | ✅ |
| API build | ✅ | ✅ | ✅ | ✅ | ✅ |
| API unit tests | ✅ (38) | ✅ (+26→33) | ✅ (+117) | ✅ (all cumul.) | ✅ (all cumul.) |
| Web lint | n/a | n/a | n/a | ✅ | ✅ |
| Web typecheck | n/a | n/a | n/a | ⚠ pre-existing DOM-lib errors outside effort scope | ⚠ same |
| Web build | n/a | n/a | n/a | ✅ | ✅ |
| Curl tests | n/a | n/a | ✅ (6/6) | ✅ (6/6 re-run) | ✅ (10/10) |
| E2E smoke | ⚠ pre-existing ensureSchema deadlock | ⚠ same | n/a | n/a | ⚠ same — live evaluations blocked; matview refresh + endpoint shapes verified |
| Chrome tests | n/a | n/a | n/a | ⏸ deferred | ⏸ deferred |

**Bug fixed live**: `AttributionAggregationService.refreshViews()` was silent on concurrent-refresh failures because the Postgres adapter returns `{error}` rather than throwing. Fixed + regression tests added.

## Deviations from PRD

1. **`recordOutcomesForEvaluationRun` signature** takes `runStartedAt: Date` instead of an `evaluationIds[]` list. Semantically equivalent (idempotent via `ON CONFLICT (evaluation_id) DO NOTHING` + `NOT EXISTS` filter) and more crash-resilient (missed evaluations get picked up next cycle).
2. **`CostDefensibilityView` "Value / Compute $"** uses aggregate author P&L ÷ kind cost, not a per-kind join (attribution isn't keyed by `itemKind`). Rendered with italic disclaimer using "estimate". Correct directional signal without fabricated per-kind numbers.
3. **Chrome tests deferred** to a fresh chrome session (memory rule) — will be run via `/pr-eval`.
4. **Live evaluation E2E** deferred until the evaluation queue accumulates — blocked by the pre-existing `ensureSchema()` deadlock flake on the markets smoke path. Unit-level pipeline is exercised via `outcome-attribution.test.ts`.

## Next Steps

- Run `/pr-eval` in a fresh chrome session to execute the deferred UI walk.
- When the first real nightly evaluation produces `prediction_horizon_evaluations` rows, re-run the 5.4 live-data verification:
  - `SELECT count(*) FROM prediction.outcome_records;` should grow.
  - `POST /admin/attribution/refresh-views` then `GET /admin/attribution/per-triple?yearMonth=2026-04&limit=10` should return populated rows.
- Downstream effort `custom-to-base-graduation` can consume `GET /admin/attribution/graduation-candidates` directly — no shape changes needed.
- Follow-up tracked in the Phase 4 deviation note: if per-kind "Value / Compute $" is desired, add a `per-item-kind` aggregation view and update `CostDefensibilityView`.
