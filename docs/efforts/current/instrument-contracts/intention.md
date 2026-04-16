# Effort: Instrument Contracts

## Problem

Instruments today are bare data records (ticker, name, sector). They have no first-class concept of "what does this instrument care about?" The article relevance check has nowhere to look up an instrument's specific concerns — it relies on whatever the analyst contract or generic system prompt says. This means:

1. Custom instrument variants can't differentiate themselves (no contract to differ by)
2. The article-processing stage has no instrument-specific guidance — Club X's China-aware AAPL has no surface to express that bias
3. Risk and prediction stages can't draw on instrument-specific framing (sector dynamics, peer relationships, regulatory sensitivities, etc.)

## Intention

Add a first-class **instrument contract** entity, parallel in shape to analyst contracts: General + per-stage sections + Adaptations. Plus one section analysts don't have: `## Stage: Article Processing`. Wire the runtime so that every stage invocation pulls **(instrument-contract section + analyst-contract section + both Generals + both Adaptations)** for that stage.

## Scope

### Contract Shape (parallel to analysts, plus article processing)

```markdown
## General
(universal worldview for this instrument — sector context, what makes it tick, base disclaimers)

## Stage: Article Processing
(THIS IS NEW — analysts don't have this. Decision criteria for "is this article relevant to me?")

## Stage: Predictor Generation
(instrument-specific framing for predictor extraction)

## Stage: Risk Assessment
(instrument-specific risk dimensions to track)

## Stage: Prediction Generation
(instrument-specific framing for prediction issuance)

## Stage: Learning
(instrument-specific lessons to internalize)

## Adaptations
(recent learning-loop appendments)
```

### Schema

- New table: `prediction.instrument_config_versions` (parallels `analyst_config_versions`)
- New column on `instruments` table: `current_config_version_id`
- Versioning, `source` enum, `change_reason`, etc. — same pattern

### Runtime Wiring

- Stage 1 article relevance: pulls instrument's `## General + ## Stage: Article Processing + ## Adaptations`
- Stages 2+ (per analyst invocation): merges instrument contract section + analyst contract section, both Generals, both Adaptations

### Seed Contracts for Base Instruments

- LLM scaffolding pass (similar pattern to [analyst-contracts/](docs/efforts/analyst-contracts/) effort) to generate v1 instrument contracts for the existing base instrument set
- Each base instrument gets a real, hand-reviewable contract — not a stub

### Editor UI

- New route: `/instruments/:id/contract` → `InstrumentContractEditorView.vue` (mirror of analyst contract editor)
- Stage sections collapsible/navigable
- Version history, diff, rollback — same pattern

## Open Questions for PRD Phase

- Do all base instruments need bespoke contracts at launch, or can they share a template by instrument type (stock template, crypto template, ETF template) with per-instrument overrides?
- The "Article Processing" stage section is the most novel — does the LLM scaffolding pass produce useful content here, or does it need human authoring per instrument?
- Is there a permission model — who can edit base instrument contracts? (Probably admins only, paralleling analyst contract edit gating)

## Success Criteria

- Every base instrument has a real, stage-keyed v1 contract
- Stage 1 article relevance uses the instrument's article-processing section per evaluation
- Editing an instrument's contract measurably changes how it interprets articles and produces analysis
- Editor UI feels like a peer of the analyst contract editor — same affordances, same polish

## Out of Scope

- Custom instrument contracts authored by users (separate effort: `user-authored-custom-content`)
- The triple-model storage of analysis (separate effort: `triple-model-reasoning-continuity`)

## Dependencies

- `stage-keyed-analyst-contracts` must land first — instrument contracts mirror that shape and use the same stage taxonomy

---

*Stub — third effort in the architecture restructure sequence. Adds the second half of the contract system.*
