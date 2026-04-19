# Completeness — Tournaments facet

## What the smoke covers

- List route loads, heading renders, cards-or-empty state.
- Vocabulary check outside `<LegalDisclaimer>` nodes.
- Detail route resolves on card click.
- All four segment tabs render on detail.
- No 5xx from `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101`.

## Known gaps (not yet automated)

1. **Trade submit** — creating a paper trade. Needs a deterministic symbol + quantity + confirmation selector set that doesn't pollute prod tournament state.
2. **Deep-link prefill** — `/tournaments/:id?tab=trade&symbol=AAPL&direction=long&qty=1&predictionId=...` → `applyTradePrefillFromQuery()`. Needs a fixture predictionId.
3. **Leaderboard row click → MemberProfileDrawer** — requires a club-scoped tournament fixture.
4. **Countdown + `Enter Game` states** — requires seeded upcoming + active tournaments. Currently skippable in smoke.
5. **`/tournaments/:id/results`** — finalized view. No test coverage yet; needs a completed tournament fixture.
6. **`/tournaments/create`** admin flow — not in smoke; separate admin skill.
7. **Positions tab empty-state copy** — not yet asserted.

## Human demo script (manual)

1. Log in as testing-team; navigate to `/tournaments`.
2. Verify cards render with avatar stack, status chip, prize line, date range.
3. Filter scope = `system`; filter status = `active`. Confirm list refreshes.
4. Click any card. Confirm URL is `/tournaments/<uuid>`.
5. Click each segment button in order: Leaderboard → My Positions → Trade → Info. Content should change per tab.
6. On Trade tab, type `AAPL` + qty `1`, pick `long`, do **not** submit. Confirm submit button enables.
7. Navigate to `/tournaments/<uuid>?tab=trade&symbol=AAPL&direction=long&qty=1`. Confirm form pre-fills and URL strips params after consumption.
8. If a finalized tournament exists, navigate to `/tournaments/<uuid>/results` and verify the finalized snapshot renders.

## Promotion criteria

To promote a gap into the smoke spec, the fixture needs to be either: (a) idempotent against prod data (read-only), or (b) backed by a dedicated seed fixture in the `testing-team` scope that no human user touches.
