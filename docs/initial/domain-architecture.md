# Domain Architecture — Design Intent

## 1) Purpose

This document defines how Divinr AI supports multiple prediction domains (financial markets, betting markets, election coverage) on a shared platform without requiring a rewrite when new domains are added.

The immediate execution domain is **stocks**. The architecture must support **betting markets** and **election coverage** as future domains that plug in cleanly — different analysts, different risk dimensions, different context, but the same orchestration engine, learning system, and tenant governance.

It complements:

- `intention.md` — "The architecture must support expansion to additional market types without requiring a rewrite"
- `high-level-PRD.md` — "Deliver reusable architecture for future domains beyond stocks"
- `analyst-system.md` — analyst packs are domain-specific
- `ai-learning-system.md` — learning system is domain-agnostic

---

## 2) The three domains and their universes

Domains are the top-level prediction categories. Each domain contains **universes** — sub-categories with their own data characteristics, context providers, and analyst specializations.

### Financial Markets (`financial`)

| Universe | Slug | Instruments | Data Sources |
|----------|------|-------------|-------------|
| **Stocks** | `stocks` | AAPL, MSFT, TSLA, GOOGL, AMZN | MarketWatch, Reuters, SEC filings, earnings calendars |
| **Crypto** | `crypto` | BTC, ETH, SOL, DOGE | On-chain data, DeFi protocols, exchange flows, crypto news |
| **Commodities** | `commodities` | Gold, Oil, Natural Gas | Futures data, supply reports, geopolitical feeds |

Evaluation horizons: 4h, 1d, 3d, 5d (continuous market)

### Betting Markets (`betting`)

| Universe | Slug | Instruments | Data Sources |
|----------|------|-------------|-------------|
| **Prediction Markets** | `polymarket` | Polymarket contracts, Kalshi markets | Polymarket API, resolution criteria, market depth |
| **NFL** | `nfl` | Weekly games, futures, player props | Odds APIs, injury reports, advanced stats (PFF, EPA) |
| **MLB** | `mlb` | Daily games, series, player props | Odds APIs, pitching matchups, park factors |
| **NBA** | `nba` | Daily games, futures, player props | Odds APIs, rest days, pace/efficiency stats |
| **UFC/Combat** | `ufc` | Fight cards, prop markets | Odds APIs, fighter stats, weigh-in data |

Evaluation horizons: event-based (pre-game → final)

### Election Coverage (`elections`)

| Universe | Slug | Instruments | Data Sources |
|----------|------|-------------|-------------|
| **US 2028 Presidential** | `us-2028-pres` | State races, national race, primary contests | Polls, early vote, fundraising, demographics |
| **US 2026 Midterms** | `us-2026-mid` | Senate races, House races, Governor races | Polls, Cook/Sabato ratings, FEC data |
| **European Elections** | `eu-elections` | UK, France, Germany, EU Parliament | Country-specific polling, parliamentary systems, coalition dynamics |

Evaluation horizons: 7d, 3d, 1d before, election day (different political systems have different rhythms)

### Hierarchy

```
Domain (prediction plane)
  └─ Universe (context providers, analyst specializations)
      └─ Instrument (individual target: AAPL, Chiefs vs Bills, Arizona Senate)
```

- **Domain** determines the prediction plane (how data ingestion, evaluation, and presentation work)
- **Universe** determines context providers and analyst flavor within that plane (NFL analysts know different things than NBA analysts; crypto context providers are different from stock context providers)
- **Instrument** is the individual prediction target

### What's shared across all domains

- The orchestration pipeline (queue, claim, run, arbitrate, persist)
- The ensemble mechanics (weighted aggregation, arbitrator synthesis)
- The learning system (canonical tests, multi-horizon evaluation, tiered proposals)
- The debate system (blue/red/arbiter)
- Tenant isolation, RBAC, and governance
- The web UI framework (different views per domain, same shell)

### What varies by domain (prediction plane)

- Data ingestion (market prices vs odds vs polls)
- Instrument state model (price vs spread vs polling average)
- Outcome evaluation (price direction vs cover/miss vs win/lose)
- Dashboard presentation (charts vs odds boards vs electoral maps)
- Evaluation horizons

### What varies by universe (within a domain)

- Context providers (crypto-specific knowledge vs stock-specific)
- Analyst specializations (NFL injury analyst vs NBA pace analyst)
- Data sources (ESPN vs PFF vs 538)
- Instrument metadata fields
- Default analyst pack nuances

---

## 3) Domain as a first-class entity

### Domain registry

```sql
prediction.domains (
  slug text PRIMARY KEY,           -- 'financial', 'betting', 'elections'
  display_name text NOT NULL,      -- 'Financial Markets', 'Betting Markets', 'Election Coverage'
  description text,
  prediction_plane text NOT NULL,  -- which prediction plane implementation to use
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
)

prediction.universes (
  slug text PRIMARY KEY,           -- 'stocks', 'crypto', 'nfl', 'us-2028-pres'
  domain_slug text NOT NULL REFERENCES prediction.domains(slug),
  display_name text NOT NULL,      -- 'Stocks', 'Crypto', 'NFL', 'US 2028 Presidential'
  description text,
  default_evaluation_horizons jsonb NOT NULL DEFAULT '[1, 3, 5]'::jsonb,
  horizon_unit text NOT NULL DEFAULT 'days' CHECK (horizon_unit IN ('hours', 'days', 'weeks')),
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,  -- universe-specific config
  created_at timestamptz NOT NULL DEFAULT now()
)
```

Initial seed:
- Domain `financial` (active), universe `stocks` (active), `crypto` (inactive)
- Domain `betting` (inactive), universe `polymarket` (inactive), `nfl` (inactive)
- Domain `elections` (inactive), universe `us-2028-pres` (inactive), `us-2026-mid` (inactive)

### What gets a `domain_slug` and/or `universe_slug` column

| Table | Column(s) | Why |
|-------|-----------|-----|
| `instruments` | `universe_slug` (→ domain via universe) | An instrument belongs to a universe: AAPL is `stocks`, Chiefs vs Bills is `nfl` |
| `market_analysts` | `domain_slug` + optional `universe_slug` | Personality analysts may be domain-wide (Fred works for all financial). Context providers are universe-specific (On-Chain Otto is crypto only). |
| `risk_dimensions` | `domain_slug` | Risk dimensions are domain-level (financial risk dims vs betting risk dims) |
| `risk_debate_contexts` | `domain_slug` | Debate prompts reference domain-specific concepts |
| `source_catalog` | `domain_slug` + optional `universe_slug` | Sources may be universe-specific (ESPN for NFL, PFF for NFL, 538 for elections) |
| `canonical_test_days` | `universe_slug` | Canonical scenarios are universe-scoped (a bad NFL prediction day, a bad crypto day) |

### What does NOT need a domain column

| Table | Why |
|-------|-----|
| `orchestration_runs` | A run is tied to an instrument, which has a domain — no need to duplicate |
| `market_predictions` | Tied to a run → instrument → domain |
| `market_risk_assessments` | Same chain |
| `market_run_artifacts` | Same chain |
| `learning_proposals` | Tied to analyst → domain |
| `analyst_config_versions` | Tied to analyst → domain |
| `tenant_source_entitlements` | Tied to source → domain (if needed) |

The domain propagates through the instrument relationship. No need to stamp it on every row.

---

## 4) Domain-specific analyst packs

Each domain gets its own default personality analysts, seeded when a tenant enables that domain.

### Financial Markets (`stocks`)

| Slug | Name | Perspective | Weight |
|------|------|-------------|--------|
| `fundamental-fred` | Fundamental Fred | Earnings, revenue, margins, balance sheet, valuation | 1.00 |
| `technical-tina` | Technical Tina | Chart patterns, support/resistance, volume, momentum | 1.00 |
| `sentiment-sally` | Sentiment Sally | News tone, social media, analyst ratings, insider activity | 1.00 |
| `aggressive-alex` | Aggressive Alex | Breakouts, trend acceleration, volume surges | 1.10 |
| `cautious-carl` | Cautious Carl | Downside protection, margin of safety | 0.90 |

### Betting Markets (`sports`) — future

| Slug | Name | Perspective | Weight |
|------|------|-------------|--------|
| `odds-oscar` | Odds Oscar | Line movement, market efficiency, sharp vs public money | 1.00 |
| `stats-sam` | Stats Sam | Advanced statistics, matchup analysis, pace/efficiency | 1.00 |
| `injury-irene` | Injury Irene | Injury reports, player availability, depth chart impact | 1.00 |
| `trend-tony` | Trend Tony | Situational trends, ATS records, schedule spots | 0.90 |
| `contrarian-chris` | Contrarian Chris | Fade public sentiment, buy low on bad news | 1.10 |

### Election Coverage (`elections`) — future

| Slug | Name | Perspective | Weight |
|------|------|-------------|--------|
| `polling-paul` | Polling Paul | Polling aggregation, methodology quality, trend lines | 1.00 |
| `modeling-mike` | Modeling Mike | Probabilistic models, fundamentals-based forecasting | 1.00 |
| `ground-game-gina` | Ground Game Gina | Campaign organization, GOTV operations, early vote data | 1.00 |
| `demographic-diana` | Demographic Diana | Demographic shifts, coalition analysis, turnout modeling | 0.90 |
| `narrative-nick` | Narrative Nick | Media narrative, momentum, October surprise potential | 1.10 |

### Cross-domain analysts

Some analyst perspectives apply across domains. A "Contrarian" analyst, a "Sentiment" analyst, or a "Macro" analyst could be relevant to multiple domains. The system supports this via:

- Tenant creates a custom analyst with `domain_slug = NULL` (or a special value like `general`)
- That analyst can be assigned to instruments in any domain
- Or: tenant creates domain-specific versions of the same concept

---

## 5) Domain-specific risk dimensions

### Financial Markets (`stocks`)

| Slug | Name | Weight |
|------|------|--------|
| `market` | Market Risk | 0.30 |
| `fundamental` | Fundamental Risk | 0.30 |
| `technical` | Technical Risk | 0.20 |
| `macro` | Macro Risk | 0.20 |

### Betting Markets (`sports`) — future

| Slug | Name | Weight |
|------|------|--------|
| `injury` | Injury/Availability Risk | 0.30 |
| `matchup` | Matchup Risk | 0.25 |
| `line-movement` | Line Movement Risk | 0.25 |
| `situational` | Situational Risk (schedule, travel, motivation) | 0.20 |

### Election Coverage (`elections`) — future

| Slug | Name | Weight |
|------|------|--------|
| `polling-accuracy` | Polling Accuracy Risk | 0.30 |
| `turnout` | Turnout Model Risk | 0.25 |
| `campaign-dynamics` | Campaign Dynamics Risk | 0.25 |
| `external-events` | External Events Risk (economy, crisis) | 0.20 |

---

## 6) Domain-specific evaluation horizons

The nightly learning cycle evaluates predictions at domain-appropriate windows:

| Domain | Default horizons | Unit | Rationale |
|--------|-----------------|------|-----------|
| `stocks` | 1, 3, 5 | days | Standard short-term trading windows |
| `sports` | pre-game, halftime, final | event-relative | Predictions resolve at game end |
| `elections` | 7, 3, 1 day-before, election day | days-to-event | Tightening windows as election approaches |

The learning system's canonical test framework works identically across domains — only the frozen snapshot contents differ (articles about earnings vs injury reports vs polling data).

---

## 7) What this means for implementation

### Schema changes (Sprint 0-1)

1. Create `prediction.domains` table and seed `stocks` (active), `sports` (inactive), `elections` (inactive)
2. Add `domain_slug text NOT NULL DEFAULT 'stocks'` to:
   - `market_analysts` (with FK to domains)
   - `risk_dimensions` (with FK to domains)
   - `instruments` (replaces or supplements `asset_type`)
   - `source_catalog`
   - `risk_debate_contexts`
   - `canonical_test_days`
3. Default analyst seeding becomes: seed per domain, not globally
4. Risk dimension seeding becomes: seed per domain

### Service changes (minimal now)

- `ensureSchema` seeds the domain registry
- Analyst queries add `domain_slug` filter
- Risk dimension queries add `domain_slug` filter
- Everything else already flows through instruments → domain naturally

### What we build now (stocks only)

- Only the `stocks` domain is active
- Only stock analyst defaults are seeded
- Only stock risk dimensions are seeded
- The UI shows domain context but doesn't offer domain switching yet

### What plugging in a new domain looks like later

1. Activate the domain in `prediction.domains`
2. Seed domain-specific default analysts
3. Seed domain-specific risk dimensions
4. Seed domain-specific debate contexts
5. Add domain-specific data sources to the catalog
6. Configure domain-specific evaluation horizons
7. Add domain-specific UI views (or extend existing ones)

No pipeline changes. No schema migrations. No service rewrites. Just configuration and content.

---

## 8) Naming convention note

The current codebase uses `markets` as the module name and `prediction` as the schema name. These are domain-agnostic enough — "markets" covers financial markets, betting markets, and prediction markets broadly. If naming becomes confusing when sports/elections are added, the module can be renamed to `predictions` or `domains`, but this is cosmetic and not blocking.

The table prefix `market_` (as in `market_analysts`, `market_predictions`) is slightly stock-biased but acceptable. Renaming tables is a migration cost that can be deferred unless it causes real confusion.

---

## 9) Open questions

- Should tenant onboarding offer domain selection? ("Which domains do you want to enable?")
- Should analysts created in one domain be assignable to instruments in another domain?
- How do sports/election data sources integrate? (Real-time APIs vs article-based like stocks)
- Should the web UI have separate navigation per domain or a unified view with domain filtering?

---

## 10) Revision history

| Date | Change |
|------|--------|
| 2026-03-31 | Initial domain architecture authored. |
