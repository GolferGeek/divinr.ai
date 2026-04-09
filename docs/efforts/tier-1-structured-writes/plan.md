# Tier 1 Structured Writes — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-09
**Status**: Complete

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Utility + Unit Tests
- [x] Phase 2: Learning Engine Integration
- [x] Phase 3: Audit + Runner Integration

---

## Phase 1: Utility + Unit Tests
**Status**: Complete
**Objective**: Implement `updateAdaptationsSection` utility and `AdaptationEntry` type with full unit test coverage, including round-trip verification with the existing `parseContractMarkdown`.

### Steps
- [x] 1.1 Add `AdaptationEntry` interface and `updateAdaptationsSection` function to `apps/api/src/markets/utils/parse-contract-markdown.ts`. The function: parses contract, locates `## Adaptations`, formats the new entry as `### <patternType> — <date>\n<instruction>\nSource: tier1_auto | Confidence shift: <n>% | Weight shift: <n>`, appends it (or replaces an existing entry with the same `patternType` for idempotency), and returns the full updated markdown. If `## Adaptations` doesn't exist, insert it before any unrecognized trailing content.
- [x] 1.2 Export both `AdaptationEntry` and `updateAdaptationsSection` from the utility file.
- [x] 1.3 Create `apps/api/tests/unit/update-adaptations-section.test.ts` with these test cases:
  - Append a single entry to an empty `## Adaptations` section
  - Append a second entry (different pattern type) — both entries present
  - Idempotent update: same pattern type replaces existing entry (verify old entry gone, new entry present)
  - Contract with no `## Adaptations` section — section is created
  - Round-trip: `updateAdaptationsSection` → `parseContractMarkdown` → verify `sections.adaptations` contains the entry text
  - Preserves other sections (`## General`, `## Role: *`) unchanged
- [x] 1.4 Register the new test file in `apps/api/package.json` `test:unit` script.
- [x] 1.5 Verify existing `parse-contract-markdown.test.ts` still passes (adaptations parsing already works).
- [x] 1.6 Verify `context-markdown-carry-forward.test.ts` still passes (no changes expected, but confirm).

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit`
- [x] **Phase Review**: Compare implementation against Phase 1 objectives in the PRD
  - [x] `updateAdaptationsSection` implemented and exported
  - [x] `AdaptationEntry` type defined and exported
  - [x] Unit tests cover: single append, multiple append, idempotent update, missing section, round-trip
  - [x] Existing parse-contract-markdown and carry-forward tests unaffected

---

## Phase 2: Learning Engine Integration
**Status**: In Progress
**Objective**: Refactor the learning engine to build `AdaptationEntry` objects from detected patterns and write them into `context_markdown` instead of appending suffixes to `persona_prompt`.

### Steps
- [x] 2.1 In `apps/api/src/markets/services/learning-engine.service.ts`, refactor the proposal creation logic (around line 244): instead of `const proposedPrompt = analyst.persona_prompt + pattern.promptSuffix`, build an `AdaptationEntry` from the pattern (map pattern type → `patternType`, use current date, use existing `promptSuffix` text as `instruction`, include `confidenceShift` and `weightShift` from pattern).
- [x] 2.2 Call `updateAdaptationsSection(currentContextMarkdown, entry)` to produce the updated contract. Fetch `currentContextMarkdown` from the analyst's current or paper config version (whichever is being modified).
- [x] 2.3 When creating the new config version, set `persona_prompt` to the **parent version's `persona_prompt` unchanged** and `context_markdown` to the updated contract. Set `change_reason` to include the adaptation entry summary (pattern type + date + shifts).
- [x] 2.4 In `activatePaperMode`: verify that the proposed `context_markdown` is passed explicitly to the new paper config version rather than relying solely on the carry-forward subselect. If it uses the subselect, change it to accept the proposed markdown as a parameter.
- [x] 2.5 Handle edge case: if `currentContextMarkdown` is NULL (analyst has no contract yet), skip structured write and log a warning — don't create a broken config version.
- [x] 2.6 Update `apps/api/tests/unit/learning-engine.test.ts`:
  - Verify that overconfident pattern produces a config version with `context_markdown` containing `### Overconfident — <date>` and `persona_prompt` unchanged
  - Verify that underconfident pattern produces correct adaptation entry
  - Verify that directional bias pattern produces correct adaptation entry
  - Verify idempotency: same pattern on consecutive runs replaces entry in `## Adaptations`
  - Verify NULL `context_markdown` is handled gracefully

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit`
- [x] **Phase Review**: Compare implementation against Phase 2 objectives in the PRD
  - [x] Learning engine writes `AdaptationEntry` into `context_markdown` instead of appending to `persona_prompt`
  - [x] `persona_prompt` is unchanged in new config versions
  - [x] Paper mode activation passes proposed `context_markdown` explicitly
  - [x] `change_reason` references the adaptation entry
  - [x] Learning engine tests updated and passing

---

## Phase 3: Audit + Runner Integration
**Status**: Complete
**Objective**: Make adaptations visible to the Tier 2 audit system and actionable by the prediction runner, closing the loop so adaptations are both checked and followed.

### Steps
- [x] 3.1 In `apps/api/src/markets/services/audit.service.ts`, in the audit LLM prompt construction (around lines 463-528): after the existing `ANALYST CONTRACT (Role Section)` and `ANALYST CONTRACT (General Section)`, add an `ANALYST CONTRACT (Adaptations)` block when `sections.adaptations` is non-empty. This lets the auditor check whether the analyst followed its adaptation instructions.
- [x] 3.2 In `apps/api/src/markets/services/prediction-runner.service.ts`, in `buildAnalystSystemPrompt` (around line 420): after `persona_prompt` inclusion, fetch the config version's `context_markdown`, parse it with `parseContractMarkdown`, and append the `adaptations` section content to the system prompt. Only append if adaptations is non-empty. This is CRITICAL — without this, adaptations are written but never influence predictions.
- [x] 3.3 Ensure `buildAnalystSystemPrompt` has access to `context_markdown` — it currently receives a `MarketAnalyst` object. If `context_markdown` isn't on that type/query, add it to the query that loads analyst config for prediction runs.
- [x] 3.4 Update or create test coverage:
  - Verify audit prompt includes adaptations section when contract has `## Adaptations` content
  - Verify audit prompt omits adaptations block when section is empty
  - Verify prediction runner prompt includes adaptation text when `context_markdown` has entries
  - Verify prediction runner prompt works normally when `context_markdown` is NULL or has no adaptations
- [x] 3.5 Run full test suite to verify no regressions across all test types.

### Quality Gate
Before marking effort complete, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit`
- [x] **Full Tests**: `cd apps/api && pnpm test` (includes unit + compliance + smoke)
- [x] **Phase Review**: Compare implementation against Phase 3 objectives in the PRD
  - [x] Audit LLM prompt includes `ANALYST CONTRACT (Adaptations)` when present
  - [x] Prediction runner includes adaptation text in system prompt
  - [x] Both audit and runner handle missing/empty adaptations gracefully
  - [x] All PRD success criteria met:
    - [x] Learning engine writes into `## Adaptations` (Phase 2)
    - [x] Adaptations are structured and parseable (Phase 1)
    - [x] Carry-forward preserves adaptations (Phase 1 verified)
    - [x] Tier 2 audit sees Tier 1 changes (Phase 3)
    - [x] Paper mode uses updated contract (Phase 2)
    - [x] Existing tests pass (all phases)
    - [x] New tests cover structured writes (all phases)
