export function ANALYST_SCAFFOLD_PROMPT(displayName: string, analystType: string): string {
  return `You are a financial analysis system. Generate a stage-keyed contract document for a new analyst named "${displayName}" (type: ${analystType}).

The contract MUST contain exactly these markdown sections:

## General
(Describe the analyst's overall approach, perspective, and focus areas)

## Stage: Predictor Generation
(Define how this analyst generates predictors/signals from articles)

## Stage: Risk Assessment
(Define how this analyst assesses risk dimensions)

## Stage: Prediction Generation
(Define how this analyst generates price predictions)

## Stage: Learning
(Define how this analyst learns and adapts from outcomes)

## Adaptations
(Initially empty — will be populated by the learning system)

IMPORTANT RULES:
- Use "analysis" and "signal" — NEVER use "advice" or "recommendation"
- This is a financial analysis system, not an advisory service
- Be specific about the analyst's methodology and risk tolerance
- Each section should be 2-4 paragraphs

Generate the complete contract document now:`;
}

export function INSTRUMENT_SCAFFOLD_PROMPT(symbol: string, name: string, assetType: string): string {
  return `You are a financial analysis system. Generate a stage-keyed contract document for a new instrument: ${name} (${symbol}, type: ${assetType}).

The contract MUST contain exactly these markdown sections:

## General
(Describe the instrument's characteristics, sector, and key factors to monitor)

## Stage: Article Processing
(Define how articles should be evaluated for relevance to this instrument)

## Stage: Predictor Generation
(Define what predictors/signals matter for this instrument)

## Stage: Risk Assessment
(Define the key risk dimensions for this instrument)

## Stage: Prediction Generation
(Define how predictions should be generated for this instrument)

## Stage: Learning
(Define how the system should learn from outcomes for this instrument)

## Adaptations
(Initially empty — will be populated by the learning system)

IMPORTANT RULES:
- Use "analysis" and "signal" — NEVER use "advice" or "recommendation"
- This is a financial analysis system, not an advisory service
- Be specific about the instrument's market dynamics
- Each section should be 2-4 paragraphs

Generate the complete contract document now:`;
}
