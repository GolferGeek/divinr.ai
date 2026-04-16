> **🗄️ Archived 2026-04-16 — Superseded by [master-intention.md](../../master-intention.md).**
> This document describes a separate Custom Tier ($500+/mo) where power users bring their own API keys as a standalone SKU. That concept is retired. In the new model, BYO API keys is an add-on available to any Basic user (with a platform fee), and per-item authorship ($20/instrument, $60/analyst) covers the "serious operators want custom content" use case without needing a separate tier. Kept here for historical reference.

---

# Effort: Power User Expansion (Custom Tier)

## Problem

The three shared tiers ($20/$50/$100) cover most users, but serious analysts and institutions want to extend the platform with their own resources. They need custom analysts with proprietary strategies, custom data sources with feeds we don't carry, and private analysis that other users never see.

## Intention

Build the Custom tier ($500+/mo) where power users bring their own LLM API keys and data API keys. Divinr provides the platform — orchestration, learning loop, evaluation, coordination scoring, portfolio management — they provide the compute and data for their custom resources.

## Model

- User brings their own API keys (Claude, OpenAI, Polygon, etc.)
- Custom analysts run on THEIR inference budget, not ours
- Custom data sources pull from THEIR API quotas, not ours
- Platform fee ($500+/mo) covers orchestration, learning loop, evaluation infrastructure
- Private analysis: their custom resources and results are invisible to other users
- Everything from Premium tier included

## Architecture

### Custom Analysts
- User-facing version of the contract editor (already built for admins)
- Guardrails: contracts must follow structured format, pass validation
- Custom analysts participate in the user's prediction runs alongside base analysts
- Learning loop evaluates them like any other analyst
- Coordination scoring includes them in coverage/contribution analysis
- User's LLM API key used for inference (stored encrypted, never exposed)

### Custom Data Sources  
- Configure RSS feeds, API endpoints, or upload article batches
- Source ingestion runs on user's API key quotas
- Articles indexed and available only to the user's analyst runs
- No cross-contamination with shared pool

### API Key Management
- Encrypted storage of user's LLM and data API keys
- Key validation on save (test call to verify it works)
- Usage tracking (so users can monitor their own costs)
- Graceful degradation if key quota exhausted

## What We DON'T Ship

- **No desktop/local hybrid** — all compute runs on our infrastructure (or the user's API keys hitting cloud providers). No shipping our codebase or database to user machines. The platform is the moat.
- **No crowd-funded pricing** — custom resources are premium-priced. Users who want custom pay the full platform fee. No waiting for adoption thresholds.

## Infrastructure Migration Note

Currently running gemma4 on DGX Spark (local inference, zero cost). Revenue from tiers funds migration to frontier models (Claude, GPT-4) on cloud infrastructure. This makes the shared tiers dramatically better and widens the gap between free/cheap alternatives and Divinr's quality.

Progression:
1. **Now**: Spark + gemma4 (bootstrap phase)
2. **Revenue**: Stripe + paid tiers fund the transition  
3. **Scale**: Frontier models on cloud (faster, smarter, concurrent inference)

## Success Criteria

- Custom tier users can create analysts with their own API keys
- Custom analysts participate in prediction runs and get evaluated
- Custom data sources ingest articles visible only to the user
- API key storage is encrypted and never exposed
- Platform fee covers our orchestration costs with healthy margin
- No codebase or database ever leaves our infrastructure

## Dependencies
- Paid tiers (Stripe integration) must ship first
- Analyst contract editor already exists (needs user-facing adaptation)
- Source ingestion pipeline already exists (needs per-user scoping)
