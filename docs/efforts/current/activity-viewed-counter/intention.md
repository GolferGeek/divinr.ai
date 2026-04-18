# Activity Viewed Counter

## Why
PR #58 deferred the "New activity (N)" badge on the ACTIVITIES tab because `prediction.club_members` has no `last_viewed_at` column. Without it, members can't tell at a glance which clubs have new predictions / journals / polls since their last visit — so they stop opening clubs that are actually active.

## What
Persist a per-member, per-club (and optionally per-tab) "last viewed" timestamp; compute an unread count of ACTIVITIES items created after that timestamp; render a small `(N)` badge next to the tab label on the club detail view and on MY CLUBS cards.

## Scope
- Migration: add `prediction.club_members.last_viewed_at` (nullable, tz-aware)
- Write path: endpoint called when the ACTIVITIES tab mounts; updates `last_viewed_at = now()` for the (club, user) row
- Read path: ACTIVITIES query returns `unread_count` = items created after `last_viewed_at`
- Badge rendering: zero → hidden, 1–99 → "(N)", 100+ → "(99+)"

## Non-goals
- Per-item read/unread (only tab-level)
- Unread across message threads (already handled by messaging)
- Back-filling `last_viewed_at` from notification history

## Success
- Users who open a club with new activity see an accurate `(N)` badge
- Badge clears within one tab-view of the ACTIVITIES tab
- No N+1: unread counts computed in a single query per `listMyClubs`
