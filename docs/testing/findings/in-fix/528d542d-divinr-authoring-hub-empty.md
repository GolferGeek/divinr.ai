---
product: divinr
severity: P0
capability: authoring
surface-key: authored.your-content
spec: apps/e2e/tests/authoring/smoke.spec.ts
verify-command: pnpm --filter @divinr/e2e exec playwright test --project=authoring
first-seen: 2026-04-20T06:44:04Z
last-seen: 2026-04-20T06:44:04Z
regression-count: 0
trace-artifact: /tmp/divinr-results/authoring-artifacts/authoring-smoke-authoring--93fc8-rade-CTA-no-5xx-vocab-clean-authoring-retry1/trace.zip
status: in-fix
triaged-date: 2026-04-20
assigned-agent: divinr-test-agent
---

## What failed

The authoring hub smoke spec timed out at `smoke.spec.ts:29` — neither the
first `ion-card` (populated branch: user has authored content) nor
`getByText(/no authored analysts yet — create your first one\.?/i)` (empty
state) resolve within 10s. The hub page loads but the expected primary
surface content is missing.

## Repro steps

1. `cd /home/golfergeek/projects/divinr.ai/apps/e2e`
2. `pnpm exec playwright test --project=authoring`
3. Expected: either the first authored-analyst `ion-card` renders or the
   "No authored analysts yet — create your first one" empty-state renders.
4. Observed: both locators time out. The authoring hub page is reachable
   but never paints either content branch.

## Notes

- Trace: `/tmp/divinr-results/authoring-artifacts/authoring-smoke-authoring--93fc8-rade-CTA-no-5xx-vocab-clean-authoring-retry1/trace.zip`.
- Matches the "empty-vs-populated state distinction" pattern — the surface
  picks neither branch. Likely a loading state that never settles, which in
  turn suggests the data call either hangs or 401s silently.
- Companion failures in this cron pass: portfolios (6b7d933c), performance
  (b3c97050), admin (dd97ef65). Shared suspected root cause: stored auth
  state at `apps/e2e/.auth/testing-team.json` is stale (captured
  2026-04-19T20:44, run on 2026-04-20). Triage should refresh the auth state
  via `apps/e2e/scripts/prepare-auth-state.ts` and re-run before opening
  individual product-side tickets.
- Severity left at `major` per agent rules.
