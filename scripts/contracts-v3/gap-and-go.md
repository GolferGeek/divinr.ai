> v1 placeholder context, machine-authored, intended to be replaced by domain-expert review.

## General

The Gap and Go strategy is an algorithmic momentum strategy that captures price continuation after significant opening gaps. It targets instruments that gap up at least 1% from the prior bar's close and immediately print a green (bullish) bar, indicating the gap has buying follow-through rather than fading.

This strategy produces trade signals and algorithmic analysis, not financial advice or recommendations. It operates as one of three automated day-trading strategies within the divinr ecosystem, managing its own position lifecycle independently from the LLM-driven analyst predictions. It reads signals from personality analysts to modulate conviction and sizing, but its entry/exit logic is entirely algorithmic.

**Risk philosophy:** momentum confirmation. The strategy requires two independent confirmations — a quantitative gap (1%+ price jump) and a qualitative follow-through (green bar) — to avoid "gap and trap" scenarios where price reverses immediately after opening. The once-per-session guard prevents overtrading, and the EOD force-close ensures no overnight exposure.

## Role: Day Trader

**Entry conditions:**
- Time gate: only scans for entries after 14:30 UTC (approximate US market open).
- Gap threshold: the current bar's open must be at least 1% higher than the prior bar's close (`GAP_PCT = 0.01`).
- Follow-through: the current bar must be green (close >= open), confirming buyers are supporting the gap.
- Once-per-session: the strategy fires at most one entry per trading session, tracked via `state.daily_armed_date`. After firing (or passing all candidates), it does not re-scan until the next session.
- No duplicate instruments: skips instruments where the strategy already holds an open position.

**Exit conditions:**
- Red bar exit: any open position is closed immediately when the instrument prints a red 15-minute bar (close < open). This is a tight trailing exit that preserves gap profits.
- Exit is checked before entry on each tick — exits take priority.

**Position sizing:**
- Base sizing multiplier: 1.0x if no signal is available for the instrument.
- Conviction scaling: if a signal exists, confidence (0–100) maps linearly to a 0.5x–1.5x sizing multiplier.
- Signal veto: if the latest signal direction is "flat" with confidence > 70%, the trade is vetoed entirely (no open).

**EOD behavior:** at 22:00 UTC, all open day-trader positions are force-closed at the last cached price by the system's EOD sweep. The strategy is not consulted during forced close.

**Key constants:** `GAP_PCT = 0.01` (1%), activation time 14:30 UTC, forced exit 22:00 UTC, veto threshold >70% flat confidence, sizing range 0.5x–1.5x.

## Adaptations

Reserved for learning-engine adaptations.
