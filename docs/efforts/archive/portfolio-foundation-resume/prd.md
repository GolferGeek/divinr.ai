# Portfolio Foundation Resume + Autotrading Polish — Product Requirements Document

**Created**: 2026-04-07
**Intention**: ./intention.md
**Predecessors**:
- `docs/efforts/archive/portfolio-foundation/` — schema groundwork shipped (Phase 1 only)
- `docs/efforts/archive/agent-autotrading/` — backend autotrade pipeline shipped, frontend deferred

## 1. Overview

Resume portfolio-foundation Phases 2–6 (manual immediate-fill trading, master-detail read API, background jobs, master-detail UI, trade action UI), surface the day-trader portfolios that already exist, land the provenance tooltip the agent-autotrading effort deferred, and clean up the small backlog of polish + hygiene items that surfaced during the agent-autotrading deep-test session.

The prior portfolio-foundation PRD (`docs/efforts/archive/portfolio-foundation/prd.md`) already specifies the schema, services, endpoints, store actions, and UI layout for Phases 2–6 in technical detail. **This PRD does not re-specify that content**; it references the prior PRD and only documents the **deltas** introduced by the changed context (autotrade is shipped, day-trader provenance fields exist, the tooltip can finally be implemented) plus the **new** polish/hygiene/testing scope.

## 2. Goals & Success Criteria

### Goals

| # | Goal | Verification |
|---|---|---|
| G1 | `/portfolios` master-detail view renders every actor (user, analysts, arbitrator, day-traders) with name, kind, current balance, realized + unrealized P&L, win rate (closed wins / total closed), total return %, bailouts, open-position count, **and a small inline equity sparkline** sourced from the last 30 `daily_pnl_snapshot` rows. Click row → expanded panel with positions list + recent trades. | Manual Chrome walk + Vitest store spec |
| G2 | Provenance tooltip on every position row shows `trigger_reason`, originating prediction id (if any), and `trigger_conviction` at trade time | Manual Chrome walk; tooltip appears on signal_cross / eod_sweep / stop_loss / take_profit / trailing_stop / manual rows |
| G3 | Manual immediate-fill trading: user can buy or close at current cached price via `POST /markets/portfolios/me/execute-trade` and `POST /markets/portfolios/me/positions/:id/close`; idempotent on (user, prediction, instrument, day) | Curl + Vitest spec |
| G4 | Trade modal in the new master-detail view, gated by the existing disclaimer ack flow | Manual Chrome walk through prediction → modal → disclaimer → fill → portfolio row |
| G5 | Monthly reset writes one `bailout_ledger` row per portfolio per month (idempotent), SPY benchmark series ingests daily, daily P&L snapshots write at 22:00 UTC for every portfolio | Curl admin trigger + DB inspection + books-balance invariant |
| G6 | The 3 day-trader portfolios start trading via their strategy hooks and appear in the leaderboard alongside analysts and the arbitrator | DB shows non-zero positions in `pf-portfolio-momentum-breakout`, `pf-portfolio-mean-reversion`, `pf-portfolio-gap-and-go`; leaderboard endpoint includes them |
| G7 | `AutotradeOpenHelper` extracted from the duplicated raw-SQL INSERT logic in `ConvictionTraderService` and `EodForcedBuyService`; both services produce byte-identical DB rows after refactor | All 86 agent-autotrading unit assertions still pass; live Tier 4 §4.2 recipes still reproducible |
| G8 | `STOP_LOSS_PCT` / `TAKE_PROFIT_PCT` / `TRAILING_ARM_PCT` / `TRAILING_STOP_PCT` constants in `stop-loss-watcher.service.ts:33-36` are env-tunable via `STOP_LOSS_PCT` etc. with the current values as defaults | Unit test asserting env override; default unchanged when env unset |
| G9 | `eod-settlement.service.ts:183`'s `createAnalystPositions` backfill writes `trigger_reason='eod_backfill'` for below-threshold rows instead of `'manual'`; the `analyst_positions.trigger_reason` CHECK constraint admits the new value | Migration applied; new rows written this way; static SQL invariant added to Tier 4 §4.1 |
| G10 | The 63 SHOP `trailing_stop` $0-P&L closes from the deep-test session investigated; either fixed (if a real bug) or documented (if a benign race during a price-bump window). Resolution captured in completion report. | Either a code change with regression test, or a documented note explaining the race |
| G11 | Historical 363+9 below-threshold autotrade rows (from a stale `CONVICTION_TRADE_THRESHOLD=60` env) cleaned up: a one-shot SQL run either deletes them or annotates them with a `notes` field. Tier 4 §4.1 invariant becomes enforceable on fresh data. | Static SQL invariant `min(trigger_conviction) >= 70 OR notes IS NOT NULL` returns 0 violations |
| G12 | `authz.users` seeded with ≥ 3 rows so `pnpm ci:markets` runs end-to-end; markets gate goes green | `pnpm ci:markets` exits 0 |
| G13 | `.claude/settings.json` permission-allowlist drift committed | `git status` clean for that file |
| G14 | Web bundle no longer triggers the 500 KB advisory. Routes already use dynamic `import()`; the 1 MB `index-*.js` is a vendor chunk (likely `@ionic/vue` + icons eagerly bundled). Resolution: configure vite `build.rollupOptions.output.manualChunks` to split the vendor bundle, or move icon imports to dynamic so unused icons drop out. Target: no chunk > 500 KB after gzip. | `pnpm build` output shows no chunk-size warning |
| G15 | `testing/ui/manual-test-plan.md` Tier 2 (per-screen elements + interactions) and Tier 3 (edge cases / multi-step trade flow) walked top-to-bottom against the new master-detail view, with findings either fixed or filed; Tier 4 grows a `4.6 day-traders` subsection | Test plan updated; Tier 2/3 results captured in completion report |

### Done when

- All quality gates pass on the effort branch (lint, typecheck, build, unit, markets gate, manual chrome walk).
- A real run shows: a manual user trade filling at current price; every actor visible at $1M (or current balance) in master-detail; provenance tooltip surfaces `signal_cross` data on at least one row; manual `monthly-reset` writes ledger rows; one day's SPY in `benchmark_series`; one day's `daily_pnl_snapshot` rows present; day-trader portfolios have at least one position each.
- All 86 agent-autotrading unit assertions still green; all Tier 4 §4.2 live recipes still reproducible against the refactored helper.
- Completion report documents the resolution of the SHOP $0-P&L anomaly (G10) and the historical-row cleanup (G11).

## 3. User Stories / Use Cases

Same as `docs/efforts/archive/portfolio-foundation/prd.md` §3, plus:

- **As an observer**, I open `/portfolios`, click into any analyst row, hover over a position with `trigger_reason='signal_cross'`, and see a tooltip that says *"Opened by signal-cross autotrade — prediction `<id>`, conviction 78"*. For a `stop_loss` close I see *"Closed by stop-loss watcher — exit at $X.XX, −5.4% from entry"*.
- **As an observer**, I open `/portfolios`, see the 3 day-trader portfolios listed alongside analysts and the arbitrator, each with their own positions and equity sparkline.
- **As a developer**, I run `pnpm ci:markets` locally and it goes all the way through instead of stopping on the `authz.users` data prerequisite.

## 4. Technical Requirements

### 4.1 Architecture (delta from prior PRD)

This effort runs on top of what shipped from portfolio-foundation Phase 1 + agent-autotrading. The architecture is:

**What's already in place** (do not re-do):
- Schema columns + tables from portfolio-foundation §4.2 (`kind`, `strategy_name`, `strategy_state`, `trigger_*`, `high_water_mark`, `bailout_ledger`, `benchmark_series`, `daily_pnl_snapshot`)
- Arbitrator + 3 day-trader analyst rows + portfolios at $1M
- `ConvictionTraderService`, `StopLossWatcherService`, `EodForcedBuyService` — all wired, all populating provenance fields
- `POST /markets/admin/run-stop-loss-sweep`, `POST /markets/admin/run-eod-forced-buy` admin endpoints (added during deep-test session)

**What this effort adds**:
- `UserPortfolioService.executeImmediate()` + `closePosition()` (per prior PRD §4.1)
- `LeaderboardService` with `getAllPortfoliosSummary()` + `getPortfolioDetail()` (per prior PRD §4.1)
- `MonthlyResetService` + `BenchmarkIngestService` (per prior PRD §4.1)
- `EodSettlementService` extension to write `daily_pnl_snapshot` rows (per prior PRD §4.1)
- **NEW** `AutotradeOpenHelper` (in `apps/api/src/markets/services/`) — pure helper with one method `openPosition({db, portfolio, instrumentId, symbol, direction, quantity, entryPrice, predictionId, conviction, triggerReason, organizationSlug})`. Used by both `ConvictionTraderService` and `EodForcedBuyService`. Returns the inserted position id or null on idempotency conflict. Must produce byte-identical DB rows to today's behavior.
- **NEW** `DayTraderRunnerService` — invokes the 3 day-trader strategies on a cron and writes their position open/close actions through the same `AutotradeOpenHelper` + `AnalystPortfolioService.closePosition` paths. Strategy *content* is whatever exists today; this effort wires it, not tunes it.
- Frontend: refactored `PortfolioDashboardView.vue` (per prior PRD §4.4) **plus** a `<ProvenanceTooltip>` component that reads `trigger_reason` + `trigger_prediction_id` + `trigger_conviction` from the position row and renders a small popover. Used on every position row in the new master-detail view.

### 4.2 Data Model Changes (delta only)

Phase 1 already shipped the heavy schema. This effort adds **two** small changes:

1. **Extend the `analyst_positions.trigger_reason` CHECK constraint** to admit `'eod_backfill'`:
   ```sql
   ALTER TABLE prediction.analyst_positions DROP CONSTRAINT IF EXISTS analyst_positions_trigger_reason_check;
   ALTER TABLE prediction.analyst_positions ADD CONSTRAINT analyst_positions_trigger_reason_check
     CHECK (trigger_reason IN ('signal_cross','eod_sweep','eod_backfill','stop_loss','take_profit','trailing_stop','manual','strategy'));
   ```
2. **Optional** annotation column for the historical-row cleanup (G11), only if cleanup chooses the *annotate* path rather than the *delete* path:
   ```sql
   ALTER TABLE prediction.analyst_positions ADD COLUMN IF NOT EXISTS notes text;
   ```
   Decision deferred to the implementation phase based on whether the user prefers to keep history.

No other DDL.

### 4.3 API Changes (delta only)

All endpoints from prior PRD §4.3 carry over (`execute-trade`, `:positionId/close`, `GET /markets/portfolios`, `GET /markets/portfolios/:kind/:id`, `POST /markets/portfolios/admin/monthly-reset`).

**New** in this effort:
- `POST /markets/admin/run-day-trader-strategies` — admin trigger for the new `DayTraderRunnerService`, parallel to `run-stop-loss-sweep` and `run-eod-forced-buy`. Same auth pattern.

### 4.4 Frontend Changes (delta from prior PRD)

Prior PRD §4.4 carries over. **Additions**:

- **`<ProvenanceTooltip>` component** at `apps/web/src/components/ProvenanceTooltip.vue`. Props: `position: AnalystPosition`. Renders an Ionic popover on hover/click showing:
  - For opens (`signal_cross` / `eod_sweep` / `eod_backfill` / `manual`): the open reason, prediction id (linkified to `/predictions/:id`), conviction.
  - For closes (`stop_loss` / `take_profit` / `trailing_stop`): the close reason, exit price, percent move from entry.
- **Provenance tooltip wired** into every position row in the master-detail expanded panel — both `analyst_positions` (autotrade) and `user_positions` (manual).
- **Day-trader rows** in the master-detail summary table: same columns as analyst rows, with `kind='day_trader'` driving a small badge.
- **Code-split route components**: each route in `apps/web/src/router/index.ts` already uses dynamic `import()`. Investigate why the build still produces a 1 MB `index-*.js` and split whatever vendor chunk is responsible (likely `@ionic/vue` or all icons being eagerly bundled).

### 4.5 Infrastructure Requirements

- One additional cron in `DayTraderRunnerService` (schedule TBD during implementation — likely `0 14,18 * * 1-5` or every 30 min market hours).
- All other infra unchanged from prior PRD.
- `authz.users` seed: a one-shot SQL script under `apps/api/db/seeds/` (or wherever the existing seed pattern lives) inserting 3 rows with deterministic ids. Idempotent.

## 5. Non-Functional Requirements

- **Backwards compatibility**: every existing curl recipe in `testing/ui/manual-test-plan.md` Tier 4 §§4.1–4.5 must continue to work after the `AutotradeOpenHelper` refactor. All 86 agent-autotrading unit assertions must remain green.
- **Idempotency**: every new write path (manual trade, monthly reset, day-trader strategy invocation) must be idempotent against the natural key (user/prediction/instrument/day; portfolio/month; portfolio/instrument/strategy-tick).
- **Disclaimer flow**: every trade action originating from a user click must pass through the existing disclaimer ack guard. No bypass paths.
- **Performance**: master-detail summary endpoint must return in < 500ms for ≤ 100 portfolios. Day-trader cron must complete in < 60s.
- **Security**: admin endpoints require the existing admin-role guard. Day-trader runner is admin-only externally; the cron is internal.
- **Compatibility**: schema changes are additive (DROP + re-CREATE the CHECK constraint is the only non-additive operation, and it's compatible because every existing value is in the new set).

### 5.1 Hard constraints (from intention)

- **Arbitrator portfolio id is sacred**: `pf-portfolio-arbitrator` is referenced as a hard-coded constant in `ConvictionTraderService` and `EodForcedBuyService` (and now `AutotradeOpenHelper`). The new master-detail UI, `LeaderboardService`, and any seed scripts MUST NOT rename, move, or recreate this id. Any read path that needs it should use the same constant; any new code introducing a second source of truth is a regression.
- **Phase 1 schema invariants preserved**: schema kinds (`analyst`, `arbitrator`, `day_trader`, `user`) and the seeded portfolios are not to be altered. Day-trader portfolios `pf-portfolio-momentum-breakout`, `pf-portfolio-mean-reversion`, `pf-portfolio-gap-and-go` keep their ids.
- **Dev ports**: API on `7100`, web on `7101`, Postgres on `54322`. Curl gates and Tier 4 recipes assume these.
- **UI testing isolation**: Tier 2 / Tier 3 walks (Phase 10) MUST run in a fresh Claude context, not bolted onto a long backend session. The plan reflects this — Phase 10 is the last phase and explicitly callable as its own session.
- **Long-session ergonomics**: backend phases (1–4, 7, 8, 9) can run in one session each; UI phases (5, 6, 10) are sized to run in separate fresh sessions because Chrome MCP context grows quickly.

## 6. Out of Scope

- Real-money trading.
- Day-trader strategy *content* tuning.
- Refactoring the existing flat `/portfolio` view (it gets replaced).
- Changing autotrade thresholds, sizing, or close rules (those are working).
- Mobile / responsive design beyond Ionic defaults.
- Full Sharpe / drawdown / calibration metrics on the leaderboard (deferred to a follow-up).

## 7. Dependencies & Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | `AutotradeOpenHelper` refactor introduces a subtle SQL drift that breaks idempotency or provenance population | Migration phase has a Vitest test that diffs the SQL produced by old vs new helper against a snapshot; live Tier 4 §4.2 recipes re-run as part of phase gate |
| R2 | Day-trader strategies open positions in unexpected ways (wrong portfolio routing, wrong direction, missing provenance) | New `DayTraderRunnerService` routes through `AutotradeOpenHelper` so the day-trader rows get the same provenance discipline as analyst signal-cross rows; phase gate includes a DB query asserting day-trader portfolios have positions only in their own portfolio_id |
| R3 | The `SHOP $0-P&L trailing_stop` anomaly (G10) is a real bug in `decide()` that would have caused production losses to go un-recorded. | Phase 8 reproduces it deterministically before fixing or annotating; if it's a bug, fix lives in `stop-loss-watcher.service.ts` with a new unit test |
| R4 | Web bundle code-split (G14) breaks lazy-loading for some route and causes a runtime ChunkLoadError | Phase 9 walks every route after the split; rollback plan is to revert the vite/router changes and accept the 500 KB advisory |
| R5 | `authz.users` seed (G12) collides with an existing fixture or auth path | Use deterministic ids that match the existing seed convention; verify by running `pnpm ci:markets` before and after on a clean DB |
| R6 | Tier 2/3 walk surfaces a screen regression that needs a substantial fix and blows the effort scope | Time-box the walk; substantial findings get filed as separate efforts, not absorbed into this one |
| R7 | The historical-row cleanup (G11) deletes rows that someone is depending on for evaluation history | Default to *annotate*, not delete; document the choice in the completion report |

## 8. Phasing

Each phase below is a logical gate. Steps are intentionally short here; the build-plan flow will expand them.

### Phase 1: AutotradeOpenHelper extraction (G7)

Extract the duplicated raw-SQL INSERT logic from `ConvictionTraderService` and `EodForcedBuyService` into a single `AutotradeOpenHelper`. Both services route through it. All 86 agent-autotrading unit assertions stay green; live Tier 4 §4.2 recipes stay reproducible. **Done first** because it's a pure refactor that nothing else in this effort depends on, and getting it green confirms the rest of the autotrading code is safe to build on.

### Phase 2: Manual immediate-fill trading (G3)

Per prior PRD §4.3 and prior plan Phase 2. `executeImmediate` + `closePosition` on `UserPortfolioService`; `execute-trade` and `:positionId/close` endpoints; idempotency unit tests; curl gate.

### Phase 3: Master-detail read API (G1 backend half)

Per prior PRD §4.3 and prior plan Phase 3. New `LeaderboardService`; `GET /markets/portfolios` summary; `GET /markets/portfolios/:kind/:id` detail.

### Phase 4: Background jobs — reset, benchmark, daily P&L (G5)

Per prior PRD §4.1 and prior plan Phase 4. `MonthlyResetService` + `BenchmarkIngestService` + `EodSettlementService` extension. Books-balance invariant test.

### Phase 5: Frontend master-detail view + provenance tooltip (G1 frontend half + G2)

Per prior PRD §4.4 and prior plan Phase 5, **plus**:
- New `<ProvenanceTooltip>` component wired into every position row (per §4.4).
- Master-detail summary table renders the full G1 column set: name, kind, current balance, realized + unrealized P&L, win rate, total return %, bailouts, open-position count, **and an inline equity sparkline** rendered from the last 30 `daily_pnl_snapshot` rows surfaced via the Phase 3 detail endpoint. Sparkline component uses a lightweight inline-SVG approach (no chart library dependency).
- Day-trader rows render with a small badge.
- Web bundle vendor-chunk split (G14) — includes diagnosing whether the 1 MB `index-*.js` is `@ionic/vue` or eager icon imports, then applying the appropriate fix (`build.rollupOptions.output.manualChunks` for vendor split, or per-icon dynamic imports).

### Phase 6: Trade action UI (G4)

Per prior PRD §4.4 and prior plan Phase 6. Trade button on prediction / analysis / challenges views; modal; disclaimer ack flow.

### Phase 7: Day-trader runner + leaderboard surfacing (G6)

New `DayTraderRunnerService` cron + admin endpoint, routing through `AutotradeOpenHelper`. Day-trader portfolios appear in the leaderboard (this is automatic if Phase 3's summary endpoint includes all `kind` values).

### Phase 8: Autotrading polish + provenance disambiguation (G8 + G9 + G10 + G11)

- Make stop-loss / take-profit / trailing constants env-tunable (G8).
- Migrate `analyst_positions.trigger_reason` CHECK constraint to admit `eod_backfill`; switch `createAnalystPositions` to write that value (G9).
- Investigate + resolve the SHOP $0-P&L `trailing_stop` anomaly (G10).
- Clean up the 363+9 historical below-threshold rows (G11).

### Phase 9: Repo hygiene (G12 + G13 + G14)

- Seed `authz.users` with ≥ 3 rows (G12).
- Stage + commit `.claude/settings.json` allowlist drift (G13).
- Web bundle code-split (G14) — *if not already absorbed into Phase 5*.

### Phase 10: Test plan extension + Tier 2 / Tier 3 walk (G15)

- Walk Tier 2 (per-screen elements + interactions) against the new master-detail view.
- Walk Tier 3 (edge cases, multi-step trade flow).
- Add Tier 4 §4.6 (day-traders) with the proven recipes.
- Findings either fixed in-effort or filed as separate efforts.
- Update completion report with the walk results.

---

## Phase ordering rationale

Phase 1 first because it's pure refactor that confirms autotrading is safe to touch. Phases 2–6 follow the prior portfolio-foundation Phase 2–6 sequence because it was designed with the right dependency order (backend trade → backend read → backend cron → frontend table → frontend trade button). Phase 7 needs Phase 3 (so day-traders show up in the leaderboard endpoint). Phase 8 can technically run anytime after Phase 1 but is parked late so the polish doesn't distract from the substantive UI work. Phase 9 is hygiene — runs late so it doesn't block anything. Phase 10 is the validation pass that exercises everything together.
