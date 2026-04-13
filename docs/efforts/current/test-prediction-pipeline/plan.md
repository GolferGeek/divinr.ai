# Test: Prediction Pipeline — Implementation Plan

**PRD**: ./intention.md
**Created**: 2026-04-13
**Status**: Not Started

## Progress Tracker
- [ ] Phase 1: API Verification — Run Lifecycle & Predictions
- [ ] Phase 2: Chrome Testing — Queue, View, Reasoning
- [ ] Phase 3: Bug Fixes & Marketing

---

## Phase 1: API Verification — Run Lifecycle & Predictions
**Status**: Not Started
**Objective**: Verify the full prediction pipeline via API: queue a run, process it, inspect analyst predictions, arbitrator synthesis, and LLM reasoning capture.

### Steps
- [ ] 1.1 List instruments (`GET /markets/instruments`) → pick one with recent data
- [ ] 1.2 Queue a prediction run (`POST /markets/runs` with instrumentId + runType=prediction) → 201 with runId, status=queued
- [ ] 1.3 List runs (`GET /markets/runs`) → new run appears with status=queued
- [ ] 1.4 Filter runs by status (`GET /markets/runs?status=queued`) → only queued runs returned
- [ ] 1.5 Process the run (`POST /markets/runs/process-next` or `/process`) → run starts processing
- [ ] 1.6 Poll run status (`GET /markets/runs/:runId`) until completed or failed
- [ ] 1.7 Get run detail (`GET /markets/runs/:runId?detail=true`) → analyst predictions + arbitrator outcome present
- [ ] 1.8 List predictions for this run (`GET /markets/predictions?runId=:runId`) → multiple analyst predictions with direction, confidence, rationale
- [ ] 1.9 Filter predictions by role (`GET /markets/predictions?runId=:runId&role=arbitrator`) → single arbitrator prediction
- [ ] 1.10 Get prediction provenance (`GET /markets/predictions/:predictionId/provenance`) → data lineage returned
- [ ] 1.11 Get LLM calls for a prediction (`GET /markets/predictions/:predictionId/llm-calls`) → reasoning_content present (non-null for reasoning models)
- [ ] 1.12 Get run artifacts (`GET /markets/runs/:runId/artifacts`) → artifacts list returned
- [ ] 1.13 Queue a risk run (`POST /markets/runs` with runType=risk) → 201 with runId
- [ ] 1.14 Process and verify risk run → risk_details with debate, dimension assessments, composite score
- [ ] 1.15 Get risk details (`GET /markets/runs/:runId/risk-details`) → structured risk assessment
- [ ] 1.16 Dashboard predictions (`GET /markets/predictions/dashboard`) → predictions grouped for dashboard display
- [ ] 1.17 RBAC: beta_reader cannot queue a run → 403
- [ ] 1.18 Invalid run: missing instrumentId → 400

### Quality Gate
- [ ] Full run lifecycle verified (queued → running → completed)
- [ ] Analyst predictions have direction + confidence + rationale
- [ ] Arbitrator synthesis present
- [ ] LLM reasoning_content captured (non-null)
- [ ] Risk run produces debate + dimension scores

---

## Phase 2: Chrome Testing — Queue, View, Reasoning
**Status**: Not Started
**Objective**: Walk through prediction flows in the browser: queue a run, watch it complete, inspect results and reasoning.

### Steps
- [ ] 2.1 Navigate to `/runs` → page loads with run list and status filters
- [ ] 2.2 Click to enqueue a new run → modal opens with instrument picker and type selector
- [ ] 2.3 Select an instrument and type=prediction, submit → run appears in list as queued
- [ ] 2.4 Wait for run to process (or trigger manually) → status changes to running, then completed
- [ ] 2.5 Click on completed run → RunDetailView loads with analyst predictions
- [ ] 2.6 Verify each analyst shows direction, confidence, and rationale
- [ ] 2.7 Verify arbitrator final outcome displayed
- [ ] 2.8 Check Reasoning tab (if available) → LLM thought process shown
- [ ] 2.9 Navigate to `/predictions` → prediction list with role filter
- [ ] 2.10 Filter by arbitrator only → single arbitrator prediction per run
- [ ] 2.11 Navigate to dashboard → prediction cards with consensus badges visible
- [ ] 2.12 Queue a risk analysis run → verify risk detail view with debate summary
- [ ] 2.13 As beta_reader, verify no "Queue Run" button visible
- [ ] 2.14 Filter runs by status (queued, completed, failed) → filters work correctly

### Quality Gate
- [ ] All 14 browser scenarios pass
- [ ] Reasoning tab displays LLM thought process
- [ ] No write controls visible for beta_reader
- [ ] Screenshots of key flows

---

## Phase 3: Bug Fixes & Marketing
**Status**: Not Started
**Objective**: Fix any bugs found, write marketing blurb.

### Steps
- [ ] 3.1 Fix any bugs discovered in Phases 1-2
- [ ] 3.2 Re-run failed tests to verify fixes
- [ ] 3.3 Write marketing blurb covering: multiple AI analysts making independent calls, arbitrator synthesis, explainable reasoning, not a black box. Save to `marketing-blurb.md`

### Quality Gate
- [ ] **Build**: clean
- [ ] **Lint**: clean
- [ ] **Unit Tests**: no new failures
- [ ] **Marketing blurb written**
