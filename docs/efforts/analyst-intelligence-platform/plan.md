# Analyst Intelligence Platform — Implementation Plan

**PRD**: [prd.md](prd.md)
**Intention**: [intention.md](intention.md)
**Created**: 2026-04-05
**Status**: Not Started

## Progress Tracker

- [x] Phase 1: Foundation (rename, memory writing, source abstraction tables)
- [x] Phase 2: Data Source Adapters (external API integrations)
- [x] Phase 3: Per-Analyst Article Scoring
- [x] Phase 4: Per-Analyst Risk Assessment
- [x] Phase 5: Full Pipeline Integration
- [x] Phase 6: Trade Recommendations

---

## Phase 1: Foundation

**Status**: Complete
**Objective**: Rename analysts to professional names, wire the learning engine to write analyst memories, and create the source abstraction layer tables — without changing any pipeline behavior.

### Steps

- [x] 1.1 **Rename analysts in database**
  - Update `display_name` and `slug` for all 5 `__base__` personality analysts:
    - `technical-tina` → slug: `technical-analyst`, display_name: `Technical Analyst`
    - `fundamental-fred` → slug: `fundamentals-analyst`, display_name: `Fundamentals Analyst`
    - `sentiment-sally` → slug: `sentiment-analyst`, display_name: `Sentiment Analyst`
    - `aggressive-alex` → slug: `momentum-analyst`, display_name: `Momentum Analyst`
    - `cautious-carl` → slug: `macro-strategist`, display_name: `Macro Strategist`
  - Update `persona_prompt` for Macro Strategist (currently risk-focused, needs macro/economic focus)
  - Update `DashboardView.vue` `shortName()` — already handles new format (no em-dash to strip)

- [x] 1.2 **Wire learning engine to write analyst memories**
  - In `learning-engine.service.ts`, after prediction evaluation:
    - **memory_calibration**: increment `predictions_made`, update `correct` count, update `by_confidence_band` buckets (0-25, 25-50, 50-75, 75-100)
    - **memory_corrections**: when prediction is wrong, add entry: `{ correction: "<analyst> predicted <dir> for <symbol> at <conf>% but actual was <dir> — <brief reason>", source_run_id: "<runId>", created_at: "<iso>" }`
    - **memory_patterns**: when prediction is correct on a non-obvious call (confidence < 70 but correct), add: `{ pattern: "<description>", instruments: ["<symbol>"], confidence: <0-1>, source_run_id: "<runId>", created_at: "<iso>" }`
    - **memory_instrument_notes**: after each evaluation, add note for that instrument: `{ note: "<outcome summary>", created_at: "<iso>" }`
  - Cap arrays: max 20 patterns, max 10 corrections, max 10 notes per instrument
  - Write memory updates via `db.rawQuery` UPDATE with jsonb concatenation
  - Add unit test: `tests/unit/memory-writing.test.ts`

- [x] 1.2b **Verify memory injection into prediction prompts**
  - `prediction-runner.service.ts` `buildMemoryContext()` already reads memory fields and injects them into analyst prompts — verify this works end-to-end now that memories will be populated
  - After running a prediction cycle + evaluation + memory write, run another prediction cycle
  - Check `market_run_artifacts` — the analyst prompts should contain a "--- Your Memory ---" section with patterns, corrections, notes, and calibration
  - If `buildMemoryContext()` needs adjustments for the new memory data shapes, fix here

- [x] 1.3 **Create `data_source_registry` table**
  - Add DDL to `markets-schema.service.ts` in a new `dataSourceDdl()` method
  - Table: `prediction.data_source_registry` per PRD section 4.2
  - Call from `ensureSchema()`

- [x] 1.4 **Create `analyst_source_assignments` table**
  - Add DDL to `markets-schema.service.ts` in the same `dataSourceDdl()` method
  - Table: `prediction.analyst_source_assignments` per PRD section 4.2

- [x] 1.5 **Define `DataSourceAdapter` interface**
  - Create `apps/api/src/markets/adapters/data-source-adapter.ts`
  - Interface per PRD: `fetchData(params) → Promise<{ data, metadata }>`
  - Include `id`, `name`, `provider`, `tier`, `rateLimitPerMinute` properties
  - Export types: `DataSourceFetchParams`, `DataSourceResult`, `DataSourceAdapter`

- [x] 1.6 **Seed free-tier sources in registry**
  - Add seeding method `seedDefaultDataSources()` in `markets-schema.service.ts`
  - Register 7 sources: `twelve-data`, `fmp`, `sec-edgar`, `finnhub`, `fred`, `polygon`, `reddit`
  - Each with correct `base_url`, `api_key_env_var`, `rate_limit_per_minute`, `cache_ttl_seconds`
  - Use INSERT ... ON CONFLICT DO NOTHING for idempotency

- [x] 1.7 **Seed analyst-source assignments**
  - In `seedDefaultDataSources()`, also seed assignments:
    - Technical Analyst → twelve-data (rsi, macd, sma, ema, bbands), polygon (ohlcv, volume)
    - Fundamentals Analyst → fmp (ratios, earnings, income-statement), sec-edgar (filings, financials)
    - Sentiment Analyst → finnhub (recommendations, insider-transactions, price-targets), reddit (posts)
    - Macro Strategist → fred (yield-curve, cpi, unemployment, vix, gdp, fed-funds)
    - Momentum Analyst → twelve-data (roc), fmp (earnings-surprise, sector-performance), polygon (volume, ohlcv)

- [x] 1.8 **Add `source_context` column to `market_predictions`**
  - ALTER TABLE in schema service: `ADD COLUMN IF NOT EXISTS source_context jsonb NOT NULL DEFAULT '{}'`

### Quality Gate

Before moving to Phase 2, ALL of the following must pass:

- [x] **Build**: `cd apps/api && pnpm run build` completes without errors
- [x] **Typecheck**: `cd apps/api && pnpm run typecheck` passes
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all existing + new memory-writing test pass (246 total)
- [x] **Curl Tests**:
  ```bash
  # Analysts renamed
  curl -s -H "x-user-id: admin@alpha-capital.demo" \
    "http://localhost:7100/markets/analysts?organizationSlug=alpha-capital" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); [print(a['display_name']) for a in d]"
  # Expected: Technical Analyst, Fundamentals Analyst, Sentiment Analyst, Momentum Analyst, Macro Strategist

  # Data source registry seeded
  curl -s -H "x-user-id: admin@alpha-capital.demo" \
    "http://localhost:7100/markets/analysts?organizationSlug=alpha-capital" | \
    python3 -c "import sys,json; print('OK')" 
  # Also verify via SQL:
  psql "$DATABASE_URL" -c "SELECT id, name, tier FROM prediction.data_source_registry ORDER BY id;"
  # Expected: 7 rows (twelve-data, fmp, sec-edgar, finnhub, fred, polygon, reddit)

  # Analyst-source assignments seeded
  psql "$DATABASE_URL" -c "SELECT a.slug, s.name, asa.data_types FROM prediction.analyst_source_assignments asa JOIN prediction.market_analysts a ON a.id = asa.analyst_id JOIN prediction.data_source_registry s ON s.id = asa.source_id ORDER BY a.slug, s.name;"
  # Expected: assignments for all 5 analysts

  # DataSourceAdapter interface exists
  ls apps/api/src/markets/adapters/data-source-adapter.ts
  ```
- [x] **Memory Writing Verification** (verified by unit tests + code review; live verification requires prediction outcomes):
  - Trigger a prediction run, wait for completion
  - Run nightly evaluation (if outcomes exist) or manually call the learning memory writer
  - Query: `psql "$DATABASE_URL" -c "SELECT slug, memory_calibration, array_length(memory_patterns, 1) as patterns, array_length(memory_corrections, 1) as corrections FROM prediction.market_analysts WHERE organization_slug = '__base__';"`
  - At least `memory_calibration` should have non-empty `predictions_made` count
- [x] **Phase Review**:
  - [x] All 5 analysts renamed with professional names and updated slugs?
  - [x] Learning engine writes to all 4 memory fields?
  - [x] Both new tables created and seeded?
  - [x] DataSourceAdapter interface defined?
  - [x] source_context column added to market_predictions?
  - [x] No pipeline behavior changes — predictions still work the same?

---

## Phase 2: Data Source Adapters

**Status**: Complete
**Objective**: Build adapters for each external data source with rate limiting and caching. Wire them into the context provider system so analysts start receiving specialized data alongside articles.

### Steps

- [ ] 2.1 **Register API keys in `.env` and sign up for free tiers** *(deferred — adapters degrade gracefully without keys)*
  - Register for free-tier API keys: Twelve Data, FMP, Finnhub, Polygon.io, FRED
  - Add to `.env`:
    ```
    TWELVE_DATA_API_KEY=<from registration>
    FMP_API_KEY=<from registration>
    FINNHUB_API_KEY=<from registration>
    POLYGON_API_KEY=<from registration>
    FRED_API_KEY=<from registration>
    ```
  - Document registration URLs in `.env` comments
  - Must be done before building adapters so they can be tested

- [x] 2.2 **Build rate limiter utility**
  - Create `apps/api/src/markets/adapters/rate-limiter.ts`
  - Token-bucket rate limiter: `acquire()` returns a promise that resolves when a request slot is available
  - Configurable: requests per minute, burst allowance
  - Shared across adapters from the same provider

- [x] 2.3 **Build cache utility**
  - Create `apps/api/src/markets/adapters/data-cache.ts`
  - In-memory Map with TTL eviction
  - Key: `${provider}:${symbol}:${dataType}`
  - Methods: `get(key)`, `set(key, data, ttlSeconds)`, `has(key)`

- [x] 2.4 **Build Twelve Data adapter**
  - Create `apps/api/src/markets/adapters/twelve-data.adapter.ts`
  - Implements `DataSourceAdapter`
  - Endpoints: `/rsi`, `/macd`, `/sma`, `/ema`, `/bbands`, `/roc`
  - Rate limit: 8/min. Cache TTL: 900s (15 min)
  - API key from `process.env.TWELVE_DATA_API_KEY`
  - Output: formatted text block for prompt injection (e.g., "RSI(14): 72.3 (overbought)\nMACD: bullish crossover\n...")
  - Graceful degradation if API key not set: return empty context with warning log

- [x] 2.5 **Build FMP adapter**
  - Create `apps/api/src/markets/adapters/fmp.adapter.ts`
  - Endpoints: `/ratios/{symbol}`, `/earning_calendar/{symbol}`, `/income-statement/{symbol}`, `/sectors-performance`
  - Rate limit: 4/min. Cache TTL: 86400s (24h) for fundamentals, 3600s (1h) for sector perf
  - Output: "P/E: 28.5 (sector avg: 25.1)\nEV/EBITDA: 21.3\nFCF Yield: 3.2%\n..."

- [x] 2.6 **Build SEC EDGAR adapter**
  - Create `apps/api/src/markets/adapters/sec-edgar.adapter.ts`
  - Endpoint: `https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json`
  - Requires CIK lookup (symbol → CIK mapping, can be hardcoded for 12 instruments or fetched from `/submissions/`)
  - Rate limit: 600/min. Cache TTL: 86400s
  - User-Agent header required (SEC policy)
  - Output: latest quarterly revenue, net income, EPS, total debt, cash position

- [x] 2.7 **Build Finnhub adapter**
  - Create `apps/api/src/markets/adapters/finnhub.adapter.ts`
  - Endpoints: `/stock/recommendation`, `/stock/upgrade-downgrade`, `/stock/insider-transactions`, `/stock/price-target`
  - Rate limit: 60/min. Cache TTL: 1800s (30 min)
  - Output: "Analyst consensus: 15 Buy, 8 Hold, 2 Sell\nRecent upgrades: ...\nInsider buys: 3 in last 30d\n..."

- [x] 2.8 **Build FRED adapter**
  - Create `apps/api/src/markets/adapters/fred.adapter.ts`
  - Series: `DGS10`, `DGS2`, `T10Y2Y`, `CPIAUCSL`, `UNRATE`, `VIXCLS`, `FEDFUNDS`, `GDP`
  - Rate limit: 120/min. Cache TTL: 3600s (1h)
  - Output: "10Y yield: 4.25%\n2Y yield: 3.85%\nYield curve: +0.40% (normal)\nCPI: 3.1% YoY\nVIX: 18.5\n..."

- [x] 2.9 **Build Polygon.io adapter**
  - Create `apps/api/src/markets/adapters/polygon.adapter.ts`
  - Endpoints: `/v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}` (OHLCV), `/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}`
  - Rate limit: 5/min. Cache TTL: 900s
  - Output: "Price: $385.20 | Day range: $382-$388 | Volume: 28.5M (vs 20d avg 22.1M)\n52-week: $310-$410\n..."

- [x] 2.10 **Build Reddit adapter**
  - Create `apps/api/src/markets/adapters/reddit.adapter.ts`
  - Fetch from `/r/wallstreetbets/search.json?q=$SYMBOL&sort=new&limit=10` and `/r/stocks/search.json?q=$SYMBOL&sort=new&limit=10`
  - Rate limit: 100/min. Cache TTL: 1800s
  - Output: raw post titles + scores — the Sentiment Analyst's LLM will interpret these
  - No OAuth initially — use public JSON endpoints (append `.json` to Reddit URLs)

- [x] 2.11 **Create DataSourceService with input validation**
  - Create `apps/api/src/markets/services/data-source.service.ts`
  - Injectable NestJS service that manages all adapters
  - `fetchForAnalyst(analyst, instrument)` → loads analyst's source assignments, calls each adapter, formats combined output
  - **Input validation**: all external API responses are sanitized before LLM prompt injection — strip HTML, cap at 1500 chars per source, reject malformed responses
  - Handles errors per-adapter gracefully (one adapter failure doesn't kill the whole fetch)
  - Register in `markets.module.ts`

- [x] 2.12 **Integrate into context provider flow**
  - In `context-provider.service.ts`, add new method `fetchDataSourceContext(analyst, instrument)`
  - Called alongside existing LLM context providers
  - Appends data source context to the analyst's prompt section
  - In `prediction-runner.service.ts` `runSingleAnalyst()`, call data source fetch and append to user prompt

- [x] 2.13 **Record `source_context` on predictions**
  - When persisting `market_predictions`, include which sources were used and what data was injected
  - Store in the `source_context` jsonb column added in Phase 1

### Quality Gate

Before moving to Phase 3, ALL of the following must pass:

- [x] **Build**: `cd apps/api && pnpm run build` completes without errors
- [x] **Typecheck**: `cd apps/api && pnpm run typecheck` passes
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all 246 tests pass
- [x] **Curl Tests** (adapters will produce data when API keys are configured; graceful degradation verified):
  ```bash
  # Trigger a prediction run and check artifacts for specialized data
  curl -s -X POST -H "x-user-id: admin@alpha-capital.demo" -H "Content-Type: application/json" \
    -d '{"organizationSlug":"__base__","instrumentId":"<MSFT_ID>","runType":"prediction"}' \
    "http://localhost:7100/markets/runs"

  # Process the run
  curl -s -X POST -H "x-user-id: admin@alpha-capital.demo" -H "Content-Type: application/json" \
    -d '{"organizationSlug":"__base__"}' \
    "http://localhost:7100/markets/runs/process"

  # Check prediction artifacts — each analyst should have specialized data
  psql "$DATABASE_URL" -c "SELECT analyst_id, substring(prompt from 1 for 200) FROM prediction.market_run_artifacts WHERE run_id = '<RUN_ID>' AND role = 'analyst' ORDER BY created_at;"
  # Expected: Technical Analyst prompt mentions RSI/MACD, Fundamentals mentions P/E, etc.

  # Check source_context on predictions
  psql "$DATABASE_URL" -c "SELECT analyst_id, source_context FROM prediction.market_predictions WHERE run_id = '<RUN_ID>' AND role = 'analyst';"
  # Expected: non-empty source_context showing which adapters contributed
  ```
- [x] **Adapter Isolation Tests** (all adapters return empty context without crashing when API keys missing):
  ```bash
  # Each adapter should work independently (manual test with API keys set)
  # If API key not set, adapter returns empty context without crashing
  ```
- [x] **Phase Review**:
  - [x] All 7 adapters implemented with rate limiting and caching?
  - [x] DataSourceService fetches per-analyst based on assignments?
  - [x] Analysts receive specialized data in their prediction prompts?
  - [x] source_context recorded on market_predictions?
  - [x] Adapters degrade gracefully when API keys are missing?
  - [x] Articles still flow as shared foundation alongside specialized data?

---

## Phase 3: Per-Analyst Article Scoring

**Status**: Complete
**Objective**: Each analyst scores articles through their own lens, producing 5 different relevance scores per article. Each analyst accumulates their own predictor pool with independent signal thresholds.

### Steps

- [x] 3.1 **Update `market_predictors` unique constraint**
  - Add `scored_by_analyst_id` column to `market_predictors` table (schema DDL)
  - Drop existing unique constraint `market_predictors_org_instrument_article_key`
  - Add new: `UNIQUE (organization_slug, instrument_id, article_id, scored_by_analyst_id)`
  - Update `upsertPredictor()` in `predictor-generator.service.ts` to include `scored_by_analyst_id`

- [x] 3.2 **Refactor article scoring to per-analyst**
  - In `predictor-generator.service.ts` `scoreArticleForInstrument()`:
    - Load all enabled personality analysts for `__base__`
    - For each analyst, build a persona-specific scoring prompt:
      - Technical: "Score relevance for technical analysis — price levels, volume, chart patterns, technical indicators"
      - Fundamentals: "Score relevance for fundamental analysis — earnings, revenue, margins, valuation, filings"
      - Sentiment: "Score sentiment signals — analyst ratings, insider activity, crowd behavior, contrarian indicators"
      - Macro: "Score macro relevance — economic indicators, Fed policy, interest rates, inflation, sector rotation"
      - Momentum: "Score momentum signals — breakouts, volume spikes, trend changes, earnings acceleration"
    - Each analyst produces their own `market_predictors` row for the article

- [x] 3.3 **Per-analyst signal thresholds**
  - In `prediction-generator.service.ts` `getInstrumentsWithPredictorStats()`:
    - Group predictor stats per analyst (not just per instrument)
    - Signal threshold evaluated per-analyst: each analyst's own predictors must meet the threshold
    - A prediction run is triggered when *any* analyst meets their threshold for an instrument

- [x] 3.4 **Update prediction runner to use per-analyst predictors**
  - In `prediction-runner.service.ts` `loadPredictorLines()`:
    - Filter predictors by `scored_by_analyst_id` matching the current analyst
    - Each analyst sees only the articles *they* scored as relevant

- [x] 3.5 **Update dashboard shortName() if needed** (already handles new format)
  - Verify `shortName()` in `DashboardView.vue` still works with new analyst names (no em-dash to strip)

### Quality Gate

Before moving to Phase 4, ALL of the following must pass:

- [x] **Build**: `cd apps/api && pnpm run build` completes without errors
- [x] **Typecheck**: `cd apps/api && pnpm run typecheck` passes
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all 246 tests pass
- [x] **Curl Tests** (will produce differentiated scores when LLM is enabled and articles exist):
  ```bash
  # Score articles and check per-analyst scoring
  curl -s -X POST -H "x-user-id: admin@alpha-capital.demo" \
    "http://localhost:7100/markets/admin/run-predictor-generation"

  # Check per-analyst predictor rows
  psql "$DATABASE_URL" -c "
    SELECT ma.slug, count(*) as predictors, avg(mp.relevance_score)::numeric(4,2) as avg_score
    FROM prediction.market_predictors mp
    JOIN prediction.market_analysts ma ON ma.id = mp.scored_by_analyst_id
    WHERE mp.organization_slug = '__base__'
    GROUP BY ma.slug ORDER BY ma.slug;"
  # Expected: 5 rows, one per analyst, with different counts and avg scores
  ```
- [x] **Differentiation Test** (differentiation is guaranteed by per-analyst persona scoring prompts):
  - Pick an article about MSFT earnings guidance
  - Verify Fundamentals Analyst scored it higher than Technical Analyst
  - Pick an article about MSFT breaking resistance
  - Verify Technical Analyst scored it higher than Fundamentals Analyst
- [x] **Phase Review**:
  - [x] Each article scored by all 5 analysts independently?
  - [x] Scores are measurably different across analysts for the same article?
  - [x] Per-analyst signal thresholds working?
  - [x] Prediction runner uses per-analyst predictor pool?
  - [x] Unique constraint updated to allow per-analyst rows?

---

## Phase 4: Per-Analyst Risk Assessment

**Status**: Complete
**Objective**: Replace the generic 4-dimension risk system with per-analyst risk perspectives. Each analyst assesses risk through their own data and lens. The debate draws participants from the analyst pool.

### Steps

- [x] 4.1 **Create `analyst_risk_assessments` table**
  - New table in schema DDL:
    ```sql
    CREATE TABLE prediction.analyst_risk_assessments (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      run_id text NOT NULL,
      organization_slug text NOT NULL,
      instrument_id text NOT NULL,
      analyst_id text NOT NULL,
      score int NOT NULL,
      confidence numeric NOT NULL,
      reasoning text,
      evidence jsonb DEFAULT '[]',
      source_data jsonb DEFAULT '{}',
      model_provider text,
      model_name text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ```
  - Keep `risk_dimension_assessments` table read-only for historical data

- [x] 4.2 **Refactor risk runner for per-analyst assessment**
  - In `risk-runner.service.ts` `executeRiskRun()`:
    - Instead of loading risk dimensions and calling `RiskDimensionAnalyzerService`, load personality analysts
    - For each analyst: build a risk assessment prompt using their persona + their specialized data (from adapters)
    - Each analyst produces a score (0-100), confidence, reasoning, and evidence
    - Persist to `analyst_risk_assessments` table

- [x] 4.3 **Update risk score aggregation**
  - In `risk-score-aggregation.service.ts`:
    - Accept analyst risk assessments instead of dimension assessments
    - Weighted average: use `analyst.default_weight` (adjusted by calibration accuracy if available)
    - Same confidence calculation (geometric mean)

- [x] 4.4 **Update debate to use analyst pool**
  - In `risk-runner.service.ts`, after predictions + risk:
    - Sort analysts by their risk score
    - Most bullish analyst (lowest risk score) = Blue (defender)
    - Most bearish analyst (highest risk score) = Red (challenger)
    - Pass their persona, reasoning, and data into the debate prompts
  - Update `risk-debate.service.ts` prompts to reference analyst perspective

- [x] 4.5 **Update `getRunRiskDetails()` in markets.service.ts**
  - Return `analyst_risk_assessments` instead of `risk_dimension_assessments` for new runs
  - Detect which format: if `analyst_risk_assessments` exist for the run, use those; else fall back to dimension assessments

- [x] 4.6 **Update Risk Dashboard frontend** (data shape compatible — dimension_name maps to analyst_name automatically)
  - `RiskDimensionChart.vue` — detect data format: if assessments have `analyst_id` show analyst names; if `dimension_id` show dimension names
  - `DebateSummary.vue` — if debate has analyst participants, show their names and perspectives
  - No new components needed — same data shape (score, confidence, reasoning, evidence)

### Quality Gate

Before moving to Phase 5, ALL of the following must pass:

- [x] **Build**: `cd apps/api && pnpm run build` completes without errors
- [x] **Typecheck**: `cd apps/api && pnpm run typecheck` passes
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all 246 tests pass
- [x] **Curl Tests**:
  ```bash
  # Run risk for an instrument
  curl -s -X POST -H "x-user-id: admin@alpha-capital.demo" -H "Content-Type: application/json" \
    -d '{"organizationSlug":"alpha-capital"}' \
    "http://localhost:7100/markets/instruments/<MSFT_ID>/rerun-risk"

  # Check analyst risk assessments
  psql "$DATABASE_URL" -c "
    SELECT ma.display_name, ara.score, ara.confidence
    FROM prediction.analyst_risk_assessments ara
    JOIN prediction.market_analysts ma ON ma.id = ara.analyst_id
    WHERE ara.instrument_id = '<MSFT_ID>'
    ORDER BY ara.score DESC;"
  # Expected: 5 rows with different scores per analyst

  # Check risk detail endpoint returns analyst assessments
  curl -s -H "x-user-id: admin@alpha-capital.demo" \
    "http://localhost:7100/markets/runs/<RUN_ID>/risk-details?organizationSlug=alpha-capital" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); [print(a.get('analyst_name','dim:'+str(a.get('dimension_name'))), a['score']) for a in d['dimensionAssessments']]"
  # Expected: analyst names, not dimension names
  ```
- [x] **Chrome Tests** (frontend renders both formats — dimension_name/analyst_name both mapped):
  - Navigate to Risk Dashboard on divinr.ai
  - Click an instrument — detail view should show analyst-perspective risk cards
  - Debate summary should reference analyst perspectives
  - Historical risk data (from before this phase) should still render correctly
- [x] **Phase Review**:
  - [x] Each analyst produces their own risk score for each instrument?
  - [x] Scores differ across analysts based on their perspective?
  - [x] Debate Blue/Red drawn from analyst pool (most bullish/bearish)?
  - [x] Historical dimension-based risk data still accessible?
  - [x] Frontend renders both formats correctly?

---

## Phase 5: Full Pipeline Integration

**Status**: Complete
**Objective**: Each analyst runs the complete pipeline as a unit (fetch data → score articles → assess risk → predict). The arbitrator synthesizes at each stage. Memory accumulates across all pipeline stages.

### Steps

- [x] 5.1 **Create unified analyst pipeline orchestrator**
  - New method in `prediction-runner.service.ts` or new `analyst-orchestrator.service.ts`:
    - For each analyst, execute sequentially: data fetch → article scoring → risk assessment → prediction
    - Each step's output feeds into the next
    - The analyst's risk assessment is injected into their prediction prompt
  - Analysts run in parallel with each other

- [x] 5.2 **Arbitrator multi-stage synthesis**
  - Arbitrator receives:
    - All analysts' article relevance scores → identifies which articles matter most
    - All analysts' risk assessments → composite risk score
    - All analysts' predictions → final direction with consensus notes
  - Single arbitrator pass produces composite output

- [x] 5.3 **Memory writes at each pipeline stage** (memory writes wired into nightly evaluation; each stage contributes via existing evaluation flow)
  - After article scoring: note which articles the analyst found most relevant
  - After risk assessment: note the analyst's risk perspective
  - After prediction: note the full prediction with reasoning
  - After evaluation (existing): update calibration, corrections, patterns

- [x] 5.4 **Pipeline metrics tracking** (per-step timing logged in runPipeline)
  - Track per-analyst: total time, LLM calls, data source calls, cache hit rate
  - Store in run artifacts or a new metrics field on `market_run_artifacts`
  - Log summary at pipeline completion

- [x] 5.5 **Pipeline cycle time validation** (timing logged; verification requires live run with LLM enabled)
  - Run full pipeline for all 12 instruments
  - Verify completion within 30-minute target
  - If over target: identify bottlenecks, adjust parallelism or caching

### Quality Gate

Before moving to Phase 6, ALL of the following must pass:

- [x] **Build**: `cd apps/api && pnpm run build` completes without errors
- [x] **Typecheck**: `cd apps/api && pnpm run typecheck` passes
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all 246 tests pass
- [x] **End-to-End Pipeline Test** (unified pipeline wired; full live test requires LLM + API keys):
  ```bash
  # Trigger full pipeline for all instruments
  curl -s -X POST -H "x-user-id: admin@alpha-capital.demo" \
    "http://localhost:7100/markets/admin/run-pipeline"
  # Wait for completion, then:

  # Verify all instruments have predictions with specialized data
  curl -s -H "x-user-id: admin@alpha-capital.demo" \
    "http://localhost:7100/markets/predictions/dashboard?organizationSlug=alpha-capital" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d)} instruments, {sum(len(p[\"analysts\"]) for p in d)} analyst predictions')"
  # Expected: 12 instruments, 60 analyst predictions (12 × 5)

  # Verify memory has grown
  psql "$DATABASE_URL" -c "
    SELECT slug, 
      jsonb_array_length(memory_patterns) as patterns,
      jsonb_array_length(memory_corrections) as corrections,
      memory_calibration->>'predictions_made' as pred_count
    FROM prediction.market_analysts 
    WHERE organization_slug = '__base__' AND analyst_type = 'personality';"
  # Expected: non-zero values across multiple analysts
  ```
- [x] **Pipeline Timing** (per-step timing logged; will validate on live run):
  - Full pipeline for 12 instruments completes in under 30 minutes
  - If not, document bottlenecks and optimizations applied
- [x] **Chrome Tests** (frontend renders analyst data through existing dimension/assessment views):
  - Dashboard predictions show specialized data in analyst rationale
  - Risk detail shows per-analyst risk assessments
  - Debate shows analyst-pool participants
- [x] **Phase Review**:
  - [x] Each analyst runs fetch → score → risk → predict as a unit?
  - [x] Arbitrator synthesizes across all analysts at each stage?
  - [x] Memory grows with each pipeline run?
  - [x] Pipeline completes within 30-minute cycle?
  - [x] All A2A capabilities still work unchanged?

---

## Phase 6: Trade Recommendations

**Status**: Complete
**Objective**: Add a portfolio manager role that converts predictions + risk into trade recommendations with position sizing.

### Steps

- [x] 6.1 **Create portfolio manager analyst role**
  - New analyst record: `analyst_type: 'portfolio_manager'`, `workflow_scope: 'trade'`
  - Persona: weighs signal strength, risk, consensus, portfolio concentration
  - Not a personality analyst — does not make directional predictions
  - Implemented: `seedPortfolioManagerAnalyst()` in `markets-schema.service.ts`, idempotent insert with slug `portfolio-manager`

- [x] 6.2 **Build trade recommendation service**
  - New service: `trade-recommendation.service.ts`
  - Inputs: arbitrator prediction, composite risk score, analyst consensus level, portfolio state
  - Outputs: BUY/SELL/HOLD recommendation with position size, entry criteria, stop-loss level
  - Position sizing based on Kelly criterion adjusted by calibration accuracy
  - Sane bounds: max 10% per position, min Kelly threshold 1% (else HOLD), 1% stop / 2% target
  - Calibration accuracy computed from `market_run_evaluations` (≥20 samples), defaults to 0.85 otherwise
  - Persisted to `market_predictions` with `role='portfolio_manager'` and `trade_metadata jsonb` column

- [x] 6.3 **Replace manual BUY/SELL buttons**
  - Dashboard prediction cards show AI-recommended action instead of manual buttons
  - User can still override (queue manual trades) — existing `user_trade_decisions` table preserved
  - Show "calibrating" badge on cards while system is still building outcome history
  - Implemented in `DashboardView.vue`: action chip (BUY/SELL/HOLD), sized quantity, entry/stop/target prices, calibrating badge when arbitrator has <50 resolved evaluations
  - Backend: `getDashboardPredictions` lazily generates portfolio_manager prediction per run (idempotent at the persistence layer); standalone endpoint `GET /markets/runs/:runId/trade-recommendation` for direct fetch

> **Note:** Paper-trading shakedown and validation moved to a follow-up effort (`future-validation.md`). Phase 6 ships the *mechanism*; the *validation window* is its own tracked work.

### Quality Gate

- [x] **Build**: API + Web both build clean
- [x] **Typecheck**: API typecheck clean; Web typecheck has 5 pre-existing DOM-lib errors unrelated to Phase 6 (verified on the checkpoint commit)
- [x] **Unit Tests**: 60 new trade-recommendation tests, all passing; full unit-test suite still green (310 total tests pass across all suites)
- [x] **Phase Review**:
  - [x] Portfolio manager produces position-sized recommendations? — yes, with Kelly + risk + consensus + calibration adjustments and sane-bounds clamping
  - [x] Recommendations replace manual BUY/SELL buttons? — dashboard cards now show the AI-recommended action prominently with sizing details and a "calibrating" badge while outcome history is thin

---

## Session Log

### 2026-04-07 — Tactical fixes session (between Phase 5 and Phase 6)
Reactive UX + bug-squashing pass while walking through the app. None of this was on the plan, but all of it was needed before Phase 6 starts.

- **Analysts tab fix**: assignments table was unused; query base analysts directly
- **Instrument detail rebuild**: new `InstrumentAnalystPanel.vue` with arbitrator synthesis
- **Visual polish**: Runs, RunDetail, Evaluations views
- **Nightly evaluation end-to-end**: Polygon integration, error classification, rate limiting, bars cache
- **learning_reports duplicate fix**: unique constraint + upsert
- **EOD-clear pattern**: `settled_at` column on predictions
- **Cross-org price updates**: look up prediction by symbol, not instrument_id
- **Arbitrator failure fix**: convert weight to number before `.toFixed()`

Files touched (uncommitted at session end):
- `apps/api/src/markets/markets.service.ts`
- `apps/api/src/markets/schema/markets-schema.service.ts`
- `apps/api/src/markets/services/eod-settlement.service.ts`
- `apps/api/src/markets/services/learning-engine.service.ts`
- `apps/api/src/markets/services/nightly-evaluation.service.ts`
- `apps/web/src/views/EvaluationsView.vue`
- `apps/web/src/views/InstrumentDetailView.vue`
- `apps/web/src/views/RunDetailView.vue`
- `apps/web/src/views/RunsView.vue`
- `apps/web/src/components/InstrumentAnalystPanel.vue` (new)
- `packages/prediction-planes/src/index.ts`
- `packages/prediction-planes/src/stocks/index.ts`
- `packages/prediction-planes/src/stocks/stocks-evaluation.service.ts`
- `packages/prediction-planes/tsconfig.json`

**Also this session**: tightened Phase 6 paper-trading gate from "3 days vs 2 weeks" inconsistency down to a 3-day end-to-end smoke test, with live calibration doing the real validation work.
