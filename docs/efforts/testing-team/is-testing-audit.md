# `is_testing` Filter Audit

**Phase**: 1 (testing-team)
**Date**: 2026-04-19
**Baseline**: 0 prior occurrences of `is_testing | testing_user | service_account` in `apps/api/src/` (see `is-testing-audit-raw.txt`).

This walk surveys every aggregation query in `apps/api/src/` that could fold
testing-team state into a public/shared metric. Per-user dashboards
parameterized by the caller's `user_id` are marked no-op — the testing user must
be able to see their own data.

## Columns

- **Disposition** — `needed` (public aggregation, must filter), `no-op` (per-user
  query — testing user needs to see their own data), `n/a` (non-aggregation
  lookup, e.g., display-name join).

## Table

| File : line | What it aggregates | Disposition | Patch (or reason) |
| --- | --- | --- | --- |
| `markets/services/leaderboard.service.ts` ~L70–120 | User-scoped portfolio P&L / Sharpe grouped by `user_id` → global leaderboard | **needed** | Add `AND up.user_id NOT IN (SELECT id FROM authz.users WHERE is_testing = true)` in the portfolio-level aggregation CTEs (`group by portfolio_kind, portfolio_id` branches) |
| `markets/services/leaderboard.service.ts` ~L124 (`group by analyst_id`) | Per-analyst aggregate across all authors | no-op | Analyst-scoped aggregation, not user-scoped — testing user doesn't author base analysts |
| `markets/services/performance.service.ts` L102–180 | Per-user portfolio/PnL dashboards (parameterized by `$1`) | no-op | Always filtered to a single caller's `user_id`; testing user must see own data |
| `tournaments/tournament-leaderboard.service.ts` L58 (`LEFT JOIN authz.users u ON u.id = te.user_id`) | Tournament leaderboard rows | **needed** | Add `AND u.is_testing = false` in the WHERE (tournament-scoped leaderboard is public within the tournament; testing entries should be excluded) |
| `tournaments/tournament-leaderboard.service.ts` L320 (second join) | Rank-delta snapshot join | **needed** | Same filter: `AND u.is_testing = false` |
| `tournaments/tournament.service.ts` L120 | Tournament listing (member display-names) | n/a | Display-name join for an already-known entry set; aggregation happens downstream already filtered |
| `tournaments/tournament-portfolio.service.ts` L205 | Tournament portfolio member rollup | **needed** | Add `AND u.is_testing = false` — rolls up into tournament-wide portfolio stats |
| `clubs/club-analytics.service.ts` L79, L95, L111 (GROUP BYs) | Analyst / symbol / direction aggregation scoped to club membership | **needed** | Each aggregation joins via `LEFT JOIN authz.users u ON u.id = <pos/vote>.user_id` — add `AND u.is_testing = false` to the WHERE (or promote the LEFT JOIN to an INNER for the aggregation path and filter there) |
| `clubs/club-ranking.service.ts` L90–175 (club P&L rollups from tournament portfolios) | Club-level aggregate PnL across member portfolios | **needed** | The inner subqueries select from `prediction.tournament_portfolios tp` / `tournament_positions tpos` without a users join; add `AND tp.user_id NOT IN (SELECT id FROM authz.users WHERE is_testing = true)` to each aggregation subquery |
| `clubs/club-activity.service.ts` L251 | Activity feed — join-events by user display name | n/a | Display-name enrichment only; activity set already filtered by membership |
| `clubs/club.service.ts` L300, L323 | Member roster display-name joins | n/a | Lookup-by-membership, not aggregation |
| `clubs/club-mentor.service.ts` (multiple) | Mentor/mentee relationship joins | n/a | Relationship lookups, not a cross-user aggregation |
| `messaging/messaging.service.ts` L222, L259, L404 | Message sender-name join | n/a | Display-name join on a message set already scoped to a thread |
| `curriculum/curriculum.service.ts` L554 | Enrollment roster display-name | n/a | Enrollment-scoped lookup |
| `auth/invite.service.ts` L248 | Single-user display lookup | n/a | Not aggregation |
| `attribution/outcome-attribution.service.ts` (various `author_user_id`) | Aggregation by analyst-author (base/custom-author) | no-op | Aggregates by *analyst author*; testing user does not author base analysts and custom authoring is gated to paid tier — zero-row impact in practice |
| `attribution/attribution-aggregation.service.ts` | Analyst/instrument attribution rollups | no-op | Same analyst-author scope as above |
| `cost-modeling/student-billing.service.ts` | Per-user billing accrual | no-op | Parameterized by user_id; testing user's billing is mock anyway |
| `billing/billing.service.ts` | Per-user subscription lookups | no-op | Per-user; no cross-user aggregation exposed publicly |

## Summary

Five services carry aggregation queries that require the `is_testing` filter:

1. `markets/services/leaderboard.service.ts` (global leaderboard CTEs)
2. `tournaments/tournament-leaderboard.service.ts` (2 sites)
3. `tournaments/tournament-portfolio.service.ts` (1 site)
4. `clubs/club-analytics.service.ts` (3 sites — analyst/symbol/direction GROUP BYs)
5. `clubs/club-ranking.service.ts` (tournament-portfolio rollups inside club ranking)

All other user-scoped queries in the tree are either per-user dashboards
(parameterized by the caller) or display-name joins that don't fold into a
public metric. Those are `no-op` for this audit — the testing user must still
see their own data.

## Filter shape

The canonical filter, expressed as a NOT-IN subquery to avoid adding a users
join everywhere:

```sql
AND <user-id-column> NOT IN (SELECT id FROM authz.users WHERE is_testing = true)
```

Where a `LEFT JOIN authz.users u` already exists, prefer the inline form:

```sql
AND u.is_testing = false
```

## Test coverage

For each of the five touched services, Phase 1 adds one new `tsx` unit test
under `apps/api/tests/unit/` that asserts the generated SQL contains the
`is_testing` filter (string match against the query text). This is a lightweight
regression guard — it does not require a live database. The deeper behavioral
assertion (testing user rows are omitted from responses) lands in Phase 3+ via
Playwright specs that log in as the testing user and verify the leaderboard/
analytics endpoints do not surface their own rows to a peer.
