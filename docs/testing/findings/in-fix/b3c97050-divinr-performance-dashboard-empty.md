---
product: divinr
severity: P0
capability: performance
surface-key: performance.dashboard
spec: apps/e2e/tests/performance/smoke.spec.ts
verify-command: pnpm --filter @divinr/e2e exec playwright test --project=performance
first-seen: 2026-04-20T06:44:04Z
last-seen: 2026-04-20T06:44:04Z
regression-count: 0
trace-artifact: /tmp/divinr-results/performance-artifacts/performance-smoke-performa-2d2c4-ers-vocabulary-clean-no-5xx-performance-retry1/trace.zip
status: in-fix
triaged-date: 2026-04-20
assigned-agent: divinr-test-agent
---

## What failed

The performance dashboard smoke spec timed out at `smoke.spec.ts:26` — none of
`.performance-page .empty-state`, `.performance-page .no-data`, or
`.performance-page .chart-container canvas` resolve within 10s. The page loads
but the populated chart canvas and the zero-state fallbacks are all missing,
so the disjunction never settles.

## Repro steps

1. `cd /home/golfergeek/projects/divinr.ai/apps/e2e`
2. `pnpm exec playwright test --project=performance`
3. Expected: either a chart canvas paints (populated user) or an
   `.empty-state` / `.no-data` block renders.
4. Observed: all three locators time out. Spec cannot distinguish between
   "page is loading forever" and "page rendered in an unexpected structural
   state."

## Notes

- Trace: `/tmp/divinr-results/performance-artifacts/performance-smoke-performa-2d2c4-ers-vocabulary-clean-no-5xx-performance-retry1/trace.zip`.
- Matches the "chart / equity-curve render presence" and "data-view rendered
  vs blank" patterns simultaneously — either the chart-producing aggregation
  returned nothing or the performance page structural class changed out from
  under the locator.
- Companion failures: portfolios (6b7d933c), authoring (528d542d), admin
  (dd97ef65). Same suspected upstream (stale stored auth) — triage first.
- Severity left at `major` per agent rules.
