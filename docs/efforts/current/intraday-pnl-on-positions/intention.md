# Intraday P&L on Positions

## Why
PR #58 deferred the intraday % move column on MY POSITIONS because there's no bulk `/markets/bars/latest` endpoint, and hitting the single-symbol bars endpoint per row is an N+1 query. Without intraday %, the positions table shows entry price + current price but no "is today green or red" — which is the number day-traders check every 90 seconds.

## What
Add a bulk `/markets/bars/latest?symbols=A,B,C` endpoint, then compute and render an intraday % column on MY POSITIONS (positive = green, negative = red, near-zero = neutral using the Phase 4 `colorClass()` helper).

## Scope
- API: `GET /markets/bars/latest?symbols=...` — returns latest bar per symbol in a single response (cache-friendly, dedupes symbol set)
- API: `activePositions` payload (or a sibling query) includes today's open price so the web can compute `(last - open) / open`, OR backend returns `intraday_pct` directly
- Web: MY POSITIONS adds the column; respects the existing sticky/overflow behavior; empty state when markets are closed (show "—" instead of stale %)
- Update frequency: re-fetches on the existing positions poll cadence (no new timer)

## Non-goals
- Real-time streaming (WebSocket) price updates
- Intraday P&L on tournament-wide aggregates (already tracked elsewhere)
- Options intraday Greeks

## Success
- MY POSITIONS shows an intraday % on every equity row during market hours
- One network round-trip per poll regardless of position count
- Closed-market state is visually distinct, not showing a stale intraday number
