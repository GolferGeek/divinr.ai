# Premium Data Sources — Intention

## What This Effort Is

Upgrade from free-tier data sources to paid feeds when revenue justifies it. Replace rate-limited free APIs with professional-grade data and add news sources we currently can't access (MarketWatch, Reuters, Bloomberg direct feeds).

## Why It Matters

Free tier limitations directly impact prediction quality:
- **Polygon free**: 5 requests/minute — 12 instruments take 2.5 minutes per cycle, can't get intraday data
- **FMP free**: 4 requests/minute, 250/day cap
- **Twelve Data free**: 8 requests/minute
- **MarketWatch/Reuters**: paywalled RSS — currently using Google News search as a proxy
- **No real-time market data**: prices update via Polygon EOD prev-day endpoint

The Sentiment Analyst especially needs professional news feeds with actual article content, not just headlines from Google News snippets.

## What Needs To Happen

### Tier 1: Essential ($114/month)
- **Twelve Data Grow** ($29/mo) — 60 req/min, real-time, more endpoints
- **FMP Starter** ($14/mo) — 300 req/min, full historical data
- **Polygon.io Stocks Starter** ($29/mo) — unlimited requests, real-time prices, intraday bars
- **Finnhub Personal** ($42/mo) — full news access, more endpoints

### Tier 2: News & Research ($200-400/month)
- **MarketWatch / WSJ direct feed** — actual article content not snippets
- **Reuters Connect** — wire service access
- **Bloomberg Terminal API** (very expensive — $24K/year, deferred)
- **Benzinga Pro API** ($397/mo) — alternative to Bloomberg with options flow

### Tier 3: Specialty Data ($100-300/month)
- **Quiver Quantitative** — congressional trading, lobbying spend, government contracts
- **Sentdex** or similar — commercial sentiment APIs
- **AlphaVantage Premium** — additional fundamentals coverage

## Implementation Notes

Most adapters already exist. Upgrading is mostly:
1. Update API key in `.env`
2. Update `tier` field in `data_source_registry` from 'free' to 'paid'
3. Update `rate_limit_per_minute` to the new tier's limit
4. Possibly update endpoint URLs if paid tiers have different paths

The `DataSourceAdapter` interface was designed for exactly this — swapping tiers should be a config change, not a code rewrite.

## Triggers For This Effort

- Monthly revenue ≥ $500/mo (covers Tier 1)
- User feedback indicating data quality is the bottleneck
- Free tier limits hit consistently in pipeline runs

## Out of Scope

- Bloomberg Terminal ($24K/year — only if institutional sales)
- Real-time options flow (separate effort)
- Crypto data feeds (Divinr is stocks-only for now)
