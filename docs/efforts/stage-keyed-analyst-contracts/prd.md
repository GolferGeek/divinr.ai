# Stage-Keyed Analyst Contracts — Product Requirements Document

## 1. Overview

Today, analyst contracts live in `prediction.analyst_config_versions.context_markdown` and expose three sections (`## General`, `## Role: <name>`, `## Adaptations`), but only the `## Adaptations` section flows into runtime prompts ([prediction-runner.service.ts:241-263](../../../apps/api/src/markets/services/prediction-runner.service.ts#L241)). The actual behavioral driver at every LLM call site is the flat `persona_prompt` column on `market_analysts` ([prediction-runner.service.ts:447](../../../apps/api/src/markets/services/prediction-runner.service.ts#L447)). That means the contracts users edit at `/analysts/:id/contract` are not the contracts shaping predictions — a credibility gap for the explainability thesis.

This effort restructures analyst contracts to be **stage-keyed**: `General` + one section per workflow stage + `Adaptations`. Every LLM call site that operates under an analyst identity loads `General + stage-section + Adaptations` from the contract and injects that fragment into the prompt. `persona_prompt` is retired as the runtime driver. The contract the user sees *is* the contract shaping behavior.

## 2. Goals & Success Criteria

**Goals:**

1. Every analyst LLM invocation injects `General + stage-section + Adaptations` from `context_markdown` — no path still reads `analyst.persona_prompt` as the primary persona.
2. All 7 base analysts have stage-keyed v4 contracts with every required stage section populated.
3. The Contract Editor UI surfaces stage sections as independent, navigable, validatable units.
4. Audit findings attribute violations to a specific workflow stage section.
5. Editing a stage section in the UI measurably changes LLM behavior at that stage on the next cycle — the documented-vs-runtime gap is closed.

**Success criteria (measurable):**

- `grep -r "analyst.persona_prompt" apps/api/src/markets` returns only schema-migration and deprecation-shim references; no prompt construction path reads it.
- `apps/api/tests/unit/parse-contract-markdown.test.ts` passes with new stage-section cases.
- For every analyst in `{fundamentals-analyst, macro-strategist, momentum-analyst, sentiment-analyst, technical-analyst, arbitrator, portfolio-manager}`, `SELECT context_markdown FROM prediction.analyst_config_versions WHERE analyst_id = ? AND is_active` returns markdown parsing to non-empty `general` + 5 stage sections (3 for portfolio-manager — it skips PredictorGeneration and has a distinct PredictionGeneration shape).
- An integration test constructs a prediction run for one analyst, captures the prompt sent to `MarketsLlmService`, and asserts the prompt contains a distinctive token written into the `## Stage: Prediction Generation` section of that analyst's v4 contract.
- Audit findings written during the run expose `violation_stage` and `contract_section` fields; the UI displays "Predictor Generation clause violated" rather than "contract violated".

## 3. User Stories / Use Cases

- **Solo operator (founder):** I edit `## Stage: Risk Assessment — Debate (3b)` for one of my personality analysts and on the next cycle the Blue/Red/Arbiter debate transcripts reflect the new stance. No redeploy, no config flag.
- **Beta user / club member:** When I open an analyst's contract, I see stage-keyed sections with clear labels matching the pipeline stages shown elsewhere in the app. I can read a stage section in isolation to understand why the analyst did what it did at that stage.
- **Auditor (tier-2 system + human):** When an audit finding fires, I see which stage section of which contract was violated. Fixing the finding means editing that specific stage section, not the whole contract.
- **Learning loop (tier-1 writer):** When I append to `## Adaptations`, my entry rides every invocation of every stage for this analyst (unchanged behavior; `Adaptations` remains universal).

## 4. Technical Requirements

### 4.1 Architecture

New contract shape (written to `analyst_config_versions.context_markdown`):

```markdown
## General
<universal worldview, tone, legal disclaimers, cross-stage failure modes>

## Stage: Predictor Generation
<decision criteria for scoring article→instrument relevance from this analyst's lens>

## Stage: Risk Assessment — Reflection (3a)
<first-person decision criteria for updating this analyst's holistic risk view on an instrument given new predictors>

## Stage: Risk Assessment — Debate (3b)
<decision criteria for this analyst's debate role (Red/Blue for personality analysts; Arbiter for arbitrator)>

## Stage: Prediction Generation
<decision criteria for issuing a directional prediction from predictors + risk>

## Stage: Learning
<decision criteria for proposing adaptations from prediction outcomes>

## Adaptations
<recent learning-loop appendments>
```

**Not included in analyst contracts:** `## Stage: Article Processing`. That stage is instrument-keyed (see queued effort `instrument-contracts`).

**New contract-loader abstraction.** A single function is the one place every call site goes through:

```typescript
// apps/api/src/markets/utils/parse-contract-markdown.ts (new export)
export function buildStagePromptFragment(
  sections: ContractSections,
  stage: WorkflowStage,
  subStage?: RiskSubStage,
): string;
```

Returns `General + <stage-or-substage section> + Adaptations`, joined with blank-line separators, or an empty string if the contract is absent (fallback path; see §4.5). Every LLM call site replaces its bespoke persona construction with one call to this function.

**Call sites that must be wired:**

| Stage | File | Current persona source |
|---|---|---|
| PredictorGeneration | `apps/api/src/markets/services/predictor-generator.service.ts` | Hardcoded `ANALYST_SCORING_FOCUS` map ([predictor-generator.service.ts:46-52](../../../apps/api/src/markets/services/predictor-generator.service.ts#L46)) |
| RiskAssessment (3a Reflection) | `apps/api/src/markets/services/risk-runner.service.ts` (writes `prediction.analyst_risk_assessments` at [lines 663 and 853](../../../apps/api/src/markets/services/risk-runner.service.ts#L663)) | `analyst.persona_prompt` via `AnalystPerspective` |
| RiskAssessment (3b Debate) | `apps/api/src/markets/services/risk-debate.service.ts` | `analyst.persona_prompt` |
| PredictionGeneration | `apps/api/src/markets/services/prediction-runner.service.ts:443-459` | `analyst.persona_prompt` + `tier_instructions` + `adaptationsText` |
| Learning | `apps/api/src/markets/services/learning-engine.service.ts` | `analyst.persona_prompt` |

All five sites load the active (or paper) `context_markdown` for the analyst's config version, parse it once via `parseContractMarkdown`, then call `buildStagePromptFragment(sections, stage, subStage?)`.

### 4.2 Data Model Changes

No new columns on `prediction.analyst_config_versions`. The existing `context_markdown text` column ([markets-schema.service.ts:485](../../../apps/api/src/markets/schema/markets-schema.service.ts#L485)) holds the new v4 stage-keyed markdown. Versioning follows the existing lineage pattern (`parent_version_id`, `version_number`, `is_active`, `source='manual'|'tier1_auto'|...`).

**Audit findings** (`prediction.audit_findings`) gains two columns:

- `violation_stage text` — a `WorkflowStage` enum value (nullable for pre-migration rows)
- `contract_section text` — the verbatim section heading (e.g., `Stage: Predictor Generation`), for display and for surfacing the exact clause in UI

Migration is forward-only additive. No backfill — pre-migration findings render with the existing "contract violated" label.

**`market_analysts.persona_prompt`** becomes deprecated but not dropped. A column comment marks it deprecated; no runtime reads it; seed regeneration stops populating it. The column remains for rollback safety and day-trader analysts that have not yet received v4 contracts (see §6).

### 4.3 API Changes

- `GET /analysts/:id/contract` response shape evolves from `{ general, roles, adaptations, contextMarkdown }` to `{ general, stages: { predictorGeneration, riskReflection, riskDebate, predictionGeneration, learning }, adaptations, contextMarkdown, versions }`. `roles` remains in the response for one release as legacy (empty object on v4 contracts) to avoid breaking any external reader; removed in a follow-up.
- `POST /analysts/:id/contract` request body (save) continues to accept raw `contextMarkdown` + `changeReason`. Server-side validation now requires all five stage sections for personality analysts and enforces legal language (no "advice", "recommendation", "as an AI") consistent with [generate-analyst-contracts.ts](../../../scripts/generate-analyst-contracts.ts). Validation errors return `400` with `{ missingSections: [...], forbiddenPhrases: [...] }`.
- New `POST /analysts/:id/contract/validate` returning `{ valid, missingSections, forbiddenPhrases }` — powers preview-mode validation in the editor without creating a version.
- Audit findings endpoint (existing) adds `violationStage` and `contractSection` to each finding's JSON shape.

### 4.4 Frontend Changes

[`apps/web/src/views/ContractEditorView.vue`](../../../apps/web/src/views/ContractEditorView.vue):

- Replace single markdown textarea with a stage-aware editor: one collapsible panel per section (`General`, 5 stage panels, `Adaptations`), each backed by its own markdown fragment. On save, fragments are concatenated back into `context_markdown` and posted.
- Header row shows stage completion: empty / present / present-with-warnings.
- Save button disabled while validation reports missing required sections; diff view (existing `diffLeftId` / `diffRightId`) expanded to show per-section diffs (section heading + unified diff inside).
- Client-side parser (lines 77-88 of the current file) reimplemented to recognize the new `## Stage: <name>` headings (including the `Reflection (3a)` / `Debate (3b)` sub-stage forms). Local parsing powers display only; server-side validation remains authoritative on save.
- Version history table gains a column showing which sections changed between versions.

No other frontend routes/views change.

### 4.5 Infrastructure Requirements

- New stage-keyed contract set: hand-authored Markdown files in `scripts/contracts-v4/<slug>.md` (one per base analyst), mirroring the existing [scripts/contracts-v3/](../../../scripts/contracts-v3/) pattern (Opus-authored, committed to the repo for review/diff). Files conform to the stage-keyed shape in §4.1 and pass `validateContractSections`.
- New migration script `scripts/upgrade-contracts-v4.ts`, mirroring [scripts/upgrade-contracts-v3.ts](../../../scripts/upgrade-contracts-v3.ts). For each `<slug>.md` file, loads the analyst's active config version, inserts a new `analyst_config_versions` row with `version_number = active + 1`, `source='manual'`, `change_reason='stage-keyed v4 bootstrap'`, `parent_version_id = active id`, deactivates the prior row, flips `current_config_version_id`. Re-runnable: if the active config already parses as stage-keyed (has any `## Stage:` heading), skip. Scoped to the 7 base analysts only: `fundamentals-analyst, macro-strategist, momentum-analyst, sentiment-analyst, technical-analyst, arbitrator, portfolio-manager`.
- Version label rationale: existing base-analyst configs are at v3 (Opus-authored 3-section shape; see `scripts/contracts-v3/`); this effort produces v4 (Opus-authored stage-keyed shape). The intention's "v3" label predates the day-trader-contracts work; the PRD uses "v4" throughout to match the current DB state.
- No new external dependencies. No new scheduled jobs.
- No infrastructure/backup changes; schema migration rides the existing `MarketsSchemaService` startup path ([markets-schema.service.ts:461-487](../../../apps/api/src/markets/schema/markets-schema.service.ts#L461)).

## 5. Non-Functional Requirements

- **Performance:** Contract parsing runs once per LLM call, on already-loaded markdown (≤10 KB). Parse cost is O(sections), dwarfed by LLM latency. No new DB queries vs. today — `context_markdown` is already loaded in the prediction-runner path; other call sites gain one `SELECT context_markdown FROM analyst_config_versions WHERE id = ?` per invocation (pre-existing pattern, cache-friendly).
- **Empty-stage-section policy:** For an analyst that genuinely has no special guidance at a stage within its required-sections set, the stage section MUST still be present as a heading with a short explicit opt-out body, e.g. `Apply General rules unchanged at this stage; no stage-specific adaptations.` An empty heading body is a validation error. Rationale: the section's presence forces the author to make a conscious choice per stage and keeps the editor's stage-completion indicator meaningful. This resolves the open question in the intention.
- **Correctness under fallback:** If `context_markdown` is NULL or a required stage section is missing (e.g., a day-trader or a newly-seeded analyst that hasn't gone through v4 generation), the loader returns an empty fragment and the call site falls back to using `analyst.persona_prompt + adaptations` (today's behavior). A warning is logged and an observability event emitted (see §7 risk 3). This keeps day-trader analysts and any future analyst shapes working without blocking the rollout. `predictor-generator.service.ts` additionally retains the `ANALYST_SCORING_FOCUS` map as the fallback body for Predictor Generation until all analysts that run that stage have v4 contracts; the map is deleted in Phase 6 once the fallback path is provably unused.
- **Legal language compliance:** Validation enforces the existing rules from `project_legal_language.md` memory — no "advice", "recommendation", "as an AI"; required "analysis"/"signal" framing in the General section's disclaimer line.
- **Security:** No new user input surfaces; contract editing is already gated on `is_system_default` ownership. No PII enters contracts.
- **Scalability:** Per §3.6 of master-intention, cost model is content-keyed, not user-keyed. Adding stage sections increases prompt size by ~500-2000 tokens per call; acceptable on local gemma models.
- **Compatibility:** Existing audit findings, existing adaptations entries, and existing v2/v3 (pre-stage-keyed) contracts remain readable. `parseContractMarkdown` continues to recognize `## Role: <name>` headings (routed into `sections.roles`) for display-only purposes in the version history; prompts never consume them on stage-keyed v4 contracts.
- **Ollama serial constraint** (`project_ollama_serial.md`): the v4 generation script runs analysts sequentially, not in parallel.

## 6. Out of Scope

- Instrument contracts and the `## Stage: Article Processing` section (separate effort: `instrument-contracts`).
- The workflow stage taxonomy itself — already defined by `workflow-stages-article-pipeline` ([workflow-stage.ts:8-14](../../../apps/api/src/markets/workflow-stages/workflow-stage.ts#L8)).
- User-authored custom contracts and per-triple contract assembly (separate effort: `user-authored-custom-content`; `triple-model-reasoning-continuity`).
- Slot-based UI for triple selection (separate effort: `slot-based-enablement-ui`).
- Day-trader analysts (`day-trader-contracts` effort). Day-traders keep their existing `persona_prompt`-driven path via the fallback in §5; the 7-base-analyst fleet gets v4 contracts in this effort.
- Dropping the `persona_prompt` column from the schema (deferred to post-day-trader migration).
- Removing the legacy `## Role: <name>` code path from the parser (it remains for v2/v3 readback).
- Migrating historical audit findings to populate `violation_stage` retroactively.
- Changes to `tier_instructions` JSONB — it continues to feed the prompt as today for the Prediction Generation stage; future efforts may fold it into stage sections.

## 7. Dependencies & Risks

**External / upstream dependencies:**

- `workflow-stages-article-pipeline` — **landed** (enum + stage labels + order + artifact tagging). This effort references `WorkflowStage` directly.
- `tier-1-structured-writes` queued effort — also writes to `## Adaptations`. Resolution: this effort owns the contract shape; `tier-1-structured-writes` continues appending to `## Adaptations` via `updateAdaptationsSection` unchanged. No scope conflict; noted as already-running and compatible.

**Risks:**

1. **Risk: v4 Opus-authored contract content invalid or drifts from analyst's existing voice.** Mitigation: files are committed to `scripts/contracts-v4/` under version control and reviewed by the operator before `upgrade-contracts-v4.ts` runs. The upgrade script validates every file via `validateContractSections` before inserting; any file that fails validation aborts the whole batch without mutating the DB. Human spot-check on one analyst's runtime output after migration before declaring the phase complete.
2. **Risk: runtime regression — a prediction cycle silently starts using an empty or wrong-stage prompt.** Mitigation: integration test that captures the prompt for each stage and asserts it contains the stage section's distinctive content; deterministic-mode fallback ([prediction-runner.service.ts:279-287](../../../apps/api/src/markets/services/prediction-runner.service.ts#L279)) still works (LLM-disabled path is unaffected).
3. **Risk: persona_prompt fallback masks a missing v4 contract.** Mitigation: loader emits a `Logger.warn` when it falls back, and an observability event (`pipeline.contract.fallback`) so pipeline dashboards surface it. A failing assertion in CI if a base analyst (one of the 7) resolves via fallback.
4. **Risk: Arbitrator and Portfolio Manager don't fit the personality-analyst shape.** Mitigation: required-section policy lives in one map keyed by analyst type; the validator consults it. Initial policy:
   - **Personality analysts** (`fundamentals`, `macro`, `momentum`, `sentiment`, `technical`): require `General`, `Predictor Generation`, `Risk Reflection (3a)`, `Risk Debate (3b)`, `Prediction Generation`, `Learning`, `Adaptations`.
   - **Arbitrator** (`arbitrator`): require `General`, `Risk Debate (3b)`, `Learning`, `Adaptations`. Elide `Predictor Generation`, `Risk Reflection (3a)`, and `Prediction Generation` — the arbiter reads others' reflections and renders judgment in the debate; it does not score articles, reflect on instruments, or issue predictions.
   - **Portfolio Manager** (`portfolio-manager`): require `General`, `Prediction Generation`, `Learning`, `Adaptations`. Elide `Predictor Generation` and both Risk sub-stages — it converts other analysts' predictions into sized trade signals rather than operating on articles or risk (see [markets-schema.service.ts:1036-1068](../../../apps/api/src/markets/schema/markets-schema.service.ts#L1036)).
   Elided sections are not rendered in the editor for that analyst; the validator rejects extra sections as well as missing ones.
5. **Risk: the editor UI's stage panels become unwieldy if a section is long.** Mitigation: per-panel markdown editor with vertical autosize + collapse/expand; accept that Stage sections will often be 300-800 words and design for that target.
6. **Risk: rollback to v3 (pre-stage-keyed) needed mid-rollout.** Mitigation: v4 migration deactivates the prior row but does not delete it (`is_active = false` only) and records `parent_version_id`. Rollback = flip `is_active` and `current_config_version_id` back. The `persona_prompt` column remains populated, so a full revert restores today's behavior by reading that column again.

## 8. Phasing

Each phase is independently deployable and leaves the system in a working state.

### Phase 1 — Parser, Types, Loader, Validation (no runtime change)

Add the data-model plumbing without touching any call site.

- Extend `ContractSections` in [parse-contract-markdown.ts](../../../apps/api/src/markets/utils/parse-contract-markdown.ts) with a typed `stages: Record<StageKey, string>` map where `StageKey = 'predictor_generation' | 'risk_reflection' | 'risk_debate' | 'prediction_generation' | 'learning'`.
- Update `parseContractMarkdown` to recognize `## Stage: <name>` headings, including the sub-stage discriminator forms `Risk Assessment — Reflection (3a)` and `Risk Assessment — Debate (3b)`. Unknown stage headings are ignored (forward-compat).
- Add `buildStagePromptFragment(sections, stage, subStage?)`.
- Add `validateContractSections(sections, analystType)` returning `{ valid, missingSections, forbiddenPhrases }` with per-analyst-type required-section rules (personality, arbitrator, portfolio_manager).
- Unit tests in [parse-contract-markdown.test.ts](../../../apps/api/tests/unit/parse-contract-markdown.test.ts) covering: all stage sections parsed; sub-stage discriminator; missing section; forbidden phrase; arbitrator/portfolio-manager shape variants; pre-stage-keyed (v2/v3) contract still parses to empty stages without error.

**Validation:** unit tests pass; runtime behavior unchanged (`persona_prompt` still drives prompts).

### Phase 2 — v4 Stage-Keyed Contracts for 7 Base Analysts

Produce and activate stage-keyed `context_markdown` for the seven base analysts using the existing author-and-upgrade pattern.

- Author seven stage-keyed Markdown files in `scripts/contracts-v4/`, one per analyst slug: `fundamentals-analyst.md`, `macro-strategist.md`, `momentum-analyst.md`, `sentiment-analyst.md`, `technical-analyst.md`, `arbitrator.md`, `portfolio-manager.md`. Each file follows the §4.1 shape and conforms to the per-analyst-type required-section policy. Legal-language rules enforced at author time; validator re-checks at migration time.
- Write `scripts/upgrade-contracts-v4.ts` (mirror of [upgrade-contracts-v3.ts](../../../scripts/upgrade-contracts-v3.ts)). For each file: load analyst's active config, validate the file with `validateContractSections(sections, analystType)`, insert new row with `version_number = active + 1`, `source='manual'`, `change_reason='stage-keyed v4 bootstrap'`, `parent_version_id = prior active`, `is_active=true`, deactivate the prior row, flip `current_config_version_id`. Script aborts the whole batch if any file fails validation (transactional per analyst; dry-run flag to preview).
- Re-run safety: if the active config already parses to at least one `## Stage:` section, skip that analyst with a log line.
- Paper mode: `paper_config_version_id` mirrors the same file content (identical v4 row pointer) if the analyst had a paper config before migration.

**Validation:** `SELECT slug, length(context_markdown), is_active FROM market_analysts JOIN analyst_config_versions ON id = current_config_version_id WHERE slug IN (...)` returns 7 rows; each `context_markdown` parses to the required stage sections for its analyst type. No runtime behavior change yet (prompts still read `persona_prompt` + `adaptations`).

### Phase 3 — Wire Prediction Generation (primary call site)

Replace `persona_prompt + tier_instructions + adaptations` with `buildStagePromptFragment(sections, PredictionGeneration)` at the main call site.

- Update `prediction-runner.service.ts:241-263` to parse full `context_markdown` (not just adaptations) and call the new loader.
- Update `buildAnalystSystemPrompt` signature to accept `stageFragment` instead of `adaptationsText` (rename + refactor).
- On fallback (no v4 contract, NULL `context_markdown`, or missing stage section): log warn, emit observability event, use old `persona_prompt + adaptations` path.
- Paper mode (`paper_config_version_id`) reads the paper row's `context_markdown` — unchanged wiring, new content.
- Add integration test `apps/api/tests/integration/prediction-runner-stage-prompt.test.ts` that writes a distinctive token into one analyst's `## Stage: Prediction Generation`, runs a prediction, and asserts the captured prompt contains the token.

**Validation:** integration test green; manual run through the pipeline produces a prediction; observability shows zero `pipeline.contract.fallback` events for the 7 base analysts.

### Phase 4 — Wire Remaining Stages (Risk 3a, Risk 3b, Predictor Generation, Learning)

Wire the four non-prediction stages to the new loader.

- `predictor-generator.service.ts`: per-analyst scoring path — replace the `ANALYST_SCORING_FOCUS` hardcoded map lookup with a contract load + `buildStagePromptFragment(..., PredictorGeneration)`. Retain the map as fallback content for analysts without a Predictor Generation section (day-traders, pre-migration state); Phase 6 deletes it.
- Per-analyst risk reflection (3a): wire the `analyst_risk_assessments` write path in [`risk-runner.service.ts`](../../../apps/api/src/markets/services/risk-runner.service.ts) (inserts at lines 663 and 853) to inject `buildStagePromptFragment(..., RiskAssessment, 'reflection')` in the LLM call that produces `reasoning` for each row.
- `risk-debate.service.ts`: each Blue/Red/Arbiter participant receives `buildStagePromptFragment(..., RiskAssessment, 'debate')` from its own contract. Arbitrator uses its own Debate section (different content than personality analysts).
- `learning-engine.service.ts`: the LLM call that proposes adaptations receives `buildStagePromptFragment(..., Learning)`.
- Integration tests per stage, same pattern as Phase 3 (distinctive-token-per-stage).

**Validation:** all five stages have an integration test proving the stage's section is injected; `grep "persona_prompt" apps/api/src/markets` returns only schema definition / deprecation shim.

### Phase 5 — Contract Editor UI + Validation API

Make the editor stage-aware.

- Refactor [`ContractEditorView.vue`](../../../apps/web/src/views/ContractEditorView.vue): one collapsible panel per section, per-panel save-disabled when invalid, per-panel diff highlighting.
- Add `POST /analysts/:id/contract/validate` endpoint; hook it on blur/debounced-type for inline validation feedback.
- Strengthen save-time validation (`POST /analysts/:id/contract`) to reject invalid markdown with `400 { missingSections, forbiddenPhrases }`.
- Version history table shows per-section changed/unchanged markers.

**Validation:** manual test in Chrome — open a base analyst's contract, edit one stage section, save; verify diff shows only that stage; revert via version history; edit with a forbidden phrase and see the validation error.

### Phase 6 — Audit Stage Attribution + Persona Prompt Deprecation + Fallback Cleanup

Close the loop on attribution, delete dead fallback code, and deprecate the legacy column.

- Migration in `MarketsSchemaService` adds `violation_stage text` and `contract_section text` to `prediction.audit_findings` (idempotent: `IF NOT EXISTS`).
- Update `audit.service.ts` to populate these fields based on which parsed section is in play when a discrepancy is detected; include the section heading text.
- Audit UI (wherever findings render — existing component) displays "Predictor Generation clause violated" and surfaces the exact clause.
- Delete the `ANALYST_SCORING_FOCUS` map in `predictor-generator.service.ts` (retained as fallback during Phase 4). Confirm by observing zero `pipeline.contract.fallback` events for the 7 base analysts over a 24-hour window before deletion.
- Mark `market_analysts.persona_prompt` as deprecated via `COMMENT ON COLUMN market_analysts.persona_prompt IS 'DEPRECATED: superseded by analyst_config_versions.context_markdown stage sections; retained for rollback and day-trader analysts.'` Stop populating it in the seed / v4 generation scripts. Emit a startup warning if any base analyst's active config has empty `context_markdown`.

**Validation:** trigger a synthetic audit finding on a known-bad prediction and verify `violation_stage` is set; check the findings list UI renders the stage attribution; confirm `ANALYST_SCORING_FOCUS` is deleted and Predictor Generation still runs correctly.

---

**Phase ordering rationale:** Phase 1 is pure plumbing (can ship alone). Phase 2 populates data without wiring. Phase 3 flips the primary path (highest-risk change, narrowest blast radius — one file). Phase 4 rolls out to the remaining stages now that the pattern is proven. Phase 5 catches up the UI. Phase 6 adds the audit attribution and formally deprecates the legacy column. A rollback after any phase is safe: earlier phases are additive; later phases read v3 but fall back cleanly to v2 / `persona_prompt` if the loader returns an empty fragment.
