# Effort: Test — Analyst Contracts & Editor

## Covers
- `analyst-contracts` — Structured markdown contracts for 7 base analysts, config versioning
- `day-trader-contracts` — Extended contracts to day-trader analysts (gap-and-go, mean-reversion, momentum-breakout)
- `contract-editor-ui` — Admin contract editor with version history, side-by-side diff, inline edit, rollback

## Testing Scope
- Verify all analyst contracts are present and well-structured
- Navigate to /analysts — see all analysts with their roles/types
- Navigate to /analysts/:id/contract — contract editor loads
- View version history — previous versions listed
- Side-by-side diff — changes between versions visible
- Edit contract inline — save creates new version
- Rollback to previous version — one-click restore
- Day trader analysts appear alongside base analysts

## Marketing Angle
Every analyst has a written contract defining what it should do — and an audit trail of changes. You can see exactly why an analyst thinks the way it does.

## Chrome Testing
- Open AnalystsView, verify all analysts appear
- Click into a contract, verify editor loads with current version
- Check version history dropdown
- Verify diff view between versions
- Test edit + save cycle

## Out of Scope
- Creating new analysts from scratch (admin feature)
