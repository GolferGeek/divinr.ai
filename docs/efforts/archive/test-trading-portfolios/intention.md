# Effort: Test — Trading & Portfolios

## Covers
- Portfolio management: user portfolio, analyst portfolios, balance tracking
- Trade queue: queue trades from predictions, cancel queued trades
- Position management: open/close positions, PnL tracking
- Trade recommendations: Kelly fraction, entry/stop/take-profit levels
- Dashboard trade actions: "Trade" button, position sizing

## Testing Scope
- PortfolioDashboardView: all portfolios listed, sortable by all columns
- Filter by kind (user/analyst/arbitrator/day_trader), search by name
- Expand portfolio row: positions list, equity curve, calibration chart
- User portfolio: queued trades, open positions with reference levels
- Trade from dashboard: queue a trade via prediction modal
- Cancel queued trade
- Close (sell) an open position
- Verify PnL calculations: realized vs unrealized
- Verify trade recommendation display: action, size, entry/stop/target

## Marketing Angle
Paper trade alongside the AI. See every position, every PnL calculation, every risk level — all transparent.

## Chrome Testing
- Navigate to /portfolios — verify table renders with all columns
- Sort by various columns, filter by kind, search
- Expand a portfolio — verify positions, equity curve
- Queue a trade from dashboard prediction card
- Cancel a queued trade
- Sell an open position
- Verify PnL updates

## Out of Scope
- Real brokerage integration (not implemented)
