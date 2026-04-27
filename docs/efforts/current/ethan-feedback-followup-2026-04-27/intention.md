# Effort: Ethan Feedback Follow-Up — 2026-04-27

## Problem

The first Ethan feedback batch was shipped, but a second pass through the live shell exposed a new set of usability issues:

- the Research experience is still too engineering-shaped and not easy to scan by analyst
- trade submission does not give enough visible confirmation or recent activity context
- the instrument detail flow still has affordance issues from the dashboard path
- the Learning Panel is useful, but it should feel more persistently available and more aware of the page the user is on

These are product-comprehension issues, not backend/platform architecture issues.

## Intention

Tighten the beta shell around four concrete usability fixes from Ethan:

1. **Research section**
   - make analyst opinions easier to compare quickly
   - reduce emphasis on raw percentages/position-size style language
   - organize article relevance data more clearly by analyst

2. **Trade placement and portfolio updates**
   - show explicit trade submission confirmation
   - show recent queued activity so users can tell something happened immediately
   - reduce ambiguity between queued trades and visible open positions

3. **Dashboard and article issues**
   - fix the instrument detail back-path so it behaves correctly from dashboard entry points
   - remove or hide affordances that the current user level cannot actually use
   - fix article-selection behavior in the Article Relevance tab

4. **Learning Panel access**
   - add a persistent launcher in the shell
   - preserve the existing drawer/sheet behavior
   - thread current-page context, especially instrument context, into Learning Panel requests

## Success Criteria

- Research detail pages present analyst stances in simpler buy/sell/hold terms.
- Article Relevance is grouped more clearly and article selection works reliably.
- Trade submission shows an explicit success state and recent queued activity.
- Instrument detail navigation no longer strands the user or exposes a dead edit affordance.
- The Learning Panel has a persistent shell launcher and receives current-page context for user questions.

## Out of Scope

- major IA changes beyond these feedback items
- changing core tournament execution semantics
- open web research in the Learning Panel
- broader builder-mode expansion
