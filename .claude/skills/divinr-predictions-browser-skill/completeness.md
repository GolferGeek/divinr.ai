# Completeness — Predictions facet

## Known coverage gaps (today)

- No assertion on the detail drawer — the current `PredictionsView.vue` does not yet open a drawer; rows are `ion-item` only.
- No multi-analyst coordination correlation view is exercised (that lives under `/coordination`; out of scope for this facet).
- No `arbitrator`-specific assertion; we only check that the filter toggle works.
- No test for pagination — the API currently returns an unbounded array; revisit when pagination ships.
- Trade-CTA navigation is not exercised because the current row markup doesn't render one. Will add once the card exposes an action.

## Demo script (human walk)

For a 90-second manual sanity check:

1. Log in as `testing-team@divinr.ai`.
2. Navigate to `/predictions`.
3. Confirm the heading reads "Analyses" (not "Predictions" or "Recommendations").
4. Wait for at least one row to render (or confirm a first-touch panel).
5. Change the role filter to "Analysts Only". Note the row count goes down (or stays equal).
6. Open DevTools console — confirm no red errors.
7. Open DevTools network — confirm `GET /api/predictions?role=analyst` returned 200.

Any deviation from the above → file a finding.

## Follow-ups that should flow into a later effort

- Reasoning panel / detail drawer component (once designed).
- Empty-state component when the role filter returns zero rows — today the list just disappears.
- Trade-CTA integration once prediction cards expose a direct action.
