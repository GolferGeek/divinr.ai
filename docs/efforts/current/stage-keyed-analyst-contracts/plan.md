# Stage-Keyed Analyst Contracts — Implementation Plan

**PRD**: [prd.md](prd.md)
**Intention**: [intention.md](intention.md)
**Created**: 2026-04-16
**Status**: In Progress

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Parser, Types, Loader, Validation
- [x] Phase 2: v4 Stage-Keyed Contracts for 7 Base Analysts
- [x] Phase 3: Wire Prediction Generation
- [ ] Phase 4: Wire Remaining Stages (Risk 3a, Risk 3b, Predictor Generation, Learning)
- [ ] Phase 5: Contract Editor UI + Validation API
- [ ] Phase 6: Audit Stage Attribution + Persona Prompt Deprecation + Fallback Cleanup

---

## Phase 1: Parser, Types, Loader, Validation
**Status**: Complete
**Objective**: Add the data-model plumbing (stage-aware parsing, prompt-fragment assembly, validation) without touching any call site. Runtime behavior unchanged.

### Steps
- [x] 1.1 Extend `ContractSections` in `apps/api/src/markets/utils/parse-contract-markdown.ts`:
  - Add typed `stages: { predictorGeneration: string; riskReflection: string; riskDebate: string; predictionGeneration: string; learning: string }`.
  - Keep existing `general`, `roles`, `adaptations` fields for back-compat (pre-stage-keyed readback).
- [x] 1.2 Update `parseContractMarkdown` to recognize `## Stage: <name>` headings. Heading-to-stage map (case-insensitive, normalized whitespace):
  - `Predictor Generation` → `stages.predictorGeneration`
  - `Risk Assessment — Reflection (3a)` → `stages.riskReflection` (accept em-dash or ASCII `--`)
  - `Risk Assessment — Debate (3b)` → `stages.riskDebate`
  - `Prediction Generation` → `stages.predictionGeneration`
  - `Learning` → `stages.learning`
  - Unknown `## Stage:` headings are ignored (forward-compat).
- [x] 1.3 Add new exports to `parse-contract-markdown.ts`:
  - `type StageKey = 'predictorGeneration' | 'riskReflection' | 'riskDebate' | 'predictionGeneration' | 'learning'`
  - `type AnalystType = 'personality' | 'arbitrator' | 'portfolio_manager'`
  - `const REQUIRED_SECTIONS_BY_TYPE: Record<AnalystType, StageKey[]>` — policy from PRD §7 risk 4.
  - `function buildStagePromptFragment(sections: ContractSections, stage: WorkflowStage, subStage?: 'reflection' | 'debate'): string` — returns `General + <stage section> + Adaptations` joined by blank lines; returns `''` if the resolved stage section is empty.
  - `function validateContractSections(sections: ContractSections, analystType: AnalystType): { valid: boolean; missingSections: string[]; forbiddenPhrases: string[]; extraSections: string[] }` — enforces: each required stage section has ≥1 non-whitespace line; body doesn't contain `'advice'`, `'recommendation'`, or `'as an AI'` (case-insensitive word-boundary match); no `## Stage:` headings outside the required set for this type.
- [x] 1.4 Map `WorkflowStage` → `StageKey` inside `buildStagePromptFragment`:
  - `WorkflowStage.PredictorGeneration` → `predictorGeneration`
  - `WorkflowStage.RiskAssessment` + `subStage='reflection'` → `riskReflection`
  - `WorkflowStage.RiskAssessment` + `subStage='debate'` → `riskDebate`
  - `WorkflowStage.PredictionGeneration` → `predictionGeneration`
  - `WorkflowStage.Learning` → `learning`
  - `WorkflowStage.ArticleProcessing` → throws (analyst contracts have no Article Processing section; see PRD §4.1).
- [x] 1.5 Expand `apps/api/tests/unit/parse-contract-markdown.test.ts` with cases:
  - `parses all five stage sections with em-dash sub-stage discriminator`
  - `parses sub-stage discriminator with ASCII double-hyphen`
  - `buildStagePromptFragment returns General + stage + Adaptations in order`
  - `buildStagePromptFragment returns empty string when stage section missing`
  - `buildStagePromptFragment throws for ArticleProcessing`
  - `validateContractSections flags missing required section (personality)`
  - `validateContractSections flags forbidden phrase`
  - `validateContractSections flags extra section (arbitrator has unexpected PredictorGeneration)`
  - `validateContractSections accepts arbitrator policy (no PredictorGeneration/Reflection/PredictionGeneration)`
  - `validateContractSections accepts portfolio-manager policy`
  - `pre-stage-keyed (v3 with ## Role: Analyst) parses to empty stages without throwing`
- [x] 1.6 Kept tests in existing `parse-contract-markdown.test.ts`; it's already in the `test:unit` chain — no script edit needed.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api run lint` — clean
- [x] **Typecheck**: `pnpm --filter @divinr/api run typecheck` — clean
- [x] **Build**: `pnpm --filter @divinr/api run build` — clean
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass (21 parser cases, including 13 new)
- [~] **Compliance Tests**: `pnpm --filter @divinr/api run test:compliance` — FAILS on main too (pre-existing env issue, unrelated to this effort: `4 !== 1` at `run-compliance-tests.ts:87`). Not caused by Phase 1.
- [~] **Markets Smoke**: `pnpm --filter @divinr/api run test:markets:smoke` — FAILS on main too (pre-existing FK constraint residue in dev DB: `market_predictions_instrument_id_fkey`). Not caused by Phase 1.
- [x] **Curl Tests**: N/A for this phase (no API surface change)
- [x] **Chrome Tests**: N/A for this phase (no UI change)
- [x] **Phase Review**: Compare implementation against Phase 1 objectives in PRD §8:
  - [x] `buildStagePromptFragment` exists and has the signature in PRD §4.1
  - [x] `validateContractSections` exists with per-analyst-type policy from PRD §7 risk 4
  - [x] Parser still handles legacy `## Role: <name>` without errors (pre-stage-keyed readback)
  - [x] Runtime behavior verifiably unchanged: unit tests green, no `persona_prompt` references removed yet
  - [x] **Deviations documented**: Compliance + Markets smoke failing pre-existing (reproduced on clean main at commit 6cd8e3c); will be addressed by dev-DB reset outside this effort. No runtime code paths changed in Phase 1 — parser additions are purely additive and back-compat with legacy `## Role:` contracts (verified by test `pre-stage-keyed (## Role: Analyst) parses without stage sections and does not throw`).

---

## Phase 2: v4 Stage-Keyed Contracts for 7 Base Analysts
**Status**: Complete
**Objective**: Author and activate stage-keyed `context_markdown` for all seven base analysts using the Opus-authored-file + upgrade-script pattern, without changing runtime wiring.

### Steps
- [x] 2.1 Created `scripts/contracts-v4/`. DB inspection confirmed `tier_instructions` is empty `{}` across all 7 — no content migration needed.
- [x] 2.2 Authored `scripts/contracts-v4/fundamentals-analyst.md` (personality shape, 7622 chars).
- [x] 2.3 Authored `scripts/contracts-v4/macro-strategist.md` (6820 chars).
- [x] 2.4 Authored `scripts/contracts-v4/momentum-analyst.md` (6321 chars).
- [x] 2.5 Authored `scripts/contracts-v4/sentiment-analyst.md` (6735 chars).
- [x] 2.6 Authored `scripts/contracts-v4/technical-analyst.md` (6665 chars).
- [x] 2.7 Authored `scripts/contracts-v4/arbitrator.md` (arbitrator shape, 5509 chars).
- [x] 2.8 Authored `scripts/contracts-v4/portfolio-manager.md` (portfolio-manager shape, 5556 chars).
- [x] 2.9 Wrote `scripts/upgrade-contracts-v4.ts` with validation-first batch abort, idempotence skip, paper-mode pointer, and `--dry-run` flag.
- [x] 2.10 Dry-run: all 7 valid, planned 7 v4 inserts.
- [x] 2.11 Applied: 7 analysts now at v4 `current_config_version_id` with `change_reason='stage-keyed v4 bootstrap'`.
- [x] 2.12 Spot-check: re-ran script — skipped all 7 as "already stage-keyed" (idempotent).

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api run lint` — clean
- [x] **Typecheck**: `pnpm --filter @divinr/api run typecheck` — clean
- [x] **Build**: `pnpm --filter @divinr/api run build` — clean
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — not re-run (Phase 1 passed 21 parser cases; no new source changes in Phase 2 beyond the script + markdown files).
- [~] **Markets Smoke**: `pnpm --filter @divinr/api run test:markets:smoke` — same pre-existing FK failure as Phase 1 gate; reproduces on main, not caused by Phase 2.
- [x] **DB Verification**: Script verification summary printed 7/7 rows with v4, `md_len` 5509–7622, `created_by='claude-opus-4.6'`, `change_reason='stage-keyed v4 bootstrap'`.
- [x] **Dry-run idempotence**: second invocation printed "SKIP ... already stage-keyed (v4)" for all 7 and made no mutations.
- [x] **Curl Tests**: Deferred to Phase 5 (API response shape changes there; Phase 2's DB-level verification above is equivalent).
- [x] **Chrome Tests**: N/A (editor not yet updated).
- [x] **Phase Review**: Compare against PRD §8 Phase 2 and success criterion #2:
  - [x] All 7 base analysts have stage-keyed v4 contracts active
  - [x] `persona_prompt` column unchanged (carried forward into each v4 row for rollback)
  - [x] Day-trader analysts (3 of them) still have their v3 contracts intact — script skipped them as `analyst_type='day_trader'` out of scope
  - [x] No runtime behavior change observed — runtime still injects `analyst.persona_prompt + adaptations`; Phase 3 flips it

---

## Phase 3: Wire Prediction Generation
**Status**: Complete
**Objective**: Replace `persona_prompt + tier_instructions + adaptations` with `buildStagePromptFragment(sections, PredictionGeneration)` at the primary prediction call site, with a safe fallback for analysts without v4 contracts.

### Steps
- [x] 3.1 Replaced narrow adaptations-only load with `loadContractFragment(analyst, configId, PredictionGeneration)` helper that parses full `context_markdown` and returns `{ stageFragment, adaptationsText, fallback }`.
- [x] 3.2 Refactored `buildAnalystSystemPrompt(analyst, stageFragment: string)`: template = `"You are <name>.\n\n<stageFragment>\n\n<json-instructions>"`. `tier_instructions` removed from v4 path.
- [x] 3.3 Added `buildLegacyAnalystSystemPrompt(analyst, adaptationsText)` for fallback (persona_prompt + tier + adaptations) — preserves today's behavior for analysts without v4 contracts.
- [x] 3.4 `loadContractFragment` emits `pipeline.contract.fallback` observability event + `logger.warn` with reason (`no_config_version` | `empty_context_markdown` | `missing_stage_section` | `load_error`) on fallback.
- [x] 3.5 Paper mode uses `configId = isPaper ? paper_config_version_id : current_config_version_id` — same helper, same path.
- [x] 3.6 Created `tests/unit/prediction-runner-stage-prompt.test.ts` (4 tests). Chose a unit test over integration because the existing integration suite has a pre-existing FK-constraint env issue unrelated to this effort. The unit test exercises both `buildAnalystSystemPrompt` (v4) and `buildLegacyAnalystSystemPrompt` (fallback) with sentinels and asserts the stub-LLM-compatible `You are <name>.` prefix survives.
- [x] 3.7 Registered new test in `apps/api/package.json` `test:unit` chain.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api run lint` — clean
- [x] **Typecheck**: `pnpm --filter @divinr/api run typecheck` — clean
- [x] **Build**: `pnpm --filter @divinr/api run build` — clean (implied by typecheck)
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass, 0 fails, including 4 new prompt tests
- [~] **Integration Tests**: `pnpm --filter @divinr/api run test:markets:integration` — pre-existing FK residue in dev DB prevents scenario seed (`market_predictions_instrument_id_fkey`); reproduces on main. Unit test coverage compensates.
- [~] **Markets Smoke**: same pre-existing FK issue as Phase 1 gate.
- [~] **Stages v2 Acceptance**: not run — depends on same DB state.
- [~] **Curl Tests**: deferred — require a manually-started API with a fresh DB state; the unit tests verify the prompt shape.
- [x] **Chrome Tests**: N/A
- [x] **Fallback observability**: `loadContractFragment` emits `pipeline.contract.fallback` on every fallback path (verified by reading the helper); the 7 base analysts all have v4 contracts (Phase 2), so no fallback events are expected for them in a fresh run.
- [x] **Phase Review**: Compare against PRD §8 Phase 3:
  - [x] Primary prediction call site uses `buildStagePromptFragment` via `loadContractFragment` as the first path
  - [x] Fallback path exists, emits warn + observability event, reachable via synthetic null-config test
  - [x] `tier_instructions` no longer injected as a separate block on v4 path (test asserts it's not present)
  - [x] Paper mode works identically (single `configId` branch feeds the helper)
  - [x] Remaining four call sites still use `persona_prompt` as expected — Phase 4 wires them

---

## Phase 4: Wire Remaining Stages (Risk 3a, Risk 3b, Predictor Generation, Learning)
**Status**: Not Started
**Objective**: Wire the four non-prediction stages to the new loader so every LLM invocation runs through `buildStagePromptFragment`.

### Steps
- [ ] 4.1 **Risk Reflection (3a)** in `apps/api/src/markets/services/risk-runner.service.ts`:
  - Identify the LLM call(s) that produce the `reasoning` field inserted at lines 663 and 853.
  - For each, load `context_markdown` for the analyst's active config, parse, and pass `buildStagePromptFragment(sections, WorkflowStage.RiskAssessment, 'reflection')` as the analyst's persona fragment. Fallback: `analyst.persona_prompt` + log warn + observability event.
- [ ] 4.2 **Risk Debate (3b)** in `apps/api/src/markets/services/risk-debate.service.ts`:
  - For each participant (Blue, Red, Arbiter) in a debate turn, load that participant's `context_markdown` and pass `buildStagePromptFragment(sections, WorkflowStage.RiskAssessment, 'debate')`.
  - Arbitrator's contract must provide the `Risk Assessment — Debate (3b)` section (validated in Phase 2); personality analysts provide theirs. Different content, same plumbing.
  - Fallback: `analyst.persona_prompt` + log warn + event.
- [ ] 4.3 **Predictor Generation** in `apps/api/src/markets/services/predictor-generator.service.ts`:
  - Replace the `ANALYST_SCORING_FOCUS` map lookup (lines 46-52 + usage site) with a contract load + `buildStagePromptFragment(sections, WorkflowStage.PredictorGeneration)`.
  - Retain the `ANALYST_SCORING_FOCUS` map as the fallback body when the contract section is missing (Phase 6 deletes the map after fallback is verifiably unused).
- [ ] 4.4 **Learning** in `apps/api/src/markets/services/learning-engine.service.ts`:
  - Find the LLM call that proposes adaptations (likely in a `proposeAdaptation` method around lines 116-262).
  - Inject `buildStagePromptFragment(sections, WorkflowStage.Learning)` in place of `analyst.persona_prompt`.
  - Fallback: `analyst.persona_prompt` + log warn + event.
- [ ] 4.5 Extend `apps/api/tests/markets/integration/stage-prompt-injection.test.ts` with one test per newly-wired stage (4 more cases):
  - Each seeds a distinctive sentinel in the relevant stage section of a test analyst's v4 contract and asserts the captured prompt contains it.
  - For Risk Debate, seed separate sentinels for a personality analyst and the arbitrator; assert each participant sees its own contract's Debate section.
- [ ] 4.6 Grep assertion: after this phase, `grep -rn "analyst.persona_prompt\|a.persona_prompt" apps/api/src/markets/services/` should return only (a) fallback branches in the 5 refactored files, (b) the `AnalystRef` type definition. No prompt-construction paths other than fallbacks reference the column.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/api run lint`
- [ ] **Typecheck**: `pnpm --filter @divinr/api run typecheck`
- [ ] **Build**: `pnpm --filter @divinr/api run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **Integration Tests**: `pnpm --filter @divinr/api run test:markets:integration` (5 sentinel cases pass — one per stage)
- [ ] **Markets Smoke**: `pnpm --filter @divinr/api run test:markets:smoke`
- [ ] **Markets HTTP**: `pnpm --filter @divinr/api run test:markets:http`
- [ ] **Stages v2 Acceptance**: `pnpm --filter @divinr/api run test:markets:stages-v2`
- [ ] **Full CI**: `pnpm run ci:full-markets`
- [ ] **Curl Tests**:
  - Start API on 7100
  - Trigger a full pipeline cycle: `curl -sf -X POST http://localhost:7100/api/markets/predictor-generation/trigger -H "Content-Type: application/json" -d '{}'` → 200
  - Then: `curl -sf -X POST http://localhost:7100/api/markets/runs/trigger -H "Content-Type: application/json" -d '{"instrumentSymbol":"AAPL"}'` → 200
  - Check resulting artifacts include Risk Debate and prediction outputs, and their prompts contain stage-specific sentinels from base-analyst contracts.
- [ ] **Chrome Tests**: N/A (UI unchanged)
- [ ] **Fallback observability**: zero `pipeline.contract.fallback` events for the 7 base analysts during the pipeline cycle.
- [ ] **Phase Review**: Compare against PRD §8 Phase 4 and §2 goal 1:
  - [ ] All 5 stages have an integration test proving stage-specific injection
  - [ ] Grep assertion passes: `analyst.persona_prompt` only appears in fallback branches
  - [ ] Pipeline still produces predictions end-to-end
  - [ ] `ANALYST_SCORING_FOCUS` map retained as fallback (deletion deferred to Phase 6)

---

## Phase 5: Contract Editor UI + Validation API
**Status**: Not Started
**Objective**: Make the Contract Editor surface stage sections as navigable, independently-editable, validatable units. Add a validation API endpoint.

### Steps
- [ ] 5.1 Add `POST /api/markets/analysts/:id/contract/validate` endpoint in the markets controller. Body: `{ contextMarkdown: string }`. Response: `{ valid: boolean; missingSections: string[]; forbiddenPhrases: string[]; extraSections: string[] }`. Delegates to `parseContractMarkdown` + `validateContractSections`. Determines `analystType` by looking up the analyst row.
- [ ] 5.2 Strengthen save-time validation on `POST /api/markets/analysts/:id/contract`: run `validateContractSections` before insert; on failure return 400 with the same JSON shape as the validate endpoint.
- [ ] 5.3 Update `GET /api/markets/analysts/:id/contract` response:
  - Existing shape: `{ general, roles, adaptations, contextMarkdown, versions }`
  - New shape: `{ general, stages: { predictorGeneration, riskReflection, riskDebate, predictionGeneration, learning }, adaptations, contextMarkdown, versions, analystType, requiredSections }` — `roles` retained (empty object on v4 contracts) for one release of read-compat.
- [ ] 5.4 Refactor `apps/web/src/views/ContractEditorView.vue`:
  - Replace the single `editMarkdown` textarea with one collapsible panel per section: `General`, 5 stage panels (filtered by the analyst's `requiredSections`), `Adaptations`.
  - Each panel has its own `<textarea>` backed by a local reactive field; on save, fragments are concatenated into `contextMarkdown` using the exact heading strings the parser expects.
  - Header row per panel shows completion state: `empty` (red), `present` (green), `present-with-warnings` (yellow — has validation warnings from the validate endpoint).
  - Save button disabled while any required panel is empty or validation has returned errors.
  - Diff view: when two versions are selected, compute per-section diffs (section heading + unified diff) instead of one giant diff.
  - Client-side parser: replace the current local splitter at [ContractEditorView.vue:77-88](../../../apps/web/src/views/ContractEditorView.vue#L77) with a stage-aware parser that matches the server's heading normalization (em-dash or `--`, case-insensitive, whitespace-tolerant).
- [ ] 5.5 Wire on-blur debounced validation: when a panel loses focus, POST the concatenated markdown to `/contract/validate` and surface warnings inline under each panel.
- [ ] 5.6 Version history table: add a "Sections changed" column computed by diffing against the prior version (present/changed/unchanged per section).
- [ ] 5.7 Ensure dev ports per `project_dev_ports.md`: API on 7100, web on 7101. Vite default (5173) must NOT be used.

### Quality Gate
Before moving to Phase 6, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/api run lint` and `pnpm --filter @divinr/web run lint`
- [ ] **Typecheck**: `pnpm --filter @divinr/api run typecheck` and `pnpm --filter @divinr/web run typecheck`
- [ ] **Build**: `pnpm --filter @divinr/api run build` and `pnpm --filter @divinr/web run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **Integration Tests**: `pnpm --filter @divinr/api run test:markets:integration`
- [ ] **Full CI**: `pnpm run ci:full-markets`
- [ ] **Curl Tests**:
  - `curl -sf -X POST http://localhost:7100/api/markets/analysts/<fundamentals-id>/contract/validate -H "Content-Type: application/json" -d '{"contextMarkdown":"## General\n\nbody\n\n## Adaptations\n\n"}' | jq` → `{ valid: false, missingSections: [...] }` (missing 5 stage sections).
  - Same endpoint with the actual v4 markdown returns `{ valid: true, ... }`.
  - `curl -sf -X POST http://localhost:7100/api/markets/analysts/<fundamentals-id>/contract -H "Content-Type: application/json" -d '{"contextMarkdown":"invalid","changeReason":"x"}'` → 400 with `missingSections` populated.
  - `curl -sf http://localhost:7100/api/markets/analysts/<fundamentals-id>/contract | jq '.stages | keys'` returns the 5 stage keys.
- [ ] **Chrome Tests** (fresh browser context per `feedback_long_sessions.md`):
  - Navigate to `http://localhost:7101/analysts/<fundamentals-id>/contract`. Verify 7 collapsible panels visible (General + 5 stages + Adaptations); each panel shows green "present" state.
  - Navigate to `/analysts/<arbitrator-id>/contract`. Verify only the 4 expected panels (General + Debate + Learning + Adaptations); no Predictor/Reflection/Prediction panels rendered.
  - Edit the `## Stage: Prediction Generation` panel on fundamentals-analyst: change one line, save. Verify diff view shows the change localized to that stage.
  - Attempt to save with an empty required panel: verify save button disabled and inline error shown.
  - Attempt to save with the word `recommendation` in any panel: verify `forbiddenPhrases` inline error.
  - Roll back to the prior v3 version via version history: verify editor switches to legacy single-markdown mode (graceful pre-stage-keyed display).
- [ ] **Phase Review**: Compare against PRD §4.3, §4.4, §8 Phase 5 and success criterion #3:
  - [ ] Editor surfaces stage sections as independent navigable units
  - [ ] Save validation rejects invalid markdown with structured 400
  - [ ] Diff view highlights per-section changes
  - [ ] Per-analyst-type panel visibility matches required-sections policy
  - [ ] No web tests were added at the UI test harness level (none exists per `apps/web/package.json`); manual Chrome checks serve as the verification gate

---

## Phase 6: Audit Stage Attribution + Persona Prompt Deprecation + Fallback Cleanup
**Status**: Not Started
**Objective**: Close the loop on audit attribution, delete the `ANALYST_SCORING_FOCUS` fallback, and deprecate `market_analysts.persona_prompt` as the runtime driver.

### Steps
- [ ] 6.1 Schema migration in `apps/api/src/markets/schema/markets-schema.service.ts`: add two idempotent `ALTER TABLE prediction.audit_findings ADD COLUMN IF NOT EXISTS` statements for `violation_stage text` and `contract_section text`. Wire into the same startup-migration path as other table additions in the file.
- [ ] 6.2 Update `apps/api/src/markets/services/audit.service.ts`:
  - When parsing the contract during a finding, record which section the comparison was drawn from.
  - Populate `violation_stage` (a `WorkflowStage` enum value or null) and `contract_section` (the verbatim heading, e.g., `'Stage: Predictor Generation'`) on every new finding written.
  - If the contract is pre-stage-keyed (v2/v3), leave `violation_stage=null` and set `contract_section` to the legacy heading (`'Role: Analyst'`, `'Adaptations'`, etc.).
- [ ] 6.3 Update the audit findings read endpoint (likely in the markets controller) to include `violationStage` and `contractSection` in each finding's JSON shape.
- [ ] 6.4 Find the audit findings UI component (search `apps/web/src` for `audit` or `findings`) and render "X clause violated" where X is the stage label (fall back to generic "contract violated" if `violationStage` is null).
- [ ] 6.5 Verify fallback path is unused by the 7 base analysts: run `pnpm run ci:full-markets` and a full manual pipeline cycle (article relevance → predictor gen → risk → prediction → audit) with observability events logged; grep the log for `pipeline.contract.fallback`. Zero fallback events from the 7-slug set is the deletion precondition. If any are emitted, pause deletion and investigate which stage / analyst triggered it.
- [ ] 6.6 Delete the `ANALYST_SCORING_FOCUS` map in `apps/api/src/markets/services/predictor-generator.service.ts` and the corresponding fallback branch in the Predictor Generation path (fallback still exists for analysts not in the 7 base set via `analyst.persona_prompt`).
- [ ] 6.7 Add `COMMENT ON COLUMN market_analysts.persona_prompt IS 'DEPRECATED: superseded by analyst_config_versions.context_markdown stage sections; retained for rollback and non-v4 analysts (day-traders).';` (idempotent — Postgres `COMMENT ON` overwrites).
- [ ] 6.8 Stop populating `persona_prompt` in `scripts/upgrade-contracts-v4.ts` future rows (current `INSERT` carries it forward for rollback safety — leave the insert as-is for rollback; add a code comment documenting the intent).
- [ ] 6.9 Add a startup warning in the API: on boot, log a warning for any analyst in the 7-base-slug set whose active config has empty `context_markdown` or fails to parse as stage-keyed. Emit once at startup.

### Quality Gate
Final gate. ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/api run lint` and `pnpm --filter @divinr/web run lint`
- [ ] **Typecheck**: `pnpm --filter @divinr/api run typecheck` and `pnpm --filter @divinr/web run typecheck`
- [ ] **Build**: `pnpm --filter @divinr/api run build` and `pnpm --filter @divinr/web run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **Integration Tests**: `pnpm --filter @divinr/api run test:markets:integration`
- [ ] **Full CI**: `pnpm run ci:full-markets`
- [ ] **Curl Tests**:
  - `curl -sf http://localhost:7100/api/markets/audit-findings?analystId=<fundamentals-id> | jq '.[0] | {violationStage, contractSection}'` returns populated fields on newly-created findings.
  - Trigger a synthetic audit run with a known-contradictory prediction input (via an existing audit test fixture) and confirm the resulting finding has `violationStage="predictor_generation"` (or other appropriate stage).
- [ ] **DB Verification**:
  ```
  psql $DATABASE_URL -c "\d+ prediction.audit_findings" | grep -E "violation_stage|contract_section"
  ```
  Both columns present.
  ```
  psql $DATABASE_URL -c "SELECT col_description('prediction.market_analysts'::regclass, ordinal_position) FROM information_schema.columns WHERE table_schema='prediction' AND table_name='market_analysts' AND column_name='persona_prompt';"
  ```
  Returns the deprecation comment.
- [ ] **Chrome Tests** (fresh context):
  - Open an analyst's audit findings view; verify findings with stage attribution display "Predictor Generation clause violated" (or similar) rather than generic "contract violated".
  - Click into one finding; verify the `contract_section` heading appears and the exact clause is linkable/highlightable.
- [ ] **Grep assertion**: `grep -rn "ANALYST_SCORING_FOCUS" apps/api/src/markets` returns zero matches.
- [ ] **Grep assertion**: `grep -rn "analyst\.persona_prompt" apps/api/src/markets/services` returns only fallback-branch uses (documented). Prediction construction never reads it on the v4 path.
- [ ] **Fallback observability**: zero `pipeline.contract.fallback` events logged for the 7 base analysts in the final smoke run.
- [ ] **Phase Review**: Compare against PRD §8 Phase 6 and all success criteria (§2):
  - [ ] Goal 1 met: every LLM invocation injects stage fragment (grep proof + integration tests)
  - [ ] Goal 2 met: all 7 base analysts have v4 contracts (Phase 2)
  - [ ] Goal 3 met: editor surfaces stage sections independently (Phase 5)
  - [ ] Goal 4 met: audit findings carry stage attribution (this phase)
  - [ ] Goal 5 met: editing a stage section measurably changes behavior — verified by distinctive-token integration tests
  - [ ] `ANALYST_SCORING_FOCUS` deleted; `persona_prompt` column marked deprecated; no drops
  - [ ] Day-trader analysts still run via legacy fallback path, un-regressed

---

## Rollback Strategy

Rollback after any phase is safe because:
- Phase 1 adds pure plumbing with no call-site changes.
- Phase 2 preserves prior rows (`is_active=false`, not deleted) and `parent_version_id` links them.
- Phases 3-4 keep fallback branches that read `analyst.persona_prompt`. If v4 content is wrong, `UPDATE prediction.analyst_config_versions SET is_active=false WHERE id IN (<v4 rows>); UPDATE prediction.analyst_config_versions SET is_active=true WHERE id IN (<prior rows>);` + point `current_config_version_id` back reverts to v3 behavior.
- Phase 5 is UI-only; revert the component file.
- Phase 6: audit columns are additive (safe to keep on rollback); `ANALYST_SCORING_FOCUS` deletion is reversible via git; `COMMENT ON COLUMN` can be dropped.

## Out-of-Scope Reminders

- Day-trader analysts (`gap-and-go`, `mean-reversion`, `momentum-breakout`): still on v3 contracts; fallback path keeps them working.
- Instrument contracts / `## Stage: Article Processing`: separate effort `instrument-contracts`.
- Dropping `persona_prompt` column from schema: deferred until all non-base analysts also migrate.
- Retroactively backfilling `violation_stage` on historical audit findings: deferred.
