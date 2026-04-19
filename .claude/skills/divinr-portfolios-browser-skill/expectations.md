# Expectations — Portfolios facet

## Pass conditions

### Page

- Route `/portfolios` resolves without redirect to `/login` (storage-state authenticated).
- `<h1>Portfolios</h1>` is visible within 10s.
- Either at least one `.portfolio-row` is visible, **or** the whole-page empty marker (`No portfolios yet.`) is visible. Both-missing is a failure.
- All three segment tabs (`My Portfolio`, `Analyst Portfolios`, `My Triples`) render regardless of data state. The smoke does not assert which one is selected; default is `mine`.
- No HTTP 5xx responses from `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101` during the page lifecycle.

### Vocabulary (outside disclaimers)

After removing `.legal-disclaimer`, `[data-testid="legal-disclaimer"]`, `[surface-key]`, and `[data-surface-key]` nodes, the remaining user-visible text must not contain (case-insensitive):

- `\bprediction(s|ed|or)?\b`
- `\brecommendation\b`
- `\badvice\b`

Disclaimer / first-touch onboarding copy is intentionally exempt — CLAUDE.md requires every variant to state "not a prediction model" and "not investment advice."

## Fail conditions

- Page redirects to `/login` → auth state stale; re-run `pnpm --filter @divinr/e2e exec tsx scripts/prepare-auth-state.ts`.
- `<h1>Portfolios</h1>` not visible within 10s → API outage or router change.
- Neither portfolio rows nor the whole-page empty note visible → render failure.
- Any 5xx on `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101`.
- Forbidden vocabulary found in non-disclaimer copy. **Note**: if found, do not edit `apps/web/src/`. Open a vocabulary issue and add a skip annotation in the smoke spec, then document it in `completeness.md`.

## Known non-issues

- The user's auto-expanded row may show `Loading…` briefly before details arrive — assert on the row container, not the inner panel.
- Equity / calibration charts may render empty for fresh accounts — do not assert chart content.
- `Sell` buttons appear only when `canWrite` AND `kind === 'user'` AND `pos.status === 'open'` — do not assert presence in generic smoke.
- The `triples` tab requires `AddTripleFlow` and the enablement store; do not click into it from the smoke.
- `Decisions` and `Queued Trades` lists may be empty for the testing-team account — do not assert row counts.
