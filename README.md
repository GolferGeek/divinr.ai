# Divinr AI Monorepo

Phase 0 foundation monorepo for Divinr AI.

## Workspace

- `apps/api` - NestJS API (phase placeholder)
- `apps/web` - Vite + Vue web app (phase placeholder)
- `apps/ios` - native iOS app (deferred)
- `packages/transport-types` - shared transport types extracted from orchestrator
- `packages/planes` - extracted infrastructure planes

## Current Phase

This repository is in **Phase 0**:

- monorepo setup
- planes extraction snapshot
- enforcement guardrails for no direct DB/LLM bypass in app code

## Commands

- `pnpm install`
- `pnpm -w run lint`
- `pnpm -w run typecheck`
- `pnpm -w run build`
- `docker compose up -d` (starts `divinr.ai` Postgres with DB `divinr_ai`)

## External Crawler Sync (Orchestrator Reuse)

The API can reuse existing Orchestrator crawler data from `crawler.sources` and
`crawler.articles` and sync it into Divinr `prediction.market_articles`.

Environment flags:

- `MARKETS_EXTERNAL_SYNC_ENABLED=true`
- `MARKETS_EXTERNAL_SYNC_ORG_SLUG=<orchestrator-org-slug>`
- `MARKETS_EXTERNAL_SOURCE_LIMIT=500` (optional)
- `MARKETS_EXTERNAL_ARTICLE_LIMIT=5000` (optional)
- `MARKETS_EXTERNAL_ARTICLE_LOOKBACK_DAYS=14` (optional)

API endpoints:

- `POST /markets/data/sync/external-crawler` to run sync
- `GET /markets/articles` to read synced articles

## LLM Routing Defaults

Markets execution defaults to open-source/local models:

- `OPENSOURCE_LLM_PROVIDER=ollama_local`
- `DEFAULT_OPENSOURCE_MODEL=qwen3:8b` (or `OLLAMA_DEFAULT_MODEL`)

Enable LLM-backed run processing and replay (otherwise deterministic stubs are used):

- `MARKETS_ENABLE_LLM=true` (legacy alias: `PHASE1_ENABLE_LLM`)

Commercial fallback is disabled unless explicitly enabled:

- `MARKETS_ALLOW_COMMERCIAL_FALLBACK=false` (default behavior)
