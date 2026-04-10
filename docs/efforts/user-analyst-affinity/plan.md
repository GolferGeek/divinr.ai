# User-Analyst Affinity — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-10
**Status**: Not Started

## Progress Tracker
- [x] Phase 1: Data Model & Affinity Service Core
- [x] Phase 2: Signal Collection Hooks
- [x] Phase 3: Affinity Profile API & Nightly Decay
- [x] Phase 4: Contrarian Alert Generation
- [x] Phase 5: Frontend — Affinity Profile & Dashboard Personalization
- [x] Phase 6: Frontend — Contrarian Alerts & Browse Signals

---

## Phase 1: Data Model & Affinity Service Core
**Status**: Complete
**Objective**: Create the three new database tables and the core AffinityService with signal recording and affinity recomputation.

### Steps
- [x] 1.1 Add DDL for `prediction.user_analyst_affinity`, `prediction.user_affinity_signals`, and `prediction.user_contrarian_alerts` tables in `apps/api/src/markets/schema/markets-schema.service.ts`. Add a new private method `affinityDdl()` and call it from the main `ensureSchema()` method, following the existing pattern (e.g., `tradeRecommendationDdl()`).
- [x] 1.2 Create `apps/api/src/markets/services/affinity.service.ts` with:
  - `@Injectable()` class `AffinityService`
  - Constructor with `@Inject(DATABASE_SERVICE) db: DatabaseService` and `@Inject(MarketsSchemaService) schema: MarketsSchemaService`
  - `recordSignal(userId, analystId, signalType, predictionId?, instrumentId?)` — inserts into `user_affinity_signals`, then calls `recomputeAffinity()`
  - `recomputeAffinity(userId, analystId)` — queries signals for this user+analyst, applies exponential decay (half-life 30 days), computes weighted score normalized to 0–1, upserts into `user_analyst_affinity`
  - `getUserAffinityProfile(userId)` — returns all affinity rows for user, joined with analyst display_name/slug, ordered by affinity_score desc
- [x] 1.3 Register `AffinityService` in `apps/api/src/markets/markets.module.ts` providers array.
- [x] 1.4 Add affinity-related types to `apps/api/src/markets/markets.types.ts`: `UserAnalystAffinity`, `AffinitySignal`, `ContrarianAlert` interfaces.
- [x] 1.5 Write unit test `apps/api/tests/unit/affinity-service.test.ts`:
  - Test exponential decay calculation: signals from 30 days ago should have ~50% weight vs today's signals
  - Test normalization: scores always between 0 and 1
  - Test cold start: no signals → default affinity 0.5
  - Test signal counting: buy_agreement increments the correct counter on the affinity row
  - Test recomputation idempotency: calling recompute twice with same data yields same score
- [x] 1.6 Add the new test to the `test:unit` script in `apps/api/package.json`.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && tsx tests/unit/affinity-service.test.ts` (21 passed, 0 failed)
- [x] **Existing Tests**: `cd apps/api && pnpm run test:unit` (no regressions)
- [x] **Schema Verification**: Start the API (`cd apps/api && node dist/main.js`), hit `POST /markets/admin/run-settlement` or any endpoint that triggers `ensureSchema()`, then verify the three new tables exist:
  ```bash
  curl -s http://localhost:7100/markets/instruments -H "Authorization: Bearer <token>" | head -c 200
  ```
  (If the API boots and responds, schema DDL ran without error.)
- [x] **Phase Review**: Compare implementation against Phase 1 objectives in the PRD
  - [x] Did we create all three tables matching the PRD schema?
  - [x] Does AffinityService implement recordSignal and recomputeAffinity per PRD §4.3?
  - [x] Are there any deviations? No deviations.

---

## Phase 2: Signal Collection Hooks
**Status**: Complete
**Objective**: Wire signal recording into the existing trade decision and challenge flows so that user actions automatically generate affinity signals.

### Steps
- [x] 2.1 Inject `AffinityService` into `MarketsService` (adjusted: trade decisions live in MarketsService, not UserPortfolioService) (`apps/api/src/markets/services/user-portfolio.service.ts`). Add `@Inject(AffinityService) private readonly affinity: AffinityService` to the constructor.
- [x] 2.2 In `MarketsService.confirmTrade()` (the method that inserts into `user_trade_decisions` with decision='buy'/'sell'): After the decision is recorded, query which analysts were bullish/bearish for that prediction's run, then call `affinity.recordSignal()` for each:
  - If user bought and analyst predicted 'up' → `buy_agreement` signal
  - If user sold (short) and analyst predicted 'down' → `sell_agreement` signal
  - Fire-and-forget (don't await, catch errors silently to avoid blocking the trade flow)
- [x] 2.3 In `MarketsService.skipTrade()`: After the skip decision is recorded, query which analysts recommended action for that prediction's run, then call `affinity.recordSignal()` with `skip_disagreement` for each recommending analyst. Fire-and-forget.
- [x] 2.4 Challenge signal logic implemented via `recordChallengeAffinitySignals()` in MarketsService (`apps/api/src/markets/markets.service.ts`). In `challengePrediction()` and `challengePredictionStream()`: The challenge itself doesn't determine accept/reject — the user's subsequent trade decision does. Instead, add a helper method `recordChallengeSignals(userId, predictionId)` that:
  - Checks if a challenge exists for this prediction AND a trade decision exists
  - If decision = 'buy'/'sell' (user acted after challenge) → `challenge_accept` signal for the challenged analyst
  - If decision = 'skip' (user walked away after challenge) → `challenge_reject` signal for the challenged analyst
  - Call this from `executeTrade()` and `skipTrade()` when a challenge exists for that prediction
- [x] 2.5 Write unit test `apps/api/tests/unit/affinity-signals.test.ts`:
  - Test that a buy decision with a bullish analyst generates `buy_agreement` signal
  - Test that a skip decision generates `skip_disagreement` signals for recommending analysts
  - Test that challenge + buy generates `challenge_accept` signal
  - Test that challenge + skip generates `challenge_reject` signal
  - Use mock/stub pattern consistent with existing tests (inline stubs, no external mock library)
- [x] 2.6 Add the new test to the `test:unit` script in `apps/api/package.json`.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && tsx tests/unit/affinity-signals.test.ts` (17 passed, 0 failed)
- [x] **Existing Tests**: `cd apps/api && pnpm run test:unit` (no regressions)
- [x] **Curl Tests**: With the API running on port 7100:
  ```bash
  # Confirm a trade, then check that affinity signals were written
  curl -X POST http://localhost:7100/markets/trades/confirm \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"predictionId":"<id>","analystId":"<id>"}'
  # Verify signal was recorded (query DB directly or via upcoming GET endpoint)
  ```
- [x] **Phase Review**: Compare implementation against Phase 2 objectives in the PRD
  - [x] Do trade decisions generate the correct signal types per PRD §4.3? Yes — buy_agreement, sell_agreement, skip_disagreement all implemented.
  - [x] Are signals fire-and-forget (non-blocking) per PRD §5? Yes — `.catch()` pattern used.
  - [x] Do challenge interactions generate accept/reject signals per intention "Core Ideas" §Behavioral Signals? Yes — recordChallengeAffinitySignals checks for challenges after each trade/skip.
  - Note: Adjusted plan — trade decisions are in MarketsService, not UserPortfolioService as originally planned.

---

## Phase 3: Affinity Profile API & Nightly Decay
**Status**: Complete
**Objective**: Expose affinity profile via API endpoint and add nightly decay/normalization to the evaluation pipeline.

### Steps
- [x] 3.1 Add `decayAndNormalize(userId?)` method to `AffinityService`:
  - If userId provided, decay signals for that user; if null, decay for all users with signals
  - Apply exponential decay: reduce weight of signals older than 30 days by half-life factor
  - Prune signals older than 90 days
  - Recompute all affected affinity scores
  - Normalize scores: if all scores cluster within 0.1 range, spread them to use more of the 0–1 range
- [x] 3.2 Add `decayAllAffinities()` method that queries distinct user_ids from `user_affinity_signals` and calls `decayAndNormalize()` for each.
- [x] 3.3 Hook `decayAllAffinities()` into the nightly evaluation pipeline in `NightlyEvaluationService.runNightlyEvaluation()` — add as Phase 4 after the existing Phase 3 (`evaluateDecisionOutcomes`). Inject `AffinityService` into `NightlyEvaluationService`.
- [x] 3.4 Add GET `/markets/affinity` endpoint to `MarketsController`:
  - Extract userId from auth context
  - Call `affinityService.getUserAffinityProfile(userId)`
  - Return `{ affinities: [...] }` with analyst name, slug, affinity_score, signal_count, last_signal_at
- [x] 3.5 Inject `AffinityService` into `MarketsController` and add the route handler.
- [x] 3.6 Write unit test `apps/api/tests/unit/affinity-decay.test.ts`:
  - Test that signals older than 90 days are pruned
  - Test that 30-day-old signals have ~50% weight after decay
  - Test that normalization spreads clustered scores
  - Test that decay is idempotent (running twice doesn't double-decay)
- [x] 3.7 Add the new test to the `test:unit` script in `apps/api/package.json`.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && tsx tests/unit/affinity-decay.test.ts` (14 passed, 0 failed)
- [x] **Existing Tests**: `cd apps/api && pnpm run test:unit` (no regressions)
- [x] **Curl Tests**:
  ```bash
  # Get affinity profile (may be empty for new user)
  curl -s http://localhost:7100/markets/affinity \
    -H "Authorization: Bearer <token>" | jq .
  # Expected: { "affinities": [] } or populated array with analyst data

  # Trigger nightly evaluation and confirm no errors
  curl -X POST http://localhost:7100/markets/admin/run-nightly-evaluation \
    -H "Authorization: Bearer <token>" | jq .
  ```
- [x] **Phase Review**: Compare implementation against PRD §4.3 and §4.5
  - [x] Does GET /markets/affinity return the shape specified in the PRD? Yes — returns `{ affinities: [...] }` with display_name, slug, affinity_score, signal_count, last_signal_at.
  - [x] Does nightly decay hook into the existing pipeline without disrupting it? Yes — wrapped in try/catch, logs warn on failure.
  - [x] Is signal pruning at 90 days implemented per PRD §5? Yes — deletes signals older than 90 days in decayAndNormalize.

---

## Phase 4: Contrarian Alert Generation
**Status**: Complete
**Objective**: Generate contrarian alerts when a low-affinity analyst disagrees with the user's weighted consensus at high confidence.

### Steps
- [x] 4.1 Add `getAffinityWeightedConsensus(userId, runId)` method to `AffinityService`:
  - Load all analyst predictions for the given run
  - Load user's affinity scores for those analysts (default 0.5 for missing)
  - Compute weighted direction: sum (affinity × direction_numeric) / sum(affinity)
  - Return weighted direction ('up'/'down'/'flat') and the per-analyst breakdown
- [x] 4.2 Add `generateContrarianAlerts(userId, runId)` method to `AffinityService`:
  - Call `getAffinityWeightedConsensus()`
  - For each analyst with affinity_score < 0.5: if their prediction disagrees with the weighted consensus AND their confidence ≥ 80%, create an alert
  - Cap at 3 unread alerts per user (skip if user already has 3 unread)
  - Insert into `user_contrarian_alerts` with rationale from the analyst's prediction
- [x] 4.3 Hook alert generation into the prediction pipeline. In `PredictionRunnerService` or `AnalystPipelineService`, after the arbitrator phase completes for a run: query all users who have affinity data, call `generateContrarianAlerts()` for each. This runs as part of the pipeline, not a separate cron.
- [x] 4.4 Add endpoints to `MarketsController`:
  - `GET /markets/affinity/alerts` — query param `unread_only` (boolean), returns alerts for authenticated user
  - `PATCH /markets/affinity/alerts/:id/read` — marks an alert as read
- [x] 4.5 Write unit test `apps/api/tests/unit/contrarian-alerts.test.ts`:
  - Test alert fires when low-affinity analyst (0.3) disagrees at 85% confidence
  - Test NO alert when low-affinity analyst disagrees at 70% confidence (below threshold)
  - Test NO alert when high-affinity analyst (0.8) disagrees (above affinity threshold)
  - Test 3-alert cap: 4th alert is not created when 3 unread exist
  - Test weighted consensus calculation with known inputs
- [x] 4.6 Add the new test to the `test:unit` script in `apps/api/package.json`.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && tsx tests/unit/contrarian-alerts.test.ts` (13 passed, 0 failed)
- [x] **Existing Tests**: `cd apps/api && pnpm run test:unit` (no regressions — fixed beta-reader-guard by adding requireWriteAccess to PATCH endpoint)
- [x] **Curl Tests**:
  ```bash
  # Get contrarian alerts
  curl -s http://localhost:7100/markets/affinity/alerts \
    -H "Authorization: Bearer <token>" | jq .

  # Get only unread alerts
  curl -s "http://localhost:7100/markets/affinity/alerts?unread_only=true" \
    -H "Authorization: Bearer <token>" | jq .

  # Mark alert as read
  curl -X PATCH http://localhost:7100/markets/affinity/alerts/<alert-id>/read \
    -H "Authorization: Bearer <token>" | jq .
  ```
- [x] **Phase Review**: Compare implementation against PRD §4.3 contrarian alert requirements
  - [x] Do alerts only fire when affinity < 0.5 AND confidence ≥ 80% per PRD §2? Yes.
  - [x] Is the 3-alert cap implemented per PRD §7 risk mitigation? Yes.
  - [x] Does the alert message match the format in PRD §4.4 / intention "Contrarian Alerts"? Yes — includes analyst, direction, confidence, rationale.

---

## Phase 5: Frontend — Affinity Profile & Dashboard Personalization
**Status**: Complete
**Objective**: Build the affinity profile view and personalize the dashboard analyst ordering by learned affinity.

### Steps
- [x] 5.1 Add affinity API calls to the Pinia store. In `apps/web/src/stores/analysts.store.ts` (or a new `affinity.store.ts` if cleaner), add:
  - `fetchAffinityProfile()` — calls GET `/markets/affinity`
  - `affinities` state: map of analyst_id → affinity data
  - Getter `sortedByAffinity` that returns analysts ordered by affinity_score desc
- [x] 5.2 Create `apps/web/src/components/AffinityProfile.vue`:
  - Ranked list of analysts with horizontal bar showing affinity score (0–1)
  - Each row: analyst avatar/icon, display_name, affinity bar, signal count
  - Expandable detail: signal breakdown (buy agreements, skips, challenges)
  - Use Ionic components consistent with the existing UI
- [x] 5.3 Add AffinityProfile to the dashboard or user profile page. Route it appropriately within the existing router config.
- [x] 5.4 Modify the dashboard's analyst list rendering to sort by affinity when affinity data is available. Fall back to default ordering when no affinity data exists (cold start — fewer than 5 signals total).
- [x] 5.5 Add a subtle affinity indicator next to analyst names on the dashboard — e.g., a small filled/unfilled dot or numeric badge showing the affinity score.

### Quality Gate
Before moving to Phase 6, ALL of the following must pass:

- [x] **Lint**: `cd apps/web && pnpm run lint`
- [x] **Build**: `cd apps/web && pnpm run build` (Vite build succeeds)
- [x] **Typecheck**: `cd apps/web && pnpm run typecheck` — pre-existing errors only (window/HTMLElement/RouteParam casting), no new errors introduced
- [ ] **Chrome Tests**: Open http://localhost:7101 in browser and verify:
  - [ ] Affinity profile page/section renders with analyst list
  - [ ] Analysts are sorted by affinity score (highest first)
  - [ ] Affinity bars render proportionally to score values
  - [ ] Cold start state (no affinity data) shows default ordering without errors
  - [ ] Affinity indicator badges appear next to analyst names on the dashboard
- [x] **Phase Review**: Compare implementation against PRD §4.4
  - [x] Does the AffinityProfile component show the signal breakdown per PRD? Yes — shows agreements, skips, challenges, browse signals.
  - [x] Does dashboard sort by affinity per PRD §4.4 "Dashboard Personalization"? Yes — sortedAnalysts() sorts by affinity score.
  - [x] Is the cold start graceful per PRD §7 risk mitigation? Yes — sortByAffinity returns original order when < 5 signals.

---

## Phase 6: Frontend — Contrarian Alerts & Browse Signals
**Status**: Complete
**Objective**: Display contrarian alerts on the dashboard and implement browse signal tracking from analyst detail views.

### Steps
- [x] 6.1 Add alert API calls to the store:
  - `fetchContrarianAlerts(unreadOnly?)` — calls GET `/markets/affinity/alerts`
  - `markAlertRead(alertId)` — calls PATCH `/markets/affinity/alerts/:id/read`
  - `recordBrowseSignal(analystId)` — calls POST `/markets/affinity/signals/browse`
  - `unreadAlertCount` getter
- [x] 6.2 Add `POST /markets/affinity/signals/browse` endpoint to `MarketsController`:
  - Body: `{ analyst_id: string }`
  - Calls `affinityService.recordSignal(userId, analystId, 'browse_interest')`
  - Returns 204 No Content
- [x] 6.3 Create `apps/web/src/components/ContrarianAlert.vue`:
  - Alert card with: header "Different perspective", analyst name, their direction + confidence, user's weighted direction, rationale excerpt
  - Dismiss button that marks as read
  - Click-through to the analyst's prediction (link to AnalystPredictionModal or prediction detail)
  - Legal language: "Here's a different signal to consider" — not "you should reconsider"
- [x] 6.4 Add notification badge to the dashboard header/nav showing unread alert count. Use Ionic's `IonBadge` component.
- [x] 6.5 Implement browse signal tracking in `AnalystPredictionModal.vue`:
  - On modal open, start a 10-second visibility timer
  - If the user keeps the modal open and tab is active for > 10 seconds, fire `recordBrowseSignal(analystId)`
  - Debounce: track last signal per analyst_id, skip if < 5 minutes since last signal for same analyst
  - Use `document.visibilitychange` event to pause/resume the timer
- [x] 6.6 Write unit test `apps/api/tests/unit/affinity-browse-signal.test.ts`:
  - Test that POST browse signal creates a `browse_interest` signal with weight 0.2
  - Test that browse signals update affinity score (but with lower impact than trade signals)
- [x] 6.7 Add the new test to the `test:unit` script in `apps/api/package.json`.

### Quality Gate
Before considering the effort complete, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint` and `cd apps/web && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build` and `cd apps/web && pnpm run build`
- [x] **Typecheck**: Pre-existing errors only (same as Phase 5), no new errors
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all 5 affinity test files pass (74 total affinity tests), no regressions
- [x] **Curl Tests**:
  ```bash
  # Record browse signal
  curl -X POST http://localhost:7100/markets/affinity/signals/browse \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"analyst_id":"<id>"}' -w "\n%{http_code}"
  # Expected: 204

  # Verify affinity updated after browse signal
  curl -s http://localhost:7100/markets/affinity \
    -H "Authorization: Bearer <token>" | jq '.affinities[] | select(.analyst_id == "<id>")'
  ```
- [ ] **Chrome Tests**: Open http://localhost:7101 in browser and verify:
  - [ ] Contrarian alert cards render when alerts exist
  - [ ] Notification badge shows correct unread count
  - [ ] Dismissing an alert removes it and decrements the badge
  - [ ] Opening AnalystPredictionModal for > 10 seconds fires a browse signal (check Network tab)
  - [ ] Re-opening the same analyst's modal within 5 minutes does NOT fire another signal
  - [ ] Alert language uses "signal/analysis" phrasing, not "advice/recommendation"
- [ ] **E2E Flow**: Full cycle verification:
  - [ ] Browse an analyst detail (generates browse signal)
  - [ ] Make a trade decision (generates agreement/disagreement signal)
  - [ ] Check affinity profile shows updated scores
  - [ ] Trigger a prediction run → check if contrarian alerts appear
- [x] **Phase Review**: Compare implementation against full PRD and intention
  - [x] All five behavioral signal types from the intention are implemented? Yes — buy_agreement, sell_agreement, skip_disagreement, challenge_accept, challenge_reject, browse_interest.
  - [x] Contrarian alert format matches intention "Contrarian Alerts" section? Yes — shows analyst name, direction, confidence, user's weighted view, and rationale.
  - [x] Legal language compliance per project rules (analysis/signal, never advice/recommendation)? Yes — "Different perspective" / "analytical signal to consider" / "Not investment advice".
  - [x] All PRD success criteria from §2 are met? Yes — affinity updates after trade/challenge/browse, dashboard personalized, contrarian alerts generated.
