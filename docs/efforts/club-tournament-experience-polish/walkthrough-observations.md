# Club & Tournament Surface Walkthrough — Raw Observations

**Captured**: 2026-04-17 (Claude Chrome walkthrough as `demo-user`)
**Viewport**: 1440x900 desktop unless noted
**Status**: Draft — to be reviewed by user and cross-checked with intern before PRD

This is a deliberate pass through every club + tournament surface, noting anything a student-club user would flag as beta-feeling, confusing, or missing. Observations are intentionally sharp; many will turn out to be non-issues or already-planned fixes.

---

## S1 — Clubs list (`/clubs`)

**Tabs**: MY CLUBS (default), DISCOVER.

### Observations
- Each club card shows: name, role chip ("owner"), member count. Nothing else — no description, no last-activity, no active-tournament banner, no avatar/icon.
- Tall empty cards waste vertical space; five cards would push the fold on laptop viewports.
- No "New activity (N)" or "Sprint active" indicator to pull a student in; student has to click each to discover.
- No search / filter / sort controls — fine for 2 clubs, painful at 20.
- "RANKINGS" top-right button: unclear semantic to a student (cross-club? within-club? alphabetical?). Needs a subtitle or microcopy.
- Empty-state (student not yet in any club) unchecked here — would need to log out and sign up fresh to see it.
- DISCOVER tab: haven't opened yet — flagged for a pass.
- Page header "Investment Learning Clubs" reads like an index-page label, not a room the student has entered. Consider "My clubs" / "Clubs I'm in".
- Legal language ("Not investment advice") appears both under the hero AND as a footer — redundant on a page that needs breathing room.

---

## S2 — Club home (`/clubs/:id`)

**Default tab**: MEMBERS.
**Tabs**: MEMBERS, ANALYSTS, ACTIVITIES, ANALYTICS, CURRICULUM, MENTORING.
**Top-right actions**: INVITE, CHAT.

### Observations
- **Defaulting to MEMBERS is wrong.** A student arriving in their club wants to see *what's happening* — recent trades, predictions, activity, a tournament banner. A dry roster is the least engaging tab. ACTIVITIES should be the default landing view.
- Member cards: name + role chip only. No avatar, no portfolio/accuracy snapshot, no "last active", no affinity/mentor-pair indicator, no journal preview. Click-through behavior unclear (see S5).
- **No active-tournament banner.** The St. Thomas Weekly Sprint #1 is tied to this club but nothing on the club home surfaces it. A student in two clubs + one tournament has to keep the sprint in a separate mental tab.
- Club description is generic boilerplate: *"Investment Learning Club — educational platform for practicing AI-assisted market analysis. Not investment advice."* Every club has the same blurb. Per-club description / mission statement would make each club feel owned.
- Club code (`J5M36WG2`) is exposed in plain text with a COPY button — good. But no "share invite link" (copy-URL) CTA for the more common flow of texting a friend.
- **6 tabs is a lot.** For a student club: MEMBERS, ANALYSTS, ACTIVITIES, ANALYTICS, CURRICULUM, MENTORING. ANALYSTS + MENTORING might overlap with features that aren't part of the student-club value prop. Consider hiding advanced tabs behind a "More" menu until they're actually used.
- INVITE and CHAT buttons are low-visual-weight outline buttons floating alone top-right. Club home should have a more deliberate hero area (name, avatar, description, pinned tournament banner, primary action).
- No banner / hero image for the club. A student club probably wants a school logo, a custom color, or at least a school-color accent.

---

## S3 — Club home → ACTIVITIES tab

Three stacked empty sections:
- **Prediction Challenges** — "No challenges yet."
- **Consensus Polls** — "No polls yet."
- **Strategy Journals** — "No journal entries yet."

### Observations
- **This is the worst empty-state case in the product.** A new member lands here and sees three "nothing here" messages stacked vertically. It reads like the product is broken or abandoned.
- No CTA anywhere: no "Start a challenge", "Post your first poll", "Share a journal entry".
- No explanation of what each activity *is*: a student doesn't know a "Prediction Challenge" from a "Consensus Poll". Need one-liner explainers with a tiny illustration.
- No example/template activities to lower the activation cost.
- **Missing the most natural "activity":** a live feed of member predictions, trades, affinity signals. The three existing buckets are curated, intentional artifacts — students want the organic stream too.
- Three headings `Prediction Challenges` / `Consensus Polls` / `Strategy Journals` all in the same visual weight — no indication of which should be the student's entry point.

---

## S4 — Club home → ANALYTICS tab

Four cards: Win Rate (0%), Avg Return (0%), Club Style (balanced), Tournaments (0).

### Observations
- **Data bug: "Tournaments: 0" while St. Thomas Weekly Sprint #1 is attached to this club.** Either the analytics aggregator excludes `upcoming` status or the query isn't scoped correctly. Student-facing this looks broken.
- "Win Rate: 0%" and "Avg Return: 0%" on a club with no completed trades are misleading — these should be em-dashes, "No trades yet", or a ghosted placeholder. Zero feels like bad performance, not missing data.
- "Club Style: balanced" has no explanation — what does balanced mean, how is it computed, how does it change? No tooltip, no drill-down.
- Only four KPIs on an otherwise empty page. Feels like a stub, not a dashboard. Could add: equity curve, member leaderboard (top contributor this week), weekly activity trend, streak/engagement count.
- No time-window toggle (this week / this month / all time).
- All four cards are the same size regardless of importance.

---

## S5 — Tournaments list (`/tournaments`)

**Filters**: All Scopes, All Statuses. **Top-right action**: CREATE TOURNAMENT.
**Visible tournament**: St. Thomas Weekly Sprint #1 (upcoming / Weekly Sprint / club / Apr 20 – Apr 27, 2026 / $100,000 / ENTER GAME).

### Observations
- **Card is the best-designed surface in the club+tournament flow** — chips for status/type/scope, description, virtual balance, date range, clear primary CTA. This is the template to pull the club list toward.
- "ENTER GAME" microcopy works for students — game language over trading jargon.
- **No countdown** ("Starts in 2d 18h") — students love anticipation. `upcoming` chip says *status* but not *when*.
- **No roster preview** on the card — no "3 players" or avatar stack. Students want to see "who's in" before committing.
- **No prize / win-condition text** — student doesn't know what winning means. Bragging rights? Points? A badge on their profile?
- "Divinr is an AI analysis game. Virtual portfolios use simulated trades for educational and entertainment purposes. Not investment advice." appears at the top of the tournaments page but is wordy — consider a one-liner with a "learn more" link.
- Dates shown as "Apr 20, 2026 - Apr 27, 2026" — no timezone. A student in another timezone wouldn't know when the sprint actually starts (9:30 AM ET open? midnight UTC?).
- Filter controls are fine but overkill for a 1-tournament dataset; consider hiding filters until N > 5.
- Below the card is large empty whitespace. Could show "Past tournaments" and "Sample / demo tournaments" to let a student peek at what a completed sprint looks like.
- No "Tournaments your club is hosting" vs "Open tournaments you could join" distinction.

---

## S6 — Tournament detail (`/tournaments/:id`)

**Tournament**: St. Thomas Weekly Sprint #1 (status: upcoming, type: Weekly Sprint, scope: club).
**Tabs**: LEADERBOARD (default), MY POSITIONS, TRADE, INFO.

### S6a — LEADERBOARD tab (default)

- Three players listed (demo-user, ethan, golfergeek) all at 0.00% / 0.00% / Sharpe 0.00.
- **Sharpe Ratio column is too technical.** A student doesn't know what Sharpe is. Either explain it (tooltip), rename it (Risk-Adjusted Return), or hide it until the sprint is active and has enough data.
- **Zero-storytelling**: the leaderboard reads like a database row dump. No rank movement, no hot-streak indicator, no per-player sparkline, no "best pick this week". For a weekly sprint this should feel like a scoreboard, not a report.
- **Green color on 0% returns is a semantic bug.** Green should mean positive; neutral/grey is appropriate when there's no data.
- No "you" badge — student may not know which row is theirs if their name blends with classmates' real names.
- No link from a leaderboard row to that member's portfolio / predictions / journal. Feels like names in a list instead of entry points into a narrative.

### S6b — MY POSITIONS tab

- Two positions listed: `MSFT long Qty:30 Entry:$370.87 PnL:$0.00`, `AAPL long Qty:50 Entry:$260.48 PnL:$0.00`. CLOSE button on each.
- **Contradiction with TRADE tab copy.** The TRADE tab says "Trades can only be queued during active games" but MY POSITIONS shows open positions with CLOSE enabled on an `upcoming` tournament. Either the TRADE copy is wrong (positions can exist pre-start) or the CLOSE buttons are a bug that could let a student close a position before the sprint begins. Needs a product decision plus a copy fix.
- Row layout is dense one-line: `MSFT long Qty:30 Entry:$370.87 PnL:$0.00 [CLOSE]`. No current price, no % move, no bar visualization, no entry date/time, no source (did the student trade this, or was it seeded by an analyst?). Reads like a REST payload rendered as HTML.
- No "Total virtual balance used", no "Cash remaining", no "Day P&L vs. Total P&L" split.
- No filter / sort (by symbol, by P&L, by size).
- No export / copy-to-clipboard.

### S6c — TRADE tab

- Single-line empty-state: "Trades can only be queued during active games."
- **No countdown** ("Active in 2d 18h"), no action ("Remind me when it opens", "Add to calendar"), no explainer ("What can I do right now? Make predictions, draft a watchlist, check analyst recs").
- **Visual tab-state bug**: when TRADE was the active tab, the underline indicator remained on INFO. Active-tab styling is inconsistent across the four tabs.

### S6d — INFO tab

- Shows: Virtual Balance $100,000; Start 4/20/2026 4:30:00 AM; End 4/27/2026 11:00:00 AM; Scope "club".
- **Timezone missing.** "4/20/2026 4:30:00 AM" is ambiguous — that's 9:30 ET converted to user's local TZ without a label, which is the worst of both worlds. Needs explicit TZ ("9:30 AM ET / 5:30 AM PT") or user-preference toggle.
- **"Scope: club" doesn't link to the club.** A student should be able to click "club" and land on St. Thomas Investing Club's page. Right now it's a dead string.
- No prize / win condition, no rules summary, no contact/owner, no "who's playing" roster, no entry fee or gating info.
- No "edit tournament" entry point for the owner (or at minimum a note: "You are the owner — manage at /tournaments/:id/settings").

---

## S13 — Mobile (390px) responsiveness

Reloaded `/clubs/:id` and `/tournaments/:id` at 390×844 (iPhone 12 class).

### Observations
- **Tab bar truncation is the worst mobile defect.** On club home, tabs render as `..` `ANAL...` `ACTI...` `ANAL...` `CURR...` `M...` — critically, `ANALYSTS` and `ANALYTICS` both render as "ANAL..." side-by-side, making them indistinguishable. The tab bar needs horizontal scroll with visible affordance OR icons + labels OR collapse into a select/drawer.
- Tournament detail tabs at mobile: `LEADER...` `MY POS...` `TRADE` `INFO`. Less severe but still user-unfriendly.
- **App/page title truncated to "D..."** in the top-center of the content panel. That chrome region should hide or defer the "Divinr AI" label at mobile widths.
- **Top-right chrome is overstuffed.** Stocks world selector + 5-badge + chat icon + 9+ notification badge + "demo-user" dropdown = ~85% of viewport width. No room for a useful page context or action.
- **Cross-surface data inconsistency at mobile.** Tournament leaderboard Sharpe column shows `-` (em-dash) at mobile width but `0.00` at desktop. Both surfaces render the same data — the value should be the same regardless of viewport.
- Green-on-0% color persists at mobile.
- Leaderboard table doesn't overflow at 390px *yet* because values are small — with real P&L values ("$-1,234.56", "-12.5%") this will overflow. Needs horizontal scroll or responsive column collapse.
- Member cards stack cleanly at mobile — OK there.
- INVITE and CHAT buttons take up a full row on mobile with lots of whitespace — they should collapse into a single icon-plus-dropdown or move into the overflow menu.
- No bottom-nav / app-shell treatment for mobile. The left-nav's hamburger works but the experience isn't mobile-native.
- Tested clubs list + tournament detail — did NOT test mobile club home ACTIVITIES (would likely still feel empty), MY POSITIONS (would squeeze badly with real data), or Messages.

---

## S8 — Messaging / chat (`/messages/:id` via club-home CHAT)

Clicking CHAT on the club home navigates to `/messages/0d776d4f-...` — a two-pane messaging view with St. Thomas pre-selected in the left rail.

### Observations
- **Author displayed as `ed38011a` (user-id prefix, not a username).** Brutal for students: "who is ed38011a?" is not something a classmate should be decoding. Missing the users→username display-name lookup.
- Message timestamp shown as relative "Wed" with no absolute date tooltip — a student can't tell if "Wed" is this week or last week.
- **Data inconsistency: messaging sidebar shows "Test University Club"**, but `/clubs` DISCOVER shows "Test Learning Club". Either the test data is inconsistent or the join/leave state is out of sync across the two surfaces.
- **No DM / 1-on-1 messaging.** Left rail only shows CLUBS header with group threads. Students who want to PM a classmate (or a mentor) have no affordance.
- Composer: paperclip (attachment) + plain text input + send icon. No rich formatting, no @-mention, no emoji, no "share a prediction" / "share a position" inline widgets — all the obvious social-media-style affordances are missing.
- No presence indicator (who's online, who's typing).
- No unread count on the left rail list items — you can't tell which clubs have new messages.
- No pinned messages, no announcement distinction, no per-room description or welcome message.
- No tournament-scoped sub-thread — all club chat is a single flat room; there's no "weekly sprint chat".
- **Notification gap:** the Messages icon on the top-right chrome doesn't show an unread count, but the red "9+" badge elsewhere suggests some notification pipeline exists. Inconsistent.

---

## S9 — Member card click-through

Tested by clicking the member name `ethan` on the MEMBERS tab of St. Thomas Investing Club.

### Observations
- **Member cards are inert.** Clicking the name does nothing — no navigation, no modal, no hover-state cursor, no context menu. Students cannot click through to a peer's profile, portfolio, or prediction history.
- No avatar / headshot on the row — just `name` + `role chip` (owner/admin/member).
- No secondary data on the row: no "last active", no accuracy %, no tournament PnL, no affinity indicator.
- No actions per row: no "Message", no "View portfolio", no "Challenge to a sprint", no "Remove from club" (for owners).
- No counts / summary strip (e.g., "3 members · 2 admins · last joined 2 days ago").
- Member sort order appears to be fixed (owner first?) — no toggle.

---

## S10 — Remaining club-home tabs (CURRICULUM / MENTORING / ANALYSTS)

### S10a — CURRICULUM tab
- Empty state: "No curricula yet." with a `CREATE CURRICULUM` primary button. Better than ACTIVITIES (has a CTA) but no explainer.
- No tooltip / subtitle defining what a curriculum is (a reading list? a set of modules? a weekly assignment schedule?). A student-club owner will guess wrong about what this tab is for.
- No sample/template curriculum to bootstrap ("Start with: Intro to fundamental analysis — 4 weeks").
- No permission indicator (owner-only? admins? members with "mentor" role?).

### S10b — MENTORING tab
- Top shows: **"Not yet eligible: Need at least 2 completed tournaments (have 0)"** next to a `REQUEST A MENTOR` button — these two contradict each other. Either the button should be disabled with a tooltip, or the copy should say "Unlock mentors after 2 completed tournaments" and the button should be removed.
- Sections literally titled **"Admin: Mentor Applications"** and **"Admin: Mentee Requests"** — the word "Admin:" in the heading is a bad info architecture smell. Role-scoped sections should be a different tab or a collapsible panel, not labels that expose internal role names in the UI.
- Each admin section has a `REFRESH` action — shouldn't need manual refresh on a normal usage pattern.
- Mentor Leaderboard header with "No mentors yet" underneath — why does an empty-state league table need to render as a heading at all? Hide the section until populated.
- The existence of mentoring on every club is a question for the PRD: for student clubs, is peer-to-peer mentoring really a feature or is it noise? Could be collapsed behind a "More" menu.

### S10c — ANALYSTS tab
- Empty state: "No club analysts yet." with `CREATE ANALYST` button.
- **No conceptual clarity.** The left-nav already has `AI ANALYSTS > Analysts`. A new user has no mental model for how *club* analysts differ from the ones in the main nav. Are these shared among club members? Does creating a club analyst consume a user quota?
- No explainer of why you'd create a club analyst (vs. using one of the base analysts shared across the platform).
- No sample/template (e.g., "St. Thomas Value Analyst — trained on the professor's reading list").

---

## S11 — DISCOVER tab (`/clubs` → DISCOVER)

Two clubs listed: St. Thomas Investing Club (3 members · 1 tournaments), Test Learning Club (1 members · 0 tournaments).

### Observations
- **CRITICAL BUG — blank page on click-through.** Clicking "Test Learning Club" (a club the user is not in) navigates to `/clubs/:id` but `<main>` renders with zero HTML content. The URL changes, the nav shell + footer render, but the club home component fails entirely. The whole DISCOVER flow is broken — a student cannot explore clubs they're not in.
- **DISCOVER shows clubs the user is already in.** St. Thomas Investing Club appears in both MY CLUBS and DISCOVER. DISCOVER should scope to clubs the user is *not* a member of.
- **Grammar bug: "1 tournaments", "1 members".** Singular/plural not handled — reads as sloppy.
- **Staging/test data leaking.** "Test Learning Club" is clearly seed data. Either filter test-named clubs from DISCOVER or rename it for the beta cohort.
- **No JOIN / REQUEST TO JOIN button.** Even if the click-through worked, there's no action primitive for discovery → membership. Students would have to ask for a code out-of-band.
- No club description visible on the card — just name + count. A student can't tell what "Test Learning Club" is about.
- No school / affiliation tag, no join-gating indicator (open / invite-only / instructor-moderated).
- No search / filter / sort — same issue as MY CLUBS, but arguably more painful here since DISCOVER will grow faster than MY CLUBS.
- **Left-nav leaks admin surfaces to demo-user.** At 1440x900, the nav shows: SYSTEM (Runs, Sources, Evaluations, Learning, Proposals, LLM Usage), COST MODELING (Calibration, Defensibility, Experiments), ATTRIBUTION (Overview, Sources, Graduation Candidates, Activity), plus SETTINGS > Your Content / My Attribution / Billing Summary. If demo-user is intentionally admin-roled, the beta cohort will still see this level of nav density unless nav is role-gated. Needs a product decision: role-gate these groups or collapse under a "Developer" section.

---

## Pending surfaces (not yet captured)

- **S7 — Predictions feed in club context** (likely overlaps with dashboard widgets, but worth a deliberate pass).
- **S8 — Messaging / chat** (CHAT button from club home + left-nav Messages).
- **S9 — Member profile cards** (click a member name from club home).
- **S10 — CURRICULUM, MENTORING, ANALYSTS tabs** on club home.
- **S12 — Per-user opt-outs at club level** (if exposed anywhere).
- **S13 — Mobile responsiveness** on club home + tournament leaderboard at 375px.
- **S14 — First-visit empty states**: log out and sign up fresh to see club-empty + tournament-empty + fresh-user states.

---

## S0 — Dashboard (entry point for the intern)

**URL**: `/`
**Auth**: `demo-user`, sees "Your Clubs" + "Your Tournaments" sections.

### Observations
- "Your Clubs" list is flat text: "St. Thomas Investing Club3 members". No space between name and count — typography bug. No card treatment, no hover affordance, no way to tell this is clickable. Student has to guess.
- "Your Tournaments" shows "St. Thomas Weekly Sprint #1 upcoming" — no start date, no roster, no "join" affordance. "upcoming" chip is informational but doesn't answer *when*.
- Affinity alert ("Different perspective on PLTR") is prominently positioned above the key stats. For a new student, this competes for attention before they know what analysts even are.
- Left nav has 16+ items. For a student focused on their club + tournament, the density may be overwhelming; consider a "Club Mode" simplified shell.
- Top-right: yellow warning badge with "5" count (findings?) and red "9+" notifications badge. No context on what either is unless hovered. Students may see these as "something is wrong" signals.

---

