# Expectations — Performance facet

## Pass conditions

### Dashboard (`/performance`)

- Route resolves without redirect to `/login` (storage-state authenticated).
- `<h2>Performance</h2>` is visible within 10s.
- One of the three terminal states is visible within 10s:
  1. `.empty-state` (no portfolio yet), OR
  2. `.no-data` inside the equity-curve card (empty `equity_curve[]`), OR
  3. A `<canvas>` element attached inside `.chart-container` (populated chart).
- No HTTP 5xx responses from `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101` during page load.

### Vocabulary (outside disclaimers + onboarding)

After removing `.legal-disclaimer`, `[data-testid="legal-disclaimer"]`, `[surface-key]`, and
`[data-surface-key]` nodes, the remaining user-visible text in the `.performance-page` root
must not contain (case-insensitive):

- `\bprediction(s|ed|or)?\b`
- `\brecommendation\b`
- `\badvice\b`

Disclaimers are intentionally exempt — CLAUDE.md requires every variant to state "not a
prediction model" and "not investment advice." Onboarding panels (`[surface-key]`) may
reference domain terminology in their content payload.

The dashboard surface itself uses safe vocabulary: "Performance," "Equity Curve,"
"Calibration," "Win Rate," "Realized PnL," "Active Positions" — none triggered by the
forbidden regex.

## Fail conditions

- Page redirects to `/login` → auth state stale; re-run `pnpm --filter @divinr/e2e exec tsx scripts/prepare-auth-state.ts`.
- `<h2>Performance</h2>` not visible within 10s → API outage or router change.
- None of `.empty-state`, `.no-data`, or chart `<canvas>` visible within 10s → render failure or upstream API hang.
- Any 5xx on `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101`.
- Forbidden vocabulary found in `.performance-page` text after stripping disclaimer/onboarding nodes.

## Known non-issues

- Equity-curve `<canvas>` mounts asynchronously after the API call resolves; wait for
  `networkidle` or explicitly wait for the canvas/empty-state to attach.
- Brand-new test users land in the `.empty-state` branch — that's a valid pass.
- `/analysts/:id/performance` intentionally renders "predicted direction" / "predictedDirection"
  domain copy in some test fixtures — keep that view out of the dashboard smoke.
