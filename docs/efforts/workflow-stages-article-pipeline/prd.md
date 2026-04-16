# Workflow Stages & Two-Step Article Pipeline — PRD

**Intention**: [./intention.md](./intention.md)
**Created**: 2026-04-16
**Status**: Draft

## 1. Overview

Restructure the prediction cycle around **five named, first-class workflow stages** and split article processing into a **two-step pipeline** so expensive per-analyst work only fires on already-relevant material. Reorder the cycle so **Risk Assessment runs before Prediction Generation**, making predictions derive from an analyst's updated holistic risk view rather than being critiqued after the fact.

This is the foundation for the architecture restructure block. Subsequent efforts (`stage-keyed-analyst-contracts`, `instrument-contracts`, `user-authored-custom-content`, `triple-model-reasoning-continuity`) all reference these stages — they cannot land until stages exist as code-level concepts.

## 2. Goals & Success Criteria

From the intention's Success Criteria (all must hold at the end of the effort):

- **G1 — Stages as named concepts in code.** A single `WorkflowStage` enum exists; every analyst invocation declares which stage it belongs to (in service code, in `market_run_artifacts`, and in observability events). The five stages are: `article_processing`, `predictor_generation`, `risk_assessment`, `prediction_generation`, `learning`.
- **G2 — Article processing is genuinely two-step.** Step 1 (instrument-keyed relevance, no analyst) decides which instruments an article touches. Step 2 (per-analyst predictor generation) only fires for (instrument, analyst) pairs where Step 1 declared the article relevant to the instrument.
- **G3 — Risk runs before Prediction in the cycle.** `AnalystPipelineService.runPipeline` writes fresh per-analyst risk assessments after predictor generation, and prediction generation reads those just-written risk rows. Measured by: in a fresh cycle, every `market_predictions` row's `source_context` references an `analyst_risk_assessments` row written in the same cycle.

### Measurable acceptance
- `SELECT count(*) FROM market_predictors mp WHERE NOT EXISTS (SELECT 1 FROM article_instrument_relevance air WHERE air.article_id = mp.article_id AND air.instrument_id = mp.instrument_id AND air.is_relevant = true)` returns **0** after the new pipeline runs.
- Every row in `market_run_artifacts` written after cutover has a non-null `workflow_stage` column.
- For each prediction run `r`, `max(analyst_risk_assessments.created_at WHERE instrument_id = r.instrument_id) > max(market_predictors.updated_at WHERE instrument_id = r.instrument_id) - interval '5 minutes'`, i.e. risk is fresher than predictors at prediction time.

## 3. User Stories / Use Cases

- **As a developer extending the analyst system**, I can point at a single `WorkflowStage` enum to answer "at what stage is this analyst invocation?" — today that requires reading multiple service files.
- **As the `stage-keyed-analyst-contracts` effort downstream**, I can key contract sections by stage (`article_processing` vs `risk_assessment` vs `prediction_generation`) because stages exist as first-class values.
- **As the orchestration pipeline on Spark (Ollama serial, one inference at a time)**, I stop burning cycles scoring every article through every analyst for every instrument. Articles the instrument isn't touched by skip the analyst fanout entirely.
- **As a user reading an analyst's prediction**, the reasoning I see reflects the analyst's *current* risk view for that instrument — not stale risk from the previous cycle.
- **As an operator watching the pipeline**, observability events carry `workflow_stage` so I can filter logs/metrics by stage.

## 4. Technical Requirements

### 4.1 Architecture

**New shared module: `apps/api/src/markets/workflow-stages/`**

- `workflow-stage.ts` — exports `WorkflowStage` enum with the five named values and a `WORKFLOW_STAGE_ORDER` array defining cycle ordering: `[article_processing, predictor_generation, risk_assessment, prediction_generation, learning]`.
- `stage-label.ts` — human-readable labels for UI/observability (not required for behavior; trivial to add).

**Orchestration: `AnalystPipelineService.runPipeline()` new ordering**

Current (apps/api/src/markets/services/analyst-pipeline.service.ts:77–139):
```
Crawl → Predictor Gen → (Fear/Greed) → Prediction Gen → (Contrarian) → Outcomes
```

New:
```
Crawl
  → Stage 1: Article Processing (instrument-keyed relevance)
  → Stage 2: Predictor Generation (gated by Stage 1)
  → (Fear/Greed — unchanged)
  → Stage 3: Risk Assessment (per-analyst, per-instrument; for instruments with new predictors)
  → Stage 4: Prediction Generation (reads just-written risk)
  → (Contrarian — unchanged)
  → Outcomes
  → Stage 5: Learning (already post-outcome; now explicitly labeled)
```

**Risk Assessment shape decision (resolves intention Open Question — revised per master-intention §3.5).**

Stage 3 has **two sub-components**, both invoked in the cycle:

- **Stage 3a — per-analyst risk reflection:** for each (instrument, analyst) with new predictors, the analyst produces a first-person holistic risk view integrating the new predictors with its prior risk view, writing to `analyst_risk_assessments`. Rationale: the intention defines risk as "the analyst's full story on this instrument" — a per-analyst first-person shape.
- **Stage 3b — Red/Blue/Arbiter risk debate:** the existing `RiskDebateService` (Blue / Red / Arbiter multi-agent debate, apps/api/src/markets/services/risk-debate.service.ts) is invoked after Stage 3a. It consumes the just-updated per-analyst reflections and produces the multi-agent adversarial synthesis that users see as "the AI arguing with itself." This is first-class explainability UX — not an optional on-demand feature — and stays in the cycle path.

Participant-set filtering per master-intention §3.5: base instruments run a standard shared debate once; base instruments with viewer-specific custom analyst associations trigger *additional* per-viewer debate runs including those custom analysts; custom (user-authored) instruments run their debate only for the author, across analysts they associated. Per-viewer debate runs are additive compute paid for by the author's per-item authorship fees.

**Relevance mechanism decision (resolves intention Open Question).**

Step 1 uses a two-tier check per (article, instrument):
1. **Keyword pre-filter** (cheap, deterministic): the existing `quickKeywordCheck` logic from `predictor-generator.service.ts:365–386`. If score ≥ 0.7 (symbol match or full-name match), mark `is_relevant=true` without an LLM call.
2. **LLM classification** (nuanced) for ambiguous cases (keyword score between 0 and 0.7): a single analyst-agnostic LLM call per (article, instrument) producing `{ is_relevant: bool, rationale: string }`. One call per pair — not per-analyst.

No embeddings in scope — keeping infra minimal. The `instrument-contracts` effort (out of scope here) will later introduce an instrument-level contract section that refines Step 1's system prompt.

**Backwards compatibility decision (resolves intention Open Question).**

No migration of historical records. Existing `market_predictors`, `market_risk_assessments`, `risk_composite_scores`, `analyst_risk_assessments`, `market_predictions` rows are untouched. The new `article_instrument_relevance` table is additive; new pipeline runs populate it. Old artifacts keep their current shape (no stage column backfill); only new artifacts written after cutover carry `workflow_stage`.

### 4.2 Data Model Changes

**New table: `prediction.article_instrument_relevance`**

```sql
create table if not exists prediction.article_instrument_relevance (
  id text primary key,
  article_id text not null references prediction.market_articles(id) on delete cascade,
  instrument_id text not null references prediction.instruments(id) on delete cascade,
  is_relevant boolean not null,
  relevance_method text not null check (relevance_method in ('keyword', 'llm')),
  keyword_score numeric,
  llm_rationale text,
  llm_usage_id uuid,
  created_at timestamptz not null default now(),
  unique (article_id, instrument_id)
);

create index article_instrument_relevance_article_idx
  on prediction.article_instrument_relevance (article_id);
create index article_instrument_relevance_relevant_idx
  on prediction.article_instrument_relevance (instrument_id, is_relevant)
  where is_relevant = true;
```

Owner: add to `markets-schema.service.ts` alongside other DDL.

**New column: `prediction.market_run_artifacts.workflow_stage text`**

```sql
alter table prediction.market_run_artifacts
  add column if not exists workflow_stage text;
create index if not exists market_run_artifacts_workflow_stage_idx
  on prediction.market_run_artifacts (workflow_stage)
  where workflow_stage is not null;
```

Nullable (old rows remain null; new rows required non-null at write time, enforced in service code, not DB).

**No schema change** to: `market_predictors`, `market_predictions`, `analyst_risk_assessments`, `risk_composite_scores`, `risk_debates`, `market_articles`. Their existing keys already support the reshaped flow.

### 4.3 API Changes

No public REST contract changes. All reshaping is internal to:
- `AnalystPipelineService.runPipeline` (adds the new stage calls)
- `PredictorGeneratorService.runGeneration` (consults `article_instrument_relevance` before fanout)
- New `ArticleRelevanceService` (Stage 1 owner)
- `RiskRunnerService` gains a new per-analyst entry point (`executePerAnalystRiskPass` — internal method used by the pipeline; existing `executeRiskRun` unchanged)

Observability events:
- New event types: `pipeline.article_processing.*`, `pipeline.risk_assessment.*` (following existing `pipeline.predictor.*` and `pipeline.prediction.*` conventions in `PredictorGeneratorService.emit` and `AnalystPipelineService`).
- All existing events in the affected services add a `workflow_stage` field to their payload.

### 4.4 Frontend Changes

None in scope. The pipeline reshape is internal. If admin UIs surface stage labels in a later pass, that's a follow-up effort.

### 4.5 Infrastructure Requirements

- Uses existing local Ollama (`gemma4:e4b` for relevance, per project local-models memory) via `MarketsLlmService.generateText`. No new models, no new infra.
- Serial Ollama constraint holds: Step 1 LLM calls run sequentially (already the pattern in `predictor-generator.service.ts`).
- DB schema evolves via `MarketsSchemaService.ensureSchema` (idempotent `create table if not exists`), consistent with how every other table in `prediction` is managed.

## 5. Non-Functional Requirements

- **Performance**: total LLM calls per cycle must drop or stay flat. Baseline: current cycle does `articles × instruments × analysts` LLM calls in Step 2. New cycle does `articles × instruments` Step-1 calls (only on keyword-ambiguous pairs) + `(articles × instruments × analysts filtered by Stage 1)` Step-2 calls. For any realistic dataset where most (article, instrument) pairs are irrelevant, total calls drop materially. Target: ≥30% fewer Step-2 calls on a mixed test dataset.
- **Security**: no new attack surface. No user-supplied SQL. All new queries use `db.rawQuery` with parameter binding, matching the convention in every other service.
- **Scalability**: stages are independent units; each can later be parallelized or moved to a queue without reshaping schema. `article_instrument_relevance` has `(article_id, instrument_id)` uniqueness — cheap upserts.
- **Compatibility**: no breaking change to existing endpoints or stored data. Rollback plan: the pipeline change is feature-flagged behind `MARKETS_STAGES_V2=true` (falls back to current flow if unset) for the first phase; removed once stable.
- **DI convention** (CLAUDE.md): every new constructor parameter gets `@Inject(ClassName)` — no type-based DI.
- **Language** (legal memory): Stage-related copy/logs use "analysis/signal" not "advice/recommendation".

## 6. Out of Scope

- **Stage-keyed contracts** — separate effort (`stage-keyed-analyst-contracts`) that partitions contract markdown by stage. This effort only introduces the stages; the contracts stay monolithic for now.
- **Instrument contracts** — separate effort (`instrument-contracts`) that gives instruments a first-class contract entity. Step 1's LLM prompt uses a stub system prompt that references instrument name/symbol/description; instrument-contracts later replaces that stub.
- **User-authored custom content** — separate effort (`user-authored-custom-content`). This effort makes no assumptions about who authored an analyst/instrument/article; all flows operate on the existing records regardless of provenance. Per-viewer debate filtering in Stage 3b uses simple participant-set logic that extends naturally once custom authorship arrives.
- **Migration of historical records** — old `market_predictors`, `market_run_artifacts`, etc. stay as-is.
- **UI surfacing of stages** — observability events expose stage labels, but no admin/user UI work here.
- **Parallelization of the pipeline** — Ollama is serial on Spark (project memory); all stages run sequentially in-process.
- **Concurrency with the prior cycle flow** — the feature flag deletion in Phase 6 is planned, but if both flows need to coexist for longer than one release, that is handled outside this effort.

## 7. Dependencies & Risks

**Dependencies**
- None external. This is the foundation effort; everything else in the architecture block depends on *it*.

**Risks & Mitigations**

| Risk | Mitigation |
|---|---|
| Stage 1 LLM misclassifies a genuinely relevant article as irrelevant, silently dropping analyst signal | Keyword tier bypasses LLM for symbol/name matches; Stage 1 result logged with `llm_rationale`; manual recovery path: `article_instrument_relevance` rows are upsertable, so setting `is_relevant=true` for a (article, instrument) pair reopens the analyst fanout next cycle. |
| Per-analyst risk pass in Stage 3 materially lengthens cycle time (N analysts × M instruments with new predictors × 1 LLM call each) under serial Ollama | Gate Stage 3 to instruments with **new** predictors this cycle (not all active instruments); cap per-cycle workload via same `MARKETS_STAGES_V2_RISK_BATCH_LIMIT` env var pattern used elsewhere; Phase 3 measures cycle time against baseline. |
| Blue/Red/Arbiter being removed from the cycle breaks downstream readers (e.g., `PredictionRunnerService.getLatestRiskComposite` fallback) | `getLatestRiskComposite` already has a legacy fallback chain (risk_composite_scores → market_risk_assessments); we keep both read paths. Prediction runner also reads `analyst_risk_assessments`, which Stage 3 now writes. |
| Feature flag drift — `MARKETS_STAGES_V2` staying off in prod indefinitely | Phase 6 removes the flag once Phase 5 has run green for a full cycle on Spark. |
| `tsx` runtime DI (CLAUDE.md) breakage from new service additions | All new constructors use `@Inject(ClassName)` explicitly — verified in each phase's gate. |

## 8. Phasing

Each phase is independently validatable, lands behind the `MARKETS_STAGES_V2` flag until Phase 6, and ends with a quality gate (lint, build, unit, smoke, curl, phase review).

### Phase 1 — Stage taxonomy infrastructure (no behavior change)

- Add `WorkflowStage` enum + ordering array in `apps/api/src/markets/workflow-stages/`.
- Add `workflow_stage` column to `market_run_artifacts` (nullable).
- Thread a `workflow_stage` parameter through the existing artifact write in `PredictionRunnerService` (both per-analyst and arbitrator paths) — annotate with `prediction_generation` for now.
- Annotate existing observability event payloads in `PredictorGeneratorService` and `PredictionGeneratorService` with the relevant stage label.

**Exit**: running the current cycle produces artifacts with populated `workflow_stage`, values drawn from the enum, no functional change otherwise.

### Phase 2 — Step 1: instrument-keyed article relevance

- Create `prediction.article_instrument_relevance` table.
- Create `ArticleRelevanceService` with `classifyNewArticles(instruments, articles)` — keyword tier then LLM tier for ambiguous pairs.
- Call `classifyNewArticles` from `AnalystPipelineService.runPipeline` **before** `predictorGenerator.runGeneration()`.
- Behavior for Step 2 (Predictor Generation) unchanged in this phase — it still fans out through all analysts; we're just populating the relevance table.

**Exit**: after a cycle, `article_instrument_relevance` has rows for every (new-article × active-instrument) pair; old predictor generation behavior unchanged.

### Phase 3 — Step 2: gate predictor generation by relevance

- Modify `PredictorGeneratorService.getUnscoredArticles` to consult `article_instrument_relevance` and only return articles where `is_relevant=true` for the given instrument.
- Behind `MARKETS_STAGES_V2`: flag off → old behavior; flag on → new gated behavior.
- Add a metric counting articles skipped due to relevance gate.

**Exit**: with flag on, zero `market_predictors` rows are created for (article, instrument) pairs flagged `is_relevant=false`.

### Phase 4 — Stage 3 (3a + 3b): per-analyst risk reflection + multi-agent debate (pre-prediction)

**Stage 3a — per-analyst risk reflection:**
- Add `RiskRunnerService.executePerAnalystRiskPass(instrumentIds)` — for each enabled personality analyst, run one LLM call integrating new predictor lines with the analyst's previous `analyst_risk_assessments` row, writing a new row.
- Wire the pass into `AnalystPipelineService.runPipeline` between predictor generation and prediction generation; gate by instruments whose predictors were added/updated this cycle.

**Stage 3b — Red/Blue/Arbiter risk debate:**
- Invoke existing `RiskDebateService` after Stage 3a completes for each instrument whose 3a run produced fresh reflections
- Participant set per master-intention §3.5 per-viewer filtering:
  - For base instruments with no viewer customizations: one shared debate run across base analysts (serves every base viewer)
  - For base instruments with viewer-specific custom analyst associations: additional per-viewer debate runs including those custom analysts
  - For user-authored custom instruments: one debate run for that author across analysts they explicitly associated
- Debate writes to `risk_debates` table (existing schema) with stage metadata

Both sub-stages behind the same `MARKETS_STAGES_V2` flag. Flag off → neither sub-stage fires (current behavior); flag on → 3a runs, then 3b runs using 3a's outputs.

**Exit**: with flag on, `analyst_risk_assessments` has fresh rows for every instrument whose predictors moved this cycle (from 3a), AND `risk_debates` has fresh rows for those same instruments (from 3b). Prediction generation (unchanged in this phase) reads per-analyst reflections via existing `prediction-runner.service.ts:224–235`, and gains access to debate synthesis for richer reasoning context.

### Phase 5 — Acceptance: measurable freshness + full-cycle validation

- Tighten `PredictionRunnerService` to log a warning when the latest `analyst_risk_assessments` timestamp for an (analyst, instrument) is older than the latest `market_predictors.updated_at` for that instrument (indicates risk missed this cycle; should be zero occurrences under flag-on).
- Add an end-to-end smoke test in `apps/api/tests/markets/` that runs a full cycle with `MARKETS_STAGES_V2=true` on a seeded dataset and asserts the Goals G1–G3 acceptance queries from §2.

**Exit**: smoke test passes; zero warnings in the freshness check on a seeded run.

### Phase 6 — Cutover + flag removal

- Remove `MARKETS_STAGES_V2` branching. New cycle becomes the only cycle.
- Update `AnalystPipelineService` header docstring (lines 17–30) to describe the five-stage flow.
- Update `docs/efforts/current/workflow-stages-article-pipeline/` notes folder with any decisions made during implementation that downstream efforts should know.

**Exit**: flag deleted; old code path removed; downstream efforts (`stage-keyed-analyst-contracts`, etc.) can reference `WorkflowStage` directly.
