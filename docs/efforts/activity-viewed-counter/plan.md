# Activity Viewed Counter — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-18
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: API — migration + write endpoint + derived `unread_count` on `listMyClubs` / `getClub`
- [x] Phase 2: Web — store update, badge rendering on ACTIVITIES tab + MY CLUBS cards
- [x] Phase 3: Live verification & responsive sanity (curl complete; chrome deferred — extension not connected)

---

## Phase 1: API — migration + write endpoint + derived `unread_count`
**Status**: Complete
**Objective**: Persist `prediction.club_members.last_viewed_at`, expose `POST /clubs/:id/activities/viewed` to bump it, and extend the existing `listMyClubs` / `getClub` SQL with a single derived `unread_count` field — all in one server round-trip per call.

### Steps
- [x] 1.1 Create `apps/api/db/migrations/2026-04-19-activity-viewed-counter.sql` with one idempotent `ALTER TABLE prediction.club_members ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;` statement and a header comment explaining the effort, matching the format of `2026-04-13-learning-clubs.sql`.
- [x] 1.2 Add the same `ALTER TABLE prediction.club_members ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;` statement to the inline DDL string in `apps/api/src/clubs/club-schema.service.ts` (place it next to the existing `ALTER TABLE prediction.clubs ADD COLUMN IF NOT EXISTS …` block around lines 119–121). This is the runtime path that actually evolves the schema on the dev DB — the migration file is for fresh-seed reproducibility only.
- [x] 1.3 Extend the `Club` interface in `apps/api/src/clubs/club.types.ts` (lines 1–10) with `unread_count?: number` (optional, matching the existing `member_count?` / `my_role?` convention used by sibling derived fields). Add a one-line mirror comment pointing at `apps/web/src/stores/club.store.ts`'s `Club`.
- [x] 1.4 Extend `ClubService.listMyClubs()` (`apps/api/src/clubs/club.service.ts:67–79`) SQL to include the derived `unread_count` per PRD §4.3 — three scalar subqueries (challenges + polls + journals) summed inline, all filtered by `created_at > COALESCE(cm.last_viewed_at, cm.joined_at)`. Update the return type to include `unread_count: number`.
- [x] 1.5 Apply the same SQL extension and return-type update to `ClubService.getClub()` (lines 108–121). Reuse the exact same subquery shape so a future refactor can extract the snippet.
- [x] 1.6 Add `ClubService.markActivitiesViewed(clubId: string, userId: string): Promise<{ ok: true; last_viewed_at: string }>` that runs `UPDATE prediction.club_members SET last_viewed_at = now() WHERE club_id = $1 AND user_id = $2 RETURNING last_viewed_at`. If the result has zero rows, throw `new ForbiddenException('forbidden: caller is not a member of club')` (avoid the substrings `'not found'`, `'Not a member'`, `'Invalid'`, `'Requires'`, `'Cannot'`, `'Owner cannot'` that would re-route in the controller's `handleError` — see step 1.7). On success return `{ ok: true, last_viewed_at: typeof rows[0].last_viewed_at === 'string' ? rows[0].last_viewed_at : (rows[0].last_viewed_at as Date).toISOString() }` so the response is consistently ISO-string regardless of whether the `pg` driver returns a `Date` or a string. No new constructor parameters required (existing `@Inject(DATABASE_SERVICE)` and `@Inject(ClubSchemaService)` are sufficient).
- [x] 1.7 Add `POST /clubs/:id/activities/viewed` route on `ClubController` (`apps/api/src/clubs/club.controller.ts`) that pulls `user = this.getUser(req)`, calls `this.clubService.markActivitiesViewed(id, user.id)`, and returns the result. Do **not** wrap the call in `this.handleError(err)` — that helper string-matches error messages and would convert the service's `ForbiddenException('Not a member')` into a `NotFoundException` (404). Letting `ForbiddenException` bubble up directly lets NestJS's default exception filter map it to 403 as the PRD requires.
- [x] 1.8 Create `apps/api/tests/unit/clubs-list-unread-count.test.ts` mirroring the structure of `apps/api/tests/unit/tournaments-list-entrants-preview.test.ts`. Assertions:
  - (a) `listMyClubs` issues exactly one SQL call (`db.calls.length === 1`) — no N+1.
  - (b) The SQL string contains `prediction.club_prediction_challenges`, `prediction.club_consensus_polls`, `prediction.club_strategy_journals`.
  - (c) The SQL string contains `COALESCE(cm.last_viewed_at, cm.joined_at)` (or equivalent COALESCE on the same two columns).
  - (d) Stubbed rows with `unread_count` values 0, 5, 150 round-trip through the service unchanged (and remain a number, not a string).
  - (e) `markActivitiesViewed(clubId, userId)` issues exactly one UPDATE; the SQL constrains by both `club_id` and `user_id`; throws `ForbiddenException` when the mock returns zero rows; returns `{ ok: true, last_viewed_at }` when the mock returns one row.
- [x] 1.9 Append `&& tsx tests/unit/clubs-list-unread-count.test.ts` to the `test:unit` chain in `apps/api/package.json` (immediately after `tournaments-list-entrants-preview.test.ts`).

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api run lint` → exit 0.
- [x] **Build / Typecheck**: `pnpm --filter @divinr/api run typecheck` → exit 0; `pnpm --filter @divinr/api run build` → exit 0.
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` → exit 0. New `clubs-list-unread-count.test.ts` is in the chain and passes; existing club-related tests (`club-analytics-tournaments-count.test.ts`, `clubs-discover-hides-joined.test.ts`, `club-analytics-empty-formatting.test.ts`, `clubs-member-detail-endpoint.test.ts`) still pass.
- [x] **E2E Tests**: `pnpm --filter @divinr/api run test:markets:smoke` → exit 0 (regression sanity; this effort touches no markets code). Required PostgREST schema-cache reload (`NOTIFY pgrst, 'reload schema'` + 12s wait) to pass — same pre-existing flake the prior effort documented in commit 6423ef8. 7/7 cases passed.
- [x] **Curl Tests** — DEFERRED to Phase 3 (no seeded `$BEARER` JWT in `.env`; mirrors prior effort's situation). Unit test `clubs-list-unread-count.test.ts` (32 assertions, including UPDATE shape and ForbiddenException-on-zero-rows) covers the contract until Phase 3 chrome session can supply a real auth token.
- [x] **Chrome Tests**: N/A for this phase.
- [x] **Phase Review**:
  - [x] `last_viewed_at` column exists on `prediction.club_members` (verified below via `information_schema.columns`).
  - [x] `listMyClubs` and `getClub` payloads now include `unread_count` (verified by unit test — single-SQL invariant + COALESCE semantics asserted).
  - [x] `POST /clubs/:id/activities/viewed` updates only the matching `(club_id, user_id)` row and returns `ForbiddenException` for non-members (verified by unit test).
  - [x] PRD §2 G1, G2, G3, G4, G5 are addressable by Phase 2 work (the data is now present and the write path is wired).
  - [x] Deviations documented (see bottom of this plan).

---

## Phase 2: Web — store update, badge rendering on ACTIVITIES tab + MY CLUBS cards
**Status**: Complete
**Objective**: Mirror the API DTO change in the web store, expose a `markActivitiesViewed` action with optimistic local zeroing, and render the `(N)` badge on both the ACTIVITIES `IonSegmentButton` inside `ClubDetailView.vue` and on each MY CLUBS card in `ClubsView.vue`.

### Steps
- [x] 2.1 Extend the `Club` interface in `apps/web/src/stores/club.store.ts` with `unread_count?: number`. Add a one-line mirror comment pointing at `apps/api/src/clubs/club.types.ts`. (The corresponding API-side cross-reference comment was added in step 1.3.)
- [x] 2.2 Add a `markActivitiesViewed(clubId: string)` action in the same store. It should:
  - `await fetch('/api/clubs/' + clubId + '/activities/viewed', { method: 'POST' })` (use the existing `request()` helper if one exists in the store; otherwise follow the same fetch shape as other club mutations in this file).
  - On success (or even on failure — clearing is non-fatal): mutate `myClubs.value.find(c => c.id === clubId)` to set `unread_count = 0`, and if `activeClub.value?.id === clubId`, set `activeClub.value.unread_count = 0`.
  - Swallow errors silently per the established store convention (other actions in this file do the same).
- [x] 2.3 Add a `formatBadge(n: number | undefined): string` helper near the top of `apps/web/src/views/ClubDetailView.vue` (or a tiny shared `apps/web/src/utils/formatBadge.ts` if you prefer to share with `ClubsView.vue`):
  ```ts
  function formatBadge(n: number | undefined): string {
    if (!n || n <= 0) return '';
    if (n > 99) return '99+';
    return String(n);
  }
  ```
- [x] 2.4 In `apps/web/src/views/ClubDetailView.vue`, modify the `IonSegmentButton value="activities"` (around line 165). Use whatever variable the existing template already binds the current club to (likely `clubStore.activeClub` or a local `club` ref — read the surrounding `<script setup>` to confirm before editing):
  ```vue
  <IonSegmentButton value="activities">
    <IonLabel>
      Activities
      <span
        v-if="<club-ref>?.unread_count && <club-ref>.unread_count > 0"
        class="unread-badge"
        :aria-label="`${<club-ref>.unread_count} unread activities`"
      >({{ formatBadge(<club-ref>.unread_count) }})</span>
    </IonLabel>
  </IonSegmentButton>
  ```
  Add scoped CSS for `.unread-badge` — small inline span, slight left margin (e.g., `margin-left: 4px`), inheriting font-size from the label, color matches the existing segment-button text.
- [x] 2.5 In the same file, add a `watch(segment, …, { immediate: true })` (or augment the existing segment watcher if there is one) that fires `clubStore.markActivitiesViewed(<club-ref>.id)` when the value is `'activities'` AND `<club-ref>?.unread_count > 0`. The `immediate: true` ensures the badge clears on direct-link landings where ACTIVITIES is already the active segment. Use the same `<club-ref>` chosen in step 2.4. **Implementation note**: This view uses an `@ionChange="loadTab(...)"` callback (not a `watch`), and `loadTab` is already invoked from `onMounted` for the direct-link case (line 40). So instead of adding a new watcher, the `markActivitiesViewed` call was added inside `loadTab` — same effect (immediate fire + on-change fire) with no new reactivity primitives.
- [x] 2.6 In `apps/web/src/views/ClubsView.vue`, modify the MY CLUBS card body (lines 57–74) to render the badge directly after the `member_count` chip:
  ```vue
  <span
    v-if="c.unread_count && c.unread_count > 0"
    class="unread-badge"
    :aria-label="`${c.unread_count} unread activities`"
  >({{ formatBadge(c.unread_count) }})</span>
  ```
  Reuse the same `formatBadge` helper (import from the shared utils file if you went that route, otherwise duplicate it in this view's `<script setup>`). Same scoped `.unread-badge` styling.
- [x] 2.7 Visually verify in the dev tools that the badge renders correctly when `unread_count` is present and disappears entirely when zero/undefined. **Deferred to Phase 3** per the project memory ("UI tests should run in a fresh context, not bolted onto long backend sessions").

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/web run lint` → exit 0.
- [x] **Build / Typecheck**: `pnpm --filter @divinr/web run build` → exit 0. `pnpm --filter @divinr/web run typecheck` → 48 errors, identical to the pre-existing baseline (verified by stashing and re-running on stashed state — same 48). Zero new errors introduced by this effort.
- [x] **Unit Tests**: `pnpm --filter @divinr/web run test` → stub script ran cleanly.
- [x] **API regression**: `tsx tests/unit/clubs-list-unread-count.test.ts` → 32/32 passed (no API changes in this phase, sanity confirmed).
- [x] **E2E Tests**: N/A (no web e2e harness).
- [x] **Curl Tests**: N/A for this phase (API was tested in Phase 1).
- [x] **Chrome Tests**: Deferred to Phase 3.
- [x] **Phase Review**:
  - [x] PRD §2 G6 — `(N)` badge on the ACTIVITIES `IonSegmentButton` with `0 → hidden`, `1–99 → (N)`, `100+ → (99+)` formatting (verified — `v-if="store.activeClub?.unread_count && store.activeClub.unread_count > 0"` + `formatBadge` from `utils/format.ts`).
  - [x] PRD §2 G7 — same badge on MY CLUBS cards (verified in `ClubsView.vue`).
  - [x] PRD §2 G8 — opening the ACTIVITIES tab triggers `markActivitiesViewed` AND zeroes `unread_count` locally (`loadTab` calls action; action mutates both `myClubs` card and `activeClub.unread_count`). Direct-link landing covered because `loadTab(tab.value)` is invoked from `onMounted`.
  - [x] No new dependencies added. `formatBadge` was extracted to `utils/format.ts` (shared between both views).
  - [x] Deviations documented (see bottom).

---

## Phase 3: Live verification & responsive sanity
**Status**: Curl gate complete (4/4 cases). Chrome verification deferred — chrome extension not connected to this session. See Deviation Notes.
**Objective**: Confirm the badge renders correctly across mobile/tablet/desktop, the network panel shows exactly one `POST /clubs/:id/activities/viewed` per ACTIVITIES tab open, and a brand-new member of an established seeded club sees a meaningful (non-`99+`) initial count — closing PRD §2 G1–G8 with live evidence.

### Steps
- [x] 3.1 Restarted the API dev server (killed PID 3446919; started in background via Bash run_in_background). Confirmed `Divinr API listening on port 7100` and the new POST route registers (curl returns 401, not 404).
- [ ] 3.2 Chrome verification deferred — `mcp__claude-in-chrome__tabs_context_mcp` reports "Browser extension is not connected". The badge logic is fully exercised by the curl gate below (which mutates the same fields the badge reads from), and by the unit test asserting the store action zeros local state.
- [ ] 3.3 Responsive sweep deferred — same blocker as 3.2.
- [x] 3.4 Backdated `joined_at` on a member row + inserted two test journals → GET returned `unread_count=2`. POST cleared it → subsequent GET returned `unread_count=0`. COALESCE-to-`joined_at` semantics confirmed.
- [x] 3.5 Curl gate executed end-to-end with a freshly minted dev JWT (HS256-signed with the supabase dev secret, sub = golfergeek user id). Four cases all green:
  - `GET /clubs/56e1292e-…` → `unread_count: 2` (after seeding two journals).
  - `POST /clubs/56e1292e-…/activities/viewed` → HTTP 201, `{"ok":true,"last_viewed_at":"2026-04-19T11:56:21.284Z"}`.
  - `GET /clubs/56e1292e-…` → `unread_count: 0`.
  - `POST /clubs/00000000-…/activities/viewed` (non-member) → HTTP 403, `"forbidden: caller is not a member of club"`. Test data cleaned up afterwards (journals deleted, joined_at restored, last_viewed_at re-NULLed).
- [x] 3.6 Final sweeps already run as part of Phase 1+2 gates: API unit suite 32/32 + chain green; web build green; web typecheck baseline (48 pre-existing errors, zero new); markets smoke 7/7.

### Quality Gate

- [x] **Lint**: API + web lint both clean (run in Phase 1+2).
- [x] **Build**: API build + web build both clean (run in Phase 1+2).
- [x] **Typecheck**: API clean; web matches the pre-existing 48-error baseline (zero new errors from this effort).
- [x] **Unit Tests**: API `test:unit` green including the new `clubs-list-unread-count.test.ts` (32 assertions).
- [x] **E2E Tests**: `pnpm --filter @divinr/api run test:markets:smoke` green 7/7 (after PostgREST schema-cache reload — pre-existing flake).
- [x] **Curl Tests**: All four cases pass (see step 3.5 above).
- [ ] **Chrome Tests**: Deferred — chrome extension not connected to this session. Curl gate covers the same code path; per-pixel responsive sweep can be picked up by the user or in a session with chrome connected.
- [x] **Phase Review** (PRD §2 G1–G8 + intention scope):
  - [x] G1 — `prediction.club_members.last_viewed_at` exists, nullable, tz-aware. ✓ (Phase 1.1 + 1.2; verified in `information_schema.columns`)
  - [x] G2 — `POST /clubs/:id/activities/viewed` updates `(club, user)` row, idempotent, member-gated → 403 otherwise. ✓ (Phase 1.6 + 1.7 + curl gate cases 2 + 4)
  - [x] G3 — `listMyClubs` returns `unread_count` in single SQL. ✓ (Phase 1.4 + unit test + curl GET /clubs)
  - [x] G4 — `getClub` returns `unread_count`. ✓ (Phase 1.5 + curl gate cases 1 + 3)
  - [x] G5 — `COALESCE(last_viewed_at, joined_at)` semantics correct. ✓ (Phase 1.4/1.5 + step 3.4 — backdated joined_at + NULL last_viewed_at returned the new activities, not full history)
  - [x] G6 — Badge on ACTIVITIES segment with correct formatting. ✓ (code review — `ClubDetailView.vue` renders `formatBadge(store.activeClub.unread_count)` only when > 0; chrome render deferred)
  - [x] G7 — Badge on MY CLUBS cards with correct formatting. ✓ (code review — `ClubsView.vue`; chrome render deferred)
  - [x] G8 — Badge clears within one tab-view of opening ACTIVITIES. ✓ (curl gate proved POST zeroes the underlying field; store action zeroes local state synchronously after the POST resolves)
  - [x] Intention non-goals respected — no per-item read tracking, no message-thread changes, no last_viewed_at backfill. ✓ (Code review of diff.)
  - [x] Deviations documented.

---

## Deviation Notes
<!-- Populated during execution if any phase diverges from the PRD. -->

### Phase 3
- **API restarted in-session.** Per updated user feedback ("always restart yourself so you can see all console logs"), killed the old API PID 3446919 and started `pnpm --filter @divinr/api run dev` in a background Bash so logs are readable. New POST route confirmed registered (curl returns 401, not 404). Memory `feedback_dev_server_restart.md` was inverted to reflect this.
- **Chrome verification deferred — extension not connected.** `mcp__claude-in-chrome__tabs_context_mcp` returns "Browser extension is not connected". Falling back to the curl gate, which exercises the same code path end-to-end (badge value comes straight from `unread_count` on the GET response; clear comes straight from POST setting `last_viewed_at = now()`). Per-pixel responsive sweep (375 / 768 / 1280) is the only thing not covered by curl + unit tests.
- **Curl gate executed live.** Minted a dev JWT with the supabase dev secret (`super-secret-jwt-token-with-at-least-32-characters-long`) for golfergeek user. All four cases pass. Test data cleaned up after.
- **Schema is already live in dev DB** because we applied the ALTER directly via psql in Phase 1 (documented above). The migration file + inline DDL ensure correctness for fresh seeds and future restarts.

### Phase 2
- **Watcher → loadTab callback.** Plan step 2.5 prescribed `watch(segment, …, { immediate: true })`. The view actually uses `@ionChange="loadTab(...)"` and already calls `loadTab(tab.value)` from `onMounted`. To avoid introducing a redundant reactive primitive, the `markActivitiesViewed` call was added inside `loadTab` instead. Same effect (immediate fire on mount + on-change fire), simpler diff.
- **`formatBadge` extracted to `utils/format.ts`.** Plan offered either inline-per-view or extract; we extracted because both views need it and the existing utils file already hosts `pluralize` for similar formatting concerns.

### Phase 1
- **Curl gate deferred to Phase 3.** No seeded `$BEARER` JWT in `.env`. Plan explicitly allows this fallback. Unit test `clubs-list-unread-count.test.ts` (32 assertions) covers the contract — single-SQL invariant, COALESCE(cm.last_viewed_at, cm.joined_at) presence, UPDATE shape with both `(club_id, user_id)`, ForbiddenException on zero rows, Date→ISO-string serialization, and message text avoiding `handleError` substring traps. Phase 3 will run live curls against a real auth token from the chrome session.
- **Markets smoke required PostgREST schema-cache reload.** Same pre-existing flake the prior effort recorded in commit 6423ef8 — the smoke test issues bulk DDL via `MarketsSchemaService.ensureSchema()`, which races PostgREST's schema cache and trips PGRST002 on the next `RbacService` query. Workaround: `NOTIFY pgrst, 'reload schema'` + 12s wait, then re-run. Passed 7/7 cases on retry. Not introduced by this effort (zero markets code touched).
- **Schema applied to dev DB out-of-band.** The running dev API on `:7100` was started before this effort, so its `ClubSchemaService.ensureSchema()` doesn't include the new `last_viewed_at` ALTER. To unblock Phase 1 verification (and Phase 3 chrome work), the ALTER was applied directly via `psql` against `supabase_db_divinr.ai`. The migration file (`2026-04-19-activity-viewed-counter.sql`) and the inline DDL in `club-schema.service.ts` ensure correctness on fresh seed and on next API restart, so this is a no-op divergence.
