# Effort: Stage-Keyed Analyst Contracts

## Problem

Analyst contracts today have three sections (`## General`, `## Role: <name>`, `## Adaptations`) but only the Adaptations section is currently injected into prompts at runtime — the General and Role sections exist as compliance/audit documentation but don't actually flow into the LLM. The legacy `persona_prompt` flat blob is what actually drives behavior. See [parse-contract-markdown.ts:22-46](apps/api/src/markets/utils/parse-contract-markdown.ts#L22) and [prediction-runner.service.ts:237-256](apps/api/src/markets/services/prediction-runner.service.ts#L237).

This means the contracts the user sees in [/analysts/:id/contract](apps/web/src/views/ContractEditorView.vue) are not the contracts that shape predictions. Editing the Role section has no behavioral effect today. That's a credibility gap for the explainability thesis.

## Intention

Restructure analyst contracts to be **stage-keyed** — General + per-stage sections (one per workflow stage) + Adaptations — and wire the runtime so that every analyst invocation injects `(General + that-stage's-section + Adaptations)` into the prompt. Retire `persona_prompt` as the behavior driver; the stage sections become the source of truth.

## Scope

### New Contract Shape

```markdown
## General
(universal worldview, tone, legal disclaimers, cross-stage failure modes — sent on every invocation)

## Stage: Predictor Generation
(decision criteria for extracting predictors from articles)

## Stage: Risk Assessment — Reflection (3a)
(first-person decision criteria: how this analyst integrates new predictors into its holistic risk view on an instrument)

## Stage: Risk Assessment — Debate (3b)
(decision criteria for this analyst's role in the Red/Blue/Arbiter multi-agent debate — what stance to take, how to argue, how to respond to the adversary; note that the Arbitrator analyst has different clauses here than the personality analysts that play Blue/Red)

## Stage: Prediction Generation
(decision criteria for issuing predictions from predictors + risk)

## Stage: Learning
(decision criteria for adapting based on outcomes)

## Adaptations
(recent learning-loop appendments — sent on every invocation)
```

Note: analyst contracts do **not** have an "Article Processing" stage section — that stage is instrument-keyed, not analyst-keyed (see `instrument-contracts` effort).

### Runtime Wiring

- Every analyst call site declares its stage (relies on `workflow-stages-article-pipeline` having defined the stage taxonomy)
- The contract loader pulls `General + stage-section + Adaptations` and injects into the prompt
- `persona_prompt` retired or migrated into the General/stage sections during seed regeneration

### Migration of Existing Contracts

- 7 base analysts have v2 contracts today with single Role sections
- Need v3 generation: split Role section into stage-specific sections via LLM scaffolding pass (similar pattern to original [analyst-contracts/](docs/efforts/analyst-contracts/) effort)
- Version history preserved; v3 becomes the active version

### Contract Editor UI Updates

- [ContractEditorView.vue](apps/web/src/views/ContractEditorView.vue) needs to surface stage sections as navigable units (collapsible per stage, not one giant markdown blob)
- Diff viewer continues to work but should highlight which stage's section changed
- Validation: enforce that all required stage sections are present on save

### Audit System Updates

- Audit findings should reference the specific stage section the violation occurred in ("Predictor Generation clause violated" not "contract violated")

## Open Questions for PRD Phase

- For analysts that genuinely have no special instructions for a given stage, do we leave that stage section empty or default it to "follow General rules"?
- Existing `tier-1-structured-writes` queued effort writes to `## Adaptations` — does it stay separate or fold into this effort?
- ~~Should there be a "## Stage: Risk Debate" section in addition to "## Stage: Risk Assessment" if the Blue/Red/Arbiter flow remains?~~ **Resolved** — yes. Master-intention §3.5 confirmed the debate stays in the cycle, and the contract shape above splits Risk Assessment into 3a (Reflection) and 3b (Debate) sub-stage sections.

## Success Criteria

- All 7 base analysts have stage-keyed v3 contracts
- Every analyst invocation injects the correct stage section into its prompt
- Editing a stage section in the editor measurably changes behavior at that stage on the next prediction cycle
- The contracts users see in the editor *are* the contracts shaping predictions — no documentation/runtime gap

## Out of Scope

- Instrument contracts (separate effort: `instrument-contracts`)
- Stage taxonomy itself (defined in `workflow-stages-article-pipeline`)
- Custom contract authorship by users (separate effort: `user-authored-custom-content`)

## Dependencies

- `workflow-stages-article-pipeline` must land first — defines the stage taxonomy this effort references

---

*Stub — second effort in the architecture restructure sequence. Closes the documented-vs-runtime gap in contracts.*
