# Expectations — Predictions facet

Pass/fail invariants the smoke spec must encode. Each expectation maps to an explicit `expect()` in the spec.

## Happy path

1. **Route resolves**: `GET /predictions` returns HTTP 200 and the page stays off `/login`.
2. **Heading renders vocab-compliant copy**: `page.getByRole('heading', { name: /analyses/i })` is visible. MUST NOT match `/prediction/i` in user-visible heading copy (vocabulary rule from `CLAUDE.md`).
3. **Data arrives or explicit empty state**: either at least one `ion-list > ion-item` is visible within 10 s, OR a first-touch / empty-state surface is shown. A totally blank list without either is a finding.
4. **Role filter is interactive**: `ion-select` with `Role` label exists and is enabled. Attempting to open it does not throw (clicking returns).
5. **Filter changes row count deterministically**: switching the role from `all` → `analyst` must produce a row count ≤ the `all` count (monotonic).
6. **No unhandled console errors**: no `console.error` events from application code during the smoke walk. Use the filter list in `divinr-workflow-browser-skill/patterns/console-network-capture.md`.
7. **No 5xx on the happy path**: every response from `divinr.ai` / `api.divinr.ai` / local `:7100` / `:7101` with status ≥ 500 fails the spec.

## Vocabulary invariant

Scan the rendered DOM (`document.body.innerText`) on the predictions page; assert it does NOT contain the forbidden words `predict`, `prediction`, `predicted`, `recommendation`, `advice` (case-insensitive) *as standalone words in user-visible copy*. (Chip text is user-visible and matters; hidden ARIA labels count.) Note: the API payload and identifiers such as `prediction_id` are exempt per `CLAUDE.md`.

## Trade-CTA invariant (when applicable)

If a trade-CTA is rendered for any row:
- It must have a `name` / `aria-label` conveying the action (e.g., "Trade this", "Enter game").
- Clicking it must navigate to a `/tournaments/...` URL that resolves (non-404) within 3 s. Actual tournament-flow assertions belong in `divinr-tournaments-browser-skill/` — verify only the hand-off here.

## Legal disclaimer

The `<LegalDisclaimer>` lives on the parent route (dashboard). The predictions view itself does not render it; do NOT fail the spec on absence here. If a future effort adds a disclaimer inline on `/predictions`, update this file and the spec to assert its presence.
