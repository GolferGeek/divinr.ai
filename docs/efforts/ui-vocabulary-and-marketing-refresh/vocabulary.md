# UI Vocabulary Dictionary

Authoritative translation table for the vocabulary sweep. Every Phase 2 string
substitution decision refers back to this table.

## Core translations

| Old term | New term | Notes |
|---|---|---|
| prediction (noun) | analysis | "Today's analyses", "View all analyses", "No analyses yet" |
| prediction (single card unit) | analysis or signal | Context-dependent: "this signal" for conviction-laden language, "this analysis" for descriptive/neutral |
| predictions (plural) | analyses | Table headers, counts: "5 analyses today" |
| predicted (adjective) | analyzed or projected | "Projected return" not "predicted return"; "analyzed X days ago" |
| predictor (scoring agent) | analyst or signal scorer | "AI Analyst Scoring" replaces "AI Predictor Scoring"; "Active Analysts" |
| prediction model | analysis engine | Exception: in disclaimers, the literal phrase "not a prediction model" stays — that is the disclaimer language |
| prediction history | analysis history | |
| Trade this prediction | Trade this signal | Trade-CTA copy |
| prediction-card (CSS class) | unchanged | CSS class names are code identifiers |
| prediction vs realized (chart legend) | projected vs realized | |

## Context-specific guidance

- **"Prediction" as a count**: "8 predictions today" → "8 analyses today"
- **"Latest Prediction"**: → "Latest Analysis"
- **"Loading predictions..."**: → "Loading analyses..."
- **Empty states**: "No predictions yet" → "No analyses yet"
- **Filter/segment labels**: "Predictions" → "Analyses"
- **Section headings in authoring**: "Predictor generation" → "Signal generation"; "Prediction generation" → "Analysis generation"

## Explicitly NOT translated (see PRD §6)

- Component filenames (`AnalystPredictionModal.vue`, `PredictorScoringPanel.vue`)
- Store / composable / type / function / variable names
- API request/response keys (e.g., `prediction_id`, `predictions[]`)
- Route paths (`/predictions` stays; nav label changes)
- DB schema / table / column names
- Telemetry / observability event names (e.g., `prediction-to-trade-intent cta_navigated`)
- Code comments
- Test fixture data
- Admin / debug surfaces — keep domain terminology

## When in doubt

- If the string is rendered into the DOM (template text, attribute that a screen reader speaks, label a user sees) → translate per this dictionary
- If the string is an internal identifier, key, or telemetry event → leave as-is
- For chart legends, segment labels, chip labels, tooltip content → translate
