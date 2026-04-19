# Effort: Onboarding Tour Extended (v2)

## Background

Onboarding v1 shipped — see `archive/onboarding-v1/`. It's a 12-step linear tour that walks new users through the left-nav top-to-bottom with a docent panel. It works for the original beta cohort and proves the docent UX pattern. v2 keeps the docent UI but reshapes the *delivery model* around two principles the team agreed on during planning:

1. **Users want to play, not study.** "Enough to start using the product" beats "comprehensive guided tour" every time. The author's pride in the system's depth is not a teaching strategy.
2. **Depth should reveal itself when the user reaches for it.** A user who never opens the contract editor should never be taught about contracts.

## Problem

Three things have changed since v1 shipped:

1. **The product got deeper.** Stage-keyed contracts, the (user, analyst, instrument) triple model, user-authored content, slot-based enablement, per-item authorship pricing, custom-to-base graduation — too much for any single linear tour without overwhelming new users.
2. **A linear tour is the wrong shape now.** Asking a brand-new user to sit through an hour of capability narration is a near-guaranteed bounce. The product has earned the right to be deep, but not the right to *front-load* the depth.
3. **The tour isn't context-aware.** When a user clicks into the portfolio for the first time, that's the moment they want a one-paragraph rundown — not while reading the welcome modal three days earlier.

## Intention

Replace the chaptered hour-long-tour concept with a **two-part delivery model**:

1. **A ruthlessly small Beginner Tour at signup** — five-or-so beats, ten minutes max, "enough to play." Just the spine: what a prediction is, how to make a trade, where the social stuff lives, where to go when stuck. Then get out of the way.
2. **Per-user first-touch walkthroughs everywhere else** — when a user lands on a meaningful surface for the first time, a docent panel pops with a short rundown of what's there and what might be of interest. Once seen, never again (unless explicitly reset). The user pulls; we never push.

Three controls let the user shape this to taste: dismiss any individual walkthrough, mute first-touch globally, or per-section "show me again."

## Scope

### 1. Beginner Tour at Signup

- Triggered once after first login
- ~5 beats, total dwell ~10 minutes if read end-to-end (most users will skim)
- Beats:
  1. **What Divinr is** — explainability over black-box trading bots, in two sentences. Warm welcome, "thanks for coming."
  2. **Meet the analysts (and the instruments they cover)** — the heart of the product. A roster shot of the analysts, what makes each one different, how they read instruments differently, why disagreement between them is the point. The user should leave this beat *impressed* — analysts + instruments are the engine of everything else they'll see. Pointer to the analyst roster and a sample instrument detail so they can poke around immediately.
  3. **Reading an analysis** — direction, confidence, the rationale link, one click into the detail. (Note: this beat will use the new "analysis" vocabulary once `ui-vocabulary-and-marketing-refresh` lands; today's copy says "prediction.")
  4. **Making a trade** — show the trade button, mention paper-trading and disclaimers
  5. **Where to go from here** — clubs / tournaments / learning are all here when you want them but none are required; dashboard is your home; settings has the onboarding controls if you want to change them later. "Have fun, and welcome."
- "Skip tour" available on every beat (per v1 behavior)
- Resume per beat if user closes the tab mid-tour

**Ruthlessly trimmed.** Anything that feels educational rather than enabling gets cut. Every beat has to pass: *"Does the user need this to play?"*

### 2. First-Touch Walkthrough Infrastructure

The replacement for chaptered depth-tours. Every meaningful surface in the product can register a first-touch walkthrough that fires once when the user encounters it.

**Data model**:
- New table `prediction.user_surface_touches` (or similar — final schema TBD): `(user_id, surface_key TEXT, first_touched_at TIMESTAMPTZ, dismissed BOOLEAN)` — one row per (user, surface)
- `surface_key` is a stable string identifier like `portfolio.detail`, `analyst.editor`, `club.create`, `contract.section.predictor-generation`

**Surfaces are a tree**:
- Parent surfaces fire a high-level rundown ("here's what's in Portfolios, here's the kinds of things you can do in here")
- Child surfaces fire targeted rundowns ("this position row shows cost basis, current P&L, click to see full history")
- Each level fires once on first touch; touching the parent does *not* mark the children touched

**Frontend primitive**:
- `useFirstTouch(surfaceKey)` composable mounted on relevant views/components
- On mount: check if (current user, surface_key) exists. If not, render the docent panel with that surface's content + immediately mark touched.
- If touched already, render nothing.

**Walkthroughs are not gates.** The walkthrough panel renders *alongside* the surface, not in front of it. The user can ignore the panel and use the feature immediately. There is no "you must read this before you can create your first instrument" flow — that would be hostile, and the people who reach authoring surfaces have usually muted walkthroughs by then anyway (see "Advanced-user observation" below).

**Advanced-user observation.** The deeper a surface lives in the product (custom analyst editor, contract sections, BYO LLM credential setup), the more likely the user reaching it has already muted first-touch walkthroughs. That's expected and fine. We still ship walkthrough content for those surfaces — for the user who reaches them with walkthroughs still on, the content matters — but we don't fret over whether the content is "advanced enough" for those readers, because the most advanced readers won't see it.

**Content store**:
- `apps/web/src/onboarding/surface-content.ts` — keyed by surface_key, each entry is a small object: title, 1–3 sentences, optional "want to try X?" CTA
- Diff-friendly, type-checked
- One file or split per section if it grows — TBD in PRD

**User controls**:

Every first-touch walkthrough has a **"Don't show me these anymore"** button directly on the panel — that's the global mute. The user doesn't need to hunt through settings to silence them; the off-ramp is one click from any walkthrough they see. Clicking it is also the in-flight dismiss for that specific walkthrough.

Settings page (new "Onboarding" section) exists so the user can undo that decision later:
- **Re-enable first-touch walkthroughs** — flips the global mute back off. Surfaces still marked touched in the background while mute was on, so flipping back off only fires for genuinely-new surfaces.
- **Per-section reset** — "Show me again for [Portfolios | Clubs | Analysts | …]" — resets touched flags for that subtree, walkthroughs re-fire on next visit.
- **Global reset** — "Show me everything again" — resets everything.

**No signup-time "skip everything" power-button.** The v1 welcome-modal "Skip tour" already lets advanced users bail on the Beginner Tour; that's sufficient. Beyond that, walkthroughs keep appearing until the user turns them off — they are the default state, not an opt-in.

**Content quality bar** — every surface's content has to pass the *"would a non-author care?"* test before shipping. Internal architecture explanation, contract structure rationale, reasoning-about-reasoning content all fail this test by default. If the user can't immediately *do* something with the information, it doesn't belong in a first-touch walkthrough.

**Voice and tone** — every walkthrough (Beginner Tour beats and per-surface first-touch panels) reads in this voice:

- **Enjoyable, warm, slightly excited** — "we have all of this for you," "we're super excited about this." Not breathless; not corporate.
- **Honest about getting going** — "here's basically what you would need to get going and not get completely lost." Acknowledge that the product has depth without dumping it on the user.
- **Gracious** — "thanks for coming." The user chose to be here; thank them for the choice.
- **Options, not obligations** — when mentioning the social side, frame as menu items: "club option, tournament option, learning option." Anything the user can do without is presented as available, not required.
- **No jargon for jargon's sake** — internal terms (contract, triple, slot, debate-arbiter) get plain-language explanations on first use, then can be used freely once introduced.

The v1 `tour-content.ts` is the existing baseline; the rewrite for v2 should match that warmth and add the "options not obligations" framing for the social/learning surfaces.

### 3. Initial Per-Surface Content Authoring

**Every meaningful surface in the product gets a first-touch walkthrough — no surface is too "advanced" to deserve one.** The point of the first-touch model is precisely that depth no longer needs to be hidden or staged: the user discovers it when they reach for it, and gets a short, useful explanation right then. There is no "advanced track" anymore — there is only the surface the user just touched.

The product has had a lot of capability added in the last week (see roadmap "Recently Shipped"). v1 of this effort owns writing first-touch content for the full inventory below. Each entry is a 1–3 sentence rundown + an optional CTA. The inventory itself becomes a living document that any future effort adds to when it ships a new surface.

#### Top-Level Sections (every nav destination)
- `dashboard` — what the cards mean, where to drill in
- `predictions` — the predictions list, sorting, filtering
- `instruments` — instrument list and detail
- `portfolios` — portfolios overview
- `performance` — equity curves, P&L summary, calibration
- `analysts` — roster, performance leaderboard
- `clubs` — discover/my-clubs (clubs are purely social, fully opt-in)
- `tournaments` — tournament list
- `messages` — DMs and channels
- `notifications` — bell + activity feed
- `settings` — account, billing summary, onboarding controls

#### Predictions & Trade Path
- `prediction.card` — direction, confidence, rationale link
- `prediction.detail` — full reasoning, debate excerpt, related predictions
- `prediction.trade-cta` — "Trade this prediction" button (the new prediction-to-trade-intent flow), sizing heuristic, disclaimers
- `tournament.picker` — how the active-tournament resolver picks one when there are several

#### Instrument Surfaces
- `instrument.detail` — arbitrator synthesis, analyst cards, reading disagreement
- `instrument.debate` — Blue/Red/Arbiter columns, risk dimensions, the holistic-view framing (this is one of the product-defining moments)
- `instrument.variant-switcher` — chip bar for switching between (analyst × instrument) variants when the user has authored custom variants

#### Analyst Surfaces
- `analyst.detail` — track record, contracts (read-only view), affinity score
- `analyst.contract-viewer` — General + stage-keyed sections + Adaptations, why it's structured this way (one paragraph; the user reading it cares enough)
- `analyst.calibration-drilldown` — per-instrument accuracy, scatter, wrong-first list
- `analyst.affinity` — affinity scoring, contrarian alerts

#### Portfolio + Slot-Based Enablement
- `portfolio.my-triples` — the (author, analyst, instrument) triples list, what enable/disable does
- `portfolio.add-triple` — add-to-portfolio flow, naming-collision disambiguation
- `portfolio.position-row` — cost basis, P&L, history drill-in
- `portfolio.detail` — analyst portfolios, positions, trade history

#### Performance & Attribution
- `performance.equity-curve` — vs SPY, what the chart is showing
- `performance.attribution` — multi-dimensional P&L (per-analyst, per-instrument, per-source, per-article, per-author)
- `performance.author-retention` — value-per-$ surfaces, per-author rankings (for users who author)
- `performance.leaderboard` — Risk-Adjusted Return label, color coding, YOU badge

#### Clubs (social, opt-in)
- `club.discover` — public clubs list, filter
- `club.create` — create-a-club flow (sub-flow walked explicitly when the user opens the modal)
- `club.detail` — anatomy of a club (segments: ACTIVITIES with unread badge, MEMBERS with profile drawer, CHALLENGES, POLLS, JOURNALS, CURRICULUM, ANALYSTS, MENTORING, ANALYTICS, SETTINGS)
- `club.activities` — challenges + polls + journals; explain the unread badge
- `club.mentoring` — mentor-mentee pairing, eligibility, feedback
- `club.curriculum` — multi-week courses, auto-unlock, professor dashboard
- `club.analysts` — club-curated analyst spotlights
- `club.opt-outs` — per-user opt-outs at the club level (visibility, messaging, leaderboard)

#### Tournaments
- `tournament.list` — countdown, player count, prize line, ActiveTournamentBanner
- `tournament.detail.info` — mechanics, how trades execute, club connection
- `tournament.detail.trade` — the trade form, equity-only options state, disclaimers
- `tournament.detail.leaderboard` — Risk-Adjusted Return, neutral/green/red color, YOU badge, clickable rows → MemberProfileDrawer
- `tournament.detail.my-positions` — size bar, P&L, history
- `tournament.avatar-stack` — "+N" entrants preview on list cards

#### Messaging
- `messages.dm` — direct messages
- `messages.channel` — channel chat, threads, reactions, attachments
- `messages.direct-message-intent` — "DM this player" entry points across the app

#### Authoring Surfaces (the depth — no longer gated, every surface gets a walkthrough)
- `authoring.custom-analyst.create` — start-from-scratch analyst creation
- `authoring.custom-analyst.editor` — full personality + contract editor
- `authoring.custom-instrument.create` — new instrument from scratch
- `authoring.custom-instrument.editor` — instrument contract editor
- `authoring.contract-section.predictor-generation` — what this section is for, how it shapes prompts
- `authoring.contract-section.risk-assessment` — same
- `authoring.contract-section.prediction-generation` — same
- `authoring.contract-section.learning` — same
- `authoring.contract-section.adaptations` — auto-appended, what it means
- `authoring.byo-llm` — bring your own API key, platform fee, what model to pick
- `authoring.relationship-selection` — wiring which authored analysts run on which authored instruments
- `authoring.source-selection` — picking sources per custom instrument

#### Authored Content (the user's own stuff)
- `authored.overview` — list of everything I've authored, with current per-item monthly charges
- `authored.attribution.mine` — my own per-author attribution: how my authored content has performed across all users who enabled it

#### Risk & Sentiment
- `risk-dashboard` — risk debate aggregations, per-instrument risk-dimension breakdown
- `fear-greed-alerts` — sentiment crowd-reaction alerts (the fear-greed-alerting feature)

#### Coordination & Multi-Analyst Views
- `analyst.coordination` — correlation matrix, coverage gaps, contribution scoring across analysts

#### Sources & Source Quality
- `sources` — sources management view (which sources are configured)
- `source.quality` — per-source quality drill: hit-rate, value-per-article (entity-level-performance-attribution surface)

#### Per-Instrument Attribution
- `instrument.attribution` — per-instrument attribution drill (cross-analyst earnings on this instrument)

#### Curriculum & Learning
- `learning-dashboard` — student-facing learning home
- `curriculum.dashboard` — professor's curriculum overview
- `curriculum.create` — create a multi-week course
- `curriculum.detail` — viewing a specific week of a course

#### Mentor / Mentee
- `mentor.dashboard` — mentor's view of mentees, feedback queue, leaderboard

#### Tournaments (additional surfaces)
- `tournament.create` — create-a-tournament flow
- `tournament.history` — past tournaments, results browse
- `tournament.invite-landing` — landing on a tournament invite link

#### Clubs (additional surfaces)
- `club.compare` — compare two clubs side-by-side
- `club.rankings` — public cross-club leaderboards (the public-club-rankings feature)
- `club.invite-landing` — landing on a club invite link
- `club.join-signup` — one-step signup via invite (for users not yet registered)

#### Auth & Onboarding (signup-time surfaces)
- `auth.invite-signup` — generic invite-driven signup
- `welcome-modal` — the post-signup welcome modal that launches the Beginner Tour

#### Cost & Billing Transparency
- `billing.summary` — monthly bill widget: $50 Basic + per-item line items
- `billing.compute-breakdown` — per-stage, per-model, per-triple cost (visible to all users; especially useful for students)
- `billing.student-accrual` — students-only widget showing real-time cost accrual

#### Admin Surfaces (for users who become admins)
- `admin.cost-modeling.calibration` — per-model calibration dashboard, drift alerts
- `admin.cost-modeling.defensibility` — per-item-kind margin defensibility view
- `admin.cost-modeling.experiments` — serial-execute alternative models on saved prompts
- `admin.llm-usage` — structured call log, materialized views, per-stage breakdown
- `admin.day-trader-runs` — intraday scheduler audit trail
- `admin.findings-inbox` — contract-vs-output audit findings
- `admin.evaluations` — runs / evaluations viewer
- `admin.runs.list` + `admin.runs.detail` — pipeline runs browse and detail
- `admin.canonical-day` — canonical-day detail viewer
- `admin.proposals` — Tier-3 strategic-overhaul proposals queue
- `admin.graduation-candidates` — ranked candidates for custom-to-base graduation
- `admin.contract-editor` — version history, diff, rollback for base content
- `admin.notification-debug` — SSE event producers, delivery state
- `admin.attribution` — system-wide multi-dimensional attribution dashboard
- `admin.domain-dashboard` — admin/engineer overview surface

#### Settings
- `settings.onboarding` — global mute, per-section reset, "show me everything again"
- `settings.opt-outs` — disable social surfaces (visibility, messaging, leaderboard)
- `settings.byo-credentials` — manage attached LLM provider keys
- `settings.profile` — user profile, display name, avatar
- `settings.terms` — Terms of Service (informational; first-touch walkthrough probably not needed but key reserved)

#### Public Surfaces (no first-touch — listed for completeness)
- `public.landing` — `/welcome` public landing page (no first-touch since user not authenticated; covered by `marketing-copy-refresh`)
- `public.login` — login page (no first-touch)

**This is the v1 inventory.** It's a snapshot as of 2026-04-19 — comprehensive across the views directory, every Recently-Shipped feature, and the broader surface area. The PRD phase confirms the final list and writes content for each.

**Anything shipped *after* this effort lands must add its own first-touch entry as part of that effort's Definition of Done** — see "Forever Rule" below for how that gets enforced rather than relying on memory.

### Resume & Dismiss Semantics

- Beginner tour: resume per beat (existing v1 state model)
- First-touch walkthroughs: each is dismissable in-flight ("got it" or close button), but dismiss = touched (it doesn't re-fire). The user has to use settings to reset.
- Dismiss is per-walkthrough, not global — closing one doesn't mute the rest

### Telemetry Bonus

The `user_surface_touches` table is also a discoverability signal: which surfaces are users *not* finding? If 80% of users never touch the contract editor after 30 days, that informs marketing/UX, independent of any tour.

### 4. The Forever Rule (durable enforcement)

The hardest part of this whole effort is not v1 — it's keeping the surface inventory honest a year from now. Memory and good intentions don't survive shipping pressure. This effort owns shipping the enforcement:

1. **CLAUDE.md update** — add a project convention: *"Every new user-facing surface ships with a `useFirstTouch(key)` call and a corresponding entry in `surface-content.ts`. This is part of Definition of Done for any effort that adds or substantially changes a user-facing view, modal, or interactive component."*
2. **Build-plan / verify-plan skill update** — when those skills generate or check a plan, they include a "First-touch coverage" item under Definition of Done for any phase that touches user-visible surfaces. The verify-plan pass flags it as a Major issue if a new surface lacks first-touch content.
3. **Optional: lint check** — a small ESLint rule (or grep-based CI check) that flags `<script setup>` blocks in `views/` and key `components/` that don't call `useFirstTouch(...)`. Lower priority than (1) and (2) — start with the convention + skill enforcement, add lint only if drift is observed.

The Definition of Done for *this* effort includes shipping (1) and (2). (3) is a follow-up if needed.

## Honest About System Capabilities

- The Beginner Tour and first-touch infrastructure can ship without any further architecture dependencies — those all landed
- Authoring and contract surfaces *do* get first-touch walkthroughs in v1 (no "advanced" gating); their content has to pass the same "would a non-author care?" test, just keyed to the user who has clearly opted into authoring by being on that surface in the first place
- The contract-editor first-touch walkthrough requires the editor itself to be presentable enough to be teachable; if it isn't, that's a UI lift in a `stage-keyed-analyst-contracts` follow-up rather than a blocker for the tour effort
- Personalization (e.g., "your AAPL analyst…") is *not* in v1 — generic content first; weave in user-specific names later only if it earns its keep

## Decided During Planning (no longer open)

- **Walkthrough UI shape** — reuse the v1 docent panel. Not intrusive, already proven, worth the consistency. Beginner Tour and first-touch walkthroughs share the same panel treatment.
- **Throttling** — none. If five walkthroughs fire, they fire. The user has a one-click mute on each panel; trust them to use it.
- **"Just let me play" signup power-button** — **not adding one.** v1's existing "Skip tour" on the welcome modal handles advanced users who want to bail on the Beginner Tour. After that, walkthroughs stay on by default until the user turns them off via the per-panel "Don't show me these anymore" button.
- **Per-surface gating** — **none.** Every surface's walkthrough appears in-place when reached. We don't pre-disable surfaces, and we don't hold back walkthroughs for "advanced" features.

## Open Questions for PRD Phase

- **Surface key naming convention** — dotted hierarchy (`portfolio.detail.position-row`) vs. flat strings vs. enum. Affects how the per-section reset query is shaped.
- **Auto-suppress when user is mid-flow** — if the user is mid-trade form, should a first-touch walkthrough hold until they're idle, or just appear alongside? Leaning toward "appear alongside" to match the "no throttling" decision, but worth confirming during UI implementation.
- **Initial per-surface content list finalization** — §3 has the full inventory; PRD phase confirms the list and writes the actual content strings.

## Success Criteria

- A new user can sign up, complete the Beginner Tour in under 10 minutes, and immediately be productive (find predictions, make a trade, see the dashboard)
- A user who skips the Beginner Tour can use the full product without restriction
- A user who never opens the contract editor never sees contract-editor walkthrough content
- A user who opens the portfolio for the first time gets a short, useful rundown of what's there — not architectural narration
- A user can mute all first-touch walkthroughs from settings with one toggle
- A user can reset first-touch state per section or globally and re-experience the rundowns
- The `user_surface_touches` table accumulates accurate first-touch data usable as a discoverability metric

## Adjacent Efforts (Not in Scope, but Related)

The full surface inventory above is the same list that two adjacent efforts will draw from. Calling them out so the connection is explicit and they get queued separately:

- **`ui-vocabulary-and-marketing-refresh`** (queued in `next/`) — Combined effort: sweep user-visible copy to replace "prediction" with "analysis"/"signal", tighten disclaimers to explicitly say "not a prediction model," and refresh landing page + feature inventory. User-facing copy only; code/DB/API stays `prediction.*`. The first-touch surface inventory in §3 is a useful seed for what to highlight in the marketing refresh, and the first-touch content written during this effort will need vocabulary reconciliation after that refresh lands.
- **`autonomous-testing-team`** (orchestrator-AI work, not yet queued) — A Claude-agent + skill setup for an autonomous chrome-testing flow: periodic full-app test sweep → find issues → triage → fix → retest → close. Needs its own intention and dedicated planning session. The first-touch surface inventory in §3 is also the ideal coverage checklist for what the testing team should exercise. Park for now; the user will walk through the agent/skill setup in a dedicated session before queueing.

## Out of Scope

- Multi-language content (English-only, same as v1)
- Role-specific tour variants (admins, students, etc.)
- Per-step analytics dashboards (the table itself is the v1 telemetry surface)
- "Tour my friend gave me" — annotated tours from experienced users (deferred; potentially its own effort later)
- Achievement / completion badges (deferred; risks turning the tour into a chore)
- Personalization based on the user's own enabled triples ("your AAPL analyst said X") — generic content for v1
- Marketing-side discoverability nudges (dashboard cards advertising authorship etc.) — separate effort

## Dependencies

All previously-listed dependencies have shipped:
- Six architecture restructure efforts (workflow-stages-article-pipeline → slot-based-enablement-ui)
- `club-tournament-experience-polish` — club/tournament surfaces are in finished shape

No remaining hard blockers. The Clubs first-touch walkthrough should teach the current model: clubs are purely social, fully opt-in, with no default club and no auto-enrollment.

---

*v2 builds on v1 (archived). The hour-long chaptered tour concept from earlier drafts has been retired in favor of a small Beginner Tour + per-surface first-touch walkthroughs, on the principle that users want to play rather than study.*
