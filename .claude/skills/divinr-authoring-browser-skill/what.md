# What — Authoring facet

## User flow

1. User clicks "Your Content" in the side nav (`/settings/authored-content`).
2. `AuthoredContentView.vue` renders `<h1>Your Content</h1>` and a five-button `IonSegment` (default `analysts`).
3. The active tab component fetches via `useAuthoredContentApi()` (analysts / instruments / wiring) or `useBillingApi()` (billing) and renders either an empty-state `<div>` or one `IonCard` per row.
4. From a row, the user can click **Edit Contract** (-> `/analysts/:id/contract` or `/instruments/:id/contract`) or **Delete** (`window.confirm` -> API delete).
5. **Create Analyst** / **Create Instrument** buttons open a modal wizard (`CreateAnalystWizard.vue` / `CreateInstrumentWizard.vue`); on submit they emit `created`, the modal closes, and the list re-fetches.
6. The **Wiring** tab renders an analyst-x-instrument matrix that is read/write toggleable per cell (covered separately).
7. The **API Keys** tab manages BYO LLM credentials.
8. The **Billing** tab shows a monthly cost preview computed from authored items + base subscription + BYO platform fee.
9. Curriculum authoring lives under `/clubs/:clubId/curricula/...` and is reached from the club detail's Curriculum tab.

## Surface shape (list)

```
Your Content
[Analysts] [Instruments] [Wiring] [API Keys] [Billing]
+----------------------------------------------+
| Your Analysts                  [Create Analyst]
| +----- analyst-card -----------------------+ |
| | <display_name> [slug-chip]    <created>  | |
| | [Edit Contract]   [Delete]               | |
| +------------------------------------------+ |
| (or) "No authored analysts yet — create your first one."
+----------------------------------------------+
[FirstTouchPanel surface-key="authored.overview"]
```

## Data invariants

- The page heading is literally `Your Content` (h1).
- The five segment buttons are always present, regardless of tier or empty data.
- Each tab independently fetches; one tab's failure does not blank the heading or the segment bar.
- Empty-state copy is rendered only when `loading=false` AND list is empty AND no error.
- Error-state shows an `IonNote color="danger"` with the message.
- Disclaimer copy is NOT rendered inline on this view; do not assert `<LegalDisclaimer>`.

## Tier gating

Authoring surfaces are gated on the user's paid-tier flag. The testing-team user runs with the mock-paid flag enabled, so the `/settings/authored-content` route should normally render the Your Content hub. If a future change moves the gate client-side and redirects unauthorized users to an upgrade CTA, the smoke spec accepts either heading (Your Content **or** the upgrade-CTA heading) — see `expectations.md`.
