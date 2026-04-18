# Leaderboard Rank Delta

## Why
PR #58 deferred the rank-movement arrow (↑3 / ↓1 / —) because the leaderboard payload only carries current rank, not prior-period rank. Without delta, the leaderboard reads as a static snapshot instead of a dynamic competition — nobody can see momentum, which is the entire point of a multi-day tournament.

## What
Compute and emit `rank_delta` (and `prev_rank`) on the leaderboard payload. Render an arrow + magnitude next to each row's Rank cell on both club-rankings and tournament-leaderboard tables.

## Scope
- Matview / leaderboard query: persist prior-period snapshot (previous day's end-of-day ranks is a reasonable default for sprint-length tournaments)
- API: `rank_delta: number | null` and `prev_rank: number | null` on the leaderboard row contract
- Web: render `↑N` (green), `↓N` (red), `—` (muted) next to Rank; null on day-one shows nothing
- Sticky column behavior preserved on mobile (arrow fits in the Rank cell, no layout break)

## Non-goals
- Hourly rank tracking / sparkline history
- Rank-change push notifications (the `tournament_rank_change` notification type is separate)
- Rank deltas on entity-level performance-attribution tables

## Success
- Every row on a multi-day leaderboard shows a delta (or — on the first period)
- Deltas are accurate against a simple hand-check across two consecutive days
- Mobile rendering is unaffected (no reflow of the sticky Rank/Player columns)
