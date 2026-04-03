# Move to Spark — Intention

## What This Effort Is

Move the entire Divinr AI platform from its previous environment onto the DGX Spark (128GB RAM), get everything running end-to-end through Node (no Docker), and extend the platform to include a packaged Electron desktop app. By the end of this effort, Divinr AI should be a fully operational SaaS platform serving web, mobile (via Ionic), and desktop (via Electron) — all reading from the same API, all conforming to Google's A2A protocol.

## Why It Matters

Divinr AI is both a standalone product and the primary proof of concept for Orchestrator AI. Getting it running on the Spark is the foundation for everything: the public SaaS launch (target: end of April 2026), the self-hosted desktop tier for advanced users, and the demonstration that Orchestrator AI can consume Divinr's endpoints via standard A2A discovery.

## Core Principle: Selective Instrument Tracking

This system cannot analyze every instrument. The analyst pipeline runs substantial AI processing per instrument — crawling, article ingestion, LLM-driven analysis with multiple sub-analysts on 30-minute cycles. Users must be deliberate about what they follow. This applies across all domains:

- **Stocks**: User-curated watchlists
- **Crypto**: Only what fits within the stock market context (for now)
- **Betting markets (Polymarket)**: Carefully selected bets (future)
- **Election prediction**: Carefully scoped election tracking (future)

This is a design principle, not a temporary limitation. It shapes UI, pipeline scope, and tier differentiation.

## What Needs to Happen

### 1. Database Restoration
A database backup exists in the project root directory. Restore it to build/verify the schema and populate existing data for: sources, articles, predictors, predictions, instruments, and initial risk data. The database runs on the Spark. Inspect the backup to determine format and contents; fill gaps as needed.

### 2. Environment-Driven Configuration
The API and web apps must use environment variables for all configuration — ports, base URLs, database connections, API keys, LLM providers. No hardcoded values. The `.env` file in `scripts/` provides:
- **Database**: `DATABASE_URL` (Divinr's own DB, port 5434) — no Orchestrator database connection needed, Divinr runs its own data
- **LLM**: OpenRouter for any frontier model access (when needed), Ollama local (open-source, default `qwen2.5:7b`). No direct provider keys (no OpenAI, Anthropic, xAI, Google) — all frontier routing goes through OpenRouter.
- **Services**: FireCrawl for crawling, Polygon for market data, Brave for search
- **Supabase**: Local instance at port 54321 for auth

The same codebase runs in dev and prod — the only difference is the `.env` values (different ports, different database URLs, etc.).

### 3. API Server Running on Node
Get the backend API running on the Spark through Node directly — no Docker. Two environments:
- **Dev**: Current project directory, port 6000s
- **Prod**: Separate `-prod` directory, port 7000s

Both run identically except for port numbers and environment config loaded from their respective `.env` files.

### 4. Authentication Verification
The auth system was previously built to be fully SaaS-compliant. Verify this is actually the case — check the existing auth middleware, token handling, role-based access, and security posture. If it's solid, move on. If there are gaps, fix them immediately.

### 5. A2A Protocol Endpoints
All API endpoints must conform to Google's A2A protocol:
- Agent cards for discovery
- Standard task lifecycle
- Authentication required on endpoints
- This enables Orchestrator AI to consume Divinr's API through standard A2A discovery
- This also means the self-hosted Electron app uses the exact same API contract — it just points at localhost instead of the Cloudflare tunnel

### 6. Analyst Pipeline on Spark
Stand up the full analyst pipeline on the Spark:
- Source crawling
- Article ingestion
- LLM-driven analysis (30-minute cycles)
- Predictors and predictions
- Risk analysis
- Running against user-curated instrument watchlists

User-facing responses are fast database reads, not live inference.

### 7. Web Frontend
Get the Vue/Ionic frontend working, connected to the API, showing:
- Instrument watchlists
- Sources and articles
- Predictions and risk data
- All reading from A2A endpoints on the backend

### 8. Cloudflare Tunnel + Nginx Routing
Set up external access using the same pattern as Orchestrator AI:
- Single Cloudflare tunnel into the Spark
- Nginx routes traffic to the correct service
- Vue router handles client-side routing

### 9. Mobile Verification
Verify the app works and is usable on iPhone via Ionic's mobile rendering. This is a "confirm it works" checkpoint — not a "build mobile-specific features" phase. Key concern: do analyst dashboards (charts, prediction timelines, risk matrices) render well on a small screen?

### 10. Electron Desktop App + Build Pipeline
Package the Vue/Ionic web app in an Electron shell as a real desktop application:
- The app connects to either the cloud API (for Base/Pro users) or localhost (for self-hosted users)
- Build pipeline producing distributable packages
- Self-hosted users bring their own API keys and database
- Advanced users get API key management through their user account
- The licensed product is the analyst layer, not the infrastructure

## What This Effort Does NOT Include

- Polymarket / betting market integration (future domain)
- Election prediction integration (future domain)
- Azure cloud deployment (triggered by Pro subscriber growth)
- Frontier model integration (Phase 2 of infrastructure strategy — triggered by revenue)
- Terms of Service drafting
- Trademark filings
- Credit and Collections Policy

## Infrastructure Context

- **DGX Spark**: 128GB RAM, runs database + inference + analyst pipeline
- **Mac Studio**: Available as web/API server if needed
- **No Docker**: Everything runs through Node
- **Dev/Prod split**: Same codebase, different directories, different ports
