# Move to Spark — Product Requirements Document

## 1. Overview

Migrate the Divinr AI platform to the DGX Spark (128GB RAM), running everything through Node (no Docker). Deliver a fully operational multi-tenant SaaS platform serving web, mobile (Ionic), and desktop (Electron) clients — all consuming the same API, all conforming to Google's A2A protocol. Target: public SaaS launch by end of April 2026.

The platform is a market intelligence system built on selective instrument tracking: users curate watchlists, and the analyst pipeline runs substantial AI processing (crawling, ingestion, multi-analyst LLM analysis) on 30-minute cycles for those selected instruments only. User-facing responses are fast database reads, not live inference. This applies across all domains: stocks (user-curated watchlists), crypto (only within stock market context for now), and future domains (betting markets, elections) when added.

**Business model principle**: the licensed product is the analyst layer (the AI analysis pipeline), not the infrastructure. Self-hosted users bring their own API keys and database; they pay for the analyst intelligence, not for hosting.

**Codebase**: pnpm monorepo (Turborepo) with `apps/api` (NestJS), `apps/web` (Vue 3 + Ionic 8 + Pinia), and shared packages (`packages/planes`, `packages/prediction-planes`, `packages/transport-types`).

## 2. Goals & Success Criteria

| # | Goal | Success Criterion |
|---|------|-------------------|
| G1 | Database restored and operational on Spark | `prediction_schema_backup_20260403.sql` restored to PostgreSQL on port 5434; all 68 tables in `prediction` schema accessible; seed data queryable |
| G2 | Environment-driven configuration | All config from `.env` files; zero hardcoded ports, URLs, or API keys in source; dev (port 6000s) and prod (port 7000s) distinguished solely by `.env` values |
| G3 | API server running on Node (no Docker) | `node dist/main.js` starts backend; health endpoint responds; all markets endpoints functional |
| G4 | Auth verification and hardening | Supabase local auth (port 54321) validates JWT tokens end-to-end; dev bypass restricted to `MARKETS_DEV_AUTH_BYPASS=true`; RBAC enforced |
| G5 | A2A protocol compliance | `/.well-known/agent.json` serves agent card; all endpoints wrapped in A2A task lifecycle; Orchestrator AI can discover and invoke Divinr endpoints |
| G6 | Analyst pipeline operational on Spark | Source crawling, article ingestion, LLM analysis (30-min cycles), predictions, risk assessments all running against user-curated watchlists using Ollama local (qwen2.5:7b) with OpenRouter fallback |
| G7 | Web frontend connected and functional | Vue/Ionic app shows instruments, sources, articles, predictions, risk data; reads from A2A endpoints |
| G8 | Cloudflare tunnel + Nginx routing | External access via Cloudflare tunnel; Nginx routes to correct service; Vue router handles client-side routing |
| G9 | Mobile verification | Dashboard renders usably on iPhone via Ionic; charts, prediction timelines, risk matrices verified on small screen |
| G10 | Electron desktop app with build pipeline | Packaged desktop app connecting to cloud API or localhost; `electron-builder` produces distributable DMG; self-hosted users bring own API keys |
| G11 | No Docker dependency | Entire stack runs through Node processes; no docker-compose, no container runtime required |
| G12 | Selective instrument tracking enforced | UI and pipeline scoped to user-curated watchlists; no "analyze everything" capability; tier differentiation supported |

## 3. User Stories / Use Cases

**UC-1: Analyst Dashboard (Web)**
As a portfolio analyst, I want to see my curated instrument watchlist with the latest predictions, risk scores, and composite gauges so I can make informed decisions.

**UC-2: Source & Article Management**
As a user, I want to manage my entitled sources and view crawled articles relevant to my instruments so I can understand what the analysts are reading.

**UC-3: Run Monitoring**
As a user, I want to see the status of prediction and risk runs (queued/running/completed/failed), view artifacts, and trigger evaluations.

**UC-4: Electron Desktop (Self-Hosted)**
As an advanced user, I want to run Divinr AI on my own machine with my own API keys, connecting the Electron app to a local API server.

**UC-5: Electron Desktop (Cloud)**
As a Base/Pro subscriber, I want to use the Electron desktop app connected to the Divinr cloud API.

**UC-6: A2A Discovery (Orchestrator)**
As the Orchestrator AI system, I want to discover Divinr's capabilities via `/.well-known/agent.json` and invoke them using A2A JSON-RPC.

**UC-7: Mobile Spot-Check**
As a user on iPhone, I want to view my dashboard and key metrics in a usable format via Ionic's responsive rendering.

**UC-8: Portfolio & Learning**
As a user, I want to see analyst portfolios, leaderboards, learning proposals, and evaluation history to understand how the system improves over time.

## 4. Technical Requirements

### 4.1 Architecture

```
                         Cloudflare Tunnel
                              |
                           Nginx (Spark)
                        /              \
           Vue/Ionic SPA            NestJS API (Node)
           (static files)           port 6xxx (dev) / 7xxx (prod)
                                        |
                    ┌───────────────────┼────────────────────┐
                    |                   |                    |
              PostgreSQL          Supabase Local        Ollama Local
              port 5434           port 54321            port 11434
             (prediction          (auth)               (qwen2.5:7b)
              schema)                                       |
                                                      OpenRouter
                                                    (frontier fallback)
                                                          |
                                                      FireCrawl
                                                    (source crawling)
```

**Runtime**: Node.js processes managed directly (no Docker, no PM2 required initially).

**Monorepo structure** (unchanged):
- `apps/api` — NestJS backend
- `apps/web` — Vue 3 + Ionic 8 + Pinia frontend + Electron shell
- `packages/planes` — shared auth, database, LLM, observability, RBAC, config modules
- `packages/prediction-planes` — domain-specific prediction logic (stocks)
- `packages/transport-types` — A2A types, discovery types, execution context

**Key constraint**: Divinr connects ONLY to its own database (`DATABASE_URL` port 5434). The `ORCHESTRATOR_DATABASE_URL` connection in `OrchestratorBaseDataService` is optional — it reads base data from Orchestrator when available but returns empty results when not configured. On the Spark, Divinr runs self-contained.

### 4.2 Data Model Changes

**No schema changes required.** The `prediction_schema_backup_20260403.sql` contains the full schema (68 tables in the `prediction` schema) including:

- Core: `instruments`, `analysts`, `market_analysts`, `signals`, `predictors`, `predictions`
- Runs: `orchestration_runs`, `run_artifacts`, `run_evaluations`, `run_replays`
- Risk: `risk_assessments`, `market_risk_assessments`
- Sources: `source_catalog`, `source_subscriptions`, `tenant_source_entitlements`, `market_articles`
- Learning: `learnings`, `learning_queue`, `learning_lineage`, `evaluations`
- Portfolios: `analyst_portfolios`, `analyst_positions`, `user_portfolios`, `user_positions`, `user_trade_queue`
- Test infrastructure: `test_target_mirrors`, `test_articles`, `test_scenarios`, `replay_tests`
- Settlement: `eod_settlement_log`, `daily_postmortem_runs`
- Config: `universes`, `targets`, `strategies`, `position_sizing_config`

**Restore procedure**: `psql -h 127.0.0.1 -p 5434 -U postgres -d divinr_ai < prediction_schema_backup_20260403.sql`

### 4.3 API Changes

#### 4.3.1 Port Configuration

The API currently defaults to port 3100 (`process.env.PORT || 3100`). This must change to:
- **Dev**: `PORT=6100` (from `.env`)
- **Prod**: `PORT=7100` (from prod `.env`)

No code change needed — just `.env` configuration.

#### 4.3.2 A2A Discovery Endpoint (NEW)

**`GET /.well-known/agent.json`** — returns the Divinr agent card.

```json
{
  "name": "Divinr AI",
  "description": "Market intelligence platform with multi-analyst prediction pipeline",
  "url": "https://divinr.ai",
  "version": "0.1.0",
  "capabilities": [
    {
      "id": "markets-instruments",
      "slug": "markets/instruments",
      "name": "Instrument Watchlists",
      "kind": "api",
      "discoverable": true,
      "invoke": { "method": "invoke" }
    },
    {
      "id": "markets-predictions",
      "slug": "markets/predictions",
      "name": "Predictions",
      "kind": "api",
      "discoverable": true,
      "invoke": { "method": "invoke" }
    },
    {
      "id": "markets-risk",
      "slug": "markets/risk-assessments",
      "name": "Risk Assessments",
      "kind": "api",
      "discoverable": true,
      "invoke": { "method": "invoke" }
    }
  ],
  "authentication": {
    "schemes": ["bearer"]
  }
}
```

#### 4.3.3 A2A Task Lifecycle Wrapper (NEW)

Add an A2A-compliant JSON-RPC endpoint:

**`POST /a2a`** — accepts A2A invoke requests per `A2AInvokeRequest` type from `packages/transport-types/a2a/request.types.ts`.

Maps `context.capability` to internal controller methods. Returns `A2AInvokeResponse` with task status (submitted/working/completed/failed).

#### 4.3.4 Existing Endpoints (Unchanged)

All existing REST endpoints under `/markets/*` remain as-is. The A2A layer wraps them — it does not replace them. Current endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (public) |
| GET | `/markets/instruments` | List user's instrument watchlist |
| POST | `/markets/instruments` | Add instrument to watchlist |
| GET | `/markets/analysts` | List analysts |
| POST | `/markets/analysts` | Create analyst persona |
| PUT | `/markets/analysts/:id` | Update analyst |
| POST | `/markets/analysts/:id/rollback` | Rollback analyst to previous version |
| POST | `/markets/analysts/assign` | Assign analyst to instrument |
| GET | `/markets/sources` | List entitled sources |
| POST | `/markets/sources/entitlements` | Manage source entitlements |
| GET | `/markets/articles` | List articles |
| POST | `/markets/data/sync/external-crawler` | Sync crawler data |
| POST | `/markets/predictors/score` | Score article for instrument |
| POST | `/markets/predictors/score-batch` | Batch score articles |
| GET | `/markets/predictors` | List predictors for instrument |
| POST | `/markets/predictors` | Upsert predictor |
| POST | `/markets/runs` | Enqueue prediction/risk run |
| GET | `/markets/runs` | List runs |
| GET | `/markets/runs/:id` | Get run detail |
| POST | `/markets/runs/:id/status` | Update run status |
| POST | `/markets/runs/process-next` | Process next queued run |
| POST | `/markets/runs/process` | Process batch of queued runs |
| POST | `/markets/runs/:id/evaluate` | Evaluate run |
| POST | `/markets/runs/:id/replay` | Replay run with scenario |
| GET | `/markets/runs/:id/artifacts` | List run artifacts |
| GET | `/markets/predictions` | List predictions |
| GET | `/markets/risk-assessments` | List risk assessments |
| GET | `/markets/runs/:id/evaluations` | List run evaluations |
| GET | `/markets/runs/:id/replays` | List run replays |
| GET | `/markets/risk-dimensions` | List risk dimensions |
| POST | `/markets/risk-dimensions` | Upsert risk dimension |
| GET | `/markets/runs/:id/risk-details` | Get run risk breakdown |
| GET | `/markets/instruments/:id/composite-score` | Get composite score |
| GET | `/markets/learning/proposals` | List learning proposals |
| POST | `/markets/learning/proposals/:id/approve` | Approve proposal |
| POST | `/markets/learning/proposals/:id/reject` | Reject proposal |
| GET | `/markets/learning/reports` | Learning reports |
| GET | `/markets/portfolios/analysts` | Analyst portfolios |
| GET | `/markets/portfolios/analysts/:id` | Analyst portfolio detail |
| GET | `/markets/portfolios/analysts/:id/positions` | Analyst positions |
| GET | `/markets/portfolios/leaderboard` | Analyst leaderboard |
| GET | `/markets/portfolios/me` | User portfolio |
| GET | `/markets/portfolios/me/positions` | User positions |
| GET | `/markets/portfolios/me/queue` | User trade queue |
| POST | `/markets/portfolios/me/queue-trade` | Queue a trade |
| POST | `/markets/portfolios/me/queue-trade/:id/cancel` | Cancel trade |
| GET | `/markets/base/summary` | Orchestrator base data summary |
| GET | `/markets/base/sources` | Base sources |
| GET | `/markets/base/articles` | Base articles |
| GET | `/markets/base/instruments` | Base instruments |
| GET | `/markets/base/analysts` | Base analysts |
| GET | `/markets/base/predictors` | Base predictors |
| GET | `/markets/base/predictions` | Base predictions |
| GET | `/markets/base/risk-assessments` | Base risk assessments |
| POST | `/markets/admin/run-settlement` | Trigger EOD settlement |
| POST | `/markets/admin/run-nightly-evaluation` | Trigger nightly eval |
| POST | `/markets/admin/run-learning-cycle` | Trigger learning cycle |

#### 4.3.5 Scheduled Jobs (Existing)

- `EodSettlementService`: Cron `0 22 * * 1-5` (5 PM ET Mon-Fri) — EOD settlement, portfolio reconciliation, learning cycle
- `NightlyEvaluationService`: Cron `EVERY_DAY_AT_MIDNIGHT` — nightly evaluation

#### 4.3.6 Analyst Pipeline Automation (NEW)

Add a 30-minute scheduled job that:
1. Gets all active instruments from user watchlists
2. For each instrument: checks for new articles from entitled sources
3. Scores new articles as predictors
4. Enqueues and processes prediction runs
5. Enqueues and processes risk runs
6. All using Ollama local (qwen2.5:7b) with OpenRouter fallback

Implementation: new `AnalystPipelineService` with `@Cron('*/30 * * * *')`.

### 4.4 Frontend Changes

#### 4.4.1 Environment Configuration

The Vite dev server currently proxies `/api` to `http://localhost:3100`. This must be configurable:
- Dev: proxy to `http://localhost:6100`
- Prod build: served by Nginx, which proxies `/api` to the backend

Update `vite.config.ts` to read proxy target from env var.

#### 4.4.2 Login View Upgrade

Current `LoginView.vue` uses hardcoded demo orgs and manual user ID entry. For SaaS launch:
- Add real Supabase auth flow (email/password + OAuth)
- Keep demo mode as fallback when `MARKETS_DEV_AUTH_BYPASS=true`
- Store Supabase JWT in tenant store

#### 4.4.3 API Base URL for Electron

`useApi.ts` currently uses `BASE_URL = '/api/markets'` (relative). For Electron:
- Detect Electron environment (`window.electronAPI` or similar)
- Use configurable base URL: `http://localhost:6100/markets` (self-hosted) or `https://api.divinr.ai/markets` (cloud)
- Store preference in `localStorage`

#### 4.4.4 Electron Shell

Existing `electron/main.cjs` is functional. Enhancements needed:
- Add API URL configuration dialog on first launch
- Add auto-update support (future, not in scope)
- Build pipeline: `vite build && electron-builder --mac --config electron-builder.json` (already configured)
- Add Linux target to `electron-builder.json` for Spark testing
- Add Windows target for broader distribution

#### 4.4.5 Existing Views (No Changes Needed)

All existing views are functional: DashboardView, InstrumentsView, InstrumentDetailView, AnalystsView, AnalystPerformanceView, RunsView, RunDetailView, RiskDashboardView, PredictionsView, SourcesView, PortfolioDashboardView, EvaluationsView, LearningDashboardView, CanonicalDayDetailView, DomainDashboardView.

### 4.5 Infrastructure Requirements

#### 4.5.1 DGX Spark Setup

- PostgreSQL running on port 5434 with database `divinr_ai`
- Supabase local running on port 54321 (auth only)
- Ollama running on port 11434 with `qwen2.5:7b` model pulled
- Node.js runtime (v20+)

#### 4.5.2 Dev/Prod Split

Same codebase, two directories:
- **Dev**: `~/projects/divinr.ai/` — ports 6xxx, dev `.env`
- **Prod**: `~/projects/divinr.ai-prod/` — ports 7xxx, prod `.env`

Git-based deploy: `git pull` in prod directory, `pnpm install && pnpm build`, restart Node process.

#### 4.5.3 Cloudflare Tunnel + Nginx

Nginx config:
```
server {
    listen 80;
    server_name divinr.ai;

    location /api/ {
        proxy_pass http://127.0.0.1:7100/;
    }

    location / {
        root /home/golfergeek/projects/divinr.ai-prod/apps/web/dist;
        try_files $uri $uri/ /index.html;
    }
}
```

Cloudflare tunnel: `cloudflared tunnel --url http://localhost:80`

#### 4.5.4 Process Management

For the initial launch, use simple process management:
- `nohup node dist/main.js &` or systemd unit files
- Separate processes for dev and prod

#### 4.5.5 LLM Configuration

From `.env`:
- `LLM_PROVIDER=simplified` — uses the simplified LLM service with model router
- `DEFAULT_LLM_PROVIDER=ollama` / `DEFAULT_LLM_MODEL=qwen2.5:7b` — default for all analysis
- `OPENSOURCE_LLM_PROVIDER=ollama_local` — open-source models via local Ollama
- `COMMERCIAL_LLM_PROVIDER=openrouter` — frontier models via OpenRouter (when needed)
- `OPENROUTER_API_KEY` — for OpenRouter access
- No direct provider keys used (existing keys in `.env` are legacy; the simplified LLM service routes through OpenRouter or Ollama only)

#### 4.5.6 External Services

- `FIRECRAWL_API_KEY` — source crawling
- `POLYGON_API_KEY` — market data (price feeds, EOD data)
- `BRAVE_API_KEY` — web search for article discovery

## 5. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| API response time (DB reads) | < 200ms for list endpoints |
| Pipeline cycle time | 30-minute intervals, < 5 min per instrument per cycle |
| Concurrent users | 50+ (multi-tenant, org-isolated) |
| LLM latency (Ollama local) | < 30s per analyst call (qwen2.5:7b on 128GB DGX) |
| Uptime | 99%+ (single machine, acceptable for early SaaS) |
| Security | JWT auth on all non-public endpoints; RBAC enforced; no secrets in source |
| Mobile rendering | Ionic responsive layout usable on iPhone 14+ screen sizes |
| Electron build | DMG for macOS, AppImage for Linux; < 200MB installed |

## 6. Out of Scope

- Polymarket / betting market integration (future domain)
- Election prediction integration (future domain)
- Azure cloud deployment (triggered by Pro subscriber growth)
- Frontier model integration beyond OpenRouter fallback (Phase 2 of infrastructure)
- Terms of Service drafting
- Trademark filings
- Credit and Collections Policy
- Native iOS/Android app builds (Capacitor is present but not targeted for this effort)
- Auto-update for Electron (future)
- Windows Electron build (future — macOS + Linux only for now)

## 7. Dependencies & Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Ollama qwen2.5:7b quality insufficient for analyst pipeline | Predictions may be low quality | Medium | OpenRouter fallback to frontier models; tune prompts for smaller model; evaluate quality before launch |
| Database backup incompatible with Spark PostgreSQL version | Blocks all progress | Low | Test restore early (Phase 1); backup is from PostgreSQL 17.6 which should be compatible |
| Supabase local instability | Auth failures | Low | Supabase local is mature; dev bypass available for development |
| DGX Spark single point of failure | Downtime if machine goes down | Medium | Acceptable for early SaaS; Mac Studio available as fallback web/API server |
| Cloudflare tunnel disconnects | External access lost | Low | Cloudflare tunnels are reliable; `cloudflared` auto-reconnects |
| OrchestratorBaseDataService connects to Orchestrator DB | Violates "Divinr's own DB only" constraint | High | Make ORCHESTRATOR_DATABASE_URL optional (already is); ensure all Divinr data is self-contained in prediction schema; base data endpoints return empty when not configured |
| `.env` contains legacy direct provider keys (OpenAI, Anthropic, etc.) | Potential confusion; may accidentally use direct keys | Medium | Clean up `.env` to remove unused keys; verify simplified LLM service does not use them |
| Port 3100 hardcoded as default | Doesn't match 6xxx/7xxx convention | Low | Set PORT in `.env`; the code already reads from env var |
| Electron app hardcoded to Vite dev server port 5173 | Won't work in production | Low | Already handled: production mode loads from `dist/index.html` |

## 8. Phasing

### Phase 1: Database Restoration & Environment Setup
- Restore `prediction_schema_backup_20260403.sql` to PostgreSQL on port 5434
- Verify all 68 tables are created and data is accessible
- Create dev `.env` with port 6100 for API, all required env vars
- Create prod `.env` template with port 7100
- Verify Ollama is running with qwen2.5:7b model
- Verify Supabase local is running on port 54321
- Clean up `.env`: remove unused direct provider keys; document which keys are actively used

### Phase 2: API Server on Node
- Update `PORT` in `.env` to 6100
- Build and start the API: `pnpm build && node apps/api/dist/main.js`
- Verify health endpoint: `GET /health`
- Verify all markets endpoints respond (with dev auth bypass)
- Verify database connectivity: markets service can read/write prediction schema
- Verify LLM connectivity: Ollama local responds, OpenRouter fallback works
- Confirm OrchestratorBaseDataService gracefully handles missing `ORCHESTRATOR_DATABASE_URL`

### Phase 3: Authentication Verification
- Verify Supabase identity provider validates JWT tokens
- Test full auth flow: get token from Supabase -> call API with Bearer token -> verify user resolution
- Verify JwtAuthGuard rejects unauthenticated requests
- Verify RBAC service enforces role-based access
- Test dev bypass mode works correctly
- Verify auth middleware populates `req.user` with correct fields (id, email, role, appMetadata)
- Audit for security gaps: token expiry, refresh flow, header injection

### Phase 4: A2A Protocol Endpoints
- Implement `GET /.well-known/agent.json` serving the Divinr agent card
- Implement `POST /a2a` JSON-RPC endpoint accepting `A2AInvokeRequest`
- Map A2A invoke requests to existing markets controller methods
- Return proper A2A task lifecycle responses (submitted/working/completed/failed)
- Test A2A discovery: `curl /.well-known/agent.json`
- Test A2A invocation: POST to `/a2a` with invoke payload

### Phase 5: Analyst Pipeline Automation
- Implement `AnalystPipelineService` with `@Cron('*/30 * * * *')`
- Pipeline steps: get active instruments -> check for new articles -> score predictors -> enqueue runs -> process runs
- Use FireCrawl API for source crawling
- Use Polygon API for market data
- Verify pipeline completes within 5 minutes per instrument
- Add pipeline health monitoring (logging, observability events)
- Ensure pipeline respects selective instrument tracking (only user-curated watchlists)

### Phase 6: Web Frontend Connection
- Update `vite.config.ts` proxy target to match API port (6100 dev)
- Upgrade `LoginView.vue` to support real Supabase auth flow
- Verify all Pinia stores fetch data correctly from API
- Test all views render with real data: Dashboard, Instruments, Analysts, Runs, Risk, Predictions, Sources, Portfolios, Evaluations, Learning
- Verify WebSocket/SSE connections if any (observability stream)

### Phase 7: Cloudflare Tunnel + Nginx
- Install and configure Nginx on the Spark
- Set up Nginx config: API proxy + static file serving
- Set up Cloudflare tunnel (`cloudflared`)
- Build prod frontend: `pnpm --filter @divinr/web build`
- Set up prod directory with prod `.env` (port 7100)
- Verify external access: `https://divinr.ai/health`, `https://divinr.ai/` serves Vue app
- Verify Vue router handles client-side routing (Nginx `try_files`)

### Phase 8: Mobile Verification
- Access `https://divinr.ai` on iPhone Safari
- Verify dashboard renders correctly (Ionic responsive)
- Check charts, prediction timelines, risk matrices on small screen
- Document any layout issues for future fix
- Test touch interactions (ion-buttons, ion-cards, navigation)

### Phase 9: Electron Desktop App
- Add Linux target to `electron-builder.json`
- Add API URL configuration dialog to Electron shell (cloud vs localhost)
- Add API key management UI for self-hosted users (enter OpenRouter key, Ollama URL, DB connection)
- Update `useApi.ts` to support configurable base URL for Electron
- Build: `pnpm --filter @divinr/web build:electron`
- Test DMG on macOS: install, launch, connect to cloud API
- Test AppImage on Linux (Spark): install, launch, connect to localhost API
- Verify self-hosted flow: user provides own API keys, connects to local API
- Document Electron distribution and self-hosted setup
