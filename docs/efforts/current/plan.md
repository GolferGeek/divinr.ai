# Move to Spark — Implementation Plan

**PRD**: prd.md
**Created**: 2026-04-03
**Status**: Not Started

## Progress Tracker
- [ ] Phase 1: Database Restoration & Environment Setup
- [ ] Phase 2: API Server on Node
- [ ] Phase 3: Authentication Verification
- [ ] Phase 4: A2A Protocol Endpoints
- [ ] Phase 5: Analyst Pipeline Automation
- [ ] Phase 6: Web Frontend Connection
- [ ] Phase 7: Cloudflare Tunnel + Nginx Routing
- [ ] Phase 8: Mobile Verification
- [ ] Phase 9: Electron Desktop App

---

## Phase 1: Database Restoration & Environment Setup
**Status**: Not Started
**Objective**: Restore the prediction schema database on the Spark and establish environment-driven configuration for dev and prod.

### Steps
- [ ] 1.1 Verify PostgreSQL is running on port 5434: `pg_isready -h 127.0.0.1 -p 5434`
- [ ] 1.2 Create the `divinr_ai` database if it does not exist: `createdb -h 127.0.0.1 -p 5434 -U postgres divinr_ai`
- [ ] 1.3 Restore the backup: `psql -h 127.0.0.1 -p 5434 -U postgres -d divinr_ai < prediction_schema_backup_20260403.sql`
- [ ] 1.4 Verify all 68 tables exist: `psql -h 127.0.0.1 -p 5434 -U postgres -d divinr_ai -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'prediction'"`
- [ ] 1.5 Verify data is queryable: `psql -h 127.0.0.1 -p 5434 -U postgres -d divinr_ai -c "SELECT count(*) FROM prediction.instruments; SELECT count(*) FROM prediction.analysts; SELECT count(*) FROM prediction.source_catalog;"`
- [ ] 1.6 Update `scripts/.env`: set `PORT=6100`, verify `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/divinr_ai`
- [ ] 1.7 Clean up `scripts/.env`: remove or comment out unused direct provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GROK_API_KEY`, `XAI_API_KEY`, `PERPLEXITY_API_KEY`). Add comments documenting which keys are actively used.
- [ ] 1.8 Comment out or remove `ORCHESTRATOR_DATABASE_URL` from dev `.env` (Divinr runs its own DB only)
- [ ] 1.9 Create `scripts/.env.prod` template with `PORT=7100` and prod-specific values
- [ ] 1.10 Verify Ollama is running: `curl http://localhost:11434/api/tags` — confirm `qwen2.5:7b` is available. If not: `ollama pull qwen2.5:7b`
- [ ] 1.11 Verify Supabase local is running: `curl http://127.0.0.1:54321/auth/v1/health`

### Quality Gate
- [ ] **Lint**: (`pnpm lint`)
- [ ] **Build**: (`pnpm build`)
- [ ] **Unit Tests**: (`pnpm --filter @divinr/api test:unit`)
- [ ] **E2E Tests**: N/A for this phase
- [ ] **Curl Tests**:
  - `psql -h 127.0.0.1 -p 5434 -U postgres -d divinr_ai -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'prediction' ORDER BY table_name"` — should list 68 tables
  - `curl http://localhost:11434/api/tags` — should include qwen2.5:7b
  - `curl http://127.0.0.1:54321/auth/v1/health` — should return OK
- [ ] **Chrome Tests**: N/A
- [ ] **Phase Review**: Compare against PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the code align with PRD requirements?
  - [ ] Any deviations? Document why.

---

## Phase 2: API Server on Node
**Status**: Not Started
**Objective**: Get the NestJS API server running on the Spark through Node, connected to the database and LLM services.

### Steps
- [ ] 2.1 Install dependencies: `pnpm install` (from project root)
- [ ] 2.2 Build all packages: `pnpm build`
- [ ] 2.3 Ensure `.env` is loaded: verify `apps/api` reads from `scripts/.env`. Check if `ConfigModule.forRoot()` in `app.module.ts` needs `envFilePath` set to `../../scripts/.env`.
- [ ] 2.4 Start the API: `cd apps/api && node dist/main.js`
- [ ] 2.5 Verify health endpoint responds: `curl http://localhost:6100/health`
- [ ] 2.6 Verify database connectivity: `curl -H "x-user-id: test" -H "x-org-slug: alpha-capital" "http://localhost:6100/markets/instruments?organizationSlug=alpha-capital"` (with `MARKETS_DEV_AUTH_BYPASS=true`)
- [ ] 2.7 Verify LLM connectivity: check API logs for "Connected to Ollama" or similar; test a prediction scoring endpoint
- [ ] 2.8 Verify OrchestratorBaseDataService logs "ORCHESTRATOR_DATABASE_URL not set — base data endpoints will return empty results" (expected)
- [ ] 2.9 Verify scheduled jobs are registered: check logs for ScheduleModule registration of EOD settlement and nightly evaluation crons

### Quality Gate
- [ ] **Lint**: (`pnpm lint`)
- [ ] **Build**: (`pnpm build`)
- [ ] **Unit Tests**: (`pnpm --filter @divinr/api test:unit`)
- [ ] **E2E Tests**: (`pnpm --filter @divinr/api test:compliance`)
- [ ] **Curl Tests**:
  - `curl http://localhost:6100/health` — expect `{"ok":true,"service":"divinr-api",...}`
  - `curl -H "x-user-id: test" "http://localhost:6100/markets/instruments?organizationSlug=alpha-capital"` — expect JSON array (may be empty)
  - `curl -H "x-user-id: test" "http://localhost:6100/markets/base/summary"` — expect empty or summary object
- [ ] **Chrome Tests**: N/A
- [ ] **Phase Review**: Compare against PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the code align with PRD requirements?
  - [ ] Any deviations? Document why.

---

## Phase 3: Authentication Verification
**Status**: Not Started
**Objective**: Verify Supabase local auth validates JWT tokens end-to-end and RBAC is enforced.

### Steps
- [ ] 3.1 Create a test user in Supabase local: use Supabase CLI or dashboard at `http://127.0.0.1:54321`
- [ ] 3.2 Get a JWT token: `curl -X POST http://127.0.0.1:54321/auth/v1/signup -H "apikey: <SUPABASE_ANON_KEY>" -H "Content-Type: application/json" -d '{"email":"test@divinr.ai","password":"testpass123"}'`
- [ ] 3.3 Call API with Bearer token: `curl -H "Authorization: Bearer <TOKEN>" "http://localhost:6100/markets/instruments?organizationSlug=alpha-capital"`
- [ ] 3.4 Verify unauthenticated request is rejected: `curl "http://localhost:6100/markets/instruments?organizationSlug=alpha-capital"` (with `MARKETS_DEV_AUTH_BYPASS=false`) — expect 401 or 403
- [ ] 3.5 Verify `req.user` is populated correctly by examining API logs or adding a debug endpoint temporarily
- [ ] 3.6 Review `SupabaseIdentityProvider` validates token expiry, role assignment, and metadata extraction
- [ ] 3.7 Review `JwtAuthGuard` in `packages/planes/auth/guards/jwt-auth.guard.ts` — confirm it blocks unauthenticated requests
- [ ] 3.8 Review RBAC service: check `packages/planes/rbac/rbac.service.ts` for role enforcement
- [ ] 3.9 Verify `LoginView.vue` tenant store correctly stores and sends JWT
- [ ] 3.10 Document any auth gaps found and fix immediately

### Quality Gate
- [ ] **Lint**: (`pnpm lint`)
- [ ] **Build**: (`pnpm build`)
- [ ] **Unit Tests**: (`pnpm --filter @divinr/api test:unit` — includes `auth-middleware.test.ts`)
- [ ] **E2E Tests**: (`pnpm --filter @divinr/api test:compliance`)
- [ ] **Curl Tests**:
  - `curl -X POST http://127.0.0.1:54321/auth/v1/signup -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0" -H "Content-Type: application/json" -d '{"email":"test@divinr.ai","password":"testpass123"}'` — expect user + token
  - `curl -H "Authorization: Bearer <TOKEN>" "http://localhost:6100/health"` — expect 200
  - `curl "http://localhost:6100/markets/instruments?organizationSlug=alpha-capital"` — expect 401/403 (bypass disabled)
- [ ] **Chrome Tests**: N/A
- [ ] **Phase Review**: Compare against PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the code align with PRD requirements?
  - [ ] Any deviations? Document why.

---

## Phase 4: A2A Protocol Endpoints
**Status**: Not Started
**Objective**: Implement Google A2A protocol discovery and invocation endpoints so Orchestrator AI can consume Divinr's API.

### Steps
- [ ] 4.1 Create `apps/api/src/a2a/a2a.controller.ts` with `@Controller('.well-known')` for agent card
- [ ] 4.2 Implement `GET /.well-known/agent.json` returning the Divinr agent card (per PRD Section 4.3.2). Mark as `@Public()` for unauthenticated discovery.
- [ ] 4.3 Create `apps/api/src/a2a/a2a-invoke.controller.ts` with `POST /a2a` endpoint
- [ ] 4.4 Implement A2A invoke handler: parse `A2AInvokeRequest`, extract capability slug, map to internal service methods
- [ ] 4.5 Return proper A2A task lifecycle responses using types from `packages/transport-types/a2a/response.types.ts`
- [ ] 4.6 Create `apps/api/src/a2a/a2a.module.ts` and register in `AppModule`
- [ ] 4.7 Write unit tests for A2A controller: agent card shape, invoke routing, error handling
- [ ] 4.8 Test A2A discovery end-to-end

### Quality Gate
- [ ] **Lint**: (`pnpm lint`)
- [ ] **Build**: (`pnpm build`)
- [ ] **Unit Tests**: (`pnpm --filter @divinr/api test:unit`)
- [ ] **E2E Tests**: (`pnpm --filter @divinr/api test:compliance`)
- [ ] **Curl Tests**:
  - `curl http://localhost:6100/.well-known/agent.json` — expect agent card JSON with capabilities array
  - `curl -X POST http://localhost:6100/a2a -H "Content-Type: application/json" -H "Authorization: Bearer <TOKEN>" -d '{"jsonrpc":"2.0","id":"1","method":"invoke","params":{"context":{"tenantId":"alpha-capital","userId":"test"},"data":{"content":{"capability":"markets/instruments","action":"list"}}}}'` — expect A2A response with task status
- [ ] **Chrome Tests**: N/A
- [ ] **Phase Review**: Compare against PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the code align with PRD requirements?
  - [ ] Any deviations? Document why.

---

## Phase 5: Analyst Pipeline Automation
**Status**: Not Started
**Objective**: Stand up the 30-minute automated analyst pipeline that crawls sources, ingests articles, and runs LLM-driven analysis for user-curated instruments.

### Steps
- [ ] 5.1 Create `apps/api/src/markets/services/analyst-pipeline.service.ts`
- [ ] 5.2 Implement `@Cron('*/30 * * * *')` scheduled method
- [ ] 5.3 Pipeline step 1: Query all active instruments from user watchlists across all tenants
- [ ] 5.4 Pipeline step 2: For each instrument, check entitled sources for new articles (use FireCrawl API via `FIRECRAWL_API_KEY`)
- [ ] 5.5 Pipeline step 3: Score new articles as predictors using `PredictionRunnerService`
- [ ] 5.6 Pipeline step 4: Enqueue prediction runs for instruments with new predictors
- [ ] 5.7 Pipeline step 5: Enqueue risk runs for instruments with completed prediction runs
- [ ] 5.8 Pipeline step 6: Process all queued runs (calls existing `processQueuedRuns`)
- [ ] 5.9 Add pipeline health logging via `ObservabilityEventsService`
- [ ] 5.10 Add `MARKETS_ENABLE_PIPELINE=true` env var to control pipeline activation
- [ ] 5.11 Register `AnalystPipelineService` in `MarketsModule`
- [ ] 5.12 Verify pipeline uses Ollama local (qwen2.5:7b) by default, falls back to OpenRouter
- [ ] 5.13 Test pipeline manually via new admin endpoint: `POST /markets/admin/run-pipeline`
- [ ] 5.14 Verify pipeline respects selective instrument tracking (only processes instruments from user watchlists)
- [ ] 5.15 Measure pipeline timing: target < 5 minutes per instrument

### Quality Gate
- [ ] **Lint**: (`pnpm lint`)
- [ ] **Build**: (`pnpm build`)
- [ ] **Unit Tests**: (`pnpm --filter @divinr/api test:unit`)
- [ ] **E2E Tests**: (`pnpm --filter @divinr/api test:markets`)
- [ ] **Curl Tests**:
  - `curl -X POST -H "x-user-id: test" -H "Content-Type: application/json" "http://localhost:6100/markets/admin/run-pipeline"` — expect pipeline execution summary
  - `curl -H "x-user-id: test" "http://localhost:6100/markets/runs?organizationSlug=alpha-capital&status=completed"` — expect completed runs from pipeline
- [ ] **Chrome Tests**: N/A
- [ ] **Phase Review**: Compare against PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the code align with PRD requirements?
  - [ ] Any deviations? Document why.

---

## Phase 6: Web Frontend Connection
**Status**: Not Started
**Objective**: Get the Vue/Ionic frontend connected to the API and rendering real data.

### Steps
- [ ] 6.1 Update `apps/web/vite.config.ts`: change proxy target from `http://localhost:3100` to `http://localhost:${process.env.VITE_API_PORT || '6100'}`
- [ ] 6.2 Add `VITE_API_PORT=6100` to dev `.env` (or keep as default)
- [ ] 6.3 Upgrade `LoginView.vue`: add Supabase auth flow (email/password signup/login using `@supabase/supabase-js`). Keep demo org selector for dev mode.
- [ ] 6.4 Add `@supabase/supabase-js` to `apps/web` dependencies
- [ ] 6.5 Update `tenant.store.ts`: add Supabase client initialization, token refresh logic
- [ ] 6.6 Start dev server: `pnpm --filter @divinr/web dev`
- [ ] 6.7 Verify login flow: navigate to `/login`, authenticate, redirect to dashboard
- [ ] 6.8 Verify Dashboard view loads instruments, recent predictions, risk scores
- [ ] 6.9 Verify Instruments view lists instruments, detail view shows predictions/risk
- [ ] 6.10 Verify Analysts view shows analyst personas and performance
- [ ] 6.11 Verify Runs view shows run history with status filtering
- [ ] 6.12 Verify Risk Dashboard shows composite scores and dimension charts
- [ ] 6.13 Verify Sources view shows entitled sources and articles
- [ ] 6.14 Verify Portfolio view shows analyst/user portfolios and leaderboard
- [ ] 6.15 Verify Learning Dashboard shows proposals, reports
- [ ] 6.16 Verify Evaluations view renders

### Quality Gate
- [ ] **Lint**: (`pnpm --filter @divinr/web lint`)
- [ ] **Build**: (`pnpm --filter @divinr/web build`)
- [ ] **Unit Tests**: (web tests not yet implemented — tracked for future)
- [ ] **E2E Tests**: N/A (manual Chrome tests instead)
- [ ] **Curl Tests**: N/A (frontend tested via browser)
- [ ] **Chrome Tests**:
  - Navigate to `http://localhost:5173/login` — login form renders
  - Login with test credentials — redirects to dashboard
  - Navigate to `/instruments` — instrument cards render
  - Click an instrument — detail view with predictions and risk
  - Navigate to `/runs` — run list with status chips
  - Navigate to `/risk` — risk dashboard with dimension charts
  - Navigate to `/sources` — source list with article counts
  - Navigate to `/portfolio` — analyst portfolios and leaderboard
  - Navigate to `/learning` — learning proposals list
- [ ] **Phase Review**: Compare against PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the code align with PRD requirements?
  - [ ] Any deviations? Document why.

---

## Phase 7: Cloudflare Tunnel + Nginx Routing
**Status**: Not Started
**Objective**: Set up external access via Cloudflare tunnel with Nginx routing to API and static frontend.

### Steps
- [ ] 7.1 Install Nginx on the Spark: `sudo apt install nginx`
- [ ] 7.2 Create Nginx config at `/etc/nginx/sites-available/divinr.ai`:
  ```
  server {
      listen 80;
      server_name divinr.ai;

      location /api/ {
          proxy_pass http://127.0.0.1:7100/;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
      }

      location / {
          root /home/golfergeek/projects/divinr.ai-prod/apps/web/dist;
          try_files $uri $uri/ /index.html;
      }
  }
  ```
- [ ] 7.3 Enable the site: `sudo ln -s /etc/nginx/sites-available/divinr.ai /etc/nginx/sites-enabled/`
- [ ] 7.4 Test Nginx config: `sudo nginx -t`
- [ ] 7.5 Reload Nginx: `sudo systemctl reload nginx`
- [ ] 7.6 Set up prod directory: `git clone <repo> ~/projects/divinr.ai-prod` (or `cp -r`)
- [ ] 7.7 Copy `scripts/.env.prod` to prod directory, set `PORT=7100`
- [ ] 7.8 Build prod: `cd ~/projects/divinr.ai-prod && pnpm install && pnpm build`
- [ ] 7.9 Start prod API: `cd ~/projects/divinr.ai-prod/apps/api && node dist/main.js`
- [ ] 7.10 Verify local access: `curl http://localhost:80/api/health` — should return health JSON
- [ ] 7.11 Install cloudflared: `sudo apt install cloudflared` (or download binary)
- [ ] 7.12 Configure Cloudflare tunnel: `cloudflared tunnel create divinr` and configure DNS
- [ ] 7.13 Start tunnel: `cloudflared tunnel run divinr`
- [ ] 7.14 Verify external access: `curl https://divinr.ai/api/health`

### Quality Gate
- [ ] **Lint**: (`pnpm lint` in prod directory)
- [ ] **Build**: (`pnpm build` in prod directory)
- [ ] **Unit Tests**: (`pnpm --filter @divinr/api test:unit` in prod directory)
- [ ] **E2E Tests**: N/A
- [ ] **Curl Tests**:
  - `curl http://localhost:7100/health` — expect health JSON from prod API
  - `curl http://localhost:80/api/health` — expect health JSON via Nginx
  - `curl https://divinr.ai/api/health` — expect health JSON via tunnel
  - `curl https://divinr.ai/` — expect HTML (Vue app index.html)
- [ ] **Chrome Tests**:
  - Navigate to `https://divinr.ai/` — Vue app loads
  - Navigate to `https://divinr.ai/login` — login form renders
  - Login and navigate through pages — client-side routing works
  - Hard refresh on `/instruments` — Nginx serves index.html (SPA fallback)
- [ ] **Phase Review**: Compare against PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the code align with PRD requirements?
  - [ ] Any deviations? Document why.

---

## Phase 8: Mobile Verification
**Status**: Not Started
**Objective**: Verify the app works and is usable on iPhone via Ionic's mobile rendering.

### Steps
- [ ] 8.1 Open `https://divinr.ai` on iPhone Safari
- [ ] 8.2 Verify login page renders correctly on mobile
- [ ] 8.3 Login and verify dashboard loads
- [ ] 8.4 Check instrument cards layout on small screen (should stack vertically)
- [ ] 8.5 Verify prediction timelines are readable on mobile
- [ ] 8.6 Verify risk dimension charts render at appropriate size
- [ ] 8.7 Verify composite score gauges are visible
- [ ] 8.8 Test navigation: side menu or tab bar works on mobile
- [ ] 8.9 Test touch interactions: buttons, cards, pull-to-refresh
- [ ] 8.10 Document any layout issues found with screenshots
- [ ] 8.11 File issues for any critical rendering problems (fix in a future phase)

### Quality Gate
- [ ] **Lint**: N/A
- [ ] **Build**: N/A
- [ ] **Unit Tests**: N/A
- [ ] **E2E Tests**: N/A
- [ ] **Curl Tests**: N/A
- [ ] **Chrome Tests** (on iPhone Safari):
  - `https://divinr.ai/login` — form is usable, inputs are touch-friendly
  - `https://divinr.ai/` — dashboard renders, cards are readable
  - `https://divinr.ai/instruments` — instrument list scrollable
  - `https://divinr.ai/risk` — charts visible (may need scroll)
  - `https://divinr.ai/portfolio` — leaderboard readable
- [ ] **Phase Review**: Compare against PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the code align with PRD requirements?
  - [ ] Any deviations? Document why.

---

## Phase 9: Electron Desktop App
**Status**: Not Started
**Objective**: Package the Vue/Ionic web app in an Electron shell as a distributable desktop application.

### Steps
- [ ] 9.1 Add Linux target to `apps/web/electron-builder.json`: `"linux": {"target": ["AppImage"]}`
- [ ] 9.2 Update `apps/web/electron/main.cjs`: add API URL configuration
  - On first launch, check `localStorage` / electron-store for saved API URL
  - If not set, show configuration dialog: cloud (`https://api.divinr.ai`) vs localhost (`http://localhost:6100`)
  - Pass selected URL to the renderer via `preload.js` or URL parameter
- [ ] 9.3 Create `apps/web/electron/preload.js` to expose API URL to renderer
- [ ] 9.4 Update `apps/web/src/composables/useApi.ts`: detect Electron environment, use configured base URL instead of relative `/api/markets`
- [ ] 9.5 Add API key management UI component for self-hosted users: settings page where users enter their OpenRouter API key, Ollama URL, and database connection
- [ ] 9.6 Build for macOS: `cd apps/web && pnpm build:electron` — produces DMG in `release/`
- [ ] 9.7 Build for Linux: `cd apps/web && vite build && electron-builder --linux --config electron-builder.json` — produces AppImage
- [ ] 9.8 Test macOS DMG: install, launch, configure to connect to cloud API, verify dashboard loads
- [ ] 9.9 Test Linux AppImage on Spark: launch, configure to connect to `http://localhost:6100`, verify dashboard loads
- [ ] 9.10 Test self-hosted flow: Electron app pointed at local API, user's own data visible
- [ ] 9.11 Verify Electron app uses same views/components as web (shared codebase)
- [ ] 9.12 Document Electron distribution: download links, self-hosted setup instructions

### Quality Gate
- [ ] **Lint**: (`pnpm --filter @divinr/web lint`)
- [ ] **Build**: (`pnpm --filter @divinr/web build && pnpm --filter @divinr/web build:electron`)
- [ ] **Unit Tests**: N/A (Electron tested manually)
- [ ] **E2E Tests**: N/A
- [ ] **Curl Tests**: N/A
- [ ] **Chrome Tests** (in Electron app):
  - Launch DMG/AppImage — app window opens with Divinr AI title
  - First launch — API URL configuration dialog appears
  - Select cloud API — dashboard loads with cloud data
  - Select localhost — dashboard loads with local data (if API running)
  - Navigate through all views — same functionality as web
  - Settings page — API key management UI renders
- [ ] **Phase Review**: Compare against PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the code align with PRD requirements?
  - [ ] Any deviations? Document why.
