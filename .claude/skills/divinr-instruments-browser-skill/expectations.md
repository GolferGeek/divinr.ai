# Expectations — Instruments facet

## Pass conditions

### List page

- Route `/instruments` resolves without redirect to `/login` (storage-state authenticated).
- `<h1>Instruments</h1>` is visible within 10s.
- Either at least one `ion-card` is visible **or** the `Add Instrument` button is visible. (The page does not render an explicit empty-state element today; the `Add Instrument` button is always present, so the floor is "heading + add button rendered.")
- No HTTP 5xx responses from `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101` during the page lifecycle.

### Vocabulary (list page only)

After scoping the text clone to the heading-container (i.e. the `<div>` that wraps the heading + grid in `InstrumentsView.vue`) and removing `.legal-disclaimer`, `[data-testid="legal-disclaimer"]`, `[surface-key]`, and `[data-surface-key]` nodes, the remaining user-visible text must not contain (case-insensitive):

- `\bprediction(s|ed|or)?\b`
- `\brecommendation\b`
- `\badvice\b`

Disclaimers are intentionally exempt — CLAUDE.md requires every variant to state "not a prediction model" and "not investment advice."

### Detail page

The detail page is **not** part of automated smoke today (LLM-authored rationale leaks the forbidden vocabulary in places we can't deterministically scope). When exercised manually:

- Clicking an instrument card navigates to `/instruments/<uuid>`.
- `<h1>` shows the instrument symbol (not "Loading...") within 10s.
- Both segment buttons (`analysts`, `predictors`) are visible.
- The Arbitrator Synthesis card renders if any arbitrator prediction or composite score is available.
- At least one `[data-tour="analyst-panel"] ion-card` is visible if the instrument has analysts.

## Fail conditions

- List page redirects to `/login` → auth state stale; re-run `pnpm --filter @divinr/e2e exec tsx scripts/prepare-auth-state.ts`.
- `<h1>Instruments</h1>` not visible within 10s → API outage or router change.
- `Add Instrument` button missing → template regression (the button is unconditional).
- Forbidden vocabulary found in the scoped list-page clone (excluding disclaimer + onboarding panel).
- Any 5xx on `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101`.

## Known non-issues

- `store.items` may be empty for a freshly seeded testing-team scope — assert the heading + Add button, not card count.
- `Edit Contract` button is conditional on `canWrite` — do not assert presence in generic smoke.
- LLM-authored rationale on the detail page may legitimately use forbidden vocabulary; this is a separate bug tracked in the findings queue, not a smoke regression.
