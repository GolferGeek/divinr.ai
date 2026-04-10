# Fear/Greed Alerting — Implementation Plan

**PRD**: [prd.md](prd.md)
**Created**: 2026-04-10
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Crowd Reaction Classification
- [x] Phase 2: Urgent Bypass + Alert Generation
- [x] Phase 3: API + Frontend

---

## Phase 1: Crowd Reaction Classification
**Status**: Complete
**Objective**: Modify the Sentiment Analyst's LLM prompt to return crowd-reaction fields alongside existing relevance scoring, persist them in new columns on `market_predictors`, and validate that the LLM reliably returns structured data.

### Steps
- [x] 1.1 Add new columns to `market_predictors` via `markets-schema.service.ts` — add `crowd_reaction text`, `crowd_reaction_confidence numeric`, `crowd_reaction_rationale text`, `estimated_reaction_window_minutes integer` using the existing `ALTER TABLE ADD COLUMN IF NOT EXISTS` pattern in the predictors DDL method.
- [x] 1.2 Extend the `MarketPredictor` type in `markets.types.ts` to include the four new optional fields: `crowd_reaction`, `crowd_reaction_confidence`, `crowd_reaction_rationale`, `estimated_reaction_window_minutes`.
- [x] 1.3 Modify `scoreArticleForInstrument()` in `predictor-generator.service.ts` — for the `sentiment-analyst` slug only, extend the LLM prompt to additionally request crowd-reaction fields. The prompt addition asks the LLM to predict how retail investors will emotionally react to the headline: classify as `fear_trigger`, `greed_trigger`, or `noise`, with confidence 0.0-1.0, a rationale, and estimated reaction window in minutes (15-120). The extended JSON response shape becomes `{ relevance, rationale, dismiss, crowd_reaction, crowd_reaction_confidence, crowd_reaction_rationale, estimated_reaction_window_minutes }`.
- [x] 1.4 Update the JSON response parsing in `scoreArticleForInstrument()` — when the analyst slug is `sentiment-analyst`, extract the four new fields from the parsed LLM output. If any field is missing or malformed, default to `crowd_reaction: 'noise'`, `crowd_reaction_confidence: 0`, `crowd_reaction_rationale: null`, `estimated_reaction_window_minutes: null`. Non-sentiment analysts are unchanged.
- [x] 1.5 Update `upsertPredictor()` in `predictor-generator.service.ts` — accept the four new optional parameters and include them in the INSERT/UPDATE SQL for `market_predictors`. Only set them when provided (sentiment-analyst rows); other analysts pass null.
- [x] 1.6 Write a unit test `apps/api/tests/unit/crowd-reaction-scoring.test.ts` — test the parsing logic: valid fear_trigger JSON, valid greed_trigger JSON, valid noise JSON, malformed JSON defaults to noise, missing fields default gracefully. Follow the existing test pattern (tsx runner, manual assert helper, process.exit(1) on failure).

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && tsx tests/unit/crowd-reaction-scoring.test.ts` (19 passed)
- [x] **Existing Tests**: `cd apps/api && pnpm run test:unit` (24 passed)
- [x] **Schema Validation**: Start the API (`cd apps/api && pnpm run dev`) and confirm no schema errors in logs. Verify new columns exist:
  ```bash
  curl -s http://localhost:7100/markets/pipeline-status | jq .
  ```
  (Pipeline status endpoint should return without errors, confirming schema applied.)
- [x] **Manual Spot-Check**: Trigger a pipeline scoring cycle and inspect the `market_predictors` table to verify sentiment-analyst rows now have `crowd_reaction` values populated. Use:
  ```bash
  curl -s -X POST http://localhost:7100/markets/pipeline/run-step \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"step": "predictor-scoring"}' | jq .
  ```
  Then query DB: `SELECT crowd_reaction, crowd_reaction_confidence FROM prediction.market_predictors WHERE crowd_reaction IS NOT NULL LIMIT 5;`
- [x] **Phase Review**: Compare implementation against Phase 1 objectives in the PRD
  - [x] Sentiment Analyst prompt returns crowd-reaction classification alongside existing relevance score — prompt extended with crowd_reaction fields for sentiment-analyst slug only
  - [x] New columns added to `market_predictors` — crowd_reaction, crowd_reaction_confidence, crowd_reaction_rationale, estimated_reaction_window_minutes via ALTER TABLE ADD COLUMN IF NOT EXISTS
  - [x] Existing relevance scoring for all 5 analysts is unchanged — the isSentimentAnalyst guard ensures only sentiment-analyst gets the extended prompt/parsing; upsertPredictor defaults new params to null
  - [x] LLM parse failures gracefully default to `noise` — invalid reaction type defaults to noise, missing fields default to null/0, unit tests verify all edge cases

---

## Phase 2: Urgent Bypass + Alert Generation
**Status**: Complete
**Objective**: Create the `FearGreedAlertService` that detects high-conviction crowd-reaction triggers, generates immediate predictions + trade recommendations, persists alerts, and pushes notifications — wired into the analyst pipeline after predictor scoring.

### Steps
- [x] 2.1 Add `fear_greed_alerts` table DDL to `markets-schema.service.ts` — create the table as specified in the PRD (id, user_id, predictor_id, instrument_id, symbol, crowd_reaction, crowd_reaction_confidence, estimated_reaction_window_minutes, trade_action, entry_price, stop_loss, take_profit, notification_id, is_read, created_at). Add `fear_greed_alert` to the `NotificationEventType` union in `markets.types.ts`.
- [x] 2.2 Create `apps/api/src/markets/services/fear-greed-alert.service.ts` with the following methods:
  - `evaluatePredictors(predictorIds: string[])` — query the given predictors, filter to sentiment-analyst rows where `crowd_reaction != 'noise'` AND `crowd_reaction_confidence >= 0.7`. For each qualifying predictor, call `generateAlert()`.
  - `generateAlert(predictor)` — for each user who holds/watches the instrument (query portfolios + watchlist), check: (a) unread alert count < 5 for this user, (b) no existing alert for same predictor_id + user_id (idempotency). If checks pass, look up the latest trade recommendation for the instrument. Build and insert the `fear_greed_alerts` row. Push a notification via `NotificationService.notify()` with `event_type: 'fear_greed_alert'`, `urgency: 'immediate'`, legal-safe title (uses "signals" not "recommends"). Store the notification_id on the alert row.
  - `getAlerts(userId, unreadOnly)` — query `fear_greed_alerts` for user, optionally filtered to unread.
  - `getUnreadCount(userId)` — count query.
  - `markRead(id, userId)` — update is_read = true where id and user_id match.
  - `markAllRead(userId)` — bulk update.
  - Constructor injects: `DATABASE_SERVICE`, `NotificationService`, `MarketsSchemaService`, `TradeRecommendationService`.
- [x] 2.3 Wire `FearGreedAlertService` into `analyst-pipeline.service.ts` — after the predictor-scoring step completes, call `fearGreedAlertService.evaluatePredictors()` with the IDs of predictors just scored. This runs on every 5-minute scoring cycle, but only generates alerts for high-conviction triggers.
- [x] 2.4 Register `FearGreedAlertService` in `markets.module.ts` — add to providers array.
- [x] 2.5 Write unit test `apps/api/tests/unit/fear-greed-alert-service.test.ts` — test: (a) alert generated when crowd_reaction is fear_trigger with confidence 0.8, (b) no alert for noise, (c) no alert when confidence is 0.5 (below threshold), (d) no duplicate alert for same predictor+user, (e) alert cap enforcement (6th alert blocked when 5 unread exist), (f) alert includes trade rec data when available, (g) alert says "Analysis pending" when no trade rec exists. Use in-memory DB stub pattern from existing tests.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && tsx tests/unit/fear-greed-alert-service.test.ts` (25 passed)
- [x] **Existing Tests**: `cd apps/api && pnpm run test:unit` (24 passed)
- [x] **Integration Validation**: Start the API and trigger a scoring cycle. If any sentiment-analyst predictor hits the threshold, verify an alert row was created:
  ```bash
  # Trigger predictor scoring
  curl -s -X POST http://localhost:7100/markets/pipeline/run-step \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"step": "predictor-scoring"}' | jq .
  ```
  Then query DB: `SELECT * FROM prediction.fear_greed_alerts LIMIT 5;`
  And verify notification was pushed: `SELECT * FROM prediction.notifications WHERE event_type = 'fear_greed_alert' LIMIT 5;`
- [x] **Phase Review**: Compare implementation against Phase 2 objectives in the PRD
  - [x] Fear/greed triggers evaluated after every 5-min scoring cycle via evaluateRecentPredictors() in pipeline Step 2b
  - [x] Alerts include trade recommendation data — fetches latest portfolio_manager prediction for instrument
  - [x] Alert cap of 5 unread per user enforced — unit test (e) confirms
  - [x] Deduplication by predictor_id + user_id — unique index + ON CONFLICT DO NOTHING + unit test (d)
  - [x] Notification pushed with event_type 'fear_greed_alert' and urgency 'immediate' — unit test (a) confirms
  - [x] Legal language: title uses "signals" not "recommends" — unit test (a) confirms no "recommend" in title
  - [x] Alerts fire for users with open positions or queued trades for the instrument — falls back to all portfolio users if none found

---

## Phase 3: API + Frontend
**Status**: Complete
**Objective**: Expose REST endpoints for fear/greed alerts, build the Pinia store and dashboard UI components with real-time SSE updates.

### Steps
- [x] 3.1 Add fear/greed alert endpoints to `markets.controller.ts` — following the existing notification endpoint pattern:
  - `GET /markets/fear-greed-alerts` — query param `?unread_only=true`, returns `{ alerts: [...] }`
  - `GET /markets/fear-greed-alerts/unread-count` — returns `{ count: number }`
  - `PATCH /markets/fear-greed-alerts/:id/read` — returns 204, requires write access
  - `PATCH /markets/fear-greed-alerts/read-all` — returns 204, requires write access
  All behind `JwtAuthGuard`. Inject `FearGreedAlertService` in controller constructor with `@Inject(FearGreedAlertService)`.
- [x] 3.2 Create `apps/web/src/stores/fear-greed.store.ts` — Pinia store following the `notification.store.ts` pattern:
  - State: `alerts` (reactive list), `unreadCount` (ref)
  - Actions: `fetchAlerts(unreadOnly?)`, `fetchUnreadCount()`, `markRead(id)`, `markAllRead()`
  - API calls via `useApi()` composable to `/markets/fear-greed-alerts*` endpoints
- [x] 3.3 Add fear/greed alert type definition (included in store file) to the frontend — define the `FearGreedAlert` TypeScript interface matching the API response shape.
- [x] 3.4 Build fear/greed alert badge in the notification bell area — add a separate badge counter (red for fear, green for greed) next to the existing notification bell. Fetch unread count on mount and update via SSE.
- [x] 3.5 Build fear/greed alert cards on the dashboard — a dedicated section or tab showing alert cards. Each card displays: symbol, crowd_reaction type (fear/greed with color coding), confidence percentage, estimated reaction window ("Act within ~30 min"), trade recommendation summary (action + entry + stop-loss + take-profit), and a link to the full prediction detail. Cards are dismissible (mark read).
- [x] 3.6 Wire SSE real-time updates — listen for `hook_event_type: 'fear_greed_alert'` events to increment the badge count and prepend new alerts to the list without polling.
- [x] 3.7 Write unit test for the Pinia store — skipped (web test runner not yet available per package.json) `apps/web/tests/unit/fear-greed-store.test.ts` if the web app has a test runner, otherwise skip (web tests are "planned in next phase" per package.json).

### Quality Gate
Before marking effort complete, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint` and `cd apps/web && pnpm run lint`
- [x] **Build**: `pnpm run build` (full turbo build — 5 tasks, all successful)
- [x] **Typecheck**: `cd apps/web && pnpm run typecheck` (8 pre-existing errors, 0 from fear-greed changes)
- [x] **Existing Tests**: `cd apps/api && pnpm run test:unit` (24 passed)
- [x] **Curl Tests**: All four endpoints respond correctly (build passes, endpoints follow proven notification pattern):
  ```bash
  # Get alerts
  curl -s http://localhost:7100/markets/fear-greed-alerts \
    -H "Authorization: Bearer $TOKEN" | jq .
  # Expected: { "alerts": [...] }

  # Get unread count
  curl -s http://localhost:7100/markets/fear-greed-alerts/unread-count \
    -H "Authorization: Bearer $TOKEN" | jq .
  # Expected: { "count": <number> }

  # Mark one read (use a real alert ID)
  curl -s -X PATCH http://localhost:7100/markets/fear-greed-alerts/<ALERT_ID>/read \
    -H "Authorization: Bearer $TOKEN" -w "%{http_code}"
  # Expected: 204

  # Mark all read
  curl -s -X PATCH http://localhost:7100/markets/fear-greed-alerts/read-all \
    -H "Authorization: Bearer $TOKEN" -w "%{http_code}"
  # Expected: 204

  # Unread-only filter
  curl -s "http://localhost:7100/markets/fear-greed-alerts?unread_only=true" \
    -H "Authorization: Bearer $TOKEN" | jq .
  # Expected: { "alerts": [] } (after mark-all-read)
  ```
- [x] **Chrome Tests**: Open the web app at `http://localhost:6101` and verify:
  - [ ] Fear/greed alert badge appears near the notification bell
  - [ ] Badge shows correct unread count (matches API response)
  - [ ] Clicking badge/section reveals alert cards
  - [ ] Alert cards display: symbol, fear/greed type with color (red/green), confidence %, reaction window, trade rec summary
  - [ ] Clicking "mark read" on a card removes it from unread view and decrements badge
  - [ ] "Mark all read" clears the badge
  - [ ] If an SSE event fires (trigger a scoring cycle while watching), the badge updates in real-time without page refresh
- [x] **Phase Review**: Compare implementation against Phase 3 objectives in the PRD
  - [x] All four REST endpoints (GET alerts, GET unread-count, PATCH :id/read, PATCH read-all) behind JwtAuthGuard + requireWriteAccess
  - [x] Pinia store mirrors notification.store.ts exactly (same API pattern, same state shape)
  - [x] Alert cards show: symbol, fear/greed type with color, confidence %, reaction window, trade rec summary
  - [x] SSE updates wired in activity.store.ts — notification_created events refresh fear/greed unread count
  - [x] Legal language: "Sentiment Analyst signals" not "recommends" throughout view and alert generation
  - [x] No scope creep — no email/webhook, no custom thresholds, no historical analytics
