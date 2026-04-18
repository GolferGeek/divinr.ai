# Prediction → Trade Intent

## Why
Today predictions and tournament trades are disconnected surfaces. A user reviews a prediction, decides they want to act on it, and then has to navigate to the TRADE tab and re-enter the ticker, direction, and size from scratch. That friction kills the loop between "I like this analysis" and "I put virtual money behind it" — which is the exact loop that makes the tournament portfolio feel alive.

## What
Add a **Trade this prediction** affordance on prediction cards/drawers that opens the tournament trade form with ticker, direction (long/short), and a suggested size pre-filled from the prediction. Quantity is editable so the user can size up or down from the prediction's implied size. Submission creates a normal tournament trade — no new order type, no separate position linkage on day one.

## Scope
- New CTA on the prediction detail surface (and on prediction cards in lists where it fits)
- Pre-fill logic: symbol + direction always; quantity defaults to prediction's implied contract size or a sensible heuristic (e.g. 1–5% of starting balance)
- Respects the user's current active tournament context (if zero or many → picker)
- Writes through the existing tournament trade endpoint; no schema changes
- Empty-state + error handling when the user has no active tournament

## Non-goals
- Position ↔ prediction linkage / "I traded this prediction" attribution on the outcome side (separate effort)
- Auto-execute / scheduled trades
- Multi-leg option orders derived from option-style predictions
- Changing the prediction contract or outcome model

## Success
- From any active-tournament prediction card, a user can open a trade form with correct defaults and submit in ≤ 2 clicks
- Works for both equity and options predictions
- If no active tournament is selected, the CTA routes to the tournaments list with a helpful empty state instead of silently failing
