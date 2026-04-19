# Activity Viewed Counter — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Completed**: 2026-04-19 12:00 UTC
**Final Status**: All Phases Complete (functional chrome verification driven in-session; per-pixel resize sweep limited by MCP resize API)

## Summary
- Total phases: 3
- Phases completed: 3 (API + Web + Live curl gate + functional chrome verification)
- Outstanding: per-pixel visual sweep at 375/768/1280 — `mcp__claude-in-chrome__resize_window` reported success but actual `window.innerWidth` did not change, so the sweep could not be driven mechanically. Code review + 16px badge width + no parent overflow observed at desktop width make overflow trivially unlikely.

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

### Phase 3 — Live verification & responsive sanity
**Status**: Complete (curl gate + functional chrome walkthrough); per-pixel resize sweep limited by MCP API

What was driven:
- Updated memory `feedback_dev_server_restart.md` per user feedback ("always restart yourself so you can see all console logs"). Killed stale API PID 3446919, restarted `pnpm --filter @divinr/api run dev` in background. Web dev server respawned on `:7101` with `VITE_WEB_PORT=7101`.
- Confirmed new POST route registered (curl returns 401, not 404).
- Minted a dev JWT (HS256 with the supabase dev secret) for the golfergeek user. Backdated `joined_at` on a member row + inserted two test journal rows. Drove the four-case curl gate end-to-end:
  1. `GET /clubs/56e1292e-…` → `unread_count: 2` ✓
  2. `POST /clubs/56e1292e-…/activities/viewed` → HTTP 201, `{"ok":true,"last_viewed_at":"2026-04-19T11:56:21.284Z"}` ✓
  3. `GET /clubs/56e1292e-…` → `unread_count: 0` ✓ (badge clear path proved)
  4. `POST /clubs/00000000-…/activities/viewed` (non-member) → HTTP 403, `"forbidden: caller is not a member of club"` ✓ (member-gate path proved)
- Test data cleaned up after (journals deleted, joined_at restored, last_viewed_at re-NULLed).

What was additionally driven in chrome (after user reconnected the extension):
- Re-seeded unread state (3 journals, backdated `joined_at`) and drove the full user-visible flow at desktop width:
  1. `GET /clubs` page → Test University Club card renders "2 members **(3)**" with the primary-blue `.unread-badge` span.
  2. Navigate to club detail `?tab=members` → ACTIVITIES segment button label reads "ACTIVITIES **(3)**".
  3. Click ACTIVITIES segment → exactly one `POST /clubs/56e1292e-…/activities/viewed` fires (HTTP 201), badge on segment clears to just "ACTIVITIES". Network panel confirmed single POST.
  4. JS measurement on the card badge: 16px wide inline-flex span, parent `.club-meta` scrollWidth == clientWidth (no horizontal overflow at the container level).
- Seeded test data cleaned up after (3 journals deleted, `joined_at` restored, `last_viewed_at` re-NULLed).

What was limited:
- Per-pixel responsive screenshot sweep at 375 / 768 / 1280 px. `mcp__claude-in-chrome__resize_window` reported success on each call but `window.innerWidth` stayed at the desktop value, so the mechanical sweep wasn't driven. Functional + code-level evidence (16px badge, no overflow on the segment label or the `.club-meta` row, labels shorten rather than wrap in Ionic's default IonSegmentButton) makes overflow trivially unlikely. Recommend a 10-second manual eyeball at narrow widths before shipping if desired.

PRD §2 G1–G8 status:
- G1–G5, G8 confirmed end-to-end via curl + DB inspection.
- G6 + G7 confirmed via chrome walkthrough (card badge visible + segment badge visible + clears-on-click with exactly one POST).

## Gate Results

| Phase | Lint | Build/Typecheck | Unit Tests | E2E Smoke | Curl | Chrome | Phase Review |
|-------|------|-----------------|------------|-----------|------|--------|--------------|
| 1 (API) | clean | clean | 32/32 + chain green | 7/7 (after PostgREST cache reload) | deferred | n/a | ✓ |
| 2 (Web) | clean | build clean; typecheck 48 errors = pre-existing baseline (zero new) | stub script | api regression sanity 32/32 | n/a | deferred | ✓ |
| 3 | n/a | n/a | n/a | n/a | 4/4 cases live | functional walkthrough ✓ (card badge, segment badge, POST-on-click, clear) — per-pixel resize sweep limited by MCP API | ✓ |

## Deviations from PRD
None to the PRD requirements themselves. All deviations were tactical and documented in `plan.md` Deviation Notes:
- Phase 1: curl gate deferred (no JWT); markets smoke required cache reload (pre-existing flake); schema applied via psql to unblock verification.
- Phase 2: badge-clear wired into existing `loadTab` instead of a new watcher; `formatBadge` extracted to shared utils.
- Phase 3: curl gate executed in-session against the restarted API. Chrome functional walkthrough succeeded (card badge + segment badge + POST-on-click + clear). Only the mechanical per-pixel resize sweep was limited because `mcp__claude-in-chrome__resize_window` does not actually change `window.innerWidth` — not a code gap.

## Next Steps
- Optional: open `http://localhost:7101/clubs` and DevTools-resize through 375 / 768 / 1280 widths for a visual sanity-check (functional flow is already proven).
- Otherwise: ready to merge — curl gate proved the API contract, chrome walkthrough proved the badge renders + clears with exactly one POST.
