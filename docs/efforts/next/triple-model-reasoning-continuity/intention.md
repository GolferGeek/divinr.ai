# Effort: (Club, Analyst, Instrument) Triple as Reasoning Atom

## Problem

Today, predictors, risk views, predictions, and learning are stored keyed by (analyst, instrument) — implicitly assuming there's only one "AAPL" and one "Aggressive Growth Analyst" in the system. Once `club-authored-custom-content` lands and a club can publish their own AAPL contract or their own Aggressive Growth analyst, this key collapses meaningful distinctions:

- Two clubs' AAPL contracts produce *different* analyses through the same analyst. They need separate predictor streams, separate risk summaries, separate prediction histories.
- An analyst with multiple instrument-contract lenses on AAPL holds *different* views per lens. A unified risk summary destroys that nuance.
- Learning needs to adapt per-lens — what works for "China-aware AAPL" might not work for "ESG-tilt AAPL."

## Intention

Refactor the storage and runtime so that **(club, analyst, instrument)** becomes the atom of reasoning continuity. Predictors, risk summaries, predictions, and learning are all keyed by this triple. A single analyst running through three different instrument-contract lenses on AAPL holds three distinct, independently-evolving views.

## Scope

### Schema Migration

- Predictors table: add `club_id` to the key (or to the foreign-key chain)
- Risk summaries table: same
- Predictions table: same
- Learning/adaptation records: same
- Migration: existing records (which have implicit `club_id = base`) get backfilled with the base club's id (or a sentinel value representing "base content")

### Runtime Behavior

- Every stage that produces or consumes a predictor/risk/prediction does so against a specific triple
- Risk summaries are read and updated per-triple — Risk Assessment for triple T pulls T's prior risk view and produces T's updated view, untouched by other triples
- Prediction Generation pulls predictors and risk summary *for the same triple*

### "Personas" Conceptually

- A single analyst now runs **N personas in parallel**, one per (instrument, contract) lens it operates through
- Each persona has its own accumulating wisdom, its own bias, its own track record
- The "analyst" entity becomes more like a strategy template; the persona-per-triple is the actual reasoning unit

### Performance & Calibration

- Performance scores roll up from triple-level outcomes (an analyst's overall calibration is a function of all its personas' track records)
- Per-triple calibration becomes its own surface — "Aggressive Growth × Club X's China-aware AAPL contract" has its own hit rate
- This is rich data for the learning system to reason about

## Open Questions for PRD Phase

- For base content (no custom variants involved), what's the `club_id` value? A sentinel "base" club, or null with NOT NULL constraints relaxed?
- How does the existing leaderboard / performance UI present per-triple data without overwhelming the user?
- Migration strategy — backfill all existing records, or treat them as "base club" implicitly and migrate lazily?

## Success Criteria

- All reasoning records (predictors, risk, predictions, learning) are keyed by (club, analyst, instrument) triple
- A single analyst running through multiple instrument-contract lenses produces and maintains independent reasoning per lens
- Per-triple calibration data is queryable and surfaceable
- No regression in base-content behavior — base predictions, risk, etc. behave exactly as before, just with explicit triple keys

## Out of Scope

- The user-side UI for picking which triples to enable (separate effort: `slot-based-enablement-ui`)
- The authorship layer that creates non-base variants (separate effort: `club-authored-custom-content`, prerequisite)

## Dependencies

- `club-authored-custom-content` must land first — without authored variants, the triple model is a no-op

---

*Stub — fifth effort in the architecture restructure sequence. The atom of reasoning continuity becomes the triple.*
