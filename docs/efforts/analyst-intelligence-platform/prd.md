# Analyst Intelligence Platform — Product Requirements Document

## 1. Overview

Transform Divinr's analyst system from 5 persona-differentiated analysts sharing the same news feed into 5 specialist analysts, each with their own data sources, full-pipeline participation (article scoring → risk → prediction → debate), persistent memory, and professional identity. Articles remain the shared foundation; specialized data sources are additive layers per analyst.

This is the core product differentiator for Divinr — the analyst layer that tenants pay for but cannot modify. Only GolferGeek controls base analyst configuration.

## 2. Goals & Success Criteria

### Goals
1. Each analyst receives specialized data relevant to their expertise (technical indicators, financial statements, economic data, sentiment feeds, momentum signals)
2. Each analyst scores articles, assesses risk, and makes predictions through their own lens — not just predictions
3. Analysts accumulate memory from evaluated outcomes and apply learned patterns to future analyses
4. Source abstraction allows free → paid tier upgrades without code changes
5. Professional naming replaces novelty names

### Success Criteria
- [ ] All 5 analysts renamed to professional role-descriptive names
- [ ] At least one specialized data source integrated per analyst and producing context
- [ ] Learning engine writes to analyst memory fields after prediction evaluation
- [ ] Analyst memory is injected into prompts and influences predictions (verifiable via artifacts)
- [ ] Per-analyst article scoring produces measurably different relevance scores across analysts for the same article
- [ ] Per-analyst risk assessment produces different risk scores per analyst for the same instrument
- [ ] Source abstraction layer allows adding a new data source without modifying analyst code
- [ ] Debate draws Blue/Red participants from the analyst pool based on bullish/bearish positions
- [ ] All changes run as `__base__` — all orgs see results without per-org duplication

## 3. User Stories / Use Cases

### UC1: Analyst Specialist Data
As a Divinr user, I see that the Technical Analyst's predictions reference RSI, MACD, and support/resistance levels from actual market data — not generic news summaries. The Fundamentals Analyst references P/E ratios and earnings data. Each analyst's rationale is grounded in their specialty's data.

### UC2: Per-Analyst Risk Views
As a user viewing the Risk Dashboard, I see that each analyst has their own risk assessment for an instrument. The Technical Analyst flags resistance breakdown risk while the Fundamentals Analyst shows low risk due to strong balance sheet. The arbitrator synthesizes these into a composite score.

### UC3: Analyst Memory & Learning
As a user over multiple prediction cycles, I observe analysts improving. The Technical Analyst remembers "MSFT bounced off 200 SMA last 3 times" and factors that into future predictions. Analysts that were overconfident in a domain self-correct.

### UC4: Debate from Analyst Pool
As a user viewing a risk debate, I see the most bullish analyst (by their prediction) arguing Blue and the most bearish arguing Red — not generic debate agents. Their arguments reference their own data and perspective.

### UC5: GolferGeek Admin Control
As GolferGeek, I am the only person who can modify base analyst configurations, data source assignments, and memory. Tenants see the output but cannot change how analysts work.

### UC6: Source Upgrade Path
As GolferGeek, when revenue justifies it, I upgrade from Twelve Data free to paid by changing one row in the data_source_registry and adding an API key to `.env`. No code deployment needed.

## 4. Technical Requirements

### 4.1 Architecture

**Current Flow (linear, generic):**
```
articles → generic scoring → predictors → generic predictions → generic risk → generic debate
```

**Target Flow (per-analyst, specialized):**
```
For each instrument:
  articles (shared) ──────────────────────────────┐
                                                   │
  Per analyst (parallel):                          │
    1. Fetch specialized data (adapters)           │
    2. Score articles through analyst lens ◄────────┘
    3. Assess risk through analyst perspective
    4. Make prediction (informed by own data + risk + memory)
  
  Arbitration (sequential):
    5. Synthesize risk across all analysts
    6. Synthesize predictions → final direction
    7. Debate: most bullish = Blue, most bearish = Red
```

**Key architectural note:** The existing `context-provider.service.ts` handles LLM-based knowledge generation. The new `DataSourceAdapter` is a distinct interface for fetching structured data from external APIs (with rate limiting, caching, and error handling). The context provider service will be refactored to orchestrate both LLM-based context providers and API-based data source adapters — this is a meaningful refactor, not a simple extension.

**Instrument parallelism:** Instruments are processed in parallel (not sequentially) to fit within the 30-minute pipeline cycle. With 12 instruments and a 10-minute per-instrument target, parallel processing comfortably fits the cycle.

### 4.2 Data Model Changes

#### Rename existing analysts
Update `display_name` for 5 base analysts:
| Current | New |
|---------|-----|
| Technical Tina — Technical Analyst | Technical Analyst |
| Fundamental Fred — Fundamentals Analyst | Fundamentals Analyst |
| Sentiment Sally — Sentiment & Contrarian Analyst | Sentiment Analyst |
| Aggressive Alex — Momentum Trader | Momentum Analyst |
| Cautious Carl — Risk-Focused Analyst | Macro Strategist |

Also update `slug` values to match: `technical-analyst`, `fundamentals-analyst`, `sentiment-analyst`, `momentum-analyst`, `macro-strategist`.

#### New table: `prediction.data_source_registry`
```sql
CREATE TABLE prediction.data_source_registry (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  provider_type        text NOT NULL CHECK (provider_type IN ('api', 'crawler', 'computed')),
  base_url             text,
  api_key_env_var      text,          -- e.g., 'TWELVE_DATA_API_KEY'
  tier                 text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'paid')),
  rate_limit_per_minute int NOT NULL DEFAULT 60,
  cache_ttl_seconds    int NOT NULL DEFAULT 900,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);
```

#### New table: `prediction.analyst_source_assignments`
```sql
CREATE TABLE prediction.analyst_source_assignments (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  analyst_id  text NOT NULL REFERENCES prediction.market_analysts(id),
  source_id   text NOT NULL REFERENCES prediction.data_source_registry(id),
  data_types  text[] NOT NULL DEFAULT '{}',  -- e.g., '{rsi,macd,sma}'
  priority    int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE(analyst_id, source_id)
);
```

#### Existing table changes: `prediction.market_predictions`
Add column to track which data sources informed the prediction:
```sql
ALTER TABLE prediction.market_predictions 
  ADD COLUMN IF NOT EXISTS source_context jsonb NOT NULL DEFAULT '{}';
```

#### Existing table changes: `prediction.market_predictors`
Add column to track which analyst scored the article:
```sql
ALTER TABLE prediction.market_predictors
  ADD COLUMN IF NOT EXISTS scored_by_analyst_id text;

-- Current constraint: UNIQUE (organization_slug, instrument_id, article_id)
-- Must be replaced to allow per-analyst scoring:
ALTER TABLE prediction.market_predictors
  DROP CONSTRAINT IF EXISTS market_predictors_org_instrument_article_key;
ALTER TABLE prediction.market_predictors
  ADD CONSTRAINT market_predictors_org_instrument_article_analyst_key
  UNIQUE (organization_slug, instrument_id, article_id, scored_by_analyst_id);
```

### 4.3 API Changes

No new public API endpoints required. All changes are internal pipeline behavior. Existing endpoints continue to work:
- `GET /predictions/dashboard` — now returns predictions informed by specialized data
- `GET /risk-assessments` — now returns per-analyst risk assessments instead of per-dimension
- `GET /runs/:runId/risk-details` — dimension assessments replaced by analyst risk assessments
- `GET /analysts` — returns analysts with updated names

#### Internal service changes:

**ContextProviderService** — extend to support `DataSourceAdapter`-based providers:
- `loadContextProviders()` — also load assigned data source adapters per analyst
- `executeContextProviders()` — fetch from data APIs alongside LLM-based providers
- New: `fetchDataSourceContext(analyst, instrument)` — calls assigned adapters, returns formatted data

**PredictorGeneratorService** — per-analyst article scoring:
- `scoreArticleForInstrument()` — loop through each analyst, score article through their persona
- Each analyst produces their own relevance score for each article
- `market_predictors` rows include `scored_by_analyst_id`

**PredictionRunnerService** — inject analyst's own risk assessment:
- `runSingleAnalyst()` — include analyst's risk assessment in the prompt context alongside shared context
- `buildAnalystUserPrompt()` — append specialized data source context per analyst

**RiskRunnerService** — per-analyst risk assessment:
- Replace dimension-based assessment with per-analyst assessment
- Each analyst produces a risk score using their data + perspective
- `RiskScoreAggregationService` aggregates across analysts instead of dimensions
- Debate selects most bullish analyst as Blue, most bearish as Red

**LearningEngineService** — write to analyst memory:
- After prediction evaluation: update `memory_calibration` (total predictions, correct count, by confidence band)
- After wrong prediction: add to `memory_corrections` ("Predicted up for MSFT at 80% confidence but it went down — overweighted momentum signals")
- After right prediction on a non-obvious call: add to `memory_patterns` ("AAPL bounced off 200 SMA — pattern confirmed")
- After instrument-specific observations: add to `memory_instrument_notes`

### 4.4 Frontend Changes

Minimal frontend changes needed — the dashboard and risk views already display whatever the API returns.

**Risk Dashboard (RiskDashboardView.vue):**
- Detail view: instead of "Market Risk / Fundamental Risk / Technical Risk / Macro Risk" dimension cards, show analyst-perspective cards: "Technical Analyst: risk 72" / "Fundamentals Analyst: risk 45" etc.
- `RiskDimensionChart.vue` — rename/adjust labels to show analyst names instead of dimension names
- The data shape remains the same (score, confidence, reasoning, evidence)

**Prediction cards (DashboardView.vue):**
- `shortName()` already handles the em-dash format — will continue to work with new names
- Analyst rationale will now reference specialized data (RSI, P/E ratios, etc.) — no UI change needed

**No new views required.**

### 4.5 Infrastructure Requirements

**External API Keys** (added to `.env`, all free tier):
```
TWELVE_DATA_API_KEY=<free registration>
FMP_API_KEY=<free registration>
FINNHUB_API_KEY=<free registration>
POLYGON_API_KEY=<free registration>
FRED_API_KEY=<free registration>
```

**Rate limiting:** Each adapter must implement request queuing to stay within free-tier limits:
- Twelve Data: 8 requests/minute
- FMP: ~4 requests/minute (250/day ÷ 60 min of active pipeline)
- Finnhub: 60 requests/minute
- Polygon.io: 5 requests/minute
- FRED: 120 requests/minute
- SEC EDGAR: 10 requests/second (600/minute)

**Caching:** Data source results cached per-symbol with TTL:
- Price/technical data: 15 minutes
- Fundamental data: 24 hours
- Macro/economic data: 1 hour
- Sentiment data: 30 minutes

Cache stored in-memory (Map) with TTL eviction. No external cache service needed at current scale.

**Upgrade budget:** Full paid stack estimated at ~$114/month (Twelve Data $29 + FMP $14 + Polygon.io $29 + Finnhub $42). FRED and SEC EDGAR are permanently free.

## 5. Non-Functional Requirements

### Performance
- Per-analyst data fetching runs in parallel across analysts (not sequential)
- Data source caching prevents redundant API calls within TTL
- Total pipeline time per instrument should not exceed 10 minutes (5 analysts × parallel fetch + sequential arbitration/debate)
- Rate limiting must never cause API key bans — queue excess requests rather than drop them

### Security
- API keys stored in `.env`, never in database
- `api_key_env_var` column in `data_source_registry` stores the env var name, not the key
- External API responses are treated as untrusted input — validated before injection into LLM prompts
- Only GolferGeek can modify `__base__` analyst records (enforced by existing RBAC)

### Scalability
- 12 instruments × 5 analysts × ~5 data fetches each = ~300 external API calls per pipeline cycle
- Free-tier rate limits support this at 30-minute cycle intervals
- Adding instruments increases API usage linearly — paid tiers needed beyond ~20 instruments

### Compatibility
- All existing A2A capabilities continue to work unchanged
- Orchestrator Enterprise sees richer data (analyst-specific reasoning, specialized data references) with no contract changes
- Existing prediction and risk data remains accessible — new data supplements, doesn't replace

## 6. Out of Scope

- **Paid data source tiers** — start free, upgrade when revenue justifies
- **Electron desktop app** — separate future effort
- **Polymarket / betting / election domains** — separate future efforts
- **Azure cloud deployment** — triggered by revenue
- **Mobile-specific features** — web works on mobile via Ionic
- **Real-time streaming data** — batch pipeline on 30-minute cycles
- **Custom per-tenant analysts** — tenants see base analyst output only
- **Trade execution** — trade recommendations are Phase 6, execution is beyond this effort

## 7. Dependencies & Risks

### External Dependencies
| Dependency | Risk | Mitigation |
|-----------|------|------------|
| Twelve Data API availability | Free tier could be restricted/removed | Adapter interface allows swapping to Polygon.io or Alpha Vantage |
| FMP API availability | Free tier could be restricted | SEC EDGAR provides same data (raw, requires parsing) |
| Finnhub API availability | Free tier could be restricted | Fall back to LLM-based article sentiment scoring only |
| FRED API | Very low risk — government service | No mitigation needed |
| Reddit API | Rate limits, commercial use restrictions | Start with non-commercial use; degrade gracefully if blocked |
| Ollama/LLM availability | Local LLM on Spark | Deterministic fallbacks exist for all LLM calls |

### Technical Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Free-tier rate limits too restrictive for 12 instruments | Incomplete data for some analysts | Request queuing + prioritize highest-signal instruments first |
| LLM context window overflow with specialized data | Truncated or degraded analysis | Cap data injection per source (1500 chars), prioritize most recent data |
| Per-analyst article scoring = 5x current LLM calls for scoring | Pipeline cycle time increases | Score articles in parallel across analysts; cache scores |
| Per-analyst risk assessment = 5x current risk runs | Pipeline cycle time increases | Run risk in parallel per analyst; arbitrator is the only sequential step |
| Memory accumulation becomes noise over time | Analyst performance degrades | Cap memory arrays (e.g., 20 patterns, 10 corrections, 10 notes per instrument); age-based decay |
| Risk system migration (dimension → per-analyst) breaks historical data and dashboard | Users lose access to existing risk assessments; dashboard errors | Keep `risk_dimension_assessments` read-only for historical data; new `analyst_risk_assessments` table for new runs; frontend detects which format and renders accordingly |

## 8. Phasing

### Phase 1: Foundation
**Goal:** Rename analysts, activate memory writing, build the source abstraction layer. No pipeline behavior changes — the system works the same but is ready for specialization.

**Deliverables:**
- Analysts renamed to professional names (DB update + slug update)
- Learning engine writes to `memory_calibration`, `memory_corrections`, `memory_patterns`, and `memory_instrument_notes` after prediction evaluation
- `data_source_registry` and `analyst_source_assignments` tables created
- `DataSourceAdapter` interface defined
- Free-tier sources registered in registry (Twelve Data, FMP, Finnhub, FRED, Polygon.io, SEC EDGAR, Reddit)
- Analyst-source assignments seeded for all 5 analysts

**Validation:** Run a prediction cycle → evaluate outcomes → verify memory fields are populated. Query `data_source_registry` and `analyst_source_assignments` to confirm seeding.

### Phase 2: Data Source Adapters
**Goal:** Build adapters for each external data source and wire them into the context provider system. Analysts start receiving specialized data alongside articles.

**Deliverables:**
- Adapters implemented: Twelve Data (technical indicators), FMP (fundamentals/ratios), SEC EDGAR (filings), Finnhub (ratings/insider), FRED (macro), Polygon.io (OHLCV/volume), Reddit (social posts)
- Rate limiting and in-memory caching per adapter
- Context provider service extended to call adapters based on `analyst_source_assignments`
- Each analyst's prediction prompt now includes their specialized data section
- `source_context` recorded on `market_predictions` for audit trail

**Validation:** Run a prediction cycle. Check `market_run_artifacts` — each analyst's prompt should contain their specialized data. Technical Analyst mentions RSI/MACD values, Fundamentals Analyst mentions P/E ratios, etc.

### Phase 3: Per-Analyst Article Scoring
**Goal:** Each analyst scores articles through their own lens. The same article gets 5 different relevance scores.

**Deliverables:**
- `predictor-generator` loops through personality analysts for each article × instrument pair
- Each analyst uses their persona to score relevance (Technical: "mentions price levels?" / Fundamentals: "mentions earnings?")
- `market_predictors` rows include `scored_by_analyst_id`
- Signal threshold (`MARKETS_SIGNAL_THRESHOLD`) evaluated per-analyst — each analyst has their own predictor pool
- Prediction runs per analyst are triggered when *that analyst's* signal threshold is met

**Validation:** Score a batch of articles. Verify that the Technical Analyst gives high scores to articles mentioning price action and low scores to earnings articles, and vice versa for the Fundamentals Analyst.

### Phase 4: Per-Analyst Risk Assessment
**Goal:** Replace the generic 4-dimension risk system with per-analyst risk perspectives. Each analyst assesses risk through their own data and lens.

**Deliverables:**
- Risk runner refactored: instead of iterating dimensions, iterates analysts
- Each analyst produces a risk score + reasoning using their specialized data
- Arbitrator synthesizes per-analyst risk scores into composite (weighted by analyst weight + calibration)
- Debate selects most bullish analyst prediction as Blue, most bearish as Red
- Risk dashboard updated to show analyst-perspective cards instead of dimension cards
- New `analyst_risk_assessments` table for per-analyst risk scores; existing `risk_dimension_assessments` preserved read-only for historical data

**Validation:** Run risk for an instrument. Verify 5 different risk scores from 5 different perspectives. Verify debate participants are drawn from the analyst pool.

### Phase 5: Full Pipeline Integration
**Goal:** Each analyst runs the complete pipeline as a unit. The arbitrator synthesizes at each stage. Memory accumulates across all pipeline stages.

**Deliverables:**
- Single orchestration: per analyst → fetch data → score articles → assess risk → predict
- Arbitrator synthesizes at article level (which articles matter most?), risk level, and prediction level
- Memory writes after each stage, not just prediction evaluation
- Pipeline metrics tracked per-analyst (time, LLM calls, data source calls)

**Validation:** End-to-end pipeline run for all instruments. Each analyst's memory grows. Arbitrator output reflects cross-analyst synthesis. Pipeline completes within 30-minute cycle target.

### Phase 6: Trade Recommendations (Future)
**Goal:** Add a portfolio manager role that converts predictions + risk into trade recommendations.

**Deliverables:**
- Portfolio manager analyst (new role, not personality)
- Position sizing based on: arbitrator confidence, composite risk, analyst consensus level, calibration accuracy
- Paper trading validation (3-day paper mode before live recommendations)
- BUY/SELL recommendations replace current manual buttons

**Validation:** Paper trading for 2 weeks. Compare portfolio manager recommendations against actual outcomes. Verify position sizing is calibration-aware.
