---
name: divinr-admin-browser-skill
description: Playwright + Chrome-MCP patterns for the Divinr admin facet. Covers the /admin/* operator surfaces (cost calibration, defensibility, experiments, attribution overview, source quality, graduation candidates) plus the operator dashboards exposed under the Admin sidebar group (LLM usage, audit findings, strategic proposals).
allowed-tools: Read Write Edit Grep Glob Bash
---

# Divinr Admin Browser Skill

Deep skill for the `admin` facet. Always load `divinr-workflow-browser-skill` first for the shared Playwright/Chrome-MCP patterns and `assertions.md` invariants.

## Facet summary

- Routes: `/admin/cost/calibration`, `/admin/cost/defensibility`, `/admin/cost/experiments`, `/admin/cost/experiments/:id`, `/admin/attribution`, `/admin/attribution/sources`, `/admin/attribution/graduation-candidates`. Operator-flavoured siblings (linked under the Admin sidebar group) include `/usage`, `/findings`, and `/proposals`.
- Views (under `apps/web/src/views/`): `CostCalibrationView.vue`, `CostDefensibilityView.vue`, `CostExperimentsView.vue`, `AttributionAdminView.vue`, `SourceQualityView.vue`, `GraduationCandidatesView.vue`, `UsageDashboardView.vue`, `AuditFindingsView.vue`, `ProposalsView.vue`.
- Capability slug: `admin`
- Playwright project: `admin`

## Vocabulary rule (RELAXED)

Per `CLAUDE.md`: admin / debug surfaces may retain domain terminology where it aids maintenance. The vocabulary rule is **RELAXED** for this facet — forbidden words `prediction` / `predicted` / `predictor` / `advice` / `recommendation` are allowed in admin copy. Smoke specs in this project must NOT include the vocabulary check.

## Access model

- Admin sidebar groups (`adminOnly: true`) are filtered out for non-admin users in `DefaultLayout.vue`. The router itself does NOT 403 admin paths — `router/index.ts` has no admin guard. A non-admin user who deep-links to an `/admin/*` URL will load the view (and likely see empty data + 401/403 from the API call instead of a redirect).
- The testing-team Playwright user has the admin role seeded (Phase 1 of the testing-team effort). If that role is missing the smoke spec will still render the view shell, but data will not load and APIs will 4xx — see `completeness.md` for the dedup hash to use when filing that finding.

## Key components / patterns

- Heading: most admin views render an `<h2>` (not h1) inside a `<div style="padding: 16px; ...">` shell. The smoke spec must scope the heading assertion accordingly.
- Tables: hand-rolled `<table>` (not `<ion-list>`) — `CostCalibrationView` and `SourceQualityView` both use raw HTML tables with inline styles.
- Empty-state: each table includes an explicit empty row (`v-if="store.calibration.length === 0"` -> "No calibrated models yet — click Refresh to compute averages.").
- Action buttons: `IonButton` with click handlers calling store actions (`refreshCalibration`, `acknowledgeDriftAlert`). Buttons may be disabled while a refresh is in flight.
- First-touch: views render `<FirstTouchPanel surface-key="admin.cost-modeling.calibration" />` (and similar) at the bottom.

## API endpoints exercised

- `GET /admin/cost/calibration` — rolling per-model averages.
- `POST /admin/cost/calibration/refresh` — recompute averages, emit drift alerts.
- `GET /admin/cost/drift-alerts` — list of unacknowledged drift alerts.
- `POST /admin/cost/drift-alerts/:id/acknowledge` — ack a drift alert.
- `GET /admin/attribution/*` — coverage / source-quality / graduation roll-ups.
- `GET /usage` — LLM usage dashboard data.
- `GET /audits/findings`, `GET /proposals` — operator-side findings and strategic proposals.

## File map

- `what.md` — architecture narrative of the facet, vocabulary-relaxation note
- `where.md` — exact Playwright locators per admin route
- `expectations.md` — pass/fail invariants (what the spec must assert)
- `tests.md` — numbered Playwright cases + secondary Chrome-MCP exploratory section
- `completeness.md` — known coverage gaps + human demo script + finding-dedup hashes
