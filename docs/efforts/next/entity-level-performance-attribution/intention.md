# Effort: Entity-Level Performance Attribution (P&L)

## Problem

The existing performance dashboard (`performance-dashboard`, shipped) surfaces equity curves, analyst leaderboards, and calibration data at the analyst level. That's useful but incomplete. The master intention makes performance attribution **load-bearing** across the product — it's how:

- Authors answer "what did my AAPL analyst earn me this month?"
- The system identifies high-performing custom content worth inviting for graduation
- The community board advertises graduated content with credible track records
- Divinr itself understands which base instruments, sources, and analyst combinations actually generate value
- Students and power users make data-informed decisions about what to enable and what to author

Without multi-dimensional performance attribution, the graduation mechanism is guesswork, the community board is "trust me, it's good," and authors have no way to measure the value of their work.

## Intention

Build a **multi-dimensional performance attribution system** that tracks prediction outcomes and P&L across every relevant entity and aggregates across arbitrary combinations: per triple, per analyst, per instrument, per source, per article, per author, per stage, per arbitrary slice.

## Scope

### Core Data Model

- **Outcome records** — when a prediction resolves (EOD close, cycle end, whatever the evaluation trigger is), produce a structured outcome attached to the triple: predicted direction, actual direction, predicted magnitude, actual magnitude, attributable P&L in the paper-trading sense
- **Attribution chains** — each outcome is back-traced: which article(s) contributed predictors, which source(s) those came from, which risk view was in effect, which contract version was active. Every entity in the chain gets credited (or debited).
- **Aggregation views** in SQL or a materialized layer:
  - Per-triple (author × analyst × instrument) hit rate, P&L, calibration
  - Per-analyst aggregated across all its triples (base + user personas)
  - Per-instrument aggregated across all analysts
  - Per-source aggregated across all articles that cited it
  - Per-article aggregated across all predictors that drew from it
  - Per-author aggregated across all their authored content
  - Arbitrary N-way aggregates (analyst × source, instrument × source, etc.)

### User-Facing Surfaces

- **Author dashboard** — "Your authored content: 3 instruments, 2 analysts. This month: your custom China-AAPL contract produced +$142 of paper P&L across 7 predictions (67% hit rate)."
- **Instrument deep-dive** — "AAPL this week: the system produced $X across all base + user-authored views. Top-performing triple: [Aggressive Growth × base AAPL]. Worst: [Risk-Averse × user-X's ESG-AAPL contract]."
- **Source quality page** — "Reuters: 342 articles contributed to predictions this month, average P&L per prediction $4.27. SCMP: 88 articles, average $-1.02."
- **Community board entries** — each graduated item displays lifetime performance attribution from when it was user-authored + performance since graduation
- **Graduation suggestion surface** (admin + author) — "Your content is performing in the top decile; consider donating"

### System-Facing Uses

- Feeds `custom-to-base-graduation` with the data that makes graduation decisions defensible
- Feeds `cost-modeling-system` with a "value per compute dollar" metric — instruments/analysts that generate high P&L per compute spent are where Divinr should invest base-layer expansion
- Feeds admin dashboards for "what's working / what's not" at the system level

### Paper vs. Real P&L

- At beta, all P&L is paper — simulated against historical prices at prediction resolution time
- Post-beta with real money, the system needs to distinguish paper vs. real attribution cleanly (real outcomes may diverge from paper due to slippage, fees, execution timing)
- Schema should accommodate both from v1 (a `pnl_type` column, values: `paper` / `real`)

### Performance of the Attribution System Itself

- Aggregations across hundreds of thousands of outcomes need to stay performant
- Materialized rollup tables for common aggregation patterns (per-triple daily, per-analyst monthly, etc.)
- Ad-hoc query surface for custom slices (analyst × source × time-range)

## Open Questions for PRD Phase

- What's the P&L accounting model — simple "predicted up + actually up = +1 point, weighted by confidence" calibration-style scoring, or a richer simulated-trade model with position sizing and actual dollar-P&L?
- How do we handle predictions that straddle multiple sources/articles? Equal attribution? Weighted by confidence? By predictor freshness?
- What's the time window for attribution? Per-cycle, per-day, per-week, since-inception? Probably: all of the above, with summary rollups.
- Does the community board show *lifetime* performance or *trailing 30-day* performance? (Probably both — lifetime for track record, trailing for recent relevance.)
- How do we surface per-author earnings (attributed P&L) alongside their per-item pricing to make the ROI of authoring visible?
- For authors of content that underperforms: do we surface that negatively ("your analyst has lost $X this month") or quietly? (UX/psychology question.)

## Success Criteria

- Any prediction outcome can be traced back to its contributing article, source, analyst, instrument, contract version, author, and produce a per-dimension attribution
- Aggregation queries across any combination of dimensions return in < 1 second for typical time windows (month, quarter)
- An author can see per-triple, per-item P&L in their dashboard without a confusing analytics interface
- The system can produce a ranked list of "top-performing custom content" for graduation candidate surfacing
- Divinr admins can answer "what did the system make on AAPL this week?" in one query

## Out of Scope

- Real-money trading mechanics (predictions are paper at beta; real-money integration is future)
- Multi-user / team-level aggregation (everything is per-author)
- Historical backfill of pre-this-effort outcomes (start fresh from landing; old records get `attribution_source = 'legacy'` and aren't deeply queryable)

## Dependencies

- `triple-model-reasoning-continuity` — attribution keys off the triple
- Basic outcome evaluation (already shipped in the nightly evaluation cycle) — this effort extends it with full attribution chains

---

*Elevated from a bullet in the master intention to a dedicated effort. This is load-bearing for author retention, graduation decisions, and community marketing.*
