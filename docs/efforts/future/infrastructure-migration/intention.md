# Effort: Infrastructure Migration (Spark → Cloud)

## Status

**Future** — preserved from the prior roadmap's "Phase 3: Infrastructure Migration" section. Still pertinent; timing gated on revenue and usage patterns.

## Problem

DGX Spark + gemma4 is the bootstrap infrastructure. It works for a small beta cohort with serial LLM inference, but has inherent ceilings:

- Single-threaded inference (one LLM call at a time)
- Workstation-class hardware pretending to be a server (hardened in `spark-beta-hardening`, but not a datacenter)
- No frontier model access (gemma4 capability ceiling — fine for the base grind, insufficient for power-user authorship paying for premium quality)

Beyond a certain scale — some combination of authorship volume, user count, and premium-model demand — we have to migrate to cloud infrastructure with parallel inference, frontier model access, and real reliability.

## Intention

When the time is right, migrate from Spark + local gemma to a cloud infrastructure that supports parallel inference, access to frontier models (Claude, GPT-4), and horizontal scale. Revenue funds the migration; the platform never leaves Divinr's infrastructure (no desktop/local hybrid — that's the moat).

## When to Trigger

Migrate when any of these hit:

- Per-item authorship volume exceeds what Spark can serialize (estimated ~50-100 active custom instruments across all power users, given Stage 1 fanout)
- Sustained traffic exceeds Spark capacity (~40 base instruments × ~10 analysts × article volume)
- Day trader features need intraday cycles requiring parallel inference
- Revenue covers the migration cost (~$1,200/mo at Launch scale, growing with tier mix)

## Rough Shape of the Migration

- Primary candidate: OpenRouter for LLM access (multi-provider routing) + Google Cloud or similar for the compute/DB infrastructure
- Postgres migrates to a managed service (Supabase Cloud, Neon, RDS, etc.)
- Ollama local inference retired in favor of OpenRouter routing
- Or partial: keep gemma4 for the base grind (cheapest per call) and route premium model work to frontier providers
- Spark can live on as a backup / dev environment

## Success Criteria

- Zero downtime for users during migration (or clearly-communicated brief cutover)
- Cost predictable under the `cost-modeling-system` — migrated system should align with or outperform Spark economics for the target scale
- Parallel inference actually lights up (no residual single-thread bottlenecks)
- Frontier model access working end-to-end

## Dependencies

- `cost-modeling-system` needs to be mature enough to accurately forecast cloud costs before committing
- Revenue needs to be real (Stripe shipped, paying users onboard)
- Scale pressure needs to actually exist (don't migrate speculatively)

---

*No desktop/local hybrid. The platform stays on Divinr-controlled infrastructure — that's the competitive moat. Preserved from the prior roadmap; timing deferred until revenue and usage justify the move.*
