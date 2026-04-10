# Effort: Multi-Analyst Coordination

## Problem

Divinr runs 7+ base analysts plus day-trader analysts, each making independent predictions. There's no system-level awareness of how analysts relate to each other. Two analysts might consistently agree (redundant), consistently cancel each other out (destructive interference), or have blind spots that no analyst covers. The arbitrator synthesizes predictions but doesn't evaluate the analyst panel's composition over time.

This means the admin has no visibility into whether the analyst panel is well-constructed or whether adding/removing an analyst would improve overall system performance.

## Intention

Build a coordination layer that analyzes cross-analyst behavior patterns and surfaces actionable insights about the panel's composition. This is a read-only analysis system — it recommends, it doesn't auto-modify.

## Scope

- **Correlation analysis**: For each pair of analysts, compute prediction agreement rate over time. Flag pairs that agree >90% (redundant) or disagree >80% (adversarial).
- **Coverage analysis**: Identify instruments or market conditions where no analyst performs well. Surface gaps in the panel.
- **Contribution scoring**: For each analyst, measure how much their predictions improve the arbitrator's composite vs. what the composite would be without them. An analyst that never changes the outcome is dead weight.
- **Admin UI**: A coordination dashboard (new page or section of the existing analysts page) showing the correlation matrix, coverage gaps, and contribution scores.
- **Periodic computation**: Run coordination analysis on a schedule (weekly, like Tier 3) using existing evaluation data — not real-time.

## Success Criteria

- Admin can see which analyst pairs are redundant or adversarial.
- Admin can see which instruments/conditions lack strong analyst coverage.
- Admin can see each analyst's marginal contribution to the composite.
- Insights are computed from existing data (prediction_outcomes, evaluations) — no new LLM calls needed for the analysis itself.

## Out of Scope

- Auto-removing or auto-adding analysts based on coordination insights.
- Modifying analyst contracts based on coordination data (that's Tier 3's job).
- Real-time coordination during prediction runs.
