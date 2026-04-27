# Expectations — Admin facet

Pass/fail invariants the smoke spec must encode. Each maps to an explicit
`expect()` in `apps/e2e/tests/admin/smoke.spec.ts`.

## Happy path (smoke)

1. **Route resolves**: `GET /admin/cost/calibration` returns the SPA shell and the page stays off `/login` and `/welcome`.
2. **Heading visible**: `page.getByRole('heading', { name: /cost calibration/i })` is visible within 10 s.
3. **Content container OR explicit empty state**: either a populated `table` body OR the empty-state `<td>"No calibrated models yet…"</td>` row is visible. A blank shell with neither is a finding.
4. **No 5xx on the happy path**: every response from `divinr.ai` / `api.divinr.ai` / local `:7100` / `:7101` with status ≥ 500 fails the spec.

## Vocabulary rule

**RELAXED.** Per `CLAUDE.md`, admin / debug surfaces may retain domain
terminology. The smoke spec MUST NOT include any `expect(...).not.toMatch(/prediction|advice|recommendation/)` assertion for this facet. Vocabulary
rules continue to apply on consumer-facing facets (predictions, tournaments,
clubs, portfolios, performance, instruments, analysts, authoring).

## Admin-role gate

The router has no admin guard, so a non-admin user can deep-link to
`/admin/cost/calibration`; the view shell will render but its API calls will
4xx. The smoke spec does NOT enforce role-gating, but if API calls under
`/admin/*`, `/usage/*`, `/findings/*`, `/proposals/*`, or `/audits/*` return
401 or 403 during the smoke run that is a separate finding (the testing-team
user is supposed to be seeded with admin role in Phase 1 of the testing-team
effort) — see `completeness.md` for the dedup hash.

## Refresh-button interactivity (deep skill, not in smoke)

The smoke spec is read-only and does NOT click Refresh. Deeper specs may:

- Assert `IonButton` with text `Refresh now` is visible and enabled.
- Click it and assert it transitions to `Refreshing…` and then back.
- Assert the summary line "Refreshed N model(s), raised N alert(s), skipped N." appears within 5 s of the button returning to its idle text.

## Drift-alert card (conditional)

If `store.driftAlerts.length > 0`, the warning card is visible. Its absence
in a healthy env is expected — do NOT assert its presence. Deeper specs may:

- Assert the table inside the card has at least one row.
- Assert each unacknowledged row exposes an "Acknowledge" button.
- POST-acknowledge, the row's button is replaced by `<span>Acked</span>`.

## Console / network discipline

- The smoke spec attaches `page.on('response', …)` and pushes ≥ 500 statuses into an array; assert the array is empty at the end.
- Console-error capture is recommended in deeper specs but not required at the smoke level (admin views often log informational warnings during refresh that are not regressions).
