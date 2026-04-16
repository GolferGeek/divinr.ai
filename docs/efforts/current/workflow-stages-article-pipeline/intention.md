# Effort: Workflow Stages & Two-Step Article Pipeline

## Problem

The current prediction cycle treats analyst invocations as a single undifferentiated "generate a prediction" step. Risk is layered on top as a critique of an already-generated prediction. Article processing is bundled into the same call. There's no explicit stage taxonomy in code, which means:

1. Contracts can't meaningfully be portioned by stage (no stages exist as first-class concepts)
2. Article relevance is computed alongside prediction work, wasting LLM cycles on irrelevant articles
3. Risk is downstream of predictions instead of informing them — predictions don't get to draw on a holistic risk view of the instrument

## Intention

Restructure the prediction cycle into named, first-class **workflow stages** with a deliberate ordering, and split article processing into a **two-step pipeline** so that the expensive analyst work only fires on already-relevant material.

## Scope

### Stage Taxonomy (named, code-level concepts)

1. **Article Processing** — instrument-keyed relevance evaluation; no analysts involved
2. **Predictor Generation** — per (instrument, analyst), only for relevant articles
3. **Risk Assessment** — per (instrument, analyst), integrates new predictors with existing risk view; produces "the analyst's full story on this instrument"
4. **Prediction Generation** — per (instrument, analyst), informed by predictors + just-updated risk
5. **Learning** — post-outcome adaptation, per analyst

### Two-Step Article Pipeline

- **Step 1 — Relevance:** every article evaluated against every instrument variant (using each variant's article-processing contract section, see `instrument-contracts` effort). Outputs the list of instruments the article touches.
- **Step 2 — Analyst Fanout:** only fires for (instrument, analyst) pairs where the article is relevant. Generates predictors.

### Workflow Reorder: Risk Before Predictions

- Risk currently runs as a critique *after* predictions
- New flow: risk runs *before* predictions, integrating new predictors into the analyst's holistic risk view
- Predictions then derive from predictors + the just-updated risk view
- Conceptual shift: risk is the analyst's holistic understanding of the instrument; predictions are derived from that understanding

### Code Touchpoints

- `apps/api/src/markets/services/prediction-runner.service.ts`
- Cycle orchestration code
- Whatever currently lives behind the existing risk-debate flow (Blue/Red/Arbiter)

## Open Questions for PRD Phase

- Does the existing Blue/Red/Arbiter risk debate remain inside the Risk Assessment stage, or is it transformed into a different shape (one analyst's internal risk reflection rather than a multi-agent debate)?
- How is "relevance" decided in Step 1 — single LLM classification call per article? Per article × instrument? Cheaper mechanism (embeddings/keywords) as a pre-filter?
- Backwards compatibility — do existing prediction records need migration into the new stage taxonomy?

## Success Criteria

- Stages exist as named concepts in code; every analyst invocation declares its stage
- Article processing is genuinely two-step; Stage 2 only fires for relevant articles
- Risk Assessment runs before Prediction Generation in the cycle; predictions reference the post-update risk view

## Out of Scope

- Stage-keyed contracts (separate effort: `stage-keyed-analyst-contracts` — depends on this one)
- Instrument contracts (separate effort: `instrument-contracts`)
- Custom content authorship (separate effort: `user-authored-custom-content`)

## Dependencies

- None — this is the foundation that the other architecture efforts build on

---

*Stub — first effort in the architecture restructure sequence. Defines the stages everything else references.*
