---
name: divinr-portfolios-browser-skill
description: Playwright + Chrome-MCP patterns for the Divinr portfolios facet. Covers the /portfolios dashboard, the My Portfolio / Analyst Portfolios / My Triples segment tabs, the kind/sort filters, and expandable portfolio rows.
allowed-tools: Read Write Edit Grep Glob Bash
---

# Divinr Portfolios Browser Skill

Deep skill for the `portfolios` facet. Always load `divinr-workflow-browser-skill` first.

## Routes

- `/portfolios` — single dashboard page with three segmented tabs (`mine`, `analysts`, `triples`)

## View files

- `apps/web/src/views/PortfolioDashboardView.vue`

## Key components

- `IonSegment` / `IonSegmentButton` tab bar with values `mine` (My Portfolio), `analysts` (Analyst Portfolios), `triples` (My Triples)
- `.portfolio-row` rows grouped by kind (My Portfolio / Analysts / Day Traders) with columns: Name, Balance, Return, Win Rate, Open positions
- Expandable detail panel per row with secondary metrics (Realized, Unrealized, Bailouts, Sharpe, Max DD, Streak, Calibration), `EquityCurveChart`, optional `CalibrationChart`
- Filter row: `<input data-testid="portfolio-search">`, kind chips (`[data-testid="kind-chip-user|analyst|arbitrator|day_trader"]`), sort `<select>` + direction chip
- `AddTripleFlow` component on the `triples` tab
- `FirstTouchPanel` with `surface-key="portfolios"`
- For the `mine` tab the user's own row auto-expands, showing Account cards (Balance / Realized / Unrealized / Open Positions), Queued Trades list, and Decisions list

## Empty-state copy

- Whole-page (no portfolios in any group): `<ion-note color="primary">No portfolios yet.</ion-note>`
- No positions in expanded row: `<ion-note>No positions in last 30 days.</ion-note>`
- No queued trades (mine tab, expanded user row): `No queued trades. Trades execute at 5 PM ET settlement.`
- Triples tab empty: `No triples enabled yet. Add instruments to your portfolio to get started.`

## Data invariants

- Page heading is always literal `Portfolios` (`<h1>Portfolios</h1>`).
- The three segment buttons are always rendered regardless of data state.
- A user with `myPortfolio` populated should see at least their own user row in the `mine` tab.
- The disclaimer for portfolios is rendered via the `FirstTouchPanel` (onboarding surface), not via inline text on this view.

## File map

- `what.md` — architecture narrative
- `where.md` — exact Playwright locators
- `expectations.md` — pass/fail invariants
- `tests.md` — numbered Playwright cases + Chrome-MCP exploratory section
- `completeness.md` — gaps + human demo script
