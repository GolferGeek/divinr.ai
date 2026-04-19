---
product: divinr
severity: major
capability: instruments
surface-key: instrument.detail
spec: apps/e2e/tests/instruments/smoke.spec.ts
verify-command: pnpm --filter @divinr/e2e exec playwright test --project=instruments
first-seen: 2026-04-19T00:00:00Z
last-seen: 2026-04-19T00:00:00Z
regression-count: 0
trace-artifact: null
---

## What failed

The instrument detail page (`/instruments/:id`, `apps/web/src/views/InstrumentDetailView.vue` →
`InstrumentAnalystPanel.vue`) renders LLM-authored `prediction.rationale` and
`risk.rationale` strings directly into the user-facing analyst debate cards.
CLAUDE.md forbids the words `prediction`, `predicted`, `predictor`,
`recommendation`, and `advice` in user-visible copy outside `<LegalDisclaimer>`.
Because the rationale strings come from upstream LLM prompts that were not
constrained against this vocabulary, they may legitimately leak forbidden
words into a non-admin user-visible surface.

The smoke spec for this facet (`apps/e2e/tests/instruments/smoke.spec.ts`)
therefore scopes its vocabulary check to the **list** surface only and
deliberately skips the detail surface. This finding documents the gap so the
detail-surface vocabulary check can be folded back in once the upstream prompts
are hardened (or the rationale strings are wrapped in a marked container the
test can exclude, the same way `<LegalDisclaimer>` is excluded today).

## Repro steps

1. Log in as testing-team and visit `/instruments/<any-uuid>`.
2. Stay on the default `Analysts` tab.
3. Inspect the rendered text inside `[data-tour="analyst-panel"]` — specifically
   the `Latest Signal` and `Latest Risk View` rationale paragraphs.
4. Expected: no occurrence of `prediction(s|ed|or)?`, `recommendation`, or
   `advice` outside `<LegalDisclaimer>` per CLAUDE.md.
5. Observed: rationale text is LLM-generated and may contain those words.

## Notes

- Hash derivation: `sha1("divinr:apps/e2e/tests/instruments/smoke.spec.ts:vocabulary-leak") | head -c 8` → `21be5b26`.
- Surface vs admin: CLAUDE.md exempts admin/debug surfaces from the vocabulary
  rule. `/instruments/:id` is **not** admin/debug — it's the primary
  user-facing instrument detail page. So the leak is a real product bug, not a
  test bug.
- Likely fix paths:
  1. Harden the upstream rationale-generation prompts (predictions / risk
     assessments) to forbid the listed vocabulary.
  2. Wrap rationale rendering in a marked container (e.g. `class="llm-rationale"`)
     and exclude it from the vocabulary clone the same way `<LegalDisclaimer>`
     is excluded.
- The instruments deep skill (`.claude/skills/divinr-instruments-browser-skill/completeness.md`)
  references this finding hash and lays out the promotion criteria.
