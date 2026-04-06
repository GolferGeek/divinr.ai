# User-Analyst Affinity — Intention

## What This Effort Is

An Affinity Agent that observes user behavior over time and builds a profile of which analysts they trust. Instead of manually setting weights, the system learns from the user's trade decisions, challenge interactions, and browsing patterns.

## Why It Matters

Users naturally gravitate toward certain analytical perspectives. Some trust charts, some trust fundamentals, some trust the crowd. Rather than asking users to configure preferences, the system should learn from their actions — which recommendations they act on, which they skip, which they challenge and then accept vs reject.

This creates a personalized experience without a settings page, and enables the platform to surface contrarian alerts: "You usually agree with Macro Strategist, but they're bearish on this one."

## Core Ideas

### Behavioral Signals
- User buys when Analyst X is bullish → affinity increases
- User skips trades where only Analyst Y recommends → affinity decreases
- User challenges and still buys → strong agreement signal
- User challenges and walks away → disagreement signal
- Time spent on analyst detail views → interest signal

### Affinity Agent
- Runs after each user trade decision (buy, skip, challenge)
- Writes to user memory (same pattern as analyst memory: patterns, calibration)
- Builds per-user analyst weight profile over time
- Dashboard personalizes based on learned affinity

### Contrarian Alerts
- When an analyst the user weights LOW disagrees strongly with the user's weighted view, surface it as an alert
- "You trust Macro and Sentiment, and they say buy. But Technical Analyst (who you rarely follow) is 85% bearish. Here's why."

## Dependencies
- Trade Recommendations effort must be complete (need trade decisions to observe)
- Prediction Deep Dive (challenge mode provides signal data)
