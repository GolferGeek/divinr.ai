---
name: divinr-tournaments-browser-skill
description: Playwright + Chrome-MCP patterns for the Divinr tournaments facet. Covers the list, detail tabs (Leaderboard/My Positions/Trade/Info), trade form, leaderboard → MemberProfileDrawer.
allowed-tools: Read Write Edit Grep Glob Bash
---

# Divinr Tournaments Browser Skill

Deep skill for the `tournaments` facet. Always load `divinr-workflow-browser-skill` first.

## Routes

- `/tournaments` — list of tournaments (upcoming / active / completed)
- `/tournaments/:id` — detail with four tabs: `leaderboard`, `positions`, `trade`, `info`
- `/tournaments/:id/results` — finalized-tournament results
- `/tournaments/create` — admin-only creation flow
- `/tournaments/history` — completed tournaments roll-up

## View files

- `apps/web/src/views/TournamentsView.vue`
- `apps/web/src/views/TournamentDetailView.vue`
- `apps/web/src/views/TournamentResultsView.vue`

## Key components

- `IonCard` tournament tiles with `AvatarStack` roster preview, status chip, type chip, countdown line, prize line
- `IonSegment` / `IonSegmentButton` tab bar in detail view (values: `leaderboard`, `positions`, `trade`, `info`)
- `LegalDisclaimer` on the list view (short variant): `<LegalDisclaimer>` — plus the inline "Virtual portfolios only" `<p class="disclaimer">`
- `MemberProfileDrawer` opens on leaderboard row click (club-scoped only)

## Trade form invariants

- Symbol regex: `/^[A-Z.]{1,10}$/`
- Direction: `long` | `short`
- Quantity: positive integer
- Equity-only: options are intentionally disabled; the UI ships without options trading for now.

## Deep-link query params

The `/tournaments/:id?tab=trade&symbol=AAPL&direction=long&qty=1&predictionId=...` shape is the trade-CTA hand-off target from the predictions facet. The detail view's `applyTradePrefillFromQuery()` consumes those params, populates the trade form, and clears the URL.

## File map

- `what.md` — architecture narrative
- `where.md` — exact Playwright locators
- `expectations.md` — pass/fail invariants
- `tests.md` — numbered Playwright cases + Chrome-MCP exploratory section
- `completeness.md` — gaps + human demo script
