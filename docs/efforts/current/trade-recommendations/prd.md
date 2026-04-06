# Trade Recommendations & Prediction Deep Dive — Product Requirements Document

## 1. Overview

Complete the user decision flow from analysis to action. Analysts auto-trade their own predictions (building a verifiable track record), users drill into prediction provenance and challenge the thesis before committing, and every decision — taken or skipped — is tracked against outcomes for learning.

This effort has three interconnected parts:
- **Trade system**: analysts auto-trade, users confirm trades, EOD settlement executes
- **Prediction deep dive**: provenance drill-down + on-demand challenge mode
- **Decision tracking**: outcome feedback on every buy/skip decision
- **Legal protection**: disclaimers and "analysis" language throughout

## 2. Goals & Success Criteria

### Goals
1. Analysts auto-queue trades from their predictions — their P&L becomes their track record
2. Users can drill into any analyst prediction to see the full reasoning chain (articles, risk, data sources, memory)
3. Users can challenge any prediction and see counter-arguments from other analysts
4. Users confirm or skip trades, and see outcome feedback at 1/3/5 day horizons
5. All trade-related UI uses "analysis" and "signal" language with appropriate disclaimers

### Success Criteria
- [ ] Each analyst auto-queues a position when they make a non-flat prediction
- [ ] Analyst portfolios run in paper mode for 3 days before transitioning to live positions
- [ ] Existing analyst leaderboard reflects auto-traded positions (P&L, win rate)
- [ ] Clicking an analyst prediction shows: articles scored, risk assessment, data source context, memory
- [ ] "Challenge this" produces counter-arguments from all other enabled analysts (currently 4)
- [ ] User can confirm a trade from the prediction detail view
- [ ] Position sizing incorporates both confidence and analyst calibration accuracy
- [ ] User trade queue shows pending trades with cancel option
- [ ] Decision outcome view shows "you bought/skipped X — here's what happened" at each horizon
- [ ] First-time trade flow includes disclaimer acknowledgment
- [ ] AI-drafted Terms of Service with securities disclaimers (risk disclosure, no-fiduciary, AI-generated-content, past-performance)
- [ ] No instance of "advice" or "recommendation" in UI copy — only "analysis" and "signal"

## 3. User Stories / Use Cases

### UC1: Analyst Track Record
As a user, I see each analyst's portfolio performance on the leaderboard — P&L, win rate, current balance. Technical Analyst is up 8% this month; Macro Strategist is down 2%. This helps me decide which analysts to trust.

### UC2: Prediction Provenance
As a user, I click on Technical Analyst's bullish MSFT call and see: the 3 articles they scored highest (with links), their RSI/MACD data showing oversold conditions, their risk assessment (score 35, low risk), and their memory noting "MSFT bounced off 200 SMA last 3 times."

### UC3: Challenge Before Committing
As a user, I like Technical Analyst's call but want to hear the downside. I click "Challenge this" and see Fundamentals Analyst respond "P/E at 35x with decelerating revenue growth — overvalued" and Macro Strategist respond "yield curve inversion historically precedes tech selloffs."

### UC4: Confirm Trade
As a user, after reviewing provenance and challenges, I click "Take this trade." The system calculates position size based on the arbitrator's confidence and calibration accuracy, shows me the details, I confirm, and it goes into my trade queue for EOD settlement.

### UC5: Decision Outcome Learning
As a user, I see a "Your Decisions" section showing: "You bought MSFT 3 days ago based on Technical Analyst (75% confidence) — MSFT is up 4.2%. Your position: +$3,600." And: "You skipped AAPL despite Fundamentals Analyst at 80% — AAPL is up 6.1%. You would have made $5,200."

### UC6: Disclaimer Flow
As a first-time user clicking "Take this trade," I see a one-time acknowledgment: "Divinr provides analysis and signals, not investment advice. All trading decisions are yours. I understand." After acknowledging, subsequent trades show a subtle reminder.

## 4. Technical Requirements

### 4.1 Architecture

**Current flow (stops at prediction):**
```
Pipeline → Predictions → Dashboard shows direction/confidence → Manual BUY/SELL (not wired)
```

**Target flow (analysis → action → learning):**
```
Pipeline → Predictions → Analyst auto-trades (background)
                       → User sees prediction
                       → Drills into provenance (articles, risk, data, memory)
                       → Challenges thesis (other analysts counter-argue)
                       → Confirms trade or skips
                       → EOD settlement executes
                       → 1/3/5 day outcome feedback on decisions
```

**Key architectural notes:**
- The BUY/SELL buttons in `DashboardView.vue` (lines 210-217) exist but have no click handlers. The `user_trade_queue` system exists but is not connected to the prediction UI. This effort wires them together through the prediction detail view.
- **Portfolio manager simplification:** The intention mentioned a portfolio manager agent generating recommendations. After analysis, the arbitrator already synthesizes all analyst predictions into a single direction + confidence. Adding a separate portfolio manager agent would be an unnecessary indirection. Instead, users act directly on the arbitrator's synthesis (informed by individual analyst drill-downs). The position sizing service already converts confidence → position size.
- **Analyst trade timing:** Analyst positions are created at EOD settlement (existing `createAnalystPositions()` pattern), not at prediction time. This matches the EOD settlement model and avoids intraday position management.
- **Paper trading gate:** Analyst portfolios start in paper mode. After 3 days, paper results are compared against what live would have produced. If paper P&L is non-catastrophic (drawdown < 20%), positions transition to live. The existing `is_paper` flag on positions and `paper_config_version_id` on analysts support this.

### 4.2 Data Model Changes

#### New table: `prediction.prediction_challenges`
```sql
CREATE TABLE prediction.prediction_challenges (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  prediction_id text NOT NULL,
  challenged_analyst_id text NOT NULL,
  challenger_analyst_id text NOT NULL,
  organization_slug text NOT NULL,
  instrument_id text NOT NULL,
  counter_argument text NOT NULL,
  counter_direction text CHECK (counter_direction IN ('up', 'down', 'flat')),
  counter_confidence numeric,
  evidence jsonb DEFAULT '[]',
  model_provider text,
  model_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prediction_challenges_prediction_idx ON prediction.prediction_challenges (prediction_id);
```

#### New table: `prediction.user_trade_decisions`
```sql
CREATE TABLE prediction.user_trade_decisions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL,
  organization_slug text NOT NULL,
  prediction_id text NOT NULL,
  instrument_id text NOT NULL,
  symbol text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('buy', 'sell', 'skip')),
  based_on_analyst_id text,
  trade_queue_id text,
  confidence_at_decision numeric,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, prediction_id)
);
CREATE INDEX prediction_user_decisions_user_idx ON prediction.user_trade_decisions (user_id, organization_slug);
```

#### New table: `prediction.user_decision_outcomes`
```sql
CREATE TABLE prediction.user_decision_outcomes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  decision_id text NOT NULL REFERENCES prediction.user_trade_decisions(id),
  horizon_days integer NOT NULL,
  price_at_decision numeric NOT NULL,
  price_at_horizon numeric,
  actual_direction text CHECK (actual_direction IN ('up', 'down', 'flat')),
  pnl_if_taken numeric,
  pnl_actual numeric,
  evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prediction_decision_outcomes_decision_idx ON prediction.user_decision_outcomes (decision_id);
```

#### New column on `prediction.user_portfolios`
```sql
ALTER TABLE prediction.user_portfolios
  ADD COLUMN IF NOT EXISTS disclaimer_acknowledged_at timestamptz;
```

### 4.3 API Changes

#### New endpoints:

**GET /predictions/:predictionId/provenance**
Returns full provenance for a single analyst prediction:
```typescript
{
  prediction: { id, direction, confidence, rationale, key_factors, risks, created_at },
  analyst: { id, slug, display_name, persona_prompt },
  articles: Array<{ id, title, url, relevance_score, rationale, published_at }>,
  riskAssessment: { score, confidence, reasoning, evidence } | null,
  sourceData: Record<string, { name, dataTypes, charCount }>,
  memory: { patterns, corrections, instrumentNotes, calibration },
}
```
Source data:
- `articles`: query `market_predictors` WHERE `scored_by_analyst_id` = analyst AND `instrument_id` = instrument, JOIN `market_articles`
- `riskAssessment`: query `analyst_risk_assessments` WHERE `analyst_id` = analyst AND `instrument_id` = instrument, latest
- `sourceData`: from `source_context` jsonb on the prediction row
- `memory`: from `market_analysts` memory fields for this analyst

**POST /predictions/:predictionId/challenge**
Triggers other analysts to counter-argue the given prediction. Body: `{ organizationSlug }`.
Returns:
```typescript
{
  challenges: Array<{
    challenger: { id, slug, display_name },
    counterArgument: string,
    counterDirection: 'up' | 'down' | 'flat',
    counterConfidence: number,
    evidence: string[],
  }>
}
```
Implementation: loads the prediction + analyst, loads all OTHER enabled personality analysts, for each builds a challenge prompt with their persona + specialized data, calls LLM, persists to `prediction_challenges`, returns results.

**POST /trades/confirm**
User confirms a trade. Body:
```typescript
{
  predictionId: string,
  analystId: string,
  direction: 'long' | 'short',
  organizationSlug: string,
}
```
Implementation:
1. Check disclaimer acknowledged (if not, return `{ requiresDisclaimer: true }`)
2. Load prediction confidence, load arbitrator confidence, load analyst calibration score from `analyst_performance_profiles`
3. Adjust effective confidence: `effectiveConfidence = confidence * calibrationScore` (well-calibrated analysts get full credit; overconfident analysts get reduced position sizes)
4. Calculate position size from effective confidence + user portfolio balance via `PositionSizingService`
5. Queue trade via `UserPortfolioService.queueTrade()`
6. Record decision in `user_trade_decisions` with decision='buy'/'sell'
7. Return trade details including position size and reasoning

**POST /trades/skip**
User explicitly skips a trade. Body: `{ predictionId, organizationSlug }`.
Records in `user_trade_decisions` with decision='skip'.

**POST /trades/acknowledge-disclaimer**
User acknowledges the first-time disclaimer. Sets `disclaimer_acknowledged_at` on `user_portfolios`.

**GET /trades/decisions**
Returns user's trade decisions with outcome data for the teaching view:
```typescript
Array<{
  decision: 'buy' | 'sell' | 'skip',
  symbol: string,
  analyst_name: string,
  confidence: number,
  decided_at: string,
  outcomes: Array<{
    horizon_days: number,
    actual_direction: string,
    pnl_if_taken: number | null,
    pnl_actual: number | null,
  }>
}>
```

#### Modified behavior:

**EodSettlementService.createAnalystPositions()** — already exists (line 152-202). Currently finds today's predictions and creates positions. Verify it works with the per-analyst prediction system. The method queries `role='analyst'` predictions with `predicted_direction != 'flat'` — this should work as-is.

**NightlyEvaluationService** — extend to evaluate user decisions at each horizon window. After evaluating predictions, also populate `user_decision_outcomes` for decisions that have reached their horizon.

### 4.4 Frontend Changes

#### Prediction Detail Modal (enhance `AnalystPredictionModal.vue`)
Currently shows: analyst name, direction, confidence, rationale, key factors, risks.

Add tabs/sections:
- **Analysis** (existing): direction, confidence, rationale, key factors, risks
- **Evidence**: articles scored by this analyst (title, link, relevance score), data source context (RSI, P/E, etc.)
- **Risk View**: this analyst's risk assessment (score, confidence, reasoning)
- **Memory**: analyst's learned patterns, recent corrections, calibration stats
- **Challenge**: "Challenge this analysis" button → shows counter-arguments from other analysts

#### Trade Confirmation Flow (in prediction detail modal)
After reviewing analysis + challenges:
- "Take this trade" button → shows position size calculation → confirm
- First time: disclaimer modal ("This is analysis, not investment advice. All decisions are yours.")
- Subsequent: subtle banner "Analysis only — your decision"
- "Skip" link records the skip for outcome tracking

#### Decision Outcomes View (new section in Portfolio Dashboard or Dashboard)
- List of recent decisions with outcomes at 1/3/5 days
- Color-coded: green for good decisions, red for bad
- Shows both "you took" and "you skipped" outcomes
- Counterfactual: "if you had taken this, you'd be up/down $X"

#### Disclaimer Footer
- Every page: "Divinr provides AI-generated analysis and signals for educational purposes. Not investment advice."
- Trade-related pages: slightly more prominent version

#### Language Audit
- Replace any instance of "recommendation" with "analysis" or "signal" in UI copy
- Replace "advice" with "analysis"
- BUY/SELL buttons → "Take Trade" / "Skip"

### 4.5 Infrastructure Requirements

No new infrastructure. All existing services handle the workload:
- LLM calls for challenges: same LLM infrastructure used for predictions, ~4 calls per challenge (one per other analyst)
- EOD settlement already runs at 5 PM ET
- Position sizing already configured

## 5. Non-Functional Requirements

### Performance
- Provenance endpoint responds in < 500ms (all data already persisted, just queries)
- Challenge mode: < 30 seconds for 4 analyst counter-arguments (parallel LLM calls)
- Trade confirmation: < 200ms (queue insert)

### Security
- Trade actions require authenticated user
- Users can only view/cancel their own trades
- Disclaimer acknowledgment tracked per user, cannot be bypassed

### Language Compliance
- Zero instances of "advice" or "recommendation" in user-facing UI
- All analyst outputs labeled as "analysis" or "signal"
- Disclaimer present on every page

## 6. Out of Scope

- Real brokerage integration (paper portfolios only)
- Full auto-trading without human confirmation for user trades
- User-analyst affinity / personalized weighting (future effort)
- Fear/greed alerting / push notifications (future effort)
- Stop-loss or limit orders
- Portfolio concentration limits
- Real-time price streaming (EOD settlement model)

## 7. Dependencies & Risks

### Dependencies
| Dependency | Status | Notes |
|-----------|--------|-------|
| Per-analyst predictions | Done | Analyst Intelligence Platform effort |
| Per-analyst risk assessments | Done | `analyst_risk_assessments` table populated |
| Per-analyst article scoring | Done | `scored_by_analyst_id` on `market_predictors` |
| Data source adapters | Done | `source_context` on predictions |
| Analyst memory | Done | Memory fields populated by nightly evaluation |
| EOD settlement | Done | `EodSettlementService` runs at 5 PM ET |
| Position sizing | Done | Confidence-based tiers configured |

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Challenge mode LLM calls add latency | User waits 20-30s for counter-arguments | Run analyst challenges in parallel; show results as they stream in |
| Analyst auto-trading creates large position volumes | Settlement takes longer | Already batched at EOD; monitor settlement duration |
| Users may ignore disclaimers | Legal exposure | Track acknowledgment, require re-acknowledgment periodically |
| Decision outcome tracking requires price data at horizon | Missing outcomes if price capture fails | Outcome tracking already runs via `OutcomeTrackingService` which captures snapshots every 15 min |

## 8. Phasing

### Phase 1: Analyst Auto-Trading & Trade Wiring
**Goal:** Analysts auto-queue trades from predictions. Wire the dashboard BUY/SELL buttons to the trade queue. Add disclaimer flow.

**Deliverables:**
- After each prediction run, auto-queue analyst positions via existing `createPositionFromPrediction()`
- Wire dashboard "Take Trade" button → position sizing (with calibration accuracy) → trade queue → confirmation
- First-time disclaimer acknowledgment modal
- Footer disclaimer on all pages
- AI-drafted Terms of Service page with: risk disclosure, no-fiduciary-relationship, AI-generated-content disclaimer, past-performance disclaimer (flagged for attorney review before launch)
- Language audit: replace "recommendation"/"advice" with "analysis"/"signal" throughout all UI
- `disclaimer_acknowledged_at` column on `user_portfolios`
- `user_trade_decisions` table (needed for recording buy/skip decisions from Phase 1 onward)
- 3-day paper trading validation: analyst portfolios start in paper mode, reviewed after 3 days, promoted to live if drawdown < 20%

**Validation:** Run prediction pipeline → verify analyst paper positions created → after 3 days, verify promotion to live → user clicks "Take Trade" → disclaimer shown → trade appears in queue → EOD settlement executes both.

### Phase 2: Prediction Provenance
**Goal:** Full drill-down into any analyst's prediction showing evidence chain.

**Deliverables:**
- `GET /predictions/:predictionId/provenance` endpoint
- Enhanced `AnalystPredictionModal` with Evidence, Risk, Memory tabs
- Articles with links and relevance scores
- Data source context display
- Analyst risk assessment for this instrument
- Memory context (patterns, corrections, calibration)

**Validation:** Click analyst prediction → see articles, risk score, RSI/P&E data, memory patterns. All data sourced from existing tables.

### Phase 3: Challenge Mode
**Goal:** On-demand counter-arguments from other analysts.

**Deliverables:**
- `POST /predictions/:predictionId/challenge` endpoint
- `prediction_challenges` table
- Challenge prompt builder: loads challenger's persona + specialized data + the thesis being challenged
- "Challenge this analysis" button in prediction modal
- Counter-arguments displayed inline with challenger name, direction, confidence, evidence

**Validation:** Click "Challenge this" on a bullish Technical Analyst call → see Fundamentals Analyst and Macro Strategist provide bearish counter-arguments with their own data.

### Phase 4: Decision Tracking & Outcome Learning
**Goal:** Track every buy/skip decision and show outcomes at each horizon.

**Deliverables:**
- `user_decision_outcomes` table (decisions table created in Phase 1)
- Buy/skip decisions already recorded from Phase 1
- Extend nightly evaluation to populate decision outcomes at 1/3/5 day horizons
- "Your Decisions" view showing outcomes with counterfactuals
- "You bought X — up 4.2%" and "You skipped Y — it's up 6.1%, you would have made $5,200"

**Validation:** Make some buy and skip decisions → wait for horizon evaluation → see outcome feedback with P&L calculations for both taken and skipped trades.
