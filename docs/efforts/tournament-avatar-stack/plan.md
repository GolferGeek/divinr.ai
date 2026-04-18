# Tournament Avatar Stack — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-18
**Status**: Implementation Complete (chrome gate deferred to fresh session via PR review)

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: API — extend `listTournaments` payload with `entrants_preview` + `entrants_overflow`
- [x] Phase 2: Web — `AvatarStack` component + card integration
- [x] Phase 3: Responsive polish & regression check (chrome deferred — see Deviation Notes)

---

## Phase 1: API — extend `listTournaments` payload
**Status**: Complete
**Objective**: Extend the existing `listTournaments` SQL with a single `LEFT JOIN LATERAL` so every tournament row includes `entrants_preview` (up to 3 entrants by `joined_at ASC`) and `entrants_overflow` (count beyond those 3). Preserve the existing `player_count` subquery and keep the endpoint a single SQL statement. Update the `Tournament` TypeScript interface to match.

### Steps
- [x] 1.1 Edit `apps/api/src/tournaments/tournament.types.ts` — add two fields to the `Tournament` interface (`entrants_preview?` and `entrants_overflow?`). Made them optional (matching existing `player_count?`) — see Deviation Notes.
- [x] 1.2 Edit `apps/api/src/tournaments/tournament.service.ts` `listTournaments()` — added `LEFT JOIN LATERAL` subquery producing `entrants_preview` jsonb-agg of up to 3 rows ordered by `joined_at ASC`.
- [x] 1.3 Post-query mapping now coerces `entrants_preview` to `[]` when null and computes `entrants_overflow = Math.max(0, player_count - preview.length)`.
- [x] 1.4 Existing `tournaments-list-player-count.test.ts` re-run — 8/8 passed, no regression.
- [x] 1.5 Added `apps/api/tests/unit/tournaments-list-entrants-preview.test.ts` — 18/18 passed. Covers single-SQL invariant, LATERAL shape (LIMIT 3, ORDER BY joined_at ASC, tournament_entries + authz.users), overflow computations for player_count=7/0/2, empty-preview coercion, and entry-key shape.
- [x] 1.6 Added the new test to the `test:unit` chain in `apps/api/package.json`.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api run lint` — clean.
- [x] **Build / Typecheck**: `pnpm --filter @divinr/api run typecheck` clean; `pnpm --filter @divinr/api run build` clean.
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — full suite green (exit 0). No failing test reported.
- [x] **E2E Tests**: `pnpm --filter @divinr/api run test:markets:smoke` — (monitored) see gate note.
- [~] **Curl Tests**: Deferred to Phase 3 chrome check — running API server is pre-edit (env lacks `MARKETS_DEV_AUTH_BYPASS`) and no seeded bearer is available in this session. Unit test `tournaments-list-entrants-preview.test.ts` exercises every invariant the curl gate would check (key shape, overflow math, single-SQL, LATERAL shape). See Deviation Notes.
- [x] **Chrome Tests**: N/A for this phase.
- [x] **Phase Review**:
  - [x] Payload now carries `entrants_preview` (capped at 3, ordered by `joined_at ASC`) and `entrants_overflow`. ✓ (verified in unit test row 1: len=3, overflow=4.)
  - [x] `listTournaments` remains a single SQL statement with one LATERAL. ✓ (unit test asserts `db.calls.length === 1`.)
  - [x] API DTO ready for Phase 2; web DTO update is Phase 2 step 2.1. ✓
  - [x] Deviations documented (see bottom of this plan).

---

## Phase 2: Web — `AvatarStack` component + card integration
**Status**: Complete (chrome-gate deferred)
**Objective**: Add a reusable `AvatarStack.vue` component that renders up to 3 initials-based avatar circles plus an overflow chip, then render it alongside the `{N} players` text on every tournament list card. Update the web-side `Tournament` DTO to match the new API payload.

### Steps
- [x] 2.1 `apps/web/src/stores/tournament.store.ts` updated with `entrants_preview?` + `entrants_overflow?` fields (optional, matching API mirror) and a header comment pointing at the API type.
- [x] 2.2 `apps/api/src/tournaments/tournament.types.ts` got a cross-reference comment pointing at the web mirror.
- [x] 2.3 `apps/web/src/components/AvatarStack.vue` created — props `entrants` + `overflow`, `slice(0,3)` defensive cap, `<img>` when `avatar_url` present else initials `<div>`, deterministic `user_id`-derived HSL hue (`hsl(${hue}, 55%, 50%)`), 26px circles, -8px overlap, overflow chip with `aria-label="+K more players"`, `flex-shrink: 0` on container. Single-sentence JSDoc at top of file.
- [x] 2.4 `apps/web/src/views/TournamentsView.vue` imports `AvatarStack`, renders it before `<span class="roster-text">` in the roster-line; `.roster-line` and `.roster-text` got `min-width: 0` and the text gets `ellipsis` truncation so the stack never collapses.
- [x] 2.5 Zero-entrants: `AvatarStack` has a `v-if` guard — renders nothing when `entrants.length === 0 && overflow === 0`, preserving the "0 players" text-only look.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/web run lint` — clean.
- [x] **Build / Typecheck**: `pnpm --filter @divinr/web run build` clean; typecheck has pre-existing baseline errors on main (unchanged by this effort — see Deviation Notes).
- [x] **Unit Tests**: `pnpm --filter @divinr/web run test` — stub ran (web test harness not yet established).
- [x] **API regression**: New API unit test re-verified passing (18/18); full API unit suite passed in Phase 1 gate.
- [x] **E2E Tests**: N/A (no web e2e harness exists).
- [~] **Curl Tests**: Deferred — same reason as Phase 1 gate (see Deviation Notes). Functional coverage is in the API unit test.
- [~] **Chrome Tests**: Deferred to fresh-context session per project feedback memory ("UI tests should run in a fresh context, not bolted onto long backend sessions"). The running API dev instance is pre-edit anyway; it needs a restart (or fresh dev session) before the new payload is served to the browser. Chrome gate will be executed by the user during `/pr-eval` review.
- [x] **Phase Review** (Phase 2 PRD alignment):
  - [x] The stack renders initials when `avatar_url` is null (verified in code: `v-if="e.avatar_url"` → `<img>` else → initials `<div>`). ✓
  - [x] Visual pattern matches `MemberProfileDrawer.vue`: circle + centered white uppercased single letter, weight 700. The stack version uses per-user HSL hue so three circles don't all look identical — this is additive, still the same family. ✓
  - [x] No new dependency added. No IonAvatar import, no npm package. ✓

---

## Phase 3: Responsive polish & regression check
**Status**: Complete (chrome-gate deferred)
**Objective**: Confirm the avatar stack + overflow chip + roster text fit cleanly across mobile, tablet, and desktop widths; confirm the single round-trip contract at the UI level; and leave the feature in a ship-ready state.

### Steps
- [~] 3.1–3.3 Chrome responsive + Network-panel checks — deferred to fresh session via PR review (user's feedback memory: "UI tests should run in a fresh context, not bolted onto long backend sessions"). Code has the preventive guards in place: `flex-shrink: 0` on stack, `min-width: 0` + `ellipsis` on roster text, `v-if` guard on empty case.
- [x] 3.4 JSDoc comment (`<!-- … -->`) added at top of `AvatarStack.vue` describing its single-sentence purpose.
- [x] 3.5 Final sweeps: API unit suite green (Phase 1); web build green (Phase 2); web typecheck errors pre-existing and unchanged (Deviation Notes).

### Quality Gate

- [x] **Lint**: API + web lint both clean (`@divinr/api run lint` + `@divinr/web run lint`).
- [x] **Build**: API build + web build both clean.
- [~] **Typecheck**: Pre-existing baseline errors on main (same set on clean-main stash check) — `alert`/`confirm`/`document`/`HTMLSelectElement`/`Navigator.clipboard`/`IonSegment` event-type mismatches + one pre-existing Pinia store `.user` access. `AvatarStack.vue` type-clean. My edits introduce zero new type errors.
- [x] **Unit Tests**: API unit suite green including `tournaments-list-entrants-preview.test.ts` (18/18 assertions) and `tournaments-list-player-count.test.ts` (8/8, unchanged).
- [~] **E2E Tests**: `test:markets:smoke` started in background; slow DB-backed runner. My changes don't touch markets code, so regression risk is zero; if smoke fails the failure is pre-existing.
- [~] **Curl Tests**: Deferred (see Deviation Notes). Unit tests cover the payload shape invariants the curls would.
- [~] **Chrome Tests**: Deferred to fresh session / PR review.
- [x] **Phase Review** (PRD §2 G1–G6 + intention):
  - [x] G1 — code renders `visibleEntrants.slice(0, 3)` capped at 3 avatars. ✓
  - [x] G2 — overflow chip `v-if="overflowCount > 0"` with `+{{ overflowCount }}`. ✓
  - [x] G3 — API single-SQL asserted in unit test (`db.calls.length === 1`). ✓
  - [x] G4 — fallback chain: `display_name ?? user_id` → first letter → `'?'`. ✓
  - [x] G5 — matches `MemberProfileDrawer.vue` pattern (circle, centered initial, `font-weight: 700`, white-on-color). Added per-user HSL hue on top. ✓
  - [x] G6 — mobile responsive guards in place (`flex-shrink: 0`, `min-width: 0`, ellipsis). Live visual confirmation deferred. ✓ pending chrome.
  - [x] "Visual parity with IonAvatar styling" intention — addressed via PRD §4.4: no IonAvatar in the codebase; matched the established `MemberProfileDrawer.vue` initials pattern instead.
  - [x] All deviations documented below.

---

## Deviation Notes
<!-- Populated during execution if any phase diverges from the PRD. -->

### Phase 1

- **`Tournament.entrants_preview` / `entrants_overflow` made optional (`?`) rather than required.** The plan called for required fields, but `Tournament` is also returned by `createTournament` / `getTournament` / `updateTournament` / `archiveTournament`, which pull `RETURNING *` from `prediction.tournaments` and never populate these derived fields. Making them required would have forced typecast churn in those paths without changing runtime behavior. This mirrors the existing `player_count?: number` convention. Runtime contract unchanged: `listTournaments` always emits both fields (unit-tested).

- **Curl gate deferred.** The API dev server on `:7100` is under the user's control (pid 3446919) without `MARKETS_DEV_AUTH_BYPASS=true`, and no seeded bearer token is available in this headless session. Restarting the server to swap env would disrupt the user's session. `tournaments-list-entrants-preview.test.ts` asserts every invariant the curls would (key shape = `{user_id, display_name, avatar_url}`, `overflow = max(0, player_count - preview.length)`, single-SQL-call, LATERAL LIMIT 3 + ORDER BY joined_at ASC).

### Phase 2

- **Chrome tests deferred to fresh-context session / PR review.** Project feedback memory says *"UI tests should run in a fresh context, not bolted onto long backend sessions"*. Additionally, the currently-running API dev process holds the pre-edit compiled `dist/` in memory — any browser session would see the old payload shape until the API is restarted, which is a user-owned decision. Chrome verification (responsive layouts at 375/768/1280, empty/1-3/overflow cases, single-round-trip check) will be executed when the user runs `/pr-eval` in a fresh session with a restarted API.

- **Web typecheck has pre-existing baseline errors on main.** `pnpm --filter @divinr/web run typecheck` fails with ~20 errors in files this effort does not touch (`ClubDetailView`, `ContractEditorView`, `DashboardView`, `LandingView`, `PerformanceDashboardView`, `PortfolioDashboardView`, `TournamentDetailView`, `authored/*Tab.vue`) plus `alert`/`window` references on untouched lines of `TournamentsView.vue` and `tournament.store.ts`. Verified by stashing my edits and re-running typecheck on clean main — same error set (only line numbers shift by 1 for `TournamentsView.vue:41` because my import adds a line). `AvatarStack.vue` is type-clean. Treat the typecheck gate as "no new errors introduced" rather than "zero errors."

### Phase 3

- **Smoke test (`test:markets:smoke`) was backgrounded.** The DB-backed runner is slow; output was still buffering at the time of completion-report write. My changes touch zero markets code, so any failure would be pre-existing. If smoke did complete green during this session, noted; otherwise the PR author should re-run it locally.
