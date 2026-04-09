> v1 placeholder context, machine-authored, intended to be replaced by domain-expert review.

## General

The Momentum Breakout strategy is a trend-following algorithm that enters long when price breaks above the highest high of the prior 20 bars, and exits when upward momentum fails — specifically, when the current bar's high is lower than the previous bar's high (a "lower high").

This strategy produces trade signals and algorithmic analysis, not financial advice or recommendations. It is designed for markets exhibiting directional breakouts from consolidation. The strategy captures the initial thrust of a breakout and exits quickly when momentum stalls, prioritizing capital preservation over holding for extended moves.

**Risk philosophy:** aggressive trend-reversal detection. Rather than using fixed stop-losses, the strategy uses the absence of momentum continuation (a lower high) as the exit signal. This allows it to stay in strong moves that keep making higher highs, while exiting rapidly when the move exhausts. The tradeoff is frequent exits on minor pullbacks that would have continued — the strategy accepts this as the cost of fast capital preservation.

## Role: Day Trader

**Entry conditions:**
- History requirement: the instrument must have at least 21 bars (20-bar lookback window + current bar).
- Breakout threshold: the current bar's close must be strictly greater than the highest high of the prior 20 bars. This is a fresh N-bar high breakout.
- The lookback window is the 20 bars immediately preceding the current bar (not including it).
- No duplicate instruments: skips instruments where the strategy already holds an open position.
- Scans all instruments and takes the first qualifying breakout.

**Exit conditions:**
- Lower high: any open position is closed immediately when the current bar's high is lower than the previous bar's high (`cur.h < prev.h`). This detects the first sign of momentum failure.
- Exit is checked before entry on each tick — exits take priority.

**Position sizing:**
- Base sizing multiplier: 1.0x if no signal is available.
- Conviction scaling: confidence (0–100) maps linearly to 0.5x–1.5x.
- Signal veto: flat direction with >70% confidence vetoes the trade entirely.

**EOD behavior:** at 22:00 UTC, all open day-trader positions are force-closed regardless of strategy state.

**Key constants:** `LOOKBACK = 20` (bar window for determining the resistance threshold), veto threshold >70% flat confidence, sizing range 0.5x–1.5x.

## Adaptations

Reserved for learning-engine adaptations.
