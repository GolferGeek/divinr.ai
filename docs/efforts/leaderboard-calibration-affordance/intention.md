# Effort: Leaderboard → Calibration Affordance

## Problem

The leaderboard at `/portfolios` shows a calibration score column for every analyst, but there's no way to click through to the calibration drilldown at `/analysts/:id/performance`. Users see the number but can't explore *why* an analyst scores that way without manually constructing a URL. The two views exist in isolation.

## Intention

Add a clear navigation affordance from the leaderboard to the calibration drilldown so that any user who sees a calibration score can immediately drill into the detail behind it.

## Scope

- Make the calibration score cell in the leaderboard table a clickable link (or add a button in the expanded row detail) that navigates to `/analysts/:id/performance` for analyst-kind portfolios.
- Non-analyst rows (user, arbitrator) should not show a clickable affordance — they have no calibration data.
- No changes to the calibration drilldown page itself; it already works as a standalone view.
- No new API endpoints — routing is client-side only.

## Success Criteria

- A beta user on the leaderboard can reach any analyst's calibration drilldown in one click.
- The affordance is visually discoverable without cluttering the table.
- Deep links to the calibration view continue to work.

## Out of Scope

- Redesigning the leaderboard table or calibration drilldown.
- Adding calibration data for non-analyst portfolio types.
- Back-navigation from calibration to leaderboard (browser back is sufficient).
