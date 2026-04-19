# Completeness — Analysts facet

## Smoke coverage today

The `apps/e2e/tests/analysts/smoke.spec.ts` spec is intentionally
narrow: read-only `/analysts` grid load, vocabulary scan, 5xx watch.
That's the Phase 5.3 deliverable; broader assertions belong to deep
specs added in later coverage-growth efforts.

## Documented gap — read-permission on `/markets/analysts` for testing-team

Empirical finding while authoring the smoke (Phase 5.3, 2026-04-19):
`GET http://127.0.0.1:7100/markets/analysts` returns
`403 {"message":"Read permission denied","error":"Forbidden"}`
when called with the testing-team user's bearer token. Result: the
`AnalystsView` grid loads but renders zero `ion-card` rows because the
store's fetch fails. The `FirstTouchPanel` is also hidden because it
needs first-touch profile content (which itself depends on auth).

**Spec relaxation per task brief**: the smoke's (b) assertion was
narrowed from "card OR first-touch panel visible" to "the `<ion-grid>`
container itself is visible". The grid container always renders, so
this assertion verifies the view mounted without crashing — which is
the genuine smoke signal — without coupling to a permission gate that
belongs to a separate triage.

Filed-finding follow-ups:

1. Decide whether `testing-team@divinr.ai` should be granted read on
   the analyst registry (most likely yes — they need to see the grid
   to QA it).
2. Once read is granted, restore the (b) assertion to
   `cards.first().or(firstTouch)` so the smoke catches an empty grid
   as a real failure mode.

## Known coverage gaps

- **Performance view** is documented in `where.md` / `expectations.md`
  but not asserted by the smoke. A future deep spec should cover the
  four aggregate tiles, the per-instrument table when `perInstrument`
  is non-empty, and the LLM-reasoning expansion (asserting the
  `GET /predictions/:id/llm-calls` round-trip).
- **Contract editor** is documented but not asserted by the smoke.
  Future spec should cover viewer / preview / edit / diff / rollback
  modes, plus the structured 400 validation surface (missing /
  forbidden / extra sections).
- **No empty-state component** on `/analysts` — when the store returns
  zero analysts, the grid simply has no children. The smoke treats
  "zero cards AND no first-touch panel" as a finding so the silent
  failure mode is caught, but a real empty-state UI would let us
  drop the OR-clause and assert positively.
- **No write-action coverage**: Create Analyst modal, enable toggle,
  contract edit, contract rollback — all reserved for future specs
  with a transactional fixture (so the smoke remains read-only and safe
  to run on any environment, including prod).
- **Vocabulary check exclusion list** today strips `.legal-disclaimer`,
  `[data-testid="legal-disclaimer"]`, `[surface-key]`,
  `[data-surface-key]`. If a future surface introduces an inline
  legitimate use of "prediction" outside those wrappers (e.g., admin /
  debug-only copy), document the leak here and either tighten the
  selector or whitelist the specific node.

## Demo script (human walk, ~90 seconds)

1. Log in as `testing-team@divinr.ai`.
2. Navigate to `/analysts`.
3. Confirm the heading reads "Analysts" and at least one card renders
   with display name, type/weight/scope subtitle, and Contract +
   Performance buttons.
4. Click `Performance` on the first card. Verify the heading is
   `{name} -- Performance` and four aggregate tiles render.
5. Expand the first resolved-analysis row (if any). Verify the
   reasoning panel shows either captured reasoning content or the
   "No captured reasoning" note.
6. Use the back button, click `Contract` on the same card. Verify the
   em-dash heading, the markdown viewer, and the Version History list.
   If `canWrite`, confirm `Edit`, `Diff`, `Rollback` buttons are
   present.
7. Open DevTools → Network. Confirm `GET /api/analysts`,
   `GET /api/analysts/<id>/calibration`, `GET /api/analysts/<id>/contract`
   each returned 200.
8. Open DevTools → Console. Confirm no red errors.

Any deviation → file a finding under `docs/testing/findings/open/`
using the template + dedup hash from
`apps/e2e/src/finding-hash.ts`.

## Follow-ups that should flow into a later effort

- Deep `analysts/performance.spec.ts` and `analysts/contract.spec.ts`
  covering the gaps above.
- Empty-state component on `/analysts` (and matching positive smoke
  assertion).
- Authoring-flow spec under the existing `authoring` Playwright project
  for the `Create Analyst` modal once a transactional fixture is in
  place.
