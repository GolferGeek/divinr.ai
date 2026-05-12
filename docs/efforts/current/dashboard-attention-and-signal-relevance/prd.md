# Dashboard Attention and Signal Relevance — Product Requirements Document

## 1. Overview

This effort replaces the current broad dashboard with a focused daily attention surface. The new dashboard prioritizes the user's current portfolio positions and active tournament standings, then shows only analysis that is relevant to those contexts or to the user's explicit and implicit analyst/instrument preferences.

The work also defines and implements the first version of user-personalized analysis relevance for dashboard surfaces. Explicit preferences provide the easiest-to-understand controls; implicit signals such as holdings, tournaments, analyst affinity, conviction, and disagreement provide automatic relevance. The broad `/predictions` Analyses page remains the discovery surface; the dashboard becomes a curated "what deserves attention now" view.

## 2. Goals & Success Criteria

- Dashboard first viewport shows current portfolio context and active tournament context before generic summary content.
- Open positions include clear instrument, direction, quantity, current/entry price, unrealized P&L, and a link to relevant analysis.
- Active tournament entries show current status and at least one rank/leaderboard context when available.
- Dashboard analysis is filtered and ordered by relevance rather than raw recency alone.
- Users can explicitly follow analysts, watch instruments, mute instruments, and choose a dashboard priority mode.
- Relevance scoring is deterministic, unit-tested, and explainable from returned metadata.
- `/predictions` still supports broad browsing and remains the full analysis discovery route.
- User-visible copy in `apps/web/src` uses "analysis" or "signal" vocabulary and does not introduce forbidden investment-advice terms.
- First-touch and deep browser testing coverage are updated for all changed dashboard, preferences, portfolio, tournament, and predictions surfaces.

## 3. User Stories / Use Cases

- As a returning user, I want to see my open positions immediately so I can understand my current exposure.
- As a returning user, I want to see whether there is new analysis related to what I already hold so I do not browse every instrument manually.
- As a tournament participant, I want to see my current standing and nearby leaderboard context from the home dashboard.
- As a tournament participant, I want one click from the dashboard to the relevant tournament leaderboard or trade surface.
- As a user with analyst preferences, I want analysis ordered around analysts I have shown interest in or alignment with.
- As a user, I want direct controls for followed analysts, watched instruments, muted instruments, and dashboard priority so I can correct the system when implicit relevance is wrong.
- As a curious user, I still want a broader analysis browsing surface, but not mixed into the home dashboard.

## 4. Technical Requirements

### 4.1 Architecture

- Reuse `DashboardView.vue` as the home route.
- Reuse existing Pinia stores where practical:
  - `usePortfolioStore()` for `/portfolios/me`, `/portfolios/me/positions?status=open`, and portfolio details.
  - `useTournamentStore()` for `/tournaments/me`, `/tournaments/:id/leaderboard`, and tournament detail.
  - `usePredictionsStore()` or direct `useApi()` calls for dashboard-relevant analysis.
  - `useAffinityStore()` for analyst affinity display and client-side fallback ordering.
- Prefer a server-owned relevance score for dashboard analysis so clients do not duplicate ranking logic.
- Add a small user preference service/controller for explicit analysis preferences rather than overloading onboarding state.
- Keep broad analysis browsing in `PredictionsView.vue`; dashboard should not fetch or render a large universe of unrelated instruments.

### 4.2 Data Model Changes

Add explicit preference storage. Do not store these preferences only in the onboarding JSON blob because dashboard ranking needs queryable analyst/instrument relationships.

Preferred schema:

```sql
CREATE TABLE IF NOT EXISTS prediction.user_analysis_preferences (
  user_id TEXT NOT NULL REFERENCES authz.users(id) ON DELETE CASCADE,
  preference_type TEXT NOT NULL CHECK (preference_type IN ('followed_analyst', 'watched_instrument', 'muted_instrument')),
  target_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, preference_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_user_analysis_preferences_user_type
  ON prediction.user_analysis_preferences(user_id, preference_type);

CREATE TABLE IF NOT EXISTS prediction.user_dashboard_preferences (
  user_id TEXT PRIMARY KEY REFERENCES authz.users(id) ON DELETE CASCADE,
  priority_mode TEXT NOT NULL DEFAULT 'balanced'
    CHECK (priority_mode IN ('balanced', 'portfolio_first', 'tournaments_first')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The relevance model should use existing data:

- `prediction.user_analysis_preferences`.
- `prediction.user_dashboard_preferences`.
- `prediction.market_predictions` and runs for analysis rows.
- `prediction.trade_recommendations` where already used by dashboard cards.
- Portfolio position tables exposed through `UserPortfolioService`.
- Tournament entry/portfolio/leaderboard tables exposed through the tournament module.
- `prediction.user_analyst_affinity` and `prediction.user_affinity_signals`.

Watched instruments are explicit preferences in this effort. Recently-viewed instruments are out of scope unless implementation confirms an existing activity source; represent that as the reserved `recent_activity` extension point.

### 4.3 API Changes

Extend or replace `MarketsService.getDashboardPredictions(userId)` behind `GET /markets/predictions/dashboard` so the response remains compatible with current dashboard cards but adds relevance metadata:

```ts
interface DashboardAnalysisRelevance {
  score: number;
  reasons: Array<
    | 'followed_analyst'
    | 'watched_instrument'
    | 'open_position'
    | 'queued_trade'
    | 'active_tournament'
    | 'analyst_affinity'
    | 'high_conviction'
    | 'analyst_disagreement'
    | 'recent_activity' // reserved; emit only if an existing activity source is found
  >;
  explicit_preference_score: number;
  open_position_count: number;
  active_tournament_count: number;
  top_affinity_score: number | null;
  disagreement_score: number | null;
}
```

Each dashboard analysis row should include:

- Existing fields currently returned by the dashboard analysis endpoint. Frontend callers use `useApi()` with `/predictions/dashboard`; the direct API route is `GET /markets/predictions/dashboard`.
- `relevance: DashboardAnalysisRelevance`.

Ranking requirements:

- Muted instruments are excluded from dashboard analysis unless the user is viewing them directly outside the dashboard.
- Watched instruments and followed analysts get explicit relevance boosts.
- Open-position instruments outrank non-held instruments.
- Active-tournament instruments outrank generic instruments.
- Dashboard priority mode adjusts ordering between portfolio and tournament contexts:
  - `portfolio_first`: open-position and queued-trade instruments sort before active-tournament-only instruments.
  - `tournaments_first`: active-tournament instruments sort before portfolio-only instruments.
  - `balanced`: explicit preferences, holdings, tournaments, affinity, conviction, disagreement, and recency combine by score.
- High-affinity analysts affect ordering inside otherwise similar groups.
- High-conviction non-neutral arbitrator synthesis remains a gate for dashboard visibility.
- Strong analyst disagreement can promote an item only when it is non-neutral or contextually relevant.
- `recent_activity` must not be emitted unless implementation confirms an existing user activity source; watched/recently-viewed tracking is not introduced in this effort.
- The endpoint should return a bounded list, defaulting to 8 dashboard items unless an existing lower limit is already enforced.

The current public route shape may remain `GET /markets/predictions/dashboard`; do not introduce a second endpoint unless the existing response becomes too hard to evolve safely.

Add explicit preference API endpoints under the markets controller:

```ts
GET /markets/preferences/analysis
PUT /markets/preferences/analysis
```

`GET` returns:

```ts
interface AnalysisPreferenceResponse {
  followed_analyst_ids: string[];
  watched_instrument_ids: string[];
  muted_instrument_ids: string[];
  priority_mode: 'balanced' | 'portfolio_first' | 'tournaments_first';
}
```

`PUT` accepts the same shape and replaces the user's explicit analysis preferences. The service should validate target IDs exist where practical and should be idempotent.

### 4.4 Frontend Changes

Update `apps/web/src/views/DashboardView.vue`:

- Replace the current pathway-card-first layout with a focused dashboard layout:
  - Portfolio/positions module near the top.
  - Tournament standings module near the top.
  - Relevant analysis module below those modules.
  - Secondary navigation links as compact actions, not dominant cards.
- Remove or demote generic count cards for ticker count, active analyses, multi-analyst count, and stance count.
- Keep `UserUsageWidget`, `StudentAccrualWidget`, `DailyAnalystSummary`, and `ContrarianAlert` only if they do not displace the two primary modules; otherwise move below primary content.
- Add clear empty states:
  - No open positions: link to relevant analysis or portfolios without implying the user should trade.
  - No active tournaments: link to tournaments.
  - No relevant analysis: state that nothing currently needs attention and link to broad Analyses.
- Add data-test hooks for E2E:
  - `dashboard-positions`
  - `dashboard-position-row`
  - `dashboard-tournaments`
  - `dashboard-tournament-row`
  - `dashboard-relevant-analysis`
  - `dashboard-analysis-card`

Add or update a settings/preferences surface:

- Prefer adding a focused route such as `/settings/analysis-preferences` under the Settings group.
- The surface lets users:
  - follow/unfollow analysts
  - watch/unwatch instruments
  - mute/unmute instruments
  - choose dashboard priority mode with a segmented control
- The surface shows compact lists/search controls rather than a complex tuning interface.
- Add `FirstTouchPanel surface-key="settings.analysis-preferences"` and corresponding surface content.
- Add nav visibility consistent with the existing Settings group and mastery policy.

Update or reuse `PortfolioDashboardView.vue` only where needed to share a small presentational component for position rows.

Update `PredictionsView.vue`, `InstrumentDetailView.vue`, or analyst surfaces only where needed to expose lightweight follow/watch/mute entry points. These controls are optional in browse surfaces if the settings surface provides the complete workflow.

### 4.5 Infrastructure Requirements

- Add a small preferences service/controller if needed; all constructor dependencies must use explicit `@Inject(...)`.
- Add DDL to migrations and explicit bootstrap path. Do not add request-time schema mutation.
- Existing local dev startup remains `pnpm --filter @divinr/api run dev:up`.

## 5. Non-Functional Requirements

- Dashboard API calls should remain bounded and avoid N+1 query patterns over every prediction row.
- Dashboard first render should work when any one of portfolio, tournament, or analysis requests fails; failed modules should show compact error/empty states without blanking the page.
- Relevance score computation should be stable for identical data.
- Mobile layout must show positions and tournament rows without horizontal overflow.
- User-visible vocabulary must comply with the repo's analysis/signal vocabulary rule.
- Accessibility: clickable rows require keyboard-compatible buttons or links, and important deltas should have readable labels.

## 6. Out of Scope

- Freeform preference tuning UI.
- Social follow graph or public following activity.
- Push notifications for relevant analysis.
- Real-money trade execution.
- Rebuilding tournament detail, portfolio detail, or the full Analyses page.
- Generating analysis for every instrument on demand.

Explicit analysis preferences are in scope, but they must stay small and operational: followed analysts, watched instruments, muted instruments, and dashboard priority mode. Richer preference builders, natural-language preference entry, social following, notifications, and per-strategy weighting are deferred.

## 7. Dependencies & Risks

- **Sparse portfolio/tournament fixtures**: E2E environments may not always have open positions or active tournaments. Mitigate with tests that assert either populated rows or clear empty states.
- **Dashboard endpoint complexity**: Ranking could become hard to reason about if implemented inline in one long SQL query. Mitigate with a small typed scoring helper and focused unit tests.
- **Vocabulary regressions**: Existing code and API identifiers use prediction terminology. Mitigate by testing rendered copy while allowing code identifiers and routes.
- **Data availability for standings**: `/tournaments/me` may not include rank context. Mitigate by fetching leaderboard for active entries in a bounded way, limiting to the top few active tournaments.
- **Over-personalization too early**: Analyst affinity can be sparse. Mitigate with neutral defaults and explicit fallback ordering.
- **Preference UI scope creep**: Explicit controls could become a full settings product. Mitigate by limiting this effort to follow/watch/mute plus one priority mode.

## 8. Phasing

1. **Dashboard data contracts and relevance scoring**
   - Add server relevance metadata to dashboard analysis.
   - Add unit tests for scoring and gating.

2. **Explicit analysis preferences**
   - Add storage, API, and a small settings UI for followed analysts, watched instruments, muted instruments, and dashboard priority.

3. **Portfolio-first dashboard module**
   - Render current open positions at the top of dashboard.
   - Link positions to relevant analysis and portfolio detail.

4. **Tournament standings dashboard module**
   - Render active tournament entries and rank/leaderboard context.
   - Link to tournament detail and leaderboard.

5. **Relevant analysis dashboard module**
   - Replace generic active signal grid with relevance-ordered analysis cards.
   - Keep broad analysis browsing separate.

6. **Coverage, copy, and browser verification**
   - Update first-touch content.
   - Update deep browser skill docs and Playwright coverage.
   - Run lint, build, unit, and E2E quality gates.
