> v1 placeholder context, machine-authored, intended to be replaced by domain-expert review.

## General

The Mean Reversion strategy is a statistical arbitrage algorithm that buys when price deviates significantly below its recent average, betting on a return to the mean. It targets instruments where the current price has fallen more than 2 standard deviations below the 20-bar simple moving average — a statistically extreme condition that tends to revert.

This strategy produces trade signals and algorithmic analysis, not financial advice or recommendations. It is designed for range-bound or mean-reverting market conditions, not trending ones. In a strong downtrend, the mean itself is falling, and entries below the mean can remain underwater for extended periods.

**Risk philosophy:** statistical reversion. The strategy accepts that not every 2-sigma deviation will revert — some are the start of a genuine trend change — but over many trades, the statistical edge of buying at extremes and exiting at the mean produces a positive expectancy. The conviction modifier provides an external reality check by incorporating the personality analysts' directional signals.

## Role: Day Trader

**Entry conditions:**
- History requirement: the instrument must have at least 20 bars of price history.
- Statistical threshold: the current bar's close must be strictly below `SMA(20) - 2.0 × StdDev(20)`. This means price is more than 2 standard deviations below the 20-bar simple moving average.
- The SMA and standard deviation are calculated using the population formula (dividing by N, not N-1) over the most recent 20 closing prices.
- No duplicate instruments: skips instruments where the strategy already holds an open position.

**Exit conditions:**
- Mean reversion: any open position is closed when the current bar's close reaches or exceeds the 20-bar SMA (`close >= SMA(20)`). The position has "reverted to the mean."
- Exit is checked before entry on each tick — exits take priority.

**Position sizing:**
- Base sizing multiplier: 1.0x if no signal is available.
- Conviction scaling: confidence (0–100) maps linearly to 0.5x–1.5x.
- Signal veto: flat direction with >70% confidence vetoes the trade entirely.

**EOD behavior:** at 22:00 UTC, all open day-trader positions are force-closed regardless of whether the mean has been reached.

**Key constants:** `LOOKBACK = 20` (bar window for SMA and StdDev), `K = 2.0` (number of standard deviations for entry threshold), veto threshold >70% flat confidence, sizing range 0.5x–1.5x.

## Adaptations

Reserved for learning-engine adaptations.
