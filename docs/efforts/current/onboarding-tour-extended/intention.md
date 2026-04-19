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
  1. **What Divinr is** — explainability over black-box trading bots, in two sentences
  2. **Reading a prediction** — direction, confidence, the rationale link, one click into the detail
  3. **Making a trade** — show the trade button, mention paper-trading and disclaimers
  4. **Clubs (optional)** — clubs are social and entirely opt-in; here's where to find or create one if you want
  5. **Where to go from here** — pointer to dashboard, settings for first-touch controls, "Help" surface
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

**Content store**:
- `apps/web/src/onboarding/surface-content.ts` — keyed by surface_key, each entry is a small object: title, 1–3 sentences, optional "want to try X?" CTA
- Diff-friendly, type-checked
- One file or split per section if it grows — TBD in PRD

**User controls** (settings page, new "Onboarding" section):
- **Global mute** — "Skip first-touch walkthroughs" toggle. When on: walkthroughs don't render, but surfaces still mark touched in the background so flipping back off only fires for genuinely-new surfaces.
- **Per-section reset** — "Show me again for [Portfolios | Clubs | Analysts | …]" — resets touched flags for that subtree, walkthroughs re-fire on next visit.
- **Global reset** — "Show me everything again" — resets everything.

**Content quality bar** — every surface's content has to pass the *"would a non-author care?"* test before shipping. Internal architecture explanation, contract structure rationale, reasoning-about-reasoning content all fail this test by default. If the user can't immediately *do* something with the information, it doesn't belong in a first-touch walkthrough.

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

#### Cost & Billing Transparency
- `billing.summary` — monthly bill widget: $50 Basic + per-item line items
- `billing.compute-breakdown` — per-stage, per-model, per-triple cost (visible to all users; especially useful for students)
- `billing.student-accrual` — students-only widget showing real-time cost accrual

#### Admin Surfaces (for users who become admins)
- `admin.cost-modeling` — per-model calibration dashboard, drift alerts
- `admin.llm-usage` — structured call log, materialized views, per-stage breakdown
- `admin.day-trader-runs` — intraday scheduler audit trail
- `admin.findings-inbox` — contract-vs-output audit findings
- `admin.contract-editor` — version history, diff, rollback for base content
- `admin.notification-debug` — SSE event producers, delivery state

#### Settings
- `settings.onboarding` — global mute, per-section reset, "show me everything again"
- `settings.opt-outs` — disable social surfaces (visibility, messaging, leaderboard)
- `settings.byo-credentials` — manage attached LLM provider keys

This is the v1 inventory. Anything shipped *after* this effort lands should add its own first-touch entry as part of that effort's Definition of Done.

### Resume & Dismiss Semantics

- Beginner tour: resume per beat (existing v1 state model)
- First-touch walkthroughs: each is dismissable in-flight ("got it" or close button), but dismiss = touched (it doesn't re-fire). The user has to use settings to reset.
- Dismiss is per-walkthrough, not global — closing one doesn't mute the rest

### Telemetry Bonus

The `user_surface_touches` table is also a discoverability signal: which surfaces are users *not* finding? If 80% of users never touch the contract editor after 30 days, that informs marketing/UX, independent of any tour.

## Honest About System Capabilities

- The Beginner Tour and first-touch infrastructure can ship without any further architecture dependencies — those all landed
- Authoring and contract surfaces *do* get first-touch walkthroughs in v1 (no "advanced" gating); their content has to pass the same "would a non-author care?" test, just keyed to the user who has clearly opted into authoring by being on that surface in the first place
- The contract-editor first-touch walkthrough requires the editor itself to be presentable enough to be teachable; if it isn't, that's a UI lift in a `stage-keyed-analyst-contracts` follow-up rather than a blocker for the tour effort
- Personalization (e.g., "your AAPL analyst…") is *not* in v1 — generic content first; weave in user-specific names later only if it earns its keep

## Open Questions for PRD Phase

- **Surface key naming convention** — dotted hierarchy (`portfolio.detail.position-row`) vs. flat strings vs. enum. Affects how the per-section reset query is shaped.
- **Walkthrough UI shape** — same docent panel as v1, a toast, or a dismissible inline card under the page header? v1's panel may overweight a 1–3-sentence rundown.
- **Throttling** — if a user opens five new surfaces in 30 seconds (e.g., clicking through nav for the first time), do all five walkthroughs fire? Queue them? Suppress all but the first and let the rest fire on subsequent visits?
- **Auto-suppress when user is in a flow** — if the user is mid-trade form, should a first-touch walkthrough suppress until they're idle?
- **"Just let me play" power-button at signup** — should the welcome modal offer "Skip the tour and turn off all hints" as a single click, for advanced users?
- **Initial per-surface content list** — concrete final list of ~15–20 surfaces and their content goes here.

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
