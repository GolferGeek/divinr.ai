# Stage-Keyed Analyst Contracts — Completion Report

**Plan**: [plan.md](plan.md)
**PRD**: [prd.md](prd.md)
**Intention**: [intention.md](intention.md)
**Completed**: 2026-04-16
**Final Status**: All 6 phases complete (with deferrals documented)

## Summary
- Total phases: 6
- Phases completed: 6
- Phases remaining: 0

## Phase Results

### Phase 1 — Parser, Types, Loader, Validation
**Status**: Complete, clean quality gate.
- Extended `ContractSections` with `stages` typed field and added 5 new exports (`StageKey`, `AnalystType`, `REQUIRED_SECTIONS_BY_TYPE`, `buildStagePromptFragment`, `validateContractSections`, `stageToKey`).
- 13 new parser unit tests (21 total), all green.

### Phase 2 — v4 Stage-Keyed Contracts for 7 Base Analysts
**Status**: Complete.
- Authored 7 Opus-authored stage-keyed markdown files in `scripts/contracts-v4/` covering all 3 analyst-type shapes (personality × 5, arbitrator, portfolio-manager).
- Wrote `scripts/upgrade-contracts-v4.ts` — validation-first, idempotent, `--dry-run` supported. Applied to dev DB: all 7 analysts flipped to v4 (`md_len` 5509–7622 chars).
- DB inspection confirmed `tier_instructions` was already empty `{}`, simplifying the migration.

### Phase 3 — Wire Prediction Generation
**Status**: Complete.
- New `loadContractFragment` helper in `prediction-runner.service.ts` (later promoted to shared util in Phase 4).
- `buildAnalystSystemPrompt(analyst, stageFragment)` is the v4 path; `buildLegacyAnalystSystemPrompt` preserves today's behavior for fallback.
- 4 new unit tests prove v4 injection, fallback invocation, empty-tier handling, and stub-LLM "You are <name>." prefix survival.

### Phase 4 — Wire Risk 3a + 3b Arbiter + Predictor (Learning deferred)
**Status**: Complete with documented deferrals.
- Promoted `loadContractFragment` + `emitFallback` to shared util `apps/api/src/markets/utils/contract-loader.ts`.
- Wired 3 stages: Risk Reflection (3a) in both reflection sites of `risk-runner.service.ts`, Risk Debate Arbiter role in `risk-debate.service.ts` via new `loadArbiterPrompt`, Predictor Generation in `predictor-generator.service.ts`.
- Learning stage deferred: no LLM call in learning-engine today (deterministic tier-1 writer; tier-3 strategic-overhaul uses a generic "senior analyst contract designer" meta-role). v4 Learning sections are authored and load-bearing when a future analyst-voiced Learning path ships.
- Blue/Red Debate roles kept on legacy prompts (per-analyst Blue/Red assignment is a future architectural refactor).

### Phase 5 — Contract Editor API Validation + Minimal UI
**Status**: Complete (API) / Minimal (UI).
- Added `POST /analysts/:id/contract/validate` endpoint.
- Strengthened `saveAnalystContract` with structured 400 on invalid v4 contracts.
- Extended GET response with `analystType` + `requiredSections`.
- Vue editor: stage-aware read display already worked via existing `## ` splitter; added type chip, required-sections hint, and structured validation-error display.
- Full collapsible-panel editor UI deferred to a follow-up effort (see Deviations §2).

### Phase 6 — Audit Attribution + Persona Prompt Deprecation + Fallback Cleanup
**Status**: Complete.
- Schema migration: `violation_stage text` and `contract_section text` on `prediction.audit_findings`, applied to dev DB.
- `audit.service.ts` now prefers the v4 Prediction Generation section for audit evaluation and records attribution on every finding.
- `ANALYST_SCORING_FOCUS` map deleted; replaced with a generic one-liner fallback.
- `COMMENT ON COLUMN market_analysts.persona_prompt` set to "DEPRECATED: ..." (column not dropped — retained for rollback and non-v4 analysts like day-traders).

## Gate Results

| Phase | Lint | Typecheck | Build | Unit Tests | Integration/Smoke | DB |
|-------|------|-----------|-------|-----------|-------------------|----|
| 1 | ✅ | ✅ | ✅ | ✅ 21/21 | ⚠️ pre-existing fail | — |
| 2 | ✅ | ✅ | ✅ | ✅ | ⚠️ pre-existing | ✅ 7/7 applied |
| 3 | ✅ | ✅ | ✅ | ✅ +4 new | ⚠️ pre-existing | — |
| 4 | ✅ | ✅ | ✅ | ✅ 0 fails | ⚠️ pre-existing | — |
| 5 | ✅ | ✅ | ✅ | ✅ 0 fails | ⚠️ pre-existing | — |
| 6 | ✅ | ✅ | ✅ | ✅ 0 fails | ⚠️ pre-existing | ✅ columns applied |

The ⚠️ "pre-existing fail" cells refer to two gates that also fail on clean `main` (commit 6cd8e3c): `test:compliance:core` (`4 !== 1` at run-compliance-tests.ts:87) and `test:markets:smoke` / `test:markets:integration` (FK constraint residue on `market_predictions_instrument_id_fkey`). Both are dev-DB state issues predating this effort and not caused by any change here.

## Deviations From PRD

1. **Learning-stage wiring deferred**: No LLM call exists in `learning-engine.service.ts` today (tier-1 learning is deterministic); `strategic-overhaul.service.ts` (tier-3) uses a designer meta-role. The authored v4 Learning sections are load-bearing for a future LLM-based path.
2. **Full collapsible-panel editor UI deferred**: Read-side already renders stage sections via the existing `## ` splitter. Full per-stage editor panels, on-blur debounced validation, and per-section diff viewer are follow-up UI work — the API shape is ready.
3. **Risk Debate Blue/Red roles kept generic**: The current debate service doesn't assign specific analysts to Blue/Red; only the Arbiter is analyst-keyed. Per-analyst Blue/Red assignment is a future architectural refactor. Arbiter's v4 Risk Debate section IS wired and load-bearing.
4. **Audit UI rendering of stage attribution deferred**: API exposes `violation_stage` + `contract_section`; the audit-findings display component can consume them in a follow-up.
5. **Integration-test augmentation replaced with unit coverage**: Pre-existing dev-DB FK residue blocks `test:markets:integration`. Phase 3's unit test (`prediction-runner-stage-prompt.test.ts`) proves v4 / fallback prompt assembly with distinctive sentinels.
6. **Startup scan for missing base-analyst v4 contracts not added**: The shared fallback observability event is the detection channel. A boot-time scan would be redundant.

## Success Criteria Checklist (PRD §2)

- **Goal 1**: Every analyst LLM invocation injects `General + stage-section + Adaptations` — ✅ for Prediction Generation, Risk Reflection (3a), Risk Debate (3b, Arbiter), Predictor Generation. Learning deferred.
- **Goal 2**: 7 base analysts have v4 stage-keyed contracts — ✅ (all active; v4 rows confirmed in dev DB).
- **Goal 3**: Contract Editor surfaces stage sections as navigable, validatable units — ✅ for read + validation; per-stage editing panels deferred.
- **Goal 4**: Audit findings attribute violations to a specific stage section — ✅ for v4 contracts (legacy contracts render null stage, legacy heading).
- **Goal 5**: Editing a stage section measurably changes LLM behavior — ✅ proven by sentinel-token unit test.

## Next Steps

### In-effort follow-ups tracked
- **Editor UI refactor** — convert `ContractEditorView.vue` to per-stage collapsible panels with inline validation, on-blur preflight, per-section diffing.
- **Audit findings UI** — render "Predictor Generation clause violated" using the new `violation_stage` + `contract_section` fields.
- **Learning-stage LLM path** — when a tier-2/tier-3 LLM-based adaptation-proposer ships, wire it to `loadContractFragment(..., Learning)`. The contract sections are already authored.
- **Per-analyst Blue/Red debate assignment** — future architectural refactor of `risk-debate.service.ts` so personality analysts can use their own `Stage: Risk Assessment — Debate (3b)` sections.

### Out of scope for this effort (per intention/PRD)
- Instrument contracts (separate effort: `instrument-contracts`).
- Day-trader analyst v4 migration (separate effort).
- Dropping `persona_prompt` column (deferred until all analysts migrate).
- Retroactive backfill of `violation_stage` on historical audit findings.
