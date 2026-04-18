# Activity Viewed Counter — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-18
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [ ] Phase 1: API — migration + write endpoint + derived `unread_count` on `listMyClubs` / `getClub`
- [ ] Phase 2: Web — store update, badge rendering on ACTIVITIES tab + MY CLUBS cards
- [ ] Phase 3: Live verification & responsive sanity (Chrome + curl)

---

## Phase 1: API — migration + write endpoint + derived `unread_count`
**Status**: Not Started
**Objective**: Persist `prediction.club_members.last_viewed_at`, expose `POST /clubs/:id/activities/viewed` to bump it, and extend the existing `listMyClubs` / `getClub` SQL with a single derived `unread_count` field — all in one server round-trip per call.

### Steps
- [ ] 1.1 Create `apps/api/db/migrations/2026-04-19-activity-viewed-counter.sql` with one idempotent `ALTER TABLE prediction.club_members ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;` statement and a header comment explaining the effort, matching the format of `2026-04-13-learning-clubs.sql`.
- [ ] 1.2 Add the same `ALTER TABLE prediction.club_members ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;` statement to the inline DDL string in `apps/api/src/clubs/club-schema.service.ts` (place it next to the existing `ALTER TABLE prediction.clubs ADD COLUMN IF NOT EXISTS …` block around lines 119–121). This is the runtime path that actually evolves the schema on the dev DB — the migration file is for fresh-seed reproducibility only.
- [ ] 1.3 Extend the `Club` interface in `apps/api/src/clubs/club.types.ts` (lines 1–10) with `unread_count?: number` (optional, matching the existing `member_count?` / `my_role?` convention used by sibling derived fields). Add a one-line mirror comment pointing at `apps/web/src/stores/club.store.ts`'s `Club`.
- [ ] 1.4 Extend `ClubService.listMyClubs()` (`apps/api/src/clubs/club.service.ts:67–79`) SQL to include the derived `unread_count` per PRD §4.3 — three scalar subqueries (challenges + polls + journals) summed inline, all filtered by `created_at > COALESCE(cm.last_viewed_at, cm.joined_at)`. Update the return type to include `unread_count: number`.
- [ ] 1.5 Apply the same SQL extension and return-type update to `ClubService.getClub()` (lines 108–121). Reuse the exact same subquery shape so a future refactor can extract the snippet.
- [ ] 1.6 Add `ClubService.markActivitiesViewed(clubId: string, userId: string): Promise<{ ok: true; last_viewed_at: string }>` that runs `UPDATE prediction.club_members SET last_viewed_at = now() WHERE club_id = $1 AND user_id = $2 RETURNING last_viewed_at`. If the result has zero rows, throw `new ForbiddenException('forbidden: caller is not a member of club')` (avoid the substrings `'not found'`, `'Not a member'`, `'Invalid'`, `'Requires'`, `'Cannot'`, `'Owner cannot'` that would re-route in the controller's `handleError` — see step 1.7). On success return `{ ok: true, last_viewed_at: typeof rows[0].last_viewed_at === 'string' ? rows[0].last_viewed_at : (rows[0].last_viewed_at as Date).toISOString() }` so the response is consistently ISO-string regardless of whether the `pg` driver returns a `Date` or a string. No new constructor parameters required (existing `@Inject(DATABASE_SERVICE)` and `@Inject(ClubSchemaService)` are sufficient).
- [ ] 1.7 Add `POST /clubs/:id/activities/viewed` route on `ClubController` (`apps/api/src/clubs/club.controller.ts`) that pulls `user = this.getUser(req)`, calls `this.clubService.markActivitiesViewed(id, user.id)`, and returns the result. Do **not** wrap the call in `this.handleError(err)` — that helper string-matches error messages and would convert the service's `ForbiddenException('Not a member')` into a `NotFoundException` (404). Letting `ForbiddenException` bubble up directly lets NestJS's default exception filter map it to 403 as the PRD requires.
- [ ] 1.8 Create `apps/api/tests/unit/clubs-list-unread-count.test.ts` mirroring the structure of `apps/api/tests/unit/tournaments-list-entrants-preview.test.ts`. Assertions:
  - (a) `listMyClubs` issues exactly one SQL call (`db.calls.length === 1`) — no N+1.
  - (b) The SQL string contains `prediction.club_prediction_challenges`, `prediction.club_consensus_polls`, `prediction.club_strategy_journals`.
  - (c) The SQL string contains `COALESCE(cm.last_viewed_at, cm.joined_at)` (or equivalent COALESCE on the same two columns).
  - (d) Stubbed rows with `unread_count` values 0, 5, 150 round-trip through the service unchanged (and remain a number, not a string).
  - (e) `markActivitiesViewed(clubId, userId)` issues exactly one UPDATE; the SQL constrains by both `club_id` and `user_id`; throws `ForbiddenException` when the mock returns zero rows; returns `{ ok: true, last_viewed_at }` when the mock returns one row.
- [ ] 1.9 Append `&& tsx tests/unit/clubs-list-unread-count.test.ts` to the `test:unit` chain in `apps/api/package.json` (immediately after `tournaments-list-entrants-preview.test.ts`).

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/api run lint` → exit 0.
- [ ] **Build / Typecheck**: `pnpm --filter @divinr/api run typecheck` → exit 0; `pnpm --filter @divinr/api run build` → exit 0.
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` → exit 0. New `clubs-list-unread-count.test.ts` is in the chain and passes; existing club-related tests (`club-analytics-tournaments-count.test.ts`, `clubs-discover-hides-joined.test.ts`, `club-analytics-empty-formatting.test.ts`, `clubs-member-detail-endpoint.test.ts`) still pass.
- [ ] **E2E Tests**: `pnpm --filter @divinr/api run test:markets:smoke` → exit 0 (regression sanity; this effort touches no markets code).
- [ ] **Curl Tests** (against local API on `:7100` with a seeded JWT in `$BEARER`):
  - [ ] `curl -s -H "Authorization: Bearer $BEARER" http://localhost:7100/clubs | jq '.[0] | keys' ` → output includes `"unread_count"`.
  - [ ] `curl -s -H "Authorization: Bearer $BEARER" http://localhost:7100/clubs/$CLUB_ID | jq 'keys'` → output includes `"unread_count"`.
  - [ ] `curl -s -X POST -H "Authorization: Bearer $BEARER" http://localhost:7100/clubs/$CLUB_ID/activities/viewed | jq` → returns `{"ok":true,"last_viewed_at":"..."}`.
  - [ ] Re-run the `GET /clubs` curl after the POST → `unread_count` for that club is `0`.
  - [ ] `curl -s -X POST -H "Authorization: Bearer $OTHER_BEARER" http://localhost:7100/clubs/$CLUB_ID/activities/viewed -w "\n%{http_code}\n"` (a user who is NOT a member of `$CLUB_ID`) → HTTP 403.
  - If no seeded JWT is available in the dev environment (mirroring the prior effort's situation), defer the curl gate to Phase 3 with the chrome verification and rely on the unit-test invariants for now — document in Deviation Notes.
- [ ] **Chrome Tests**: N/A for this phase.
- [ ] **Phase Review**:
  - [ ] `last_viewed_at` column exists on `prediction.club_members` (verified by querying `information_schema.columns`).
  - [ ] `listMyClubs` and `getClub` payloads now include `unread_count` (verified by curl or unit test).
  - [ ] `POST /clubs/:id/activities/viewed` updates only the matching `(club_id, user_id)` row and returns 403 for non-members (verified by curl or unit test).
  - [ ] PRD §2 G1, G2, G3, G4, G5 are addressable by Phase 2 work (the data is now present and the write path is wired).
  - [ ] Deviations documented (see bottom of this plan).

---

## Phase 2: Web — store update, badge rendering on ACTIVITIES tab + MY CLUBS cards
**Status**: Not Started
**Objective**: Mirror the API DTO change in the web store, expose a `markActivitiesViewed` action with optimistic local zeroing, and render the `(N)` badge on both the ACTIVITIES `IonSegmentButton` inside `ClubDetailView.vue` and on each MY CLUBS card in `ClubsView.vue`.

### Steps
- [ ] 2.1 Extend the `Club` interface in `apps/web/src/stores/club.store.ts` with `unread_count?: number`. Add a one-line mirror comment pointing at `apps/api/src/clubs/club.types.ts`. (The corresponding API-side cross-reference comment was added in step 1.3.)
- [ ] 2.2 Add a `markActivitiesViewed(clubId: string)` action in the same store. It should:
  - `await fetch('/api/clubs/' + clubId + '/activities/viewed', { method: 'POST' })` (use the existing `request()` helper if one exists in the store; otherwise follow the same fetch shape as other club mutations in this file).
  - On success (or even on failure — clearing is non-fatal): mutate `myClubs.value.find(c => c.id === clubId)` to set `unread_count = 0`, and if `activeClub.value?.id === clubId`, set `activeClub.value.unread_count = 0`.
  - Swallow errors silently per the established store convention (other actions in this file do the same).
- [ ] 2.3 Add a `formatBadge(n: number | undefined): string` helper near the top of `apps/web/src/views/ClubDetailView.vue` (or a tiny shared `apps/web/src/utils/formatBadge.ts` if you prefer to share with `ClubsView.vue`):
  ```ts
  function formatBadge(n: number | undefined): string {
    if (!n || n <= 0) return '';
    if (n > 99) return '99+';
    return String(n);
  }
  ```
- [ ] 2.4 In `apps/web/src/views/ClubDetailView.vue`, modify the `IonSegmentButton value="activities"` (around line 165). Use whatever variable the existing template already binds the current club to (likely `clubStore.activeClub` or a local `club` ref — read the surrounding `<script setup>` to confirm before editing):
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
- [ ] 2.5 In the same file, add a `watch(segment, …, { immediate: true })` (or augment the existing segment watcher if there is one) that fires `clubStore.markActivitiesViewed(<club-ref>.id)` when the value is `'activities'` AND `<club-ref>?.unread_count > 0`. The `immediate: true` ensures the badge clears on direct-link landings where ACTIVITIES is already the active segment. Use the same `<club-ref>` chosen in step 2.4.
- [ ] 2.6 In `apps/web/src/views/ClubsView.vue`, modify the MY CLUBS card body (lines 57–74) to render the badge directly after the `member_count` chip:
  ```vue
  <span
    v-if="c.unread_count && c.unread_count > 0"
    class="unread-badge"
    :aria-label="`${c.unread_count} unread activities`"
  >({{ formatBadge(c.unread_count) }})</span>
  ```
  Reuse the same `formatBadge` helper (import from the shared utils file if you went that route, otherwise duplicate it in this view's `<script setup>`). Same scoped `.unread-badge` styling.
- [ ] 2.7 Visually verify in the dev tools that the badge renders correctly when `unread_count` is present and disappears entirely when zero/undefined.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/web run lint` → exit 0.
- [ ] **Build / Typecheck**: `pnpm --filter @divinr/web run build` → exit 0. `pnpm --filter @divinr/web run typecheck` introduces zero new errors beyond the pre-existing baseline (~20 errors in unrelated views from the prior effort's deviation notes — verify by stashing and re-running on clean main if uncertain).
- [ ] **Unit Tests**: `pnpm --filter @divinr/web run test` → stub script (no web test harness yet); ensures the package isn't broken.
- [ ] **API regression**: Re-run `pnpm --filter @divinr/api run test:unit` to confirm the new test still passes (sanity, no API changes in this phase).
- [ ] **E2E Tests**: N/A (no web e2e harness).
- [ ] **Curl Tests**: N/A for this phase (API was tested in Phase 1).
- [ ] **Chrome Tests**: Defer the live chrome sweep to Phase 3 per the project feedback memory ("UI tests should run in a fresh context, not bolted onto long backend sessions"). Code-level verification (correct `v-if` guard, correct event wiring, correct CSS class) suffices for this gate.
- [ ] **Phase Review**:
  - [ ] PRD §2 G6 — `(N)` badge on the ACTIVITIES `IonSegmentButton` with `0 → hidden`, `1–99 → (N)`, `100+ → (99+)` formatting (verified by reading `formatBadge` and the v-if guard).
  - [ ] PRD §2 G7 — same badge on MY CLUBS cards (verified by reading `ClubsView.vue` diff).
  - [ ] PRD §2 G8 — opening the ACTIVITIES tab triggers `markActivitiesViewed` AND zeroes `unread_count` locally for immediate badge clear (verified by reading the action body and the watcher).
  - [ ] No new dependencies added; no new component file unless `formatBadge` was extracted to a utils file.
  - [ ] Deviations documented (see bottom).

---

## Phase 3: Live verification & responsive sanity
**Status**: Not Started
**Objective**: Confirm the badge renders correctly across mobile/tablet/desktop, the network panel shows exactly one `POST /clubs/:id/activities/viewed` per ACTIVITIES tab open, and a brand-new member of an established seeded club sees a meaningful (non-`99+`) initial count — closing PRD §2 G1–G8 with live evidence.

### Steps
- [ ] 3.1 Restart the API dev server so it picks up the new schema (the inline `ensureSchema()` runs on first request after start) and the new code paths. Confirm the API is serving on `:7100`.
- [ ] 3.2 In a fresh-context Chrome session via the `mcp__claude-in-chrome__*` tools, navigate to `http://localhost:7101/clubs` and:
  - [ ] Confirm a `(N)` badge renders on at least one MY CLUBS card (seeded test data should have post-join activity in St. Thomas Investing Club or one of the other seeded clubs). Capture the rendered count.
  - [ ] Click into that club. Confirm the ACTIVITIES `IonSegmentButton` shows the same `(N)`.
  - [ ] Click the ACTIVITIES segment. Confirm the badge clears immediately (within one tick — no waiting for refetch).
  - [ ] Confirm the network panel shows exactly one `POST /clubs/:id/activities/viewed` for that interaction; the response body is `{ok: true, last_viewed_at: ...}`; HTTP 200.
- [ ] 3.3 Repeat the visual check at viewport widths 375px (iPhone SE), 768px (tablet), 1280px (desktop). Confirm: badge does not wrap, does not overflow the segment button or card edge, does not push the `member_count` chip out of position on cards.
- [ ] 3.4 (If feasible with current seed data) Use a brand-new test member (or simulate by setting `last_viewed_at = NULL` on a member row directly in the dev DB and refreshing) to confirm the COALESCE-to-`joined_at` semantics produce a meaningful count rather than `(99+)` from full club history.
- [ ] 3.5 If the curl gate was deferred from Phase 1 (no seeded JWT), execute it now using the running browser session's auth token from devtools.
- [ ] 3.6 Final sweeps: API unit suite green; web build green; web typecheck no new errors vs. baseline.

### Quality Gate

- [ ] **Lint**: API + web lint both clean (`pnpm --filter @divinr/api run lint` + `pnpm --filter @divinr/web run lint`).
- [ ] **Build**: API build + web build both clean (`pnpm --filter @divinr/api run build` + `pnpm --filter @divinr/web run build`).
- [ ] **Typecheck**: API typecheck clean. Web typecheck has the pre-existing baseline errors only (no new ones introduced by this effort) — same expectation as the prior effort's Phase 3.
- [ ] **Unit Tests**: API `test:unit` green including the new `clubs-list-unread-count.test.ts`.
- [ ] **E2E Tests**: `pnpm --filter @divinr/api run test:markets:smoke` green (regression sanity).
- [ ] **Curl Tests**: All four curls from Phase 1's gate executed and pass (here if deferred from Phase 1).
- [ ] **Chrome Tests**: All scenarios in step 3.2 and 3.3 pass; screenshot captured for the completion report.
- [ ] **Phase Review** (PRD §2 G1–G8 + intention scope):
  - [ ] G1 — `prediction.club_members.last_viewed_at` exists, nullable, tz-aware. ✓ (Phase 1.1 + 1.2)
  - [ ] G2 — `POST /clubs/:id/activities/viewed` updates `(club, user)` row, idempotent, member-gated → 403 otherwise. ✓ (Phase 1.6 + 1.7 + curl)
  - [ ] G3 — `listMyClubs` returns `unread_count` in single SQL. ✓ (Phase 1.4 + unit test)
  - [ ] G4 — `getClub` returns `unread_count`. ✓ (Phase 1.5 + curl)
  - [ ] G5 — `COALESCE(last_viewed_at, joined_at)` semantics correct. ✓ (Phase 1.4/1.5 + step 3.4)
  - [ ] G6 — Badge on ACTIVITIES segment with correct formatting. ✓ (step 3.2)
  - [ ] G7 — Badge on MY CLUBS cards with correct formatting. ✓ (step 3.2)
  - [ ] G8 — Badge clears within one tab-view of opening ACTIVITIES. ✓ (step 3.2)
  - [ ] Intention non-goals respected — no per-item read tracking, no message-thread changes, no last_viewed_at backfill. ✓ (Code review of diff.)
  - [ ] Deviations documented.

---

## Deviation Notes
<!-- Populated during execution if any phase diverges from the PRD. -->

(empty — populate as the plan executes)
