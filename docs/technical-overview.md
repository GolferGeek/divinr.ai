# Divinr.ai Technical Overview

This document gives technical reviewers a fast path through the product architecture without requiring them to read the full effort history.

## System Shape

Divinr.ai is a TypeScript monorepo built with pnpm workspaces and Turbo.

- `apps/web`: Vue 3, Ionic Vue, Pinia, Vite, and an Electron wrapper.
- `apps/api`: NestJS API, scheduled jobs, market-analysis services, auth, billing, and schema bootstrap.
- `apps/e2e`: Playwright tests grouped by product facet.
- `apps/ios`: Capacitor/iOS shell.
- `packages/transport-types`: shared transport contracts.
- `packages/planes`: infrastructure-plane abstractions.
- `packages/prediction-planes`: market-analysis plane package.

## Runtime Model

The API owns the core application state and background work:

- Authenticated product endpoints.
- Market instruments, analyst outputs, article relevance, and paper portfolios.
- Clubs, tournaments, messages, onboarding, billing, and admin surfaces.
- Scheduled jobs for crawler, analysis, outcome tracking, ranking, learning, and billing lifecycle work.
- Explicit schema bootstrap and migration paths.

The web app consumes API surfaces through local Vite proxy routes and app stores. Local development defaults to API port `7100` and web port `7101`.

## Data and Tenancy

The local default database is PostgreSQL. API services are expected to scope user and organization access explicitly. Schema mutation is intentionally separated from request-time business logic:

- Bootstrap and migration code may create or update schema.
- Controllers, guards, and normal service methods must not call request-time DDL.
- Readiness should fail if required schema state is missing.

## AI and Analysis Pipeline

The market-analysis system is organized around independent analyst roles:

- Five personality analysts produce separate reads.
- An arbitrator synthesizes competing signals.
- A portfolio manager converts signal into simulated trade intent.
- Day-trader strategies run deterministic algorithmic workflows.

LLM-backed processing is optional in local development. The default routing favors local/open-source models through Ollama. Commercial fallback is disabled unless explicitly enabled.

## Trust, Legal, and Product Language

The product is intentionally framed as analysis, education, and paper-trading practice:

- No real trades are placed.
- User-facing copy uses "analysis" and "signal".
- Centralized disclaimers state that Divinr.ai is not a prediction model and not investment advice.
- Reasoning, citations, calibration, and outcome history are part of the product surface.

## Billing

Billing uses Stripe in test mode for local and pre-live development:

- Trial and subscription lifecycle.
- Stripe-hosted checkout and customer portal.
- Webhook handling through the Stripe CLI in local development.
- Student pricing and authored-content pricing paths.
- RBAC-gated operator tools.

If Stripe credentials are absent, billing paths are expected to no-op or return null-equivalent state instead of blocking local development.

## Testing and Verification

The repository includes multiple levels of verification:

- Workspace lint, typecheck, build, and test commands.
- API unit tests.
- Compliance and boundary tests.
- Market smoke, HTTP, and integration tests.
- Playwright E2E tests for browser-visible product facets.
- First-touch onboarding coverage checks for user-facing surfaces.

The existing GitHub Actions workflow runs build, unit, and market-integration gates.

## External Integrations

Optional integrations are controlled by environment variables:

- Ollama and other LLM providers.
- Stripe.
- Firecrawl.
- Polygon, Twelve Data, FMP, Finnhub, and FRED.
- Orchestrator crawler/database reuse.
- Supabase-compatible modes.
- Observability/tracing providers.

The default local environment is designed to start without most third-party credentials.
