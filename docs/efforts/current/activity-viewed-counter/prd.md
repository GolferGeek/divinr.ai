# Activity Viewed Counter — Product Requirements Document

## 1. Overview

The ACTIVITIES tab on a club detail view aggregates three entity types — `prediction.club_prediction_challenges`, `prediction.club_consensus_polls`, `prediction.club_strategy_journals` — but offers no signal for which clubs have new activity since a member last looked. PR #58 deferred the `(N)` unread badge because `prediction.club_members` has no `last_viewed_at` column.

This effort adds that column, an endpoint that bumps it when a member opens the ACTIVITIES tab, a single-SQL `unread_count` derived field on `listMyClubs` and `getClub` (no N+1 over the three activity tables), and a `(N)` badge rendered both on the ACTIVITIES `IonSegmentButton` inside `ClubDetailView.vue` and on each card in the MY CLUBS list inside `ClubsView.vue`.

This is a small, additive polish effort: the existing club, member, and activity tables are unchanged in shape; only one new nullable column, one new endpoint, two extended payloads, and two render sites.

## 2. Goals & Success Criteria

- **G1** A persistent per-`(club_id, user_id)` `last_viewed_at TIMESTAMPTZ` exists on `prediction.club_members`, nullable (no backfill — `NULL` means "never viewed").
- **G2** A new write endpoint accepts a "the user just opened the ACTIVITIES tab on this club" signal and updates `last_viewed_at = now()` for the matching `(club_id, user_id)` row. Idempotent. Auth-required (must be a member of the club).
- **G3** `GET /clubs` (`listMyClubs`) returns a derived `unread_count: number` per club. Computed in a single SQL statement — no per-club fan-out, no N+1 over the three activity tables.
- **G4** `GET /clubs/:id` (`getClub`) returns the same `unread_count` for the single requested club, using the same derivation logic.
- **G5** When `last_viewed_at IS NULL` (member never opened ACTIVITIES), `unread_count` is the count of all activity rows for that club created after `prediction.club_members.joined_at` (the member's join time). This avoids "you have 5,000 unread items the moment you join" while still surfacing post-join activity.
- **G6** A `(N)` badge renders next to the "Activities" label on the `IonSegmentButton value="activities"` inside `ClubDetailView.vue`, with formatting: `0` → hidden, `1–99` → `(N)`, `100+` → `(99+)`.
- **G7** The same-formatted badge renders inline on each MY CLUBS card in `ClubsView.vue` (Mine tab, lines 57–74), so members can pick "the club with new stuff" from the list.
- **G8** When the user opens the ACTIVITIES tab in `ClubDetailView.vue`, the web client calls the write endpoint and locally sets `unread_count = 0` for that club so the badge clears within one tab-view, without waiting for a refetch.

**Done when:** all eight goals are verifiable in the running app on at least one club with a mix of post-join challenges, polls, and journals; existing club tests still green; new unit test pins the single-SQL invariant and `unread_count` math.

## 3. User Stories / Use Cases

- **As a club member with several clubs**, I can glance at MY CLUBS and pick the one with new activity, instead of opening each in turn to find what's new.
- **As a club member opening a club**, I see a `(7)` next to ACTIVITIES so I know it's worth clicking; after I click, the badge clears immediately so I don't second-guess whether I missed something.
- **As a brand-new member of an established club**, my first visit shows me the activity that has happened *since I joined* (a meaningful number), not the entire historical log (which would render "(99+)" on day one and never feel actionable).
- **As an admin scanning club health**, the badge gives me a passive signal of which clubs are alive vs. quiet, without opening analytics.

## 4. Technical Requirements

### 4.1 Architecture

- **No new tables, no new services, no new modules.** The change extends one existing table with one column, adds one endpoint method on the existing `ClubController` / `ClubService`, extends two existing service methods (`listMyClubs`, `getClub`) with a derived field, and adds badge rendering to two existing Vue files plus the club store DTO.
- **Migration:** New `apps/api/db/migrations/2026-04-19-activity-viewed-counter.sql` adds `last_viewed_at TIMESTAMPTZ` to `prediction.club_members` with `ADD COLUMN IF NOT EXISTS` for idempotency, matching the established pattern in `2026-04-13-learning-clubs.sql`. `ClubSchemaService.ensureSchema()` will load it (existing migration discovery).
- **API change:** `ClubService.listMyClubs()` (`apps/api/src/clubs/club.service.ts:67–79`) and `ClubService.getClub()` (lines 108–121) get one additional scalar subquery in their existing `SELECT` (alongside `member_count`) that returns the unread total across challenges + polls + journals. New `ClubService.markActivitiesViewed(clubId, userId)` runs an `UPDATE prediction.club_members SET last_viewed_at = now() WHERE club_id = $1 AND user_id = $2 RETURNING last_viewed_at` and throws NestJS `ForbiddenException` if zero rows are returned (so the controller layer maps the not-a-member case to a real 403, not a generic 500).
- **Controller change:** New `POST /clubs/:id/activities/viewed` route on the existing `ClubController`. JWT-authenticated like the rest of the controller. No request body. Returns `{ ok: true, last_viewed_at: string }`.
- **Web change:** Extend `Club` interface in `apps/web/src/stores/club.store.ts` with `unread_count?: number`. Add a `markActivitiesViewed(clubId)` action that calls the endpoint and zeroes the local `unread_count` on the matching `myClubs[].id` and `activeClub` if applicable. `ClubDetailView.vue` calls the action when the segment switches to `activities`. `ClubsView.vue` and the ACTIVITIES `IonSegmentButton` render the formatted badge.
- **NestJS DI:** Per `CLAUDE.md`, every constructor parameter on `ClubService` and `ClubController` must use `@Inject(ClassName)` — the existing services already follow this; new endpoint adds no new constructor params.

### 4.2 Data Model Changes

**One column added.**

```sql
-- 2026-04-19-activity-viewed-counter.sql
ALTER TABLE prediction.club_members
  ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;
```

- Nullable; no default. `NULL` means "member has never viewed the ACTIVITIES tab," which the `unread_count` derivation handles via `COALESCE(cm.last_viewed_at, cm.joined_at)`.
- No backfill (intention non-goal).
- The existing `idx_club_members_club_user (club_id, user_id)` index (line 109 of the learning-clubs migration) covers the lookup pattern for both the read and write paths. **No new index required.**

The three activity tables are unchanged. They already have `created_at TIMESTAMPTZ DEFAULT now()` (challenges line 60, polls line 83, journals line 105 of the learning-clubs migration), which the unread filter compares against.

### 4.3 API Changes

**New endpoint:**

- **Method/Path:** `POST /clubs/:id/activities/viewed`
- **Auth:** JWT required (existing controller-level auth). Caller must be a member of `:id` (enforced by the `UPDATE … WHERE club_id = $1 AND user_id = $2 RETURNING last_viewed_at` returning zero rows → service throws `ForbiddenException` → 403).
- **Body:** none.
- **Response (200):** `{ ok: true, last_viewed_at: "2026-04-19T14:23:11.482Z" }`. The `last_viewed_at` field is informational/debug-only — the web client zeroes its local `unread_count` optimistically and does not read this value.
- **Response (403):** if caller is not a member of the club.

**Extended payloads (additive, non-breaking):**

`Club` returned by `GET /clubs` (`listMyClubs`) and `GET /clubs/:id` (`getClub`) gains:

```ts
unread_count: number;  // 0..N, never negative, never null
```

Always present on these two endpoints. Not present on `discoverClubs` (`GET /clubs/discover`) or `getClubPreview` — those are non-member surfaces and the field is meaningless.

**SQL sketch** (extension of the existing `listMyClubs` SELECT — same shape applied to `getClub`):

```sql
SELECT c.*,
       cm.role AS my_role,
       (SELECT COUNT(*)::int FROM prediction.club_members m
          WHERE m.club_id = c.id) AS member_count,
       (
         SELECT
           (SELECT COUNT(*)::int FROM prediction.club_prediction_challenges ch
              WHERE ch.club_id = c.id
                AND ch.created_at > COALESCE(cm.last_viewed_at, cm.joined_at))
         + (SELECT COUNT(*)::int FROM prediction.club_consensus_polls p
              WHERE p.club_id = c.id
                AND p.created_at > COALESCE(cm.last_viewed_at, cm.joined_at))
         + (SELECT COUNT(*)::int FROM prediction.club_strategy_journals j
              WHERE j.club_id = c.id
                AND j.created_at > COALESCE(cm.last_viewed_at, cm.joined_at))
       ) AS unread_count
FROM prediction.clubs c
JOIN prediction.club_members cm ON cm.club_id = c.id AND cm.user_id = $1
ORDER BY c.created_at DESC;
```

Three scalar subqueries summed inline, all keyed by indexed columns (`club_id` + `created_at` filter; the per-table `idx_club_*_club` indexes from the learning-clubs migration cover the lookup). Single SQL statement. No N+1.

### 4.4 Frontend Changes

- **Store:** `apps/web/src/stores/club.store.ts` — extend `Club` interface (lines 32–36) with `unread_count?: number`. Add a `markActivitiesViewed(clubId: string)` action that:
  1. Calls `POST /clubs/:id/activities/viewed`.
  2. On success, sets `myClubs.value.find(c => c.id === clubId).unread_count = 0` and, if `activeClub.value?.id === clubId`, sets that to 0 as well.
  3. Swallows errors (silent like the other store actions — failure to clear the badge is non-fatal).

- **`ClubDetailView.vue`:**
  - On the `IonSegmentButton value="activities"` (line 165), render the badge after the `IonLabel`. Component: small inline `<span class="unread-badge">({{ formatBadge(club.unread_count) }})</span>` with a `v-if="club.unread_count && club.unread_count > 0"` guard.
  - Add a watcher on the segment value with `immediate: true` so it fires both on segment switches AND on initial mount when ACTIVITIES happens to be the already-active segment (e.g., from a deep-link or restored navigation). When the value is `'activities'` AND `activeClub.unread_count > 0`, call `clubStore.markActivitiesViewed(activeClub.id)`. The local zeroing in the action clears the badge immediately.

- **`ClubsView.vue`:**
  - On each MY CLUBS card (lines 57–74), append the badge directly after the `member_count` chip in the existing card meta line. Same `formatBadge` helper, same `v-if` guard. Visible only on the Mine tab (Discover doesn't have `unread_count`).

- **Badge format helper** (small, inline in both views, or one shared helper file):
  ```ts
  function formatBadge(n: number | undefined): string {
    if (!n || n <= 0) return '';
    if (n > 99) return '99+';
    return String(n);
  }
  ```

- **No new dependency, no new component file** unless the badge styling needs to be reused outside these two sites. Default to inline `<span>` with scoped CSS in each view to keep diff small.

### 4.5 Infrastructure Requirements

None. No new env vars, no new ports, no new services, no caching layer. The added subqueries hit indexed columns and run inside the existing `listMyClubs` / `getClub` round-trip.

## 5. Non-Functional Requirements

- **Performance:** The three new scalar subqueries together should add <30ms to `listMyClubs` at current scale (single-digit clubs per user, low-hundreds of activity rows per club). Each subquery uses the existing per-activity `idx_club_*_club (club_id)` indexes plus a `created_at` range scan; reassess only if p95 latency regresses materially.
- **Round-trip budget:** Exactly one SQL statement per `listMyClubs` and per `getClub` call, unchanged from today's count. Verified by a unit test (`apps/api/tests/unit/clubs-list-unread-count.test.ts`) mirroring the style of `tournaments-list-entrants-preview.test.ts` and `tournaments-list-player-count.test.ts`.
- **Security:** No new PII surface — `unread_count` is a scalar count, derived from rows the member already has read access to. The write endpoint is auth-gated and additionally member-gated by the SQL `WHERE` clause. The activities tables themselves are unchanged.
- **Compatibility:** `unread_count` is additive on the response; older web builds that don't read the field continue to work. The Vue `v-if` guard handles `undefined` safely.
- **Accessibility:** The badge gets `aria-label="{{ n }} unread activities"` so screen readers announce it; the visual `(N)` is decorative.

## 6. Out of Scope

- **Per-item read/unread state.** Only tab-level (per-club). No `last_viewed_at` per challenge / poll / journal.
- **Unread across message threads.** The messaging unread system (`messaging.channel_members.last_read_at` + `messaging.store.ts`) is separate and unchanged.
- **Backfill of `last_viewed_at` from notification history or other proxies.** New column starts `NULL` for everyone; the `COALESCE(..., joined_at)` rule covers first-time semantics.
- **Badges on Discover-tab cards** (`ClubsView.vue` lines 79–84). Non-members have no `last_viewed_at` and no `unread_count`.
- **Real-time badge updates** (e.g., SSE pushing `unread_count` deltas as new activities post). Refresh happens on next `listMyClubs` / `getClub` call.
- **Per-tab unread granularity** within ACTIVITIES (separate counts for challenges vs. polls vs. journals). Single aggregate count.

## 7. Dependencies & Risks

- **Risk: DTO drift.** `Club` is hand-kept in sync between `apps/api/src/clubs/club.types.ts` and `apps/web/src/stores/club.store.ts`. **Mitigation:** update both in the same phase; same approach used for `tournament-avatar-stack`. Add a brief mirror comment in each file pointing at the other (also matching the established `tournament.types.ts` ↔ `tournament.store.ts` pattern).

- **Risk: Existing `listMyClubs` / `getClub` regression.** The query is already covered indirectly by club tests; changing its SELECT shape silently could change downstream consumers. **Mitigation:** add a parallel unit test asserting (a) one SQL call per `listMyClubs` invocation, (b) `unread_count` math sums challenges + polls + journals strictly, (c) `COALESCE(last_viewed_at, joined_at)` semantics, (d) `unread_count` is always present and never negative.

- **Risk: New-member badge spike.** Without the `COALESCE(..., joined_at)` fallback, a brand-new member of an old club would see "(99+)" immediately on every visit, draining the signal value. **Mitigation:** the `COALESCE` is explicit in the SQL spec above; the unit test pins the semantics.

- **Risk: Write endpoint racing the read endpoint.** A user could click ACTIVITIES → web fires `markActivitiesViewed` → before the response, a refetch of `listMyClubs` returns the old `unread_count`. **Mitigation:** the store's `markActivitiesViewed` action zeroes the local count immediately (optimistic), independent of the server round-trip. Even if a stale refetch overwrites it briefly, the next `listMyClubs` after the write will see `last_viewed_at = now()` and return 0.

- **Risk: Member-not-found on the write endpoint** if the user navigates to a club they were just removed from. **Mitigation:** the `UPDATE … WHERE club_id = $1 AND user_id = $2` returning zero rows triggers a 403; the web client swallows write failures silently per the store convention.

- **Dependency: NestJS DI convention** (`@Inject(ClassName)` per `CLAUDE.md`) — `ClubService` and `ClubController` already conform. New service method does not add constructor parameters.

## 8. Phasing

Each phase is independently buildable, testable, and mergeable.

### Phase 1 — API: migration, write endpoint, derived `unread_count`

- Add `apps/api/db/migrations/2026-04-19-activity-viewed-counter.sql` with `ALTER TABLE … ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;` (idempotent).
- Add `markActivitiesViewed(clubId, userId)` to `ClubService` and a corresponding `POST /clubs/:id/activities/viewed` route on `ClubController`.
- Extend `listMyClubs()` and `getClub()` SQL with the three-subquery `unread_count` derivation per §4.3, applying `COALESCE(cm.last_viewed_at, cm.joined_at)`.
- Update the `Club` TypeScript interface in `apps/api/src/clubs/club.types.ts` with `unread_count?: number` (optional, matching the `member_count?` / `my_role?` convention used by sibling derived fields). Add a one-line mirror comment pointing at the web store.
- Add `apps/api/tests/unit/clubs-list-unread-count.test.ts` asserting: (a) one SQL call per `listMyClubs`, (b) `unread_count` is the sum of the three per-table counts, (c) `COALESCE(last_viewed_at, joined_at)` is in the SQL, (d) the new column is in the SELECT list, (e) write endpoint UPDATE constrains by both `club_id` and `user_id`.

**Exit criteria:** New SQL migration runs cleanly via `ensureSchema()`. `curl /clubs` returns the `unread_count` field on every membership row. `curl -X POST /clubs/:id/activities/viewed` returns `{ ok: true, last_viewed_at: ... }` for a member, 403 for a non-member. Existing API unit suite still green; new test passes.

### Phase 2 — Web: store + badge rendering

- Update `Club` interface in `apps/web/src/stores/club.store.ts` to include `unread_count?: number`. Add reciprocal mirror comment.
- Add `markActivitiesViewed(clubId)` action with optimistic local zeroing per §4.4.
- Render the formatted `(N)` badge:
  - On the ACTIVITIES `IonSegmentButton` in `ClubDetailView.vue` (line 165), beside the `IonLabel`.
  - On each MY CLUBS card in `ClubsView.vue` (lines 57–74), in the existing card meta line.
- Wire the segment-change watcher in `ClubDetailView.vue` to fire `markActivitiesViewed` when the user opens ACTIVITIES with `unread_count > 0`.
- Confirm types compile clean and lint passes.

**Exit criteria:** Loading the clubs page shows `(N)` next to clubs that have post-join activity. Opening one such club shows `(N)` on the ACTIVITIES segment. Clicking ACTIVITIES clears the badge immediately and a refresh later still shows zero.

### Phase 3 — Live verification & responsive sanity

- Confirm in a fresh-context Chrome session: badge visible at 375 / 768 / 1280 widths on both surfaces, no layout shift, network panel shows exactly one `POST /clubs/:id/activities/viewed` per ACTIVITIES tab open.
- Confirm a brand-new test member of an established seeded club sees a meaningful (non-`99+`) initial count.
- Confirm the API unit test added in Phase 1 still passes after Phase 2's web touches; web build clean; web lint clean; web typecheck no new errors (web typecheck baseline on `main` has pre-existing errors that are unchanged scope per the prior effort's deviation notes).

**Exit criteria:** Live behavior matches PRD §2 G1–G8. No regressions in existing club / activity flows.
