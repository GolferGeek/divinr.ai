# Fear/Greed Alerting — Intention

## What This Effort Is

Evolve the Sentiment Analyst from "what is sentiment?" to "what will sentiment become?" When news drops that will trigger fear selling or greed buying, bypass the normal pipeline cycle and push an immediate alert — giving the user a 15-30 minute window to act before the crowd prices it in.

## Why It Matters

Everyone has charts and fundamentals. The edge is speed + crowd prediction. If a tariff headline drops, the question isn't "is this bad?" — it's "will enough people panic-sell in the next 2 hours that I should sell now?"

## Core Ideas

### Crowd Reaction Prediction
- Not "what is sentiment?" but "what will retail investors DO when they see this headline?"
- LLM prompt shift: predict human emotional reaction, not analyze data
- Classify: fear trigger, greed trigger, or noise

### Urgency Bypass
- Current pipeline runs on 30-minute cycles
- Fear/greed triggers bypass the cycle and push immediate alerts
- Already have `urgentRelevance` threshold infrastructure

### Push Notifications
- Alert system: email, webhook, or in-app notification
- "ALERT: Tariff headline will trigger fear selling in tech — Sentiment Analyst recommends selling MSFT within 30 minutes"

## Dependencies
- Fast, reliable article crawling (current 5-minute cycle may need to go to 1-minute for breaking news)
- Trade Recommendations (so the alert can include an actionable recommendation)
- User-Analyst Affinity (so alerts are personalized to what the user cares about)
