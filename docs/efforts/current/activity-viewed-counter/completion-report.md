# Activity Viewed Counter — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Completed**: 2026-04-18 23:35 UTC (code phases) — Phase 3 chrome verification deferred
**Final Status**: Phases 1–2 Complete; Phase 3 Deferred to fresh session / `/pr-eval`

## Summary
- Total phases: 3
- Phases completed: 2 (API + Web)
- Phases remaining: 1 (live chrome + curl verification — code is in place; needs API restart + browser session)

## Phase Results

### Phase 1 — API: migration + write endpoint + derived `unread_count`
**Status**: Complete

What shipped:
- New migration file `apps/api/db/migrations/2026-04-19-activity-viewed-counter.sql` (one idempotent `ALTER TABLE prediction.club_members ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;`).
- Same ALTER added inline to `ClubSchemaService.ensureSchema()` so dev DBs evolve at runtime.
- `Club` interface in `apps/api/src/clubs/club.types.ts` extended with `unread_count?: number` + mirror comment to web store.
- `ClubService.listMyClubs()` SQL extended with three-subquery sum (challenges + polls + journals) filtered by `created_at > COALESCE(cm.last_viewed_at, cm.joined_at)` — single round-trip, no N+1.
- `ClubService.getClub()` extended with the same subquery shape.
- New method `ClubService.markActivitiesViewed(clubId, userId)`:
  - `UPDATE prediction.club_members SET last_viewed_at = now() WHERE club_id = $1 AND user_id = $2 RETURNING last_viewed_at`
  - Throws `ForbiddenException('forbidden: caller is not a member of club')` on zero rows. The error message deliberately avoids substrings (`'not found'`, `'Not a member'`, `'Invalid'`, `'Requires'`, `'Cannot'`, `'Owner cannot'`) that `ClubController.handleError` would re-route into `NotFoundException`/`BadRequestException`.
  - Serializes `last_viewed_at` to ISO string regardless of whether `pg` returned `Date` or `string`.
- New route `POST /clubs/:id/activities/viewed` on `ClubController`. Intentionally **not** wrapped in `handleError` — lets `ForbiddenException` bubble to the default Nest filter for a clean 403.
- New unit test `apps/api/tests/unit/clubs-list-unread-count.test.ts` — 32 assertions covering the single-SQL invariant, COALESCE semantics, table references, UPDATE shape, ForbiddenException-on-zero-rows, and Date→ISO serialization. Wired into `test:unit` chain in `apps/api/package.json`.
- Dev DB schema updated directly via `psql` (column verified present in `information_schema.columns`).

Notable decisions / deviations:
- **Curl gate deferred to Phase 3**: no seeded JWT in `.env`. Plan explicitly allows this fallback.
- **Markets smoke required PostgREST schema-cache reload**: same pre-existing flake the prior effort recorded in commit `6423ef8`. Workaround: `NOTIFY pgrst, 'reload schema'` + 12s wait. Passed 7/7 cases on retry. Not introduced by this effort (zero markets code touched).

### Phase 2 — Web: store update + badge rendering + tab-view zeroing
**Status**: Complete

What shipped:
- `Club` interface in `apps/web/src/stores/club.store.ts` extended with `unread_count?: number` + mirror comment back to API types.
- New store action `markActivitiesViewed(clubId)`: POSTs to the new endpoint, then mutates both `myClubs` card and `activeClub.unread_count` to 0 for immediate badge clear. Errors swallowed per established store convention.
- New shared helper `formatBadge(n)` in `apps/web/src/utils/format.ts` (`0/undefined → ''`, `1–99 → "N"`, `>99 → "99+"`).
- `ClubDetailView.vue`: ACTIVITIES `IonSegmentButton` now renders `({{ formatBadge(...) }})` when `activeClub.unread_count > 0`. The badge clear is wired into `loadTab(...)` (the existing tab-change callback that's also fired from `onMounted`), covering both segment-click and direct-link landing in one place.
- `ClubsView.vue`: same badge appended after the `member_count` chip on each MY CLUBS card.
- Scoped `.unread-badge` CSS in both views (small inline span, primary color, font-size inherits from label).

Notable decisions / deviations:
- **Watcher → loadTab callback**: plan called for `watch(segment, …, { immediate: true })`; the view actually uses `@ionChange="loadTab(...)"` and `onMounted` already invokes `loadTab(tab.value)`. Adding the call inside `loadTab` matches the prescribed semantics (immediate fire + on-change fire) without introducing a redundant watcher.
- **`formatBadge` extracted to shared utils**: the plan offered either inline-per-view or extract; both views needed it and the existing utils file already hosts `pluralize`, so extracting was cleaner.

### Phase 3 — Live chrome + responsive sweep + deferred curls
**Status**: Deferred

The dev API on `:7100` (PID 3446919) was started before this effort and predates the new code path. Per the safety guidance against terminating the user's running processes, and per the project memory `feedback_long_sessions.md` ("UI tests should run in a fresh context, not bolted onto long backend sessions"), Phase 3 is deferred. Code is in place; the schema column already exists in dev DB.

Action items for the next session (or `/pr-eval`):
1. User restarts the API: `pnpm --filter @divinr/api run dev`. (`ensureSchema`'s `IF NOT EXISTS` will no-op against the already-migrated dev DB.)
2. Open chrome at `http://localhost:7101/clubs`:
   - Confirm `(N)` badge on at least one MY CLUBS card.
   - Click into the club — confirm same badge on ACTIVITIES segment.
   - Click ACTIVITIES — confirm badge clears immediately and the network panel shows exactly one `POST /clubs/:id/activities/viewed`, response `{ok:true,last_viewed_at:...}`, HTTP 200.
3. Repeat at viewport widths 375 / 768 / 1280 px.
4. (Optional) NULL out `last_viewed_at` on a member row, refresh, confirm COALESCE→`joined_at` produces a meaningful initial count rather than `(99+)`.
5. Pull the auth token from devtools and run the deferred curl gate (Phase 1's curl bullet in `plan.md`).
6. Capture a screenshot for completion archive.

## Gate Results

| Phase | Lint | Build/Typecheck | Unit Tests | E2E Smoke | Curl | Chrome | Phase Review |
|-------|------|-----------------|------------|-----------|------|--------|--------------|
| 1 (API) | clean | clean | 32/32 + chain green | 7/7 (after PostgREST cache reload) | deferred | n/a | ✓ |
| 2 (Web) | clean | build clean; typecheck 48 errors = pre-existing baseline (zero new) | stub script | api regression sanity 32/32 | n/a | deferred | ✓ |
| 3 | — | — | — | — | pending | pending | pending |

## Deviations from PRD
None to the PRD requirements themselves. All deviations were tactical and documented in `plan.md` Deviation Notes:
- Phase 1: curl gate deferred (no JWT); markets smoke required cache reload (pre-existing flake); schema applied via psql to unblock verification.
- Phase 2: badge-clear wired into existing `loadTab` instead of a new watcher; `formatBadge` extracted to shared utils.
- Phase 3: deferred to fresh chrome session per memory + safety guidance.

## Next Steps
- Run `/pr-eval` for the PR — that flow will pull the diff, lint, and (with the user) drive the live chrome verification.
- After Phase 3 evidence is captured, merge and archive per `/pr-eval`.
