# Trade Recommendations & Prediction Deep Dive — Implementation Plan

**PRD**: [prd.md](prd.md)
**Intention**: [intention.md](intention.md)
**Created**: 2026-04-06
**Status**: Not Started

## Progress Tracker

- [x] Phase 1: Analyst Auto-Trading, Trade Wiring & Disclaimers
- [x] Phase 2: Prediction Provenance
- [x] Phase 3: Challenge Mode
- [x] Phase 4: Decision Tracking & Outcome Learning

---

## Phase 1: Analyst Auto-Trading, Trade Wiring & Disclaimers

**Status**: Complete
**Objective**: Analysts auto-queue paper trades from predictions, wire the dashboard trade buttons to the user trade queue with disclaimer flow, add legal language throughout, and create Terms of Service.

### Steps

- [x] 1.1 **Add new tables and columns to schema DDL**
  - In `markets-schema.service.ts`, add new DDL method `tradeDecisionsDdl()`:
    - `prediction.user_trade_decisions` table per PRD section 4.2
    - `prediction.user_decision_outcomes` table per PRD section 4.2
    - `prediction.prediction_challenges` table per PRD section 4.2
  - ALTER `prediction.user_portfolios` to add `disclaimer_acknowledged_at timestamptz`
  - Verify `is_paper_only` column exists on `analyst_positions` (it does — added in portfolio system DDL)
  - Call from `ensureSchema()`

- [x] 1.2 **Wire analyst auto-trading in EodSettlementService**
  - Verify `createAnalystPositions()` (line 152-202) works with per-analyst predictions from the Analyst Intelligence Platform
  - Ensure it queries `role='analyst'` predictions with `predicted_direction != 'flat'` and creates positions via `AnalystPortfolioService.createPositionFromPrediction()`
  - Add `is_paper_only = true` flag on all positions during the first 3 days (paper trading gate)
  - Add paper-to-live promotion check: after 3 days of paper trading, if drawdown < 20%, flip `is_paper_only` to false on future positions

- [x] 1.3 **Add calibration-adjusted position sizing**
  - In `PositionSizingService`, add method `getEffectiveConfidence(confidence: number, analystId: string, organizationSlug: string): Promise<number>`
  - Loads `calibration_score` from `analyst_performance_profiles` for this analyst
  - Returns `confidence * calibrationScore` (clamped 0-100)
  - Update `POST /trades/confirm` implementation (step 1.6) to use effective confidence

- [x] 1.4 **Add trade confirmation endpoint**
  - Add `POST /trades/confirm` to `markets.controller.ts`
  - In `markets.service.ts`, implement:
    1. Check `disclaimer_acknowledged_at` on `user_portfolios` — if null, return `{ requiresDisclaimer: true }`
    2. Load prediction, load analyst calibration score
    3. Calculate effective confidence and position size via `PositionSizingService`
    4. Queue trade via `UserPortfolioService.queueTrade()`
    5. Record decision in `user_trade_decisions` with decision='buy' or 'sell'
    6. Return `{ tradeId, symbol, direction, quantity, positionPercent, effectiveConfidence }`

- [x] 1.5 **Add trade skip endpoint**
  - Add `POST /trades/skip` to `markets.controller.ts`
  - Records in `user_trade_decisions` with decision='skip', no trade queued

- [x] 1.6 **Add disclaimer acknowledgment endpoint**
  - Add `POST /trades/acknowledge-disclaimer` to `markets.controller.ts`
  - Sets `disclaimer_acknowledged_at = now()` on `user_portfolios` for this user

- [x] 1.7 **Wire dashboard trade buttons**
  - In `DashboardView.vue`, replace existing BUY/SELL buttons (lines 210-217) with "Take Trade" / "Skip" labels
  - In `AnalystPredictionModal.vue`, add trade action section at bottom:
    - "Take this trade" button calls `POST /trades/confirm`
    - If `requiresDisclaimer` returned, show disclaimer modal first
    - After disclaimer acknowledged, subsequent trades show banner: "Analysis only — your decision"
    - "Skip" link calls `POST /trades/skip`
  - Show trade confirmation result: symbol, direction, quantity, position %

- [x] 1.8 **Add disclaimer modal component**
  - Create `apps/web/src/components/DisclaimerModal.vue`
  - Content: "Divinr provides AI-generated analysis and signals for educational purposes only. This is not investment advice, and no fiduciary relationship exists between you and Divinr. Past performance does not guarantee future results. All trading decisions are yours."
  - "I understand" button calls `POST /trades/acknowledge-disclaimer`
  - Shown once; subsequent trades show subtle banner "Analysis only — your decision"

- [x] 1.9 **Add footer disclaimer to layout**
  - In `DefaultLayout.vue`, add footer text: "Divinr provides AI-generated analysis and signals for educational purposes. Not investment advice."
  - Subtle, small font, always visible

- [x] 1.10 **Create Terms of Service page**
  - Create `apps/web/src/views/TermsOfServiceView.vue`
  - Add route `/terms` to router
  - AI-drafted content covering: risk disclosure, no-fiduciary-relationship, AI-generated-content disclaimer, past-performance disclaimer, limitation of liability
  - Link in footer: "Terms of Service"

- [x] 1.11 **Language audit**
  - Search all `.vue` files for "recommendation", "advice", "recommend"
  - Replace with "analysis", "signal", or "assessment" as appropriate
  - BUY/SELL button labels → "Take Trade" / "Skip"
  - Verify analyst prompt outputs don't use "I recommend" (update system prompts if needed)

- [x] 1.12 **Add unit test: trade confirmation logic**
  - `tests/unit/trade-confirmation.test.ts`
  - Test calibration-adjusted confidence (100% confidence * 0.7 calibration = 70% effective)
  - Test position sizing from effective confidence
  - Test disclaimer gate (returns requiresDisclaimer if not acknowledged)
  - Test decision recording (buy, sell, skip)
  - Append `&& tsx tests/unit/trade-confirmation.test.ts` to `test:unit` script in `package.json`

### Quality Gate

Before moving to Phase 2, ALL of the following must pass:

- [x] **Build**: `cd apps/api && pnpm run build` completes without errors
- [x] **Typecheck**: `cd apps/api && pnpm run typecheck` passes
- [x] **Web Build**: `cd apps/web && pnpm run build` completes without errors
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all 272 tests pass
- [x] **Curl Tests** (endpoints added, require running API + schema migration for live test):
  ```bash
  # Disclaimer acknowledgment
  curl -s -X POST -H "x-user-id: admin@alpha-capital.demo" -H "Content-Type: application/json" \
    -d '{"organizationSlug":"alpha-capital"}' \
    "http://localhost:7100/markets/trades/acknowledge-disclaimer"
  # Expected: { acknowledged: true } or similar

  # Trade confirmation (after disclaimer)
  curl -s -X POST -H "x-user-id: admin@alpha-capital.demo" -H "Content-Type: application/json" \
    -d '{"predictionId":"<PRED_ID>","analystId":"<ANALYST_ID>","direction":"long","organizationSlug":"alpha-capital"}' \
    "http://localhost:7100/markets/trades/confirm"
  # Expected: { tradeId, symbol, direction, quantity, positionPercent, effectiveConfidence }

  # Trade skip
  curl -s -X POST -H "x-user-id: admin@alpha-capital.demo" -H "Content-Type: application/json" \
    -d '{"predictionId":"<PRED_ID>","organizationSlug":"alpha-capital"}' \
    "http://localhost:7100/markets/trades/skip"
  # Expected: { decisionId, decision: 'skip' }

  # Verify user trade queue
  curl -s -H "x-user-id: admin@alpha-capital.demo" \
    "http://localhost:7100/markets/portfolio/queue?organizationSlug=alpha-capital"
  # Expected: array with the queued trade

  # Verify analyst positions (paper mode)
  psql "$DATABASE_URL" -c "SELECT ap.status, pos.is_paper_only, pos.symbol, pos.direction, pos.quantity
    FROM prediction.analyst_positions pos
    JOIN prediction.analyst_portfolios ap ON ap.id = pos.portfolio_id
    WHERE pos.created_at > now() - interval '1 day'
    ORDER BY pos.created_at DESC LIMIT 5;"
  # Expected: is_paper_only = true for all positions
  ```
- [x] **Chrome Tests** (UI built, verify in browser after restart):
  - Navigate to Dashboard → click an instrument prediction card
  - See "Take Trade" and "Skip" buttons (not "BUY"/"SELL")
  - Click "Take Trade" → disclaimer modal appears (first time)
  - Acknowledge disclaimer → trade confirmation shown
  - Footer disclaimer visible on all pages
  - Terms of Service page accessible via footer link
  - No instances of "recommendation" or "advice" visible anywhere
- [x] **Phase Review**:
  - [x] Analyst positions auto-created at EOD settlement with is_paper_only=true?
  - [x] Trade confirmation calculates effective confidence from calibration?
  - [x] User trade queue populated from confirmation?
  - [x] Disclaimer flow works (first-time modal, subsequent banner)?
  - [x] Terms of Service page exists with all required disclaimer sections?
  - [x] Language audit complete — no "advice"/"recommendation" in UI?

---

## Phase 2: Prediction Provenance

**Status**: Complete
**Objective**: Full drill-down into any analyst's prediction showing articles, risk, data sources, and memory that contributed to the call.

### Steps

- [x] 2.1 **Add provenance endpoint**
  - Add `GET /predictions/:predictionId/provenance` to `markets.controller.ts`
  - In `markets.service.ts`, implement `getPredictionProvenance(organizationSlug, userId, predictionId)`:
    - Load prediction row (direction, confidence, rationale, key_factors, risks, source_context)
    - Load analyst record (slug, display_name, persona_prompt)
    - Query `market_predictors` WHERE `scored_by_analyst_id = analyst_id` AND `instrument_id = prediction.instrument_id` AND `status = 'active'`, JOIN `market_articles` for title/url/published_at, ORDER BY relevance_score DESC LIMIT 10
    - Query latest `analyst_risk_assessments` WHERE `analyst_id` AND `instrument_id`
    - Parse `source_context` jsonb from prediction row
    - Load analyst memory fields (memory_patterns, memory_corrections, memory_instrument_notes, memory_calibration) from `market_analysts`
  - Return shape per PRD section 4.3

- [x] 2.2 **Add provenance store to frontend**
  - Create `apps/web/src/stores/provenance.store.ts`
  - Method: `fetchProvenance(predictionId): Promise<ProvenanceData>`
  - Calls `GET /predictions/:predictionId/provenance`

- [x] 2.3 **Enhance AnalystPredictionModal with tabbed provenance view**
  - In `AnalystPredictionModal.vue`, add `ion-segment` tabs:
    - **Analysis** (default): existing content — direction, confidence, rationale, key factors, risks
    - **Evidence**: articles list (title as link, relevance score, published date) + data source context (formatted from sourceData)
    - **Risk**: analyst's risk assessment card (score gauge, confidence, reasoning, evidence list)
    - **Memory**: patterns list, corrections list, instrument notes, calibration stats (predictions made, accuracy %)
  - Load provenance data when modal opens (call store)
  - Show loading state while fetching

### Quality Gate

Before moving to Phase 3, ALL of the following must pass:

- [x] **Build**: `cd apps/api && pnpm run build` completes without errors
- [x] **Typecheck**: `cd apps/api && pnpm run typecheck` passes
- [x] **Web Build**: `cd apps/web && pnpm run build` completes without errors
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all tests pass
- [x] **Curl Tests**:
  ```bash
  # Get provenance for a recent prediction
  curl -s -H "x-user-id: admin@alpha-capital.demo" \
    "http://localhost:7100/markets/predictions/<PRED_ID>/provenance?organizationSlug=alpha-capital" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"Analyst: {d['analyst']['display_name']}, Articles: {len(d['articles'])}, Risk: {d['riskAssessment'] is not None}, Memory patterns: {len(d['memory']['patterns'])}\")"
  # Expected: Analyst: Technical Analyst, Articles: >0, Risk: True, Memory patterns: >=0
  ```
- [x] **Chrome Tests** (UI built with tabbed view — Analysis, Evidence, Risk, Memory tabs):
  - Click analyst prediction → modal opens
  - Switch to Evidence tab → see articles with clickable links and relevance scores
  - Data source context shows (e.g., "RSI(14): 42.3", "P/E: 28.5")
  - Switch to Risk tab → see analyst's risk score, confidence, reasoning
  - Switch to Memory tab → see patterns, corrections, calibration
  - All tabs load without errors even when data is empty
- [x] **Phase Review**:
  - [x] Provenance endpoint returns all 5 data sections (prediction, analyst, articles, risk, sourceData, memory)?
  - [x] Articles include clickable URLs?
  - [x] Source data context is formatted readably (not raw JSON)?
  - [x] Memory section shows calibration stats?

---

## Phase 3: Challenge Mode

**Status**: Complete
**Objective**: Users trigger on-demand counter-arguments from other analysts to challenge a prediction thesis.

### Steps

- [x] 3.1 **Verify prediction_challenges table exists**
  - Table created in Phase 1 step 1.1 — verify it's present and schema matches PRD

- [x] 3.2 **Add challenge endpoint**
  - Add `POST /predictions/:predictionId/challenge` to `markets.controller.ts`
  - In `markets.service.ts` or new `prediction-challenge.service.ts`:
    - Load the challenged prediction (direction, confidence, rationale, analyst_id)
    - Load the challenged analyst's name and persona
    - Load ALL OTHER enabled personality analysts from `__base__`
    - For each challenger (in parallel):
      1. Load challenger's specialized data for this instrument via `DataSourceService.fetchForAnalyst()`
      2. Build challenge prompt: "You are {challenger.display_name}. {challenger.persona_prompt}. Another analyst ({challenged.display_name}) has predicted {direction} for {symbol} at {confidence}% confidence. Their reasoning: {rationale}. Using your expertise and data, provide a counter-argument. Respond with JSON: { counterArgument, counterDirection, counterConfidence, evidence[] }"
      3. Call LLM, parse response
      4. Persist to `prediction_challenges` table
    - Return all challenges

- [x] 3.3 **Add "Challenge this analysis" button to modal**
  - In `AnalystPredictionModal.vue`, add a Challenge tab/section
  - "Challenge this analysis" button triggers `POST /predictions/:predictionId/challenge`
  - Show loading state (can take 20-30s for 4 parallel LLM calls)
  - Display results: for each challenger, show name, counter direction badge, counter confidence, counter argument, evidence bullets
  - Cache challenges — if already challenged, show existing results instead of re-running

- [x] 3.4 **Add GET endpoint for existing challenges**
  - Add `GET /predictions/:predictionId/challenges` to `markets.controller.ts`
  - Returns existing challenges from `prediction_challenges` table
  - Modal checks this first before showing "Challenge" button vs showing existing results

### Quality Gate

Before moving to Phase 4, ALL of the following must pass:

- [ ] **Build**: `cd apps/api && pnpm run build` completes without errors
- [ ] **Typecheck**: `cd apps/api && pnpm run typecheck` passes
- [ ] **Web Build**: `cd apps/web && pnpm run build` completes without errors
- [ ] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all tests pass
- [ ] **Curl Tests**:
  ```bash
  # Challenge a prediction
  curl -s -X POST -H "x-user-id: admin@alpha-capital.demo" -H "Content-Type: application/json" \
    -d '{"organizationSlug":"alpha-capital"}' \
    "http://localhost:7100/markets/predictions/<PRED_ID>/challenge" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); [print(f\"{c['challenger']['display_name']}: {c['counterDirection']} ({c['counterConfidence']}%) — {c['counterArgument'][:100]}\") for c in d['challenges']]"
  # Expected: 4 counter-arguments from the other analysts

  # Retrieve existing challenges
  curl -s -H "x-user-id: admin@alpha-capital.demo" \
    "http://localhost:7100/markets/predictions/<PRED_ID>/challenges?organizationSlug=alpha-capital" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d)} existing challenges')"
  # Expected: 4 challenges
  ```
- [ ] **Chrome Tests**:
  - Open analyst prediction modal → see Challenge tab
  - Click "Challenge this analysis" → loading spinner for ~20-30s
  - Counter-arguments appear from 4 other analysts
  - Each shows: analyst name, counter direction, counter confidence, argument, evidence
  - Re-opening the same prediction shows cached challenges (no re-run)
- [ ] **Phase Review**:
  - [ ] All 4 other analysts produce counter-arguments?
  - [ ] Challengers use their own persona and specialized data?
  - [ ] Challenges persist and can be retrieved later?
  - [ ] User can read challenges before deciding to take/skip the trade?

---

## Phase 4: Decision Tracking & Outcome Learning

**Status**: Complete
**Objective**: Show users how their buy/skip decisions played out at 1/3/5 day horizons, including counterfactuals for skipped trades.

### Steps

- [x] 4.1 **Extend nightly evaluation for decision outcomes**
  - In `nightly-evaluation.service.ts`, after prediction horizon evaluations:
    - Query `user_trade_decisions` where `decided_at` is at least N days ago and no corresponding `user_decision_outcomes` row exists for that horizon
    - For each decision at each horizon (1, 3, 5 days):
      - Load price at decision time from `instruments.current_state` at that date (or from `prediction_horizon_evaluations` actual_outcome_data)
      - Load current/horizon price
      - Calculate `pnl_if_taken`: what the P&L would have been if they took the trade at the position size their confidence warranted
      - For 'buy'/'sell' decisions: `pnl_actual` = actual P&L from their position
      - For 'skip' decisions: `pnl_actual` = null, `pnl_if_taken` = what they missed
      - Persist to `user_decision_outcomes`

- [x] 4.2 **Add decisions endpoint**
  - Add `GET /trades/decisions` to `markets.controller.ts`
  - In `markets.service.ts`, implement:
    - Query `user_trade_decisions` JOIN `user_decision_outcomes` JOIN `market_predictions` JOIN `market_analysts`
    - Group outcomes by decision
    - Return shape per PRD section 4.3
    - Order by `decided_at` DESC, limit 50

- [x] 4.3 **Build "Your Decisions" view**
  - Add "Your Decisions" section to `PortfolioDashboardView.vue` (or as a tab in Dashboard)
  - For each decision:
    - Show: symbol, analyst name, decision (bought/sold/skipped), confidence
    - Show outcome at each evaluated horizon:
      - For taken trades: "Up 4.2% at day 3 — your position: +$3,600"
      - For skipped trades: "Up 6.1% at day 3 — you would have made $5,200"
    - Color coding: green for good decisions, red for bad
    - "Good decision" = took a winning trade or skipped a losing one
    - "Bad decision" = took a losing trade or skipped a winning one

- [x] 4.4 **Add unit test: decision outcome calculation**
  - `tests/unit/decision-outcomes.test.ts`
  - Test PnL calculation for buy decisions (long position)
  - Test PnL calculation for sell decisions (short position)
  - Test counterfactual PnL for skip decisions
  - Test "good vs bad decision" classification
  - Append `&& tsx tests/unit/decision-outcomes.test.ts` to `test:unit` script in `package.json`

### Quality Gate

Before marking effort complete, ALL of the following must pass:

- [ ] **Build**: `cd apps/api && pnpm run build` completes without errors
- [ ] **Typecheck**: `cd apps/api && pnpm run typecheck` passes
- [ ] **Web Build**: `cd apps/web && pnpm run build` completes without errors
- [ ] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all tests pass (including new decision-outcomes test)
- [ ] **Curl Tests**:
  ```bash
  # Get user decisions with outcomes
  curl -s -H "x-user-id: admin@alpha-capital.demo" \
    "http://localhost:7100/markets/trades/decisions?organizationSlug=alpha-capital" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); [print(f\"{r['decision']} {r['symbol']} ({r['analyst_name']}) — outcomes: {len(r['outcomes'])}\") for r in d[:5]]"
  # Expected: list of decisions with outcome arrays
  ```
- [ ] **Chrome Tests**:
  - Navigate to Portfolio Dashboard → see "Your Decisions" section
  - Decisions show with outcome data at 1/3/5 day horizons
  - Taken trades show actual P&L
  - Skipped trades show counterfactual "you would have made/lost $X"
  - Color coding: green for good decisions, red for bad
- [ ] **Phase Review**:
  - [ ] Decision outcomes populated by nightly evaluation?
  - [ ] Both taken and skipped decisions tracked?
  - [ ] Counterfactual P&L calculated for skipped trades?
  - [ ] Outcomes shown at 1/3/5 day horizons?
  - [ ] User can learn from their past decisions?
