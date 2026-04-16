# Effort: Onboarding Tour

## Problem

Divinr is a rich, multi-feature platform — 5 AI analysts, risk debates, portfolios, clubs, tournaments, learning loops, coordination metrics, affinity scoring. A new user dropping into the dashboard for the first time sees a lot and understands little. Without guidance, they'll either:

- Bounce immediately because it feels overwhelming
- Click around randomly, miss the magic (transparent reasoning, the debate, the learning loop)
- Ask the person who invited them "what am I looking at?"

Ethan's friends are arriving in the next few days. The St. Thomas tournament starts April 20. The landing page sells them on "AI market analysis you can actually understand" — but the product only delivers on that promise if they **see** the reasoning, not just the dashboard cards.

Most importantly: Divinr's whole thesis is **explainability over black boxes**. A new user who doesn't understand what they're looking at gets neither explainability nor confidence. The onboarding tour is how we teach the thesis.

## Intention

Build a guided onboarding tour that takes a new user from "I just signed up" to "I understand what Divinr does and how to use it." The tour walks them through the left-nav items in order, explaining what each screen shows, how to read it, and how it connects to the others.

Key design principles:

- **Docent panel, not a takeover.** A floating panel on the right docks next to whatever page they're on. It explains what they see, points out specific elements, and advances them forward. They still drive — they click around naturally — but the docent travels with them.
- **Learn by doing.** Some steps ask them to perform a small action ("try clicking into the AAPL prediction"). Mix of read-only explanations and guided interactions.
- **Soft gating.** Nav items above the current step show with a 🔒 icon. Not hidden — they can see the full scope of the platform — but muted. Clicking a locked item makes the docent say "let's get through this first."
- **Escape hatch.** Skip from the welcome modal. Pause and resume. Restart later from user settings. Nothing is forced.
- **Shows the thesis.** The tour's emotional beats emphasize the parts of Divinr that are genuinely novel: reading analyst reasoning, watching Red/Blue debate, seeing the learning loop propose changes.

## Scope

### Data Model

A new `authz.user_preferences` table keyed by `user_id`, with an `onboarding_state` JSONB column. Shape:

```json
{
  "started_at": "2026-04-14T20:00:00Z",
  "completed_at": null,
  "skipped": false,
  "current_step": "dashboard",
  "steps_completed": ["welcome"],
  "last_seen_at": "2026-04-14T20:15:00Z"
}
```

Auto-initializes on first request for a user with no row yet.

### API

Small surface:

- `GET /onboarding/state` → current state
- `PATCH /onboarding/state` → update (complete a step, advance current step, skip, restart)

### Tour Steps (in order)

Following the left-nav top-to-bottom, 12 steps total:

1. **welcome** — Splash modal on first login: "Want a 10-minute tour? Yes / Skip for now"
2. **dashboard** — Explain the prediction cards, club card, stats grid, and how to drill in
3. **predictions** — Click into a prediction card to see the full instrument detail
4. **instrument-detail** — Arbitrator synthesis + 5 analyst cards with direction/confidence/rationale; this is the "oh, THAT's what explainability means" moment
5. **analysts** — The analyst list with performance scores, contracts, and how to read them
6. **performance** — Equity curves vs SPY, calibration, leaderboard
7. **risk** — Risk dimensions + the Blue/Red/Arbiter debate (the "whoa" moment)
8. **portfolios** — Analyst portfolios, positions, trade recommendations
9. **clubs** — Your clubs, activities, challenges, polls, messaging
10. **tournaments** — How the competition works, the leaderboard, how trades execute
11. **messages** — Club chat
12. **done** — Celebration modal: "You're ready. Explore freely. The Affinity and System items are now unlocked."

### Step Content

Each step has a structured content blob:

- Title
- Body (markdown, 2-3 short paragraphs)
- Optional element highlights (CSS selector + "point at this" annotation)
- Optional CTA ("Try clicking a prediction card" / "Expand the Blue Agent reasoning")
- Completion condition — either "user clicked Got It" or "user performed action X"

Content lives in a structured TS file (`apps/web/src/onboarding/tour-content.ts`) so it's type-checked, easy to edit, and diff-friendly.

### Nav Lock Logic

Each nav item has an `unlocks_after` step. The sidebar component reads the onboarding store and:

- If the item's unlock step is in `steps_completed` → normal rendering
- If not → renders with 🔒 icon, muted color, click routes to current step instead

| Nav item | Unlocked after |
|----------|----------------|
| Dashboard | Always |
| Instruments | `predictions` |
| Analysts | `instrument-detail` |
| Performance | `analysts` |
| Coordination | `performance` (owner/admin only anyway) |
| Affinity | `done` |
| Risk | `instrument-detail` |
| Portfolios | `risk` |
| Clubs | `portfolios` |
| Tournaments | `clubs` |
| Messages | `tournaments` |
| Notifications | Always |
| System group (Runs, Sources, Evaluations, Learning, Proposals) | Admin-only, always unlocked |

### UI Pieces

1. **Welcome modal** — First-login gate. Offers the tour, or "Skip — I'll figure it out." Skipping sets `skipped: true` and unlocks everything.
2. **Docent panel** — Floating panel, dockable to the right side. Shows current step content, Next button, Pause button, Skip Tour link. Can be collapsed to a small ribbon.
3. **Element highlighters** — When a step points at a specific UI element, a subtle pulse/outline appears on that element. Tooltip-style callout if needed.
4. **Header tour button** — Small icon (compass? map?) in the header. Click to reopen the docent if paused. Shows progress indicator ("3 of 12").
5. **Completion celebration** — Modal on `done` step. Confetti or similar. "You've unlocked everything. Welcome to Divinr."
6. **Restart control** — In user settings / profile menu: "Retake the onboarding tour."

### Router Guard

If a user with active onboarding tries to hit a locked URL directly (typing it in, clicking an old link, etc.), the router redirects them back to their current tour step and the docent says something friendly ("You'll get there — just a few more steps first").

### Admin Override

Super-admins have a dev menu entry "Reset onboarding for user X" so we can test the flow repeatedly without creating new accounts.

### Analytics (future, not MVP)

Track which step users drop off at. Inform iteration.

## Success Criteria

- Ethan signs up tomorrow, sees welcome modal, accepts tour
- He walks through all 12 steps guided by the docent
- He ends at the completion celebration feeling like he understands what Divinr is and how to use it
- He never has to ask "what am I looking at?"
- A user who skips can use the full product without restriction
- A user who pauses can resume where they left off

## Out of Scope

- Interactive tutorials that require specific data (e.g., "make a trade right now")
- Multi-language content (English-only)
- Role-specific tour variants (members vs custom tier) — same tour for everyone at launch
- Gamified achievements / badges
- Video walkthroughs
- Per-step analytics dashboard (future effort)

## Dependencies

- Landing page (shipped) — the tour picks up where the landing page marketing leaves off
- /join signup flow (shipped) — the tour runs on first post-signup login

## Timeline

Target: **complete tonight, ship tomorrow morning before Ethan sees the app.**

Phases in the plan will break this into ~6 hours of implementation:

1. DB schema + API endpoints
2. Pinia store + basic docent component
3. Nav lock rendering
4. Step content for all 12 steps (the real heavy lift — writing good copy)
5. Welcome modal + completion celebration
6. Router guard + restart controls
7. Browser testing + polish

## The Emotional Arc

This is the part that matters most. A new user should feel, in order:

- **Welcomed** (welcome modal — not intimidated by the dashboard)
- **Shown something cool** (dashboard — "oh, 5 analysts, each with a rationale, I can read them?")
- **Astonished** (instrument detail + risk debate — "wait, the AI actually argues with itself? And I can read the argument?")
- **Empowered** (portfolios, trades — "I can paper trade alongside the AI?")
- **Connected** (clubs, tournaments — "my friends are here, we can compete")
- **Confident** (completion — "I get this. I know where everything is. I want to use it.")

If the tour achieves that arc, Ethan tells his friends "you have to try this" instead of "I set it up, here's the link."

---

*Next artifacts in this effort: PRD (detailed spec of each UI piece and endpoint), then a phased plan (what to build first and test against what).*
