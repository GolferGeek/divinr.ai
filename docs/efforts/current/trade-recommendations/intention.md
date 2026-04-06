# Trade Recommendations & Prediction Deep Dive — Intention

## What This Effort Is

Two interconnected capabilities that complete the user decision flow: (1) analysts and users maintain portfolios with real trade recommendations, and (2) users can drill into any prediction to see full provenance and challenge it before committing.

## Why It Matters

The platform currently produces predictions but stops short of actionable trades. Users see "Technical Analyst says UP at 65% confidence" but can't see *why*, can't challenge it, and can't easily act on it. The analyst portfolios exist but analysts don't auto-trade based on their predictions — so there's no track record to evaluate.

This effort closes the loop: analysts put money where their mouth is (auto-trade), users see the full reasoning chain (provenance), challenge the thesis (on-demand debate), and then commit to a trade that's tracked in their portfolio.

## What's Already Done

- 5 specialist analysts with per-analyst data sources, article scoring, risk assessment, and memory
- `analyst_portfolios`, `analyst_positions`, `user_portfolios`, `user_trade_queue` tables
- `position_sizing_config` with confidence-based tiers (65% → 5%, 75% → 10%, 85% → 15%)
- `EodSettlementService` for end-of-day trade execution and P&L tracking
- Paper mode infrastructure in config versioning
- `source_context` on predictions tracking which data sources contributed
- Per-analyst predictor scores linking articles to analysts
- Blue/Red/Arbiter debate infrastructure

## Core Design Decisions

### 1. Analysts Auto-Trade Their Own Predictions
When an analyst makes a prediction, they automatically queue a trade in their portfolio at the position size their confidence warrants. No human in the loop for analyst portfolios. Their P&L becomes their track record.

### 2. Human In The Loop For User Trades
The portfolio manager recommends trades to the user. The user sees the recommendation, drills into provenance, optionally challenges it, then confirms or skips. The user's portfolio reflects their own decisions.

### 3. Prediction Provenance Drill-Down
Clicking an analyst's prediction opens a detail view showing:
- Articles they scored as relevant (with scores and links)
- Their risk assessment for this instrument
- Specialized data they used (RSI, P/E, VIX, etc.)
- Their memory context (patterns, corrections, calibration)
- The actual reasoning chain

### 4. Challenge Mode (On-Demand Counter-Arguments)
From the provenance view, the user can trigger "Challenge this" — the other analysts respond with counter-arguments using their own data and perspective. This is targeted, on-demand debate at the prediction level, not the automatic risk-level debate.

### 5. End-of-Day Settlement
All trades (analyst and user) settle at end of day. Positions are opened/closed, P&L calculated, portfolios updated.

## What Needs to Happen

### Part A: Trade Recommendations
- Portfolio manager generates trade recommendations from arbitrator output
- Analysts auto-queue trades based on their own predictions
- Position sizing based on confidence + calibration accuracy
- Paper trading validation (3 days) before analyst portfolios go live
- User trade flow: see recommendation → drill in → challenge → confirm/skip
- EOD settlement executes confirmed trades

### Part B: Prediction Deep Dive
- Analyst prediction detail modal/view with full provenance
- Show per-analyst articles (from `market_predictors` where `scored_by_analyst_id` matches)
- Show per-analyst risk assessment (from `analyst_risk_assessments`)
- Show data source context (from `source_context` on prediction)
- Show analyst memory state at time of prediction
- "Challenge this" button triggers other analysts to counter-argue
- Challenge results displayed inline

### 6. Decision Outcome Tracking (Teaching Mode)
After the 1-3-5 day evaluation windows, show users how their decisions played out:
- "You bought MSFT based on Technical Analyst — up 4.2% at day 3. Nice call."
- "You skipped AAPL despite Fundamentals Analyst at 80% confidence — it's up 6.1%. Here's what you would have made."
- "You bought TSLA — down 2.3% at day 1, but the 3-day thesis is still intact."
This turns every decision (buy or skip) into a learning moment and builds intuition about which analysts to trust.

### 7. Disclaimers & Legal Language
- All analyst outputs labeled as "analysis" or "signal" — never "advice" or "recommendation"
- First-time trade disclaimer acknowledgment ("I understand this is not investment advice")
- Subtle reminder on every trade confirmation ("Analysis only — your decision")
- Footer disclaimer on every page
- AI-drafted Terms of Service with standard securities disclaimers (to be reviewed by attorney before launch)
- Risk disclosure, no-fiduciary-relationship, AI-generated-content, past-performance disclaimers

## What This Effort Does NOT Include

- Full auto-trading without human approval (user trades are always human-confirmed)
- Real brokerage integration (paper portfolios only)
- User-analyst affinity (future effort — Affinity Agent observes behavior over time)
- Fear/greed alerting (future effort)
- Push notifications (future effort)
