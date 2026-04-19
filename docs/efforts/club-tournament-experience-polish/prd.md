# Club & Tournament Experience Polish — PRD

**Intention**: `./intention.md`
**Walkthrough**: `./walkthrough-observations.md`
**Created**: 2026-04-17

## Summary

A polish-and-tighten pass on the club + tournament surfaces the St. Thomas beta cohort lives in day-to-day. The architectural building blocks (clubs, tournaments, predictions, analysts, messaging) work; the *product experience around them* still reads as beta. This effort fixes the data bugs and broken flows uncovered in the walkthrough, then raises the visual and copy bar on every surface a student touches over a typical week.

**Scope discipline**: no new mechanics. Where a phase introduces a primitive (active-tournament banner, member profile click-through, countdown), it is a *hook* onto existing data — not a new feature.

**Success**: the intern and an honest friend walk through /clubs → club home → /tournaments → tournament detail and react with "this feels real," not "this feels like a beta." Every empty state has a deliberate CTA + explainer. Nothing in the path makes a student feel lost or encounter a data contradiction.

## Non-goals

- New tournament mechanics, club types, or .edu gating (covered by separate efforts).
- Billing / membership architecture (that's `user-billing-model`).
- Rewriting the messaging backend — only surface-level chat polish.
- Per-user opt-outs at club level are **deferred** until `user-billing-model` (intention flagged this as an open question; we want the opt-out model to match the billing tier design rather than ship it blind here).

## Constraints

- Legal language: always "analysis / signal", never "advice / recommendation". Disclaimers must remain on trade-action surfaces but should be consolidated where they currently double up.
- Ports stay: API 7100, web 7101.
- NestJS DI convention: every constructor param gets `@Inject(ClassName)`.
- Every quality gate includes lint, build, unit tests, curl (for API changes), and Chrome verification (for UI changes).

---

## Phase 1 — Critical bugs (data correctness + broken flows)

**Goal**: no student sees a wrong number, a blank page, or a contradictory control state.

### Scope
1. **DISCOVER click-through renders blank page.** Clicking a club from DISCOVER the user isn't a member of navigates to `/clubs/:id` but `<main>` is empty. Either:
   - Render a read-only "public preview" for non-members (club name, description, member count, tournament count, JOIN/REQUEST CTA), OR
   - Route non-members to a dedicated `/clubs/:id/preview` public page.
   - **Decision for this phase**: render the read-only preview in-place on `/clubs/:id` (simpler, no new route).
2. **Club Analytics "Tournaments: 0" while tournament exists.** Fix the aggregator scope so all tournaments attached to the club (any status) are counted. Include `upcoming`, `active`, and `completed`.
3. **Tournament TRADE tab contradicts MY POSITIONS.** MY POSITIONS shows open positions with CLOSE enabled on an `upcoming` tournament, but TRADE says "Trades can only be queued during active games." Decide: either the preexisting positions are intentional (seeded from portfolio snapshot at join) — in which case the TRADE copy is wrong — or they're a bug. Treat as a product decision; default: positions are intentional, TRADE copy updates to "Trading opens when the sprint starts on [date/time]. Your starting positions are shown in MY POSITIONS."
4. **Chat author shown as `ed38011a`** (user-id prefix). Resolve to username via the `users` table in the messages API response.
5. **Typography bug**: Dashboard "Your Clubs" list renders "St. Thomas Investing Club3 members" with no space. Add space + en-dash separator.
6. **Pluralization**: "1 tournaments" / "1 members" on club cards. Use a singular/plural helper.
7. **Leaderboard Sharpe value cross-surface inconsistency**: desktop shows `0.00`, mobile shows `-`. Standardize on em-dash for "no data yet", applied everywhere.
8. **Tournament detail tab-state visual bug**: active-underline sticks to INFO when TRADE is the active tab.

### Quality Gate
- Lint, build, unit tests all pass.
- Curl: `GET /clubs/:id` returns preview payload for non-members; `GET /clubs/:id/analytics` returns correct `tournaments_count`.
- Chrome: (a) click Test Learning Club from DISCOVER — preview renders; (b) Club Analytics shows Tournaments ≥ 1 for St. Thomas; (c) Tournament detail tab switches show correct underline; (d) Messages shows usernames; (e) Dashboard Your Clubs has correct spacing; (f) all "N members / N tournaments" lines handle 1 correctly.
- Phase Review: re-read intention "Success Criteria" → no data contradictions remain.

---

## Phase 2 — Empty-state and explainer pass

**Goal**: every empty state has a one-line explainer, a primary CTA, and a visual treatment that doesn't read as "broken."

### Scope
1. **Club home ACTIVITIES tab** — the worst empty-state case:
   - Each of Prediction Challenges / Consensus Polls / Strategy Journals gets a one-line explainer, a "Start your first..." CTA, and a small illustration or icon.
   - Reorder so the highest-engagement bucket is first (Prediction Challenges).
2. **Club home CURRICULUM** — add explainer ("A curriculum is a reading list or module plan your club owner pins. Members see new modules as they're added."), keep `CREATE CURRICULUM` CTA.
3. **Club home ANALYSTS** — add explainer distinguishing *club analysts* from *user analysts* and *base analysts*. Link to the right docs or help panel.
4. **Club home MENTORING**:
   - Disable REQUEST A MENTOR when ineligible; tooltip: "Unlocks after 2 completed tournaments."
   - Remove `Admin:` prefix from section headings; render those sections only when the viewer has an admin-eligible role in the club.
   - Hide Mentor Leaderboard when empty.
5. **Club Analytics** — replace `0%` with em-dash when there's no trade history; "Club Style: balanced" gets a tooltip explaining the heuristic; add a time-window toggle label even if the control defers to a later phase.
6. **Tournament TRADE empty state** — when `upcoming`, show countdown + "What can I do now?" list (Make predictions, Review analysts, Check watchlist).
7. **Tournament INFO tab** — add explicit timezone on Start/End ("9:30 AM ET / 6:30 AM PT"); make Scope link to the scoping club; add "Prize / win condition" row (copy-only for now: "Bragging rights + Sprint Champion badge").
8. **Dashboard** — "Your Clubs" and "Your Tournaments" sections get consistent card treatment with hover state + CTAs; the `upcoming` chip becomes a chip + start-date + roster count; affinity alert moves below the primary stats for new users.

### Quality Gate
- Lint, build, unit tests all pass.
- Chrome: every tab on club home shows explainer copy or CTA; no empty state renders as bare "No X yet."; Dashboard cards have hover state; tournament TRADE shows countdown + guidance when upcoming.
- Phase Review: intention "every screen has a deliberate empty state" → verify each of the 8 surfaces above.

---

## Phase 3 — Default landing & activity hooks

**Goal**: a student entering their club immediately sees *what's happening*, not a roster.

### Scope
1. **Default club-home tab: MEMBERS → ACTIVITIES.** Update route param default + redirect any `/clubs/:id` with no tab to `/clubs/:id/activities`.
2. **Active-tournament banner on club home**: when one or more tournaments scoped to this club have status `upcoming` or `active`, render a persistent hero above the tabs: tournament name, status chip, countdown (or "Live now"), entry CTA. Clicking navigates to tournament detail.
3. **Tournaments list card polish** (already the best surface in the flow; small additions):
   - Countdown line for `upcoming` ("Starts in 2d 18h").
   - Roster preview (avatar stack + "3 players").
   - Prize / win-condition line (mirrors Phase 2 INFO tab copy).
4. **Clubs list (MY CLUBS)**:
   - Card shows description (per-club if available, falls back to platform default), active-tournament banner if any, "New activity (N)" count if unread predictions/journals/polls since last visit.
   - Header copy: "Investment Learning Clubs" → "Clubs I'm in" (MY CLUBS tab is about ownership, DISCOVER is about browsing).

### Quality Gate
- Lint, build, unit tests all pass.
- Curl: `GET /clubs/:id?tab=` unspecified → ACTIVITIES payload; `GET /tournaments?club_id=X&status=upcoming|active` powers the banner.
- Chrome: land on /clubs/:id → ACTIVITIES is default; banner visible when St. Thomas Weekly Sprint #1 is attached; clicking banner navigates; MY CLUBS cards render description + activity count.
- Phase Review: intention "a student in two clubs + one tournament shouldn't have to keep the sprint in a separate mental tab" → banner satisfies this.

---

## Phase 4 — Leaderboard storytelling & member click-through

**Goal**: the leaderboard tells a story; member cards are entry points, not dead text.

### Scope
1. **Tournament leaderboard**:
   - Rename `Sharpe Ratio` column → `Risk-Adjusted Return` with tooltip ("Return per unit of volatility. Higher is better. Appears once the sprint has data.").
   - Use neutral grey for 0% values; reserve green for positive returns, red for negative.
   - Add "YOU" badge on the viewer's row.
   - Rank cell shows rank-movement arrow when sprint is `active` (↑1, ↓2, —).
   - Row click → member profile drawer or `/clubs/:club_id/members/:user_id`.
2. **Member click-through on club home MEMBERS**:
   - Click a member row → drawer (or full page at `/clubs/:club_id/members/:user_id`) showing: username, role, joined date, active positions count, accuracy %, last-active timestamp, per-member predictions link.
   - Add avatar (initial placeholder if no photo) to member row.
   - Add "Message" and "View portfolio" quick-actions on the row.
3. **Tournament MY POSITIONS row polish**:
   - Add current price + intraday % move (read from existing intraday bars; no new backend).
   - Add entry date/time column.
   - Show position-size-bar visualization relative to virtual balance.

### Quality Gate
- Lint, build, unit tests all pass.
- Curl: new `GET /clubs/:club_id/members/:user_id` endpoint returns expected shape.
- Chrome: leaderboard colors are correct for 0%/+/−; YOU badge visible; rank arrow visible on `active` tournaments (simulate via env override if needed); clicking a member drawer loads; MY POSITIONS shows current price + entry time.
- Phase Review: intention "nothing makes a student feel lost about what they're looking at" → Sharpe tooltip + member drawer address the two most opaque surfaces.

---

## Phase 5 — Mobile (390px) responsiveness

**Goal**: every primary surface is usable on a phone; no tab is indistinguishable from its neighbor.

### Scope
1. **Tab bar overflow treatment**: club home + tournament detail tabs render with horizontal scroll + fade-edge affordance at widths < 600px. No tab label truncates to < 7 chars.
2. **Top-right chrome compact mode**: at widths < 600px, stocks world selector, 5-badge, chat icon, and notifications collapse into a single "⋯" overflow; demo-user dropdown keeps visible.
3. **App-title truncation fix**: hide the "Divinr AI" title in the content panel at < 600px (already visible in side nav + logo mark).
4. **Leaderboard horizontal scroll**: at < 600px, table wraps in a scrollable container with sticky Rank + Player columns.
5. **Club-home INVITE/CHAT**: at < 600px, collapse into a single overflow "⋯" menu.
6. **Cross-surface Sharpe/etc. consistency**: ensure em-dash treatment applies identically at mobile and desktop (caught in Phase 1).

### Quality Gate
- Lint, build, unit tests all pass.
- Chrome: resize to 390px → (a) club-home tab bar shows full labels via horizontal scroll; (b) tournament leaderboard shows horizontal scroll; (c) top chrome compact mode; (d) INVITE/CHAT in overflow menu.
- Phase Review: intention "mobile responsiveness on the screens students actually use" → covered for club home + tournament detail + leaderboard; messaging responsiveness tracked in a follow-up issue if rough.

---

## Phase 6 — Nav role-gating & disclaimer consolidation

**Goal**: a beta student sees only student-relevant nav; disclaimers appear where they legally must, not redundantly.

### Scope
1. **Role-gate admin nav groups**: SYSTEM, COST MODELING, ATTRIBUTION sections (plus SETTINGS > Billing Summary, My Attribution) render only when the user has `admin` or `superadmin` role. Demo-user remains admin so internal dogfooding is unaffected; ethan/golfergeek-as-student-role see a simpler nav.
2. **Disclaimer consolidation**:
   - `/clubs` page: remove the under-hero "Not investment advice" duplicate; keep the footer disclaimer only.
   - `/tournaments` page: shorten the top disclaimer to one line with "learn more" link.
   - Trade-action surfaces (TRADE tab, CLOSE button): keep full disclaimer adjacent to the action (legal requirement).
3. **Microcopy pass**:
   - `/clubs` RANKINGS button → add subtitle/tooltip: "Cross-club leaderboard across all members."
   - `/clubs` page header: "Investment Learning Clubs" → "Clubs".
   - Notification/finding badges: clickable with tooltip on hover; "5" and "9+" should explain what they count.

### Quality Gate
- Lint, build, unit tests all pass.
- Chrome: log in as a non-admin user (ethan) → nav shows only student-relevant sections; demo-user retains full nav.
- Phase Review: intention "this feels real, not beta" → nav density and disclaimer doubling were two of the loudest beta tells.

---

## Risks / open questions to resolve during implementation

- **Position seeding on `upcoming` tournaments**: confirm with the backend that the MSFT/AAPL positions on St. Thomas Weekly Sprint #1 are seeded from a strategy snapshot and not a data leak. If seeded, Phase 1 copy fix is enough; if leak, treat as higher priority.
- **"New activity (N)" count** (Phase 3): needs a `last_viewed_at` per user per club in the DB. If the column doesn't exist, defer this single feature to a follow-up and ship the rest of Phase 3.
- **Rank-movement arrow** (Phase 4): needs historical rank snapshots. If the matview doesn't already emit them, stub the column and return `—`; ship the storytelling without the arrow.
- **Mentor role in club**: Phase 2 asks for admin-only MENTORING admin sections. Confirm the role enum has an `admin`/`owner` distinction at club level.

## Tracking

- All phases ship as separate small-blast-radius PRs off `effort/club-tournament-experience-polish`.
- Each PR includes a GIF walkthrough of the before/after for the surfaces it touched (captured via Claude-in-Chrome gif_creator).
- Progress is tracked in `./plan.md` (produced next by `/build-plan`).
