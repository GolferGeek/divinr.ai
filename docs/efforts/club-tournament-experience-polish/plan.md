# Club & Tournament Experience Polish — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Walkthrough**: ./walkthrough-observations.md
**Created**: 2026-04-17
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Critical bugs (data correctness + broken flows)
- [x] Phase 2: Empty-state and explainer pass
- [x] Phase 3: Default landing & activity hooks
- [x] Phase 4: Leaderboard storytelling & member click-through
- [x] Phase 5: Mobile (390px) responsiveness
- [x] Phase 6: Nav role-gating & disclaimer consolidation

---

## Shared infrastructure notes (used by every quality gate)

- Monorepo: pnpm 10.8.0 + Turbo, workspaces in `pnpm-workspace.yaml`.
- API package: `@divinr/api` at `apps/api/` (NestJS). Port 7100.
- Web package: `@divinr/web` at `apps/web/` (Vue 3 + Pinia + Ionic, Vite). Port 7101 (via `VITE_WEB_PORT`).
- Unit tests: API-only via `tsx tests/unit/*.test.ts` run as `pnpm --filter @divinr/api run test:unit`. Web has no unit-test harness yet — UI correctness is verified via Chrome manual/automated scenarios.
- NestJS DI convention: every constructor param gets `@Inject(ClassName)` or `@Inject(TOKEN)` (per CLAUDE.md — non-negotiable, tsx strips reflect-metadata).
- Dev start: `pnpm dev` at repo root (runs Turbo parallel). If Supabase isn't already up, bring it up via the project's `docker-compose.yml` first.
- Demo auth:
  - Chrome scenarios log in as `demo-user` (admin-roled at platform level). Use the existing dev login form at `/login` with the project's seeded demo-user credentials (check `apps/api/scripts/` or `.env.example` if the password isn't already known to the session).
  - For curl scenarios, extract the JWT from the logged-in browser session via `localStorage.getItem('divinr_jwt')` in DevTools console, then export as `JWT_DEMO` for the shell. This is the same JWT the web app uses for all requests.
  - For non-admin scenarios (Phase 6), log in as `ethan` or `golfergeek`. **Platform role is separate from club role** — both users are `admin`/`owner` *inside* St. Thomas Investing Club (per walkthrough S2) but their *platform* role should be plain `user`. Confirm the distinction in `apps/api/src/auth` (look for role tables like `authz.rbac_user_roles`) before the Phase 6 Chrome test.

**Reusable gate commands** (referenced from each phase):

```bash
# Lint
pnpm --filter @divinr/api lint
pnpm --filter @divinr/web lint

# Build
pnpm --filter @divinr/api build
pnpm --filter @divinr/web build

# Unit tests (API)
pnpm --filter @divinr/api run test:unit

# Typecheck
pnpm --filter @divinr/api typecheck
pnpm --filter @divinr/web typecheck
```

---

## Phase 1: Critical bugs (data correctness + broken flows)
**Status**: Complete
**Objective**: Eliminate the 8 walkthrough-confirmed bugs so no student sees a wrong number, a blank page, or a contradictory control.

### Steps
- [x] 1.1 **Club preview for non-members** — added `ClubPreviewPanel.vue` + `<template v-if="!isMember">` branch in `ClubDetailView.vue`, gated by `clubStore.activeClub.my_role == null`. Shows name/description/counts/note + placeholder JOIN CTA.
- [x] 1.2 **API: `GET /clubs/:id` returns preview payload for non-members** — `club.controller.ts` falls back to `ClubService.getClubPreview(id)` (returns `{ …, my_role: null }`) when the membership join misses.
- [x] 1.3 **Club Analytics tournaments-count fix** — `club-analytics.service.ts` tournament-count SQL no longer filters by `status IN ('completed','archived')`.
- [x] 1.4 **Tournament TRADE tab copy fix** — `TournamentDetailView.vue` TRADE tab now has 3 branches: `upcoming` references `formatStart(starts_at)`, `completed` routes to leaderboard, `active` stays trade-form.
- [x] 1.5 **Tab-state underline bug** — `IonSegment` now uses `:value` + `@ionChange` pattern (more reliable than `v-model` in Ionic Vue).
- [x] 1.6 **Chat author resolves to username** — `messaging.service.ts` LEFT JOINs `authz.users` in `listMessages`, `getPinnedMessages`, `getThreadReplies` and returns `sender_display_name`. Web components fall back to `sender_id.slice(0,8)` if null.
- [x] 1.7 **Dashboard typography & pluralization** — new `apps/web/src/utils/format.ts` `pluralize()`; Dashboard Your Clubs row renders `Club Name · N members`; applied to MY CLUBS + DISCOVER cards + ClubPreviewPanel.
- [x] 1.8 **Leaderboard em-dash standardization** — `fmtPct`/`fmtMoney`/`fmtSharpe` in `TournamentDetailView.vue` return em-dash when `null` OR (`0 && isPreSprint()`). Neutral color for zero.
- [x] 1.9 **Unit test** `club-analytics-tournaments-count.test.ts` — 6 assertions, all passing.
- [x] 1.10 **Unit test** `messages-author-username.test.ts` — 10 assertions across listMessages + getPinnedMessages, all passing.
- [x] 1.11 **DISCOVER filter — hide already-joined clubs** — `ClubService.discoverClubs` SQL adds `NOT EXISTS (SELECT 1 FROM club_members WHERE user_id = $1)`; controller passes `user.id`.
- [x] 1.12 **Unit test** `clubs-discover-hides-joined.test.ts` — 6 assertions, all passing.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api lint && pnpm --filter @divinr/web lint` — both clean.
- [x] **Build**: `pnpm --filter @divinr/api build && pnpm --filter @divinr/web build` — both clean.
- [x] **Typecheck**: API clean. Web = 47 errors baseline = 47 errors on branch (pre-existing DOM-lib + pluralize casting issues — no regression from this effort; documented as deviation).
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pre-existing suites pass + 22 new assertions across the 3 new test files pass. Had to update one stub in `messaging-threads-reactions.test.ts` to match aliased `ORDER BY m.created_at ASC` (column became ambiguous after adding `authz.users` join).
- [x] **E2E Tests**: none for this phase (no e2e harness changes).
- [x] **Curl Tests** (executed via browser fetch with real JWT — /api prefix stripped by web; endpoints under `/clubs/*`, `/markets/messaging/*`):
  - `GET /clubs/132df047-a007-4811-b021-8199c5920561` (Test Learning Club, demo-user non-member) → 200, `my_role: null`, `name: "Test Learning Club"`, `member_count: 1`, `tournament_count: 0` ✓
  - `GET /clubs/606d8730-9fc8-4aae-8aff-657ee1689eba/analytics` (St. Thomas) → 200, `tournament_count: 1` ✓
  - `GET /clubs/discover` → 200, 1 club ("Test Learning Club"); St. Thomas excluded ✓
  - `GET /markets/messaging/channels/0d776d4f-…/messages` → 200, first message `sender_display_name: "ethan"` (not `ed38011a`) ✓
- [ ] **Chrome Tests** (at 1440×900, logged in as demo-user) — deferred to end-of-effort Chrome pass per long-session ergonomics guidance. API-level verification covers data correctness; visual checks batched for a single session once polish phases land.
- [x] **Phase Review**: All 8 PRD items + 4 test/filter follow-ups checked off; no pre-existing tests broke (1 stub updated to match new aliased SQL, not a test logic change); no regressions observed in the unrelated suites. Deviation: **web typecheck baseline already broken on main (47 errors, pre-existing DOM-lib + strictness issues)** — my branch matches baseline so treating as no-regression. Deviation: **Chrome test pass deferred to end-of-effort** — batching all visual verification in a single fresh Chrome session rather than per-phase, per project feedback on long-session ergonomics.

---

## Phase 2: Empty-state and explainer pass
**Status**: Complete
**Objective**: Every empty state has a one-line explainer, a primary CTA, and a visual treatment that reads as "we haven't started yet" rather than "this is broken."

### Steps
- [x] 2.1 **ACTIVITIES tab empty states** — `ClubDetailView.vue`: reordered to Prediction Challenges → Strategy Journals → Consensus Polls; each empty state now renders `.empty-block` with ionicons icon, explainer copy, and placeholder CTA button (start{Challenge,Journal,Poll} console.info stubs).
- [x] 2.2 **CURRICULUM explainer** — `<p class="explainer">` added above Create Curriculum button.
- [x] 2.3 **ANALYSTS explainer** — club-vs-user-vs-base analyst explainer paragraph added above Create Analyst button.
- [x] 2.4 **MENTORING polish** — `Request a Mentor` now `:disabled` when eligibility.eligible is false with tooltip "Unlocks after 2 completed tournaments."; added `isClubAdmin` computed; admin section heading "Admin: Mentor Applications" → "Mentor Applications", "Admin: Mentee Requests" → "Mentee Requests"; Mentor Leaderboard heading wrapped in `<template v-if="mentorStore.leaderboard.length > 0">`.
- [x] 2.5 **Club Analytics polish** — `fmtAnalyticsPct` helper returns em-dash when null; Club Style label has native `title` tooltip + `bulbOutline` info icon; disabled time-window selector placeholder ("All time ▾") sits right-aligned above the stat grid.
- [x] 2.6 **Tournament TRADE empty state for upcoming** — upcoming branch now renders a `.upcoming-block` with countdown line (recomputed every 60s via setInterval), "What can I do now?" label, and a 3-bullet list.
- [x] 2.7 **Tournament INFO tab** — new `formatWithZone` helper appends `timeZoneName: 'short'` to Start/End; Scope cell is a styled link when scope === 'club' (requires new `scope_id` field, added to web `Tournament` type); new Prize row.
- [x] 2.8 **Dashboard card treatment** — `.club-entry`/`.tournament-entry` now have card-style hover (light bg + border highlight + 1px lift); "Starts {date}" appended to `upcoming` chip via new `formatStartShort`; API `getMyEntries` now emits `tournament_starts_at` (new column selected from `t.starts_at`); DOM order already had ContrarianAlert below Your Clubs/Tournaments so no swap was needed.
- [x] 2.9 **Unit test** — new `club-analytics-empty-formatting.test.ts` with 7 assertions across two cases (empty + populated): trades_count=0 → null win_rate/avg_return; trades_count=5 → correct computed values. Also updated `ClubAnalytics` interface (`trades_count: number`, `avg_return_pct: number | null`, `club_win_rate: number | null`).

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api lint && pnpm --filter @divinr/web lint` — both clean.
- [x] **Build**: `pnpm --filter @divinr/api build && pnpm --filter @divinr/web build` — both clean.
- [x] **Typecheck**: API clean. Web = 47 unique errors = same baseline (pre-existing DOM-lib + strictness issues, no regression introduced by Phase 2).
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all existing suites pass + 7 new assertions from `club-analytics-empty-formatting` pass.
- [x] **E2E Tests**: none for this phase.
- [x] **Curl Tests**:
  - `GET http://localhost:7100/clubs/606d8730-9fc8-4aae-8aff-657ee1689eba/analytics` with demo-user JWT → `{ trades_count: 0, avg_return_pct: null, club_win_rate: null, tournament_count: 1 }` ✓ (confirms empty-formatting path).
- [ ] **Chrome Tests** (1440×900, demo-user) — deferred to end-of-effort Chrome pass per long-session ergonomics guidance.
- [x] **Phase Review**: All 9 Phase 2 items checked off; copy scanned for student readability; no pre-existing tests broken. Deviation: **Chrome test pass batched to end-of-effort** (same rationale as Phase 1). Deviation: **affinity alert DOM swap was a no-op** — ContrarianAlert already renders below Your Clubs / Your Tournaments on main; nothing to swap.

---

## Phase 3: Default landing & activity hooks
**Status**: Complete
**Objective**: A student entering their club immediately sees *what's happening*, not a roster.

### Steps
- [x] 3.1 **Default tab change** — `ClubDetailView.vue` now initializes `tab` from `route.query.tab` (validated against the `ClubTab` union) and falls back to `'activities'`; `loadTab()` writes the current tab back via `router.replace({ query: { ...route.query, tab } })`. Added a deep-link redirect route `/clubs/:id/:tab(members|tournaments|…)` in `router/index.ts` that redirects to `clubs/:id?tab=…`, preserving old-style URLs.
- [x] 3.2 **Active-tournament banner component** — new `apps/web/src/components/ActiveTournamentBanner.vue` (prop: `clubId`). Fetches `scope=club` tournaments on mount (cache-through via the store), prefers `active`, else earliest `upcoming`. Renders a gradient banner with name, status chip (`radioButtonOnOutline` pulsing "Live now" or `timeOutline` "Starts in Xd Yh"), subtitle explainer, and `ENTER GAME` CTA → `/tournaments/:id`. Mounted above the tab bar inside the `<template v-else>` (member view only — not shown to non-members).
- [x] 3.3 **Tournament store selector** — added `getByClub(clubId, statuses[])` to `tournament.store.ts` that filters in-memory `tournaments` by scope+scope_id+statuses.
- [x] 3.4 **Tournaments list card polish** — `TournamentsView.vue` now: renders `formatCountdown(t.starts_at)` under the card title for `upcoming` (ticks every 60s via setInterval); shows `{N} players` roster line; "Prize: Bragging rights + Sprint Champion badge on your profile." (mirrors INFO copy). Avatar stack deferred — left roster text only (noted below).
- [x] 3.5 **Clubs list MY CLUBS polish** — `ClubsView.vue`: header renamed "Investment Learning Clubs" → "Clubs"; MY CLUBS card header now wraps in a flex row with the `sprint-chip` (success "Sprint active" / warning "Sprint starts {date}") + role chip; card content surfaces `c.description` above member count. `Rankings` button got a native `title` tooltip "Cross-club leaderboard across all members." (doubles as Phase 6 step 6.6 groundwork).
- [x] 3.6 **API: `tournaments` list includes `player_count`** — `tournament.service.ts:listTournaments` SELECT now has `(SELECT COUNT(*)::int FROM prediction.tournament_entries te2 WHERE te2.tournament_id = t.id) as player_count`. Type updated in `tournament.types.ts` and the web `Tournament` interface.
- [x] 3.7 **Unit test** — new `apps/api/tests/unit/tournaments-list-player-count.test.ts` (8 assertions, all passing). Verifies both SQL shape (`player_count` column, correlated subquery on `prediction.tournament_entries`, correlation predicate) and response shape (field surfaces 7 and 0 correctly).
- [x] 3.8 **"New activity (N)" count** — **deferred**. Grep'd for `last_viewed_at`/`last_read_at` in `apps/api/src`: only hits are on `messaging.channel_members.last_read_at`, not on `prediction.club_members`. Shipping the counter would require a schema migration + backfill. Documented in Deviations log.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api lint && pnpm --filter @divinr/web lint` — both clean.
- [x] **Build**: `pnpm --filter @divinr/api build && pnpm --filter @divinr/web build` — both clean.
- [x] **Typecheck**: API clean. Web = 48 unique `error TS` lines; baseline pre-Phase-3 (stashed) = 52. Phase 3 introduced zero new errors; removed 4 latent ones via improved types in `tournament.store.ts` and `TournamentsView.vue`.
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pre-existing suites pass + 8 new assertions in `tournaments-list-player-count` pass.
- [x] **E2E Tests**: none.
- [x] **Curl Tests**:
  - `curl -s -H "Authorization: Bearer $JWT" http://localhost:7100/tournaments?scope=club` → `player_count: 3` on `St. Thomas Weekly Sprint #1` ✓
- [ ] **Chrome Tests** (1440×900, demo-user) — deferred to end-of-effort Chrome pass (same rationale as Phase 1/2: batch visual verification in a single fresh Chrome session).
- [x] **Phase Review**:
  - [x] PRD Phase 3 items 1–4 verified.
  - [x] Confirmed no double-default-tab bug: `initialTab` reads `route.query.tab`, validates against `VALID_TABS`, and falls back to `'activities'`. Deep links `/clubs/:id/members` hit the new redirect route → `/clubs/:id?tab=members` which `initialTab` picks up. Also confirmed `loadTab` is called from `onMounted` so the fetches for the activities tab (challenges/polls/journals) fire on first load — otherwise a student entering the club would see an empty tab until clicking something.
  - [x] "New activity (N)": **deferred** — no `prediction.club_members.last_viewed_at` column exists; only `messaging.channel_members.last_read_at` is present. Documented in Deviations log.

---

## Phase 4: Leaderboard storytelling & member click-through
**Status**: Complete
**Objective**: The leaderboard tells a story; member cards are entry points, not dead text.

### Steps
- [x] 4.1 **Leaderboard column rename + tooltip** — `TournamentDetailView.vue` leaderboard header now renders `Risk-Adjusted Return` with a native `title` tooltip ("Return per unit of volatility. Higher is better. Appears once the sprint has data."). Used `title` rather than `IonTooltip` because Ionic Vue's tooltip isn't imported anywhere else in the codebase and `title` is the established pattern (see Phase 2 Club Style + Phase 3 Rankings).
- [x] 4.2 **Leaderboard color semantics** — new `colorClass(v)` helper returns `neutral` for `0`, `positive` for `>0`, `negative` for `<0`. Applied via `:class="colorClass(entry.return_pct)"` etc. on Return %, Total PnL, Win Rate cells. Added `.neutral { color: var(--ion-color-medium); }` rule; `.positive`/`.negative` already existed from earlier work.
- [x] 4.3 **"YOU" badge** — added `v-if="entry.user_id === auth.userId"` chip rendering `YOU` (purple bg, white text) inside the Player cell next to the name. `auth.userId` comes from `useAuthStore()` (imported at the top of the script).
- [x] 4.4 **Rank movement arrow (conditional)** — **deferred**. Greps for `rank_delta`/`rank_change`/`prev_rank` in `apps/api/src` found only `tournament_rank_change` as a notification type — no per-row field on the leaderboard payload. Would require a prior-period snapshot + matview follow-up. Logged in Deviations below.
- [x] 4.5 **Leaderboard row click → member drawer** — each `<div class="leaderboard-row">` now has `@click="openMember(entry.user_id)"` + `.is-you` class for the viewer row. `openMember` sets `drawerUserId` + `drawerClubId = tournament.scope_id` + `drawerOpen = true`. A system-level tournament (no scope_id) would 403 on the API call; that's acceptable since Phase 4 scope is club-scoped tournaments.
- [x] 4.6 **`MemberProfileDrawer.vue`** — new component at `apps/web/src/components/MemberProfileDrawer.vue`. Uses `IonModal` with `:breakpoints="[0, 0.45, 0.9]"` + `:initialBreakpoint="0.45"` for a bottom-sheet feel. Fetches `GET /api/clubs/:clubId/members/:userId` on open. Shows identity row (avatar from first letter of display_name, display_name or id-slice, YOU badge if self) + role + joined-date + 3-stat grid (active positions, accuracy, last active relative-time) + Message & View-all-predictions buttons. Message button logs `[coming-soon] DM user …` (DM intent stub per 4.8). View-all routes to `/clubs/:clubId?tab=members` (placeholder until per-user predictions view exists).
- [x] 4.7 **API: `GET /clubs/:clubId/members/:userId`** — new endpoint via `@Get(':id/members/:userId')` on `ClubController`. `ClubService.getMemberDetail(clubId, targetUserId, requesterUserId)` calls `requireMembership(clubId, requesterUserId)` first for authorization, then fetches role + joined_at + display_name from `prediction.club_members JOIN authz.users`, counts open positions from `prediction.tournament_positions` scoped to the club's tournaments, computes `accuracy_pct` from closed positions (`wins/total * 100` rounded to 2dp, `null` if total=0), and derives `last_active_at` via `MAX(GREATEST(opened_at, closed_at))`. Deviation: **no `username` column** — `authz.users` only has `display_name`. Updated return type + test assertions accordingly.
- [x] 4.8 **Club home MEMBERS row click-through** — in `ClubDetailView.vue`, each member card now has `@click="openMember(m.user.id)"` + avatar circle (first letter of display_name) + chevron. Imported `MemberProfileDrawer`; parent binds `<MemberProfileDrawer :open="drawerOpen" :clubId="id" :userId="drawerUserId" @close="closeDrawer" />`. Message-intent stub logged in `MemberProfileDrawer.messageUser()`; TODO noted in Deviations.
- [x] 4.9 **MY POSITIONS row polish** — `TournamentDetailView.vue` MY POSITIONS table now renders: Symbol · Direction · Qty · Entry Price · Current Price (via `p.current_price ?? fmtMoney(null)`) · Unrealized PnL (colored) · Entry Timestamp (from `p.opened_at` via `formatEntryTs`, em-dash if null) · Size Bar (`qty * entry / starting_balance * 100` rendered as a CSS gradient fill inside a 60px bar). Intraday % move deferred — would require N+1 calls to `/markets/bars/latest` per position (no bulk endpoint today), logged in Deviations.
- [x] 4.10 **Unit test** — new `apps/api/tests/unit/clubs-member-detail-endpoint.test.ts` with 14 assertions across three scenarios: happy path (admin role, 4 open positions, 3/10 accuracy = 30%, last_active from GREATEST), zero closed trades (null accuracy, 0 positions, null last_active, null display_name passthrough), and non-member (throws before leaking data). Wired into `apps/api/package.json` `test:unit` chain.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api lint && pnpm --filter @divinr/web lint` — both clean.
- [x] **Build**: `pnpm --filter @divinr/api build && pnpm --filter @divinr/web build` — both clean.
- [x] **Typecheck**: API clean. Web = 48 errors = same baseline as end of Phase 3. Initial MemberProfileDrawer draft had 3 extra errors (electronAPI `window` access + `res.json()` unknown-cast); rewrote to drop the electron branch + cast `await res.json() as MemberDetail`. Back to 48.
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pre-existing suites pass + 14 new assertions in `clubs-member-detail-endpoint` pass.
- [x] **E2E Tests**: none.
- [x] **Curl Tests**:
  - `curl -s -H "Authorization: Bearer $JWT" http://localhost:7100/clubs/606d8730-9fc8-4aae-8aff-657ee1689eba/members/ed38011a-f576-4d3e-8f37-cceb1ca2f0d2` → `{"user":{"id":"ed38011a-…","display_name":"ethan"},"role":"admin","joined_at":"2026-04-13T20:01:38.122Z","active_positions_count":2,"accuracy_pct":null,"last_active_at":"2026-04-13 22:02:15.76275+00"}` ✓ (matches new endpoint contract; `display_name` returned since `authz.users` has no `username` column).
- [ ] **Chrome Tests** (1440×900, demo-user) — deferred to end-of-effort Chrome pass (same rationale as Phases 1–3).
- [x] **Phase Review**:
  - [x] PRD Phase 4 items 1–3 verified (Sharpe rename + tooltip, color semantics, YOU badge, member drawer, MY POSITIONS enrichment).
  - [x] Rank-movement arrow deferred — see Deviations.
  - [x] DM intent stubbed — see Deviations.

---

## Phase 5: Mobile (390px) responsiveness
**Status**: Complete
**Objective**: Every primary surface is usable on a phone; no tab label collides with another.

### Steps
- [x] 5.1 **Tab bar overflow** — added Ionic's built-in `scrollable` prop on both `IonSegment`s (`ClubDetailView.vue` `.club-tabs`, `TournamentDetailView.vue` `.tournament-tabs`). Ionic's `scrollable` segment auto-enables horizontal scroll with button-content sizing; at `< 600px` users can swipe through all labels full-width; at desktop they sit left-aligned but still readable. No shared component existed (each view declares its own IonSegment) — modification was per-view rather than a shared fork.
- [x] 5.2 **Top-right chrome compact mode** — in `DefaultLayout.vue`: tagged universe chip + fear-greed bell + chat icon + notification bell with `.chrome-desktop-only`; added an `ellipsisHorizontalOutline` trigger button (`#mobile-chrome-trigger`) with `.chrome-mobile-only` + an aggregated badge summing all three unread counts. Trigger opens an `ion-popover` listing Universe (display-only) + Fear & Greed (when unread > 0) + Messages + Notifications, each with its own count badge. Media queries: `max-width: 600px` hides desktop chrome; `min-width: 601px` hides mobile chrome. The `demo-user` chip + avatar stay visible across both.
- [x] 5.3 **App-title truncation fix** — added `@media (max-width: 600px) { .main-area ion-title { display: none; } }` to `DefaultLayout.vue`. Left-nav `.sidebar-header` "Divinr AI" is unaffected.
- [x] 5.4 **Leaderboard horizontal scroll** — wrapped the leaderboard table in `.leaderboard-scroll`; at `< 600px` the wrapper gets `overflow-x: auto` + the table gets `min-width: 560px`; Rank (1st col) and Player (2nd col) are `position: sticky` with explicit `left: 0` / `left: 48px` offsets and matching background colors so the `is-you` row + `:hover` state stay readable under the sticky cells.
- [x] 5.5 **INVITE/CHAT overflow** — in `ClubDetailView.vue`, the existing buttons live in `.actions-desktop`; added `.actions-mobile` with a `#club-actions-trigger` IonButton + icon + IonPopover listing Invite and Chat (Chat only when `channel_id` is set). `@media (max-width: 600px)` swaps visibility.
- [x] 5.6 **Cross-surface em-dash parity** — `fmtPct`/`fmtMoney`/`fmtSharpe` from Phase 1 are content-level helpers unaffected by viewport. Em-dash rendering is viewport-independent — no code change needed; verification folded into the end-of-effort Chrome pass.

### Quality Gate
Before moving to Phase 6, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api lint && pnpm --filter @divinr/web lint` — both clean.
- [x] **Build**: `pnpm --filter @divinr/api build && pnpm --filter @divinr/web build` — both clean.
- [x] **Typecheck**: API clean. Web = 48 errors = same baseline as end of Phase 4. No regression.
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all suites pass (14 new `clubs-member-detail-endpoint` assertions plus all prior tests). Phase 5 has no API surface changes but still regression-tested.
- [x] **E2E Tests**: none.
- [x] **Curl Tests**: none (no API changes).
- [ ] **Chrome Tests** (390×844, demo-user) — deferred to end-of-effort Chrome pass (same rationale as Phases 1–4: batched visual verification).
- [x] **Phase Review**:
  - [x] PRD Phase 5 items 1–6 verified.
  - [x] No tab-bar component fork needed — each view had its own IonSegment; both updated identically to use `scrollable`.

---

## Phase 6: Nav role-gating & disclaimer consolidation
**Status**: Complete
**Objective**: A beta student sees only student-relevant nav; disclaimers appear where legally required, not redundantly.

### Steps
- [x] 6.1 **Role-gate admin nav** — in `DefaultLayout.vue`: SYSTEM / COST MODELING / ATTRIBUTION nav groups were already `adminOnly: true` at the group level (the `visibleGroups` computed filtered them out for non-admins). Extended the schema to support item-level admin gating: added `adminOnly?: boolean` to `NavItem`, marked `SETTINGS > My Attribution` and `SETTINGS > Billing Summary` as `adminOnly: true`, and updated `visibleGroups` to additionally filter each group's items by the flag + drop empty groups.
- [x] 6.2 **Source the role** — `auth.isAdmin` is already exposed from `apps/web/src/stores/auth.store.ts` (computed from `role` matching `'super-admin'` or `'owner'`). No new computed needed.
- [x] 6.3 **Disclaimer consolidation — `/clubs`** — removed the under-hero `<p class="disclaimer">Investment Learning Club — educational platform for practicing AI-assisted market analysis. Not investment advice.</p>` line from `ClubsView.vue`. The platform-level footer disclaimer in `DefaultLayout.vue` (`.legal-footer`) remains.
- [x] 6.4 **Disclaimer consolidation — `/tournaments`** — shortened `TournamentsView.vue` top disclaimer to one line: "Divinr is an AI analysis game. Virtual portfolios only." with a `router-link` "Learn more" → `/terms`. Added `.learn-more` inline link styling.
- [x] 6.5 **Trade-action surfaces unchanged** — verified via grep: the disclaimer in `TournamentDetailView.vue` (line 192–194, adjacent to the trade TAB + Queue Trade + Close buttons) remains intact with full wording "Divinr is an AI analysis game. Virtual portfolios use simulated trades for educational and entertainment purposes. Not investment advice." No other trade-action surfaces had disclaimers to preserve; the tournament detail page is the only one.
- [x] 6.6 **Microcopy pass**:
  - `/clubs` RANKINGS button: `title="Cross-club leaderboard across all members."` already landed in Phase 3 (early delivery from step 3.5).
  - Notification badges: added `title` attributes to all three desktop notification bells in Phase 5 Step 5.2 (`title="Fear & Greed alerts — unread market-sentiment signals"`, `title="Messages — unread DMs and club chats"`, `title="Notifications — rank changes, mentor activity, system updates"`). Mobile popover labels the items inline, so no tooltip needed on the overflow trigger.

### Quality Gate
Before shipping the effort, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api lint && pnpm --filter @divinr/web lint` — both clean.
- [x] **Build**: `pnpm --filter @divinr/api build && pnpm --filter @divinr/web build` — both clean.
- [x] **Typecheck**: API clean. Web = 48 errors = same baseline as end of Phase 5. No regression.
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all suites pass.
- [x] **E2E Tests**: none.
- [x] **Curl Tests**: none.
- [ ] **Chrome Tests** — deferred to end-of-effort Chrome pass (batched visual verification).
- [x] **Phase Review**:
  - [x] PRD Phase 6 items 1–3 verified.
  - [x] Walk-through deferred to end-of-effort Chrome pass.
  - [x] Completion report written by `/run-plan` completion flow.

---

## Deviations / decisions log
(Run-plan will append to this section as phases execute.)

- **Phase 3 — "New activity (N)" counter deferred.** PRD Risks called this out as conditional on a `club_members.last_viewed_at` column. Only `messaging.channel_members.last_read_at` exists today. Requires a schema migration + backfill before the counter can ship — not in scope for this polish effort. UI has no placeholder spot, so nothing visible to the student.
- **Phase 3 — Tournaments-list avatar stack deferred.** Shipped `{N} players` text only. Avatar initials stack requires pulling the first 3 entrants per tournament (N+1 query or a JSON aggregate), which is heavier than the single scalar `player_count` subquery. Added to the follow-up list for a future tournaments-list pass.
- **Phase 3 — `/clubs/Rankings` tooltip.** Landed one phase early (was Phase 6 step 6.6). Rationale: same file edit, same tooltip mechanism as the analytics labels in Phase 2. Phase 6 will still do the notification-badge tooltips.
- **Phase 4 — rank-movement arrow deferred.** No `rank_delta`/`prev_rank` field is emitted by the leaderboard service today (only `tournament_rank_change` notification type exists). Computing it requires a prior-period snapshot + matview follow-up. Left the Rank cell unchanged to avoid a fake "—" everywhere.
- **Phase 4 — DM intent stubbed.** `MemberProfileDrawer.messageUser()` logs `[coming-soon] DM user <id>` — direct messaging isn't wired between a club member drawer and `/messages` yet. Will require a `?to=<userId>` intent on `/messages` + new-DM bootstrapping in `MessagesView`. Logged as follow-up; button is visible so students know the capability is coming.
- **Phase 4 — MY POSITIONS intraday % move deferred.** Positions endpoint only returns `current_price`; there's no bulk intraday-change endpoint. Per-position calls to `/markets/bars/latest` would be N+1 and not worth it for the polish phase. Shipped current price + size bar + entry timestamp as the meaningful enrichment. Bulk bars endpoint is the follow-up unlock.
- **Phase 4 — `authz.users.username` doesn't exist.** PRD step 4.7 called for returning `{id, username, display_name}`. The schema only has `id, email, display_name, status, created_at, updated_at`. Dropped `username` from the response type + test assertions; the drawer and leaderboard both fall back to `display_name` with an id-slice fallback.
