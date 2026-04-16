# Instrument Contracts — Product Requirements Document

## 1. Overview

Instruments today are bare data records (`symbol`, `name`, `asset_type`, `universe_slug`, `current_state`) with no surface for expressing what the instrument cares about. The Stage 1 article-relevance classifier ([article-relevance.service.ts:152](../../../apps/api/src/markets/services/article-relevance.service.ts#L152)) uses a hardcoded generic system prompt per instrument, and Stages 2–4 (predictor generation, risk reflection/debate, prediction generation) run entirely off the analyst's contract — the instrument contributes no stage-specific framing. Two credibility gaps follow:

1. Custom instrument variants (e.g., "Club X's China-aware AAPL") cannot differ from the base instrument — there is no contract to vary.
2. Base instruments cannot express instrument-specific framing (sector dynamics, peer relationships, regulatory sensitivities, decision criteria for "is this article relevant to me?").

This effort introduces a first-class **instrument contract** entity, parallel in shape to the just-landed stage-keyed analyst contracts: `## General` + per-stage sections + `## Adaptations`, **plus** one section analysts don't have: `## Stage: Article Processing`. The runtime is wired so that Stage 1 pulls the instrument's article-processing fragment, and Stages 2–4 merge **both** the instrument's and the analyst's stage sections (plus both Generals and both Adaptations) at every LLM call site. Stage 5 (Learning) runs no LLM call today — it is algorithmic pattern-identification + canonical runner; no instrument fragment is injected there (see §4.1 and §6).

## 2. Goals & Success Criteria

**Goals:**

1. Introduce `prediction.instrument_config_versions` (lineage, version, `is_active`, `source`, `change_reason`, `parent_version_id`, `context_markdown`, `created_by`, `created_at`) and `instruments.current_config_version_id` — mirror of the analyst versioning pattern.
2. Every base instrument has a real, hand-reviewable v1 stage-keyed contract with all required sections populated: `General`, `Stage: Article Processing`, `Stage: Predictor Generation`, `Stage: Risk Assessment — Reflection (3a)`, `Stage: Risk Assessment — Debate (3b)`, `Stage: Prediction Generation`, `Stage: Learning`, `Adaptations` (8 sections total — 6 required stage sections plus General and Adaptations).
3. Stage 1 article-relevance classification uses the instrument's `General + Article Processing + Adaptations` fragment instead of the hardcoded system prompt.
4. Stages 2–4 merge instrument + analyst stage fragments into every LLM invocation — at the four call sites listed in §4.1, the prompt is traceable to both contracts.
5. A new `InstrumentContractEditorView.vue` on `/instruments/:id/contract` reaches feature-parity with `ContractEditorView.vue` (section panels, validation, version history, diff, rollback).
6. Editing an instrument's contract measurably changes pipeline behavior for that instrument on the next cycle.

**Success criteria (measurable):**

- `prediction.instrument_config_versions` exists with the schema specified in §4.2; `instruments.current_config_version_id` is non-null for every `is_active = true AND user_id IS NULL` row after Phase 2.
- For every base instrument, `SELECT context_markdown FROM prediction.instrument_config_versions WHERE id = instruments.current_config_version_id` returns markdown that parses to non-empty bodies for all 8 sections listed in Goal #2 — the v1 "standard" shape.
- `apps/api/tests/unit/parse-contract-markdown.test.ts` passes with new `articleProcessing` stage cases and `instrument` validation-type cases.
- `apps/api/tests/integration/article-relevance-instrument-contract.test.ts` writes a distinctive token into one instrument's `## Stage: Article Processing` section, runs `classifyNewArticles()`, and asserts the system prompt passed to `MarketsLlmService` contains that token.
- `apps/api/tests/integration/prediction-runner-instrument-merge.test.ts` writes distinct distinctive tokens into both the instrument's and the analyst's `## Stage: Prediction Generation` sections, runs a prediction for that (analyst, instrument) pair, and asserts the captured prompt contains both tokens.
- `grep -l "loadInstrumentContractFragment" apps/api/src/markets/services/` returns at least the four wire files listed in §4.1 (predictor-generator, risk-runner, risk-debate, prediction-runner) plus article-relevance.
- Manual: open `/instruments/:id/contract` for a base instrument, edit the Article Processing panel to add a new "avoid this decoy" clue, save; trigger `classifyNewArticles()`; observe that a previously-relevant article is now classified not-relevant (and vice versa) for that instrument specifically.

## 3. User Stories / Use Cases

- **Solo operator (founder):** I open AAPL's contract, edit `## Stage: Article Processing` to add "articles about iPad sell-through are usually noise unless they name China," and save. The next pipeline cycle classifies iPad-China articles as relevant while treating generic iPad stories as not relevant — for AAPL only.
- **Beta user / club member:** I open an instrument's contract at `/instruments/:id/contract` and see stage-keyed sections that mirror the analyst contract editor's layout. I can read "what does AAPL care about at the Risk Assessment stage?" as an isolated section.
- **Pipeline engineer:** When I debug why a particular analyst produced a weird risk assessment for NVDA, an integration test captures the exact prompt sent to `MarketsLlmService`. It contains both NVDA's Risk Reflection section and the analyst's Risk Reflection section (each under a labeled header) — the two contracts are named, traceable contributors. Runtime prompt logging is not added by this effort; debugging relies on the same per-test prompt-capture harness used by the analyst-contracts integration tests.
- **Future custom-instrument owner (out of scope for this effort, but unblocked by it):** Cloning AAPL and editing its contract to add a China-aware angle is a contract fork, not a code change.

## 4. Technical Requirements

### 4.1 Architecture

**New contract shape** (written to `prediction.instrument_config_versions.context_markdown`):

```markdown
## General
<universal worldview for this instrument — sector context, peer set, what makes it tick,
 base disclaimers; applies to every stage>

## Stage: Article Processing
<decision criteria for "is this article relevant to me?" — keywords that sound relevant but
 are decoys, topics that matter even when the ticker isn't mentioned, sector framings>

## Stage: Predictor Generation
<instrument-specific framing for predictor extraction — which article dimensions matter
 for this instrument, peer-company relevance, regulatory angles>

## Stage: Risk Assessment — Reflection (3a)
<instrument-specific risk dimensions to track when reflecting on predictors>

## Stage: Risk Assessment — Debate (3b)
<instrument-specific framing for debate participants — e.g., "when debating AAPL, weight
 China-exposure arguments higher than a typical stock">

## Stage: Prediction Generation
<instrument-specific framing for prediction issuance — volatility regime, earnings cadence,
 sector beta>

## Stage: Learning
<instrument-specific lessons to internalize from prediction outcomes for this instrument>

## Adaptations
<recent learning-loop appendments — same format as analyst Adaptations>
```

**Runtime assembly model.** At every LLM call site that operates under an (analyst, instrument) pair, the prompt is built by merging the **instrument contract fragment** and the **analyst contract fragment** for the active stage. Each fragment is `General + stage-body + Adaptations` joined by blank lines. The merged prompt concatenates both, labeled so the model can distinguish them:

```
[Instrument: <symbol>]
<instrument General>

<instrument stage-body>

<instrument Adaptations>

[Analyst: <slug>]
<analyst General>

<analyst stage-body>

<analyst Adaptations>
```

Stage 1 (Article Processing) is the exception — it operates under an instrument identity only (no analyst is bound yet). The prompt is the instrument fragment alone.

**Shared parser, extended.** [`parse-contract-markdown.ts`](../../../apps/api/src/markets/utils/parse-contract-markdown.ts) already parses `## Stage: <name>` + `## General` + `## Adaptations`. It is extended rather than forked:

- `StageKey` gains `'articleProcessing'` (the parser's stage map grows to 6 keys).
- `matchStageHeading` adds the mapping `"stage: article processing" → 'articleProcessing'`.
- `AnalystType` is widened in place to `'personality' | 'arbitrator' | 'portfolio_manager' | 'instrument'` (no rename — the type is already narrower than its name suggests, since `arbitrator` and `portfolio_manager` aren't personalities either; widening it is cheaper than cascading a rename through the markets service and controller).
- `REQUIRED_SECTIONS_BY_TYPE` adds an `instrument` branch: all of `articleProcessing`, `predictorGeneration`, `riskReflection`, `riskDebate`, `predictionGeneration`, `learning` are required (6 stage sections, plus implicit `General` and `Adaptations` from the existing validator — matching the predecessor's "6 stage keys required for personality analysts" pattern with the added `articleProcessing` entry).
- `stageToKey` is left **unchanged** — it continues to throw for `ArticleProcessing` so the analyst loader keeps its defensive safety net ([parse-contract-markdown.ts:160-163](../../../apps/api/src/markets/utils/parse-contract-markdown.ts#L160)).
- A new exported helper `instrumentStageToKey(stage, subStage?)` handles all 5 workflow stages including `ArticleProcessing → 'articleProcessing'`. A new exported helper `buildInstrumentStagePromptFragment(sections, stage, subStage?)` uses `instrumentStageToKey` and is the sole caller from the instrument contract loader.

This preserves the existing analyst contract loader's behavior exactly — `contract-loader.ts` is untouched, including its defensive `ArticleProcessing` branch at [contract-loader.ts:63-66](../../../apps/api/src/markets/utils/contract-loader.ts#L63) (remains a belt-and-suspenders fallback).

**New contract-loader variant.** A parallel loader for instruments, wrapping the same pattern as [`contract-loader.ts`](../../../apps/api/src/markets/utils/contract-loader.ts):

```typescript
// apps/api/src/markets/utils/instrument-contract-loader.ts (new)
export async function loadInstrumentContractFragment(
  deps: ContractLoaderDeps,
  instrument: { id: string; symbol: string },
  stage: WorkflowStage,
  subStage?: 'reflection' | 'debate',
): Promise<ContractFragmentResult>;
```

Loads the instrument's active config version (via `instruments.current_config_version_id`), parses the markdown, returns the fragment or fallback via `buildInstrumentStagePromptFragment`. Emits `pipeline.instrument_contract.fallback` observability events with reason codes identical to the analyst loader's (`no_config_version`, `empty_context_markdown`, `missing_stage_section`, `load_error`), plus `instrument_id` and `instrument_symbol` in the payload. The loader reads `instruments.current_config_version_id` unconditionally — **no `isPaper` branch**, since instruments have no paper-config variant (see §4.2). Stages invoked under `isPaper = true` still use the same instrument contract; only the analyst contract diverges between live and paper.

**Call sites that must be wired:**

| Stage | File | Current per-instrument surface |
|---|---|---|
| ArticleProcessing (Stage 1) | [article-relevance.service.ts:141-168](../../../apps/api/src/markets/services/article-relevance.service.ts#L141) | Hardcoded `systemPrompt` string on line 152 |
| PredictorGeneration (Stage 2) | [predictor-generator.service.ts](../../../apps/api/src/markets/services/predictor-generator.service.ts) | None — analyst-only |
| RiskAssessment Reflection 3a (Stage 3a) | [risk-runner.service.ts:612](../../../apps/api/src/markets/services/risk-runner.service.ts#L612) | None — analyst-only |
| RiskAssessment Reflection 3a (second path) | [risk-runner.service.ts:830](../../../apps/api/src/markets/services/risk-runner.service.ts#L830) | None — analyst-only |
| RiskAssessment Debate 3b | [risk-debate.service.ts](../../../apps/api/src/markets/services/risk-debate.service.ts) | None — analyst-only |
| PredictionGeneration (Stage 4) | [prediction-runner.service.ts:244-251](../../../apps/api/src/markets/services/prediction-runner.service.ts#L244) | None — analyst-only |

**Stage 5 (Learning)** is intentionally out of scope for wiring. `learning-engine.service.ts` does not invoke `MarketsLlmService` with a contract-driven system prompt today; its work is algorithmic pattern-identification + canonical runner. There is no existing `loadContractFragment` call to parallel. When/if a future effort adds LLM-driven learning adaptations, this effort's parser extension (`articleProcessing` key, `instrument` audience type, `loadInstrumentContractFragment`) is already in place and the wiring is a single call-site change.

Stage 1 swaps its hardcoded prompt for `loadInstrumentContractFragment(..., ArticleProcessing)`. Stages 2–4 (5 call sites; risk-runner has two paths for 3a) keep their existing `loadContractFragment` (analyst) call and add a parallel `loadInstrumentContractFragment` call; the two fragments are concatenated (instrument first, then analyst) and passed to the system prompt builder.

### 4.2 Data Model Changes

**New table** `prediction.instrument_config_versions` (created via idempotent DDL in `MarketsSchemaService.instrumentConfigVersionsDdl()`, following the existing pattern at [markets-schema.service.ts:471-494](../../../apps/api/src/markets/schema/markets-schema.service.ts#L471)):

```sql
create table if not exists prediction.instrument_config_versions (
  id text primary key,
  instrument_id text not null references prediction.instruments(id) on delete cascade,
  version_number integer not null default 1,
  context_markdown text not null,
  source text not null default 'manual',
  change_reason text,
  parent_version_id text,
  is_active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  llm_usage_id uuid,
  constraint instrument_config_versions_source_check
    check (source = any (array['manual', 'tier1_auto', 'tier2_approved', 'tier3_strategic']))
);
create index if not exists prediction_instrument_config_versions_instrument_idx
  on prediction.instrument_config_versions (instrument_id, is_active);
create index if not exists prediction_instrument_config_versions_llm_usage_idx
  on prediction.instrument_config_versions (llm_usage_id) where llm_usage_id is not null;
```

**New column** on `prediction.instruments`:

```sql
alter table prediction.instruments add column if not exists current_config_version_id text;
```

No foreign-key constraint — matches the existing `market_analysts.current_config_version_id` pattern (no FK to `analyst_config_versions`). Avoids insertion ordering problems at bootstrap (instrument row exists before any config version).

**No `paper_config_version_id` column.** Analysts have paper variants because paper-trading experiments vary the analyst's behavior; an instrument's contract describes the instrument (sector, peers, regulatory context) and doesn't meaningfully vary between live and paper modes. Out of scope; can be added non-breakingly if later needed.

**No `persona_prompt`-equivalent column.** Instruments have no legacy flat-prompt column. The fallback for a missing instrument contract is to omit the instrument fragment (Stage 1 falls back to today's hardcoded prompt; Stages 2–4 fall back to analyst-only prompt, which is today's behavior).

The table and column are created via a new private method on `MarketsSchemaService` (`instrumentConfigVersionsDdl()`) invoked from `ensureSchema()` ([markets-schema.service.ts:20](../../../apps/api/src/markets/schema/markets-schema.service.ts#L20)), mirroring how `instrumentsDdl()` at [markets-schema.service.ts:105](../../../apps/api/src/markets/schema/markets-schema.service.ts#L105) and the analyst config versions DDL at [markets-schema.service.ts:471](../../../apps/api/src/markets/schema/markets-schema.service.ts#L471) are wired. Idempotent via `create table if not exists` and `add column if not exists`. No separate migration file; follows the repo's established in-service DDL convention.

### 4.3 API Changes

Three new endpoints on `MarketsController`, parallel to the analyst-contract endpoints at [markets.controller.ts:259-300](../../../apps/api/src/markets/markets.controller.ts#L259):

| Method | Endpoint | Body | Response | Gating |
|---|---|---|---|---|
| GET | `/instruments/:id/contract` | — | `InstrumentContractData` (below) | None (read) |
| PUT | `/instruments/:id/contract` | `{ markdown, changeReason? }` | Updated `InstrumentContractData` | `requireWriteAccess()` |
| POST | `/instruments/:id/contract/validate` | `{ markdown }` | `{ valid, missingSections, forbiddenPhrases, extraSections }` | None (preflight) |

Response shape (mirrors the actual analyst response shape at [markets.service.ts:1273-1290](../../../apps/api/src/markets/markets.service.ts#L1273)):

```typescript
interface InstrumentContractData {
  instrumentId: string;
  symbol: string;
  name: string;
  assetType: string;                      // 'stock' | 'crypto' | 'etf' | …
  requiredSections: StageKey[] | null;    // REQUIRED_SECTIONS_BY_TYPE['instrument'] — the
                                          // 6 stage keys for v1; null only if instrument's
                                          // coerced type is unrecognized (shouldn't happen
                                          // for the base instrument set)
  activeVersionId: string | null;
  contract: {
    markdown: string;
    sections: ContractSections;           // { general, roles, stages, adaptations } — the
                                          // full parser output; roles is always {} on v1
                                          // instrument contracts
  } | null;
  versions: Array<{
    id: string;
    versionNumber: number;
    source: string;
    changeReason: string | null;
    createdBy: string | null;
    createdAt: string;
    isActive: boolean;
    contextMarkdown: string | null;
  }>;
}
```

PUT performs server-side validation using `validateContractSections(sections, 'instrument')`; on failure returns `400 { missingSections, forbiddenPhrases, extraSections }`. On success, inserts a new `instrument_config_versions` row with `version_number = prior + 1`, `source='manual'`, `parent_version_id = prior active id`, deactivates the prior row (`is_active = false`), flips `instruments.current_config_version_id`. The service method `coerceInstrumentType(instrument)` always returns `'instrument'` for v1 (no per-asset-type policy yet — see §6).

Admin-only gating is enforced via the existing [`requireWriteAccess()`](../../../apps/api/src/markets/markets.controller.ts#L127) helper (writable roles: `super-admin`, `owner`, `member`, `admin`). This matches the analyst-contract gating policy and resolves the intention's open question on permissions for base instrument edits.

### 4.4 Frontend Changes

[`apps/web/src/views/InstrumentContractEditorView.vue`](../../../apps/web/src/views/InstrumentContractEditorView.vue) — **new file**, mirroring [`ContractEditorView.vue`](../../../apps/web/src/views/ContractEditorView.vue):

- Route `/instruments/:id/contract` registered in the Vue router; uses `route.params.id`.
- One collapsible panel per section: `General`, `Article Processing`, `Predictor Generation`, `Risk Reflection (3a)`, `Risk Debate (3b)`, `Prediction Generation`, `Learning`, `Adaptations` (eight panels).
- Per-panel textarea with vertical autosize and per-panel save-disabled when section invalid.
- On save, fragments concatenate into `context_markdown` and post to `PUT /instruments/:id/contract`.
- Header row: stage-completion chips identical to the analyst editor.
- Client-side parser recognizes all `## Stage: <name>` headings (reusing the extended `parseContractMarkdown` shape; the client parser stays display-only, server validation authoritative).
- Version history table, diff view (`diffLeftId` / `diffRightId`), preview-without-save, rollback-on-save-of-preview — all identical semantics to the analyst editor.
- Validation on blur/debounced-type calls `POST /instruments/:id/contract/validate` and surfaces `missingSections` / `forbiddenPhrases` / `extraSections` inline.

Navigation entry to the new route (from the instrument detail view or wherever the analyst contract editor is linked from today) — identified during Phase 5; not separately enumerated here.

No other frontend routes or views change.

### 4.5 Infrastructure Requirements

- New seed contract set: hand-authored Markdown files in `scripts/contracts-v4/instruments/<symbol>.md`, one per base instrument. Mirrors the existing [`scripts/contracts-v4/`](../../../scripts/contracts-v4/) layout used by the just-landed analyst effort. Files conform to the §4.1 shape and pass `validateContractSections(sections, 'instrument')`.
- New migration script `scripts/upgrade-instrument-contracts-v1.ts`, modeled on [`scripts/upgrade-contracts-v4.ts`](../../../scripts/upgrade-contracts-v4.ts). For each `<symbol>.md` file: resolve `instruments.id` by symbol, validate the file, insert a new `instrument_config_versions` row with `version_number = 1` (or `prior + 1` on re-run), `source='manual'`, `change_reason='instrument contract v1 bootstrap'`, `parent_version_id = prior active id if any`, `is_active=true`, deactivate any prior row, set `instruments.current_config_version_id`. Aborts the whole batch if any file fails validation (no partial writes). Dry-run flag.
- **Base instrument scope:** `instruments.user_id IS NULL AND is_active = true` defines the base set. The script reads this set at runtime and warns about any base instrument that lacks a corresponding `<symbol>.md` file.
- **Authoring strategy:** LLM scaffolding pass via `gemma4:26b` (serial; Ollama is single-tenant per `project_ollama_serial.md`; `gemma4:e4b` unreliable for constraint-following per `project_local_models.md`), producing a first draft per instrument. Each draft is then committed to the repo for human review and editing before `upgrade-instrument-contracts-v1.ts` runs. This resolves the intention's open question on authoring: LLM drafts, human reviews. No type-based templates at v1 — per-instrument variation is worth the keystrokes for a launch-set of base instruments.
- Authoring script `scripts/generate-instrument-contracts.ts` (new, modeled on [`scripts/generate-analyst-contracts.ts`](../../../scripts/generate-analyst-contracts.ts)): for each base instrument without an existing `scripts/contracts-v4/instruments/<symbol>.md` file, call `gemma4:26b` via Ollama with a prompt that includes symbol, name, asset_type, universe_slug, and the v1 shape spec; write the response to the target file. Idempotent: skips files that already exist. Serial execution.
- Upgrade script uses `created_by = 'system'` (a synthetic identifier; no authz table join required). Row `id` generated via `randomUUID()` at insert time, matching the upgrade-contracts-v4 pattern.
- Upgrade-script validation is a two-pass gate: (1) `validateContractSections(sections, 'instrument')` must pass, **and** (2) no section body may contain the literal token `TODO:` (case-insensitive). The TODO check is added to the upgrade script (not to `validateContractSections`, which stays analyst-neutral). Any failure aborts the whole batch without mutating the DB.
- No new external dependencies. No new scheduled jobs.
- Schema DDL rides the existing `MarketsSchemaService.ensureSchema()` path ([markets-schema.service.ts:20](../../../apps/api/src/markets/schema/markets-schema.service.ts#L20)) — no separate migration file needed; follows the same pattern as every other table in that service.

## 5. Non-Functional Requirements

- **Performance:** Per (article, instrument) pair in Stage 1, the loader adds one `SELECT context_markdown FROM prediction.instrument_config_versions WHERE id = $1`. Result is small (≤10 KB per row). At current classification batch sizes (100 articles × N instruments), this is N extra queries per cycle — negligible vs. LLM latency. Per-stage caching within a classification batch (cache by `instrument.current_config_version_id` across the inner loop) is a Phase 3 optimization if profiling shows pressure.
- **Stages 2+ cost:** Per analyst invocation on an instrument, adds one additional `SELECT context_markdown` for the instrument. Same O(1) per call site, same caching opportunity. Acceptable on local gemma models given the content-keyed cost model (`project_inference_cost_model.md`).
- **Prompt size impact:** Instrument fragment at each stage adds roughly 300–900 tokens (General + stage body + Adaptations). Total prompt grows by that margin; well within local-model context budgets.
- **Empty-stage-section policy:** An instrument contract stage section MUST have a non-empty body — even an explicit opt-out like `Apply General rules unchanged; no instrument-specific framing at this stage.` An empty heading body is a validation error. Same rationale as the analyst effort: forces authors to make a conscious choice per stage and keeps the editor's completion indicator meaningful.
- **Correctness under fallback:** If `instruments.current_config_version_id` is NULL, the target version row's `context_markdown` is empty, or the required stage section is missing, the loader returns an empty fragment and the call site proceeds with instrument-less prompts (Stage 1: today's hardcoded system prompt at [article-relevance.service.ts:152](../../../apps/api/src/markets/services/article-relevance.service.ts#L152); Stages 2–4: analyst-only prompt as today). A `Logger.warn` and a `pipeline.instrument_contract.fallback` observability event are emitted. This keeps the pipeline healthy for any instrument added after v1 bootstrap.
- **Legal language compliance:** Validation enforces the existing rules from `project_legal_language.md` — no `advice`, `recommendation`, `as an AI` — via the shared `FORBIDDEN_PHRASES` regex already in `parse-contract-markdown.ts`. Because Phase 3 removes the hardcoded Stage 1 system prompt (which today contains the positive-framing nudge `Use the language "analysis" and "signal"…`), the Stage 1 wiring **re-asserts** this framing in the trailing instruction block appended after the instrument fragment (see §8 Phase 3). This keeps the guardrail on Stage 1 output deterministic regardless of what an individual instrument's General section chooses to say. For Stages 2–4, the analyst contract's General section continues to carry the positive framing (as it does today).
- **Security:** No new user-facing input surfaces. Admin-only editing via `requireWriteAccess()`. Instrument contracts are public within the app (any authenticated user can GET), consistent with analyst-contract visibility.
- **Scalability:** Adding ~300–900 tokens per LLM call across ~N base instruments × ~7 analysts × ~5 stages is bounded by the existing pipeline shape. Cost model is content-keyed, not user-keyed (`project_inference_cost_model.md`) — adding contract fragments doesn't multiply per-user.
- **Ollama serial constraint** (`project_ollama_serial.md`): scaffolding script runs instruments sequentially, never in parallel.
- **Compatibility:** Existing instruments without contracts continue to work via fallback. Existing analyst contracts and existing `## Role: <name>` parsing are unaffected — the parser's extensions are additive.

## 6. Out of Scope

- User-authored custom instrument contracts (e.g., "Club X's AAPL") — separate effort: `user-authored-custom-content`.
- Asset-type-based required-section templates (stock template, crypto template, ETF template). Resolved in v1 as: single `instrument` audience type with a unified required set. Type-based variants are a future config-only change.
- Triple-model storage of analysis (separate effort: `triple-model-reasoning-continuity`).
- Paper-mode variant of instrument contracts (`paper_config_version_id`). Not needed for v1 per §4.2 rationale.
- Audit-finding stage attribution for instrument contracts specifically (the analyst effort's `violation_stage` / `contract_section` columns already exist; findings will carry whichever stage fragment was in play regardless of whether the violation traces to the instrument or analyst contract). Cross-contract attribution (which contract's section was violated) is a refinement for a later effort.
- Backfilling historical audit findings with instrument-contract attribution.
- Dropping or restructuring any existing column (the effort is purely additive).
- Day-trader-scoped instrument contracts.

## 7. Dependencies & Risks

**External / upstream dependencies:**

- **`stage-keyed-analyst-contracts`** — **landed** (commits 77468f5, f9f75f1, 126845d on main). This effort reuses `parseContractMarkdown`, `buildStagePromptFragment`, `validateContractSections`, `ContractLoaderDeps`, `ContractFragmentResult`, and the observability fallback pattern. It extends those primitives (adds `articleProcessing` to `StageKey`, adds `instrument` to `REQUIRED_SECTIONS_BY_TYPE`) rather than duplicating them.
- **`workflow-stages-article-pipeline`** — landed (enum at [workflow-stage.ts:8-14](../../../apps/api/src/markets/workflow-stages/workflow-stage.ts#L8)). `WorkflowStage.ArticleProcessing` already exists and is referenced by `ArticleRelevanceService`.
- **Ollama** — local inference for scaffolding (`project_local_models.md`): `gemma4:26b` for complex contract drafting (`gemma4:e4b` unreliable for constraint-following per memory).

**Risks:**

1. **Risk: `parseContractMarkdown` extension breaks analyst contracts.** Adding `articleProcessing` to `StageKey` and adding `instrument` to `REQUIRED_SECTIONS_BY_TYPE` touches shared code. Mitigation: `stageToKey` and `buildStagePromptFragment` are left **unchanged** — they still throw for `ArticleProcessing`, preserving the analyst safety net. A new `instrumentStageToKey` and `buildInstrumentStagePromptFragment` accept `ArticleProcessing` and are called only from the new instrument contract loader. The analyst loader (`contract-loader.ts`) is untouched, including its own defensive `ArticleProcessing` branch at [contract-loader.ts:63](../../../apps/api/src/markets/utils/contract-loader.ts#L63). All existing analyst tests pass unchanged (verified in Phase 1 unit tests, including an explicit assertion that `stageToKey(ArticleProcessing)` still throws).
2. **Risk: Stage 1 classification regression from swapping the hardcoded prompt.** The hardcoded prompt at `article-relevance.service.ts:152` has been tuned; replacing it with a contract-driven prompt could degrade classification quality. Mitigation: Phase 3 integration test writes a distinctive token into one instrument's `Article Processing` section and asserts the prompt contains it (correctness). A manual spot-check compares classification decisions for 20 recent articles before/after on one base instrument, looking for obvious regressions. If quality regresses, the fallback path (empty `context_markdown`) restores the hardcoded prompt — no code rollback needed.
3. **Risk: Double-contract prompts become too long.** Stages 2+ now concatenate two `General + stage + Adaptations` blocks. For long-form instrument + analyst sections, prompt size could approach context limits. Mitigation: observability event logs total prompt token count per stage; if any call exceeds a soft cap (e.g., 6000 tokens), a warning fires. Author guidance: keep instrument stage sections ≤500 words (analyst sections already target ≤800 words).
4. **Risk: Fallback path masks a misconfigured base instrument.** If a base instrument's contract is mis-migrated, the pipeline silently reverts to today's behavior without blocking. Mitigation: startup warning emitted by `MarketsSchemaService` (or a dedicated startup check) if any `instruments.user_id IS NULL AND is_active = true` row has `current_config_version_id IS NULL` after Phase 2 ships. Observability dashboard tracks `pipeline.instrument_contract.fallback` event counts; non-zero for base instruments is an alertable condition.
5. **Risk: LLM scaffolding drafts are useless for the Article Processing section.** The intention flags this: the article-processing criteria ("which articles about this instrument are decoys") may need human authoring per instrument, not LLM generation. Mitigation: the scaffolding pass produces a starting skeleton with a `TODO: fill in instrument-specific decoys` placeholder in the Article Processing section. Each contract is then hand-edited before the v1 upgrade script runs. The upgrade script's validator rejects any section containing `TODO:`.
6. **Risk: Rollback mid-Phase.** If a phase ships and causes regressions, rollback must be clean. Mitigation: schema changes are additive only (new table + new nullable column). Phases 3 and 4 flip the call sites; a revert is a one-file change per site. Existing analyst contracts are untouched. The fallback path keeps Stage 1 working without instrument contracts.
7. **Risk: the editor's 8 section panels are unwieldy.** Mitigation: mirror the analyst editor's collapsible-panel UX; the Adaptations panel is typically closed; users navigate to one stage at a time. Accept that instrument Article Processing sections will often be 200–500 words.

## 8. Phasing

Each phase is independently deployable and leaves the system in a working state.

### Phase 1 — Parser Extensions + Schema + Loader (no runtime change)

Add the data-model plumbing without touching any runtime call site.

- Extend `StageKey` in [parse-contract-markdown.ts](../../../apps/api/src/markets/utils/parse-contract-markdown.ts) with `'articleProcessing'` (`EMPTY_STAGES` and `STAGE_HEADING_LABELS` updated accordingly).
- Extend `matchStageHeading` to recognize `"stage: article processing" → 'articleProcessing'`.
- Widen `AnalystType` in place to `'personality' | 'arbitrator' | 'portfolio_manager' | 'instrument'`. No rename. The private `coerceAnalystType` helper in `MarketsService` ([markets.service.ts:1298](../../../apps/api/src/markets/markets.service.ts#L1298)) is left unchanged for analyst endpoints; a parallel `coerceInstrumentType` is added for the instrument endpoints (always returns `'instrument'`).
- Extend `REQUIRED_SECTIONS_BY_TYPE` with the `instrument` row: `['articleProcessing', 'predictorGeneration', 'riskReflection', 'riskDebate', 'predictionGeneration', 'learning']`.
- Add `instrumentStageToKey(stage, subStage?)` that maps `ArticleProcessing → 'articleProcessing'` and otherwise matches `stageToKey`. Add `buildInstrumentStagePromptFragment(sections, stage, subStage?)` using `instrumentStageToKey`. Existing `stageToKey` and `buildStagePromptFragment` are untouched (`ArticleProcessing` still throws there — preserves the analyst safety net).
- `validateContractSections` already accepts any key of `REQUIRED_SECTIONS_BY_TYPE` via its `analystType: AnalystType` parameter; widening `AnalystType` is enough to make `validateContractSections(sections, 'instrument')` compile and behave correctly.
- Add DDL: `MarketsSchemaService.instrumentConfigVersionsDdl()` invoked from `ensureSchema()`, plus the `instruments.current_config_version_id` column alter embedded in `instrumentsDdl()` (or a sibling method — implementation detail). No FK.
- Write [`apps/api/src/markets/utils/instrument-contract-loader.ts`](../../../apps/api/src/markets/utils/instrument-contract-loader.ts) (new) — the instrument-side parallel of `contract-loader.ts`. Reads `instrument.current_config_version_id` via a join query on `instruments`; parses markdown; calls `buildInstrumentStagePromptFragment`. Emits `pipeline.instrument_contract.fallback` events with `instrument_id` and `instrument_symbol` in the payload.
- Unit tests in [`parse-contract-markdown.test.ts`](../../../apps/api/tests/unit/parse-contract-markdown.test.ts): Article Processing heading parses into `stages.articleProcessing`; instrument validation accepts the full 6-stage set and rejects missing sections; `instrumentStageToKey(ArticleProcessing)` returns `'articleProcessing'`; existing analyst cases still pass (including `stageToKey(ArticleProcessing)` still throwing).

**Validation:** unit tests pass; `MarketsSchemaService` startup creates the new table and column on a fresh DB and on the existing DB. Runtime behavior unchanged (no call site reads the new table yet).

### Phase 2 — v1 Instrument Contracts for Base Instruments

Produce and activate stage-keyed contracts for all base instruments.

- Write [`scripts/generate-instrument-contracts.ts`](../../../scripts/generate-instrument-contracts.ts): enumerate `instruments WHERE user_id IS NULL AND is_active = true`, for each instrument without a `scripts/contracts-v4/instruments/<symbol>.md` file, call `gemma4:26b` via Ollama serially to produce a draft; write the draft to disk. Idempotent.
- **Human review pass** (out-of-band, outside the plan's automation): founder/operator reviews each draft, edits particularly the `Article Processing` section (the most instrument-specific and most likely to need hand-editing per risk 5 and the intention's open question), removes any `TODO:` markers.
- Write [`scripts/upgrade-instrument-contracts-v1.ts`](../../../scripts/upgrade-instrument-contracts-v1.ts) mirroring `upgrade-contracts-v4.ts`. For each `<symbol>.md`: resolve `instrument_id`, run the two-pass validation gate from §4.5 (`validateContractSections(sections, 'instrument')` + `TODO:` substring check), insert new `instrument_config_versions` row with `created_by='system'` and a fresh `randomUUID()` id, deactivate prior (if any), flip `current_config_version_id`. Aborts batch on any validation failure. Dry-run flag.
- Run the upgrade script.

**Validation:** `SELECT i.symbol, icv.version_number, length(icv.context_markdown), icv.is_active FROM instruments i JOIN instrument_config_versions icv ON icv.id = i.current_config_version_id WHERE i.user_id IS NULL AND i.is_active` returns one row per base instrument, each with non-zero markdown length parsing to the full required section set. No runtime behavior change yet (Stage 1 still uses the hardcoded prompt; Stages 2–4 still analyst-only).

### Phase 3 — Wire Stage 1 (Article Processing)

Flip article-relevance classification to draw its system prompt from the instrument contract.

- Modify [`article-relevance.service.ts`](../../../apps/api/src/markets/services/article-relevance.service.ts):
  - The service already has `db` (DATABASE_SERVICE), `observability` (ObservabilityEventsService), and a private `logger = new Logger(...)` field. These constitute a ready-to-use `ContractLoaderDeps`; no constructor change needed.
  - In `llmClassify`, call `loadInstrumentContractFragment({ db, logger: this.logger, observability: this.observability }, instrument, WorkflowStage.ArticleProcessing)` before building the system prompt.
  - On fallback (empty fragment): use today's hardcoded prompt (unchanged).
  - On success: the system prompt is the instrument fragment, followed by a trailing instruction block: `Use the language "analysis" and "signal", never "advice" or "recommendation". Respond with valid JSON: {"is_relevant": true/false, "rationale": "brief explanation"}.` The legal-language nudge is kept as a trailing append (rather than relying on every instrument's General section to include it) to keep Stage 1 guardrails deterministic across contracts.
  - Keep `getActiveInstruments` unchanged (still queries only `id`, `symbol`, `name` — the loader fetches the contract separately via its own query).
- Integration test [`apps/api/tests/integration/article-relevance-instrument-contract.test.ts`](../../../apps/api/tests/integration/article-relevance-instrument-contract.test.ts): seed one instrument + a v1 contract whose `Article Processing` section contains the literal string `DISTINCTIVE-TOKEN-ARTPROC-42`; run `classifyNewArticles()` on one test article; capture the `systemPrompt` passed to `MarketsLlmService.generateText`; assert it contains the token.
- Integration test for fallback: seed one instrument with `current_config_version_id = NULL`; assert `classifyNewArticles()` completes without error and emits one `pipeline.instrument_contract.fallback` event with `reason='no_config_version'`.

**Validation:** both integration tests green; manual classification of 20 recent articles against a base instrument produces reasonable results (operator spot-check). Observability: zero fallback events for base instruments over a pipeline cycle.

### Phase 4 — Wire Stages 2–4 (Merge Instrument + Analyst Fragments)

Extend the four analyst-facing stage services to merge the instrument contract fragment alongside the analyst fragment. Five call sites total across four files.

- Each of `predictor-generator.service.ts`, `risk-runner.service.ts` (both 3a reflection call sites at [lines 612 and 830](../../../apps/api/src/markets/services/risk-runner.service.ts#L612)), `risk-debate.service.ts`, `prediction-runner.service.ts` (at [lines 244-251](../../../apps/api/src/markets/services/prediction-runner.service.ts#L244)):
  - Call `loadInstrumentContractFragment(deps, instrument, stage, subStage?)` in parallel with the existing `loadContractFragment` (analyst) call. Use `Promise.all` for the two loads — they are independent DB queries.
  - Build the merged system prompt as:
    ```
    [Instrument: <symbol>]
    <instrument stageFragment>

    [Analyst: <slug>]
    <analyst stageFragment or analyst fallback prompt>
    ```
  - When the instrument fragment is empty (fallback), omit the instrument block entirely — keep today's analyst-only prompt as the default.
  - When the analyst fragment is empty (pre-existing fallback path to `persona_prompt`), the instrument block still renders. Both fragments independent.
- Introduce a small shared helper `buildMergedSystemPrompt({ instrumentSymbol, instrumentFragment, analystSlug, analystFragment }): string` in a new `apps/api/src/markets/utils/merge-prompts.ts`. All five call sites use it — no duplicated concatenation logic.
- **Observability:** emit a `pipeline.prompt_token_estimate` event per call with the total token count (approximated by `Math.ceil(prompt.length / 4)`) so the soft-cap alert from §7 risk 3 has data to key off.
- Per-stage integration tests following the Phase 3 pattern: write distinctive tokens into both the instrument's and the analyst's stage sections; run the pipeline for that (analyst, instrument) pair; assert both tokens appear in the captured prompt.
- **Stage 5 (Learning) is intentionally not wired** — `learning-engine.service.ts` has no `MarketsLlmService` / `loadContractFragment` call site today; there is nothing to parallel. If a future effort adds LLM-driven learning adaptations, the instrument wiring is a one-call-site change using primitives already in place from Phase 1.

**Validation:** four integration tests green (one per stage: PredictorGeneration, RiskReflection 3a, RiskDebate 3b, PredictionGeneration). `grep -l "loadInstrumentContractFragment" apps/api/src/markets/services/` returns at least five files: article-relevance (Phase 3), predictor-generator, risk-runner, risk-debate, prediction-runner.

### Phase 5 — Instrument Contract Editor UI + Validation API

Ship the editor at feature parity with the analyst editor.

- Add three controller methods on `MarketsController` (parallel to the analyst-contract methods at [markets.controller.ts:259-300](../../../apps/api/src/markets/markets.controller.ts#L259)):
  - `GET /instruments/:id/contract` — returns `InstrumentContractData`.
  - `PUT /instruments/:id/contract` — gated on `requireWriteAccess()`; validates via `validateContractSections(sections, 'instrument')`; inserts new version row; flips `current_config_version_id`.
  - `POST /instruments/:id/contract/validate` — returns validation result without mutating.
- Add [`apps/web/src/views/InstrumentContractEditorView.vue`](../../../apps/web/src/views/InstrumentContractEditorView.vue) as a new Vue component mirroring `ContractEditorView.vue`, with eight section panels (§4.4).
- Register the route `/instruments/:id/contract` in the Vue router.
- Add a navigation entry from the instrument detail view (or equivalent) linking to the contract editor — same affordance as the analyst detail view's contract link.
- Manual validation in Chrome: open a base instrument's contract, edit the `Article Processing` panel, save. Diff view shows only that section. Version history shows the new version active. Forbidden phrase (e.g., "recommendation") triggers the inline validation error. Rollback reverts by saving an older version.

**Validation:** manual browser test passes all bullet points above; API endpoints respond with the documented shapes.

### Phase 6 — Startup Warning + Observability Cleanup

Close the loop on misconfiguration detection.

- In `MarketsSchemaService.ensureSchema()` (or a dedicated startup-verification step invoked from it — location determined during implementation), add a warning log: for each row in `instruments WHERE user_id IS NULL AND is_active = true`, if `current_config_version_id IS NULL`, emit a `Logger.warn` naming the instrument.
- Confirm `pipeline.instrument_contract.fallback` event payload already includes `instrument_symbol` from Phase 1; if not, add it.
- Author a short operator runbook entry (inline in the completion report, not a separate doc) describing: what a fallback event means, how to check whether a base instrument has a missing contract, how to author and migrate a replacement.

**Validation:** on a **local/dev DB only** (not shared dev or prod — this is a destructive manual test), synthetic: drop one base instrument's `current_config_version_id` temporarily; start the API; confirm the warning log fires. Trigger `classifyNewArticles()`; confirm one fallback event per classification. Restore the column.

---

**Phase ordering rationale:** Phase 1 is pure plumbing with no call-site change — parser, schema, loader. Phase 2 populates data without wiring. Phase 3 flips the highest-value, narrowest-blast-radius call site (Stage 1 has one file and one prompt). Phase 4 extends the pattern to the four analyst-facing stages now that Phase 3 has proven the merge model. Phase 5 ships the editor UX, which is valuable only after contracts exist and are wired. Phase 6 hardens the production signal. Rollback after any phase is safe: Phases 1–2 are additive only; Phases 3–4 flip one call site each and preserve the original prompt as the fallback path; Phase 5 is UI-only and non-blocking; Phase 6 is warnings-only.
