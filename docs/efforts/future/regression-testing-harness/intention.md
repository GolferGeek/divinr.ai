# Effort: Regression Testing Harness (Historical Day Replay)

## Problem

The system is a learning system. Contracts evolve. Adaptations accumulate. New analysts and instruments get authored. Frontier models may be swapped in for some triples. Every one of those changes could improve behavior — or quietly degrade it. Today there's no way to know which.

Concretely:
- A contract edit "sounds" like it should help. Does it actually produce better predictions on articles we've already seen?
- Swapping gemma4 for Claude Sonnet on the risk-assessment stage: does the output get meaningfully better, or just different?
- A user-authored analyst graduating to base: did it actually outperform on historical days, or did it just look clever?
- The learning loop proposes a Tier 2 refinement: if we apply it, do next week's predictions look better or worse than last week's?

Without a replay mechanism grounded in real historical context, every change is a leap of faith and the learning loop has no honest way to validate its own proposals.

## Intention

Build a **regression testing harness** that maintains a curated library of historical "days" — full snapshots of articles, price movements, and any other input signal — that can be **replayed** through the current system configuration at any time. Compare outputs against stored baselines to detect improvement or deterioration. The replay set is under Divinr's explicit control; eventually users (paid tier) can contribute custom replay scenarios.

## Scope

### Day Snapshots

A "day" is a fully-captured historical input bundle:

- All articles ingested that day (full text, timestamp, source attribution)
- Price data for every covered instrument (open, close, intraday if available)
- Any additional signal inputs the pipeline consumes (sentiment feeds, filings, etc.)
- The state of the instrument universe at that moment (which instruments were covered)

Snapshots are immutable once captured. They're the ground truth against which future replays are compared.

### Replay Execution

Given a snapshot day and a current system configuration (analysts, contracts, instruments, model choices):

- Feed the snapshot's articles through Stage 1 (relevance against the configuration's instruments)
- Feed relevant pairs through Stage 2+ (predictor generation, risk assessment, prediction generation)
- Capture outputs: predictors produced, risk summaries generated, predictions issued, stage-by-stage LLM calls and tokens
- Store replay run keyed by (snapshot_day, system_config_hash, run_timestamp)

### Comparison & Metrics

For each replay, compare against baseline (either the original run from that day, or a prior replay):

- **Prediction calibration** — how well did predicted probabilities match actual outcomes (from the snapshot's price data)?
- **Hit rate** — directional accuracy
- **Reasoning quality** — did the arbitrator's synthesis make more or less sense? (LLM-judge pass, or human spot-check flagged for review)
- **Cost delta** — tokens in/out, estimated dollars per model tier
- **Coverage delta** — did relevance filtering catch more or fewer relevant articles?

Output is a diff report: "vs. baseline from 2026-03-12, calibration improved by 3.4%, hit rate unchanged, compute cost up 40% (switched from gemma4 to Claude Sonnet on risk stage)."

### Replay Set Management

- Admin UI to view the current replay set: which days are captured, when each was added, any annotations
- Admin action: "snapshot today" — captures current day as a replay-set entry going forward
- Admin action: "delete day" — remove a snapshot if it's no longer useful
- Admin action: "run full regression" — replay all days in the set, produce aggregate report

### Target Set Size (Env-Configurable)

- `REGRESSION_SET_TARGET_DAYS` default: 30 (a month of trading days)
- Auto-snapshot: optional daily job that captures today into the set, oldest gets aged off
- Override: specific days can be pinned (e.g., "the day of the NVDA earnings surprise that all analysts got wrong — we want that one permanently in the set")

### Use in the Learning Loop

- When Tier 2 or Tier 3 learning loop proposes a contract refinement, replay it against the regression set before approving
- Approval criteria can be codified: "improvement on calibration by ≥ X% on at least Y days"
- Failed replays don't block the proposal but surface the degradation for human review

### Custom Scenarios (future, paid tier)

- Power users (paid) can contribute days to *their own* replay set for their authored content
- They curate the scenarios they care about: "my custom China-AAPL analyst on days of major China policy announcements"
- Billable as a premium add-on (or included in higher-end authorship tier — PRD decision)
- Never crosses the user boundary — their custom replay sets don't affect Divinr's base regression set

## Open Questions for PRD Phase

- Storage scale — full article text for 30+ days across all covered instruments could be gigabytes. Compress? Externalize to object storage?
- LLM-judge for reasoning quality: which model judges, how is "quality" scored, how do we prevent the judge from becoming a gameable target?
- How often do we snapshot — every trading day automatically, or admin-triggered only at launch?
- Replay speed — replays could take a while (30 days × hundreds of articles × N stages × M models). Parallelize? Run overnight? Cache intermediate results?
- Backfill: can we retroactively create day snapshots from our existing article/price logs, or is the set purely forward-looking from this effort's launch?
- How are snapshots versioned — if we later realize a day was captured with a bug in our article ingestion, do we re-snapshot or accept the imperfect record?

## Success Criteria

- The system maintains at least 30 days of replay-ready snapshots
- A regression replay against the current configuration produces a structured diff vs. baseline within a reasonable time window (overnight acceptable; minutes ideal)
- Contract proposals from the learning loop are validated against the regression set before approval
- An admin can view the regression set, trigger full replays, and see improvement/deterioration at a glance
- Graduated content (via `custom-to-base-graduation`) can cite regression-test performance as part of its promotion case

## Out of Scope

- User-contributed replay scenarios (future — noted above as paid-tier feature)
- Real-time A/B testing against live users (this is offline replay, not production split traffic)
- Simulation of counterfactual articles ("what if NVDA had beat instead of missed") — snapshots are ground truth, not generated alternatives

## Dependencies

- `triple-model-reasoning-continuity` — replays key off triples; need the keyed storage
- `entity-level-performance-attribution` — provides the metric machinery (calibration, hit rate, P&L) that replays report against
- `cost-modeling-system` — replays compare cost deltas across model choices

---

*A replay-based regression testing system grounded in real historical inputs. Turns "learning loop claims this helped" from faith into evidence. Foundational for any change to contracts, model selection, or graduated content.*
