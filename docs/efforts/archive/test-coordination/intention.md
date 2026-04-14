# Effort: Test — Multi-Analyst Coordination

## Covers
- `multi-analyst-coordination` — Cross-analyst correlation analysis, coverage gap detection, leave-one-out contribution scoring. Admin dashboard with heatmap matrix, coverage table, contribution scores.

## Testing Scope
- CoordinationView (/coordination): correlation matrix, coverage table, contribution scores
- Heatmap matrix: analyst-vs-analyst correlation visualization
- Coverage gaps: instruments with insufficient analyst coverage
- Contribution scores: leave-one-out analysis showing each analyst's marginal value
- Compute trigger: on-demand re-computation of coordination metrics
- Weekly cron: verify scheduled computation runs

## Marketing Angle
See how your analysts work together. Identify correlation (are two analysts just saying the same thing?) and coverage gaps (which instruments lack analysis?).

## Chrome Testing
- Navigate to /coordination — verify matrix, coverage, contributions load
- Toggle between matrix and table views
- Verify analyst correlations make directional sense
- Check coverage gaps section
- Trigger re-computation

## Out of Scope
- Automatic analyst team optimization (not implemented)
