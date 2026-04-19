# Completeness — Instruments facet

## What the smoke covers

- `/instruments` route loads, heading renders, card-or-add-button floor is met.
- Vocabulary check **scoped to the list surface only** (heading container clone, with disclaimer + first-touch panels removed).
- No 5xx from `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101`.

## Known gaps (not yet automated)

1. **Detail page vocabulary** — `InstrumentDetailView.vue` renders LLM-authored `prediction.rationale` and `risk.rationale` strings inside `[data-tour="analyst-panel"]`. Those rationale strings can legitimately contain `prediction|advice|recommendation` because the upstream prompts haven't been hardened. CLAUDE.md says "Admin/debug surfaces may retain domain terminology where it aids maintenance" — but the instrument detail page is **not** an admin surface. This gap is filed as a separate finding (hash `21be5b26` — see `docs/testing/findings/open/21be5b26-divinr-instruments-vocabulary-leak.md`). The smoke spec deliberately skips this surface so it can stay green while the prompt-hardening work is scheduled.
2. **Detail tabs render** — clicking a card to reach `/instruments/:id` and asserting both segment buttons. Not in smoke because (a) we'd cross into the rationale-vocabulary gap above on the same page load, and (b) it requires at least one seeded instrument.
3. **Arbitrator Synthesis card** — only renders when there's an arbitrator prediction or a composite score. No deterministic fixture yet.
4. **`PredictorScoringPanel`** content (AI Scoring tab) — not asserted.
5. **`TripleVariantSwitcher`** query-param flow — manual only.
6. **Add Instrument modal create** — would write to prod tournament/instrument tables; needs a dedicated fixture scope.
7. **`Edit Contract`** flow — admin-only, separate skill.
8. **Detail "history" toggle** — requires multiple signals/risks per analyst.

## Human demo script (manual)

1. Log in as testing-team; navigate to `/instruments`.
2. Verify the grid renders cards with Symbol / Price / Change / Direction / Confidence rows.
3. Click `Add Instrument`. Confirm the modal opens; type a fake symbol + name; cancel.
4. Click the first instrument card. Confirm URL is `/instruments/<uuid>` and `<h1>` shows the symbol.
5. Confirm the Arbitrator Synthesis card renders if data is present.
6. Walk down the analyst panels; for each, confirm Latest Signal + Latest Risk View + (optional) View history toggle.
7. Switch to the `AI Scoring` segment. Confirm the `PredictorScoringPanel` mounts.
8. Append `?analystId=<uuid>` to the URL. Confirm the analyst set narrows.
9. Visually scan the detail page for forbidden vocabulary (`prediction`, `advice`, `recommendation`) outside `<LegalDisclaimer>`. If found, update `docs/testing/findings/open/21be5b26-divinr-instruments-vocabulary-leak.md` `last-seen` and add notes.

## Promotion criteria

To promote the detail-page vocabulary gap into the smoke spec, the upstream LLM prompts must be hardened to never emit `prediction|advice|recommendation` in user-facing rationale text (or the detail surface must wrap rationale in a marked container the test can exclude — same shape as `<LegalDisclaimer>`). Once that lands, fold the assertion in here and close the finding.
