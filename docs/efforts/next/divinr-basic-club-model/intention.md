# Effort: Divinr Basic & Multi-Club Membership Model

## Problem

Divinr's current pricing strategy (documented in `roadmap.md`) is built around individual user tiers — Starter / Pro / Premium / Custom — each with its own bundle of analysts, sources, and instrument caps. That model has two structural problems:

1. **It splits the product into "social" and "solo" experiences.** A solo Starter user lives in a different mental model than a club member, and the codebase has to support both as first-class shapes.
2. **It misprices the actual cost driver.** Inference cost is content-keyed — `(articles × analysts) + (predictions × predictors × analysts)` — not user-keyed. Per-user tiers price something that isn't the cost. Adding users to already-covered instruments is nearly free; adding instruments to the covered universe is what costs money. Per-user tiers don't align price with cost.

We need a single, clean model where every user is a member of at least one club, the club is the billing unit, and individual users never have a separate paid tier.

## Intention

Replace individual user tiers with a **club-as-billing-unit** model where every active user belongs to a default paid club (**Divinr Basic**, $50/mo, 10-instrument portfolio cap), can join additional clubs that stack their entitlements, and can opt out of any social surface within any club without losing functional access.

This collapses "individual user" and "club member" into one shape, aligns price with cost, and gives every user a default home for tournaments and social features without forcing participation.

## Scope

### The Divinr Basic Club

- Default club; every active account is auto-enrolled at signup
- Cannot be left (you can leave other clubs, not Basic)
- $50/mo, 10 portfolio slots (a *ceiling*, not a quota — using 2 is fine)
- 30-day free trial at signup; auto-converts to paid if card on file, else moves to trial-expired state
- Trial-expired accounts: read-only, 6-month dormancy window, then purged (with warning email at 30-days-before)

### Multi-Club Entitlement Rules

- **Capabilities union** across all clubs the user belongs to: analysts, sources, article feeds, custom signal types — you get everything from every club
- **Quotas sum** across all clubs: instrument cap, alert count, custom analyst slots, anything countable. Pay for 50 + 30, get 80 portfolio slots.
- No "club context switcher" UI required — entitlements are flat across the user's session

### Per-User Opt-Outs (works in any club, including Basic)

- Visibility (be hidden from member lists)
- Messaging (don't receive, don't appear as a target)
- Tournament participation (silent member who doesn't compete)
- Notifications and announcements
- Leaderboard appearance
- Profile visibility

A silent, 2-instrument Basic user who never sees another user and is never seen by one is a **first-class** experience, not degraded.

### Lifecycle

```
signup → trial (30 days) → active (paid) → expired (read-only, 6mo) → purged
                       ↘ no card → expired (read-only, 6mo) → purged
```

Email touchpoints: trial-end conversion prompt, 30-days-before-purge warning.

### Pricing/Strategy Reset (prerequisite phase)

Before building, this effort owns rewriting the documented strategy to match the new model:

- Audit `next/stripe-integration` — its scope is currently "individual tier subscriptions"; needs reframing to "club subscriptions"
- Grep `next/` and `future/` for "Starter / Pro / Premium / Custom" tier references — reconcile each
- Rewrite the Phase 1 tier table in `roadmap.md`
- Update `project_strategy.md` memory in the same change (docs and memory must stay coherent)
- Reconcile `learning-clubs`, `mentor-mentee-pairing`, `public-club-rankings`, `tournament-system` if any bake in old assumptions

### Migration

- Existing users: auto-enrolled in Basic, grandfathered into trial or active state per current account state (TBD in PRD)
- Existing clubs (St. Thomas Investing Club): keep their distinct identity, members are *also* in Basic by definition

## Success Criteria

- Every active account is a member of Divinr Basic
- A user joining a second club sees their entitlements stack correctly (more analysts, more sources, slot caps sum)
- A user can disable every social surface in Basic and still have a functional product
- Trial → paid → expired → purged lifecycle works end to end with the right email touchpoints
- Strategy docs (`roadmap.md`) and memory (`project_strategy.md`) reflect the club-as-billing-unit model — no orphaned references to the old individual-tier model

## Out of Scope

- Stripe wiring itself (lives in the rescoped `stripe-integration` effort that comes after)
- Student-club .edu gating (separate effort: `student-club-accounts`)
- The $100 / $500 paid club SKUs beyond Basic (separate effort: `paid-club-tier-catalog`)
- Polish of the club/tournament UX surfaces themselves (separate effort: `club-tournament-experience-polish`, comes before this)

## Dependencies

- `club-tournament-experience-polish` should land first so the surfaces this effort wires opt-outs and entitlements into are already polished
- Onboarding tour (current effort) — completion-state assumptions may need to mention Basic membership

## Open Questions for PRD Phase

- Does Basic include a baseline source/analyst set, or do users start with zero curated content until they engage?
- How do entitlements display in the UI — flat list with no club attribution, or grouped by source club ("AAPL analysis from Pro Club")?
- For the migration: how do we communicate the model change to existing tier-aware users (if any exist by then)?
- Is there a per-club admin role distinct from per-club billing payer?

---

*Next artifacts: PRD (detailed entitlement rules, lifecycle state machine, migration plan, strategy-doc rewrite checklist), then a phased plan starting with the strategy/memory reset before any code lands.*
