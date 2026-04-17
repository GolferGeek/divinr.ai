# Effort: (User, Analyst, Instrument) Triple as Reasoning Atom

## Problem

Today, predictors, risk views, predictions, and learning are stored keyed by (analyst, instrument) — implicitly assuming there's only one "AAPL" and one "Aggressive Growth Analyst" in the system. Once `user-authored-custom-content` lands and individuals can publish their own AAPL contract or their own Aggressive Growth analyst, this key collapses meaningful distinctions:

- Two users' AAPL contracts produce *different* analyses through the same analyst. They need separate predictor streams, separate risk summaries, separate prediction histories.
- An analyst with multiple instrument-contract lenses on AAPL holds *different* views per lens. A unified risk summary destroys that nuance.
- Learning needs to adapt per-lens — what works for "China-aware AAPL" might not work for "ESG-tilt AAPL."

## Intention

Refactor the storage and runtime so that **(user, analyst, instrument)** becomes the atom of reasoning continuity. Predictors, risk summaries, predictions, and learning are all keyed by this triple. A single analyst running through three different instrument-contract lenses on AAPL holds three distinct, independently-evolving views.

**Convention:** `user_id IS NULL` in the triple key means base content (global, shared, Divinr-owned). `user_id IS NOT NULL` means user-authored content, owned by that user.

## Scope

### Schema Migration

- Predictors table: add `author_user_id` (nullable) — key becomes `(author_user_id, analyst_id, instrument_id, timestamp)`
- Risk summaries table: same
- Predictions table: same
- Learning/adaptation records: same
- Migration: existing records (all base content currently) get backfilled with `author_user_id = NULL`
- Indexes on `(author_user_id, analyst_id, instrument_id)` for the hot lookup path

### Runtime Behavior

- Every stage that produces or consumes a predictor/risk/prediction does so against a specific triple
- Risk summaries are read and updated per-triple — Risk Assessment for triple T pulls T's prior risk view and produces T's updated view, untouched by other triples
- Prediction Generation pulls predictors and risk summary *for the same triple*
- Content-keyed cost model preserved: each triple runs once per article cycle, serving whoever has it enabled (though for user-authored triples, typically the author is the only enabler)

### "Personas" Conceptually

- A single analyst now runs **N personas in parallel**, one per (instrument-contract, user) lens it operates through
- Each persona has its own accumulating wisdom, its own bias, its own track record
- The "analyst" entity becomes more like a strategy template; the persona-per-triple is the actual reasoning unit

### Performance & Calibration

- Performance scores roll up from triple-level outcomes (an analyst's overall calibration is a function of all its personas' track records)
- Per-triple calibration becomes its own surface — "Aggressive Growth × user-X's China-aware AAPL contract" has its own hit rate
- Rich input for the `entity-level-performance-attribution` effort (per-analyst, per-instrument, per-user, any-combination P&L views)

### Per-Viewer Debate Filtering

- The Red/Blue/Arbiter risk debate also keys off the triple model at view time: when a user opens an instrument's debate, the participant set is filtered to analysts associated with that instrument scoped to the viewer's authorship
- Base instrument: debate participants = all base analysts associated
- User-authored addition to a base instrument: that user's view includes their custom analyst; other users' views don't see it
- Custom instrument (user-authored): debate participants = analysts the author explicitly associated with it

## Open Questions for PRD Phase

- Confirm: `author_user_id IS NULL` as the base sentinel vs. a dedicated `divinr-base` system user account — master intention picks NULL, worth double-checking against query/permission patterns during PRD.
- How does the existing leaderboard / performance UI present per-triple data without overwhelming the user? (Probably: aggregate to analyst level by default; let users drill into per-triple view.)
- Migration strategy — backfill all existing records at once, or treat unset values as "base" implicitly and migrate lazily?
- How does the sharing boolean (`shared_with_clubs`, `shared_with_users` — deferred UI) interact with triple enablement? Probably: sharing only affects *discoverability* of the triple; the triple itself still belongs to the author and runs on their compute.

## Success Criteria

- All reasoning records (predictors, risk, predictions, learning) are keyed by (author_user_id, analyst_id, instrument_id) triple
- A single analyst running through multiple instrument-contract lenses produces and maintains independent reasoning per lens
- Per-triple calibration data is queryable and surfaceable
- No regression in base-content behavior — base predictions, risk, etc. behave exactly as before, just with explicit triple keys where `author_user_id IS NULL`

## Out of Scope

- The user-side UI for picking which triples to enable (separate effort: `slot-based-enablement-ui`)
- The authorship layer that creates non-base variants (separate effort: `user-authored-custom-content`, prerequisite)
- Multi-dimensional performance attribution (separate effort: `entity-level-performance-attribution`)

## Dependencies

- `user-authored-custom-content` must land first — without authored variants, the triple model is a no-op
- `stage-keyed-analyst-contracts` and `instrument-contracts` — need the contracts whose per-stage sections combine with the triple at runtime

---

*Renamed from `(Club, Analyst, Instrument)` to `(User, Analyst, Instrument)` after the design collapsed onto individual authorship. Clubs no longer appear in the reasoning key — they're purely social.*
