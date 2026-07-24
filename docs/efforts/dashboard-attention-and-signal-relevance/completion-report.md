# Dashboard Attention and Signal Relevance — Completion Report

## Goal

Refocus the Divinr dashboard on information that deserves the signed-in user's
attention: open portfolio positions, active tournament context, and a bounded,
explainable set of relevant analyses.

## What Landed

- Deterministic dashboard relevance scoring with stable ordering and explicit
  reason codes.
- User-managed followed analysts, watched instruments, muted instruments, and
  dashboard priority mode.
- Portfolio-first and tournament-standing dashboard modules with useful empty
  states.
- A compact relevant-analysis module with visible relevance reasons.
- Analysis Preferences settings route and persistence.
- Explicit schema bootstrap tracking for the new preference tables.
- First-touch content and coverage updates.
- Deep browser-skill documentation and Playwright coverage across analyses,
  portfolios, and tournaments.
- Student billing month-selection regression fix discovered during the effort's
  full test pass.

## Delivery History

The primary implementation landed in commit `6de0012`, with dashboard layout and
density follow-ups in `d9d9380` and `ad26f93`. Additional repository commits
after those changes did not remove the implemented surfaces or their tests.

## Verification

Closure verification on 2026-07-24:

| Gate | Result |
|---|---|
| API lint | Pass |
| Web lint | Pass |
| API typecheck | Pass |
| Web typecheck | Pass |
| API build | Pass |
| Web build | Pass; existing Ionic `:host-context` minifier warnings only |
| First-touch coverage | Pass |
| Dashboard signal gate | Pass |
| Dashboard relevance scoring | Pass |
| Analysis preferences service | Pass |
| Student billing regression | Pass |
| Focused production Playwright | 4/4 pass |

The production-facing Playwright run covered:

- dashboard analysis-card shape and navigation;
- Analysis Preferences load/save/reload;
- portfolio dashboard smoke and vocabulary;
- tournament list/detail smoke and vocabulary; and
- no observed 5xx responses in those happy paths.

Retained screenshots at
`.testing-artifacts/dashboard-attention-desktop.png` and
`.testing-artifacts/dashboard-attention-mobile.png` were visually inspected.
The priority modules were visible, the mobile stack was coherent, and no text,
button, badge, or card overlap was observed.

## Success Criteria

| Criterion | Result |
|---|---|
| Dashboard prioritizes positions and tournaments | Pass |
| Relevant analyses are bounded and explainable | Pass |
| Explicit user preferences affect relevance | Pass |
| Muted instruments can be excluded | Pass |
| Empty states remain useful | Pass |
| First-touch and deep testing coverage are present | Pass |
| User-visible vocabulary follows repository rules | Pass |

## Deviations

- The implementation was already committed before this formal closure review.
  The remaining work was verification and effort-state cleanup, not a new
  product-code patch.
- The web production build continues to print third-party Ionic
  `:host-context` minification warnings. The build succeeds and the warnings are
  unrelated to this effort.

## Follow-Ups

- More deterministic seeded data would allow non-skipped assertions for every
  preference/relevance combination in browser tests.
- The existing browser skills retain their documented deeper interaction gaps;
  none blocks this dashboard effort.

## Final Status

Complete. The effort can leave `docs/efforts/current/`.
