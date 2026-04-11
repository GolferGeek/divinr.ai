# Effort: Test — Risk Analysis & Debate

## Covers
- Risk pipeline: dimension scoring, bull/bear debate, composite risk score
- `risk-debate-drilldown` — Expandable LLM reasoning panels on Blue/Red/Arbiter debate columns

## Testing Scope
- RiskDashboardView: risk dimensions overview with weights
- Instrument risk cards: score, confidence, verdict (low/medium/high)
- Click into instrument detail: composite gauge, score trend bars
- Dimension analysis: per-dimension scores with progress bars
- Bull vs. Bear debate: DebateSummary component renders arguments
- Expandable reasoning panels for each debate participant
- Re-run debate button: triggers new debate, refreshes data
- Re-run full risk button: triggers complete re-analysis

## Marketing Angle
Before you trade, understand the risk. AI analysts argue both sides — bull and bear — and an arbiter decides. Every argument is visible.

## Chrome Testing
- Navigate to /risk — verify dimensions and instrument cards
- Click instrument → verify gauge, trend, dimension breakdown
- Expand debate section — verify Blue/Red/Arbiter reasoning
- Test re-run debate and re-run risk buttons
- Verify risk scores update after re-run

## Out of Scope
- Risk thresholds affecting trade recommendations (integrated feature)
