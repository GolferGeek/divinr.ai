# Data Sources Investigation — Per-Analyst API Reference

## Status: Research Complete — Awaiting GolferGeek Review

---

## Recommended Stack Per Analyst

| Analyst | Primary Source | Secondary Source | Free Viable? |
|---------|---------------|-----------------|--------------|
| **Technical** | Twelve Data (best indicator library, 800 credits/day free) | Polygon.io (best OHLCV, free EOD) | Yes, with limits |
| **Fundamentals** | FMP (pre-computed ratios, $14/mo) | SEC EDGAR (free, authoritative) | Yes |
| **Sentiment** | Finnhub (analyst ratings, insider txns, 60/min free) | Quiver Quant (social/alternative, ~$10-25/mo) | Partially |
| **Macro** | FRED (800K+ series, completely free, 120/min) | BEA (GDP/PCE, free) | Yes, fully free |
| **Momentum** | FMP screener + Twelve Data ROC | Polygon.io for volume | Yes, with limits |

### Monthly Cost for Production Stack
- Twelve Data Grow: $29/mo
- Polygon.io Starter: $29/mo
- FMP Starter: $14/mo
- Finnhub All-in-one: $42/mo
- FRED: Free
- SEC EDGAR: Free
- **Total: ~$114/month**

---

## Technical Analyst Sources

### Twelve Data (RECOMMENDED PRIMARY)
- **URL:** https://twelvedata.com
- **Free tier:** 800 credits/day, 8/min
- **Paid:** $29/mo (5,000/day), $149/mo (30,000/day)
- **Endpoints:** RSI, MACD, SMA, EMA, Bollinger Bands, VWAP, ADX, Stochastic, CCI, 100+ indicators
- **Best for:** Most comprehensive indicator library of any API

### Polygon.io
- **URL:** https://polygon.io
- **Free tier:** EOD data, 5 calls/min, unlimited/day
- **Paid:** $29/mo (real-time, 100/min), $99/mo (unlimited)
- **Endpoints:** OHLCV any timeframe, SMA, EMA, MACD, RSI, snapshots with 52-week range
- **Best for:** Raw price data, historical depth

### Alpha Vantage
- **URL:** https://alphavantage.co
- **Free tier:** 25 requests/day (severely limited)
- **Paid:** $49.99/mo
- **Endpoints:** Full OHLCV, RSI, MACD, SMA, EMA, Bollinger Bands, VWAP
- **Limitation:** Free tier too restrictive for production

### What's NOT available via API:
- Support/resistance levels — must compute
- Volume profile — must compute from intraday data
- 52-week high/low — available via snapshot endpoints

---

## Fundamentals Analyst Sources

### Financial Modeling Prep (RECOMMENDED PRIMARY)
- **URL:** https://financialmodelingprep.com
- **Free tier:** 250 requests/day
- **Paid:** $14/mo
- **Endpoints:** Income statement, balance sheet, cash flow, **pre-computed ratios** (P/E, EV/EBITDA, FCF yield, debt/equity, ROE, margins), earnings calendar, dividend history, enterprise values
- **Best for:** Pre-computed ratios save massive development time

### SEC EDGAR (RECOMMENDED SECONDARY)
- **URL:** https://data.sec.gov
- **Free tier:** Completely free, 10 requests/second
- **Endpoints:** All XBRL financial facts, filing history (10-K, 10-Q, 8-K, Form 4), full-text search
- **Best for:** Authoritative source, insider transactions, institutional holdings
- **Limitation:** Raw XBRL requires parsing, no pre-computed ratios

### NOT viable:
- Seeking Alpha — no public API, paywalled
- Zacks — no public API, institutional data feeds only

---

## Sentiment Analyst Sources

### Finnhub (RECOMMENDED PRIMARY)
- **URL:** https://finnhub.io
- **Free tier:** 60 calls/min (generous)
- **Paid:** $42/mo (300/min + premium data)
- **Endpoints:** Analyst recommendations, price targets, upgrade/downgrade, insider transactions, insider sentiment (MSPR), company news, press releases
- **Paid adds:** Social sentiment (Reddit/Twitter), congressional trading, lobbying data
- **Best for:** Analyst ratings and insider data on free tier

### Quiver Quantitative (RECOMMENDED SECONDARY)
- **URL:** https://quiverquant.com
- **Free tier:** Limited, ~5 requests/min
- **Paid:** ~$10-25/mo
- **Endpoints:** Congressional trading, insider transactions, WallStreetBets mentions, Twitter volume, lobbying, short interest
- **Best for:** Alternative/social data not found elsewhere

### Reddit API
- **URL:** https://www.reddit.com/dev/api
- **Free tier:** 100 requests/min (non-commercial)
- **Limitation:** No built-in sentiment scoring — need your own NLP pipeline. Commercial use requires negotiation. Historical access limited.

### NOT viable as APIs:
- StockTwits — API deprecated/restricted after acquisition
- OpenInsider — no API, scraping only
- MarketBeat — no API
- TipRanks — no API
- Unusual Whales — paid only ($57/mo), options-focused

---

## Macro Strategist Sources

### FRED (RECOMMENDED — INDISPENSABLE)
- **URL:** https://api.stlouisfed.org
- **Free tier:** Completely free, 120 requests/min, 800K+ series
- **Key series:**
  - `FEDFUNDS` / `DFF` — Fed funds rate
  - `DGS10` / `DGS2` — Treasury yields
  - `T10Y2Y` — Yield curve spread
  - `CPIAUCSL` / `CPILFESL` — CPI / Core CPI
  - `UNRATE` — Unemployment
  - `GDP` / `GDPC1` — GDP
  - `VIXCLS` — VIX
  - `DTWEXBGS` — Dollar index
  - `SP500` — S&P 500
- **Best for:** Everything macro. No competition.

### BEA (Bureau of Economic Analysis)
- **URL:** https://apps.bea.gov/api
- **Free tier:** Completely free, 100 requests/min
- **Best for:** GDP primary source, PCE inflation (Fed's preferred measure)

### Treasury.gov
- **URL:** https://api.fiscaldata.treasury.gov
- **Free tier:** Completely free
- **Best for:** Government debt, interest rates on Treasury securities

### NOT available as APIs:
- ISM PMI — no public API, use FRED proxies
- Fed minutes text — need to scrape/NLP the Federal Reserve website

---

## Momentum Analyst Sources

No single API covers momentum screening. Build from:

| Data Need | Source | Endpoint |
|-----------|--------|----------|
| Volume vs 20-day avg | Polygon.io or Twelve Data | OHLCV + compute |
| 52-week high/low | FMP or IEX Cloud | Stock screener / quote |
| Relative strength vs SPY | Any OHLCV API | Compute ratio |
| Earnings surprise | FMP | `/earnings-surprises/{symbol}` |
| Sector rotation | FMP | `/sectors-performance` |
| Rate of change | Twelve Data | `/roc` endpoint |

### FMP Stock Screener
- **Endpoint:** `/api/v3/stock_screener`
- **Filters:** market cap, price, beta, volume, dividend, sector, industry
- **Limitation:** No technical momentum filters (RSI, SMA crossover) — only fundamental/price-level

### NOT viable:
- Finviz — no official API, scraping violates TOS
- TradingView — no data API (webhooks only)

---

## Key Observations

1. **FRED is the clear winner for macro** — completely free, massive dataset, no competition
2. **FMP is best value for fundamentals** — pre-computed ratios at $14/mo vs building your own
3. **Twelve Data has the richest technical indicators** — 100+ indicators with generous free tier
4. **Sentiment is the hardest category** — requires combining multiple sources + your own NLP
5. **No API does stock screening well** — we'll need to build our own screener logic
6. **Total cost ~$114/mo** gets a solid production stack across all 5 analyst types
7. **Free-only stack is viable** for prototyping: FRED + SEC EDGAR + Finnhub free + Twelve Data free + Polygon.io free
