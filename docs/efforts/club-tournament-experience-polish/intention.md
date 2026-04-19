# Effort: Club & Tournament Experience Polish

## Problem

The intern (and the broader St. Thomas Investing Club cohort) is the showcase audience for Divinr right now. The architectural underpinnings — analysts, predictions, risk debates — are working. But the *club* and *tournament* surfaces those students live in day-to-day haven't been polished as a deliberate experience. They function; they don't yet *delight*.

Before we layer new architecture on top (Divinr Basic billing model, .edu-gated student accounts, user-authored custom content), the existing club + tournament UX needs to feel like a finished product — because that's the experience the intern and her classmates judge us on, and what they tell their friends about.

## Intention

Make the club and tournament surfaces feel like a polished, intentional product for a student-club user. Walk every screen the intern will touch over a typical week and raise the bar on each one — copy, layout, empty states, micro-interactions, social affordances, leaderboard storytelling.

This is not a new-feature effort. It's a polish-and-tighten pass on what already exists.

## Scope (TBD — to be filled in during PRD phase)

Surfaces that probably need attention (not committed until walked):

- Club home page (member list, recent activity, what's-going-on-here clarity)
- Tournament leaderboard (storytelling, calibration, why-am-I-ranked-here)
- Predictions feed inside a club context
- Messaging / chat
- Member profile cards (what does another club member look like?)
- Per-user opt-outs at the club level (foundation that Divinr Basic will inherit)
- Empty states everywhere — first-day-in-the-club shouldn't feel barren
- Mobile responsiveness on the screens students actually use on their phones

## Open Questions

- Walk-through with the intern: which screens already feel good, which feel rough?
- Is there a tournament-specific "moment" we should engineer (kickoff celebration, weekly recap, end-of-tournament summary)?
- How much of the per-user opt-out scaffolding should ship here vs. wait for divinr-basic?

## Success Criteria

- The intern (and an honest friend) walk through the club + tournament surfaces and their reaction is "this feels real," not "this feels like a beta"
- Every screen has a deliberate empty state
- Nothing in the club/tournament flow makes a student feel lost about what they're looking at

## Out of Scope

- Membership/billing architecture (that's user-billing-model)
- New club types or .edu gating (that's student-accounts)
- New tournament *mechanics* — only the experience around existing mechanics

## Dependencies

- Onboarding tour (current effort) — needs to land first so we know what context the user enters with

---

*Stub — scope to be expanded after a deliberate walkthrough with the intern's perspective.*
