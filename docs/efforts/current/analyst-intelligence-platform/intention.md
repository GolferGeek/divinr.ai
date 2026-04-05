# Analyst Intelligence Platform — Intention

## What This Effort Is

Transform Divinr from a prediction platform where 5 generic analysts all see the same news into an **analyst intelligence platform** where each analyst is a specialist with their own data sources, their own risk perspective, their own memory, and their own track record — carrying that perspective through the entire pipeline from article scoring to trade recommendation.

## Why It Matters

The current system works end-to-end but every analyst sees the same MarketWatch/Reuters articles and makes predictions with the same context. They differ only by persona prompt. That's not enough differentiation to produce genuinely diverse perspectives, and it's not enough intelligence to produce accurate predictions.

Real analysts have different data feeds. A technical analyst reads charts, not earnings reports. A fundamentals analyst reads 10-Ks, not RSI indicators. When they disagree, it's because they're looking at different information — not because they have different adjectives in their system prompt.

This effort makes each analyst a true specialist with:
- **Their own data sources** — technical indicators, financial statements, economic data, sentiment feeds
- **Their own pipeline** — each analyst scores articles, assesses risk, and makes predictions through their unique lens
- **Their own memory** — learned patterns, self-corrections, instrument-specific notes, calibration stats
- **Professional identity** — role-descriptive names, not cute nicknames

## What's Already Done (from Move to Spark effort)

- Platform running on DGX Spark (API port 7100, web port 7101)
- 5 base analysts making predictions with memory columns on the table
- Full risk pipeline with 4-dimension analysis and Blue/Red/Arbiter debate
- 11 A2A capabilities live with service API key auth
- All pipeline runs as `__base__` — all orgs see results
- Signal-based prediction thresholds (cumulative relevance + urgent trigger)
- Dashboard showing predictions with analyst names and risk with full detail
- Cloudflare DNS configured for divinr.ai
- Orchestrator Enterprise integration (service API keys + machine identity)

## Core Design Decisions

### 1. Each Analyst Runs the Full Pipeline
Not just predictions. Each analyst does: article scoring → risk assessment → prediction → debate participation. The arbitrator synthesizes at each stage across all analysts.

### 2. Articles as Shared Foundation, Specialization as Additive
All analysts see the same crawled articles — that's the shared "what's happening in the world" layer that grounds them in current events. But each analyst interprets articles through their own lens and *also* receives specialized data on top. The Technical Analyst reads "MSFT broke through $385" and thinks about chart patterns; the Fundamentals Analyst reads the same article and focuses on the earnings guidance buried in paragraph three. Articles are the common ground; specialized data sources (indicators, filings, economic data, sentiment feeds) are additive layers that give each analyst the tools to analyze those events through their expertise.

### 3. Per-Analyst Data Sources
Each analyst has assigned specialized data sources through a source abstraction layer. The same interface handles free and paid tiers — upgrading is a config change, not a code rewrite.

### 4. Free-Tier First
Start with free APIs (FRED, SEC EDGAR, Finnhub free, Twelve Data free, Polygon.io free). Build the pipeline so paid upgrades are trivial when revenue justifies them. ~$114/month gets the full paid stack when needed.

### 5. Sentiment via LLM
No paid sentiment APIs. The Sentiment Analyst runs our existing articles + Reddit posts through their persona to extract sentiment signals. Our LLM does the scoring.

### 6. Professional Names
"Technical Analyst", "Fundamentals Analyst", "Macro Strategist" — not "Technical Tina". The persona drives behavior, the name describes the role.

### 7. Only GolferGeek Modifies Base Analysts
All base analysts are `__base__`. Tenants see output but cannot change analyst configurations, data sources, or memory. This is the product differentiator.

## What Needs to Happen

### Phase 1: Foundation
- Rename analysts to professional names
- Wire learning engine to write analyst memories after prediction evaluation
- Build source abstraction layer (DataSourceAdapter interface)
- Create `data_source_registry` and `analyst_source_assignments` tables
- Register free-tier sources

### Phase 2: Data Source Adapters
- Build adapters for each external data source (Twelve Data, FMP, SEC EDGAR, Finnhub, FRED, Polygon.io, Reddit)
- Wire adapters into context provider system based on analyst_source_assignments
- Rate limiting and caching per source
- Each analyst's prediction prompt now includes their specialized data

### Phase 3: Per-Analyst Article Scoring
- Each analyst scores articles through their own lens (5 scores per article)
- Per-analyst predictor pools with independent signal thresholds
- Update market_predictors unique constraint to allow per-analyst rows

### Phase 4: Per-Analyst Risk Assessment
- Each analyst does their own risk assessment (replace generic dimension system)
- Arbitrator synthesizes risk across all analyst perspectives
- Debate draws Blue/Red from the analyst pool (most bullish vs most bearish)
- Historical dimension-based risk data preserved read-only

### Phase 5: Full Pipeline Integration
- Each analyst runs context → articles → risk → prediction as a unit
- Arbitrator synthesizes at each stage
- Memory accumulates across all pipeline stages

### Phase 6: Trade Recommendations
- Portfolio manager role
- Position sizing based on signal + risk + calibration
- Paper trading validation before live recommendations

## What This Effort Does NOT Include

- Electron desktop app (future effort)
- Polymarket / betting market integration (future domain)
- Election prediction integration (future domain)
- Azure cloud deployment (triggered by revenue)
- Mobile-specific features (web works on mobile via Ionic)
- Paid data source tiers (start free, upgrade when revenue justifies)
- Real-time streaming data (batch pipeline on 30-minute cycles)
- Custom per-tenant analysts (tenants see base analyst output only)
- Trade execution (trade recommendations are in scope; execution is not)

## Supporting Documents

- [Analyst Pipeline Redesign](analyst-pipeline-redesign.md) — full technical plan
- [Data Sources Investigation](data-sources-investigation.md) — API research per analyst type
