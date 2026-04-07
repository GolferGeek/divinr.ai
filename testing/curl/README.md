# Curl Tests

**Stub.** Currently, curl-driven smoke tests are inline in effort plans:

- `docs/efforts/archive/portfolio-foundation/plan.md` — Phase 1 DB-verification curls
- `docs/efforts/archive/agent-autotrading/plan.md` — Phase 1/2/3 curls (admin pipeline trigger, settlement trigger, etc.)

When consolidation happens, the structure should be:

```
testing/curl/
  health.sh                       # /health, sanity
  markets/
    portfolios.sh                 # GET /markets/portfolios + detail
    pipeline.sh                   # POST admin/run-pipeline + verify
    outcome-tracking.sh           # POST admin/run-outcome-tracking + watcher verify
    settlement.sh                 # POST admin/run-settlement + sweep verify
  README.md
```

Each script self-documents the URL, expected status code, and what to grep in the response. Runnable individually or via a wrapper that runs them in order.
