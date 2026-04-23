---
product: divinr
severity: P0
capability: portfolios
surface-key: portfolios.dashboard
spec: apps/e2e/tests/portfolios/smoke.spec.ts
verify-command: pnpm --filter @divinr/e2e exec playwright test --project=portfolios
first-seen: 2026-04-20T06:44:04Z
last-seen: 2026-04-20T06:44:04Z
regression-count: 0
trace-artifact: /tmp/divinr-results/portfolios-artifacts/portfolios-smoke-portfolio-d49fa--enforces-vocabulary-no-5xx-portfolios-retry1/trace.zip
status: in-fix
triaged-date: 2026-04-20
assigned-agent: divinr-test-agent
---

## What failed

The portfolios dashboard smoke spec timed out at `smoke.spec.ts:24` — the
populated-branch locator `.portfolio-row` and the zero-state fallback
`getByText(/^no portfolios yet\.?$/i)` are both absent after 10s on the
`/portfolios` route, so neither branch of the "populated or empty" disjunction
ever resolves. The spec passed on an earlier run and regressed in this cron
pass; auth state was re-used from `apps/e2e/.auth/testing-team.json`.

## Repro steps

1. `cd /home/golfergeek/projects/divinr.ai/apps/e2e`
2. `pnpm exec playwright test --project=portfolios`
3. Expected: either the first `.portfolio-row` renders (seeded testing-team
   user has one portfolio) or the "No portfolios yet." empty-state renders.
4. Observed: both locators time out after 10s. The page loads (no `/login`
   redirect), the heading resolves, but the dashboard body never paints
   either state.

## Notes

- Trace: `/tmp/divinr-results/portfolios-artifacts/portfolios-smoke-portfolio-d49fa--enforces-vocabulary-no-5xx-portfolios-retry1/trace.zip`.
- Companion failures in this cron pass: `performance` (b3c97050), `authoring`
  (528d542d), `admin` (dd97ef65). Three of the four show "surface loaded but
  primary list locator missing" — suggests a shared upstream cause (likely
  the stored auth state at `apps/e2e/.auth/testing-team.json` is stale: it
  was captured 2026-04-19T20:44 and may have expired by the time the cron
  fires). Triage should look at token freshness before chasing per-facet
  selectors.
- Matches the divinr-test-agent "data-view rendered vs blank" pattern — the
  skeleton container is present, primary rows never appear.
- Severity left at `major` per agent rules (triage agent owns escalation).
