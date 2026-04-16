# Effort: Custom Source Ingestion (BYO Article Feeds)

## Status

**Future** — scoped out of `user-authored-custom-content` v1. Revisit when demand emerges from power users authoring truly niche instruments.

## Problem

A user who authors a brand-new instrument (not in the base universe, not sharing a name with a base instrument) has no article flow hitting it. The Stage 1 relevance pipeline can only fire against instruments that are in the article corpus Divinr ingests. For truly private or obscure instruments — a family office's custom basket, a private fund, a domestic-only micro-cap not covered by mainstream news sources — there's no path to automated analysis.

## Intention

Eventually, let power users attach **their own article ingestion sources** — custom RSS feeds, API endpoints, or manual article submissions — to their authored instruments. The system treats these sources like base sources (Stage 1 relevance against the target instrument, fan out to its analysts), but the user funds the ingestion cost and rate limits.

## Rough Scope (When This Lands)

- Source connector types: RSS URL, REST API with polling cadence, manual text submission (paste or upload)
- Per-source rate limiting and quota
- BYO API credential for sources that require auth (user's API key encrypted server-side)
- Article deduplication and normalization (convert source-specific formats to the system's internal article shape)
- Billing impact: ingestion cost modeled per source (storage + processing + possibly per-API-call fees passed through)

## Out of Scope (Not Now)

- Not in `user-authored-custom-content` v1 — that ships with source *selection* from the existing Divinr roster only
- Not until authorship volume justifies the extra complexity

## Dependencies

- `user-authored-custom-content` must be mature and proven
- `cost-modeling-system` must track ingestion costs per source
- Real demand signal — at least a few power users asking for this

---

*Preserved as a near-future concept because it unlocks truly niche power-user scenarios. Not scoped to any timeline until demand materializes.*
