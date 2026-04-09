# Leaderboard → Calibration Affordance — Implementation Plan

**PRD**: prd.md
**Created**: 2026-04-09
**Status**: Complete

## Progress Tracker

- [x] Phase 1: API — expose analyst_id in portfolio summary
- [x] Phase 2: Frontend — clickable calibration link

---

## Phase 1: API — expose analyst_id in portfolio summary
**Status**: Complete
**Objective**: Add `analyst_id` to the `GET /portfolios` response so the frontend can construct calibration drilldown links.

### Steps
- [x] 1.1 In `apps/api/src/markets/services/leaderboard.service.ts`, add `ap.analyst_id` to the `analyst_rows` CTE select list and `null::text as analyst_id` to the `user_rows` CTE.
- [x] 1.2 In the same file's `getAllPortfoliosSummary()` JS mapping block (~line 221), add `analyst_id: r.analyst_id ? String(r.analyst_id) : null` to the returned object.
- [x] 1.3 Update the `PortfolioSummaryRow` interface (same file) to include `analyst_id: string | null`.
- [x] 1.4 Update the existing unit test `apps/api/tests/unit/leaderboard-service.test.ts`: add `analyst_id` to the mock data fixtures and add assertions that `analyst_id` is present on analyst rows and `null` on non-analyst rows.

### Quality Gate

- [ ] **Build**: `cd apps/api && pnpm build` — no errors
- [ ] **Lint**: `cd apps/api && pnpm lint` — no errors
- [ ] **Unit Tests**: `cd apps/api && tsx tests/unit/leaderboard-service.test.ts` — all pass, including new `analyst_id` assertions
- [ ] **Curl Test**: With API running on port 7100:
  ```
  curl -s http://localhost:7100/portfolios -H "Authorization: Bearer <token>" | jq '.[0] | has("analyst_id")'
  # → true
  curl -s http://localhost:7100/portfolios -H "Authorization: Bearer <token>" | jq '[.[] | select(.kind == "analyst")] | all(.analyst_id != null)'
  # → true
  curl -s http://localhost:7100/portfolios -H "Authorization: Bearer <token>" | jq '[.[] | select(.kind == "user")] | all(.analyst_id == null)'
  # → true
  ```
- [ ] **Phase Review**:
  - [ ] `analyst_id` appears in API response for analyst rows
  - [ ] `analyst_id` is `null` for user rows
  - [ ] No additional queries introduced — `analyst_id` was already in the joined CTE

---

## Phase 2: Frontend — clickable calibration link
**Status**: Complete
**Objective**: Make calibration score cells clickable links to `/analysts/:id/performance` for analyst rows with scores.

### Steps
- [x] 2.1 In `apps/web/src/stores/portfolio.store.ts`, add `analyst_id: string | null` to the `PortfolioSummary` interface.
- [x] 2.2 In `apps/web/src/views/PortfolioDashboardView.vue`, add `import { RouterLink } from 'vue-router';` (or use the globally registered `<router-link>` tag).
- [x] 2.3 Replace the calibration `<td>` cell (currently ~line 252-255) with conditional rendering:
  - If `p.analyst_id && p.calibration_score != null`: render `<router-link>` to `{ name: 'analyst-performance', params: { id: p.analyst_id } }` wrapping the formatted score, styled with `text-decoration:underline;cursor:pointer;color:var(--ion-color-primary)`. Add `@click.stop` to prevent row expansion.
  - Otherwise: render the existing plain text with tooltip.
- [x] 2.4 Verify the `analyst-performance` route name exists in `apps/web/src/router/index.ts` (it does — line 27).

### Quality Gate

- [ ] **Build**: `cd apps/web && pnpm build` — no errors
- [ ] **Typecheck**: `cd apps/web && pnpm typecheck` — no errors
- [ ] **Lint**: `cd apps/web && pnpm lint` — no errors
- [ ] **Chrome Tests** (manual, dev server on port 7101):
  - [ ] Navigate to `http://localhost:7101/portfolios` — leaderboard renders
  - [ ] Analyst rows with calibration scores show underlined, primary-colored links
  - [ ] Analyst rows with `—` (below threshold) show plain text, no link
  - [ ] User/arbitrator rows show `—` with no link affordance
  - [ ] Click an analyst's calibration score link → navigates to `/analysts/:id/performance` showing the correct analyst
  - [ ] Click elsewhere on the same row → row expands (stopPropagation works)
  - [ ] Browser back from calibration drilldown → returns to leaderboard
- [ ] **Phase Review**:
  - [ ] PRD §2 one-click navigation — confirmed working
  - [ ] PRD §2 visually discoverable — underline + color + pointer cursor
  - [ ] PRD §2 non-analyst rows unaffected — confirmed
  - [ ] PRD §2 deep links preserved — direct URL to `/analysts/:id/performance` still works
  - [ ] PRD §6 out of scope respected — no changes to drilldown page, no links for null-score analysts

---
