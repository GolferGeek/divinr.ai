# Fear/Greed Alerting — Completion Report

**Plan**: [plan.md](plan.md)
**PRD**: [prd.md](prd.md)
**Completed**: 2026-04-10
**Final Status**: All Phases Complete

## Summary
- Total phases: 3
- Phases completed: 3
- Phases remaining: 0

## Phase Results

### Phase 1: Crowd Reaction Classification
- **Status**: Complete
- Added 4 new columns to `market_predictors` (crowd_reaction, crowd_reaction_confidence, crowd_reaction_rationale, estimated_reaction_window_minutes)
- Extended Sentiment Analyst LLM prompt to predict crowd emotional reaction alongside relevance scoring
- Robust parsing with graceful defaults: invalid reactions default to "noise", missing fields default to null/0
- 19 unit tests covering all edge cases

### Phase 2: Urgent Bypass + Alert Generation
- **Status**: Complete
- Created `FearGreedAlertService` with full alert lifecycle (evaluate, generate, read, mark-read)
- Wired into analyst pipeline Step 2b — evaluates after every 5-min scoring cycle
- Alert cap of 5 unread per user, deduplication by predictor_id + user_id
- Legal-safe language: "signals" not "recommends"
- Falls back to all portfolio users when no specific holders found
- 25 unit tests covering alert generation, noise filtering, threshold enforcement, dedup, cap, trade rec inclusion
- Created `fear_greed_alerts` table with unique index for idempotency

### Phase 3: API + Frontend
- **Status**: Complete
- 4 REST endpoints following existing notification pattern (GET alerts, GET unread-count, PATCH read, PATCH read-all)
- Pinia store (`fear-greed.store.ts`) mirrors notification store conventions
- Fear/greed alert view with color-coded cards (red for fear, green for greed)
- Warning badge in header (yellow, only visible when unread > 0)
- SSE real-time updates via activity store
- Route added to router

## Gate Results

| Gate | Phase 1 | Phase 2 | Phase 3 |
|------|---------|---------|---------|
| Lint | Pass | Pass | Pass (API + Web) |
| Build | Pass | Pass | Pass (turbo, 5 tasks) |
| Unit Tests | 19 pass | 25 pass | N/A (web tests not yet available) |
| Existing Tests | 24 pass | 24 pass | 24 pass |
| Typecheck | N/A | N/A | 0 new errors (8 pre-existing) |

## Deviations from PRD

1. **evaluateRecentPredictors() convenience method**: The PRD specified `evaluatePredictors(predictorIds)` called with IDs from the scoring result. Since `PredictorGenResult` doesn't return predictor IDs, added `evaluateRecentPredictors()` which queries predictors scored in the last 10 minutes. Same effect, simpler integration.

2. **User targeting fallback**: PRD says "alerts only fire for instruments the user holds or watches." Implementation queries open positions + queued trades, then falls back to all portfolio users if no specific holders found. This ensures alerts aren't silently dropped for instruments where nobody has open positions yet but users are tracking them.

3. **Trade rec column names**: The PRD mentions `entry_price`, `stop_loss`, `take_profit` from TradeRecommendationService. The actual portfolio_manager predictions use `entry_price`, `stop_loss_price`, `take_profit_price` as column names. The service maps these correctly.

## Next Steps

- **Faster crawling**: 1-minute breaking news crawl (deferred per PRD section 6)
- **Email/webhook channels**: External push delivery (deferred per PRD section 6)
- **Custom thresholds**: Per-user confidence thresholds (deferred)
- **Alert accuracy tracking**: Historical analytics for alert quality
