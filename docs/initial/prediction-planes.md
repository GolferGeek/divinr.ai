# Prediction Planes — Design Intent

## 1) Purpose

This document defines the **prediction plane** abstraction: a domain-specific contract that each prediction domain (stocks, betting/props, elections) implements to handle the parts of the pipeline that vary by domain — data ingestion, instrument state, outcome evaluation, and presentation.

This follows the same pattern as Divinr's infrastructure planes (database, LLM, observability), which abstract provider differences behind a shared contract. Prediction planes abstract **domain** differences behind a shared contract.

It complements:

- `domain-architecture.md` — defines the three domains and what's shared vs. domain-specific
- `analyst-system.md` — analysts are domain-scoped but operate through the same ensemble
- `ai-learning-system.md` — learning evaluates outcomes through the domain's evaluation plane

---

## 2) The abstraction

A prediction plane defines **how a domain interacts with the outside world** and **how it presents itself to users**. The orchestration engine (ensemble, arbitration, learning) is domain-agnostic — it calls into the prediction plane for anything domain-specific.

### Prediction plane contract

```typescript
interface PredictionPlane {
  /** Domain identity */
  domain: string;  // 'stocks', 'sports', 'elections'

  /** DATA INGESTION — How does this domain get external data? */
  ingest: {
    /** Fetch current state for an instrument */
    getCurrentState(instrumentId: string): Promise<InstrumentState>;

    /** Fetch historical state (for evaluation and replay) */
    getHistoricalState(instrumentId: string, asOf: Date): Promise<InstrumentState>;

    /** List available data sources for this domain */
    getAvailableSources(): Promise<DomainSource[]>;

    /** Sync articles/signals from domain-specific sources */
    syncExternalData(config: SyncConfig): Promise<SyncResult>;
  };

  /** INSTRUMENT STATE — What does "current price" mean for this domain? */
  state: {
    /** The primary metric (price, odds, polling average) */
    getPrimaryMetric(instrument: Instrument): PrimaryMetric;

    /** Format the metric for display */
    formatMetric(metric: PrimaryMetric): string;

    /** Get the state fields relevant for prompt context */
    getPromptContext(instrument: Instrument, state: InstrumentState): string;
  };

  /** EVALUATION — How do we know if a prediction was right? */
  evaluation: {
    /** Determine actual outcome at a given horizon */
    evaluateOutcome(
      instrument: Instrument,
      predictionDate: Date,
      evaluationDate: Date,
    ): Promise<ActualOutcome>;

    /** Compare prediction to actual */
    scorePrediction(
      predicted: PredictionOutcome,
      actual: ActualOutcome,
    ): EvaluationScore;

    /** Domain-specific evaluation horizons */
    getDefaultHorizons(): EvaluationHorizon[];
  };

  /** PRESENTATION — How does this domain display in the UI? */
  presentation: {
    /** Dashboard layout definition */
    getDashboardLayout(): DashboardLayout;

    /** Instrument card template */
    getInstrumentCardFields(): CardFieldDefinition[];

    /** How to render a prediction result */
    getPredictionDisplayFormat(): PredictionDisplayConfig;

    /** Domain-specific visualizations */
    getVisualizationTypes(): VisualizationType[];
  };
}
```

---

## 3) Domain implementations

### Stocks prediction plane

```
ingest:
  getCurrentState → Market data API (price, volume, change %, market cap)
  getHistoricalState → Historical price data for a given date
  getAvailableSources → Financial news (MarketWatch, Reuters, Bloomberg, SEC filings)
  syncExternalData → Crawler pulls articles from financial sources

state:
  primaryMetric → Current price ($174.52)
  formatMetric → "$174.52 (+2.3%)"
  promptContext → "AAPL is trading at $174.52, up 2.3% today. Market cap $2.7T. P/E 28.5."

evaluation:
  evaluateOutcome → Fetch close price at evaluation date, compute direction
  scorePrediction → Predicted up, actual up = correct. Confidence calibration.
  defaultHorizons → [1 day, 3 days, 5 days]

presentation:
  dashboardLayout → Price chart + prediction cards + risk gauge + analyst breakdown
  instrumentCardFields → [symbol, price, change%, prediction direction, confidence]
  predictionDisplayFormat → Direction arrow (↑↓→) + confidence bar + horizon
  visualizationTypes → [candlestick chart, prediction timeline, risk radar]
```

### Betting/Props prediction plane (future)

```
ingest:
  getCurrentState → Odds API (current line, spread, over/under, prop odds)
  getHistoricalState → Line movement history
  getAvailableSources → Sportsbooks (DraftKings, FanDuel), injury feeds, stats APIs
  syncExternalData → Pull odds movements, injury updates, team stats

state:
  primaryMetric → Current odds/spread (Chiefs -3.5, O/U 47.5)
  formatMetric → "Chiefs -3.5 (-110) | O/U 47.5"
  promptContext → "Chiefs vs Bills, spread -3.5. Patrick Mahomes questionable (ankle).
                   Line opened at -2.5, moved to -3.5. 68% public on Chiefs."

evaluation:
  evaluateOutcome → Fetch final score, determine cover/push/miss
  scorePrediction → Predicted cover, actual covered = correct
  defaultHorizons → [pre-game, final] (event-based, not day-based)

presentation:
  dashboardLayout → Odds board + prop grid + line movement chart + sharp money tracker
  instrumentCardFields → [event, spread, odds, movement, prediction, confidence]
  predictionDisplayFormat → Cover/No cover indicator + edge value + expected value
  visualizationTypes → [odds board, line movement chart, prop market grid, consensus meter]
```

### Elections prediction plane (future)

```
ingest:
  getCurrentState → Polling aggregators (average, trend, quality-weighted)
  getHistoricalState → Historical polling for a given date
  getAvailableSources → Polling firms, early vote data, demographic data, FEC filings
  syncExternalData → Pull new polls, early vote counts, fundraising data

state:
  primaryMetric → Polling average + rating (Lean D +4.2)
  formatMetric → "Senate AZ: Kelly (D) +4.2 — Lean D"
  promptContext → "Arizona Senate: Kelly (D) leads by 4.2 in polling average (12 polls,
                   A/B rated avg). Early vote: D+6% of returns. 2024 baseline: Biden +0.3."

evaluation:
  evaluateOutcome → Fetch election results (winner, margin, called date)
  scorePrediction → Predicted D win, actual D win = correct. Margin accuracy.
  defaultHorizons → [7 days before, 3 days before, 1 day before, election day]

presentation:
  dashboardLayout → Electoral/race map + race ratings + swing dashboard + polling trends
  instrumentCardFields → [race, candidates, polling avg, rating, prediction, confidence]
  predictionDisplayFormat → Win probability + margin estimate + rating shift
  visualizationTypes → [electoral map, race rating board, polling trend lines, swing-o-meter,
                         state-level breakdown]
```

---

## 4) How prediction planes integrate with the pipeline

### The orchestration engine is plane-unaware

The core pipeline (`risk-runner`, `prediction-runner`, `arbitrator`) never calls domain-specific APIs directly. Instead:

```
1. Run enqueued for instrument X
2. Pipeline resolves instrument → domain → prediction plane
3. Pipeline calls plane.state.getPromptContext(instrument) → domain-formatted context string
4. Pipeline builds analyst prompts with that context (domain-agnostic prompt template + domain-specific context)
5. Pipeline runs ensemble, arbitration (completely domain-agnostic)
6. Pipeline persists results (domain-agnostic schema)
```

### The evaluation engine uses the plane

```
1. Nightly job identifies predictions ready for horizon evaluation
2. For each prediction: resolve instrument → domain → prediction plane
3. Call plane.evaluation.evaluateOutcome(instrument, predictionDate, evaluationDate)
4. Call plane.evaluation.scorePrediction(predicted, actual)
5. Persist evaluation (domain-agnostic schema, domain-specific outcome data in jsonb)
```

### The UI uses the plane's presentation contract

```
1. User navigates to a domain dashboard
2. UI loads plane.presentation.getDashboardLayout()
3. UI renders domain-specific widgets (stock charts vs odds boards vs electoral maps)
4. Instrument cards use plane.presentation.getInstrumentCardFields()
5. Predictions displayed using plane.presentation.getPredictionDisplayFormat()
```

---

## 5) Implementation approach

### Phase 1 (now): Stocks only, but plane-shaped

We don't need to build a full plugin system on day one. What we do:

1. **Define the plane interface** in `packages/transport-types/` or a new `packages/prediction-planes/`
2. **Implement `StocksPredictionPlane`** as the first (and only active) implementation
3. **The orchestration pipeline calls through the plane interface**, not directly to stock-specific code
4. **The UI has a stocks dashboard** built against the presentation contract

This costs marginally more than building stocks-only, but means adding sports or elections later is:
- Implement the plane interface for that domain
- Seed domain-specific analysts, dimensions, sources
- Build domain-specific UI views
- Register the plane

No pipeline changes. No schema migrations.

### Phase 2 (later): Additional domains

Each new domain is a new plane implementation. The registration is configuration:

```typescript
// Domain registry maps domain slugs to plane implementations
const planeRegistry = {
  stocks: StocksPredictionPlane,
  sports: SportsPredictionPlane,      // added later
  elections: ElectionsPredictionPlane, // added later
};
```

### Package structure

```
packages/
  prediction-planes/
    src/
      prediction-plane.interface.ts    — the contract
      stocks/
        stocks-prediction-plane.ts     — stocks implementation
        stocks-state.service.ts        — price/market data
        stocks-evaluation.service.ts   — price direction evaluation
        stocks-presentation.ts         — dashboard layout definitions
      sports/                          — future
      elections/                       — future
    index.ts
```

Or, if we want to keep it simpler initially, the plane implementations can live in `apps/api/src/markets/planes/` until they warrant extraction into a package.

---

## 6) Data model implications

### InstrumentState (domain-specific, stored as jsonb)

Each domain defines what "state" means. Stored in a `current_state jsonb` column on instruments (or a separate state table):

**Stocks:**
```json
{
  "price": 174.52,
  "change_pct": 2.3,
  "volume": 52400000,
  "market_cap": 2700000000000,
  "pe_ratio": 28.5,
  "52w_high": 199.62,
  "52w_low": 124.17,
  "as_of": "2026-03-31T16:00:00Z"
}
```

**Sports:**
```json
{
  "spread": -3.5,
  "spread_odds": -110,
  "moneyline": -175,
  "over_under": 47.5,
  "public_pct": 68,
  "sharp_action": "under",
  "injury_impact": "moderate",
  "as_of": "2026-03-31T12:00:00Z"
}
```

**Elections:**
```json
{
  "polling_avg": 4.2,
  "polling_trend": "stable",
  "num_polls": 12,
  "avg_poll_quality": "A/B",
  "rating": "Lean D",
  "early_vote_margin": 6.0,
  "fundraising_ratio": 1.4,
  "as_of": "2026-03-31T00:00:00Z"
}
```

### ActualOutcome (domain-specific, stored as jsonb in evaluations)

**Stocks:** `{ "direction": "up", "close_price": 178.23, "change_pct": 2.1 }`
**Sports:** `{ "result": "cover", "final_score": "Chiefs 31, Bills 27", "margin": 4 }`
**Elections:** `{ "winner": "Kelly (D)", "margin": 5.1, "called_at": "2026-11-03T23:45:00Z" }`

The evaluation table stores these as jsonb — domain-agnostic schema, domain-specific content.

---

## 7) Presentation architecture (UI implications)

### Domain dashboard registry

The web app doesn't hardcode dashboard layouts. It reads them from the prediction plane's presentation contract:

```
/ (home)
  → Domain selector (if tenant has multiple domains enabled)

/stocks
  → StocksDashboard (price charts, prediction cards, risk gauge)

/sports (future)
  → SportsDashboard (odds board, prop grid, line movement)

/elections (future)
  → ElectionsDashboard (electoral map, race ratings, polling trends)
```

### Shared vs. domain-specific components

**Shared (domain-agnostic):**
- `TenantSelector.vue`
- `AnalystOutcomeCard.vue` (direction/confidence/rationale works for any domain)
- `ArbitratorSection.vue`
- `RunStatusChip.vue`
- `DebateSummary.vue`

**Domain-specific:**
- `StockPriceChart.vue` / `OddsBoard.vue` / `ElectoralMap.vue`
- `StockInstrumentCard.vue` / `BetCard.vue` / `RaceCard.vue`
- `StockPredictionDisplay.vue` / `BetPredictionDisplay.vue` / `ElectionPredictionDisplay.vue`

The domain-specific components are loaded dynamically based on the active domain. The shared components work everywhere.

---

## 8) Relationship to infrastructure planes

| Plane Type | What it abstracts | Examples |
|------------|------------------|---------|
| **Infrastructure planes** (existing) | Provider differences for shared services | Database (Supabase/PG/SQL Server), LLM (Ollama/OpenRouter), Auth (Supabase/Auth0/Azure) |
| **Prediction planes** (new) | Domain differences for prediction workflows | Stocks (prices/charts), Sports (odds/boards), Elections (polls/maps) |

Both follow the same pattern:
- Define an interface/contract
- Implement per variant
- Select at runtime via configuration
- The consumer (pipeline, UI) is variant-unaware

---

## 9) Open questions

- Should prediction planes be NestJS modules (injectable) or pure service classes?
- How do we handle instruments that span domains? (e.g., a Polymarket contract about an election is both "betting" and "elections")
- Should the presentation contract return actual Vue component names, or abstract layout definitions that the UI interprets?
- Where does external data sourcing live? (Prediction plane vs. a separate data plane?)
- Cost of external data APIs per domain — do we need API key management per domain?

---

## 10) Revision history

| Date | Change |
|------|--------|
| 2026-03-31 | Initial prediction planes design authored. |
