# Effort: Paid Tiers

## Problem

Divinr is free during beta. We need a revenue model that funds infrastructure, incentivizes upgrades through quality differentiation, and leaves room for a high-margin custom tier.

## Pricing Model

### Free Trial
- 1 month free access (Pro-equivalent) to get users hooked on transparency and analyst reasoning
- After trial: choose a tier or lose access

### Tier 1: Starter ($20/mo)
- 5 base analysts (gemma4 / local models)
- Free data sources only (RSS feeds, public filings, free APIs)
- Core instrument set (~15-20 stocks)
- Dashboard, portfolios, clubs, tournaments, messaging
- Paper trading with trade recommendations

### Tier 2: Pro ($50/mo)
- Everything in Starter
- Refined analysts (better-tuned contracts, more evaluation data behind them)
- Paid data sources (Polygon, premium news APIs, earnings data)
- Full stock instrument universe
- Advanced analytics: coordination matrix, contribution scoring, calibration drill-downs
- Affinity scoring, contrarian alerts

### Tier 3: Premium ($100/mo)
- Everything in Pro
- Premium analysts (frontier-model powered — Claude, GPT-4 — when infrastructure supports it)
- Institutional-grade data sources
- Full universe + crypto/commodities when ready
- Priority pipeline (predictions run first)
- Custom alerts, API access
- Enhanced club features (larger clubs, more club analysts)

### Custom Tier ($500+/mo)
- Everything in Premium
- Build your own analysts (user provides their own LLM API keys)
- Custom data source ingestion (user provides their own data API keys)
- Platform orchestrates: learning loop, evaluation, coordination — on their resources
- Private analysis that other users never see
- Pure margin for us — they pay their own inference/data costs

## Key Economics

- **Quality ladder**: better sources → better analysis → clear upgrade motivation
- **No artificial scarcity**: every tier gets real value, higher tiers get objectively better quality
- **Custom tier is pure margin**: users bring their own API keys for compute and data, we charge platform fee
- **Free month**: long enough to see the learning loop improve, understand the analyst reasoning, get attached to the transparency

## Scope

- Stripe integration for subscription management
- Tier-gating middleware: check user's tier before allowing access to gated features/sources/analysts
- Analyst tagging: base / refined / premium classification
- Source tagging: free / paid / institutional classification  
- Instrument gating by tier
- Free trial tracking (start date, expiry, conversion)
- Upgrade/downgrade flow with grace period
- Custom tier: analyst creation UI, source ingestion config, API key management

## Dependencies
- Stripe integration must ship first
- Source and analyst quality differentiation must be real (not just arbitrary gating)

## Out of Scope
- Desktop/local hybrid (removed — too easy to copy, not defensible)
- Domain expansion beyond financial markets (separate effort)
- Automated trading execution (we provide signals, not brokerage)
