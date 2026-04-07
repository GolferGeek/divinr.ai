# Analyst Intelligence Platform — Completion Report

**Plan**: [plan.md](plan.md)
**PRD**: [prd.md](prd.md)
**Intention**: [intention.md](intention.md)
**Completed**: 2026-04-07
**Final Status**: All Phases Complete (1–6). Validation moved to follow-up effort.

## Summary

- Total phases: 6
- Phases completed: 6
- Phases remaining: 0 (paper-trading shakedown spun out as `future-validation.md`)

## Phase Results

**Phase 1: Foundation** — Complete (prior session). Renamed analysts to professional names, wired learning engine to write memories, created data source registry tables, defined `DataSourceAdapter` interface, seeded free-tier sources and analyst-source assignments, added `source_context` column.

**Phase 2: Data Source Adapters** — Complete (prior session). Built rate limiter and cache utilities, then 7 adapters: Twelve Data, FMP, SEC EDGAR, Finnhub, FRED, Polygon, Reddit. All degrade gracefully without API keys. Wired into context provider flow.

**Phase 3: Per-Analyst Article Scoring** — Complete (prior session). Each analyst scores articles through their own persona-specific lens. Updated unique constraint on `market_predictors` to allow per-analyst rows. Per-analyst signal thresholds and predictor pools.

**Phase 4: Per-Analyst Risk Assessment** — Complete (prior session). Replaced generic risk dimensions with per-analyst risk perspectives. Debate Blue/Red drawn from analyst pool (most bullish vs most bearish). Historical dimension-based risk data still accessible.

**Phase 5: Full Pipeline Integration** — Complete (prior session). Each analyst runs fetch → score → risk → predict as a unit. Arbitrator multi-stage synthesis. Per-step timing logged.

**Phase 6: Trade Recommendations** — Complete (this session). Three steps:

- **6.1**: Portfolio Manager analyst record. Idempotent seeder `seedPortfolioManagerAnalyst()` in `markets-schema.service.ts` inserts the `portfolio-manager` analyst with `analyst_type='portfolio_manager'` and `workflow_scope='trade'`. Type updates to `AnalystType` and `WorkflowScope` in `markets.types.ts`.

- **6.2**: `TradeRecommendationService` (`apps/api/src/markets/services/trade-recommendation.service.ts`). Pure-function math methods (unit-tested) for direction → action mapping, calibration-adjusted probability, Kelly fraction (b=2 default reward:risk), risk-and-consensus adjustment, position-percent clamping, and stop-loss / take-profit calculation. End-to-end `computeRecommendation()` orchestrates all of them. DB methods load arbitrator output, composite risk, analyst consensus, portfolio balance, and historical calibration accuracy. Persistence reuses `market_predictions` with `role='portfolio_manager'` and a new `trade_metadata jsonb` column. Generation is idempotent at the persistence layer.

- **6.3**: Dashboard frontend. `DashboardView.vue` now shows a Portfolio Manager recommendation block on each prediction card: action chip (BUY/SELL/HOLD), sized quantity, and entry/stop/target prices. A "calibrating" badge appears while the system has fewer than 50 resolved evaluations. The existing "View Analysis" button is preserved for drill-in. The pre-existing `user_trade_decisions` table is left intact for manual override. The `getDashboardPredictions` endpoint now lazily generates a portfolio_manager prediction per run on first read (idempotent). A standalone `GET /markets/runs/:runId/trade-recommendation` endpoint is also exposed.

## Gate Results

- **API typecheck**: clean
- **API build**: clean
- **API unit tests**: 310 tests pass across 12 suites, including 60 new trade-recommendation tests
- **Web typecheck**: 5 pre-existing DOM-lib errors (`HTMLElement`, `window`) in files Phase 6 did not touch — verified present on the checkpoint commit. Phase 6 actually fixed one pre-existing error in `DashboardView.vue` (missing `prediction_id` field on local `AnalystStance` interface).
- **Web build**: clean
- **Lint**: not run as part of this session's gate; can be added in PR-eval

## Deviations from PRD / Plan

1. **Paper trading shakedown removed from Phase 6.** The original plan had a 3-day paper-trading window as part of Phase 6's quality gate. This is a wall-clock requirement that cannot be satisfied in CI and would have made Phase 6 un-mergeable. It has been moved to a follow-up effort tracked in [`future-validation.md`](future-validation.md). Phase 6 ships the *mechanism*; the *validation window* is now its own effort. The user explicitly approved this scope split.

2. **No new `trade_recommendations` table.** Reused `market_predictions` with `role='portfolio_manager'` plus a new `trade_metadata jsonb` column. This avoids schema sprawl, keeps the same indexing and lifecycle (`settled_at` flow, EOD settlement) as other prediction rows, and means downstream consumers can query trade recommendations through the same surface they already use for arbitrator/analyst predictions.

3. **No LLM call in the recommendation service.** The plan suggested the portfolio manager would have a persona prompt — and it does, on the analyst record — but the recommendation itself is pure math (Kelly + risk + consensus + calibration). This is intentional: the math is deterministic, fast, testable, and auditable in a way an LLM call wouldn't be. The persona prompt is preserved on the analyst record for future use if a "narrate the rationale" LLM step is added later.

4. **Calibration source.** The plan was ambiguous about how to compute the arbitrator's calibration accuracy. The implementation reads from `market_run_evaluations` (organization-scoped, including `__base__`) and requires ≥20 evaluation samples before using the historical accuracy; otherwise it falls back to a `DEFAULT_CALIBRATION_ACCURACY = 0.85` constant. This is documented in the service.

5. **Calibrating-badge threshold.** Set to `<50 resolved evaluations` per the plan's comment about "calibrating for the first ~50 resolved trades."

## Next Steps

1. **PR review and merge.** Branch: `effort/analyst-intelligence-platform-phase-6`. Run `/pr-eval` to evaluate PR-level architectural compliance.

2. **Spin up the validation effort.** See `future-validation.md` for the 3-day paper-trading shakedown plus calibration-window monitoring.

3. **Optional follow-ups identified during implementation:**
   - Wire `TradeRecommendationService.generateForRun()` directly into `prediction-runner.service.ts` at run completion, so recommendations exist before the user opens the dashboard (currently lazy-generated on first read).
   - Add a per-instrument concentration cap in addition to the per-position cap (currently 10% per position with no aggregate concentration check across positions).
   - Surface the trade recommendation rationale in the modal (currently only the action chip + numbers are shown on the card; the full rationale is persisted but not yet rendered).
   - Lint script on the API package was not run as part of the Phase 6 gate. Add to the PR-eval pass.
