# Effort: Live Prediction PnL

## Problem
Day trader portfolios show $0 PnL because positions are opened and closed at the same price (no intraday movement during off-hours). Need to run prediction cycles during market hours to generate real returns.

## Intention
Run a live prediction cycle during market hours (9:30 AM - 4:00 PM ET) so day trader strategies can open positions with real price movement before EOD flat closes them.

## Scope
- Trigger day trader strategies during market hours
- Verify positions open at market prices
- Wait for price movement
- Verify EOD flat closes with actual PnL (positive or negative)
- Confirm portfolio balances, win/loss counts, and equity curves update

## Out of Scope
- Changing strategy logic
- Running overnight positions
