# Completeness — Authoring facet

## What the smoke covers

- `/settings/authored-content` route loads without redirect to `/login`.
- Heading disjunction: "Your Content" h1 OR upgrade-CTA heading (tier-gate branch).
- On the primary path: authored-content card OR empty-state copy is visible.
- Vocabulary check outside `<LegalDisclaimer>` and first-touch `[surface-key]` nodes.
- No 5xx from `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101`.
- `dismissWelcomeModal(page)` is invoked to clear the first-touch overlay.

## Known gaps (not yet automated)

1. **Tab switching** — clicking through Analysts / Instruments / Wiring / API Keys / Billing and asserting each tab's content. Skipped in smoke to keep the spec single-test.
2. **Create Analyst / Create Instrument wizards** — modal walk-through. Needs deterministic form values and a teardown path so we don't pollute prod authored content.
3. **Edit Contract sub-routes** — `/analysts/:id/contract` and `/instruments/:id/contract` are not exercised. Needs an existing authored analyst/instrument fixture.
4. **Wiring matrix toggling** — read/write per-cell. Needs both an analyst and an instrument authored, plus a teardown path.
5. **API Keys tab** — submitting a credential. Out of scope for read-only smoke; would need a sandbox provider key.
6. **Billing preview** — values depend on production billing config; assert structure only, not numbers.
7. **Curriculum authoring** — `/clubs/:clubId/curricula/...` flow. Needs a seeded club where the testing-team user can author a curriculum.
8. **Delete confirmation** — `window.confirm` dialog handling. Not exercised; would need a fixture-only authored item to delete.

## Human demo script (manual)

1. Log in as testing-team; click **Your Content** in the side nav.
2. Verify URL is `/settings/authored-content` and the page heading reads "Your Content".
3. Verify the segment bar shows: Analysts, Instruments, Wiring, API Keys, Billing — with **Analysts** selected by default.
4. Confirm either an analyst card list or the empty-state copy ("No authored analysts yet — create your first one.") is visible.
5. Click **Create Analyst**; the wizard modal opens. Cancel out.
6. Switch to **Instruments**; same shape — list or empty-state.
7. Switch to **Wiring**; verify the matrix renders (may be empty if no authored items).
8. Switch to **API Keys**; verify the credentials form renders.
9. Switch to **Billing**; verify the monthly estimate card renders with the base subscription line.
10. From an analyst row (if any), click **Edit Contract** and confirm navigation to `/analysts/<uuid>/contract`.

## Promotion criteria

To promote a gap into the smoke spec, the fixture needs to be either:

- (a) idempotent against prod data (read-only, no side effects), or
- (b) backed by a dedicated seed fixture in the `testing-team` scope that no human user touches, with deterministic teardown.

Authoring is especially sensitive because mutations create paid-tier billable resources.
