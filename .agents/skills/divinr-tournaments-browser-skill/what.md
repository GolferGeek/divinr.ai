# What — Tournaments facet

## User flow

1. User lands on `/tournaments`.
2. `tournament.store.fetchTournaments()` loads the list; the page renders a card per tournament with countdown, status chip, player count, prize line.
3. User may filter by scope (`system` / `invitation`) and status (`upcoming` / `active` / `completed`).
4. Clicking a tournament card routes to `/tournaments/:id`.
5. Detail view loads the active tournament. Default tab is `leaderboard`. Segmented control exposes `Leaderboard` / `My Positions` / `Trade` / `Info`.
6. On the `Trade` tab: user enters symbol + direction + quantity, submits; a paper-trade order is created.
7. Leaderboard row → if tournament is club-scoped, opens `MemberProfileDrawer` for that member.
8. After close, `/tournaments/:id/results` is the finalized view (not the detail page's leaderboard).

## Surface shape (list)

```
Tournaments                       [Create Tournament]
(Virtual portfolios only disclaimer)
[Scope v]  [Status v]
+-------- Tournament A -----------+
| [active] [Weekly] [system]      |
| [Avatar stack]  42 players      |
| Prize: bragging rights + badge  |
| $1,000 virtual · Apr 19 — Apr 26 |
| [Enter Game]                     |
+----------------------------------+
```

## Surface shape (detail)

```
<Tournament Name>                     [Back]
[Leaderboard] [My Positions] [Trade] [Info]
...tab content...
```

## Data invariants

- Every visible card row has a non-null `tournament.name`, `starts_at`, `ends_at`, `player_count`, `starting_balance`.
- The `Enter Game` button is visible only for `upcoming` / `active` when the user has write access.
- Countdown line is shown only for `upcoming`.
- The four segment buttons are always present on detail, even if `positions` is empty (empty-state in-tab rather than removing the tab).
