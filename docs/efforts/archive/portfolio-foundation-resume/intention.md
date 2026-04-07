# Intention — Portfolio Foundation Resume + Autotrading Polish

**Created**: 2026-04-07
**Owner**: GolferGeek
**Predecessors**: agent-autotrading (archived 2026-04-07), portfolio-foundation Phase 1 (merged 2026-04-07)

## Why this effort

The agent-autotrading effort shipped a fully working backend autotrade pipeline (signal_cross opens, stop/take/trailing closes, EOD backstop sweep) — verified end-to-end this session including live price-injection tests on all three close paths and 463 passing unit assertions. **But the frontend story is missing**: there is no master-detail portfolio view to display the rich provenance fields (`trigger_reason`, `trigger_prediction_id`, `trigger_conviction`) that the autotraders are populating. The data is sitting in the DB with nowhere to be seen.

Portfolio-foundation Phase 1 already shipped the schema groundwork (kinds, day-trader seeds, arbitrator portfolio). **Phases 5–6 of portfolio-foundation are the missing UI piece** — they're the substrate that unblocks at least three deferred efforts (provenance tooltip, day-traders & leaderboard, manual immediate-fill trading) and turns the autotrade work into something a user can actually see and reason about.

This effort resumes portfolio-foundation Phases 5–6, lands the deferred provenance tooltip on top, and bundles a small backlog of autotrading polish + repo hygiene that surfaced during the agent-autotrading verification session. Bundling them keeps everything autotrade-adjacent in one PR cycle and lets the cleanup ride the same gates as the substantive UI work.

## What we want to be true when this is done

1. **A `/portfolios` master-detail view** where you can see every actor (user, each analyst, the arbitrator, each day-trader) with their balance, P&L, win rate, equity sparkline, and an expandable rows of positions. Replaces today's flat `/portfolio` view.
2. **Provenance tooltip** on every position row showing `trigger_reason`, the originating prediction (if any), and the conviction at trade time. The fields the autotraders populate finally have a UI surface.
3. **Manual immediate-fill trading** restored to the user portfolio path (deferred from portfolio-foundation Phase 1).
4. **Monthly reset + benchmark ingest** for portfolio comparison (deferred from portfolio-foundation Phase 1).
5. **Trade modal** on the new portfolio view, gated by the existing disclaimer flow.
6. **Day-traders & leaderboard** — the 3 day-trader portfolios (already seeded at $1M / 0 positions) start trading via their strategy hooks and appear in the leaderboard alongside analysts and the arbitrator.
7. **Autotrading code polish** — `AutotradeOpenHelper` extracted from the duplicated raw-SQL INSERT logic in `ConvictionTraderService` and `EodForcedBuyService`; trailing-stop arm threshold made env-tunable.
8. **Provenance disambiguation** — `eod-settlement.service.ts:183`'s `createAnalystPositions` backfill stops writing `trigger_reason='manual'` for below-threshold rows; it uses `'eod_backfill'` instead so the leaderboard can distinguish genuine user trades from autotrade backfill.
9. **Two open puzzles investigated and resolved**: (a) the 63 SHOP `trailing_stop` closes with $0 P&L observed during this session's Test A — root cause identified, code fixed if it's a real bug, documented if it's a benign race; (b) the 363+9 historical below-threshold rows from a stale `CONVICTION_TRADE_THRESHOLD=60` env — either deleted or annotated.
10. **Repo hygiene caught up**: `authz.users` seeded with ≥3 rows (unblocks `pnpm ci:markets`); `.claude/settings.json` permission allowlist drift committed; web bundle code-split via dynamic imports on route components to clear the 500 KB advisory.
11. **Test plan extended**: Tier 2 (per-screen) and Tier 3 (edge cases / multi-step trade flow) of `testing/ui/manual-test-plan.md` get walked top-to-bottom against the new master-detail view, with findings either fixed or filed as follow-ups. Tier 4 grows a subsection for day-traders.

## Out of scope

- Real-money trading (still paper-only).
- Day-trader strategy *content* — only the wiring + leaderboard surfacing. The actual strategies (`momentum-breakout`, `mean-reversion`, `gap-and-go`) keep whatever logic they have today; tuning is a follow-up.
- Refactoring the existing flat `/portfolio` view (it gets replaced, not patched).
- Changing the autotrade thresholds, sizing, or close rules — those are working and verified.
- Mobile / responsive design beyond what Ionic gives us for free.

## Constraints worth knowing up front

- Portfolio-foundation Phase 1 shipped schema kinds (`analyst`, `arbitrator`, `day_trader`, `user`) and seeds. We must not break those — this effort builds on them.
- The autotrade services (`ConvictionTraderService`, `StopLossWatcherService`, `EodForcedBuyService`) are working. Any refactor (#7) must keep all 86 unit assertions green and the live price-injection recipes (Tier 4 §4.2) reproducible.
- The `pf-portfolio-arbitrator` portfolio id is referenced as a hard-coded constant in `ConvictionTraderService` and `EodForcedBuyService`. Master-detail UI must not rename or move it.
- Disclaimer flow gates trade actions per project legal language rules — manual-fill trading must route through it.
- Dev ports: API 7100, web 7101, Postgres 54322. Tests assume these.
- Long sessions: UI tests should run in a fresh context, not bolted on.
