# Effort: Test — User Analyst Affinity

## Covers
- `user-analyst-affinity` — Affinity Agent learns from trade decisions, challenges, and browsing. Exponential decay scoring, contrarian alerts, dashboard personalization.

## Testing Scope
- AffinityView (/affinity): affinity profile displays per-analyst scores
- Contrarian alerts: appear on dashboard when user disagrees with high-affinity analyst
- Dashboard personalization: analysts sorted by affinity in prediction cards
- Affinity scoring: verify scores reflect trade decision history
- Affinity badges: small score badges appear on analyst names in dashboard

## Marketing Angle
The platform learns which analysts align with your thinking. Get alerted when an analyst you trust goes against your recent decisions.

## Chrome Testing
- Navigate to /affinity — verify affinity profile renders
- Check dashboard — verify analysts sorted by affinity score
- Verify contrarian alerts appear when applicable
- Check affinity badges on analyst names in prediction cards

## Out of Scope
- The quality of affinity calculations (algorithm-level)
