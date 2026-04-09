# Leaderboard → Calibration Affordance — Product Requirements Document

## 1. Overview

The leaderboard at `/portfolios` displays a calibration score for every analyst but offers no way to navigate to the calibration drilldown at `/analysts/:id/performance`. This effort adds a one-click link from the leaderboard's calibration score cell to the drilldown, so users can immediately explore the reasoning behind any analyst's score.

## 2. Goals & Success Criteria

| Goal | Measurable Criterion |
|---|---|
| One-click navigation from leaderboard to calibration | Clicking an analyst's calibration score cell navigates to `/analysts/:analystId/performance` |
| Visually discoverable | Calibration cells for analyst rows render as styled links (underline + pointer cursor) |
| Non-analyst rows unaffected | User and arbitrator rows show plain text `—` with no link affordance |
| Deep links preserved | Direct navigation to `/analysts/:id/performance` continues to work unchanged |

## 3. User Stories / Use Cases

**Beta reader on leaderboard:** "I see the momentum-breakout analyst has a 72% calibration score. I click the score and land on its calibration drilldown to see per-instrument breakdown, scatter plot, and resolved predictions."

**Non-analyst row:** "The 'user' portfolio row shows `—` in the calibration column — no link, no cursor change."

## 4. Technical Requirements

### 4.1 Architecture

No new pages, components, or API endpoints. The change touches:
1. **API response** — add `analyst_id` to the portfolio summary so the frontend can construct the route.
2. **Frontend type** — extend `PortfolioSummary` with `analyst_id`.
3. **Frontend template** — wrap the calibration cell content in a `<router-link>` for analyst rows that have a score.

### 4.2 Data Model Changes

None. The `analyst_id` already exists on `prediction.analyst_portfolios`; it just isn't included in the summary query result.

### 4.3 API Changes

**`GET /portfolios`** — `leaderboard.service.ts` `getAllPortfoliosSummary()`

Add `analyst_id` to the `analyst_rows` CTE select list (it's already available as `ap.analyst_id`). Non-analyst rows return `null`. The mapped JS object includes the field.

Updated response shape per row:
```ts
{
  // ... existing fields ...
  analyst_id: string | null;  // NEW — null for user/arbitrator rows
}
```

### 4.4 Frontend Changes

**`portfolio.store.ts`** — Add `analyst_id: string | null` to `PortfolioSummary` interface.

**`PortfolioDashboardView.vue`** — In the calibration score `<td>`, replace the plain text with:
- For analyst rows with a non-null `calibration_score`: a `<router-link :to="{ name: 'analyst-performance', params: { id: p.analyst_id } }">` wrapping the formatted score. Styled with underline and cursor pointer. Click must call `$event.stopPropagation()` to prevent the row's `toggleRow` handler from firing.
- For all other rows: keep the current plain text rendering (`—` or the tooltip).

### 4.5 Infrastructure Requirements

None.

## 5. Non-Functional Requirements

- **Performance:** No additional queries — `analyst_id` is already joined in the existing CTE.
- **Security:** No new endpoints or data exposure. `analyst_id` is a UUID already visible in other API responses.
- **Accessibility:** The `<router-link>` renders as an `<a>` tag, making it keyboard-navigable and screen-reader-friendly.

## 6. Out of Scope

- Redesigning the leaderboard table or calibration drilldown page.
- Adding calibration data for non-analyst portfolio types.
- Back-navigation from calibration to leaderboard (browser back suffices).
- Clickable links for analysts whose calibration score is `null` (below sample threshold).

## 7. Dependencies & Risks

| Risk | Mitigation |
|---|---|
| `PortfolioSummary.id` is the portfolio ID, not the analyst ID — the performance route needs the analyst ID | Add `analyst_id` to the API response; use it for the link |
| `stopPropagation` on the link might feel odd if user expects the whole row to expand | The link is a small target within the cell; rest of the row still expands. Standard table-with-links pattern. |

## 8. Phasing

### Phase 1: API + Type + Link (single phase)

This effort is small enough to ship in one phase:

1. Add `analyst_id` to the `analyst_rows` CTE and the JS mapping in `leaderboard.service.ts`.
2. Add `analyst_id: string | null` to `PortfolioSummary` in `portfolio.store.ts`.
3. In `PortfolioDashboardView.vue`, replace the calibration `<td>` content with a `<router-link>` for analyst rows with a score.
4. Verify: leaderboard loads, analyst calibration scores are clickable links, clicking navigates to the correct drilldown, non-analyst rows show plain text, row expansion still works for all rows.

**Quality gate:** Manual verification on dev server — load `/portfolios`, confirm link renders, click through, confirm correct analyst loads in drilldown.
