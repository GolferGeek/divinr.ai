# Effort: Test — Prediction Pipeline

## Covers
- `llm-reasoning-capture` — Reasoning content captured on every LLM call
- `see-your-reasoning` — Reasoning tab in the prediction modal
- Core prediction flow: queue analysis → analysts run → arbitrator synthesizes → prediction stored

## Testing Scope
- Queue a prediction run for an instrument
- Verify each analyst produces a stance with direction, confidence, rationale
- Verify arbitrator synthesizes into a combined signal
- Verify reasoning_content is captured in llm_usage artifacts
- Verify prediction modal shows analysts, rationale, and reasoning tab
- Verify dashboard displays prediction cards with consensus badges
- Verify instrument detail shows latest prediction data

## Marketing Angle
The core product story — multiple AI analysts each make independent calls, then an arbitrator weighs them. Every step is explainable, not a black box.

## Chrome Testing
- Queue an analysis from RunsView
- Watch it complete, navigate to the run detail
- Open prediction modal from dashboard, check all tabs
- Verify reasoning tab shows LLM thought process

## Out of Scope
- Evaluation/outcome pipeline (separate effort)
- Risk analysis pipeline (separate effort)
