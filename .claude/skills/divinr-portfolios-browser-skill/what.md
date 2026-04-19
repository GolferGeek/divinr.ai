# What — Portfolios facet

## User flow

1. User lands on `/portfolios`. The page renders a single dashboard view (no list/detail split).
2. `onMounted` fires four parallel fetches: `fetchMyPortfolio`, `fetchAllPortfolios`, `fetchMyPositions('open')`, `fetchMyQueue`, plus a `/trades/decisions` GET.
3. The default tab is `mine` (My Portfolio). `applyTab('mine')` sets the active kind filter to `user` and auto-expands the current user's row.
4. User can switch to `analysts` (kinds = `analyst | arbitrator | day_trader`, no auto-expand) or `triples` (renders the `AddTripleFlow` component and a list of enabled instrument-analyst triples).
5. Within `mine` / `analysts` tabs, rows are grouped by kind (My Portfolio / Analysts / Day Traders). The user can search by name, toggle kind chips, and pick a sort key + direction.
6. Clicking a portfolio row toggles its expanded detail panel — secondary metrics, equity curve, calibration chart (analysts only), positions list, and (for the user row) account cards + queued trades + decisions history.

## Surface shape

```
Portfolios
[My Portfolio] [Analyst Portfolios] [My Triples]

[search]   Kinds: [user] [analyst] [arbitrator] [day_trader]   Sort: [Default v] [High to Low]

MY PORTFOLIO              Balance     Return    Win Rate   Open
+--------------------------------------------------------------+
| <user name>             $99,820.00  +0.12%    52%        3   |
|   (expanded)                                                 |
|   Realized $-180  Unrealized $+5  Bailouts $0 ...            |
|   [equity curve chart]                                       |
|   Positions: AAPL long open ... | Sell                       |
|   Account cards | Queued Trades | Your Decisions             |
+--------------------------------------------------------------+

ANALYSTS                  Balance     Return    Win Rate   Open
+--------------------------------------------------------------+
| Arbitrator              ...                                  |
| Analyst A               ...                                  |
+--------------------------------------------------------------+
```

## Data invariants

- Heading text is exactly `Portfolios`.
- The three segment buttons (`mine`, `analysts`, `triples`) are always present.
- When `myPortfolio` is loaded, the user's own row appears in the `mine` group and is auto-expanded.
- When all stores are loaded but no portfolios match the filter, the bottom `<ion-note>No portfolios yet.</ion-note>` renders.
- `triples` tab renders `AddTripleFlow` regardless of count and either an empty-state note or a grouped list of triples.
- Forbidden vocabulary (`prediction*`, `recommendation`, `advice`) must not appear in user-visible copy outside `<LegalDisclaimer>` / `[surface-key]` regions.
