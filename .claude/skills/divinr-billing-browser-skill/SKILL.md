---
name: divinr-billing-browser-skill
description: Playwright + Chrome-MCP patterns for the Divinr billing-lifecycle surface. Covers the app-shell TrialCountdown chip, the ReadOnlyBanner on every view, and cross-links to the authoring facet for the "Add a card" settings flow.
allowed-tools: Read Write Edit Grep Glob Bash
---

# Divinr Billing Browser Skill

Deep skill for the `billing` facet. Always load `divinr-workflow-browser-skill` first for the shared Playwright/Chrome-MCP patterns and `assertions.md` invariants.

## Facet summary

- No dedicated route — the facet surfaces are chrome that render on every authenticated view when the billing lifecycle demands it.
- Primary components (under `apps/web/src/components/`):
  - `TrialCountdown.vue` — `<ion-chip data-testid="trial-countdown">` in the app-shell header. Visible when `billing.status === 'trial'`.
  - `ReadOnlyBanner.vue` — `<div data-testid="read-only-banner" role="alert">` at the top of `<ion-content>`. Visible when `billing.is_read_only === true`.
- Backing store: `apps/web/src/stores/billing-status.store.ts` — fetches `GET /api/billing/status` on mount and polls every 5 minutes.
- Backing API: `apps/api/src/billing/billing.controller.ts` — `GET /billing/status` (exempt from the global `ReadOnlyGuard` via `@SkipReadOnly()`).
- Capability slug: n/a — visible to every authenticated user whose account is in `trial` or `canceled` lifecycle state.
- Playwright project: `billing`.

## Key components / patterns

- The app-shell wrapper is `apps/web/src/layouts/DefaultLayout.vue`. `TrialCountdown` renders inside `<ion-buttons slot="end">`; `ReadOnlyBanner` renders inside `<ion-content>` above `<router-view />`.
- Both components read `useBillingStatusStore()` and render nothing when the lifecycle does not match — so on a `status = 'active'` user, neither is in the DOM.
- First-touch keys: `billing.trial-countdown` and `billing.read-only-banner`. Both are wired with `useFirstTouch(...)` + `<FirstTouchPanel surface-key="..." />`.
- `ReadOnlyBanner` inlines `<LegalDisclaimer variant="short" />` and a primary CTA button "Add a card" that routes to `/settings/authored-content` (the authoring-facet hub where the billing tab lives).

## Trade-CTA / cross-facet hand-offs

1. `ReadOnlyBanner` "Add a card" → `/settings/authored-content` — cross-link with `divinr-authoring-browser-skill` for the billing-tab verification.
2. The `GET /billing/status` endpoint is polled from every view, so the authoring facet's billing preview and this facet's banners read consistent lifecycle state.

## API endpoints exercised

- `GET /billing/status` — `useBillingStatusStore().fetch()`. Returns `{status, trial_ends_at, expired_at, purge_scheduled_at, is_read_only, days_until_purge}`.

## File map

- `what.md` — lifecycle states + surface shape narrative.
- `where.md` — exact Playwright locators per component.
- `expectations.md` — pass/fail invariants (must handle the "neither banner visible on active user" branch).
- `tests.md` — numbered Playwright cases + Chrome-MCP exploratory section.
- `completeness.md` — known coverage gaps + human demo script.
