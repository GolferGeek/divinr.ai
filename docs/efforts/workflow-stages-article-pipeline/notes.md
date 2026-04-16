# Workflow Stages & Two-Step Article Pipeline — Notes

## Live cycle measurement (Phase 5.4)

**Status**: pending — needs one manual run against the live Spark pipeline
with proper external-API keys. The feature flag is gone post-cutover, so no
`MARKETS_STAGES_V2` env var is needed; the new flow is always on.

### How to run

From a Spark-hosted API process with Postgres at 54322, Ollama reachable, and
Polygon/FMP keys in `.env`, hit:

```bash
curl -s -X POST -H "x-user-id: admin-user" \
  http://localhost:7100/markets/admin/run-pipeline | jq '.'
```

`jq` will print a `PipelineResult` shape with the new counters. Additionally
run the acceptance script (hermetic, no external APIs — uses keyword-only
relevance + deterministic risk fallback):

```bash
pnpm --filter @divinr/api run test:markets:stages-v2
```

### What to record here after a clean run

- Cycle started: `<timestamp>`
- Duration: `<ms>`
- `relevancePairsEvaluated`: N
- `relevancePairsRelevant`: N
- `articlesSkippedByRelevanceGate`: N
- `riskAssessmentsWritten`: N
- `debatesRun`: N — break down by shared vs. per-viewer
- Workload truncations (`MARKETS_RISK_BATCH_LIMIT`): `<count + context>`
- Stale-risk warnings (`grep "Risk stale relative to predictors"`): `<count>`
- Errors surfaced in `result.errors`: `<list>`

### What to assert against

The three Goal queries from PRD §2, unchanged post-cutover:

```sql
-- G1: every artifact has a workflow_stage
select count(*) from prediction.market_run_artifacts
where workflow_stage is null
  and created_at > '<cycle_start>';   -- expect 0

-- G2: no predictors without a matching is_relevant=true row
select count(*) from prediction.market_predictors mp
where mp.created_at > '<cycle_start>'
  and not exists (
    select 1 from prediction.article_instrument_relevance air
    where air.article_id = mp.article_id
      and air.instrument_id = mp.instrument_id
      and air.is_relevant = true
  );   -- expect 0

-- G3: for each instrument touched this cycle, risk is fresher than predictors
-- (within 5 minutes of the latest predictor update)
with per_inst as (
  select mp.instrument_id,
         max(mp.updated_at) as latest_predictor,
         (select max(ara.created_at) from prediction.analyst_risk_assessments ara
           where ara.instrument_id = mp.instrument_id and ara.created_at > '<cycle_start>') as latest_risk
  from prediction.market_predictors mp
  where mp.updated_at > '<cycle_start>'
  group by mp.instrument_id
)
select count(*) from per_inst
where latest_predictor is not null
  and (latest_risk is null or latest_risk < latest_predictor - interval '5 minutes');
-- expect 0
```

## Per-viewer debate filtering (post-cutover addition)

Completed after the initial cutover. Schema + code both shipped:

- New table `prediction.viewer_instrument_analyst_assignments
  (id, viewer_user_id, instrument_id, analyst_id, created_at)` with unique
  `(viewer_user_id, instrument_id, analyst_id)` and two indexes.
- Added `viewer_user_id text` column + partial index on `prediction.risk_debates`.
- `RiskRunnerService.executePerAnalystRiskPass` now resolves each instrument's
  scope and runs all three plan-4.7 cases: base shared debate, per-viewer
  customs on base instruments, and custom-instrument debates scoped to the
  owner. `RiskDebateService.runDebate` accepts + persists `viewerUserId`.
- Unit tests in `risk-per-analyst-pass.test.ts` exercise each case.
- Downstream efforts can now insert into `viewer_instrument_analyst_assignments`
  as the single authoritative record of "which of my custom analysts
  participate on which instrument."

## Cutover (Phase 6)

- `MARKETS_STAGES_V2` feature flag removed from all code paths and the acceptance
  test on the implementation branch. Batch limit env var renamed from
  `MARKETS_STAGES_V2_RISK_BATCH_LIMIT` → `MARKETS_RISK_BATCH_LIMIT`.
- Admin `POST /markets/admin/run-pipeline` now delegates to
  `AnalystPipelineService.runPipeline()` and returns the full `PipelineResult`
  (with the five-stage counters) instead of the legacy `{crawl, predictors,
  predictions, outcomes}` shape. No JS/TS callers depended on the old shape.

## Deviations from plan

- **Phase 1 drive-by** — fixed pre-existing test bug in
  `tests/unit/recent-bars-ring-buffer.test.ts` (test provided `priceData`
  without `bars`; service was updated upstream to require it). Added a
  `?? []` guard in `OutcomeTrackingService.updateInstrumentPrice` and fixed
  the test to supply bars.
