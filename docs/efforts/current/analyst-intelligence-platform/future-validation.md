# Future Effort: Trade Recommendation Validation

**Parent effort**: Analyst Intelligence Platform (Phase 6 ships the mechanism)
**Status**: Future
**Created**: 2026-04-07

## Why this is its own effort

Phase 6 of the Analyst Intelligence Platform builds the *mechanism* for AI-driven trade recommendations: the portfolio manager role, the trade-recommendation service with Kelly-criterion sizing, and the dashboard rewiring. That work is buildable, testable, and mergeable on its own merits.

What it does **not** do is *validate* that the recommendations are good. Validation requires wall-clock time — you can't compress "watch the system make calls and see how they resolve" into a quality gate that runs in CI. Folding it into Phase 6 would have made Phase 6 un-mergeable for days. So validation is its own effort.

## Goals

1. Run the trade recommendation pipeline in paper mode for 3 trading days as an end-to-end shakedown — verify position sizes are sane, recommendations persist, no crashes, no 100%-concentration mistakes.
2. After the shakedown, promote to live with a "calibrating" badge on dashboard cards for the first ~50 resolved trades.
3. Monitor calibration accuracy: do high-confidence (>70%) recommendations actually hit at their stated rate? Track this in a dedicated dashboard view.
4. Decide promotion criteria for removing the "calibrating" badge based on observed calibration, not arbitrary timelines.

## What "the system improves whether we wait or not" means here

Every prediction the analysts make adds to memory and tightens calibration regardless of whether trade recommendations are running in paper or live. The 3-day paper window is not a *learning* gate — it's a *don't-ship-something-that-crashes* gate. Once it's clean, live mode is just "the same thing, but the recommendations also drive UI surfaces."

## Open items

- Define "sane bounds" for position size validation precisely (max % per position, max % per sector, max total exposure)
- Decide where the "calibrating" badge lives in the UI and when it disappears
- Decide whether to log paper recommendations to a separate table or reuse the live recommendations table with a `mode` column
- Decide whether the 3-day window starts on PR merge or on first paper recommendation written

## Dependencies

Phase 6 of the Analyst Intelligence Platform must be merged first.
