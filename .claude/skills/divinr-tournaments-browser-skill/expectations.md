# Expectations — Tournaments facet

## Pass conditions

### List page

- Route `/tournaments` resolves without redirect to `/login` (storage-state authenticated).
- `<h1>Tournaments</h1>` is visible within 10s.
- Either one or more `.tournament-card` elements are visible, **or** the `.empty` state is visible. Both-missing is a failure.
- Legal disclaimer text is present on the page (either `<LegalDisclaimer>` node or the inline `.disclaimer` paragraph).
- No HTTP 5xx responses from `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101` during the page lifecycle.

### Vocabulary (outside disclaimers)

After removing `.legal-disclaimer`, `[data-testid="legal-disclaimer"]`, `[surface-key]`, and `[data-surface-key]` nodes, the remaining user-visible text must not contain (case-insensitive):

- `\bprediction(s|ed|or)?\b`
- `\brecommendation\b`
- `\badvice\b`

Disclaimers are intentionally exempt — CLAUDE.md requires every variant to state "not a prediction model" and "not investment advice."

### Detail page

- Clicking a tournament card navigates to `/tournaments/:id`.
- All four segment buttons are present (`leaderboard`, `positions`, `trade`, `info`), even when a tab's content is empty.
- Default selected tab is `leaderboard`.
- Switching to `trade` tab reveals the trade form (symbol, quantity, long/short, submit).
- No 5xx during tab switching.

## Fail conditions

- List page redirects to `/login` → auth state stale; re-run `pnpm --filter @divinr/e2e exec tsx scripts/prepare-auth-state.ts`.
- `<h1>Tournaments</h1>` not visible within 10s → API outage or router change.
- Neither cards nor empty state visible → render failure.
- Any 5xx on `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101`.
- Forbidden vocabulary found in non-disclaimer copy.
- Fewer than four segment buttons on detail page.

## Known non-issues

- Leaderboard may be empty pre-market-open — assert the tab switches, not that rows exist.
- `My Positions` may be empty for a fresh testing-team user — do not assert row count.
- `Enter Game` button is conditional on `canWrite` + status; do not assert presence in generic smoke.
