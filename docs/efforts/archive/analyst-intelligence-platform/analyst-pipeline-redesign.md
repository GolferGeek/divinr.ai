# Analyst Pipeline Redesign — Planning Document

## Status: DRAFT — Awaiting GolferGeek Review

## Core Principle

Each analyst carries their perspective through the **entire pipeline** — not just predictions. Same analyst does article scoring, risk assessment, prediction, debate, and trade recommendation. They accumulate memory and learn from outcomes.

All base analysts are controlled exclusively by GolferGeek. Tenants see base analyst output but cannot modify analyst configuration.

---

## Proposed Analyst Roster (Base Set)

Professional names, role-descriptive. No cute nicknames.

| # | Name | Role | Primary Data Sources (Free Tier) |
|---|------|------|----------------------------------|
| 1 | **Technical Analyst** | Price action, chart patterns, indicators | Twelve Data free (800/day): RSI, MACD, SMA, Bollinger, VWAP. Polygon.io free: OHLCV, 52-week range |
| 2 | **Fundamentals Analyst** | Financial health, valuation, earnings | SEC EDGAR (free): financial statements, filings. FMP free (250/day): pre-computed ratios, earnings |
| 3 | **Sentiment Analyst** | Crowd behavior, contrarian signals | Finnhub free (60/min): analyst ratings, insider txns. Our LLM: article sentiment scoring. Reddit free: social posts |
| 4 | **Macro Strategist** | Economic environment, sector context | FRED (free, 120/min): yield curve, CPI, unemployment, VIX, GDP, Fed funds rate, dollar index |
| 5 | **Momentum Analyst** | Breakouts, trend strength, acceleration | Twelve Data free: ROC indicator. Polygon.io free: volume data. FMP free: earnings surprise, sector performance |

### Open Questions
- Do we need a 6th "Risk Specialist" or does each analyst's risk assessment cover it?
- Should we have a "Quantitative Analyst" that runs statistical models?

---

## Source Abstraction Layer

Every data source implements a common interface so swapping free → paid is a config change, not a code rewrite.

```
interface DataSourceAdapter {
  id: string;                     // e.g., 'twelve-data-rsi'
  name: string;                   // e.g., 'Twelve Data RSI Indicator'
  provider: string;               // e.g., 'twelve-data'
  tier: 'free' | 'paid';         // current tier
  rateLimitPerMinute: number;

  fetchData(params: {
    symbol: string;
    dateRange?: { from: string; to: string };
    options?: Record<string, unknown>;
  }): Promise<{
    data: unknown;
    metadata: { source: string; fetchedAt: string; cached: boolean };
  }>;
}
```

### Source Registration

New table: `prediction.data_source_registry`
- `id` (text) — e.g., 'twelve-data'
- `name` (text) — 'Twelve Data'
- `provider_type` ('api' | 'crawler' | 'computed')
- `base_url` (text)
- `api_key_env_var` (text) — e.g., 'TWELVE_DATA_API_KEY' (key stored in .env, not DB)
- `tier` ('free' | 'paid')
- `rate_limit_per_minute` (int)
- `is_active` (boolean)

### Analyst-Source Assignments

New table: `prediction.analyst_source_assignments`
- `analyst_id` (text) → market_analysts.id
- `source_id` (text) → data_source_registry.id
- `data_types` (text[]) — what this analyst wants from this source, e.g., ['rsi', 'macd', 'sma']
- `priority` (int) — if multiple sources provide same data, which to try first
- `is_active` (boolean)

### Upgrade Path

When upgrading from free to paid:
1. Change `tier` in `data_source_registry`
2. Add API key to `.env`
3. Update `rate_limit_per_minute`
4. No code changes. The adapter handles tier differences (e.g., delayed vs real-time).

---

## Free-Tier Sentiment Strategy

Sentiment is the hardest category — no single free API covers everything. Strategy: combine free sources + our own LLM.

### What We Can Get Free

| Data | Source | How |
|------|--------|-----|
| Analyst ratings & revisions | Finnhub free | Direct API: `/stock/recommendation`, `/stock/upgrade-downgrade` |
| Analyst price targets | Finnhub free | Direct API: `/stock/price-target` |
| Insider transactions | Finnhub free | Direct API: `/stock/insider-transactions` |
| Insider sentiment (MSPR) | Finnhub free | Direct API: `/stock/insider-sentiment` |
| News sentiment | Our article pipeline + LLM | Crawl articles → Sentiment Analyst scores each for sentiment signals using their persona |
| Social sentiment (Reddit) | Reddit API free (100/min) | Fetch posts from r/wallstreetbets, r/stocks → our LLM extracts sentiment |
| Company press releases | Finnhub free | Direct API: `/press-releases` |

### What We Skip For Now (Paid Only)

| Data | Cheapest Source | Cost | Priority |
|------|----------------|------|----------|
| Options flow / unusual activity | Unusual Whales | $57/mo | Medium — add when we have paying customers |
| Short interest | Quiver Quant or Finnhub paid | $10-42/mo | Medium |
| Social sentiment (pre-scored) | Finnhub paid | $42/mo | Low — our LLM scoring is comparable |
| Congressional trading | Quiver Quant | $10-25/mo | Low — novelty data |

### LLM-Based Sentiment Scoring

The Sentiment Analyst runs our existing articles through their persona lens:
- Instead of a generic "is this relevant?" score, they ask: "What sentiment signals does this article contain?"
- Output: bullish/bearish/neutral score, key sentiment factors, contrarian indicators
- This replaces paid sentiment APIs for news — we already have the articles

For Reddit:
- Fetch top posts mentioning our instruments (free API)
- Sentiment Analyst LLM-scores each post for: direction, conviction, crowd consensus
- Track mention volume over time (spike detection)

---

## Pipeline Per Analyst Per Instrument

Current: articles → predictors → predictions → risk → debate (all generic)

Proposed: Each analyst runs full assessment independently, arbitrator synthesizes.

```
For each instrument:
  1. CONTEXT GATHERING (parallel per analyst)
     Each analyst's context providers fetch from their assigned sources
     Technical: RSI, MACD, Bollinger from Twelve Data
     Fundamentals: ratios, earnings from FMP + EDGAR
     Sentiment: ratings, insider txns from Finnhub + Reddit posts
     Macro: yield curve, CPI, VIX from FRED
     Momentum: volume, ROC, sector perf from Twelve Data + FMP

  2. ARTICLE SCORING (parallel per analyst)
     Each analyst scores articles through their own lens
     Technical: "Does this mention price levels, volume, or patterns?"
     Fundamentals: "Does this mention earnings, revenue, margins?"
     Sentiment: "What crowd signals does this contain? Contrarian?"
     Macro: "Does this affect the macro backdrop for this instrument?"
     Momentum: "Does this signal a breakout or trend change?"

  3. RISK ASSESSMENT (parallel per analyst)
     Each analyst assesses risk through their own data + perspective
     Technical: "Chart breakdown risk, resistance, volume divergence"
     Fundamentals: "Valuation stretch, margin compression, debt risk"
     Sentiment: "Crowded trade risk, sentiment extreme, insider red flags"
     Macro: "Rate sensitivity, inflation impact, recession probability"
     Momentum: "Trend exhaustion, volume fade, mean reversion risk"

  4. PREDICTION (parallel per analyst)
     Each analyst makes their directional call informed by:
     - Their own data sources
     - Their own risk assessment
     - Their memory (patterns, corrections, calibration)

  5. ARBITRATION (sequential)
     Arbitrator sees all analysts' risk assessments + predictions
     Synthesizes into composite risk score + final direction
     Weighs analysts by their weight + calibration accuracy

  6. DEBATE (sequential)
     Most bullish analyst argues Blue (defense)
     Most bearish analyst argues Red (challenge)
     Arbitrator synthesizes, adjusts score
     All three informed by full analyst context

  7. TRADE RECOMMENDATION (future)
     Portfolio manager role weighs:
     - Signal strength (arbitrator confidence)
     - Risk (composite score)
     - Analyst agreement (consensus level)
     - Position sizing (calibration-based)
     - Portfolio concentration limits
```

---

## Memory System

Already implemented on `market_analysts` table:
- `memory_patterns` — learned patterns (per-instrument or global)
- `memory_corrections` — self-corrections from evaluated predictions
- `memory_instrument_notes` — persistent per-instrument observations
- `memory_calibration` — accuracy tracking (predictions made, correct, by confidence band)

Memory writes happen during the **learning cycle** when predictions are evaluated. Each analyst gets feedback on their calls and updates their memory.

Since each analyst now runs the full pipeline, memories become richer:
- Technical Analyst remembers: "MSFT bounced off 200 SMA last 3 times"
- Fundamentals Analyst remembers: "AAPL margin compression preceded last 2 selloffs"
- Sentiment Analyst remembers: "When Reddit volume spikes 5x on PLTR, it reverses within 3 days"

---

## Phased Approach

### Phase 1: Foundation (Current Effort)
- Rename analysts to professional names
- Wire learning engine to write analyst memories after evaluation
- Build source abstraction layer (DataSourceAdapter interface)
- Register free-tier sources in data_source_registry
- Create analyst_source_assignments table
- No pipeline changes yet — same 5 analysts doing predictions only

### Phase 2: Per-Analyst Data Sources
- Build context providers for each analyst using the adapter interface:
  - Technical: Twelve Data adapter (RSI, MACD, SMA, Bollinger)
  - Fundamentals: FMP adapter (ratios, earnings) + EDGAR adapter (filings)
  - Sentiment: Finnhub adapter (ratings, insider) + Reddit adapter (posts → LLM scoring)
  - Macro: FRED adapter (economic indicators)
  - Momentum: Twelve Data (ROC) + FMP (screener, sector perf) + Polygon (volume)
- Article scoring becomes per-analyst
- Rate limiting and caching per source

### Phase 3: Per-Analyst Risk Assessment
- Each analyst does their own risk assessment (replace generic dimension system)
- Arbitrator synthesizes risk across all analyst perspectives
- Debate draws Blue/Red from the analyst pool (most bullish vs most bearish)

### Phase 4: Full Pipeline Integration
- Each analyst runs context → articles → risk → prediction as a unit
- Arbitrator synthesizes at each stage
- Memory accumulates across all pipeline stages

### Phase 5: Trade Recommendations
- Portfolio manager role
- Position sizing based on signal + risk + calibration
- Paper trading validation before live recommendations

---

## Upgrade Path: Free → Paid

| Source | Free Limit | Paid Tier | When to Upgrade |
|--------|-----------|-----------|-----------------|
| Twelve Data | 800/day | $29/mo (5,000/day) | When we run >12 instruments or need intraday |
| FMP | 250/day | $14/mo | When free limit hits with 12 instruments × multiple queries |
| Polygon.io | EOD only, 5/min | $29/mo (real-time) | When we need intraday price data |
| Finnhub | 60/min | $42/mo | When we need social sentiment or congressional data |
| FRED | 120/min | N/A — always free | Never |
| SEC EDGAR | 10/sec | N/A — always free | Never |
| Reddit | 100/min | Negotiated | When we go commercial with social sentiment |
| Quiver Quant | Limited | $10-25/mo | When we want WallStreetBets + short interest data |
| Unusual Whales | None | $57/mo | When we add options flow analysis |

**Estimated paid stack when needed: ~$114/month**

---

## Notes

- Only GolferGeek can modify base analysts
- Tenants see output but cannot change analyst configs
- All analysts run as `__base__` — results visible to all orgs
- Source API keys stored in `.env`, never in database
- Rate limiting handled at the adapter level with request queuing
- Caching: data sources cached per-symbol with TTL based on data freshness needs (price: 15min, fundamentals: 24hr, macro: 1hr)
- This is the foundation of the Divinr product differentiator
