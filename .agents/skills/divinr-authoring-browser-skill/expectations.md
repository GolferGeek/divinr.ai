# Expectations — Authoring facet

## Pass conditions

### Hub page (`/settings/authored-content`)

- Route resolves without redirect to `/login` (storage-state authenticated).
- One of the following headings is visible within 10 s:
  - **Primary path:** `<h1>Your Content</h1>` is visible — the testing-team user has the mock-paid flag and the route renders the hub.
  - **Tier-gate fallback:** an upgrade / subscribe / paid-plan CTA heading is visible — the route is gated and redirects unauthorized users to an upsell. This is also a pass.
- On the primary path, at least one authored-content surface signal is visible: either an `ion-card` for an authored analyst, OR the empty-state copy "No authored analysts yet — create your first one." Both-missing is a failure.
- No HTTP 5xx responses from `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101` during the page lifecycle. (4xx on `GET /authored-content/*` is acceptable on the gated path.)

### Vocabulary (outside disclaimers)

After removing `.legal-disclaimer`, `[data-testid="legal-disclaimer"]`, `[surface-key]`, and `[data-surface-key]` nodes, the remaining user-visible text must NOT contain (case-insensitive):

- `\bprediction(s|ed|or)?\b`
- `\brecommendation\b`
- `\badvice\b`

The hub view does not render a legal disclaimer inline; the strip is defensive in case one is added later. The first-touch panel attribute `[surface-key]` IS stripped — surface-content copy may legitimately use domain terminology.

### Tab bar (primary path only)

- All five segment buttons are present (`analysts`, `instruments`, `wiring`, `apikeys`, `billing`), even when each tab's content is empty.
- Default selected tab is `analysts`.
- Switching to other tabs does not produce a 5xx.

## Fail conditions

- Hub page redirects to `/login` -> auth state stale; re-run `pnpm --filter @divinr/e2e exec tsx scripts/prepare-auth-state.ts`.
- Neither the "Your Content" h1 nor an upgrade-CTA heading visible within 10 s.
- On the primary path: neither cards nor the explicit empty-state copy is visible (render failure).
- Any 5xx on `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101`.
- Forbidden vocabulary found in non-disclaimer copy.

## Tier-gating branch (documented)

The testing-team Playwright project runs as a user flagged with `mock_paid = true`. Today the `/settings/authored-content` route renders the hub regardless of tier (the API enforces gating per-resource). If a future effort introduces a client-side gate that redirects free-tier users to an upgrade CTA, the smoke spec must continue to pass for both branches:

- **Branch A (current):** "Your Content" h1 + segment bar + per-tab empty-state-or-card.
- **Branch B (future gate):** upgrade / subscribe heading; segment-bar assertions are skipped (`test.skip(!yourContentVisible, 'tier-gate branch')`).

The spec asserts the heading-disjunction first, then conditionally runs the segment-bar / empty-state assertions only on Branch A.

## Known non-issues

- The Wiring tab's matrix may be empty pre-authored-content — do not assert grid contents in smoke.
- The Billing tab requires the API to return a preview; it can show `null` while loading.
- The API Keys tab may render zero credential rows for a fresh testing-team user.
- Contract editor and curriculum-authoring sub-routes are not exercised in smoke; manual / Chrome-MCP only.
