# Completeness — Admin facet

## Known coverage gaps (today)

- The smoke spec covers ONLY `/admin/cost/calibration`. The other eight admin
  routes (`/admin/cost/defensibility`, `/admin/cost/experiments`,
  `/admin/attribution`, `/admin/attribution/sources`,
  `/admin/attribution/graduation-candidates`, `/usage`, `/findings`,
  `/proposals`) are documented in `where.md` and `what.md` but lack their own
  spec.
- No assertion on the Refresh-button round-trip — deferred to a deeper
  interactive spec because clicking Refresh in a shared env triggers a real
  recompute (and may emit drift alerts that other reviewers will need to
  acknowledge).
- No assertion on drift-alert acknowledgement (mutation flow, deferred).
- No assertion on the cost-experiments creation form (admin write-flow,
  deferred).
- Source-quality sort order is not asserted; today the table is alphabetical
  by source name and we do not pin that.
- No screenshot baselines for any admin view.

## Demo script (human walk)

For a 90-second manual sanity check:

1. Log in as `testing-team@divinr.ai` (must have admin role).
2. Navigate to `/admin/cost/calibration`.
3. Confirm the heading reads "Cost Calibration".
4. Confirm either the calibration table has rows OR the empty-state row "No calibrated models yet — click Refresh to compute averages." is visible.
5. If a Drift alerts card is shown, scan the rows; do not click Acknowledge in a shared env.
6. Open DevTools network — confirm `GET /admin/cost/calibration` returned 200, not 401/403.
7. Visit `/admin/attribution`, `/admin/attribution/sources`, `/admin/attribution/graduation-candidates`. Each should render its h2 and a card or table.
8. Visit `/usage`, `/findings`, `/proposals` — operator surfaces in the Admin sidebar group. Each should render its heading.

Any deviation → file a finding under `docs/testing/findings/open/`.

## Finding dedup hashes

Use these hashes when filing findings to avoid duplicates:

| Scenario                                                                              | Dedup hash command                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Testing-team user lacks admin role; admin API returns 401/403; view renders empty.    | `sha1("divinr:apps/e2e/tests/admin/smoke.spec.ts:admin-role-gate") \| head -c 8`     |
| Admin route 5xx on initial load.                                                      | `sha1("divinr:apps/e2e/tests/admin/smoke.spec.ts:admin-route-5xx:<route>") \| head -c 8` |
| Heading missing despite 200 response.                                                 | `sha1("divinr:apps/e2e/tests/admin/smoke.spec.ts:admin-heading-missing:<route>") \| head -c 8` |
| Empty calibration table missing the explicit empty-state row.                         | `sha1("divinr:apps/e2e/tests/admin/smoke.spec.ts:calibration-empty-state-missing") \| head -c 8` |

## Follow-ups that should flow into a later effort

- Per-route smoke specs for the remaining eight admin surfaces (file as a
  Phase 6 testing-team follow-up).
- Refresh / Acknowledge mutation specs against an isolated test database.
- Visual regression baselines for the calibration and attribution overview.
- An RBAC spec that proves a non-admin session cannot reach the admin API
  (the router does not currently guard the routes; the protection is
  server-side only).
