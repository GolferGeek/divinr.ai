# Effort: LLM Usage Logging

## Problem

Every LLM call in the system — Stage 1 article relevance, Stage 2 predictor generation, Stage 3a per-analyst risk reflection, Stage 3b Red/Blue/Arbiter debate, Stage 4 prediction generation, Stage 5 learning, audit passes — has a cost and a provenance, but today there's no structured log that captures both at call-site resolution. Without one:

- `cost-modeling-system` has no input to calibrate per-model averages from
- `entity-level-performance-attribution` can't back-trace an outcome to the specific articles, sources, and LLM calls that contributed
- `stripe-integration` can't bill student cost-pass-through users accurately
- `regression-testing-harness` can't compare compute cost deltas across model choices
- `custom-to-base-graduation` can't cite "this custom analyst earned X for N compute dollars" — the numerator and denominator both live only in fragmented logs or not at all

## Intention

Build a **structured LLM call log** that captures every call with enough dimensional context to answer any aggregation query downstream systems need: per-user, per-triple, per-stage, per-sub-stage, per-model, per-article, per-source, per-time-window, or any combination. This is purely *capture and query* infrastructure — no pricing logic, no estimation, no forecasting. Those are downstream systems that consume this log.

## Scope

### Schema

New table `prediction.llm_usage_log`:

| Column | Type | Description |
|---|---|---|
| `id` | uuid (primary key) | |
| `timestamp` | timestamptz | when the call was issued |
| `article_id` | text (nullable) | FK — if call is article-triggered |
| `instrument_id` | text (nullable) | FK — if call relates to a specific instrument |
| `analyst_id` | text (nullable) | FK — if call is per-analyst |
| `billed_user_id` | text (nullable) | who gets billed for this call (triple owner); NULL = Divinr pays (base content) |
| `analyst_author_user_id` | text (nullable) | who authored the analyst; **NULL = base analyst, NOT NULL = user extension** |
| `instrument_author_user_id` | text (nullable) | who authored the instrument; **NULL = base instrument, NOT NULL = user extension** |
| `stage` | text | `article_processing`, `predictor_generation`, `risk_assessment`, `prediction_generation`, `learning`, `audit`, `other` |
| `sub_stage` | text (nullable) | `red`, `blue`, `arbiter`, `reflection`, `none` — granularity within a stage (esp. for the Stage 3 sub-stages 3a/3b) |
| `model` | text | `gemma4:e4b`, `gemma4:26b`, `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-6`, `gpt-4o`, etc. |
| `provider` | text | `local-ollama`, `anthropic`, `openai`, `openrouter`, etc. |
| `via_byo_key` | boolean | true if routed through the user's own API credential |
| `tokens_in` | integer | |
| `tokens_out` | integer | |
| `cost_cents` | integer (nullable) | computed from provider price × tokens; NULL for local-ollama or BYO (Divinr didn't pay) |
| `latency_ms` | integer | |
| `prompt_hash` | text (nullable) | for dedup analysis / caching investigations |
| `output_hash` | text (nullable) | for comparing output determinism across runs |
| `cycle_id` | text (nullable) | which pipeline cycle run this call belonged to (if applicable) |
| `error` | text (nullable) | error message if the call failed |
| `metadata` | jsonb (nullable) | escape hatch for call-site-specific context |

Indexes on `(billed_user_id, timestamp)`, `(analyst_author_user_id, timestamp)`, `(instrument_author_user_id, timestamp)`, `(instrument_id, timestamp)`, `(analyst_id, timestamp)`, `(stage, timestamp)`, `(cycle_id)`.

**Why the two `*_author_user_id` columns:** they let queries quickly distinguish base vs. user-extension content without joining back to the analyst/instrument tables. Key queries the schema supports directly:
- "How much did we spend on **custom analysts** this month?" → `WHERE analyst_author_user_id IS NOT NULL`
- "How much did we spend on **custom instruments** this month?" → `WHERE instrument_author_user_id IS NOT NULL`
- "How much did this specific user's extensions cost the system?" → `WHERE analyst_author_user_id = X OR instrument_author_user_id = X`
- "How much did base compute cost this month?" → `WHERE analyst_author_user_id IS NULL AND instrument_author_user_id IS NULL`
- "How much did this user get billed?" (regardless of whose authored content) → `WHERE billed_user_id = X`

### Instrumentation

- Every LLM call in the codebase is routed through (or reports to) a single helper: `LlmUsageLogger.record({ ... })` called either via a wrapped LLM client or via explicit calls in service code
- `MarketsLlmService.generateText` and similar entry points gain required dimensional parameters (`stage`, `sub_stage`, `author_user_id`, and contextual IDs) — callers must supply them
- Stage 1 `ArticleRelevanceService`, Stage 2 `PredictorGeneratorService`, Stage 3a `RiskRunnerService.executePerAnalystRiskPass`, Stage 3b `RiskDebateService` (Red/Blue/Arbiter — three calls, each logged with distinct `sub_stage`), Stage 4 `PredictionRunnerService`, Stage 5 learning — all updated to supply the required context

### Aggregation Views

Materialized views or rollup tables for common query patterns:

- `llm_usage_per_user_monthly` — `(billed_user_id, year_month) → total_calls, total_tokens_in, total_tokens_out, total_cost_cents`
- `llm_usage_per_triple_daily` — `(billed_user_id, analyst_id, instrument_id, date) → same aggregates`
- `llm_usage_per_stage_daily` — `(stage, sub_stage, date) → same aggregates`
- `llm_usage_per_model_daily` — `(model, provider, date) → same aggregates`
- `llm_usage_per_source_monthly` — `(source_id, year_month) → same` (joined through article_id)
- `llm_usage_per_analyst_authorship_monthly` — `(analyst_author_user_id, year_month) → same` (how much compute does each user's authored analysts trigger?)
- `llm_usage_per_instrument_authorship_monthly` — `(instrument_author_user_id, year_month) → same` (how much compute does each user's authored instruments trigger?)
- `llm_usage_base_vs_extension_daily` — `(date, was_base_only, was_extension) → same` where `was_base_only` means both author columns NULL and `was_extension` means at least one NOT NULL

Views refresh on a cadence (daily nightly or hourly — PRD decision).

### Query Surface

- Admin dashboard exposes slice-by-any-dimension views — "Show me last week's LLM spend by (stage × model)" or "Show me author @golfergeek's usage this month"
- Per-user usage page (for students: their real-time cost accrual; for all users: monthly summary)
- Downstream effort APIs: cost-modeling, performance-attribution, billing all query this data through well-defined aggregation endpoints rather than raw table scans

### Retention

- Raw `llm_usage_log` rows retained indefinitely for first N days (30? 90? — PRD), then rolled up and pruned
- Aggregation views retained indefinitely (they're small)
- Admin can configure retention via env vars

## Open Questions for PRD Phase

- `cost_cents` calibration at log time vs. at query time: compute-on-write gives fast reads but requires knowing model prices; compute-on-read is flexible but slower. Probably compute-on-write using a `model_pricing` lookup table that cost-modeling-system maintains.
- Call dedup: if the same prompt runs twice with the same output, do we store both rows or dedup? (Probably both — accurate usage, not deduped cost.)
- How much of the instrumentation is mandatory vs. best-effort? (Mandatory for v1 — every call must log, no silent calls.)
- Schema evolution: `metadata` jsonb as escape hatch for evolving per-call-site context without migrations. Enforce discipline — promote to first-class column when a pattern stabilizes.
- Does `prompt_hash` capture the full merged prompt, or just the user-supplied portion? (Probably full merged — it's the true unit of LLM work.)

## Success Criteria

- Every LLM call in the system produces exactly one `llm_usage_log` row
- Aggregation queries across any reasonable time window return in under 1 second
- A user's monthly compute cost is queryable in one aggregation hit
- A triple's lifetime compute cost is queryable in one aggregation hit
- Downstream systems (cost-modeling, performance-attribution, billing) pull from this log without needing to re-instrument calls themselves

## Out of Scope

- Pricing logic / calibration / prediction — lives in `cost-modeling-system`
- Billing-facing user presentation — lives in `stripe-integration` and its UI layer
- P&L attribution across outcomes — lives in `entity-level-performance-attribution`
- Regression test replays — lives in `regression-testing-harness`

## Dependencies

- `triple-model-reasoning-continuity` — usage log keys partially on `author_user_id`, consistent with the triple
- `workflow-stages-article-pipeline` — defines the `stage` enum values
- Can start independently of other efforts as pure infrastructure, but gets meaningfully used once triples and stages are live

---

*Pure infrastructure: capture every LLM call with rich dimensional context. Everything cost-and-attribution-related in the product pulls from this log. No pricing, no estimation, no billing — just structured capture and fast aggregation.*
