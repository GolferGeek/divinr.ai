# Tournament Avatar Stack

## Why
PR #58 deferred avatar stacks on tournament list cards — only `{N} players` text ships today — because the naive approach is an N+1 per tournament. Text alone is fine but flat; a 3-avatar stack makes tournaments feel populated, social, and "these are real people" at a glance.

## What
Add a small avatar stack (first 3 entrants, overflow chip) to the roster line on each tournament list card. Fetch all avatars in a single bulk query, not per card.

## Scope
- API: extend the `listTournaments` payload so each tournament carries `entrants_preview: [{user_id, display_name, avatar_url?}]` capped at 3 + `entrants_overflow: number`
- SQL: lateral join pulling first 3 tournament entrants per tournament in a single statement
- Web: small overlapping avatar stack (initial-based fallback for users without avatars) next to `{N} players`
- Mobile: stack scales down cleanly, overflow chip fits in card

## Non-goals
- Full entrant roster expansion on the card (that's the DETAIL view)
- Avatar uploads (users without avatars fall back to initials)
- Avatar stacks on the leaderboard rows (those already show names directly)

## Success
- Every tournament card shows up to 3 avatars + overflow for the rest
- `listTournaments` remains a single round-trip regardless of how many tournaments are on the page
- Visual parity with the rest of the app's IonAvatar styling
