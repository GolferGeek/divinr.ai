# Portfolio System — Design Intent

## 1) Purpose

This document defines the portfolio and paper trading system for Divinr AI. Every prediction produces a trade. Analysts automatically trade based on their convictions. Users can follow analysts or trade manually. Everything settles at market close (5 PM ET).

The portfolio system closes the accountability loop: predictions become positions, positions become P&L, P&L feeds the learning system.

## 2) Core concept: Every prediction is a trade

When a prediction run completes, each analyst's directional call becomes a position:
- **Direction** → long (up) or short (down)
- **Confidence** → determines position size (higher conviction = larger position)
- **Flat calls** → no position (sitting out is a valid choice)

This happens automatically. No human intervention required.

## 3) Two portfolio types

### Analyst portfolios (automatic)

Each personality analyst gets a portfolio per organization, initialized with a virtual balance ($1M default, configurable per org).

When predictions run:
1. Each analyst's call is queued as a pending trade
2. At 5 PM ET settlement: trades execute at the day's closing price
3. Existing positions from prior predictions update their unrealized P&L
4. Expired predictions (past their horizon) close and realize P&L

**Position sizing tiers (confidence-driven):**

| Confidence | Position Size | Rationale |
|-----------|--------------|-----------|
| 60-70% | 5% of portfolio | Low conviction — small bet |
| 70-80% | 10% of portfolio | Medium conviction — standard position |
| 80%+ | 15% of portfolio | High conviction — concentrated position |

Tiers are configurable per organization via `position_sizing_config`.

**Portfolio status (feeds motivation + learning):**

| Status | Balance Threshold | Ensemble Weight | Effect |
|--------|------------------|-----------------|--------|
| Active | ≥80% of initial | 100% | Normal operation |
| Warning | 60-80% of initial | 100% | Performance notice injected into prompt |
| Probation | 40-60% of initial | 50% | Weight reduced, conservative guidance injected |
| Suspended | <40% of initial | 0% (paper only) | Excluded from ensemble, paper trades only |

Status changes are automatic based on portfolio balance. Recovery from suspended requires +20% improvement in paper mode.

### User portfolios (manual + follow)

Each user gets a portfolio per organization, initialized with a configurable virtual balance.

Users can:
- **Queue a trade** during the day based on any prediction they see
- **Follow an analyst** — auto-queue trades matching that analyst's calls
- **Set custom sizing** — override the confidence-based tiers

All user trades execute at the 5 PM settlement alongside analyst trades.

## 4) End-of-day settlement (5 PM ET)

The settlement runs as a cron job at 5 PM ET (22:00 UTC) Monday through Friday.

### Settlement flow

```
Step 0: Capture closing prices for all active instruments
  → Fetch market close data via prediction plane's ingest.getCurrentState()
  → Store as price snapshot

Step 1: Execute queued user trades at closing price
  → All user_trade_queue entries with status='queued'
  → Create user_positions at the closing price
  → Mark queue entries as 'executed'

Step 2: Create analyst positions from today's predictions
  → For each completed prediction from today (not yet traded)
  → For each analyst outcome with direction != 'flat'
  → Calculate position size from confidence tier
  → Create analyst_position at closing price

Step 3: Resolve expired predictions and close positions
  → Find predictions past their horizon (e.g., 4h/1d/3d/5d)
  → Close all linked positions at current price
  → Calculate realized P&L per position
  → Update portfolio balances

Step 4: Update unrealized P&L for remaining open positions
  → All open positions get current_price updated
  → Recalculate unrealized_pnl

Step 5: Check portfolio status thresholds
  → For each analyst portfolio, recalculate status
  → Trigger status change events if needed
  → Feed into learning system

Step 6: Log settlement summary
  → Write eod_settlement_log record
  → Emit observability events
```

## 5) Data model

### New tables

```sql
prediction.analyst_portfolios
  id, analyst_id, organization_slug, initial_balance, current_balance,
  total_realized_pnl, total_unrealized_pnl, win_count, loss_count,
  status (active|warning|probation|suspended), status_changed_at,
  created_at, updated_at

prediction.analyst_positions
  id, portfolio_id, analyst_id, organization_slug,
  prediction_id, instrument_id, symbol,
  direction (long|short), quantity, entry_price, current_price, exit_price,
  unrealized_pnl, realized_pnl, is_paper_only,
  status (open|closed), opened_at, closed_at, created_at, updated_at

prediction.user_portfolios
  id, user_id, organization_slug, initial_balance, current_balance,
  total_realized_pnl, total_unrealized_pnl,
  created_at, updated_at

prediction.user_positions
  id, portfolio_id, user_id, organization_slug,
  prediction_id, instrument_id, symbol,
  direction (long|short), quantity, entry_price, current_price, exit_price,
  unrealized_pnl, realized_pnl,
  status (open|closed), opened_at, closed_at, created_at, updated_at

prediction.user_trade_queue
  id, user_id, organization_slug, portfolio_id,
  prediction_id, instrument_id, symbol,
  direction (long|short), quantity,
  status (queued|executed|cancelled),
  executed_position_id, execution_price, executed_at,
  queued_at, created_at, updated_at

prediction.eod_settlement_log
  id, organization_slug, settlement_date,
  queued_trades_executed, analyst_positions_created,
  predictions_resolved, positions_closed,
  unrealized_pnl_updated, total_realized_pnl,
  errors jsonb, started_at, completed_at, duration_ms

prediction.position_sizing_config
  id, organization_slug, tier_name, min_confidence, max_confidence,
  position_percent, created_at, updated_at
  UNIQUE (organization_slug, tier_name)
```

### Modifications to existing tables

- `market_analysts` add: `portfolio_status text DEFAULT 'active'`
- `market_predictions` already has: `confidence`, `analyst_id`, `role` — sufficient for position creation

## 6) Integration with existing systems

### Prediction pipeline → Portfolio

After `prediction-runner.service.ts` completes a run:
- Analyst outcomes with direction != 'flat' are flagged for EOD position creation
- The prediction's `confidence` drives position sizing at settlement time

### Portfolio → Learning system

The nightly evaluation already computes analyst accuracy. With portfolios:
- **P&L-weighted accuracy**: an analyst who's right on big positions and wrong on small ones is better than one who's right on small and wrong on big
- **Learning proposals can be evaluated by P&L impact**: "this change would have improved the analyst's P&L by $X on canonical days"
- **Portfolio status changes trigger learning**: a probation event creates a learning proposal to adjust the analyst

### Portfolio → Motivation (prompt injection)

When an analyst enters warning/probation/suspended:
- A context modification is appended to their prompt
- Warning: "Your recent performance has declined. Be more selective."
- Probation: "You are on probation. Reserve high confidence for your strongest setups."
- Suspended: "You are in paper-only mode. Focus on rebuilding through careful analysis."

This feeds directly into the existing `analyst_config_versions` system — each status change creates a new version with the motivation context appended.

## 7) Daily settlement report

The 5 PM settlement already runs the nightly evaluation (1d/3d/5d horizons) and executes trades. The settlement report combines both into a single daily briefing per user and per org.

### Report structure

```
Daily Settlement Report — {date} — {org_name}

═══ TODAY'S ACTIVITY ═══

New trades executed at close ($174.52 AAPL, $342.10 MSFT, ...):
  User trades:
    - AAPL long (followed Fred, 78% confidence) → $8,725 position
    - TSLA short (manual, 65% confidence) → $4,500 position

  Analyst trades (automatic):
    - Fundamental Fred: AAPL long ($8,725), MSFT long ($17,105)
    - Technical Tina: TSLA short ($6,842)
    - Aggressive Alex: AAPL long ($13,088), GOOGL long ($10,250)
    - Cautious Carl: no trades (all calls were flat)
    - Arbitrator: AAPL long ($13,088), MSFT long ($17,105), TSLA short ($6,842)

═══ 1-DAY LOOKBACK (yesterday's trades) ═══

  GOOGL long (Fred): +1.2% → +$1,200 unrealized. Thesis on track.
  AMZN short (Alex): -0.8% → -$400 unrealized. May recover at 3d horizon.

  Your portfolio: +$800 unrealized today
  Best analyst today: Fred (+$2,400)
  Worst analyst today: Alex (-$1,100)

═══ 3-DAY LOOKBACK ═══

  AAPL long (Fred, 3 days ago): +3.5% → +$3,500 REALIZED (closed at horizon)
    Evaluation: CORRECT. Fred's fundamental thesis validated.
  TSLA short (Tina, 3 days ago): -2.1% → -$1,050 REALIZED
    Evaluation: WRONG at 3d. Tina flagged the risk but direction was incorrect.

  3-day accuracy: 4/6 correct (67%)
  3-day P&L: +$4,200 realized

═══ 5-DAY LOOKBACK ═══

  MSFT long (Arbitrator, 5 days ago): +5.2% → +$5,200 REALIZED
    Evaluation: CORRECT. High conviction (82%) → large position → large payoff.
    This is the final verdict for this prediction.

  5-day accuracy: 3/4 correct (75%)
  5-day P&L: +$7,800 realized

═══ PORTFOLIO SUMMARY ═══

  Your portfolio: $1,012,400 (+1.24% all-time)
  Open positions: 5 ($42,000 exposure)
  Today's realized P&L: +$2,100
  Unrealized P&L: +$3,200

  Analyst Leaderboard:
    1. Fundamental Fred: $1,045,000 (+4.5%) — 71% win rate
    2. Aggressive Alex: $1,032,000 (+3.2%) — 58% win rate (high conviction pays)
    3. Arbitrator: $1,028,000 (+2.8%) — 73% win rate
    4. Technical Tina: $1,015,000 (+1.5%) — 65% win rate
    5. Cautious Carl: $1,008,000 (+0.8%) — 80% win rate (cautious = small gains)

═══ LEARNING SIGNALS ═══

  Canonical day candidate: TSLA 3-day short was wrong with 72% confidence
  Pattern detected: Alex's bearish calls on TSLA are 2/7 over 30 days
  Proposal: Reduce Alex's TSLA bearish confidence emphasis (pending canonical test)
```

### Report generation

The settlement report is generated as the final step of the EOD settlement job:

1. Settlement completes (trades executed, positions updated, P&L calculated)
2. Nightly evaluation runs (1d/3d/5d horizon scores computed)
3. Report generator pulls:
   - Today's executed trades (user + analyst)
   - 1-day unrealized P&L for yesterday's trades
   - 3-day realized P&L for positions closing at 3d horizon
   - 5-day realized P&L for positions closing at 5d horizon
   - Portfolio summary and leaderboard
   - Learning signals (canonical candidates, proposals)
4. Report persisted to `learning_reports` table with `report_type = 'daily_settlement'`
5. Available in the UI dashboard next morning

### Report delivery

- **Dashboard**: Settlement report card on the main dashboard (latest report)
- **Email** (future): Optional daily email digest
- **API**: `GET /markets/settlement/report?date=2026-04-01`

### Relationship to nightly evaluation

The settlement report wraps the nightly evaluation output. The flow is:

```
5:00 PM ET → EOD Settlement
  ├── Execute trades
  ├── Create positions
  ├── Resolve expired positions
  ├── Update unrealized P&L
  ├── Check portfolio status thresholds
  │
  ├── Run Nightly Evaluation (1d/3d/5d)
  │   ├── Score predictions at each horizon
  │   ├── Update analyst performance profiles
  │   └── Flag canonical day candidates
  │
  ├── Run Learning Cycle (Tier 1)
  │   ├── Identify systematic patterns
  │   ├── Propose adjustments
  │   └── Validate against canonical tests
  │
  └── Generate Settlement Report
      ├── Combine trade activity + evaluation results + P&L + learning signals
      └── Persist for dashboard consumption
```

Everything runs in sequence as one unified "close of day" event.

## 8) API endpoints

### Analyst portfolios
- `GET /markets/portfolios/analysts` — list analyst portfolios for org
- `GET /markets/portfolios/analysts/:analystId` — portfolio detail with positions
- `GET /markets/portfolios/analysts/:analystId/positions` — open and closed positions
- `GET /markets/portfolios/leaderboard` — ranked by P&L

### User portfolios
- `GET /markets/portfolios/me` — current user's portfolio
- `POST /markets/portfolios/me/queue-trade` — queue a trade for EOD execution
- `DELETE /markets/portfolios/me/queue-trade/:tradeId` — cancel queued trade
- `GET /markets/portfolios/me/positions` — open and closed positions
- `GET /markets/portfolios/me/queue` — pending queued trades

### Settlement
- `POST /markets/admin/run-settlement` — manual settlement trigger (admin)
- `GET /markets/settlement/log` — settlement history
- `GET /markets/settlement/report` — daily settlement report (latest or by date)

### Configuration
- `GET /markets/portfolios/sizing-config` — position sizing tiers
- `POST /markets/portfolios/sizing-config` — upsert sizing tiers (admin)

## 8) UI views

### Portfolio dashboard (new view)
- User portfolio summary: balance, P&L, win rate
- Open positions table with unrealized P&L
- Trade queue (pending for today's settlement)
- "Queue Trade" button on each prediction card

### Analyst leaderboard (new view)
- Ranked by P&L or win rate
- Status badges (active/warning/probation/suspended)
- Sparkline of balance over time
- Click to see analyst's positions

### Integration into existing views
- **RunDetailView**: each analyst outcome card shows "Queue Trade" button
- **PredictionsView**: add P&L column for predictions with resolved positions
- **AnalystsView**: show portfolio status badge + current balance
- **LearningDashboardView**: show P&L impact of proposed changes

## 9) Implementation phasing

| Sprint | What |
|--------|------|
| **8.1** | Schema: portfolio tables, position sizing config, settlement log |
| **8.2** | Position sizing service (confidence → size calculation) |
| **8.3** | Analyst portfolio service (create portfolios on analyst creation, position tracking) |
| **8.4** | User portfolio + trade queue service |
| **8.5** | EOD settlement service + cron job (5 PM ET) |
| **8.6** | Motivation integration (status thresholds → prompt injection via config versions) |
| **8.7** | API endpoints + wire into existing prediction pipeline |
| **8.8** | UI: portfolio dashboard, leaderboard, trade queue integration |

## 10) Relationship to domain architecture

The portfolio system is **domain-aware** but the core mechanics are domain-agnostic:
- Position direction (long/short) works for stocks, betting (cover/fade), elections (favor/against)
- The prediction plane's `evaluation.evaluateOutcome()` provides the closing price / resolution data
- Position sizing tiers can be configured per universe (stocks might allow 15% max, elections 5%)
- Settlement timing varies by domain (5 PM for stocks, game time for sports, election day for elections)

## 11) Open questions

- Should analyst portfolios reset periodically (monthly? quarterly?) or run indefinitely?
- Should users be able to "paper trade" against historical data (replay mode)?
- Should there be portfolio limits (max positions open, max exposure per instrument)?
- How do we handle stock splits, dividends, or other corporate actions?

## 12) Revision history

| Date | Change |
|------|--------|
| 2026-04-01 | Initial portfolio system design authored. |
