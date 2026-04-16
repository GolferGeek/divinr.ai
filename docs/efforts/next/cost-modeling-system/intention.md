# Effort: Cost Modeling System (Calibration, Prediction, Pricing)

## Problem

Once `llm-usage-logging` captures every LLM call with its dimensional context, we still need a layer that turns that raw data into **defensible pricing decisions**: per-model cost calibration from real samples, per-user monthly cost prediction, experimentation infrastructure to compare models on identical inputs, and dashboards exposing the economic picture.

Without this layer:

- Student cost-pass-through billing is uncalibrated — we pass *through* what cost?
- Per-item authorship pricing ($20/instrument, $60/analyst) is guesswork — does it recover cost + markup?
- BYO API key platform fee is unpriced — no comparison point to "Divinr's cost per equivalent call"
- Model upgrade decisions (route some analyst calls to Sonnet, some to Opus) have no cost/quality tradeoff data

## Intention

Build the analytical layer that consumes `llm-usage-logging` data and produces: rolling per-model cost averages, per-user configuration-to-cost predictions, experimentation mode for comparing models on identical inputs, and admin/user-facing cost dashboards. No raw instrumentation — that's logging's job. Pure consumer of captured data.

## Scope

### Per-Model Cost Calibration

- Rolling averages from `llm_usage_log` samples, per `(model, provider)` pair
- Maintained in a `model_pricing` lookup table: `model`, `provider`, `per_million_tokens_in_usd`, `per_million_tokens_out_usd`, `last_calibrated_at`, `samples_count`, `rolling_avg_cost_cents_per_call`
- Refreshed weekly (or on-demand) from log samples
- Auto-detects when a provider changes pricing (variance spike in samples) and flags for manual review

### Per-User Cost Prediction

- Given a user's current configuration (enabled triples, authored content, model choices per triple, source selections), predict their monthly compute cost
- Inputs: article volume (baseline from logs), relevance hit rate (from log aggregations), per-stage call counts, model-cost averages
- Output: predicted monthly cost in dollars, with a headroom factor (e.g., `predicted × 1.25`) for variance
- Exposed via an API: `POST /billing/predict-cost { user_id, configuration_override? }` → `{ predicted_monthly_cents, confidence_range, breakdown_by_stage }`

### Pricing Defensibility View

- Admin dashboard: "Does our per-item pricing ($20 instrument / $60 analyst) actually recover cost + markup?"
- Shows historical cost per authored item type vs. per-item fee + base subscription allocation
- Flags under-priced items (cost > fee) and over-priced items (cost << fee) for pricing adjustment
- Feeds ENV-var-driven pricing adjustments: `INSTRUMENT_AUTHORSHIP_USD`, `ANALYST_AUTHORSHIP_USD`

### Student Cost-Pass-Through Billing Support

- Provides the `user_cost_cents_this_month(user_id)` query that `stripe-integration` uses to bill students
- Floor applied via `STUDENT_FLOOR_USD` env var (students who barely used the system still pay the floor)
- Cost is based on actual log data, not predictions — students get billed for what they actually consumed

### Experimentation Mode

- Admin action: "run this cycle's article relevance calls with gemma4:e4b, then again with claude-haiku, log both, compare outputs and costs"
- Produces comparison data: same input, different models, measured cost-per-call and quality-delta (via LLM-judge or human review)
- Informs model-routing decisions ("is it worth moving Stage 3b Arbiter calls to Sonnet?")

### Cost Dashboards

- **Admin system-wide dashboard** — total spend by stage, by model, by user, by time window
- **Per-user billing dashboard** — monthly summary broken down by stage, triple, model; transparent "why your bill looks like this"
- **Student real-time accrual** — "this month so far: $7.42 across 3 instruments and 2 analysts" (more granular than regular user dashboards to support educational transparency goal)
- Relies on aggregation views maintained by `llm-usage-logging`

## Open Questions for PRD Phase

- Prediction accuracy target: ± 25% is master-intention's starting point. Realistic after how many weeks of calibration data?
- How does prediction handle "first 30 days" — users with no history? Seed from global averages? Conservative high-end estimate?
- Should pricing defensibility recommendations auto-adjust env vars, or require admin approval each time?
- Experimentation mode: admin-triggered on demand, or continuous background sampling at a configured rate (e.g., 1% of calls)?

## Success Criteria

- Per-model cost averages are calibrated weekly with minimum variance bounds
- A user's predicted monthly cost is computable in one API call and returns within a reasonable time
- Student billing via `stripe-integration` pulls from this system and produces correct monthly charges
- Admin dashboard answers "are we profitable on authored-instrument pricing" at a glance
- Experimentation mode produces cost-vs-quality comparison data for at least the active model roster

## Out of Scope

- LLM call instrumentation and raw logging — separate effort: `llm-usage-logging` (prerequisite)
- P&L / prediction performance attribution — separate effort: `entity-level-performance-attribution`
- Billing flow mechanics — separate effort: `stripe-integration`
- Regression-test cost comparisons across historical replays — separate effort: `regression-testing-harness`

## Dependencies

- `llm-usage-logging` must land first — cost modeling is a pure consumer of that log
- Some cost modeling can happen with minimal dependency on other efforts — it's pricing analytics that doesn't require triples or contracts to exist

---

*Narrowed in scope after splitting instrumentation into `llm-usage-logging`. This effort is purely analytical: calibration, prediction, pricing defensibility, dashboards.*
