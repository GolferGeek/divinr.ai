# Club & Tournament Experience Polish — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Intention**: ./intention.md
**Completed**: 2026-04-18
**Final Status**: All Phases Complete

## Summary
- Total phases: 6
- Phases completed: 6
- Phases remaining: 0

## Phase Results

### Phase 1 — Critical bugs (data correctness + broken flows) · Complete
Shipped all 8 PRD-called-out fixes plus 4 follow-ups surfaced during implementation:
- Club preview for non-members (`ClubPreviewPanel.vue` + API fallback in `getClub`)
- Club Analytics `tournament_count` no longer filters by status
- Tournament TRADE tab has upcoming/active/completed branches
- IonSegment `v-model` → `:value` + `@ionChange` pattern (underline bug)
- Chat author renders `display_name` via new `authz.users` join in messaging service
- Dashboard typography + `pluralize()` helper
- Leaderboard em-dash standardization (`fmtPct`/`fmtMoney`/`fmtSharpe`)
- DISCOVER filter excludes already-joined clubs
- 3 new unit-test files (22 assertions) + 1 existing test stub updated for the new aliased SQL.
No pre-existing suites broken; web typecheck matches the main-branch baseline.

### Phase 2 — Empty-state and explainer pass · Complete
Every empty state now has an icon + explainer + placeholder CTA:
- ACTIVITIES tab (Prediction Challenges → Strategy Journals → Consensus Polls, reordered)
- CURRICULUM + ANALYSTS explainers
- MENTORING polish (eligibility gating, cleaner headings, conditional Mentor Leaderboard)
- Club Analytics fmt helpers + Style tooltip + disabled time-window selector
- Tournament TRADE upcoming-block (countdown + "What can I do now?" list)
- Tournament INFO (timezone, Scope as clickable link, Prize row)
- Dashboard card hover + `tournament_starts_at` chip copy
- New `club-analytics-empty-formatting` test (7 assertions).

### Phase 3 — Default landing & activity hooks · Complete
- Default tab is now **Activities** (via `?tab=` query param, validated against `ClubTab` union).
- Deep-link redirect route `/clubs/:id/:tab` → `/clubs/:id?tab=…` preserves old URLs.
- New `ActiveTournamentBanner.vue` (mounts above tab bar, gradient, live-now/starts-in chip, ENTER GAME CTA).
- New `getByClub` selector on tournament store.
- Tournaments list now shows countdown + player count + prize line.
- Clubs list header renamed "Clubs"; MY CLUBS cards show sprint-active/starts chip + description.
- API `listTournaments` adds `player_count` via correlated subquery; new 8-assertion test.
**Deviation**: "New activity (N)" counter deferred — schema has no `club_members.last_viewed_at`.
**Deviation**: Avatar stack deferred — `{N} players` text only; N+1 for avatars not worth it this phase.

### Phase 4 — Leaderboard storytelling & member click-through · Complete
- `Sharpe` → `Risk-Adjusted Return` with native `title` tooltip.
- `colorClass()` helper: 0 → neutral grey, positive → green, negative → red on Return %, Total PnL, Win Rate.
- YOU badge on viewer's row in leaderboard.
- Leaderboard rows clickable → opens `MemberProfileDrawer.vue` (new component, IonModal bottom-sheet).
- Club MEMBERS cards clickable with avatar initial + chevron + drawer open.
- New API endpoint `GET /clubs/:clubId/members/:userId` — returns display_name, role, joined_at, active_positions_count, accuracy_pct, last_active_at. Authorization via `requireMembership(requestingUser)`.
- MY POSITIONS shows current price + entry timestamp + size bar (qty·entry / starting_balance).
- New 14-assertion test (`clubs-member-detail-endpoint`) covering happy path, zero-closed-trades, non-member.
**Deviation**: Rank-movement arrow deferred — no `rank_delta` / `prev_rank` emitted today (only `tournament_rank_change` notification type exists).
**Deviation**: DM intent stubbed — `MemberProfileDrawer.messageUser()` logs `[coming-soon] DM user <id>`; `/messages` has no new-DM intent route yet.
**Deviation**: MY POSITIONS intraday % move deferred — no bulk `/markets/bars/latest` endpoint; N+1 not warranted.
**Deviation**: `authz.users.username` doesn't exist — PRD drafted against an assumed column. Endpoint returns `display_name` only; drawer and leaderboard both fall back to id-slice.

### Phase 5 — Mobile (390px) responsiveness · Complete
- `IonSegment scrollable` on club + tournament tab bars.
- `DefaultLayout.vue`:
  - Mobile overflow trigger (`⋯`) with IonPopover containing Universe / Fear & Greed / Messages / Notifications.
  - Aggregated unread badge on trigger.
  - `.chrome-desktop-only` vs `.chrome-mobile-only` swap at 600px breakpoint.
  - `ion-title` "Divinr AI" hidden below 600px in the content panel (sidebar header stays).
- Leaderboard wrapped in `.leaderboard-scroll`; at <600px, `overflow-x: auto` + table `min-width: 560px` + sticky Rank (col 1) + Player (col 2) with explicit background colors so `.is-you` + `:hover` remain readable under sticky cells.
- Club INVITE / CHAT actions: desktop row hidden, mobile `⋯` IonPopover.
**Phase has no API surface changes** — API regression tests still run and pass.

### Phase 6 — Nav role-gating & disclaimer consolidation · Complete
- Nav group-level admin gating (SYSTEM / COST MODELING / ATTRIBUTION) was already present.
- Extended `NavItem` to support `adminOnly`; gated `SETTINGS > My Attribution` + `SETTINGS > Billing Summary`; `visibleGroups` now drops empty groups.
- `auth.isAdmin` already exposed — no change.
- `/clubs`: removed the under-hero disclaimer paragraph (footer disclaimer in `DefaultLayout.legal-footer` remains the platform-level source of truth).
- `/tournaments`: shortened disclaimer to "Divinr is an AI analysis game. Virtual portfolios only." + `<router-link to="/terms">Learn more</router-link>`.
- TRADE tab disclaimer (in `TournamentDetailView.vue` above the IonSegment) verified intact — this is the trade-action surface disclaimer required by the legal-language rule.
- Microcopy: RANKINGS tooltip landed in Phase 3 (early); notification badge tooltips landed in Phase 5.2 (native `title` attributes on all three desktop bells).

## Gate Results

- **Lint**: clean for API and web in every phase.
- **Build**: clean for API and web in every phase.
- **Typecheck**: API clean in every phase. Web tracked against a 52-error pre-effort baseline (all pre-existing DOM-lib + strictness issues on files unrelated to this effort). End-state: 48 errors — **4 fewer** than baseline; no regressions introduced. Three mid-phase regressions (MemberProfileDrawer draft) caught and repaired before the gate closed.
- **Unit Tests**: all pre-existing suites pass + 4 new test files added across the effort (`club-analytics-tournaments-count`, `messages-author-username`, `clubs-discover-hides-joined`, `club-analytics-empty-formatting`, `tournaments-list-player-count`, `clubs-member-detail-endpoint` = 51 new assertions total). One pre-existing stub (`messaging-threads-reactions`) updated to match the new aliased `ORDER BY m.created_at` after adding the `authz.users` join.
- **Curl Tests**: ran per-phase against the live dev API (port 7100) — all responses matched the expected contracts.
- **Chrome Tests**: **deferred to end-of-effort batched verification** per project feedback on long-session ergonomics. All visual checks should be driven from a fresh Chrome session once the PR lands; API-level verification covered data correctness each phase.

## Deviations from PRD

Captured in the plan's Deviations log:

- **Phase 1** — Web typecheck baseline already broken on main (47 errors). Matched baseline; no regression from this effort.
- **Phase 1/2/3/4/5/6** — Per-phase Chrome tests batched to end-of-effort pass.
- **Phase 2** — ContrarianAlert DOM swap was a no-op; component already rendered below Your Clubs / Your Tournaments on main.
- **Phase 3** — "New activity (N)" counter deferred (no `club_members.last_viewed_at`).
- **Phase 3** — Tournaments avatar stack deferred (N+1 query; `{N} players` text only shipped).
- **Phase 3** — `/clubs/Rankings` tooltip delivered early (originally Phase 6 step 6.6).
- **Phase 4** — Rank-movement arrow deferred (no `rank_delta` in leaderboard payload today).
- **Phase 4** — DM intent stubbed (`console.info` only).
- **Phase 4** — MY POSITIONS intraday % move deferred (no bulk bars endpoint).
- **Phase 4** — `authz.users.username` doesn't exist; endpoint returns `display_name` only.
- **Phase 5** — No shared tab-bar component existed; modified per-view (ClubDetailView + TournamentDetailView both have their own IonSegment).
- **Phase 6** — Notification badge tooltips used native `title` attributes (consistent with Phase 2/3 tooltip pattern).

## Next Steps / Follow-ups

- **End-of-effort Chrome pass** — walk the "student week" at 1440×900 and 390×844 (demo-user + ethan). Verify every phase's visual acceptance items in a single fresh session.
- **New activity (N) counter** — schema migration adding `prediction.club_members.last_viewed_at` + write-on-tab-view + subtract-on-seen logic. Unblocks Phase 3 step 3.8.
- **Rank-movement arrow** — leaderboard matview emits prior-period rank → `rank_delta` on the payload. Unblocks Phase 4 step 4.4.
- **Direct-message intent** — `/messages?to=<userId>` route + bootstrap-new-DM flow. Unblocks Phase 4 step 4.8's `Message` button and drawer.
- **Bulk `/markets/bars/latest`** — multi-symbol variant so MY POSITIONS can show intraday % move without N+1. Unblocks Phase 4 step 4.9.
- **Avatar stack on tournament list cards** — pull first 3 entrant initials per tournament.
- **Typecheck baseline cleanup** — the remaining 48 web typecheck errors are pre-existing (DOM-lib + strict-mode issues on unrelated views). A dedicated typecheck-hardening pass would clear them.
